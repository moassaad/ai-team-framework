/**
 * Senior Reviewer execution flow (IR-002).
 *
 * Composition only: validated review context becomes a rendered Senior
 * Reviewer prompt, executed once through the injected generic provider
 * under the O-005 bound. Success returns the agent's review report as
 * evidence for the Technical Lead's later decision; no workflow edge
 * is reviewer-owned in W-002, so no transition is ever recommended
 * here — on success or on provider failure. No code modification, no
 * approval, no state mutation, no second attempts.
 */

import { AgentProvider, isAgentProvider } from "../providers/agent";
import { ExecutionFailureKind, ProviderExecutionError, executeWithTimeout } from "../providers/execution";
import { ExecutionResult } from "../providers/result";
import { renderRolePrompt } from "../providers/prompt";
import { SENIOR_REVIEWER_ROLE } from "../roles/senior-reviewer";

export interface ReviewerExecutionInput {
  /** Ticket under review; shape-checked locally, planning contracts untouched. */
  readonly ticket: {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly requirements: string;
  };
  /** Implementation result text under review (e.g. an IR-001 outcome). */
  readonly implementation_result: string;
  /** Target project root; becomes the provider working directory. */
  readonly project_root: string;
  /** Pre-computed discovery summary, when available. */
  readonly discovery_summary?: string;
  /** Injected generic provider. No detection, no selection. */
  readonly provider: AgentProvider<ExecutionResult>;
  /** Execution bound in milliseconds; owned by O-005 semantics. */
  readonly timeout_ms: number;
}

export interface ReviewerCompleted {
  readonly outcome: "completed";
  readonly ticket_id: string;
  /** Agent's review report, verbatim. Evidence for later flow, not a decision. */
  readonly report: string;
  /** No reviewer-owned edge exists in W-002; never a recommendation. */
  readonly next_state: null;
}

export interface ReviewerFailed {
  readonly outcome: "failed";
  readonly ticket_id: string;
  readonly error: {
    readonly kind: ExecutionFailureKind;
    readonly message: string;
  };
  readonly next_state: null;
}

export type ReviewerExecution = ReviewerCompleted | ReviewerFailed;

function fail(what: string): never {
  throw new Error(`reviewer execution: invalid input (${what})`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

/**
 * Validate raw data as reviewer input and return a frozen copy.
 * Checks ticket shape, implementation result text, project root,
 * injected provider shape, and a positive finite timeout. Rejects
 * malformed input without executing anything.
 */
export function validateReviewerInput(data: unknown): ReviewerExecutionInput {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  if (typeof raw.ticket !== "object" || raw.ticket === null) {
    fail("ticket must be an object");
  }
  const ticket = raw.ticket as Record<string, unknown>;
  const validatedTicket = {
    id: nonEmptyString(ticket.id, "ticket.id"),
    title: nonEmptyString(ticket.title, "ticket.title"),
    description: nonEmptyString(ticket.description, "ticket.description"),
    requirements: nonEmptyString(ticket.requirements, "ticket.requirements"),
  };
  const implementation_result = nonEmptyString(raw.implementation_result, "implementation_result");
  const project_root = nonEmptyString(raw.project_root, "project_root");
  if (!isAgentProvider(raw.provider)) {
    fail("provider must satisfy the agent provider contract");
  }
  if (typeof raw.timeout_ms !== "number" || !Number.isFinite(raw.timeout_ms) || raw.timeout_ms <= 0) {
    fail("timeout_ms must be a positive finite number");
  }
  // Shape-checked above; the result type is upheld by the caller's
  // static provider type, as with every generic seam in this repo.
  const provider = raw.provider as AgentProvider<ExecutionResult>;
  const input: ReviewerExecutionInput = {
    ticket: Object.freeze(validatedTicket),
    implementation_result,
    project_root,
    provider,
    timeout_ms: raw.timeout_ms,
  };
  if (raw.discovery_summary !== undefined) {
    (input as { discovery_summary?: string }).discovery_summary = nonEmptyString(
      raw.discovery_summary,
      "discovery_summary",
    );
  }
  return Object.freeze(input);
}

function taskText(input: Pick<ReviewerExecutionInput, "ticket" | "implementation_result">): string {
  return [
    `Review ticket ${input.ticket.id}: ${input.ticket.title}`,
    "",
    "Implementation result under review:",
    input.implementation_result,
    "",
    "Ticket description:",
    input.ticket.description,
    "",
    "Requirements:",
    input.ticket.requirements,
  ].join("\n");
}

/**
 * Execute one senior review. Renders the canonical Senior Reviewer
 * prompt, runs it once through the injected provider under the timeout
 * bound, and returns the outcome. The reviewer only reports; a single
 * provider attempt with no second attempts, no recovery, no approval,
 * and no state changes.
 */
export async function executeReviewerTicket(
  input: ReviewerExecutionInput,
): Promise<ReviewerExecution> {
  const validated = validateReviewerInput(input);
  const prompt = renderRolePrompt({
    role: SENIOR_REVIEWER_ROLE,
    task: taskText(validated),
    project: { root: validated.project_root },
    ...(validated.discovery_summary !== undefined
      ? { discovery_summary: validated.discovery_summary }
      : {}),
  });
  try {
    const result = await executeWithTimeout(
      validated.provider,
      { prompt, project_root: validated.project_root },
      { timeout_ms: validated.timeout_ms },
    );
    return Object.freeze({
      outcome: "completed",
      ticket_id: validated.ticket.id,
      report: result.text,
      next_state: null,
    } as const);
  } catch (error) {
    if (error instanceof ProviderExecutionError) {
      return Object.freeze({
        outcome: "failed",
        ticket_id: validated.ticket.id,
        error: Object.freeze({ kind: error.kind, message: error.message }),
        next_state: null,
      } as const);
    }
    throw error;
  }
}
