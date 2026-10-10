/**
 * Existing Project Workflow (M29 T-038).
 *
 * The dedicated planning workflow for a project that already
 * exists — same proven planning stages as T-037, preceded by
 * validated existing-project context that T-037 never
 * establishes:
 *
 *   project context → Discovery analysis → Coordinator
 *   Planning → PM Planning → TL Planning → PlanningArtifact
 *   → explicit PM + TL Planning Approval → Sprint/Task
 *   Decomposition → Persistence + Readback → Done
 *
 * Trusted context (no invented facts): the caller supplies
 * a `ProjectContext` validated by the discovery contract,
 * with `kind` required to be `"existing"` — a root alone
 * proves nothing, and new-project defaults never apply. The
 * read-only analysis (`generateProjectAnalysis`) inspects
 * the actual root with the existing detectors and returns a
 * frozen report carrying its own coverage metadata, so the
 * result never claims findings the detectors did not
 * establish. Analysis failure (unreadable root) stops the
 * workflow before any planning call.
 *
 * Reuse, not duplication: after discovery, the workflow
 * delegates the entire planning sequence to `runNewProject`
 * with `project_root` bound to the validated discovery root
 * — one root, no divergence between analyzed and persisted
 * state — then retags the result and attaches the discovery
 * report. No stage logic is copied; T-037 is never
 * refactored or renamed. The distinct `existing-project`
 * workflow tag keeps the two workflows distinguishable in
 * every result. No feature execution, acceptance, final
 * approval, scaffolding, delegation, CLI, or file writes
 * beyond the T-015 plan file. No project source file is
 * created, overwritten, or modified.
 */

import { AgentProvider } from "../providers/agent";
import { ExecutionResult } from "../providers/result";
import { validateProjectContext, ProjectContext } from "../discovery/contract";
import { generateProjectAnalysis, ProjectAnalysisReport } from "../discovery/report";
import {
  runNewProject,
  NewProjectChangesRequired,
  NewProjectFailed,
  NewProjectStage,
} from "./new-project-workflow";
import { PlanningArtifact } from "./planning-artifact";
import { PlanningApprovalResult } from "./planning-approval";
import { Sprint } from "./sprint-model";
import { Task } from "./task-model";
import { FullPmSection, FullTlSection, FullApprovalDecision } from "./full-path";

export interface ExistingProjectInput {
  /**
   * Validated existing-project context. `kind` must be
   * `"existing"`; a bare root without the marker is
   * rejected rather than assumed.
   */
  readonly project: unknown;
  /** Explicit project request for Coordinator Planning, preserved verbatim. */
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
  /** Injected generic provider used by every planning step, unmodified. */
  readonly provider: AgentProvider<ExecutionResult>;
  /** Per-step execution bound in milliseconds; owned by O-005 semantics. */
  readonly timeout_ms: number;
}

export type ExistingProjectStage = "discovery" | NewProjectStage;

export interface ExistingProjectCompleted {
  readonly outcome: "completed";
  readonly workflow: "existing-project";
  /** Read-only analysis of the actual project root, with coverage metadata. */
  readonly discovery: ProjectAnalysisReport;
  readonly artifact: PlanningArtifact;
  readonly pmApproval: PlanningApprovalResult;
  readonly tlApproval: PlanningApprovalResult;
  readonly sprint: Sprint;
  readonly tasks: readonly Task[];
  readonly planPath: string;
}

export interface ExistingProjectChangesRequired {
  readonly outcome: "changes-required";
  readonly workflow: "existing-project";
  readonly discovery: ProjectAnalysisReport;
  readonly stage: "planning-approval";
  readonly artifact: PlanningArtifact;
  readonly feedback?: string;
}

export interface ExistingProjectFailed {
  readonly outcome: "failed";
  readonly workflow: "existing-project";
  readonly discovery?: ProjectAnalysisReport;
  readonly stage: ExistingProjectStage;
  readonly error: { readonly kind: string; readonly message: string };
}

export type ExistingProjectResult = ExistingProjectCompleted | ExistingProjectChangesRequired | ExistingProjectFailed;

function fail(what: string): never {
  throw new Error(`existing project workflow: ${what}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run one existing-project planning workflow: validate the
 * project context (existing kind required), analyze the
 * actual root read-only, then compose the proven T-037
 * planning sequence bound to the validated root. Any
 * discovery, rejection, or failure stops the workflow with
 * a bounded result carrying the discovery report whenever
 * analysis succeeded. Caller inputs are never mutated;
 * results are frozen.
 */
export async function runExistingProject(input: ExistingProjectInput): Promise<ExistingProjectResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected an existing project input object");
  }
  let project: ProjectContext;
  try {
    project = validateProjectContext(input.project);
  } catch (error: unknown) {
    fail(`invalid project context (${errorMessage(error)})`);
  }
  if (project.kind !== "existing") {
    fail(`existing project workflow requires project kind "existing", got ${JSON.stringify(project.kind)}`);
  }

  let discovery: ProjectAnalysisReport;
  try {
    discovery = generateProjectAnalysis(project);
  } catch (error: unknown) {
    return Object.freeze({
      outcome: "failed",
      workflow: "existing-project",
      stage: "discovery",
      error: Object.freeze({ kind: "discovery-error", message: errorMessage(error) }),
    } as const);
  }

  const planned = await runNewProject({
    request: input.request,
    ...(input.objective !== undefined ? { objective: input.objective } : {}),
    ...(input.context !== undefined ? { context: input.context } : {}),
    ...(input.requirements !== undefined ? { requirements: input.requirements } : {}),
    ...(input.constraints !== undefined ? { constraints: input.constraints } : {}),
    pm: input.pm,
    tl: input.tl,
    pmApproval: input.pmApproval,
    tlApproval: input.tlApproval,
    sprint: input.sprint,
    tasks: input.tasks,
    project_root: project.root,
    provider: input.provider,
    timeout_ms: input.timeout_ms,
  });

  if (planned.outcome === "completed") {
    return Object.freeze({ ...planned, workflow: "existing-project", discovery } as const);
  }
  if (planned.outcome === "changes-required") {
    const nested = planned as NewProjectChangesRequired;
    return Object.freeze({
      outcome: "changes-required",
      workflow: "existing-project",
      discovery,
      stage: nested.stage,
      artifact: nested.artifact,
      ...(nested.feedback !== undefined ? { feedback: nested.feedback } : {}),
    } as const);
  }
  const failed = planned as NewProjectFailed;
  return Object.freeze({
    outcome: "failed",
    workflow: "existing-project",
    discovery,
    stage: failed.stage,
    error: failed.error,
  } as const);
}
