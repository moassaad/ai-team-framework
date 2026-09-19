/**
 * Technical approval flow (IR-004).
 *
 * Pure recommendation over the W-002 table: explicit clean-review
 * evidence becomes a validated `implementation_review →
 * technical_approval` recommendation. The evidence flags are supplied
 * by the caller — never parsed from report text, never synthesized —
 * and dirty evidence rejects loudly instead of approving quietly.
 * Recommendations only: no approval granted beyond the edge itself,
 * no later flow, no state mutation.
 */

import { WORKFLOW_TRANSITIONS, isValidTransition } from "../workflow/transitions";
import { WorkflowState, isWorkflowState } from "../workflow/states";

export interface TechnicalApprovalInput {
  /** Ticket the approval decision applies to. */
  readonly ticket_id: string;
  /** Current state. Must be `implementation_review` for this flow. */
  readonly from_state: WorkflowState;
  /** Explicit evidence: no outstanding reviewer changes. */
  readonly review_clean: boolean;
  /** Explicit evidence: implementation and validation results submitted. */
  readonly validation_present: boolean;
  /** Reviewer report carried as opaque context, never interpreted. */
  readonly report?: string;
}

export interface TechnicalApproval {
  readonly ticket_id: string;
  readonly from_state: WorkflowState;
  readonly to_state: "technical_approval";
  /** W-002 owner of the recommended edge. */
  readonly decided_by: "technical-lead";
  readonly report?: string;
}

function fail(what: string): never {
  throw new Error(`technical approval: invalid input (${what})`);
}

function failEvidence(missing: string[]): never {
  throw new Error(`technical approval: insufficient evidence (missing: ${missing.join(", ")})`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

function requireFlag(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    fail(`${field} must be a boolean`);
  }
  return value;
}

/**
 * Validate raw data as technical-approval input and return a frozen
 * copy. Checks ticket identity, pinned source state, and boolean
 * evidence flags. Malformed input and dirty evidence both reject —
 * the latter with an insufficient-evidence error, never an approval.
 */
export function validateTechnicalApprovalInput(data: unknown): TechnicalApprovalInput {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  const ticket_id = nonEmptyString(raw.ticket_id, "ticket_id");
  if (!isWorkflowState(raw.from_state) || raw.from_state !== "implementation_review") {
    fail(`from_state must be implementation_review, got ${JSON.stringify(raw.from_state)}`);
  }
  const review_clean = requireFlag(raw.review_clean, "review_clean");
  const validation_present = requireFlag(raw.validation_present, "validation_present");
  const input: TechnicalApprovalInput = { ticket_id, from_state: raw.from_state, review_clean, validation_present };
  if (raw.report !== undefined) {
    (input as { report?: string }).report = nonEmptyString(raw.report, "report");
  }
  return Object.freeze(input);
}

/**
 * Recommend `implementation_review → technical_approval` for explicit
 * clean evidence. Verifies the W-002 edge and its owner, then returns
 * the frozen recommendation. Dirty evidence rejects instead of
 * approving.
 */
export function recommendTechnicalApproval(input: TechnicalApprovalInput): TechnicalApproval {
  const validated = validateTechnicalApprovalInput(input);
  const missing: string[] = [];
  if (!validated.review_clean) {
    missing.push("review");
  }
  if (!validated.validation_present) {
    missing.push("validation");
  }
  if (missing.length > 0) {
    failEvidence(missing);
  }
  if (!isValidTransition(validated.from_state, "technical_approval")) {
    fail(`unsupported transition ${validated.from_state} → technical_approval`);
  }
  const edge = WORKFLOW_TRANSITIONS.find(
    (transition) => transition.from === validated.from_state && transition.to === "technical_approval",
  );
  if (edge === undefined || edge.owner !== "technical-lead") {
    fail(`transition ${validated.from_state} → technical_approval is not technical-lead owned`);
  }
  return Object.freeze({
    ticket_id: validated.ticket_id,
    from_state: validated.from_state,
    to_state: "technical_approval",
    decided_by: "technical-lead",
    ...(validated.report !== undefined ? { report: validated.report } : {}),
  } as const);
}
