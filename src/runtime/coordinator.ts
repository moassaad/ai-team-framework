/**
 * Single-ticket Coordinator runtime foundation (M18 R-001).
 *
 * The first executable slice of the team workflow: exactly one
 * `ready` ticket runs Implementer → implementation review →
 * Senior Reviewer, and the review decision lands on the existing
 * W-002 edge. No sprint, no rework loop, no TL/PM/User stages —
 * those are later M18 tickets. One new seam only: no ticket
 * store, engine v2, scheduler, or retry framework exists in this
 * repo, and none is added here.
 *
 * ```text
 * ready → in_progress → Implementer → implementation_review
 *   → Senior Reviewer → technical_approval | changes_requested
 * ```
 *
 * Composition, not reimplementation: Implementer and Reviewer run
 * through IR-001/IR-002 with injected generic `AgentProvider`s;
 * every state change is verified with `isValidTransition` before
 * it is recorded; the review branches go through the existing
 * IR-004/IR-003 recommendation semantics
 * (`recommendTechnicalApproval` / `requestChanges`). At most one
 * Implementer invocation and one Reviewer invocation per call —
 * failure stops the path with the existing `failed` edge, and a
 * `changes_requested` outcome stops at the state boundary (the
 * next Implementer run belongs to a later ticket, never to this
 * call).
 *
 * Explicit evidence, never inference: the Implementer specialty
 * arrives already resolved (as IR-001 requires), and the review
 * decision arrives as an explicit caller-supplied verdict —
 * IR-002/IR-003 forbid parsing reviewer reports into verdicts,
 * and both outgoing W-002 edges are technical-lead owned, so
 * automated report→decision mapping belongs to a later ticket
 * with provider-contract support. `changes_requested` requires
 * non-empty feedback (it becomes the IR-003 reason); the report
 * itself travels as opaque evidence and is preserved.
 *
 * Ownership: the caller owns the ticket list (no new store —
 * planning/issue layers produce it); the runtime advances the
 * selected ticket's `state` in place so the outcome stays
 * observable through the existing ticket workflow state, and
 * returns every applied edge in the result. Selection is list
 * order: the first `ready` ticket runs, but only when no ticket
 * is already in-flight (`in_progress`, `implementation_review`)
 * — otherwise a bounded conflict names that ticket and nothing
 * runs. Non-ready tickets are never executed as new
 * work. No approval is consulted or granted: no R-001 edge
 * touches an approval gate (those live at `pm_review`), so the
 * existing manual-approval semantics hold by construction — this
 * runtime can never close a ticket. No IssueProvider calls: the
 * tracker contract expresses no workflow transition, so any call
 * would fabricate semantics. No Git, no shell, no delegation
 * specifics: providers stay behind `AgentProvider`.
 */

import { AgentProvider, isAgentProvider } from "../providers/agent";
import { ExecutionResult } from "../providers/result";
import { ImplementerSpecialty, isImplementerSpecialty } from "../roles/contract";
import { WorkflowState, isWorkflowState } from "../workflow/states";
import { isValidTransition } from "../workflow/transitions";
import { executeImplementerTicket } from "../execution/implementer";
import { executeReviewerTicket } from "../execution/reviewer";
import { requestChanges } from "../execution/changes-requested";
import { recommendTechnicalApproval } from "../execution/technical-approval";

/**
 * Runtime ticket view: the existing PlanTicket/IR ticket shape
 * plus its current workflow state. The runtime advances `state`
 * in place on the caller's objects; nothing is copied into a
 * parallel store.
 */
export interface CoordinatorTicket {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly requirements: string;
  state: WorkflowState;
}

/** Bounded review verdict, supplied explicitly by the caller. */
export type ReviewDecision = "approved" | "changes_requested";

function isReviewDecision(value: unknown): value is ReviewDecision {
  return value === "approved" || value === "changes_requested";
}

/** One applied workflow edge, verified before it was recorded. */
export interface CoordinatorTransition {
  readonly from: WorkflowState;
  readonly to: WorkflowState;
}

