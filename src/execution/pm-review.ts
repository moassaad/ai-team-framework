/**
 * Project Manager review flow (IR-005).
 *
 * Pure recommendation over the W-002 table: explicit business
 * acceptance evidence at `pm_review` becomes either recorded
 * acceptance or a validated `pm_review → changes_requested`
 * recommendation for requirement gaps. The accepted path recommends
 * no transition — W-004, W-005, and IR-006 own the manual gate,
 * automatic path, and closure. The gap path uses only the PM-owned
 * edge, verified against the table. No approval granted beyond the
 * edge itself, no state mutation, no provider involvement.
 */

import { WORKFLOW_TRANSITIONS, isValidTransition } from "../workflow/transitions";
import { WorkflowState, isWorkflowState } from "../workflow/states";

export interface PmReviewInput {
  /** Ticket under PM review. */
  readonly ticket_id: string;
  /** Current state. Must be `pm_review` for this flow. */
  readonly from_state: WorkflowState;
  /** Explicit PM business-acceptance evidence. Never inferred. */
  readonly requirements_accepted: boolean;
  /** Rationale for the verdict, required either way. */
  readonly reason: string;
  /** Review context carried as opaque data, never interpreted. */
  readonly report?: string;
}

export interface PmReviewAccepted {
  readonly outcome: "accepted";
  readonly ticket_id: string;
  /** No transition recommended; downstream flow decides next. */
  readonly next_state: null;
}

export interface PmReviewChangesRequested {
  readonly outcome: "changes_requested";
  readonly ticket_id: string;
  readonly from_state: WorkflowState;
  readonly to_state: "changes_requested";
  /** W-002 owner of the recommended edge. */
  readonly decided_by: "project-manager";
  readonly reason: string;
  readonly report?: string;
}

export type PmReviewOutcome = PmReviewAccepted | PmReviewChangesRequested;

function fail(what: string): never {
  throw new Error(`pm review: invalid input (${what})`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

/**
 * Validate raw data as PM review input and return a frozen copy.
 * Checks ticket identity, pinned source state, boolean acceptance
 * evidence, and rationale. Malformed input rejects without deciding
 * anything.
 */
export function validatePmReviewInput(data: unknown): PmReviewInput {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  const ticket_id = nonEmptyString(raw.ticket_id, "ticket_id");
  if (!isWorkflowState(raw.from_state) || raw.from_state !== "pm_review") {
    fail(`from_state must be pm_review, got ${JSON.stringify(raw.from_state)}`);
  }
  if (typeof raw.requirements_accepted !== "boolean") {
    fail("requirements_accepted must be a boolean");
  }
  const reason = nonEmptyString(raw.reason, "reason");
  const input: PmReviewInput = {
    ticket_id,
    from_state: raw.from_state,
    requirements_accepted: raw.requirements_accepted,
    reason,
  };
  if (raw.report !== undefined) {
    (input as { report?: string }).report = nonEmptyString(raw.report, "report");
  }
  return Object.freeze(input);
}

/**
 * Recommend the PM review outcome. Accepted evidence records
 * acceptance with no transition; a requirement gap recommends the
 * PM-owned `pm_review → changes_requested` edge after verifying it
 * against W-002. Deterministic, side-effect free, frozen output.
 */
export function recommendPmReview(input: PmReviewInput): PmReviewOutcome {
  const validated = validatePmReviewInput(input);
  if (validated.requirements_accepted) {
    return Object.freeze({
      outcome: "accepted",
      ticket_id: validated.ticket_id,
      next_state: null,
    } as const);
  }
  if (!isValidTransition(validated.from_state, "changes_requested")) {
    fail(`unsupported transition ${validated.from_state} → changes_requested`);
  }
  const edge = WORKFLOW_TRANSITIONS.find(
    (transition) => transition.from === validated.from_state && transition.to === "changes_requested",
  );
  if (edge === undefined || edge.owner !== "project-manager") {
    fail(`transition ${validated.from_state} → changes_requested is not project-manager owned`);
  }
  return Object.freeze({
    ticket_id: validated.ticket_id,
    from_state: validated.from_state,
    outcome: "changes_requested",
    to_state: "changes_requested",
    decided_by: "project-manager",
    reason: validated.reason,
    ...(validated.report !== undefined ? { report: validated.report } : {}),
  } as const);
}
