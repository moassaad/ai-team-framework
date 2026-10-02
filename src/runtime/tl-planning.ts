/**
 * Technical Lead planning (M23 T-008).
 *
 * The technical-planning capability, separate from the R-017 sprint
 * review (`executeTechnicalLeadReview`, never invoked here):
 *
 *   validated Project Manager → Technical Lead handoff (+ caller-structured TL content)
 *     → validate input and Technical Lead identity
 *     → build the frozen TL plan from caller-supplied content only
 *       (Pattern B, as in T-006/T-007: the provider returns opaque
 *       text; nothing is parsed, classified, or extracted — no
 *       structured-output contract exists, so none is invented)
 *     → questions present: clarification-required, no further artifact
 *     → questions absent: completed with the plan and opaque report
 *
 * The PM handoff is the authoritative business source: its
 * requirements, scope, acceptance criteria, rules, and constraints
 * travel verbatim into the provider context and are never
 * rewritten into a second business specification. Technical content
 * (architecture, decomposition strategy, technical constraints,
 * dependencies) comes exclusively from explicit caller input.
 * `decomposition_strategy` stays an approach description — it is
 * never converted into task IDs, sprints, issues, or tickets.
 * Those belong to M24, so T-008 emits no Implementer handoff.
 *
 * One provider attempt, no retry, no fallback. No review, no
 * correction tickets, no implementation, no orchestration, no
 * storage. Stateless.
 */

import { AgentHandoff } from "../roles/handoff";
import { validateAgentIdentity } from "../roles/identity";
import { validateAgentHandoff } from "../roles/handoff-validation";
import { TECHNICAL_LEAD_ROLE } from "../roles/technical-lead";
import { AgentProvider, isAgentProvider } from "../providers/agent";
import { ExecutionResult } from "../providers/result";
import { ProviderExecutionError, executeWithTimeout } from "../providers/execution";
import { renderRolePrompt } from "../providers/prompt";

export interface TechnicalLeadPlan {
  readonly architecture: readonly string[];
  readonly decomposition_strategy: readonly string[];
  readonly technical_constraints: readonly string[];
  readonly dependencies: readonly string[];
  readonly questions: readonly string[];
}

export interface TechnicalLeadPlanningInput {
  /** Explicit Technical Lead identity; every other role is rejected. */
  readonly identity: unknown;
  /** Validated PM → TL handoff; never retargeted, never rewritten. */
  readonly pm_handoff: unknown;
  /** Technical architecture lines — explicitly supplied, never inferred. */
  readonly architecture?: readonly string[];
  /** Decomposition approach — never converted into tasks. */
  readonly decomposition_strategy?: readonly string[];
  /** Explicit technical constraints — never inferred. */
  readonly technical_constraints?: readonly string[];
  /** Explicit technical dependencies — never inferred. */
  readonly dependencies?: readonly string[];
  /** Unresolved technical questions — never answered here. */
  readonly questions?: readonly string[];
  /** Target project root; becomes the provider working directory. */
  readonly project_root: string;
  /** Caller-supplied generic provider. No detection, no selection. */
  readonly provider: AgentProvider<ExecutionResult>;
  /** Execution bound in milliseconds; owned by O-005 semantics. */
  readonly timeout_ms: number;
}

export interface TechnicalLeadPlanningCompleted {
  readonly outcome: "completed";
  readonly role: "technical-lead";
  readonly plan: TechnicalLeadPlan;
  /** Provider's planning text, verbatim and opaque. Never parsed. */
  readonly report: string;
}

export interface TechnicalLeadPlanningClarification {
  readonly outcome: "clarification-required";
  readonly role: "technical-lead";
  readonly plan: TechnicalLeadPlan;
  /** Provider's planning text, verbatim and opaque. Never parsed. */
  readonly report: string;
}

export interface TechnicalLeadPlanningFailed {
  readonly outcome: "failed";
  readonly role: "technical-lead";
  readonly error: { readonly kind: string; readonly message: string };
}

export type TechnicalLeadPlanningResult =
  | TechnicalLeadPlanningCompleted
  | TechnicalLeadPlanningClarification
  | TechnicalLeadPlanningFailed;

