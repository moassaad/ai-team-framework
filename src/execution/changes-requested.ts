/**
 * Changes-requested review loop (IR-003).
 *
 * Pure decision operations over the W-002 table: an explicit rework
 * decision becomes a validated transition recommendation, first
 * `implementation_review → changes_requested`, then
 * `changes_requested → in_progress` for the next execution. Both edges
 * are technical-lead owned per W-002, verified against the table (never
 * hardcoded alone). Reviewer reports travel as opaque context and are
 * never parsed into verdicts; provider failures never enter this layer.
 * Recommendations only — no state mutation, no execution, no sign-off.
 */

import { WORKFLOW_TRANSITIONS, isValidTransition } from "../workflow/transitions";
import { WorkflowState, isWorkflowState } from "../workflow/states";

export interface RequestChangesInput {
  /** Ticket the rework decision applies to. */
  readonly ticket_id: string;
  /** Current state. Must be `implementation_review` for this loop. */
  readonly from_state: WorkflowState;
  /** Why rework is required. Always required here. */
  readonly reason: string;
  /** Reviewer report carried as opaque context, never interpreted. */
  readonly report?: string;
}

export interface ResumeImplementationInput {
  /** Ticket returning to implementation. */
  readonly ticket_id: string;
  /** Current state. Must be `changes_requested` for this loop. */
  readonly from_state: WorkflowState;
  /** Rework note for the next execution. */
  readonly reason: string;
  /** Reviewer report carried as opaque context, never interpreted. */
  readonly report?: string;
}

export interface ReviewTransition {
  readonly ticket_id: string;
  readonly from_state: WorkflowState;
  readonly to_state: WorkflowState;
  /** W-002 owner of the recommended edge. */
  readonly decided_by: "technical-lead";
  readonly reason: string;
  readonly report?: string;
}

function fail(what: string): never {
  throw new Error(`changes-requested loop: invalid input (${what})`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

function checkEdge(from_state: WorkflowState, to_state: WorkflowState): void {
  if (!isValidTransition(from_state, to_state)) {
    fail(`unsupported transition ${from_state} → ${to_state}`);
  }
  const edge = WORKFLOW_TRANSITIONS.find(
    (transition) => transition.from === from_state && transition.to === to_state,
  );
  if (edge === undefined || edge.owner !== "technical-lead") {
    fail(`transition ${from_state} → ${to_state} is not technical-lead owned`);
  }
}

function baseInput(data: unknown): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  return data as Record<string, unknown>;
}

/**
 * Validate a request-changes decision and return a frozen copy. The
 * source state must be `implementation_review`; anything else —
 * including reviewer output alone — is rejected rather than guessed.
 */
export function validateRequestChangesInput(data: unknown): RequestChangesInput {
  const raw = baseInput(data);
  const ticket_id = nonEmptyString(raw.ticket_id, "ticket_id");
  if (!isWorkflowState(raw.from_state) || raw.from_state !== "implementation_review") {
    fail(`from_state must be implementation_review, got ${JSON.stringify(raw.from_state)}`);
  }
  const reason = nonEmptyString(raw.reason, "reason");
  const input: RequestChangesInput = { ticket_id, from_state: raw.from_state, reason };
  if (raw.report !== undefined) {
    (input as { report?: string }).report = nonEmptyString(raw.report, "report");
  }
  return Object.freeze(input);
}

/**
 * Validate a resume decision and return a frozen copy. The source
 * state must be `changes_requested`; `failed` and every other state
 * are rejected — failure recovery belongs to W-007, not this loop.
 */
export function validateResumeInput(data: unknown): ResumeImplementationInput {
  const raw = baseInput(data);
  const ticket_id = nonEmptyString(raw.ticket_id, "ticket_id");
  if (!isWorkflowState(raw.from_state) || raw.from_state !== "changes_requested") {
    fail(`from_state must be changes_requested, got ${JSON.stringify(raw.from_state)}`);
  }
  const reason = nonEmptyString(raw.reason, "reason");
  const input: ResumeImplementationInput = { ticket_id, from_state: raw.from_state, reason };
  if (raw.reason !== undefined) {
    (input as { reason?: string }).reason = nonEmptyString(raw.reason, "reason");
  }
  if (raw.report !== undefined) {
    (input as { report?: string }).report = nonEmptyString(raw.report, "report");
  }
  return Object.freeze(input);
}

/**
 * Recommend `implementation_review → changes_requested` for an explicit
 * rework decision. Pure: validates, verifies the W-002 edge and its
 * owner, returns the frozen recommendation.
 */
export function requestChanges(input: RequestChangesInput): ReviewTransition {
  const validated = validateRequestChangesInput(input);
  checkEdge(validated.from_state, "changes_requested");
  return Object.freeze({
    ticket_id: validated.ticket_id,
    from_state: validated.from_state,
    to_state: "changes_requested",
    decided_by: "technical-lead",
    reason: validated.reason,
    ...(validated.report !== undefined ? { report: validated.report } : {}),
  } as const);
}

/**
 * Recommend `changes_requested → in_progress` for the next execution.
 * Pure recommendation only: the next Implementer run is a separate
 * concern and is never started here.
 */
export function resumeImplementation(input: ResumeImplementationInput): ReviewTransition {
  const validated = validateResumeInput(input);
  checkEdge(validated.from_state, "in_progress");
  return Object.freeze({
    ticket_id: validated.ticket_id,
    from_state: validated.from_state,
    to_state: "in_progress",
    decided_by: "technical-lead",
    reason: validated.reason,
    ...(validated.report !== undefined ? { report: validated.report } : {}),
  } as const);
}
