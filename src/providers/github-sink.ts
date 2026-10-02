/**
 * GitHub Issues TicketSink adapter (M18 R-010).
 *
 * The concrete write side corresponding to the R-009 read side:
 * synchronizes one Coordinator-processed ticket into its GitHub
 * issue through a single `PATCH
 * /repos/{owner}/{repo}/issues/{issue_number}` (endpoint and
 * updatable fields verified against the current GitHub REST
 * Issues documentation). Implements only
 * `updateTicket(ticket)`; the generic `TicketSink` contract is
 * unchanged, and no other module changes.
 *
 * ```text
 * CoordinatorTicket → state labels (+ native close) → PATCH issue
 * ```
 *
 * One bounded pre-read justifies itself four ways, and the
 * module documents each: the ticket carries no labels (so the
 * managed label cannot be verified without reading), PATCH
 * replaces the whole label set (so user labels cannot be
 * preserved without reading), the ticket identity alone cannot
 * distinguish pull requests (so the `pull_request` key must be
 * observed), and only reading proves the target is still the
 * managed issue. The pre-read is one GET; the mutation is at
 * most one PATCH; no comments, no other endpoints, no engine.
 *
 * Workflow-state representation is adapter-local labels:
 * `<managedLabel>:<state>` (for example
 * `ai-team:technical_approval`). GitHub's native open/closed
 * lifecycle stays separate from AI Team workflow state — only
 * the established close convention (`closed`, `cancelled` →
 * native `closed`, matching the documented `IssueProvider`
 * behavior) touches native state, and it is never sent for
 * any other state. Reachable R-008 outcomes
 * (`technical_approval`, `changes_requested`, `failed`,
 * `implementation_review`) synchronize labels only; any other
 * state without a legitimate representation is a bounded
 * error, never a misleading update.
 *
 * Preservation: title, body (including the established
 * `## Requirements` section), and unrelated labels are never
 * sent and therefore never altered; only AI Team state labels
 * are replaced, idempotently, as a set. Reviewer feedback is
 * never fabricated into comments or body — when
 * `ticket.feedback` is absent nothing is synthesized, and even
 * when present no comment/body mapping exists yet by design.
 * The token travels only on the outbound Authorization header
 * and never appears in errors, logs, or diagnostics.
 */

import { CoordinatorTicket, isTicket } from "../runtime/coordinator";
import { isWorkflowState } from "../workflow/states";
import { TicketSink } from "../runtime/ticket-sink";
import {
  GitHubIssuesHttpResponse,
  GitHubIssuesTransport,
} from "./github-issues";

/** Stable adapter identity, local to this concrete module. */
export const GITHUB_ISSUES_SINK_NAME = "github-issues-sink" as const;

const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_API_BASE = "https://api.github.com";

/**
 * Ticket states with a legitimate GitHub representation under
 * this adapter's convention. The four R-008-reachable states
 * synchronize state labels only; `closed`/`cancelled` follow
 * the established native-close convention as well. Every
 * other workflow state fails bounded before any HTTP.
 */
const SYNCHRONIZED_STATES = [
  "technical_approval",
  "changes_requested",
  "failed",
  "implementation_review",
  "closed",
  "cancelled",
] as const;

type SynchronizedState = (typeof SYNCHRONIZED_STATES)[number];

function isSynchronizedState(state: string): state is SynchronizedState {
  return (SYNCHRONIZED_STATES as readonly string[]).includes(state);
}

export interface GitHubIssuesSinkOptions {
  /** Repository owner. Non-empty, no slashes; never auto-discovered. */
  readonly owner: string;
  /** Repository name. Non-empty, no slashes; never auto-discovered. */
  readonly repo: string;
  /** Credential, injected by the caller. Never logged or exposed. */
  readonly token: string;
  /**
   * Required managed-issue label (same convention as the R-009
   * source): the target must carry it or no mutation occurs,
   * and state labels live under `<managedLabel>:<state>`.
   */
  readonly managedLabel: string;
  /** Overridable transport for tests. */
  readonly transport?: GitHubIssuesTransport;
}

function fail(what: string): never {
  throw new Error(`github issues sink: ${what}`);
}

function nonEmptySegment(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("/")) {
    fail(`invalid options (${field} must be a non-empty path segment)`);
  }
  return value;
}

function sinkHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function defaultTransport(
  request: Parameters<GitHubIssuesTransport>[0],
): Promise<GitHubIssuesHttpResponse> {
  const response = await fetch(request.url, {
    method: request.method,
    headers: { ...request.headers },
    body: request.body,
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

function boundedStatusError(status: number): never {
  if (status === 401 || status === 403) {
    fail(`authentication failed (status ${String(status)})`);
  }
  if (status === 404) {
    fail(`issue not found (status ${String(status)})`);
  }
  if (status === 410) {
    fail(`issue gone (status ${String(status)})`);
  }
  if (status === 422) {
    fail(`request rejected (status ${String(status)})`);
  }
  if (status >= 500) {
    fail(`server failure (status ${String(status)})`);
  }
  fail(`request failed with status ${String(status)}`);
}

function labelNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    fail("unexpected response (issue labels must be an array)");
  }
  return value.map((entry) => {
    if (typeof entry === "string") {
      return entry;
    }
    if (typeof entry === "object" && entry !== null && typeof (entry as Record<string, unknown>).name === "string") {
      return (entry as Record<string, unknown>).name as string;
    }
    return fail("unexpected response (malformed issue label)");
  });
}

interface FetchedIssue {
  readonly number: number;
  readonly labels: string[];
  readonly pull_request: boolean;
}

function toFetchedIssue(value: unknown): FetchedIssue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("unexpected response (issue must be an object)");
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.number !== "number" || !Number.isInteger(entry.number) || entry.number <= 0) {
    fail("unexpected response (issue without a valid numeric issue number)");
  }
  return {
    number: entry.number,
    labels: labelNames(entry.labels),
    pull_request: typeof entry.pull_request === "object" && entry.pull_request !== null,
  };
}

/**
 * Build a GitHub Issues ticket sink. Validates owner, repo,
 * token, managed label, and transport up front; every failure
 * afterwards is a bounded rejection carrying no credentials.
 */
export function createGitHubIssuesTicketSink(options: GitHubIssuesSinkOptions): TicketSink {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    fail("invalid options (expected an options object)");
  }
  const owner = nonEmptySegment(options.owner, "owner");
  const repo = nonEmptySegment(options.repo, "repo");
  if (typeof options.token !== "string" || options.token.length === 0) {
    fail("invalid options (token must be a non-empty string)");
  }
  const token = options.token;
  if (typeof options.managedLabel !== "string" || options.managedLabel.length === 0) {
    fail("invalid options (managedLabel must be a non-empty string)");
  }
  const managedLabel = options.managedLabel;
  if (options.transport !== undefined && typeof options.transport !== "function") {
    fail("invalid options (transport must be a function)");
  }
  const transport = options.transport ?? defaultTransport;
  const issueUrl = (issueNumber: string): string =>
    `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${encodeURIComponent(issueNumber)}`;

  return {
    async updateTicket(ticket: CoordinatorTicket): Promise<void> {
      if (!isTicket(ticket)) {
        fail("invalid ticket (id, title, description, requirements, and a valid state are required)");
      }
      if (!/^\d+$/.test(ticket.id)) {
        fail(`invalid ticket id ${JSON.stringify(ticket.id)} (expected digits)`);
      }
      if (!isWorkflowState(ticket.state)) {
        fail(`unsupported state ${JSON.stringify(ticket.state)}`);
      }
      if (!isSynchronizedState(ticket.state)) {
        fail(`state ${ticket.state} has no GitHub representation`);
      }
      const state: SynchronizedState = ticket.state;
      const url = issueUrl(ticket.id);

      let fetched: FetchedIssue;
      try {
        const response = await transport({ url, method: "GET", headers: sinkHeaders(token) });
        if (response.status < 200 || response.status >= 300) {
          boundedStatusError(response.status);
        }
        fetched = toFetchedIssue(response.body);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("github issues sink: ")) {
          throw error;
        }
        fail("request failed");
      }
      if (fetched.pull_request) {
        fail(`issue #${ticket.id} is a pull request; refusing synchronization`);
      }
      if (!fetched.labels.includes(managedLabel)) {
        fail(`issue #${ticket.id} is not managed (missing label ${JSON.stringify(managedLabel)})`);
      }
      const prefix = `${managedLabel}:`;
      const preserved = fetched.labels.filter((label) => !label.startsWith(prefix));
      const labels = [...preserved, `${prefix}${state}`];
      const payload: Record<string, unknown> = { labels };
      if (state === "closed" || state === "cancelled") {
        payload.state = "closed";
      }
      try {
        const response = await transport({
          url,
          method: "PATCH",
          headers: sinkHeaders(token),
          body: JSON.stringify(payload),
        });
        if (response.status < 200 || response.status >= 300) {
          boundedStatusError(response.status);
        }
        const updated = toFetchedIssue(response.body);
        if (updated.number !== Number(ticket.id)) {
          fail("unexpected response (updated wrong issue)");
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("github issues sink: ")) {
          throw error;
        }
        fail("request failed");
      }
    },
  };
}
