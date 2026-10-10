/**
 * Project Manager planning (M23 T-007).
 *
 * The business-planning capability, separate from PM/User Testing
 * (`runPmUserTestingReview`, untouched):
 *
 *   validated Coordinator → Project Manager handoff (+ caller-structured PM content)
 *     → validate input and Project Manager identity
 *     → build the PM-owned plan from caller-supplied content only
 *       (Pattern B, as in T-006: the provider returns opaque text;
 *       nothing is parsed, classified, or extracted — no
 *       structured-output contract exists, so none is invented)
 *     → questions present: return clarification-required with the
 *       partial plan and no TL handoff (never pretend readiness)
 *     → questions absent: build the canonical PM → TL handoff,
 *       validate it (T-004), invoke the provider once, return it
 *       with the plan and the opaque report
 *
 * Field mapping (explicit, no dumping, no merging):
 *
 * - plan requirements → handoff requirements (verbatim business meaning)
 * - plan acceptance criteria → handoff acceptance criteria (observable
 *   outcomes, never technical instructions)
 * - scope in/out + business rules → handoff context as labeled
 *   verbatim lines (the business background TL plans within; rules
 *   never enter constraints, so business meaning can never morph
 *   into a technical constraint)
 * - business constraints → handoff constraints (name-aligned;
 *   T-003 lists scope constraints among constraint kinds)
 * - unresolved questions → handoff notes (T-006 precedent: bounded
 *   non-decision extras, never answered here)
 *
 * One provider attempt, no retry, no fallback. No TL invocation,
 * no tickets, no states, no storage, no orchestration. Stateless.
 */

import { AgentHandoff } from "../roles/handoff";
import { validateAgentIdentity } from "../roles/identity";
import { validateAgentHandoff } from "../roles/handoff-validation";
import { PROJECT_MANAGER_ROLE } from "../roles/project-manager";
import { AgentProvider, isAgentProvider } from "../providers/agent";
import { ExecutionResult } from "../providers/result";
import { ProviderExecutionError, executeWithTimeout } from "../providers/execution";
import { renderRolePrompt } from "../providers/prompt";

/** Fixed next-action descriptor: the TL's own contract responsibility, commanding nothing. */
export const PM_PLANNING_NEXT_ACTION =
  "Define technical architecture and decompose the approved requirements into technical work.";

export interface PmPlanningScope {
  readonly in_scope: readonly string[];
  readonly out_of_scope: readonly string[];
}

export interface PmPlan {
  readonly requirements: readonly string[];
  readonly scope: PmPlanningScope;
  readonly acceptance_criteria: readonly string[];
  readonly business_rules: readonly string[];
  readonly business_constraints: readonly string[];
  readonly questions: readonly string[];
}

export interface PmPlanningInput {
  /** Explicit Project Manager identity; every other role is rejected. */
  readonly identity: unknown;
  /** Validated Coordinator → Project Manager handoff; never retargeted. */
  readonly coordinator_handoff: unknown;
  /** Business requirements clarified by the PM — never inferred. */
  readonly requirements?: readonly string[];
  /** In/out scope — never fabricated. */
  readonly scope?: { readonly in_scope?: readonly string[]; readonly out_of_scope?: readonly string[] };
  /** Observable business outcomes — never technical instructions. */
  readonly acceptance_criteria?: readonly string[];
  /** Business behavior — never technical constraints. */
  readonly business_rules?: readonly string[];
  /** Business limits — never inferred. */
  readonly business_constraints?: readonly string[];
  /** Unresolved business questions — never answered here. */
  readonly questions?: readonly string[];
  /** Objective for the TL handoff; defaults to the coordinator objective framed for TL planning. */
  readonly objective?: string;
  /** Target project root; becomes the provider working directory. */
  readonly project_root: string;
  /** Caller-supplied generic provider. No detection, no selection. */
  readonly provider: AgentProvider<ExecutionResult>;
  /** Execution bound in milliseconds; owned by O-005 semantics. */
  readonly timeout_ms: number;
}

export interface PmPlanningCompleted {
  readonly outcome: "completed";
  readonly role: "project-manager";
  readonly plan: PmPlan;
  readonly handoff: AgentHandoff;
  /** Provider's planning text, verbatim and opaque. Never parsed. */
  readonly report: string;
}

export interface PmPlanningClarification {
  readonly outcome: "clarification-required";
  readonly role: "project-manager";
  readonly plan: PmPlan;
  /** Provider's planning text, verbatim and opaque. Never parsed. */
  readonly report: string;
}

export interface PmPlanningFailed {
  readonly outcome: "failed";
  readonly role: "project-manager";
  readonly error: { readonly kind: string; readonly message: string };
}

export type PmPlanningResult = PmPlanningCompleted | PmPlanningClarification | PmPlanningFailed;

