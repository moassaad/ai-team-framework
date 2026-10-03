/**
 * Explicit Planning Approval (M23 T-010).
 *
 * The gate between planning (M23) and sprint/task generation
 * (M24): one explicit, externally supplied approval decision
 * evaluated against one canonical planning artifact. Synchronous
 * and provider-free — approval is never inferred, never generated,
 * and never read from provider output.
 *
 * Authority (from the roadmap's explicit transition Planning →
 * PM approval → TL approval → Ready for task creation): each
 * invocation records exactly one authority's decision, either the * Project Manager (business side) or the Technical Lead
 * (technical side). Coordinator, Implementer, and Senior Reviewer
 * are not planning-approval authorities. Sequencing (PM before
 * TL) belongs to future orchestration: this stateless operation
 * keeps no state between invocations and therefore cannot — and
 * does not — enforce order.
 *
 * Completeness (derived from M24's needs, presence-only): the
 * artifact must carry all three sections, because task creation
 * consumes business requirements (PM) and the technical plan
 * (TL) built on the Coordinator request. No content heuristics —
 * empty arrays are acceptable; only section presence is gated.
 *
 * Questions (extending the T-007/T-008 not-ready convention):
 * an `approved` decision over an artifact with unresolved
 * questions is rejected — planning that declared itself not
 * ready cannot be approved ready. `changes-required` is always
 * acceptable and never replans, corrects, or re-enters anything.
 *
 * This is not R-020 final approval: different lifecycle gate
 * (pre-M24 vs end-of-execution), separate contract, no shared
 * behavior. The artifact is validated (T-009), defensively
 * copied, and carried on the frozen result unmarked — never
 * mutated, never stamped.
 */

import { PlanningArtifact, validatePlanningArtifact } from "./planning-artifact";
import { validateAgentIdentity } from "../roles/identity";

export type PlanningApprovalAuthority = "project-manager" | "technical-lead";

export type PlanningApprovalDecision = "approved" | "changes-required";

export interface PlanningApprovalRequest {
  readonly artifact: unknown;
  readonly approval: {
    readonly identity: unknown;
    readonly decision: unknown;
    readonly notes?: unknown;
  };
}

export interface PlanningApprovalApproved {
  readonly outcome: "approved";
  readonly authority: PlanningApprovalAuthority;
  readonly artifact: PlanningArtifact;
  readonly notes?: string;
}

export interface PlanningApprovalChangesRequired {
  readonly outcome: "changes-required";
  readonly authority: PlanningApprovalAuthority;
  readonly artifact: PlanningArtifact;
  readonly notes?: string;
}

export type PlanningApprovalResult = PlanningApprovalApproved | PlanningApprovalChangesRequired;

function fail(what: string): never {
  throw new Error(`planning approval: ${what}`);
}

function optionalNotes(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    fail("approval notes must be a non-empty string when supplied");
  }
  return value;
}

function openQuestions(artifact: PlanningArtifact): string[] {
  return [
    ...(artifact.coordinator?.questions ?? []),
    ...(artifact.project_manager?.questions ?? []),
    ...(artifact.technical_lead?.questions ?? []),
  ];
}

/**
 * Evaluate one explicit planning-approval decision against a
 * canonical artifact. Validates the artifact (T-009), the
 * authority identity (PM or TL only), and the decision
 * (`approved` or `changes-required`); enforces section
 * completeness and the no-approval-with-open-questions rule;
 * returns the frozen result carrying a defensive artifact copy.
 * Pure and synchronous: zero provider calls, zero persistence,
 * zero orchestration — invalid input throws, nothing is mutated.
 */
export function decidePlanningApproval(request: PlanningApprovalRequest): PlanningApprovalResult {
  if (typeof request !== "object" || request === null) {
    fail("expected a planning approval request object");
  }
  const approval = (request as { approval?: unknown }).approval;
  if (typeof approval !== "object" || approval === null) {
    fail("approval must be an object with identity, decision, and optional notes");
  }
  const identity = validateAgentIdentity((approval as { identity?: unknown }).identity);
  if (identity.role !== "project-manager" && identity.role !== "technical-lead") {
    fail(`planning approval requires the project-manager or technical-lead identity, got ${JSON.stringify(identity.role)}`);
  }
  const decision = (approval as { decision?: unknown }).decision;
  if (decision !== "approved" && decision !== "changes-required") {
    fail(`approval decision must be "approved" or "changes-required", got ${JSON.stringify(decision)}`);
  }
  const notes = optionalNotes((approval as { notes?: unknown }).notes);

  const artifact = validatePlanningArtifact((request as { artifact?: unknown }).artifact);
  const missing: string[] = [];
  if (artifact.coordinator === undefined) {
    missing.push("coordinator");
  }
  if (artifact.project_manager === undefined) {
    missing.push("project_manager");
  }
  if (artifact.technical_lead === undefined) {
    missing.push("technical_lead");
  }
  if (missing.length > 0) {
    fail(`planning artifact is not complete for approval: missing ${missing.join(", ")}`);
  }

  const questions = openQuestions(artifact);
  if (decision === "approved" && questions.length > 0) {
    fail(`cannot approve planning with ${questions.length} unresolved question(s); resolve them or record changes-required`);
  }

  if (decision === "approved") {
    return Object.freeze({
      outcome: "approved",
      authority: identity.role,
      artifact,
      ...(notes !== undefined ? { notes } : {}),
    } as const);
  }
  return Object.freeze({
    outcome: "changes-required",
    authority: identity.role,
    artifact,
    ...(notes !== undefined ? { notes } : {}),
  } as const);
}
