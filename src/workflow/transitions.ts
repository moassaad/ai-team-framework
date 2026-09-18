import { RoleId } from "../roles/contract";
import { WorkflowState } from "./states";

/**
 * Valid workflow transitions (W-002).
 *
 * Data only: the exact edges from the approved M0 workflow specification
 * (`docs/specification/workflow.md` §3), each with its responsible owner
 * and trigger text. No mutation, no execution, no guard evaluation —
 * those belong to later W-00x tickets.
 */

/**
 * The only role allowed to perform a transition. `originating_role` is
 * not a role: it transcribes the specification's "originating role"
 * owner (whichever role produced `needs_user_input`).
 */
export type TransitionOwner = RoleId | "originating_role";

export interface WorkflowTransition {
  from: WorkflowState;
  to: WorkflowState;
  owner: TransitionOwner;
  trigger: string;
}

const TRANSITIONS: WorkflowTransition[] = [
  { from: "ready", to: "in_progress", owner: "technical-lead", trigger: "Assigns ticket to an Implementer" },
  { from: "in_progress", to: "implementation_review", owner: "implementer", trigger: "Submits implementation + validation results" },
  { from: "in_progress", to: "blocked", owner: "implementer", trigger: "Cannot proceed; blocker documented" },
  { from: "in_progress", to: "needs_user_input", owner: "implementer", trigger: "Missing info or sensitive decision encountered" },
  { from: "in_progress", to: "failed", owner: "implementer", trigger: "Unresolvable failure or unsafe validation" },
  { from: "implementation_review", to: "technical_approval", owner: "technical-lead", trigger: "Reviewer found no blocking issues; TL accepts" },
  { from: "implementation_review", to: "changes_requested", owner: "technical-lead", trigger: "Valid reviewer findings require rework" },
  { from: "changes_requested", to: "in_progress", owner: "technical-lead", trigger: "Rework assigned back to Implementer" },
  { from: "technical_approval", to: "pm_review", owner: "technical-lead", trigger: "Technical acceptance passed" },
  { from: "technical_approval", to: "changes_requested", owner: "technical-lead", trigger: "Rework needed despite submission" },
  { from: "pm_review", to: "closed", owner: "project-manager", trigger: "Auto mode; or manual mode with approval already granted" },
  { from: "pm_review", to: "needs_user_input", owner: "project-manager", trigger: "Manual approval gate for this ticket" },
  { from: "pm_review", to: "changes_requested", owner: "project-manager", trigger: "Requirement/accepted-scope gap found" },
  { from: "needs_user_input", to: "in_progress", owner: "originating_role", trigger: "Answer received; implementation blocker resolved" },
  { from: "needs_user_input", to: "closed", owner: "project-manager", trigger: "At approval gate; user approved" },
  { from: "needs_user_input", to: "changes_requested", owner: "project-manager", trigger: "User rejected or changed the requirement" },
  { from: "blocked", to: "in_progress", owner: "technical-lead", trigger: "Blocker resolved" },
  { from: "blocked", to: "needs_user_input", owner: "technical-lead", trigger: "Blocker requires a user decision" },
  { from: "failed", to: "in_progress", owner: "technical-lead", trigger: "Retry ordered with explicit conditions" },
  { from: "failed", to: "cancelled", owner: "technical-lead", trigger: "Abort after user/PM confirmation" },
  // The specification's "any active state → cancelled" row: `closed` and
  // `cancelled` are terminal, so "active" enumerates to the other nine.
  { from: "ready", to: "cancelled", owner: "coordinator", trigger: "User explicitly cancels" },
  { from: "in_progress", to: "cancelled", owner: "coordinator", trigger: "User explicitly cancels" },
  { from: "implementation_review", to: "cancelled", owner: "coordinator", trigger: "User explicitly cancels" },
  { from: "technical_approval", to: "cancelled", owner: "coordinator", trigger: "User explicitly cancels" },
  { from: "pm_review", to: "cancelled", owner: "coordinator", trigger: "User explicitly cancels" },
  { from: "blocked", to: "cancelled", owner: "coordinator", trigger: "User explicitly cancels" },
  { from: "needs_user_input", to: "cancelled", owner: "coordinator", trigger: "User explicitly cancels" },
  { from: "changes_requested", to: "cancelled", owner: "coordinator", trigger: "User explicitly cancels" },
  { from: "failed", to: "cancelled", owner: "coordinator", trigger: "User explicitly cancels" },
];

export const WORKFLOW_TRANSITIONS: readonly WorkflowTransition[] =
  Object.freeze(TRANSITIONS);

/**
 * Pure read-only query over the static transition table.
 * Never mutates state, evaluates guards, or triggers actions.
 */
export function isValidTransition(from: WorkflowState, to: WorkflowState): boolean {
  return WORKFLOW_TRANSITIONS.some(
    (transition) => transition.from === from && transition.to === to,
  );
}
