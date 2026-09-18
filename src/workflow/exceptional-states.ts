import { WorkflowState } from "./states";
import { isValidTransition } from "./transitions";

/**
 * Generic exceptional states (W-006): `blocked` and `needs_user_input`.
 *
 * Pure entry/resolution handling for non-approval waiting situations.
 * Every emitted edge is validated against the W-002 transition table.
 * Approval-owned behavior stays in W-004/W-005: the generic API can
 * neither enter the approval gate (`pm_review` → `needs_user_input`)
 * nor leave it toward `closed`. Nothing here mutates state, persists
 * data, contacts users, or implements retries and handoffs.
 */

export interface BlockerInfo {
  reason: string;
  resolutionNeeded?: string;
}

export interface BlockedContext {
  kind: "blocked";
  from: WorkflowState;
  blocker: BlockerInfo;
}

export interface UserInputRequest {
  reason: string;
  requestedBy: string;
  context?: string;
  expectedResolution?: string;
}

export interface UserInputContext {
  kind: "needs_user_input";
  from: WorkflowState;
  request: UserInputRequest;
}

export interface ResolvedContext {
  kind: "resolved";
  from: "blocked" | "needs_user_input";
  to: WorkflowState;
  summary?: string;
}

export type BlockedDestination = "in_progress" | "needs_user_input";
export type UserInputDestination = "in_progress" | "changes_requested";

function requireNonEmpty(value: string, what: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`exceptional state: expected a non-empty ${what}`);
  }
}

function requireEdge(from: WorkflowState, to: WorkflowState): void {
  if (!isValidTransition(from, to)) {
    throw new Error(`exceptional state: transition ${from} → ${to} is not defined`);
  }
}

/**
 * Mark a ticket as blocked. Allowed from any state with a W-002 edge
 * into `blocked`; anything else — including terminal states — fails.
 */
export function enterBlocked(
  currentState: WorkflowState,
  blocker: BlockerInfo,
): BlockedContext {
  requireEdge(currentState, "blocked");
  requireNonEmpty(blocker.reason, "blocker reason");
  return {
    kind: "blocked",
    from: currentState,
    blocker: { ...blocker },
  };
}

/**
 * Resolve a blocked ticket toward an active state. Only the generic
 * W-002 destinations are accepted; terminal exits are not resolutions.
 */
export function resolveBlocked(
  currentState: WorkflowState,
  destination: BlockedDestination,
  summary?: string,
): ResolvedContext {
  if (currentState !== "blocked") {
    throw new Error(
      `exceptional state: expected state "blocked", got "${currentState}"`,
    );
  }
  if (destination !== "in_progress" && destination !== "needs_user_input") {
    throw new Error(
      `exceptional state: unsupported blocked resolution ${JSON.stringify(destination)}`,
    );
  }
  requireEdge("blocked", destination);
  return { kind: "resolved", from: "blocked", to: destination, summary };
}

/**
 * Mark a ticket as waiting for generic (non-approval) user input.
 * Allowed from any state with a W-002 edge into `needs_user_input`
 * except the approval gate entry: `pm_review` → `needs_user_input`
 * is owned by the W-004 manual approval flow.
 */
export function requestUserInput(
  currentState: WorkflowState,
  request: UserInputRequest,
): UserInputContext {
  if (currentState === "pm_review") {
    throw new Error(
      "exceptional state: pm_review → needs_user_input is the manual approval gate owned by W-004",
    );
  }
  requireEdge(currentState, "needs_user_input");
  requireNonEmpty(request.reason, "input reason");
  requireNonEmpty(request.requestedBy, "requesting role or stage");
  return {
    kind: "needs_user_input",
    from: currentState,
    request: { ...request },
  };
}

/**
 * Resolve generic user input toward an active state. `closed` is
 * deliberately not an accepted destination: leaving the user-input
 * state for `closed` requires the W-004 approval decision semantics
 * and is rejected here even though the edge exists in W-002.
 */
export function resolveUserInput(
  currentState: WorkflowState,
  destination: UserInputDestination,
  summary?: string,
): ResolvedContext {
  if (currentState !== "needs_user_input") {
    throw new Error(
      `exceptional state: expected state "needs_user_input", got "${currentState}"`,
    );
  }
  if (destination !== "in_progress" && destination !== "changes_requested") {
    throw new Error(
      `exceptional state: unsupported user-input resolution ${JSON.stringify(destination)}; needs_user_input → closed requires manual approval (W-004)`,
    );
  }
  requireEdge("needs_user_input", destination);
  return { kind: "resolved", from: "needs_user_input", to: destination, summary };
}
