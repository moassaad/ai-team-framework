import { RoleId, isRoleId } from "../roles/contract";
import { WorkflowState } from "./states";
import { isValidTransition } from "./transitions";

/**
 * Retry and handoff rules (W-007).
 *
 * Pure, data-only handling: retry eligibility around the specified
 * `failed → in_progress` edge, and role handoff as state-free context.
 * No new transitions, no execution, no persistence, no approval behavior.
 * The specification defines no numeric retry limit ("no fixed limit in
 * 0.1.0"), so none is invented: retry requires the `failed` source and
 * explicit conditions, nothing more.
 */

export interface RetryContext {
  from: "failed";
  to: "in_progress";
  reason: string;
  conditions: string;
}

export interface HandoffContext {
  from: RoleId;
  to: RoleId;
  reason: string;
  context?: string;
}

/**
 * Role pairs with an M0-backed handoff relationship (roles.md handoff
 * fields). Anything outside this set is not a supported handoff.
 */
const SUPPORTED_HANDOFFS: Array<readonly [RoleId, RoleId]> = [
  ["coordinator", "project-manager"],
  ["coordinator", "technical-lead"],
  ["coordinator", "implementer"],
  ["coordinator", "senior-reviewer"],
  ["project-manager", "technical-lead"],
  ["technical-lead", "implementer"],
  ["implementer", "technical-lead"],
  ["implementer", "senior-reviewer"],
  ["senior-reviewer", "technical-lead"],
];

function requireNonEmpty(value: string, what: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`retry/handoff: expected a non-empty ${what}`);
  }
}

/**
 * Whether a failed execution may be retried: the source must be
 * `failed`, explicit retry conditions must be stated (the specified
 * "retry ordered with explicit conditions"), and the recovery edge
 * must exist. No counters, no limits, no hidden state.
 */
export function canRetry(currentState: WorkflowState, conditions: string): boolean {
  return (
    currentState === "failed" &&
    typeof conditions === "string" &&
    conditions.length > 0 &&
    isValidTransition("failed", "in_progress")
  );
}

/**
 * Build the retry context for a failed ticket. Fails unless `canRetry`
 * holds; the result names the exact recovery edge and carries no
 * approval, no counters, and no execution.
 */
export function createRetryContext(
  currentState: WorkflowState,
  reason: string,
  conditions: string,
): RetryContext {
  requireNonEmpty(reason, "failure reason");
  if (!canRetry(currentState, conditions)) {
    throw new Error(
      `retry/handoff: retry requires source "failed" with explicit conditions, got state "${currentState}"`,
    );
  }
  return { from: "failed", to: "in_progress", reason, conditions };
}

/** Whether the given role pair has a supported handoff relationship. */
export function canHandoff(from: RoleId, to: RoleId): boolean {
  if (!isRoleId(from) || !isRoleId(to)) {
    return false;
  }
  return SUPPORTED_HANDOFFS.some(([f, t]) => f === from && t === to);
}

/**
 * Describe a role handoff as context only: who hands work to whom, why,
 * and with what context. Never changes workflow state, routes work, or
 * carries approval. Free-form role names are rejected; only canonical
 * `RoleId` pairs from the supported set are accepted.
 */
export function createHandoff(
  from: RoleId,
  to: RoleId,
  reason: string,
  context?: string,
): HandoffContext {
  requireNonEmpty(reason, "handoff reason");
  if (!canHandoff(from, to)) {
    throw new Error(
      `retry/handoff: unsupported handoff ${JSON.stringify(from)} → ${JSON.stringify(to)}`,
    );
  }
  return context === undefined ? { from, to, reason } : { from, to, reason, context };
}
