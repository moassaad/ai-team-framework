/**
 * STANDARD Work Mode Path (M27 T-028).
 *
 * The coordinator-plus-technical composition from the T-026
 * contract:
 *
 *   user request → Coordinator Planning → Technical Lead review
 *     → Implementer → Senior Reviewer → terminal result
 *
 * Explicit composition semantics (every boundary documented
 * because the alternative is guessing):
 *
 * - `planning = true` is realized by genuine Coordinator
 *   Planning (`runCoordinatorPlanning`) over the user request.
 *   Its Coordinator → PM handoff is exposed on the result as
 *   provenance and never consumed: STANDARD has no PM, and
 *   retargeting it to the Technical Lead is forbidden. Reports
 *   stay opaque.
 * - The Technical Lead step is the existing evidence review
 *   (`executeIndependentTechnicalLead`) over caller-supplied
 *   evidence. The runner never merges handoff, plan, or report
 *   content into role inputs: the T-005 no-mapping rule holds
 *   at every boundary, and the TL report is never consumed
 *   structurally.
 * - Implementer and Reviewer follow the T-027 precedent
 *   exactly: caller ticket in, one independent execution each,
 *   explicit review decision once, terminal completed /
 *   changes-required / failed outcomes.
 *
 * Exclusions: no PM in any form; no TL planning (it requires
 * a PM handoff); no artifact, approval, decomposition, sprint,
 * task, mapper, persistence, or final-approval stages; no
 * retry, fallback, alternate transport, re-entry, or local
 * re-execution; no handoff is invented or retargeted. Like
 * FAST, the path is provider-neutral: the injected provider is
 * used as supplied, never selected or dispatched.
 */

import { AgentProvider } from "../providers/agent";
import { ExecutionResult } from "../providers/result";
import { RoleId, ImplementerSpecialty } from "../roles/contract";
import { validateWorkMode } from "./work-mode";
import { runCoordinatorPlanning, CoordinatorPlanningCompleted } from "./coordinator-planning";
import {
  executeIndependentTechnicalLead,
  executeIndependentImplementer,
  executeIndependentSeniorReviewer,
} from "../roles/independent-execution";
import { TechnicalLeadCompleted, TechnicalLeadTicketEvidence } from "../execution/technical-lead";
import { ImplementerCompleted } from "../execution/implementer";
import { ReviewerCompleted } from "../execution/reviewer";
import {
  ReviewDecisionResolver,
  isReviewDecisionResolver,
  validateReviewDecisionResolution,
} from "./review-decision";

export interface StandardTicket {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly requirements: string;
}

export interface StandardInput {
  /** Must validate to `"standard"` through the T-026 contract. */
  readonly mode: unknown;
  /** Raw user request for Coordinator Planning, preserved verbatim. */
  readonly request: string;
  /** Request objective; falls back to the verbatim request when absent. */
  readonly objective?: string;
  /** Known context for Coordinator Planning. */
  readonly context?: string;
  /** Explicit user requirements for Coordinator Planning. */
  readonly requirements?: readonly string[];
  /** Explicit user constraints for Coordinator Planning. */
  readonly constraints?: readonly string[];
  /** Actionable work item; the Implementer seam's existing ticket shape. */
  readonly ticket: StandardTicket;
  /**
   * Caller-built Technical Lead evidence. Supplied explicitly —
   * the runner never derives it from the handoff, plan, or
   * report — and validated by the TL seam.
   */
  readonly tlEvidence: readonly TechnicalLeadTicketEvidence[];
  /** Already-resolved canonical Implementer specialty. */
  readonly specialty: ImplementerSpecialty;
  /** Target project root for all four role executions. */
  readonly project_root: string;
  /** Pre-computed discovery summary for the Implementer step only. */
  readonly discovery_summary?: string;
  /** Injected generic provider used by all steps, unmodified. */
  readonly provider: AgentProvider<ExecutionResult>;
  /** Explicit review decision, invoked exactly once on review completion. */
  readonly reviewDecision: ReviewDecisionResolver;
  /** Per-step execution bound in milliseconds; owned by O-005 semantics. */
  readonly timeout_ms: number;
}

export interface StandardCompleted {
  readonly outcome: "completed";
  readonly mode: "standard";
  readonly ticket_id: string;
  readonly coordination: CoordinatorPlanningCompleted;
  readonly technicalLead: TechnicalLeadCompleted;
  readonly implementation: ImplementerCompleted;
  readonly review: ReviewerCompleted;
}

export interface StandardChangesRequired {
  readonly outcome: "changes-required";
  readonly mode: "standard";
  readonly ticket_id: string;
  readonly coordination: CoordinatorPlanningCompleted;
  readonly technicalLead: TechnicalLeadCompleted;
  readonly implementation: ImplementerCompleted;
  readonly review: ReviewerCompleted;
  /** Resolver-supplied feedback, verbatim. */
  readonly feedback: string;
}