function fail(what: string): never {
  throw new Error(`pm planning: ${what}`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return nonEmptyString(value, field);
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
  return [
    "Project Manager planning: establish the business side of the requested feature or change.",
    "",
    `Coordinator objective: ${handoff.objective}`,
    ...(handoff.context !== undefined ? [`Coordinator context: ${handoff.context}`] : []),
    "",
    "Define requirements, scope, acceptance criteria, and business rules only. Do not invent technical architecture, tasks, or answers to open questions.",
  ].join("\n");
}

/**
 * Run one PM planning session. Validates identity (must be
 * `project-manager`) and the Coordinator handoff (must address
 * `project-manager` from `coordinator`), builds the frozen PM plan
 * from caller content only, and — when no unresolved questions
 * remain — builds the validated PM → TL handoff, invokes the
 * provider once with the PM planning prompt, and returns everything
 * frozen. Questions present means clarification-required with no TL
 * handoff. Provider failure yields one bounded `failed` outcome.
 */
export async function runPmPlanning(input: PmPlanningInput): Promise<PmPlanningResult> {
  if (typeof input !== "object" || input === null) {
    fail("expected a planning input object");
  }
  const identity = validateAgentIdentity(input.identity);
  if (identity.role !== "project-manager") {
    fail(`pm planning requires the project-manager identity, got ${JSON.stringify(identity.role)}`);
  }
  const coordinatorHandoff = validateAgentHandoff(input.coordinator_handoff);
  if (coordinatorHandoff.from !== "coordinator" || coordinatorHandoff.to !== "project-manager") {
    fail(
      `pm planning consumes a coordinator → project-manager handoff, got ${JSON.stringify(coordinatorHandoff.from)} → ${JSON.stringify(coordinatorHandoff.to)}`,
    );
  }
  const requirements = textList(input.requirements, "requirements");
  const scopeRaw = input.scope ?? {};
  if (typeof scopeRaw !== "object" || scopeRaw === null || Array.isArray(scopeRaw)) {
    fail("scope must be an object when supplied");
  }
  const inScope = textList(scopeRaw.in_scope, "scope.in_scope");
  const outOfScope = textList(scopeRaw.out_of_scope, "scope.out_of_scope");
  const acceptanceCriteria = textList(input.acceptance_criteria, "acceptance_criteria");
  const businessRules = textList(input.business_rules, "business_rules");
  const businessConstraints = textList(input.business_constraints, "business_constraints");
  const questions = textList(input.questions, "questions");
  const project_root = nonEmptyString(input.project_root, "project_root");
  if (!isAgentProvider(input.provider)) {
    fail("provider must satisfy the agent provider contract");
  }
  if (typeof input.timeout_ms !== "number" || !Number.isFinite(input.timeout_ms) || input.timeout_ms <= 0) {
    fail("timeout_ms must be a positive finite number");
  }

  const plan: PmPlan = Object.freeze({
    requirements: Object.freeze(requirements),
    scope: Object.freeze({ in_scope: Object.freeze(inScope), out_of_scope: Object.freeze(outOfScope) }),
    acceptance_criteria: Object.freeze(acceptanceCriteria),
    business_rules: Object.freeze(businessRules),
    business_constraints: Object.freeze(businessConstraints),
    questions: Object.freeze(questions),
  });

  const prompt = renderRolePrompt({
    role: PROJECT_MANAGER_ROLE,
    task: planningTaskText(coordinatorHandoff),
    project: { root: project_root },
  });
  let report: string;
  try {
    const result = await executeWithTimeout(
      input.provider,
      { prompt, project_root, role: "project-manager" },
      { timeout_ms: input.timeout_ms },
    );
    report = result.text;
  } catch (error) {
    if (error instanceof ProviderExecutionError) {
      return Object.freeze({
        outcome: "failed",
        role: "project-manager",
        error: Object.freeze({ kind: error.kind, message: error.message }),
      } as const);
    }
    throw error;
  }

  if (questions.length > 0) {
    return Object.freeze({
      outcome: "clarification-required",
      role: "project-manager",
      plan,
      report,
    } as const);
  }

  const contextLines = [
    ...inScope.map((entry) => `In scope: ${entry}`),
    ...outOfScope.map((entry) => `Out of scope: ${entry}`),
    ...businessRules.map((entry) => `Business rule: ${entry}`),
  ];
  const handoff = validateAgentHandoff({
    from: "project-manager",
    to: "technical-lead",
    objective: optionalText(input.objective, "objective") ?? `Define technical architecture and decomposition for: ${coordinatorHandoff.objective}`,
    ...(contextLines.length > 0 ? { context: contextLines.join("\n") } : {}),
    ...(requirements.length > 0 ? { requirements } : {}),
    ...(acceptanceCriteria.length > 0 ? { acceptance_criteria: acceptanceCriteria } : {}),
    ...(businessConstraints.length > 0 ? { constraints: businessConstraints } : {}),
    next_action: PM_PLANNING_NEXT_ACTION,
  });
  return Object.freeze({
    outcome: "completed",
    role: "project-manager",
    plan,
    handoff,
    report,
  } as const);
}
