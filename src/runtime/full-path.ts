/**
 * FULL Work Mode Path (M27 T-029).
 *
 * The complete planning/business/technical lifecycle from the
 * T-026 contract, as a dedicated runner (T-027/T-028
 * precedent — never a general orchestrator):
 *
 *   Coordinator Planning → PM Planning → TL Planning →
 *   PlanningArtifact → explicit PM + TL Planning Approval →
 *   Sprint/Task Decomposition → Ticket Mapping →
 *   Persistence + Readback → Implementer → Senior Reviewer →
 *   explicit review decision → Technical Acceptance →
 *   PM Validation → Final Approval → Done
 *
 * Contract reuse (every step mapped before writing):
 *
 * - Handoffs flow through existing contracts untouched:
 *   Coordinator → PM into `runPmPlanning`, PM → TL into
 *   `runTechnicalLeadPlanning`. Structured planning fields
 *   stay caller-owned; reports stay opaque — nothing is
 *   inferred from report text, ever.
 * - Artifact via T-009 composition; two explicit T-010
 *   approvals (PM and TL authorities, both required
 *   approved); the TL approval feeds T-013, which accepts
 *   exactly one approval result covering the artifact.
 * - Decomposition is caller-structured (T-013); mapping is
 *   T-014; persistence/readback is T-015 under the caller
 *   project root.
 * - Execution scope is explicit caller selection (`task_id`):
 *   no fan-out, no concurrency, no arbitrary-first. Only the
 *   selected task executes; acceptance scope is its ticket.
 * - The mapped ticket starts `ready` (T-014's entry state)
 *   and advances along the canonical W-002 edges only, each
 *   validated by `isValidTransition` on FULL's own copies:
 *   ready → in_progress → implementation_review →
 *   technical_approval → pm_review → closed. No new edges,
 *   no caller mutation.
 * - Acceptance uses the role-owned gates in order, each with
 *   its explicit resolver: TL sprint review (explicit TL
 *   approval opens PM validation), PM/User Testing review
 *   (explicit PM approval opens final approval), R-020 final
 *   approval (explicit coordinator authority + resolver).
 *   Each rejection stops the invocation with a bounded
 *   result; M28 owns re-entry.
 *
 * Exclusions: no retry, fallback, alternate transport,
 * re-entry, or local re-execution; no IssueProvider/GitHub;
 * no mode-state persistence beyond T-015's plan file; no CLI.
 * Provider-neutral like FAST/STANDARD: the injected provider
 * serves every step unmodified.
 */

import { AgentProvider } from "../providers/agent";
import { ExecutionResult } from "../providers/result";
import { RoleId, ImplementerSpecialty } from "../roles/contract";
import { WorkflowState } from "../workflow/states";
import { isValidTransition } from "../workflow/transitions";
import { validateWorkMode } from "./work-mode";
import { runCoordinatorPlanning, CoordinatorPlanningCompleted } from "./coordinator-planning";
import { runPmPlanning } from "./pm-planning";
import { runTechnicalLeadPlanning } from "./tl-planning";
import {
  createPlanningArtifact,
  withCoordinatorPlanning,
  withPmPlanning,
  withTechnicalLeadPlanning,
  PlanningArtifact,
} from "./planning-artifact";
import { decidePlanningApproval, PlanningApprovalResult } from "./planning-approval";
import { runTechnicalLeadTaskDecomposition } from "./tl-decomposition";
import { Sprint } from "./sprint-model";
import { Task } from "./task-model";
import { mapTaskToTicket } from "./plan-ticket-mapper";
import { persistSprintPlan, readSprintPlan } from "./task-persistence";
import { CoordinatorTicket } from "./coordinator";
import {
  executeIndependentImplementer,
  executeIndependentSeniorReviewer,
} from "../roles/independent-execution";
import { ImplementerCompleted } from "../execution/implementer";
import { ReviewerCompleted } from "../execution/reviewer";
import {
  ReviewDecisionResolver,
  isReviewDecisionResolver,
  validateReviewDecisionResolution,
} from "./review-decision";
import {
  runTechnicalLeadReview,
  TechnicalLeadReviewResult,
  TechnicalLeadDecisionResolver,
  isTechnicalLeadDecisionResolver,
} from "./technical-lead";
import {
  runPmUserTestingReview,
  PmUserTestingReviewResult,
  PmUserTestingDecisionResolver,
  isPmUserTestingDecisionResolver,
} from "./pm-testing";
import {
  runFinalApproval,
  FinalApprovalResult,
  FinalApprovalDecisionResolver,
  isFinalApprovalDecisionResolver,
} from "./final-approval";
import { validateCoordinatorApprovalReference, CoordinatorApprovalReference } from "./roles";

