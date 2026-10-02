/**
 * Planning Artifact Model (M23 T-009).
 *
 * The shared canonical representation of planning state across
 * Coordinator, Project Manager, and Technical Lead planning. Each
 * role owns its section; the artifact carries all three without
 * making any role depend on another role's runtime:
 *
 * - coordinator: the T-006 input shape (request plus explicitly
 *   supplied objective, context, requirements, constraints,
 *   questions). Business scope, business rules, and technical
 *   content can never appear here.
 * - project_manager: the T-007 `PmPlan` type reused verbatim —
 *   requirements, in/out scope, acceptance criteria, business
 *   rules, business constraints, questions. Architecture and
 *   technical decomposition can never appear here.
 * - technical_lead: the T-008 `TechnicalLeadPlan` type reused
 *   verbatim — architecture, decomposition strategy (descriptive
 *   prose, never task objects), technical constraints,
 *   dependencies, questions.
 *
 * `business_constraints` and `technical_constraints` stay
 * separate fields. (T-007 maps business constraints onto the
 * generic handoff `constraints` transport field for the PM → TL
 * step; that transport reading stands, and the artifact preserves
 * both natively — no prior contract changes.)
 *
 * Relation to `AgentHandoff`: the handoff is transport and
 * provenance between two roles; the artifact is the canonical
 * planning data model. Neither replaces the other, and no
 * planning concept is added to the handoff here.
 *
 * Provider reports are excluded: opaque report text never becomes
 * structured artifact content, and reports ride with their own
 * planning results, not here.
 *
 * Lifecycle is incremental: every section is optional, so a
 * Coordinator-only artifact is valid, then Coordinator + PM, then
 * all three. Absent means not yet planned — never a placeholder
 * string. Questions stay questions; the artifact carries no verdicts; it triggers no follow-up work and persists nothing. Composition (`withX` helpers) is
 * pure data copying: the supplied section is validated and
 * copied, all other sections are preserved byte-for-byte, nothing
 * is invoked, inferred, or mutated.
 */

import { PmPlan } from "./pm-planning";
import { TechnicalLeadPlan } from "./tl-planning";

export interface CoordinatorPlanningSection {
  readonly request: string;
  readonly objective?: string;
  readonly context?: string;
  readonly requirements: readonly string[];
  readonly constraints: readonly string[];
  readonly questions: readonly string[];
}

export interface PlanningArtifact {
  readonly coordinator?: CoordinatorPlanningSection;
  readonly project_manager?: PmPlan;
  readonly technical_lead?: TechnicalLeadPlan;
}

export interface PlanningArtifactInput {
  readonly coordinator?: unknown;
  readonly project_manager?: unknown;
  readonly technical_lead?: unknown;
}

function fail(what: string): never {
  throw new Error(`planning artifact: ${what}`);
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

function freezeList(entries: string[]): readonly string[] {
  return Object.freeze(entries);
}

function checkCoordinatorSection(data: unknown): CoordinatorPlanningSection {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("coordinator section must be an object when supplied");
  }
  const raw = data as Record<string, unknown>;
  const objective = optionalText(raw.objective, "coordinator.objective");
  const context = optionalText(raw.context, "coordinator.context");
  return Object.freeze({
    request: nonEmptyString(raw.request, "coordinator.request"),
    ...(objective !== undefined ? { objective } : {}),
    ...(context !== undefined ? { context } : {}),
    requirements: freezeList(textList(raw.requirements, "coordinator.requirements")),
    constraints: freezeList(textList(raw.constraints, "coordinator.constraints")),
    questions: freezeList(textList(raw.questions, "coordinator.questions")),
  });
}

function checkScopeSection(data: unknown, field: string): { in_scope: readonly string[]; out_of_scope: readonly string[] } {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail(`${field} must be an object`);
  }
  const raw = data as Record<string, unknown>;
  return {
    in_scope: freezeList(textList(raw.in_scope, `${field}.in_scope`)),
    out_of_scope: freezeList(textList(raw.out_of_scope, `${field}.out_of_scope`)),
  };
}

function checkPmSection(data: unknown): PmPlan {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("project_manager section must be an object when supplied");
  }
  const raw = data as Record<string, unknown>;
  return Object.freeze({
    requirements: freezeList(textList(raw.requirements, "project_manager.requirements")),
    scope: Object.freeze(checkScopeSection(raw.scope === undefined ? {} : raw.scope, "project_manager.scope")),
    acceptance_criteria: freezeList(textList(raw.acceptance_criteria, "project_manager.acceptance_criteria")),
    business_rules: freezeList(textList(raw.business_rules, "project_manager.business_rules")),
    business_constraints: freezeList(textList(raw.business_constraints, "project_manager.business_constraints")),
    questions: freezeList(textList(raw.questions, "project_manager.questions")),
  });
}

