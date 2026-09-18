import { FrameworkConfig } from "../config/schema";
import { getApprovalPolicy, isAutomaticApproval } from "./approval";
import { WorkflowState } from "./states";
import { isValidTransition } from "./transitions";

/**
 * Automatic approval flow (W-005).
 *
 * Complement of the manual flow: in automatic ticket-scoped mode a ticket
 * at `pm_review` proceeds directly to `closed` through the specified
 * W-002 edge. No user gate is entered, no decision is collected, and no
 * sprint, retry, persistence, or sensitive-change behavior exists here.
 */

export type AutomaticApprovalStatus = "approved" | "not_applicable" | "unsupported_scope";

export type AutomaticApprovalOutcome =
  | { status: "approved"; nextState: WorkflowState }
  | { status: "not_applicable" }
  | { status: "unsupported_scope" };

/**
 * Apply automatic approval for a ticket at `pm_review`.
 * Automatic mode + ticket scope only; manual mode yields
 * `not_applicable`, sprint scope yields `unsupported_scope`, and any
 * other source state fails clearly.
 */
export function startAutomaticApproval(
  config: FrameworkConfig,
  currentState: WorkflowState,
  ticketId: string,
): AutomaticApprovalOutcome {
  if (typeof ticketId !== "string" || ticketId.length === 0) {
    throw new Error("automatic approval: expected a non-empty ticket id");
  }
  if (!isAutomaticApproval(config)) {
    return { status: "not_applicable" };
  }
  if (getApprovalPolicy(config).after !== "ticket") {
    return { status: "unsupported_scope" };
  }
  if (currentState !== "pm_review") {
    throw new Error(
      `automatic approval: expected state "pm_review", got "${currentState}"`,
    );
  }
  if (!isValidTransition("pm_review", "closed")) {
    throw new Error("automatic approval: transition pm_review → closed is not defined");
  }
  return { status: "approved", nextState: "closed" };
}