export interface FullPmSection {
  readonly requirements?: readonly string[];
  readonly scope?: { readonly in_scope?: readonly string[]; readonly out_of_scope?: readonly string[] };
  readonly acceptance_criteria?: readonly string[];
  readonly business_rules?: readonly string[];
  readonly business_constraints?: readonly string[];
  readonly questions?: readonly string[];
  readonly objective?: string;
}

export interface FullTlSection {
  readonly architecture?: readonly string[];
  readonly decomposition_strategy?: readonly string[];
  readonly technical_constraints?: readonly string[];
  readonly dependencies?: readonly string[];
  readonly questions?: readonly string[];
}

export interface FullApprovalDecision {
  readonly identity: unknown;
  readonly decision: unknown;
  readonly notes?: unknown;
}

export interface FullInput {
  /** Must validate to `"full"` through the T-026 contract. */
  readonly mode: unknown;
  /** Raw user request for Coordinator Planning, preserved verbatim. */
  readonly request: string;
  readonly objective?: string;
  readonly context?: string;
  readonly requirements?: readonly string[];
  readonly constraints?: readonly string[];
  /** Caller-owned PM planning fields for T-007. */
  readonly pm: FullPmSection;
  /** Caller-owned TL planning fields for T-008. */
  readonly tl: FullTlSection;
  /** Explicit PM-authority planning decision for T-010. */
  readonly pmApproval: FullApprovalDecision;
  /** Explicit TL-authority planning decision for T-010. */
  readonly tlApproval: FullApprovalDecision;
  /** Caller-structured sprint fields for T-013 (tasks derived, never supplied). */
  readonly sprint: unknown;
  /** Caller-structured task inputs for T-013. */
  readonly tasks: unknown;
  /** Explicit selection of the one task to execute; never defaulted. */
  readonly task_id: string;
  /** Project root for all steps; also the T-015 persistence root. */
  readonly project_root: string;
  readonly specialty: ImplementerSpecialty;
  readonly discovery_summary?: string;
  /** Injected generic provider used by every step, unmodified. */
  readonly provider: AgentProvider<ExecutionResult>;
  /** Explicit review decision, invoked exactly once on review completion. */
  readonly reviewDecision: ReviewDecisionResolver;
  /** Explicit TL acceptance decision, invoked exactly once on TL review completion. */
  readonly decideTechnicalLead: TechnicalLeadDecisionResolver;
  /** Explicit PM validation decision, invoked exactly once on PM review completion. */
  readonly decidePmUserTesting: PmUserTestingDecisionResolver;
  /** Explicit coordinator authority for R-020 final approval. */
  readonly coordinator: unknown;
  /** Explicit final decision, invoked exactly once when final approval opens. */
  readonly decideFinalApproval: FinalApprovalDecisionResolver;
  /** Per-step execution bound in milliseconds; owned by O-005 semantics. */
  readonly timeout_ms: number;
}

export type FullStage =
  | "coordinator"
  | "project-manager"
  | "technical-lead-planning"
  | "planning-approval"
  | "decomposition"
  | "mapping"
  | "persistence"
  | "implementer"
  | "reviewer"
  | "review-decision"
  | "technical-acceptance"
  | "pm-validation"
  | "final-approval";