function checkTlSection(data: unknown): TechnicalLeadPlan {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("technical_lead section must be an object when supplied");
  }
  const raw = data as Record<string, unknown>;
  return Object.freeze({
    architecture: freezeList(textList(raw.architecture, "technical_lead.architecture")),
    decomposition_strategy: freezeList(textList(raw.decomposition_strategy, "technical_lead.decomposition_strategy")),
    technical_constraints: freezeList(textList(raw.technical_constraints, "technical_lead.technical_constraints")),
    dependencies: freezeList(textList(raw.dependencies, "technical_lead.dependencies")),
    questions: freezeList(textList(raw.questions, "technical_lead.questions")),
  });
}

/** True for values shaped like a planning artifact. Structural only. */
export function isPlanningArtifact(value: unknown): value is PlanningArtifact {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (key !== "coordinator" && key !== "project_manager" && key !== "technical_lead") {
      return false;
    }
  }
  try {
    if (raw.coordinator !== undefined) {
      checkCoordinatorSection(raw.coordinator);
    }
    if (raw.project_manager !== undefined) {
      checkPmSection(raw.project_manager);
    }
    if (raw.technical_lead !== undefined) {
      checkTlSection(raw.technical_lead);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a frozen planning artifact from explicit section data.
 * Every section is optional (absent means not yet planned);
 * supplied sections are validated and defensively copied. Rejects
 * malformed sections, unknown top-level keys, and non-object
 * input. Deterministic, verbatim, frozen throughout.
 */
export function createPlanningArtifact(input: PlanningArtifactInput): PlanningArtifact {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a planning artifact input object");
  }
  for (const key of Object.keys(input)) {
    if (key !== "coordinator" && key !== "project_manager" && key !== "technical_lead") {
      fail(`unknown artifact section ${JSON.stringify(key)}`);
    }
  }
  const artifact: {
    coordinator?: CoordinatorPlanningSection;
    project_manager?: PmPlan;
    technical_lead?: TechnicalLeadPlan;
  } = {};
  if (input.coordinator !== undefined) {
    artifact.coordinator = checkCoordinatorSection(input.coordinator);
  }
  if (input.project_manager !== undefined) {
    artifact.project_manager = checkPmSection(input.project_manager);
  }
  if (input.technical_lead !== undefined) {
    artifact.technical_lead = checkTlSection(input.technical_lead);
  }
  return Object.freeze(artifact);
}

/**
 * Validate raw data as a planning artifact and return a frozen
 * defensive copy. Same rules as creation; never mutates input.
 */
export function validatePlanningArtifact(data: unknown): PlanningArtifact {
  if (!isPlanningArtifact(data)) {
    fail("expected a valid planning artifact");
  }
  return createPlanningArtifact(data as PlanningArtifactInput);
}

function copySections(artifact: PlanningArtifact): {
  coordinator?: CoordinatorPlanningSection;
  project_manager?: PmPlan;
  technical_lead?: TechnicalLeadPlan;
} {
  const copy: {
    coordinator?: CoordinatorPlanningSection;
    project_manager?: PmPlan;
    technical_lead?: TechnicalLeadPlan;
  } = {};
  if (artifact.coordinator !== undefined) {
    copy.coordinator = createPlanningArtifact({ coordinator: artifact.coordinator }).coordinator;
  }
  if (artifact.project_manager !== undefined) {
    copy.project_manager = createPlanningArtifact({ project_manager: artifact.project_manager }).project_manager;
  }
  if (artifact.technical_lead !== undefined) {
    copy.technical_lead = createPlanningArtifact({ technical_lead: artifact.technical_lead }).technical_lead;
  }
  return copy;
}

/**
 * Compose Coordinator planning into an artifact: validate and copy
 * the supplied section, preserve every other section byte-for-byte.
 * Pure data; invokes nothing, infers nothing.
 */
export function withCoordinatorPlanning(
  artifact: PlanningArtifact,
  coordinator: unknown,
): PlanningArtifact {
  if (!isPlanningArtifact(artifact)) {
    fail("expected a valid base artifact");
  }
  const copy = copySections(artifact);
  copy.coordinator = checkCoordinatorSection(coordinator);
  return Object.freeze(copy);
}

/**
 * Compose PM planning into an artifact. Accepts a `PmPlan` (for
 * example a T-007 result's plan, completed or clarification).
 * Pure data; overwrites only the PM section.
 */
export function withPmPlanning(artifact: PlanningArtifact, projectManager: unknown): PlanningArtifact {
  if (!isPlanningArtifact(artifact)) {
    fail("expected a valid base artifact");
  }
  const copy = copySections(artifact);
  copy.project_manager = checkPmSection(projectManager);
  return Object.freeze(copy);
}

/**
 * Compose TL planning into an artifact. Accepts a
 * `TechnicalLeadPlan` (for example a T-008 result's plan).
 * Pure data; overwrites only the TL section.
 */
export function withTechnicalLeadPlanning(
  artifact: PlanningArtifact,
  technicalLead: unknown,
): PlanningArtifact {
  if (!isPlanningArtifact(artifact)) {
    fail("expected a valid base artifact");
  }
  const copy = copySections(artifact);
  copy.technical_lead = checkTlSection(technicalLead);
  return Object.freeze(copy);
}
