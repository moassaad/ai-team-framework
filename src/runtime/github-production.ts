/**
 * Production GitHub source/sink composition (M18 R-011).
 *
 * The one truthful production path from configuration to the
 * Coordinator through the proven concrete GitHub adapters:
 *
 * ```text
 * FrameworkConfig (providers.github.enabled/owner/repo)
 *   + explicit token, managed label, state decoding
 *        ↓
 * createGitHubIssuesTicketSource + createGitHubIssuesTicketSink
 *        ↓ (shared transport, same repository mapping)
 * runProductionCoordinatorFromSource({ ticketSource, ticketSink, ... })
 * ```
 *
 * Composition only: no CLI, scheduler, polling, webhooks,
 * provisioning, retries, or second Coordinator. Construction
 * performs zero HTTP — factories only validate strings.
 * Everything the adapters need arrives explicitly; the
 * configuration schema is unchanged (no new keys), the token
 * never lives in configuration (no secret subsystem exists —
 * the caller supplies it), and the managed label has no
 * default. The production state decoder is the documented
 * round-trip of the R-010 label convention: the single
 * `<managedLabel>:<state>` label wins, a managed issue with
 * no state label is new work (`ready`), and anything
 * ambiguous is a bounded failure — overridable with an
 * explicit `parseState`.
 */

import { FrameworkConfig } from "../config/schema";
import { AgentProvider } from "../providers/agent";
import { ImplementerSpecialty } from "../roles/contract";
import { WorkflowState, isWorkflowState } from "../workflow/states";
import {
  GitHubIssue,
  GitHubIssuesTransport,
  createGitHubIssuesTicketSource,
} from "../providers/github-issues";
import { createGitHubIssuesTicketSink } from "../providers/github-sink";
import {
  CoordinatorTicketResult,
  ReviewDecision,
} from "./coordinator";
import {
  ProductionSynchronizationFailed,
  runProductionCoordinatorFromSource,
} from "./application";

export interface GitHubProductionOptions {
  /** Validated framework configuration; only `providers.github` is read. */
  readonly config: FrameworkConfig;
  /** Credential, supplied explicitly by the caller. Never logged. */
  readonly token: string;
  /** Required managed-issue label; no default. */
  readonly managedLabel: string;
  /**
   * Optional override for the production state decoder.
   * Defaults to `decodeManagedLabelState(managedLabel)`.
   */
  readonly parseState?: (issue: GitHubIssue) => WorkflowState;
  /** Optional feedback decoder, passed through to the source. */
  readonly parseFeedback?: (issue: GitHubIssue) => string | undefined;
  /** Shared transport for source and sink; fetch default. */
  readonly transport?: GitHubIssuesTransport;
  /** Implementer specialty, decided externally by the caller. */
  readonly specialty: ImplementerSpecialty;
  /** Ready-made OpenCode string agent. */
  readonly openCodeAgent: AgentProvider<string>;
  /** Target project root for both provider invocations. */
  readonly project_root: string;
  /** Execution bound in milliseconds for each invocation. */
  readonly timeout_ms: number;
  /** Explicit review verdict; never derived from report text. */
  readonly reviewDecision: ReviewDecision;
  /** Required with `changes_requested`; preserved as the rework reason. */
  readonly reviewFeedback?: string;
  /** Pre-computed discovery summary, when available. */
  readonly discovery_summary?: string;
}

function fail(what: string): never {
  throw new Error(`github production: ${what}`);
}

/**
 * Production state decoder: the documented round-trip of the
 * R-010 `<managedLabel>:<state>` convention. Exactly one
 * managed state label decodes to its workflow state; no state
 * label means new managed work (`ready`); several state
 * labels, or a non-workflow state name, fail bounded instead
 * of guessing.
 */
export function decodeManagedLabelState(
  managedLabel: string,
): (issue: GitHubIssue) => WorkflowState {
  if (typeof managedLabel !== "string" || managedLabel.length === 0) {
    fail("managedLabel must be a non-empty string");
  }
  const prefix = `${managedLabel}:`;
  return (issue: GitHubIssue): WorkflowState => {
    const names = issue.labels
      .filter((label) => label.startsWith(prefix))
      .map((label) => label.slice(prefix.length));
    const states = names.filter(isWorkflowState);
    if (states.length !== names.length) {
      fail(`issue #${String(issue.number)} carries an unknown state label`);
    }
    if (states.length > 1) {
      fail(`issue #${String(issue.number)} carries ambiguous state labels`);
    }
    return states[0] ?? "ready";
  };
}

/**
 * Run one production GitHub Coordinator invocation: resolve
 * configuration, build the source and sink with the shared
 * repository mapping, and delegate to the existing
 * source-based application operation (which owns the single
 * Coordinator call and the optional-sink semantics, including
 * `sync-failed`). Invalid production inputs fail before any
 * HTTP; a disabled GitHub path never activates.
 */
export async function runGitHubProductionCoordinator(
  options: GitHubProductionOptions,
): Promise<CoordinatorTicketResult | ProductionSynchronizationFailed> {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    fail("expected an options object");
  }
  const github =
    typeof options.config === "object" && options.config !== null
      ? (options.config as FrameworkConfig).providers?.github
      : undefined;
  if (github?.enabled !== true) {
    fail("providers.github.enabled must be true for the GitHub runtime path");
  }
  if (typeof github.owner !== "string" || github.owner.length === 0) {
    fail("providers.github.owner must be a non-empty string");
  }
  if (typeof github.repo !== "string" || github.repo.length === 0) {
    fail("providers.github.repo must be a non-empty string");
  }
  if (typeof options.token !== "string" || options.token.length === 0) {
    fail("token must be a non-empty string");
  }
  if (typeof options.managedLabel !== "string" || options.managedLabel.length === 0) {
    fail("managedLabel must be a non-empty string");
  }
  const parseState = options.parseState ?? decodeManagedLabelState(options.managedLabel);
  if (typeof parseState !== "function") {
    fail("parseState must be a function");
  }
  const transport = options.transport;
  const ticketSource = createGitHubIssuesTicketSource({
    owner: github.owner,
    repo: github.repo,
    token: options.token,
    managedLabel: options.managedLabel,
    parseState,
    ...(options.parseFeedback !== undefined ? { parseFeedback: options.parseFeedback } : {}),
    ...(transport !== undefined ? { transport } : {}),
  });
  const ticketSink = createGitHubIssuesTicketSink({
    owner: github.owner,
    repo: github.repo,
    token: options.token,
    managedLabel: options.managedLabel,
    ...(transport !== undefined ? { transport } : {}),
  });
  return runProductionCoordinatorFromSource({
    ticketSource,
    ticketSink,
    specialty: options.specialty,
    openCodeAgent: options.openCodeAgent,
    project_root: options.project_root,
    timeout_ms: options.timeout_ms,
    reviewDecision: options.reviewDecision,
    ...(options.reviewFeedback !== undefined ? { reviewFeedback: options.reviewFeedback } : {}),
    ...(options.discovery_summary !== undefined ? { discovery_summary: options.discovery_summary } : {}),
  });
}