function fail(what: string): never {
  throw new Error(`technical lead planning: ${what}`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

function textList(value: unknown, field: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    fail(`${field} must be a string array when supplied`);
  }
  for (const entry of value) {
    nonEmptyString(entry, `${field} entry`);
  }
  return [...(value as string[])];
}

function planningTaskText(handoff: AgentHandoff): string {
  const business = [
    `PM objective: ${handoff.objective}`,
    ...(handoff.context !== undefined ? [`PM context: ${handoff.context}`] : []),
    ...(handoff.requirements !== undefined ? [`PM requirements: ${handoff.requirements.join("\n")}`] : []),
    ...(handoff.acceptance_criteria !== undefined
      ? [`PM acceptance criteria: ${handoff.acceptance_criteria.join("\n")}`]
      : []),
    ...(handoff.constraints !== undefined ? [`PM constraints: ${handoff.constraints.join("\n")}`] : []),
    ...(handoff.notes !== undefined ? [`PM notes: ${handoff.notes}`] : []),
  ];
  return [
    "Technical Lead planning: establish the technical side of the approved business plan.",
    "",
    ...business,
    "",
    "Define architecture, constraints, dependencies, and decomposition strategy only from what is stated above plus explicit caller input. Do not invent tasks, sprints, tickets, or answers to open questions.",
  ].join("\n");
}

/**
 * Run one TL planning session. Validates identity (must be
 * `technical-lead`) and the PM handoff (must be
 * `project-manager → technical-lead`), builds the frozen TL plan
 * from caller content only, invokes the provider once with the TL
 * planning prompt, and returns the frozen result. Questions present
 * means clarification-required. Provider failure yields one bounded
 * `failed` outcome. Never reviews a sprint, never creates
 * corrections, tasks, or handoffs, never invokes another role.
 */
export async function runTechnicalLeadPlanning(
  input: TechnicalLeadPlanningInput,
): Promise<TechnicalLeadPlanningResult> {
  if (typeof input !== "object" || input === null) {
    fail("expected a planning input object");
  }
  const identity = validateAgentIdentity(input.identity);
  if (identity.role !== "technical-lead") {
    fail(`technical lead planning requires the technical-lead identity, got ${JSON.stringify(identity.role)}`);
  }
  const pmHandoff = validateAgentHandoff(input.pm_handoff);
  if (pmHandoff.from !== "project-manager" || pmHandoff.to !== "technical-lead") {
    fail(
      `technical lead planning consumes a project-manager → technical-lead handoff, got ${JSON.stringify(pmHandoff.from)} → ${JSON.stringify(pmHandoff.to)}`,
    );
  }
  const architecture = textList(input.architecture, "architecture");
  const decompositionStrategy = textList(input.decomposition_strategy, "decomposition_strategy");
  const technicalConstraints = textList(input.technical_constraints, "technical_constraints");
  const dependencies = textList(input.dependencies, "dependencies");
  const questions = textList(input.questions, "questions");
  const project_root = nonEmptyString(input.project_root, "project_root");
  if (!isAgentProvider(input.provider)) {
    fail("provider must satisfy the agent provider contract");
  }
  if (typeof input.timeout_ms !== "number" || !Number.isFinite(input.timeout_ms) || input.timeout_ms <= 0) {
    fail("timeout_ms must be a positive finite number");
  }

  const plan: TechnicalLeadPlan = Object.freeze({
    architecture: Object.freeze(architecture),
    decomposition_strategy: Object.freeze(decompositionStrategy),
    technical_constraints: Object.freeze(technicalConstraints),
    dependencies: Object.freeze(dependencies),
    questions: Object.freeze(questions),
  });

  const prompt = renderRolePrompt({
    role: TECHNICAL_LEAD_ROLE,
    task: planningTaskText(pmHandoff),
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

  if (questions.length > 0) {
    return Object.freeze({
      outcome: "clarification-required",
      role: "technical-lead",
      plan,
      report,
    } as const);
  }
  return Object.freeze({
    outcome: "completed",
    role: "technical-lead",
    plan,
    report,
  } as const);
}
