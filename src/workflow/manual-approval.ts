import { FrameworkConfig } from "../config/schema";
import { getApprovalPolicy, isManualApproval } from "./approval";
import { WorkflowState } from "./states";
import { isValidTransition } from "./transitions";

/**
 * Manual approval flow (W-004).
 *
 * Pure decision handling around the specification's manual gate:
 * `pm_review` → `needs_user_input`, then user approval → `closed` or
 * user rejection → `changes_requested`. Every emitted edge is validated
 * against the W-002 transition table; nothing here mutates state,
 * persists decisions, contacts users, or implements automatic approval,
 * sprint approval, retries, or sensitive-change detection.
 */

export type ManualApprovalDecision = "approve" | "reject";

export type ManualApprovalStatus =
  | "waiting_for_user"
  | "approved"
  | "changes_requested"
  | "not_applicable"
  | "unsupported_scope";

export interface ApprovalRequest {
  ticketId: string;
  from: WorkflowState;
  to: WorkflowState;
}

export type ManualApprovalOutcome =
  | { status: "waiting_for_user"; request: ApprovalRequest; nextState: WorkflowState }
  | { status: "approved"; nextState: WorkflowState }
  | { status: "changes_requested"; nextState: WorkflowState }
  | { status: "not_applicable" }
  | { status: "unsupported_scope" };

function requireTicketId(ticketId: string): void {
  if (typeof ticketId !== "string" || ticketId.length === 0) {
    throw new Error("manual approval: expected a non-empty ticket id");
  }
}

function requireEdge(from: WorkflowState, to: WorkflowState): void {
  if (!isValidTransition(from, to)) {
    throw new Error(`manual approval: transition ${from} → ${to} is not defined`);
  }
}

/**
 * Open the manual approval gate for a ticket at `pm_review`.
 * Manual mode + ticket scope only; anything else yields an explicit
 * non-flow status instead of executing.
 */
export function startManualApproval(
  config: FrameworkConfig,
  currentState: WorkflowState,
  ticketId: string,
): ManualApprovalOutcome {
  requireTicketId(ticketId);
  if (!isManualApproval(config)) {
    return { status: "not_applicable" };
  }
  if (getApprovalPolicy(config).after !== "ticket") {
    return { status: "unsupported_scope" };
  }
  if (currentState !== "pm_review") {
    throw new Error(
      `manual approval: expected state "pm_review", got "${currentState}"`,
    );
  }
  requireEdge("pm_review", "needs_user_input");
  return {
    status: "waiting_for_user",
    request: { ticketId, from: "pm_review", to: "needs_user_input" },
    nextState: "needs_user_input",
  };
}

/**
 * Apply the communicated user decision for a ticket waiting in
 * `needs_user_input`. `approve` closes, `reject` requests changes —
 * exactly the specified edges, validated against W-002.
 */
export function handleManualApprovalDecision(
  config: FrameworkConfig,
  currentState: WorkflowState,
  decision: ManualApprovalDecision,
  ticketId: string,
): ManualApprovalOutcome {
  requireTicketId(ticketId);
  if (decision !== "approve" && decision !== "reject") {
    throw new Error(
      `manual approval: unknown decision ${JSON.stringify(decision)}; expected "approve" or "reject"`,
    );
  }
  if (!isManualApproval(config)) {
    return { status: "not_applicable" };
  }
  if (getApprovalPolicy(config).after !== "ticket") {
    return { status: "unsupported_scope" };
  }
  if (currentState !== "needs_user_input") {
    throw new Error(
      `manual approval: expected state "needs_user_input", got "${currentState}"`,
    );
  }
  if (decision === "approve") {
    requireEdge("needs_user_input", "closed");
    return { status: "approved", nextState: "closed" };
  }
  requireEdge("needs_user_input", "changes_requested");
  return { status: "changes_requested", nextState: "changes_requested" };
}