export interface CoordinatorRuntimeInput {
  /** Caller-owned tickets; exactly one `ready` entry may advance. */
  readonly tickets: CoordinatorTicket[];
  /** Already-resolved canonical Implementer specialty. */
  readonly specialty: ImplementerSpecialty;
  /** Target project root for both provider invocations. */
  readonly project_root: string;
  /** Generic provider executing the Implementer prompt, once. */
  readonly implementerProvider: AgentProvider<ExecutionResult>;
  /** Generic provider executing the Senior Reviewer prompt, once. */
  readonly reviewerProvider: AgentProvider<ExecutionResult>;
  /** Execution bound in milliseconds for each invocation. */
  readonly timeout_ms: number;
  /** Explicit review verdict; never derived from report text. */
  readonly reviewDecision: ReviewDecision;
  /** Required with `changes_requested`; preserved as the rework reason. */
  readonly reviewFeedback?: string;
  /** Pre-computed discovery summary, when available. */
  readonly discovery_summary?: string;
}

export interface CoordinatorNoWork {
  readonly outcome: "no-work";
  readonly reason: string;
}

export interface CoordinatorConflict {
  readonly outcome: "conflict";
  readonly ticket_id: string;
  readonly state: WorkflowState;
  readonly reason: string;
}

export interface CoordinatorCompleted {
  readonly outcome: "completed";
  readonly ticket_id: string;
  readonly final_state: "technical_approval" | "changes_requested";
  readonly transitions: readonly CoordinatorTransition[];
  readonly implementation: ExecutionResult;
  readonly report: string;
  readonly feedback?: string;
}

export interface CoordinatorImplementerFailed {
  readonly outcome: "implementer-failed";
  readonly ticket_id: string;
  readonly final_state: "failed";
  readonly transitions: readonly CoordinatorTransition[];
  readonly error: { readonly kind: string; readonly message: string };
}

export interface CoordinatorReviewerFailed {
  readonly outcome: "reviewer-failed";
  readonly ticket_id: string;
  readonly final_state: "implementation_review";
  readonly transitions: readonly CoordinatorTransition[];
  readonly error: { readonly kind: string; readonly message: string };
}

export type CoordinatorTicketResult =
  | CoordinatorNoWork
  | CoordinatorConflict
  | CoordinatorCompleted
  | CoordinatorImplementerFailed
  | CoordinatorReviewerFailed;

