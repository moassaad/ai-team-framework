/**
 * Framework-to-issue state mapping (G-003).
 *
 * Pure mapping from workflow states onto the provider-neutral issue
 * lifecycle (`open` for actionable work, `closed` otherwise). The
 * table is explicit and total: every workflow state maps, so no
 * fallbacks or guesses exist. No reverse mapping — several states
 * share one issue state, which cannot be inverted. No trackers, no
 * transport, no workflow changes, no synchronization.
 */

import { WorkflowState, isWorkflowState } from "../workflow/states";

export const ISSUE_STATES = ["open", "closed"] as const;
export type IssueState = (typeof ISSUE_STATES)[number];

/** True for supported provider-neutral issue states. */
export function isIssueState(value: unknown): value is IssueState {
  return value === "open" || value === "closed";
}

const TICKET_STATE_MAP: Readonly<Record<WorkflowState, IssueState>> = {
  ready: "open",
  in_progress: "open",
  implementation_review: "open",
  technical_approval: "open",
  pm_review: "open",
  needs_user_input: "open",
  changes_requested: "open",
  blocked: "open",
  failed: "open",
  closed: "closed",
  cancelled: "closed",
};

function fail(what: string): never {
  throw new Error(`issue state mapping: invalid input (${what})`);
}

/**
 * Map a framework workflow state to its provider-neutral issue state.
 * Total over all workflow states; anything else rejects. Deterministic
 * and side-effect free.
 */
export function mapTicketStateToIssueState(state: WorkflowState): IssueState {
  if (!isWorkflowState(state)) {
    fail(`unknown workflow state ${JSON.stringify(state)}`);
  }
  return TICKET_STATE_MAP[state];
}
