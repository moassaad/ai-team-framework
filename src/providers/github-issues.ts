/**
 * GitHub Issues TicketSource adapter (M18 R-009).
 *
 * The first concrete external `TicketSource`: a read-only bridge
 * from repository issues to the existing `CoordinatorTicket`
 * shape. One `listTickets()` call pages sequentially through
 * `GET /repos/{owner}/{repo}/issues` (verified against the
 * current GitHub REST Issues documentation: `state`, `labels`,
 * `per_page` max 100, `page`; pull requests identified by the
 * `pull_request` key) and converts each managed, non-PR entry
 * at this boundary. No writes, no comments, no labels, no
 * state synchronization — the write path belongs to R-010.
 *
 * ```text
 * GitHub Issues → GitHubIssue → CoordinatorTicket → listTickets()
 * ```
 *
 * Explicit caller-supplied inputs only: owner, repo, token,
 * managed label (sent as the API `labels` filter so unrelated
 * issues are never downloaded), issue lifecycle filter, an
 * adapter-local state decoder, an optional feedback decoder,
 * and an injectable transport. No credential defaults, no
 * environment reads, no configuration keys, no production
 * registry registration — later composition owns those.
 *
 * Established repository conventions reused: Bearer token with
 * the same Accept/API-version headers as the GitHub
 * `IssueProvider` adapter, and the same `## Requirements`
 * body section it writes (description before the heading,
 * requirements after). Human-authored text is preserved
 * exactly apart from heading-adjacent blank lines. GitHub's
 * `open/closed` lifecycle cannot express the 11 workflow
 * states, so the workflow state arrives only through the
 * caller-supplied `parseState`; a managed `changes_requested`
 * entry without decodable feedback is a bounded mapping
 * failure, never an executable rework ticket. Returned order
 * is GitHub's order — no sorting, no prioritization; the
 * Coordinator owns selection. The token never appears in
 * errors, logs, or diagnostics.
 */

import { CoordinatorTicket } from "../runtime/coordinator";
import { isWorkflowState, WorkflowState } from "../workflow/states";
import { TicketSource, validateSourceTickets } from "../runtime/ticket-source";

/** Stable adapter identity, local to this concrete module. */
export const GITHUB_ISSUES_SOURCE_NAME = "github-issues" as const;

const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_API_BASE = "https://api.github.com";
const PAGE_SIZE = 100;

/** Minimal structural view of one GitHub issue entry. */
export interface GitHubIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly state: string;
  readonly labels: ReadonlyArray<string>;
  readonly pull_request: boolean;
}

/**
 * Local injected transport seam. Production uses global fetch;
 * tests inject a fake. Local to this adapter, not a
 * framework-wide client — just enough to observe URL, method,
 * headers, and body absence, and to drive pagination.
 */
export interface GitHubIssuesHttpRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface GitHubIssuesHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export type GitHubIssuesTransport = (
  request: GitHubIssuesHttpRequest,
) => Promise<GitHubIssuesHttpResponse>;

async function defaultTransport(
  request: GitHubIssuesHttpRequest,
): Promise<GitHubIssuesHttpResponse> {
  const response = await fetch(request.url, {
    method: request.method,
    headers: { ...request.headers },
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

export interface GitHubIssuesSourceOptions {
  /** Repository owner. Non-empty, no slashes; never auto-discovered. */
  readonly owner: string;
  /** Repository name. Non-empty, no slashes; never auto-discovered. */
  readonly repo: string;
  /** Credential, injected by the caller. Never logged or exposed. */
  readonly token: string;
  /**
   * Required managed-issue label: only issues carrying it are
   * managed AI Team tickets. Sent as the API `labels` filter;
   * no silent default.
   */
  readonly managedLabel: string;
  /**
   * GitHub issue lifecycle filter. Defaults to `"open"`;
   * managed tickets are open issues until synchronized.
   */
  readonly issueState?: "open" | "closed" | "all";
  /**
   * Adapter-local workflow-state decoder. GitHub's
   * open/closed lifecycle cannot express Coordinator states,
   * so the caller supplies this explicitly; its result is
   * validated against the existing workflow states.
   */
  readonly parseState: (issue: GitHubIssue) => WorkflowState;
  /**
   * Optional adapter-local feedback decoder for
   * `changes_requested` entries. A managed entry decoding to
   * `changes_requested` without non-empty decoded feedback is
   * a bounded mapping failure.
   */
  readonly parseFeedback?: (issue: GitHubIssue) => string | undefined;
  /** Overridable transport for tests. */
  readonly transport?: GitHubIssuesTransport;
}

function fail(what: string): never {
  throw new Error(`github issues source: ${what}`);
}

function nonEmptySegment(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("/")) {
    fail(`invalid options (${field} must be a non-empty path segment)`);
  }
  return value;
}

function sourceHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    Authorization: `Bearer ${token}`,
  };
}

function pageUrl(owner: string, repo: string, issueState: string, managedLabel: string, page: number): string {
  const query = `state=${encodeURIComponent(issueState)}&labels=${encodeURIComponent(managedLabel)}&per_page=${String(PAGE_SIZE)}&page=${String(page)}`;
  return `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?${query}`;
}