export interface StandardFailed {
  readonly outcome: "failed";
  readonly mode: "standard";
  readonly ticket_id: string;
  /** Which step failed: coordinator, technical-lead, implementer, reviewer, or decision. */
  readonly stage: "coordinator" | "technical-lead" | "implementer" | "reviewer" | "decision";
  readonly error: { readonly kind: string; readonly message: string };
}

export type StandardResult = StandardCompleted | StandardChangesRequired | StandardFailed;

function fail(what: string): never {
  throw new Error(`standard path: ${what}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run one STANDARD composition: validate the mode
 * (`"standard"` only) and inputs; Coordinator Planning once,
 * stop on failure; Technical Lead evidence review once, stop
 * on failure; Implementer once, stop on failure; Senior
 * Reviewer once, stop on failure; explicit review decision
 * once. No other role, stage, retry, or side effect.
 */
export async function runStandard(input: StandardInput): Promise<StandardResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a standard input object");
  }
  const mode = validateWorkMode(input.mode);
  if (mode !== "standard") {
    fail(`runStandard executes the standard mode only, got ${JSON.stringify(mode)}`);
  }
  if (!isReviewDecisionResolver(input.reviewDecision)) {
    fail("reviewDecision must be a review decision resolver function");
  }
  const ticket = input.ticket;
  const project_root = input.project_root;
  const provider = input.provider;
  const timeout_ms = input.timeout_ms;

  const coordination = await runCoordinatorPlanning({
    identity: { role: "coordinator" as RoleId },
    request: input.request,
    ...(input.objective !== undefined ? { objective: input.objective } : {}),
    ...(input.context !== undefined ? { context: input.context } : {}),
    ...(input.requirements !== undefined ? { requirements: input.requirements } : {}),
    ...(input.constraints !== undefined ? { constraints: input.constraints } : {}),
    project_root,
    provider,
    timeout_ms,
  });
  if (coordination.outcome !== "completed") {
    return Object.freeze({
      outcome: "failed",
      mode: "standard",
      ticket_id: ticket.id,
      stage: "coordinator",
      error: Object.freeze({ ...coordination.error }),
    } as const);
  }

  const technicalLead = await executeIndependentTechnicalLead({
    identity: { role: "technical-lead" as RoleId },
    input: {
      evidence: input.tlEvidence,
      role: "technical-lead" as RoleId,
      project_root,
      provider,
      timeout_ms,
    },
  });
  if (technicalLead.execution.outcome !== "completed") {
    return Object.freeze({
      outcome: "failed",
      mode: "standard",
      ticket_id: ticket.id,
      stage: "technical-lead",
      error: Object.freeze({ ...technicalLead.execution.error }),
    } as const);
  }

  const implementation = await executeIndependentImplementer({
    identity: { role: "implementer" as RoleId },
    input: {
      ticket,
      specialty: input.specialty,
      role: "implementer" as RoleId,
      project_root,
      ...(input.discovery_summary !== undefined ? { discovery_summary: input.discovery_summary } : {}),
      provider,
      timeout_ms,
    },
  });
  if (implementation.execution.outcome !== "completed") {
    return Object.freeze({
      outcome: "failed",
      mode: "standard",
      ticket_id: ticket.id,
      stage: "implementer",
      error: Object.freeze({ ...implementation.execution.error }),
    } as const);
  }
  const completed: ImplementerCompleted = implementation.execution;

  const review = await executeIndependentSeniorReviewer({
    identity: { role: "senior-reviewer" as RoleId },
    input: {
      ticket: { id: ticket.id, title: ticket.title, description: ticket.description, requirements: ticket.requirements },
      implementation_result: completed.result.text,
      role: "senior-reviewer" as RoleId,
      project_root,
      provider,
      timeout_ms,
    },
  });
  if (review.execution.outcome !== "completed") {
    return Object.freeze({
      outcome: "failed",
      mode: "standard",
      ticket_id: ticket.id,
      stage: "reviewer",
      error: Object.freeze({ ...review.execution.error }),
    } as const);
  }
  const report: ReviewerCompleted = review.execution;

  let resolution: { decision: string; feedback?: string };
  try {
    const decided = await input.reviewDecision({
      ticket_id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      requirements: ticket.requirements,
      report: report.report,
    });
    resolution = validateReviewDecisionResolution(decided, ticket.id) as { decision: string; feedback?: string };
  } catch (error: unknown) {
    return Object.freeze({
      outcome: "failed",
      mode: "standard",
      ticket_id: ticket.id,
      stage: "decision",
      error: Object.freeze({ kind: "decision-error", message: errorMessage(error) }),
    } as const);
  }
  if (resolution.decision === "approved") {
    return Object.freeze({
      outcome: "completed",
      mode: "standard",
      ticket_id: ticket.id,
      coordination,
      technicalLead: technicalLead.execution,
      implementation: completed,
      review: report,
    } as const);
  }
  return Object.freeze({
    outcome: "changes-required",
    mode: "standard",
    ticket_id: ticket.id,
    coordination,
    technicalLead: technicalLead.execution,
    implementation: completed,
    review: report,
    feedback: resolution.feedback as string,
  } as const);
}
