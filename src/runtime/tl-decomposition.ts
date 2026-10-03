/**
 * Technical Lead Task Decomposition (M24 T-013).
 *
 * Turns an approved plan into one Sprint plus its Task list.
 * Structured-output decision (explicit, repository-grounded):
 * no validated structured AI-output contract exists — every
 * provider seam returns opaque `result.text`, and the only
 * machine-parsing sites read external tool stdout, config files, or
 * the machine-generated delegation protocol document, never AI prose.
 * Inventing a "return JSON in text" protocol here is forbidden,
 * so decomposition is explicitly caller-structured (the T-006 /
 * T-007 / T-008 Pattern B precedent): the caller supplies the
 * sprint fields and task structures, the runtime validates and
 * assembles them, and the provider is invoked once for opaque
 * considerations whose text never populates any structured
 * field. No STOP was needed: no provider-structure mechanism is
 * required by this design.
 *
 * Preconditions (all existing contracts, nothing new):
 *
 * - explicit `technical-lead` identity, validated first;
 * - canonical artifact, validated via T-009;
 * - a T-010 approval result with outcome `approved` whose
 *   artifact is deep-equal to the input artifact (compared
 *   canonically — both pass the same frozen constructors, so
 *   equal content means equal bytes). Approval for another
 *   artifact, or `changes-required`, is rejected. Question
 *   handling needs no second policy: T-010 cannot approve an
 *   artifact with open questions, so anything reaching here is
 *   question-free by construction.
 *
 * Assembly (deterministic, no invention):
 *
 * - sprint built through the T-011 constructor; `tasks` may not
 *   be caller-supplied — the runtime derives it as the task IDs
 *   in given order;
 * - each task built through the T-012 constructor; caller IDs
 *   required (no generation convention exists); duplicates
 *   rejected; a caller-supplied `task.sprint` must equal the
 *   sprint ID or be absent, in which case the runtime assigns
 *   it — the bidirectional link matches exactly by construction;
 * - at least one task required ("one or more valid Tasks");
 * - dependency strings pass through untouched (no graph engine,
 *   no cycle detection — none evidenced);
 * - the input artifact is never mutated and no business content
 *   is added, removed, or reworded by the runtime.
 *
 * One provider attempt, no retry, no fallback. No tickets,
 * issues, persistence, execution, review, orchestration, or
 * delegation. Stateless.
 */

import { validateAgentIdentity } from "../roles/identity";
import { TECHNICAL_LEAD_ROLE } from "../roles/technical-lead";
import { PlanningArtifact, validatePlanningArtifact } from "./planning-artifact";
import { PlanningApprovalResult } from "./planning-approval";
import { Sprint, createSprint } from "./sprint-model";
import { Task, createTask } from "./task-model";
import { AgentProvider, isAgentProvider } from "../providers/agent";
import { ExecutionResult } from "../providers/result";
import { ProviderExecutionError, executeWithTimeout } from "../providers/execution";
import { renderRolePrompt } from "../providers/prompt";

export interface TlTaskDecompositionInput {
  /** Explicit Technical Lead identity; every other role is rejected. */
  readonly identity: unknown;
  /** Canonical planning artifact; validated, never mutated. */
  readonly artifact: unknown;
  /** T-010 approval result: outcome approved, artifact deep-equal to the input artifact. */
  readonly approval: unknown;
  /** Sprint fields except tasks (derived by decomposition, never supplied). */
  readonly sprint: unknown;
  /** Caller-structured task inputs; IDs required, no generation. */
  readonly tasks: unknown;
  /** Target project root; becomes the provider working directory. */
  readonly project_root: string;
  /** Caller-supplied generic provider. No detection, no selection. */
  readonly provider: AgentProvider<ExecutionResult>;
  /** Execution bound in milliseconds; owned by O-005 semantics. */
  readonly timeout_ms: number;
}

export interface TlDecompositionCompleted {
  readonly outcome: "completed";
  readonly role: "technical-lead";
  readonly sprint: Sprint;
  readonly tasks: readonly Task[];
  /** Provider's decomposition considerations, verbatim and opaque. Never parsed. */
  readonly report: string;
}

export interface TlDecompositionFailed {
  readonly outcome: "failed";
  readonly role: "technical-lead";
  readonly error: { readonly kind: string; readonly message: string };
}

export type TlDecompositionResult = TlDecompositionCompleted | TlDecompositionFailed;