export interface FullCompleted {
  readonly outcome: "completed";
  readonly mode: "full";
  readonly ticket_id: string;
  readonly artifact: PlanningArtifact;
  readonly pmApproval: PlanningApprovalResult;
  readonly tlApproval: PlanningApprovalResult;
  readonly sprint: Sprint;
  readonly task: Task;
  readonly ticket: CoordinatorTicket;
  readonly implementation: ImplementerCompleted;
  readonly review: ReviewerCompleted;
  readonly technicalAcceptance: TechnicalLeadReviewResult;
  readonly pmValidation: PmUserTestingReviewResult;
  readonly finalApproval: FinalApprovalResult;
}

export interface FullChangesRequired {
  readonly outcome: "changes-required";
  readonly mode: "full";
  readonly ticket_id: string;
  /** The stage whose explicit rejection stopped the invocation. */
  readonly stage: "planning-approval" | "reviewer" | "technical-acceptance" | "pm-validation" | "final-approval";
  readonly artifact: PlanningArtifact;
  /** Verbatim feedback/notes from the rejecting decision, when supplied. */
  readonly feedback?: string;
}

export interface FullFailed {
  readonly outcome: "failed";
  readonly mode: "full";
  readonly ticket_id: string;
  readonly stage: FullStage;
  readonly error: { readonly kind: string; readonly message: string };
}

export type FullResult = FullCompleted | FullChangesRequired | FullFailed;

