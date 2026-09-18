import { FrameworkConfig } from "../config/schema";
import { isManualApproval } from "./approval";
import { WorkflowState } from "./states";
import { isValidTransition } from "./transitions";

/**
 * Ticket completion rules (W-008).
 *
 * Eligibility and evidence checks for reaching terminal `closed`.
 * Pure and read-only: this module never transitions, approves, reviews,
 * retries, persists, or mutates anything. The actual `closed` transitions
 * remain owned by the W-004 manual and W-005 automatic flows; this module
 * only determines whether the required conditions hold, using the exact
 * W-002 edges those flows consume.
 */

export interface CompletionEvidence {
  /** Required approvals granted where approval applies (via W-004/W-005 paths). */
  approvalGranted: boolean;
  /** No outstanding reviewer changes (review clean). */
  reviewClean: boolean;
  /** Implementation + validation results submitted. */
  validationPresent: boolean;
}

export type CompletionRequirement = "approval" | "review" | "validation" | "state";

export interface CompletionResult {
  complete: boolean;
  missing: CompletionRequirement[];
  nextState?: WorkflowState;
}

function requireEvidence(evidence: CompletionEvidence): void {
  for (const flag of ["approvalGranted", "reviewClean", "validationPresent"] as const) {
    if (typeof evidence[flag] !== "boolean") {
      throw new Error(
        `completion: expected CompletionEvidence with boolean flags, got ${JSON.stringify(flag)}=${JSON.stringify(evidence[flag])}`,
      );
    }
  }
}

/**
 * Determine whether a ticket may be completed. The eligible state depends
 * on the approval mode so neither flow is bypassed: manual completion is
 * possible only from `needs_user_input` (after the W-004 gate), automatic
 * completion only from `pm_review` (the W-005 path). Anything else —
 * including `closed` and `cancelled` — yields `missing: ["state"]`.
 */
export function validateCompletion(
  config: FrameworkConfig,
  currentState: WorkflowState,
  evidence: CompletionEvidence,
): CompletionResult {
  requireEvidence(evidence);
  const manual = isManualApproval(config);
  const eligibleState = manual ? "needs_user_input" : "pm_review";
  if (currentState !== eligibleState || !isValidTransition(currentState, "closed")) {
    return { complete: false, missing: ["state"] };
  }
  const missing: CompletionRequirement[] = [];
  if (manual && !evidence.approvalGranted) {
    missing.push("approval");
  }
  if (!evidence.reviewClean) {
    missing.push("review");
  }
  if (!evidence.validationPresent) {
    missing.push("validation");
  }
  if (missing.length > 0) {
    return { complete: false, missing };
  }
  return { complete: true, missing: [], nextState: "closed" };
}

/** True when `validateCompletion` reports no missing requirements. */
export function canCompleteTicket(
  config: FrameworkConfig,
  currentState: WorkflowState,
  evidence: CompletionEvidence,
): boolean {
  return validateCompletion(config, currentState, evidence).complete;
}