function fail(what: string): never {
  throw new Error(`technical lead decomposition: ${what}`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

function decompositionTaskText(artifact: PlanningArtifact): string {
  const pm = artifact.project_manager;
  const tl = artifact.technical_lead;
  const business = [
    ...(pm !== undefined && pm.requirements.length > 0 ? [`PM requirements: ${pm.requirements.join("\n")}`] : []),
    ...(pm !== undefined && pm.acceptance_criteria.length > 0
      ? [`PM acceptance criteria: ${pm.acceptance_criteria.join("\n")}`]
      : []),
    ...(pm !== undefined && pm.business_constraints.length > 0
      ? [`PM constraints: ${pm.business_constraints.join("\n")}`]
      : []),
  ];
  const technical = [
    ...(tl !== undefined && tl.architecture.length > 0 ? [`Architecture: ${tl.architecture.join("\n")}`] : []),
    ...(tl !== undefined && tl.decomposition_strategy.length > 0
      ? [`Decomposition strategy: ${tl.decomposition_strategy.join("\n")}`]
      : []),
    ...(tl !== undefined && tl.technical_constraints.length > 0
      ? [`Technical constraints: ${tl.technical_constraints.join("\n")}`]
      : []),
    ...(tl !== undefined && tl.dependencies.length > 0 ? [`Dependencies: ${tl.dependencies.join("\n")}`] : []),
  ];
  return [
    "Technical Lead task decomposition: turn the approved technical plan into a bounded sprint with actionable tasks.",
    "",
    ...business,
    ...technical,
    "",
    "Consider sequencing and boundaries. Do not invent business requirements, scope, or answers to open questions.",
  ].join("\n");
}

/**
 * Run one TL task decomposition. Validates identity (must be
 * `technical-lead`), artifact (T-009), and approval (T-010
 * approved result covering exactly this artifact); builds the
 * sprint and tasks through their canonical constructors with
 * the bidirectional link assigned by construction; invokes the
 * provider once for opaque considerations; returns the frozen
 * result. Provider failure yields one bounded `failed` outcome.
 * Never parses provider text, never touches tickets, states,
 * storage, or other roles.
 */
export async function runTechnicalLeadTaskDecomposition(
  input: TlTaskDecompositionInput,
): Promise<TlDecompositionResult> {
  if (typeof input !== "object" || input === null) {
    fail("expected a decomposition input object");
  }
  const identity = validateAgentIdentity(input.identity);
  if (identity.role !== "technical-lead") {
    fail(`task decomposition requires the technical-lead identity, got ${JSON.stringify(identity.role)}`);
  }
  const artifact = validatePlanningArtifact(input.artifact);
  const approval = input.approval as PlanningApprovalResult | null | undefined;
  if (typeof approval !== "object" || approval === null || Array.isArray(approval)) {
    fail("approval must be a planning approval result");
  }
  if (approval.outcome !== "approved") {
    fail(`decomposition requires an approved planning artifact, got ${JSON.stringify(approval.outcome)}`);
  }
  if (JSON.stringify(approval.artifact) !== JSON.stringify(artifact)) {
    fail("approval covers a different planning artifact than the input artifact");
  }
  if (typeof input.sprint !== "object" || input.sprint === null || Array.isArray(input.sprint)) {
    fail("sprint must be an object");
  }
  if ((input.sprint as Record<string, unknown>).tasks !== undefined) {
    fail("sprint.tasks is derived by decomposition and must not be supplied");
  }
  if (!Array.isArray(input.tasks) || input.tasks.length === 0) {
    fail("tasks must be a non-empty array of task inputs");
  }
  const project_root = nonEmptyString(input.project_root, "project_root");
  if (!isAgentProvider(input.provider)) {
    fail("provider must satisfy the agent provider contract");
  }
  if (typeof input.timeout_ms !== "number" || !Number.isFinite(input.timeout_ms) || input.timeout_ms <= 0) {
    fail("timeout_ms must be a positive finite number");
  }

  const sprintFields = input.sprint as Record<string, unknown>;
  const sprintId = nonEmptyString(sprintFields.id, "sprint.id");
  const seen = new Set<string>();
  const tasks: Task[] = input.tasks.map((entry) => {
    const task = createTask(entry as Parameters<typeof createTask>[0]);
    if (seen.has(task.id)) {
      fail(`duplicate task id ${JSON.stringify(task.id)}`);
    }
    seen.add(task.id);
    if (task.sprint !== undefined && task.sprint !== sprintId) {
      fail(`task ${JSON.stringify(task.id)} names sprint ${JSON.stringify(task.sprint)} instead of ${JSON.stringify(sprintId)}`);
    }
    return task.sprint === undefined ? Object.freeze({ ...task, sprint: sprintId }) : task;
  });
  const sprint = createSprint({
    ...(sprintFields as Parameters<typeof createSprint>[0]),
    tasks: tasks.map((task) => task.id),
  });

  const prompt = renderRolePrompt({
    role: TECHNICAL_LEAD_ROLE,
    task: decompositionTaskText(artifact),
    project: { root: project_root },
  });
  let report: string;
  try {
    const result = await executeWithTimeout(
      input.provider,
      { prompt, project_root, role: "technical-lead" },
      { timeout_ms: input.timeout_ms },
    );
    report = result.text;
  } catch (error) {
    if (error instanceof ProviderExecutionError) {
      return Object.freeze({
        outcome: "failed",
        role: "technical-lead",
        error: Object.freeze({ kind: error.kind, message: error.message }),
      } as const);
    }
    throw error;
  }
  return Object.freeze({
    outcome: "completed",
    role: "technical-lead",
    sprint,
    tasks: Object.freeze(tasks),
    report,
  } as const);
}