function fail(what: string): never {
  throw new Error(`full path: ${what}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failed(ticket_id: string, stage: FullStage, kind: string, message: string): FullFailed {
  return Object.freeze({
    outcome: "failed",
    mode: "full",
    ticket_id,
    stage,
    error: Object.freeze({ kind, message }),
  } as const);
}

/** Advance FULL's own ticket copy along one canonical W-002 edge. */
function advance(ticket: CoordinatorTicket, to: WorkflowState): void {
  if (!isValidTransition(ticket.state, to)) {
    fail(`unsupported transition ${ticket.state} → ${to}`);
  }
  ticket.state = to;
}

/**
 * Run one FULL composition through every lifecycle stage in
 * order, stopping at the first rejection or failure with a
 * bounded result. Every stage reuses its existing contract;
 * no step invents inputs, parses reports, retries, persists
 * beyond T-015, or executes another role implicitly.
 */
export async function runFull(input: FullInput): Promise<FullResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a full input object");
  }
  const mode = validateWorkMode(input.mode);
  if (mode !== "full") {
    fail(`runFull executes the full mode only, got ${JSON.stringify(mode)}`);
  }
  if (!isReviewDecisionResolver(input.reviewDecision)) {
    fail("reviewDecision must be a review decision resolver function");
  }
  if (!isTechnicalLeadDecisionResolver(input.decideTechnicalLead)) {
    fail("decideTechnicalLead must be a technical lead decision resolver function");
  }
  if (!isPmUserTestingDecisionResolver(input.decidePmUserTesting)) {
    fail("decidePmUserTesting must be a pm user testing decision resolver function");
  }
  if (!isFinalApprovalDecisionResolver(input.decideFinalApproval)) {
    fail("decideFinalApproval must be a final approval decision resolver function");
  }
  let coordinator: CoordinatorApprovalReference;
  try {
    coordinator = validateCoordinatorApprovalReference(input.coordinator);
  } catch (error: unknown) {
    fail(`coordinator must satisfy the coordinator approval reference contract (${errorMessage(error)})`);
  }
  const task_id = typeof input.task_id === "string" && input.task_id.length > 0 ? input.task_id : fail("task_id must be a non-empty string");
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
    return failed("", "coordinator", coordination.error.kind, coordination.error.message);
  }

  const pm = await runPmPlanning({
    identity: { role: "project-manager" as RoleId },
    coordinator_handoff: coordination.handoff,
    ...(input.pm.requirements !== undefined ? { requirements: input.pm.requirements } : {}),
    ...(input.pm.scope !== undefined ? { scope: input.pm.scope } : {}),
    ...(input.pm.acceptance_criteria !== undefined ? { acceptance_criteria: input.pm.acceptance_criteria } : {}),
    ...(input.pm.business_rules !== undefined ? { business_rules: input.pm.business_rules } : {}),
    ...(input.pm.business_constraints !== undefined ? { business_constraints: input.pm.business_constraints } : {}),
    ...(input.pm.questions !== undefined ? { questions: input.pm.questions } : {}),
    ...(input.pm.objective !== undefined ? { objective: input.pm.objective } : {}),
    project_root,
    provider,
    timeout_ms,
  });
  if (pm.outcome !== "completed") {
    if (pm.outcome === "failed") {
      return failed("", "project-manager", pm.error.kind, pm.error.message);
    }
    return {
      outcome: "changes-required",
      mode: "full",
      ticket_id: "",
      stage: "planning-approval",
      artifact: createPlanningArtifact({}),
      feedback: "pm planning requires clarification before an artifact can be assembled",
    } as const;
  }

  const tl = await runTechnicalLeadPlanning({
    identity: { role: "technical-lead" as RoleId },
    pm_handoff: pm.handoff,
    ...(input.tl.architecture !== undefined ? { architecture: input.tl.architecture } : {}),
    ...(input.tl.decomposition_strategy !== undefined ? { decomposition_strategy: input.tl.decomposition_strategy } : {}),
    ...(input.tl.technical_constraints !== undefined ? { technical_constraints: input.tl.technical_constraints } : {}),
    ...(input.tl.dependencies !== undefined ? { dependencies: input.tl.dependencies } : {}),
    ...(input.tl.questions !== undefined ? { questions: input.tl.questions } : {}),
    project_root,
    provider,
    timeout_ms,
  });
  if (tl.outcome !== "completed") {
    if (tl.outcome === "failed") {
      return failed("", "technical-lead-planning", tl.error.kind, tl.error.message);
    }
    return {
      outcome: "changes-required",
      mode: "full",
      ticket_id: "",
      stage: "planning-approval",
      artifact: createPlanningArtifact({}),
      feedback: "technical lead planning requires clarification before an artifact can be assembled",
    } as const;
  }

  let artifact = createPlanningArtifact({});
  artifact = withCoordinatorPlanning(artifact, {
    request: input.request,
    ...(input.objective !== undefined ? { objective: input.objective } : {}),
    ...(input.context !== undefined ? { context: input.context } : {}),
    requirements: input.requirements !== undefined ? [...input.requirements] : [],
    constraints: input.constraints !== undefined ? [...input.constraints] : [],
    questions: [],
  });
  artifact = withPmPlanning(artifact, pm.plan);
  artifact = withTechnicalLeadPlanning(artifact, tl.plan);

  let pmApproval: PlanningApprovalResult;
  let tlApproval: PlanningApprovalResult;
  try {
    pmApproval = decidePlanningApproval({ artifact, approval: input.pmApproval });
    tlApproval = decidePlanningApproval({ artifact, approval: input.tlApproval });
  } catch (error: unknown) {
    return failed("", "planning-approval", "approval-error", errorMessage(error));
  }
  if (pmApproval.outcome !== "approved" || tlApproval.outcome !== "approved") {
    const notes = pmApproval.outcome !== "approved" ? pmApproval.notes : (tlApproval as PlanningApprovalResult & { notes?: string }).notes;
    return Object.freeze({
      outcome: "changes-required",
      mode: "full",
      ticket_id: "",
      stage: "planning-approval",
      artifact,
      ...(notes !== undefined ? { feedback: notes } : {}),
    } as const);
  }

  const decomposition = await runTechnicalLeadTaskDecomposition({
    identity: { role: "technical-lead" as RoleId },
    artifact,
    approval: tlApproval,
    sprint: input.sprint,
    tasks: input.tasks,
    project_root,
    provider,
    timeout_ms,
  });
  if (decomposition.outcome !== "completed") {
    return failed("", "decomposition", decomposition.error.kind, decomposition.error.message);
  }

  let selected;
  try {
    const mapped = mapTaskToTicket(
      decomposition.tasks.find((task) => task.id === task_id) ?? fail(`unknown task_id ${JSON.stringify(task_id)}`),
    );
    selected = { ...mapped };
  } catch (error: unknown) {
    return failed(task_id, "mapping", "mapping-error", errorMessage(error));
  }

  try {
    persistSprintPlan({ project_root, sprint: decomposition.sprint, tasks: decomposition.tasks });
  } catch (error: unknown) {
    return failed(task_id, "persistence", "persistence-error", errorMessage(error));
  }
  let readBack: Task[];
  try {
    const plan = readSprintPlan({ project_root, sprint_id: decomposition.sprint.id });
    readBack = [...plan.tasks];
  } catch (error: unknown) {
    return failed(task_id, "persistence", "persistence-error", errorMessage(error));
  }
  const readTask = readBack.find((task) => task.id === task_id);
  if (readTask === undefined) {
    return failed(task_id, "persistence", "persistence-error", `selected task ${JSON.stringify(task_id)} missing from readback`);
  }
  selected = { ...mapTaskToTicket(readTask) };

  try {
    advance(selected, "in_progress");
  } catch (error: unknown) {
    return failed(task_id, "implementer", "transition-error", errorMessage(error));
  }
  const implementation = await executeIndependentImplementer({
    identity: { role: "implementer" as RoleId },
    input: {
      ticket: { id: selected.id, title: selected.title, description: selected.description, requirements: selected.requirements },
      specialty: input.specialty,
      role: "implementer" as RoleId,
      project_root,
      ...(input.discovery_summary !== undefined ? { discovery_summary: input.discovery_summary } : {}),
      provider,
      timeout_ms,
    },
  });
  if (implementation.execution.outcome !== "completed") {
    return failed(task_id, "implementer", implementation.execution.error.kind, implementation.execution.error.message);
  }
  const completed: ImplementerCompleted = implementation.execution;
  try {
    advance(selected, "implementation_review");
  } catch (error: unknown) {
    return failed(task_id, "implementer", "transition-error", errorMessage(error));
  }

  const review = await executeIndependentSeniorReviewer({
    identity: { role: "senior-reviewer" as RoleId },
    input: {
      ticket: { id: selected.id, title: selected.title, description: selected.description, requirements: selected.requirements },
      implementation_result: completed.result.text,
      role: "senior-reviewer" as RoleId,
      project_root,
      provider,
      timeout_ms,
    },
  });
  if (review.execution.outcome !== "completed") {
    return failed(task_id, "reviewer", review.execution.error.kind, review.execution.error.message);
  }
  const report: ReviewerCompleted = review.execution;

  let resolution: { decision: string; feedback?: string };
  try {
    const decided = await input.reviewDecision({
      ticket_id: selected.id,
      title: selected.title,
      description: selected.description,
      requirements: selected.requirements,
      report: report.report,
    });
    resolution = validateReviewDecisionResolution(decided, selected.id) as { decision: string; feedback?: string };
  } catch (error: unknown) {
    return failed(task_id, "review-decision", "decision-error", errorMessage(error));
  }
  if (resolution.decision !== "approved") {
    try {
      advance(selected, "changes_requested");
    } catch (error: unknown) {
      return failed(task_id, "reviewer", "transition-error", errorMessage(error));
    }
    return Object.freeze({
      outcome: "changes-required",
      mode: "full",
      ticket_id: selected.id,
      stage: "reviewer",
      artifact,
      feedback: resolution.feedback as string,
    } as const);
  }
  try {
    advance(selected, "technical_approval");
  } catch (error: unknown) {
    return failed(task_id, "reviewer", "transition-error", errorMessage(error));
  }

  const technicalAcceptance = await runTechnicalLeadReview({
    tickets: [selected],
    technicalLead: { role: "technical-lead" as RoleId, provider },
    project_root,
    timeout_ms,
    decideTechnicalLead: input.decideTechnicalLead,
  });
  if (technicalAcceptance.outcome !== "approved") {
    if (technicalAcceptance.outcome === "corrections-required") {
      return Object.freeze({
        outcome: "changes-required",
        mode: "full",
        ticket_id: selected.id,
        stage: "technical-acceptance",
        artifact,
        ...(technicalAcceptance.notes !== undefined ? { feedback: technicalAcceptance.notes } : {}),
      } as const);
    }
    const detail =
      technicalAcceptance.outcome === "review-failed" || technicalAcceptance.outcome === "decision-failed" || technicalAcceptance.outcome === "evaluation-failed"
        ? technicalAcceptance.error
        : { kind: "not-ready", message: "sprint not ready for technical lead review" };
    return failed(task_id, "technical-acceptance", detail.kind, detail.message);
  }
  try {
    advance(selected, "pm_review");
  } catch (error: unknown) {
    return failed(task_id, "technical-acceptance", "transition-error", errorMessage(error));
  }

  const pmValidation = await runPmUserTestingReview({
    tickets: [selected],
    technicalLeadReview: technicalAcceptance,
    projectManager: { role: "project-manager" as RoleId, provider },
    project_root,
    timeout_ms,
    decidePmUserTesting: input.decidePmUserTesting,
  });
  if (pmValidation.outcome !== "approved") {
    if (pmValidation.outcome === "changes-required") {
      return Object.freeze({
        outcome: "changes-required",
        mode: "full",
        ticket_id: selected.id,
        stage: "pm-validation",
        artifact,
        ...(pmValidation.notes !== undefined ? { feedback: pmValidation.notes } : {}),
      } as const);
    }
    const detail =
      pmValidation.outcome === "review-failed" || pmValidation.outcome === "decision-failed"
        ? pmValidation.error
        : pmValidation.outcome === "invalid-input"
          ? pmValidation.error
          : { kind: "not-ready", message: `pm validation not ready: ${pmValidation.technicalLeadOutcome}` };
    return failed(task_id, "pm-validation", detail.kind, detail.message);
  }

  const finalApproval = await runFinalApproval({
    tickets: [selected],
    pmReview: pmValidation,
    coordinator,
    decideFinalApproval: input.decideFinalApproval,
  });
  if (finalApproval.outcome !== "approved") {
    if (finalApproval.outcome === "changes-required") {
      return Object.freeze({
        outcome: "changes-required",
        mode: "full",
        ticket_id: selected.id,
        stage: "final-approval",
        artifact,
        ...(finalApproval.notes !== undefined ? { feedback: finalApproval.notes } : {}),
      } as const);
    }
    const detail =
      finalApproval.outcome === "decision-failed" || finalApproval.outcome === "invalid-input"
        ? finalApproval.error
        : { kind: "not-ready", message: `final approval not ready: ${finalApproval.pmOutcome}` };
    return failed(task_id, "final-approval", detail.kind, detail.message);
  }
  try {
    advance(selected, "closed");
  } catch (error: unknown) {
    return failed(task_id, "final-approval", "transition-error", errorMessage(error));
  }

  return Object.freeze({
    outcome: "completed",
    mode: "full",
    ticket_id: selected.id,
    artifact,
    pmApproval,
    tlApproval,
    sprint: decomposition.sprint,
    task: readTask,
    ticket: Object.freeze({ ...selected }),
    implementation: completed,
    review: report,
    technicalAcceptance,
    pmValidation,
    finalApproval,
  } as const);
}
