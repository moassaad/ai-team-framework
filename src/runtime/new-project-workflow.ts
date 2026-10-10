/**
 * New Project Workflow (M29 T-037).
 *
 * The dedicated initial-planning workflow for a new software
 * project — planning and an approved, persisted Sprint/Task
 * plan, nothing more:
 *
 *   project brief → Coordinator Planning → PM Planning →
 *   TL Planning → PlanningArtifact → explicit PM + TL
 *   Planning Approval → Sprint/Task Decomposition →
 *   Persistence + Readback → Done
 *
 * Each stage composes its existing contract directly
 * (T-006/T-007/T-008 planning with canonical handoffs,
 * T-009 artifact, T-010 dual approvals, T-011/T-012/T-013
 * caller-structured decomposition, T-015 persistence).
 * Structured fields stay caller-owned and reports stay
 * opaque throughout: nothing is inferred from provider
 * text, ever. Both planning approvals must approve the same
 * complete artifact before decomposition; any rejection or
 * failure stops the workflow with a bounded result — no
 * retry, re-entry, rerouting, or recovery.
 *
 * Explicitly out of scope (later tickets own them): feature
 * implementation (no Implementer/Reviewer), PM user-testing
 * review, feature final approval, the existing-project
 * workflow (T-038), the FULL feature lifecycle (T-039),
 * checkpoints (T-043), re-entry loops (M28 contracts are
 * never applied automatically), delegation, scaffolding,
 * and CLI. The only filesystem writes are the T-015 plan
 * file under the caller project root.
 */

import { AgentProvider } from "../providers/agent";
import { ExecutionResult } from "../providers/result";
import { RoleId } from "../roles/contract";
import { runCoordinatorPlanning } from "./coordinator-planning";
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
import { persistSprintPlan, readSprintPlan } from "./task-persistence";
import { FullPmSection, FullTlSection, FullApprovalDecision } from "./full-path";

export interface NewProjectInput {
  /** Explicit project brief for Coordinator Planning, preserved verbatim. */
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
  /** Project root; also the T-015 persistence root. Must exist. */
  readonly project_root: string;
  /** Injected generic provider used by every planning step, unmodified. */
  readonly provider: AgentProvider<ExecutionResult>;
  /** Per-step execution bound in milliseconds; owned by O-005 semantics. */
  readonly timeout_ms: number;
}

export type NewProjectStage =
  | "coordinator"
  | "project-manager"
  | "technical-lead-planning"
  | "planning-approval"
  | "decomposition"
  | "persistence";

export interface NewProjectCompleted {
  readonly outcome: "completed";
  readonly workflow: "new-project";
  readonly artifact: PlanningArtifact;
  readonly pmApproval: PlanningApprovalResult;
  readonly tlApproval: PlanningApprovalResult;
  readonly sprint: Sprint;
  readonly tasks: readonly Task[];
  /** Path of the persisted plan file, as reported by T-015. */
  readonly planPath: string;
}

export interface NewProjectChangesRequired {
  readonly outcome: "changes-required";
  readonly workflow: "new-project";
  readonly stage: "planning-approval";
  readonly artifact: PlanningArtifact;
  readonly feedback?: string;
}

export interface NewProjectFailed {
  readonly outcome: "failed";
  readonly workflow: "new-project";
  readonly stage: NewProjectStage;
  readonly error: { readonly kind: string; readonly message: string };
}

export type NewProjectResult = NewProjectCompleted | NewProjectChangesRequired | NewProjectFailed;

function fail(what: string): never {
  throw new Error(`new project workflow: ${what}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failed(stage: NewProjectStage, kind: string, message: string): NewProjectFailed {
  return Object.freeze({
    outcome: "failed",
    workflow: "new-project",
    stage,
    error: Object.freeze({ kind, message }),
  } as const);
}

/**
 * Run one new-project planning workflow through stages A–G
 * in order, stopping at the first rejection or failure with
 * a bounded result. Every stage reuses its existing
 * contract; no step invents inputs, parses reports, retries,
 * persists beyond T-015, or executes a feature.
 */
export async function runNewProject(input: NewProjectInput): Promise<NewProjectResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a new project input object");
  }
  if (typeof input.request !== "string" || input.request.length === 0) {
    fail("request must be a non-empty project brief string");
  }
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
    return failed("coordinator", coordination.error.kind, coordination.error.message);
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
      return failed("project-manager", pm.error.kind, pm.error.message);
    }
    return Object.freeze({
      outcome: "changes-required",
      workflow: "new-project",
      stage: "planning-approval",
      artifact: createPlanningArtifact({}),
      feedback: "pm planning requires clarification before an artifact can be assembled",
    } as const);
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
      return failed("technical-lead-planning", tl.error.kind, tl.error.message);
    }
    return Object.freeze({
      outcome: "changes-required",
      workflow: "new-project",
      stage: "planning-approval",
      artifact: createPlanningArtifact({}),
      feedback: "technical lead planning requires clarification before an artifact can be assembled",
    } as const);
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
    return failed("planning-approval", "approval-error", errorMessage(error));
  }
  if (pmApproval.outcome !== "approved" || tlApproval.outcome !== "approved") {
    const notes = pmApproval.outcome !== "approved" ? pmApproval.notes : (tlApproval as PlanningApprovalResult & { notes?: string }).notes;
    return Object.freeze({
      outcome: "changes-required",
      workflow: "new-project",
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
    return failed("decomposition", decomposition.error.kind, decomposition.error.message);
  }

  let planPath: string;
  try {
    planPath = persistSprintPlan({ project_root, sprint: decomposition.sprint, tasks: decomposition.tasks }).path;
  } catch (error: unknown) {
    return failed("persistence", "persistence-error", errorMessage(error));
  }
  let readBack: { sprint: Sprint; tasks: readonly Task[] };
  try {
    const plan = readSprintPlan({ project_root, sprint_id: decomposition.sprint.id });
    readBack = { sprint: plan.sprint, tasks: plan.tasks };
  } catch (error: unknown) {
    return failed("persistence", "persistence-error", errorMessage(error));
  }

  return Object.freeze({
    outcome: "completed",
    workflow: "new-project",
    artifact,
    pmApproval,
    tlApproval,
    sprint: readBack.sprint,
    tasks: readBack.tasks,
    planPath,
  } as const);
}
