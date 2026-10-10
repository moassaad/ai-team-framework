/**
 * Sprint Model (M24 T-011).
 *
 * The canonical planned execution container: a bounded unit of
 * work later M24 tickets populate (T-013 decomposition), map to
 * tickets (T-014), and persist (T-015). Data contract only —
 * no generation, no persistence, no execution, no orchestration.
 *
 * Field evidence (nothing invented):
 *
 * - id: stable sprint identity. T-013 addresses sprints as
 *   "Sprint 1" and T-012 tasks carry a Sprint reference, so tasks
 *   need something stable to point at. Required, caller-supplied,
 *   never auto-generated (no generation convention exists).
 * - goal: the M24 roadmap names Goal as sprint content.
 *   Required; a sprint without a stated goal is not a plan.
 * - scope: the M24 roadmap names Scope. Uses the repository's
 *   only established scope shape (T-007/T-009 in/out), optional.
 * - tasks: the M24 roadmap names Tasks and T-013 places task IDs
 *   ("T-001") inside sprints. Represented as task-identifier
 *   strings only — references, not a Task schema. The full Task
 *   Model belongs to T-012; no task fields, validation, or
 *   status exist here.
 * - dependencies: the M24 roadmap names Dependencies; string
 *   references as in the TL plan. Optional.
 * - acceptance_criteria: the M24 roadmap names Acceptance
 *   Criteria; observable outcomes as in PM planning. Optional.
 *
 * Deliberately absent (no repository semantics): status values,
 * timebox/dates, approval fields, provider/session metadata,
 * issue-tracker fields, workflow states, planning-artifact
 * embedding. Approval stays with T-010; a future layer may
 * require an approved artifact before using sprint data without
 * putting approval state in the sprint itself.
 */

export interface SprintScope {
  readonly in_scope: readonly string[];
  readonly out_of_scope: readonly string[];
}

export interface Sprint {
  readonly id: string;
  readonly goal: string;
  readonly scope?: SprintScope;
  readonly tasks?: readonly string[];
  readonly dependencies?: readonly string[];
  readonly acceptance_criteria?: readonly string[];
}

export interface SprintInput {
  readonly id?: unknown;
  readonly goal?: unknown;
  readonly scope?: unknown;
  readonly tasks?: unknown;
  readonly dependencies?: unknown;
  readonly acceptance_criteria?: unknown;
}

function fail(what: string): never {
  throw new Error(`sprint model: ${what}`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

function textList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    fail(`${field} must be a string array when supplied`);
  }
  for (const entry of value) {
    nonEmptyString(entry, `${field} entry`);
  }
  return [...(value as string[])];
}

function checkScope(value: unknown): SprintScope | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("scope must be an object when supplied");
  }
  const raw = value as Record<string, unknown>;
  const inScope = textList(raw.in_scope, "scope.in_scope") ?? [];
  const outOfScope = textList(raw.out_of_scope, "scope.out_of_scope") ?? [];
  return Object.freeze({ in_scope: Object.freeze(inScope), out_of_scope: Object.freeze(outOfScope) });
}

/** True for values shaped like a sprint. Structural only. */
export function isSprint(value: unknown): value is Sprint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (key !== "id" && key !== "goal" && key !== "scope" && key !== "tasks" && key !== "dependencies" && key !== "acceptance_criteria") {
      return false;
    }
  }
  try {
    checkSprint(value);
    return true;
  } catch {
    return false;
  }
}

function checkSprint(input: unknown): Sprint {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a sprint input object");
  }
  for (const key of Object.keys(input)) {
    if (key !== "id" && key !== "goal" && key !== "scope" && key !== "tasks" && key !== "dependencies" && key !== "acceptance_criteria") {
      fail(`unknown sprint field ${JSON.stringify(key)}`);
    }
  }
  const sprint: {
    id: string;
    goal: string;
    scope?: SprintScope;
    tasks?: readonly string[];
    dependencies?: readonly string[];
    acceptance_criteria?: readonly string[];
  } = {
    id: nonEmptyString((input as SprintInput).id, "id"),
    goal: nonEmptyString((input as SprintInput).goal, "goal"),
  };
  const scope = checkScope((input as SprintInput).scope);
  if (scope !== undefined) {
    sprint.scope = scope;
  }
  const tasks = textList((input as SprintInput).tasks, "tasks");
  if (tasks !== undefined) {
    sprint.tasks = Object.freeze(tasks);
  }
  const dependencies = textList((input as SprintInput).dependencies, "dependencies");
  if (dependencies !== undefined) {
    sprint.dependencies = Object.freeze(dependencies);
  }
  const acceptanceCriteria = textList((input as SprintInput).acceptance_criteria, "acceptance_criteria");
  if (acceptanceCriteria !== undefined) {
    sprint.acceptance_criteria = Object.freeze(acceptanceCriteria);
  }
  return Object.freeze(sprint);
}

/**
 * Build a frozen sprint from explicit data. Validates required
 * identity and goal, optional scope/tasks/dependencies/criteria;
 * rejects unknown keys, malformed values, and empty required
 * text. Deterministic, verbatim, frozen throughout, caller input
 * never mutated or retained.
 */
export function createSprint(input: SprintInput): Sprint {
  return checkSprint(input);
}

/**
 * Validate raw data as a sprint and return a frozen defensive
 * copy. Same rules as creation; never mutates input.
 */
export function validateSprint(data: unknown): Sprint {
  if (!isSprint(data)) {
    fail("expected a valid sprint");
  }
  return checkSprint(data);
}