function fail(what: string): never {
  throw new Error(`coordinator runtime: ${what}`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

function isTicket(value: unknown): value is CoordinatorTicket {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.title === "string" &&
    candidate.title.length > 0 &&
    typeof candidate.description === "string" &&
    candidate.description.length > 0 &&
    typeof candidate.requirements === "string" &&
    candidate.requirements.length > 0 &&
    isWorkflowState(candidate.state)
  );
}

/**
 * In-flight execution states: the states this runtime itself creates
 * and owns between calls. A ticket waiting in any other non-ready
 * state (`changes_requested`, `failed`, `blocked`, …) belongs to a
 * later flow (rework loop, retry handoff) — not to an execution in
 * progress — so it never blocks a new ticket here, and is never
 * executed as new work either. Only `ready` starts work.
 */
function isActiveState(state: WorkflowState): boolean {
  return state === "in_progress" || state === "implementation_review";
}

/**
 * Run exactly one ready ticket through Implementer and Senior
 * Reviewer. Validates everything before invoking anything;
 * verifies every edge before recording it; invokes each provider
 * at most once; never retries, never closes, never touches
 * another ticket. Unexpected provider errors (non-boundary
 * programmer errors) propagate rather than masquerading as
 * workflow failures.
 */
export async function runCoordinatorTicket(
  input: CoordinatorRuntimeInput,
): Promise<CoordinatorTicketResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a runtime input object");
  }
  if (!Array.isArray(input.tickets)) {
    fail("tickets must be an array");
  }
  for (const ticket of input.tickets) {
    if (!isTicket(ticket)) {
      fail("every ticket must carry id, title, description, requirements, and a valid state");
    }
  }
  if (!isImplementerSpecialty(input.specialty)) {
    fail(`unknown specialty ${JSON.stringify(input.specialty)}`);
  }
  const project_root = nonEmptyString(input.project_root, "project_root");
  if (!isAgentProvider(input.implementerProvider)) {
    fail("implementerProvider must satisfy the agent provider contract");
  }
  if (!isAgentProvider(input.reviewerProvider)) {
    fail("reviewerProvider must satisfy the agent provider contract");
  }
  if (typeof input.timeout_ms !== "number" || !Number.isFinite(input.timeout_ms) || input.timeout_ms <= 0) {
    fail("timeout_ms must be a positive finite number");
  }
  if (!isReviewDecision(input.reviewDecision)) {
    fail(`reviewDecision must be "approved" or "changes_requested", got ${JSON.stringify(input.reviewDecision)}`);
  }
  let feedback: string | undefined;
  if (input.reviewFeedback !== undefined) {
    if (typeof input.reviewFeedback !== "string" || input.reviewFeedback.length === 0) {
      fail("reviewFeedback must be a non-empty string");
    }
    feedback = input.reviewFeedback;
  }
  if (input.reviewDecision === "changes_requested" && feedback === undefined) {
    fail('reviewFeedback is required with reviewDecision "changes_requested"');
  }
  let discovery_summary: string | undefined;
  if (input.discovery_summary !== undefined) {
    discovery_summary = nonEmptyString(input.discovery_summary, "discovery_summary");
  }

  for (const ticket of input.tickets) {
    if (isActiveState(ticket.state)) {
      return Object.freeze({
        outcome: "conflict",
        ticket_id: ticket.id,
        state: ticket.state,
        reason: `ticket ${ticket.id} is already active in state ${ticket.state}; refusing a second concurrent ticket`,
      } as const);
    }
  }
  const selected = input.tickets.find((ticket) => ticket.state === "ready");
  if (selected === undefined) {
    return Object.freeze({
      outcome: "no-work",
      reason: `no ready tickets (${String(input.tickets.length)} tickets: 0 ready)`,
    } as const);
  }

  const transitions: CoordinatorTransition[] = [];
  const advance = (ticket: CoordinatorTicket, to: WorkflowState): void => {
    if (!isValidTransition(ticket.state, to)) {
      fail(`unsupported transition ${ticket.state} → ${to}`);
    }
    const edge: CoordinatorTransition = Object.freeze({ from: ticket.state, to });
    transitions.push(edge);
    ticket.state = to;
  };

  const implementerInput = {
    ticket: { id: selected.id, title: selected.title, description: selected.description, requirements: selected.requirements },
    specialty: input.specialty,
    project_root,
    provider: input.implementerProvider as AgentProvider<ExecutionResult>,
    timeout_ms: input.timeout_ms,
    ...(discovery_summary !== undefined ? { discovery_summary } : {}),
  };
  advance(selected, "in_progress");
  const implemented = await executeImplementerTicket(implementerInput);
  if (implemented.outcome === "failed") {
    advance(selected, "failed");
    return Object.freeze({
      outcome: "implementer-failed",
      ticket_id: selected.id,
      final_state: "failed",
      transitions: Object.freeze([...transitions]),
      error: implemented.error,
    } as const);
  }
  advance(selected, "implementation_review");

  const reviewed = await executeReviewerTicket({
    ticket: { id: selected.id, title: selected.title, description: selected.description, requirements: selected.requirements },
    implementation_result: implemented.result.text,
    project_root,
    provider: input.reviewerProvider as AgentProvider<ExecutionResult>,
    timeout_ms: input.timeout_ms,
    ...(discovery_summary !== undefined ? { discovery_summary } : {}),
  });
  if (reviewed.outcome === "failed") {
    return Object.freeze({
      outcome: "reviewer-failed",
      ticket_id: selected.id,
      final_state: "implementation_review",
      transitions: Object.freeze([...transitions]),
      error: reviewed.error,
    } as const);
  }

  if (input.reviewDecision === "approved") {
    const approval = recommendTechnicalApproval({
      ticket_id: selected.id,
      from_state: "implementation_review",
      review_clean: true,
      validation_present: true,
      report: reviewed.report,
    });
    advance(selected, approval.to_state);
    return Object.freeze({
      outcome: "completed",
      ticket_id: selected.id,
      final_state: "technical_approval",
      transitions: Object.freeze([...transitions]),
      implementation: implemented.result,
      report: reviewed.report,
    } as const);
  }
  const changes = requestChanges({
    ticket_id: selected.id,
    from_state: "implementation_review",
    reason: feedback as string,
    report: reviewed.report,
  });
  advance(selected, changes.to_state);
  return Object.freeze({
    outcome: "completed",
    ticket_id: selected.id,
    final_state: "changes_requested",
    transitions: Object.freeze([...transitions]),
    implementation: implemented.result,
    report: reviewed.report,
    feedback,
  } as const);
}
