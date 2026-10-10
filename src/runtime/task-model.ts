/**
 * Task Model (M24 T-012).
 *
 * The canonical actionable work unit: what one implementation
 * step is, distinct from the Sprint container (T-011) and from
 * the Ticket/Issue execution objects (T-014 maps to those later).
 * Data contract only — no generation, decomposition, mapping,
 * persistence, execution, or orchestration.
 *
 * Field evidence (nothing invented):
 *
 * - id, title, description, requirements: the M24 roadmap names
 *   Task ID/Title/Description/Requirements, and every existing
 *   ticket/execution input (`CoordinatorTicket`,
 *   `ImplementerExecutionInput`, `ReviewerExecutionInput`) already
 *   requires exactly these four non-empty strings — so T-014 can
 *   map tasks onto tickets without inventing content. Required,
 *   caller-supplied, never auto-generated (T-011 principle).
 * - acceptance_criteria: the roadmap names it; observable
 *   outcomes as in PM planning. Optional — T-013 determines how
 *   planning content maps into tasks.
 * - dependencies: the roadmap names them and T-013 requires them
 *   explicit; task-identifier strings as in the TL plan, order
 *   preserved, no graph engine. Optional.
 * - specialty: the roadmap names it; one of the six canonical
 *   `ImplementerSpecialty` values, validated by the existing
 *   contract. Optional — a generic Implementer applies when no
 *   specialty is needed (project plan §3.4).
 * - sprint: the roadmap names it, establishing the bidirectional
 *   reference (Sprint holds task IDs, Task names its sprint).
 *   A sprint-identifier string, validated non-empty when
 *   supplied. Optional, so both models stay independently
 *   constructible; composition belongs to later M24 work.
 *
 * Deliberately absent (no repository semantics): lifecycle
 * status (workflow states belong to tickets, not tasks — no
 * second state machine), priority, assignee/owner roles (the
 * operating model owns responsibility, not the data object),
 * estimates, timestamps, provider/session metadata,
 * issue-tracker fields, approval/review fields. Task text uses
 * the narrowest existing vocabulary: title + description, never
 * overlapping objective/summary/goal duplicates.
 */

import { ImplementerSpecialty, isImplementerSpecialty } from "../roles/contract";

export interface Task {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly requirements: string;
  readonly acceptance_criteria?: readonly string[];
  readonly dependencies?: readonly string[];
  readonly specialty?: ImplementerSpecialty;
  readonly sprint?: string;
}

export interface TaskInput {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly requirements?: unknown;
  readonly acceptance_criteria?: unknown;
  readonly dependencies?: unknown;
  readonly specialty?: unknown;
  readonly sprint?: unknown;
}

function fail(what: string): never {
  throw new Error(`task model: ${what}`);
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

function checkTask(input: unknown): Task {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a task input object");
  }
  for (const key of Object.keys(input)) {
    if (
      key !== "id" &&
      key !== "title" &&
      key !== "description" &&
      key !== "requirements" &&
      key !== "acceptance_criteria" &&
      key !== "dependencies" &&
      key !== "specialty" &&
      key !== "sprint"
    ) {
      fail(`unknown task field ${JSON.stringify(key)}`);
    }
  }
  const raw = input as TaskInput;
  const task: {
    id: string;
    title: string;
    description: string;
    requirements: string;
    acceptance_criteria?: readonly string[];
    dependencies?: readonly string[];
    specialty?: ImplementerSpecialty;
    sprint?: string;
  } = {
    id: nonEmptyString(raw.id, "id"),
    title: nonEmptyString(raw.title, "title"),
    description: nonEmptyString(raw.description, "description"),
    requirements: nonEmptyString(raw.requirements, "requirements"),
  };
  const acceptanceCriteria = textList(raw.acceptance_criteria, "acceptance_criteria");
  if (acceptanceCriteria !== undefined) {
    task.acceptance_criteria = Object.freeze(acceptanceCriteria);
  }
  const dependencies = textList(raw.dependencies, "dependencies");
  if (dependencies !== undefined) {
    task.dependencies = Object.freeze(dependencies);
  }
  if (raw.specialty !== undefined) {
    if (!isImplementerSpecialty(raw.specialty)) {
      fail(`unknown specialty ${JSON.stringify(raw.specialty)}`);
    }
    task.specialty = raw.specialty;
  }
  const sprint = optionalText(raw.sprint, "sprint");
  if (sprint !== undefined) {
    task.sprint = sprint;
  }
  return Object.freeze(task);
}

/** True for values shaped like a task. Structural only. */
export function isTask(value: unknown): value is Task {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (
      key !== "id" &&
      key !== "title" &&
      key !== "description" &&
      key !== "requirements" &&
      key !== "acceptance_criteria" &&
      key !== "dependencies" &&
      key !== "specialty" &&
      key !== "sprint"
    ) {
      return false;
    }
  }
  try {
    checkTask(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a frozen task from explicit data. Validates the four
 * required ticket-compatible strings plus optional criteria,
 * dependencies, specialty, and sprint reference; rejects unknown
 * keys and malformed values without coercion. Deterministic,
 * verbatim, frozen throughout, caller input never mutated or
 * retained.
 */
export function createTask(input: TaskInput): Task {
  return checkTask(input);
}

/**
 * Validate raw data as a task and return a frozen defensive
 * copy. Same rules as creation; never mutates input.
 */
export function validateTask(data: unknown): Task {
  if (!isTask(data)) {
    fail("expected a valid task");
  }
  return checkTask(data);
}