function labelNames(value: unknown): ReadonlyArray<string> {
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

function toGitHubIssue(value: unknown): GitHubIssue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("unexpected response (issue must be an object)");
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.number !== "number" || !Number.isInteger(entry.number) || entry.number <= 0) {
    fail("unexpected response (issue without a valid numeric issue number)");
  }
  if (typeof entry.title !== "string" || entry.title.length === 0) {
    fail("unexpected response (issue without a title)");
  }
  if (typeof entry.state !== "string") {
    fail("unexpected response (issue state must be a string)");
  }
  if (entry.body !== null && entry.body !== undefined && typeof entry.body !== "string") {
    fail("unexpected response (issue body must be text)");
  }
  return {
    number: entry.number,
    title: entry.title,
    body: typeof entry.body === "string" ? entry.body : null,
    state: entry.state,
    labels: labelNames(entry.labels),
    pull_request: typeof entry.pull_request === "object" && entry.pull_request !== null,
  };
}

/**
 * Split an issue body on the established `## Requirements`
 * section (the same grammar the GitHub `IssueProvider`
 * adapter writes): description before the heading,
 * requirements after. Heading-adjacent blank lines are
 * formatting, so both parts are trimmed; all other text is
 * preserved exactly. A missing section leaves requirements
 * ambiguous, which the caller must resolve — never fabricated.
 */
function splitBody(body: string): { description: string; requirements: string | undefined } {
  const match = /^## Requirements\s*$/m.exec(body);
  if (match === null || match.index === undefined) {
    return { description: body.trim(), requirements: undefined };
  }
  return {
    description: body.slice(0, match.index).trim(),
    requirements: body.slice(match.index + match[0].length).trim(),
  };
}

function mapIssue(
  raw: unknown,
  parseState: (issue: GitHubIssue) => WorkflowState,
  parseFeedback: ((issue: GitHubIssue) => string | undefined) | undefined,
): CoordinatorTicket | undefined {
  const issue = toGitHubIssue(raw);
  if (issue.pull_request) {
    return undefined;
  }
  let state: WorkflowState;
  try {
    state = parseState(issue);
  } catch (error) {
    fail(`state mapping failed for issue #${String(issue.number)} (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!isWorkflowState(state)) {
    fail(`state mapping failed for issue #${String(issue.number)} (not a workflow state)`);
  }
  const { description, requirements } = splitBody(issue.body ?? "");
  if (description.length === 0) {
    fail(`issue #${String(issue.number)} has no description`);
  }
  if (requirements === undefined || requirements.length === 0) {
    fail(`issue #${String(issue.number)} has no explicit requirements section`);
  }
  let feedback: string | undefined;
  if (parseFeedback !== undefined) {
    const decoded = parseFeedback(issue);
    if (decoded !== undefined) {
      if (typeof decoded !== "string" || decoded.length === 0) {
        fail(`feedback mapping failed for issue #${String(issue.number)}`);
      }
      feedback = decoded;
    }
  }
  if (state === "changes_requested" && feedback === undefined) {
    fail(`issue #${String(issue.number)} decodes to changes_requested without feedback`);
  }
  return {
    id: String(issue.number),
    title: issue.title,
    description,
    requirements,
    state,
    ...(feedback !== undefined ? { feedback } : {}),
  };
}

function boundedStatusError(status: number): never {
  if (status === 401 || status === 403) {
    fail(`authentication failed (status ${String(status)})`);
  }
  if (status === 404) {
    fail(`repository not found (status ${String(status)})`);
  }
  if (status === 422) {
    fail(`request rejected (status ${String(status)})`);
  }
  if (status >= 500) {
    fail(`server failure (status ${String(status)})`);
  }
  fail(`request failed with status ${String(status)}`);
}

/**
 * Build a read-only GitHub Issues ticket source. Validates
 * owner, repo, token, managed label, lifecycle filter, state
 * decoder, and transport up front; every failure afterwards
 * is a bounded rejection carrying no credentials.
 */
export function createGitHubIssuesTicketSource(options: GitHubIssuesSourceOptions): TicketSource {
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
  const issueState = options.issueState ?? "open";
  if (issueState !== "open" && issueState !== "closed" && issueState !== "all") {
    fail('invalid options (issueState must be "open", "closed", or "all")');
  }
  if (typeof options.parseState !== "function") {
    fail("invalid options (parseState must be a function)");
  }
  const parseState = options.parseState;
  if (options.parseFeedback !== undefined && typeof options.parseFeedback !== "function") {
    fail("invalid options (parseFeedback must be a function)");
  }
  const parseFeedback = options.parseFeedback;
  if (options.transport !== undefined && typeof options.transport !== "function") {
    fail("invalid options (transport must be a function)");
  }
  const transport = options.transport ?? defaultTransport;

  return {
    async listTickets(): Promise<CoordinatorTicket[]> {
      const collected: CoordinatorTicket[] = [];
      let page = 1;
      for (;;) {
        let response: GitHubIssuesHttpResponse;
        try {
          response = await transport({
            url: pageUrl(owner, repo, issueState, managedLabel, page),
            method: "GET",
            headers: sourceHeaders(token),
          });
        } catch {
          fail("request failed");
        }
        if (response.status < 200 || response.status >= 300) {
          boundedStatusError(response.status);
        }
        if (!Array.isArray(response.body)) {
          fail("unexpected response (issue list must be an array)");
        }
        for (const raw of response.body) {
          const mapped = mapIssue(raw, parseState, parseFeedback);
          if (mapped !== undefined) {
            collected.push(mapped);
          }
        }
        if (response.body.length < PAGE_SIZE) {
          return validateSourceTickets(collected);
        }
        page += 1;
      }
    },
  };
}
