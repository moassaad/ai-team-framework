/**
 * Task Persistence and Readback (M24 T-015).
 *
 * The persistence boundary for validated Sprint + Task planning
 * data. Synchronous, local, and passive: write the canonical
 * representation, read it back, validate it — nothing else.
 *
 * Location (evidence, not preference): the workspace contract
 * fixes `<projectRoot>/.ai-team/` subdirectories as exactly
 * roles, workflows, state, specs, plans, reviews, reports, logs
 * — "no more, no fewer" — so no new directory is invented.
 * Planning data belongs under the existing `plans/` directory;
 * `state/` stays exclusively for workflow execution state, which
 * is never mixed in here. One file per sprint:
 * `<projectRoot>/.ai-team/plans/<sprint-id>.json`.
 *
 * Format (evidence, not convenience): JSON, following the
 * machine-generated `result.json` precedent for
 * machine-written/machine-read data. Zero new dependencies.
 * The file holds exactly `{ sprint, tasks }` — the T-011 Sprint
 * plus its T-012 Tasks, because the T-015 proof list requires
 * sprint identity to survive readback. No second Task model:
 * readback validates through the canonical constructors, so
 * stored data round-trips into identical domain objects.
 *
 * Rules (all repository-derived):
 *
 * - validate first, then persist; malformed input never touches
 *   disk. Duplicate task IDs rejected (T-013 precedent); no
 *   upsert, no merge — re-persisting a sprint replaces its file
 *   wholesale, which is filesystem behavior, not update
 *   semantics.
 * - sprint/tasks cross-consistency enforced when both carry the
 *   link: a task naming a different sprint, or a sprint task
 *   list diverging from the stored task IDs, is rejected rather
 *   than stored corrupt.
 * - sprint IDs must be filename-safe (`[A-Za-z0-9._-]`,
 *   excluding `.` and `..`); a valid T-011 ID outside that set
 *   is rejected with a clear error, never mangled and never
 *   allowed to traverse paths. All storage stays under the
 *   caller's project root; the root itself must already exist
 *   and is never created here.
 * - missing files and corrupt data throw loudly (the universal
 *   repo convention: missing/invalid fails, never silent
 *   empties). No placeholder values, no coercion, no caching —
 *   every read hits the filesystem, so separate project roots
 *   can never share data.
 * - single `writeFileSync` per persist (the established write
 *   pattern; no transactional protocol exists or is required).
 *   No retries, no background writes, no network, no providers,
 *   no orchestration, no issue-tracker contact, no workflow-state contact.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Sprint, validateSprint } from "./sprint-model";
import { Task, validateTask } from "./task-model";

export const PLANS_SUBDIRECTORY = "plans";

export const SPRINT_FILENAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export interface PersistSprintPlanInput {
  readonly project_root: unknown;
  readonly sprint: unknown;
  readonly tasks: unknown;
}

export interface PersistSprintPlanResult {
  readonly path: string;
}

export interface ReadSprintPlanInput {
  readonly project_root: unknown;
  readonly sprint_id: unknown;
}

export interface SprintPlan {
  readonly sprint: Sprint;
  readonly tasks: readonly Task[];
}

function fail(what: string): never {
  throw new Error(`task persistence: ${what}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function checkProjectRoot(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    fail("project_root must be a non-empty string");
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(value);
  } catch (error: unknown) {
    fail(`project root is not accessible: ${errorMessage(error)}`);
  }
  if (!stat.isDirectory()) {
    fail("project_root must be an existing directory");
  }
  return value;
}

function checkSprintFilename(sprintId: string): string {
  if (!SPRINT_FILENAME_PATTERN.test(sprintId) || sprintId === "." || sprintId === "..") {
    fail(`sprint id ${JSON.stringify(sprintId)} is not filesystem-safe for persistence; use [A-Za-z0-9._-] without "." or ".."`);
  }
  return `${sprintId}.json`;
}

function plansDirectory(projectRoot: string): string {
  return path.join(projectRoot, ".ai-team", PLANS_SUBDIRECTORY);
}

function checkTasks(value: unknown): Task[] {
  if (!Array.isArray(value)) {
    fail("tasks must be an array");
  }
  const tasks = value.map((entry) => validateTask(entry));
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) {
      fail(`duplicate task id ${JSON.stringify(task.id)}`);
    }
    seen.add(task.id);
  }
  return tasks;
}

function checkLink(sprint: Sprint, tasks: readonly Task[]): void {
  for (const task of tasks) {
    if (task.sprint !== undefined && task.sprint !== sprint.id) {
      fail(`task ${JSON.stringify(task.id)} names sprint ${JSON.stringify(task.sprint)} instead of ${JSON.stringify(sprint.id)}`);
    }
  }
  if (sprint.tasks !== undefined) {
    const stored = tasks.map((task) => task.id);
    if (JSON.stringify(sprint.tasks) !== JSON.stringify(stored)) {
      fail("sprint task list does not match the stored task ids");
    }
  }
}

/**
 * Persist one validated sprint plan: `{ sprint, tasks }` as JSON
 * under `<projectRoot>/.ai-team/plans/<sprint-id>.json`,
 * creating the plans directory when needed. Validates the
 * sprint (T-011), every task (T-012), duplicate IDs, and the
 * sprint↔task link before writing anything; re-persisting
 * replaces the file. Returns the frozen path record. Caller
 * data is never mutated. No retries, no orchestration.
 */
export function persistSprintPlan(input: PersistSprintPlanInput): PersistSprintPlanResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a persistence input object");
  }
  const projectRoot = checkProjectRoot(input.project_root);
  const sprint = validateSprint(input.sprint);
  const tasks = checkTasks(input.tasks);
  checkLink(sprint, tasks);
  const filename = checkSprintFilename(sprint.id);
  const dir = plansDirectory(projectRoot);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error: unknown) {
    fail(`cannot create plans directory: ${errorMessage(error)}`);
  }
  const filePath = path.join(dir, filename);
  const document = JSON.stringify({ sprint, tasks }, null, 2);
  try {
    fs.writeFileSync(filePath, `${document}\n`, "utf8");
  } catch (error: unknown) {
    fail(`cannot write sprint plan: ${errorMessage(error)}`);
  }
  return Object.freeze({ path: filePath });
}

/**
 * Read one persisted sprint plan back: parse, structurally
 * validate, re-validate through the canonical T-011/T-012
 * constructors, and return the frozen `{ sprint, tasks }`.
 * Missing files and corrupt data throw loudly; nothing is
 * coerced, cached, or repaired. Every read hits the filesystem.
 */
export function readSprintPlan(input: ReadSprintPlanInput): SprintPlan {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a readback input object");
  }
  const projectRoot = checkProjectRoot(input.project_root);
  if (typeof input.sprint_id !== "string" || input.sprint_id.length === 0) {
    fail("sprint_id must be a non-empty string");
  }
  const filePath = path.join(plansDirectory(projectRoot), checkSprintFilename(input.sprint_id));
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error: unknown) {
    fail(`sprint plan ${JSON.stringify(input.sprint_id)} not found: ${errorMessage(error)}`);
  }
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (error: unknown) {
    fail(`sprint plan ${JSON.stringify(input.sprint_id)} is corrupt: ${errorMessage(error)}`);
  }
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    fail("persisted sprint plan must be an object with sprint and tasks");
  }
  const record = document as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "sprint" && key !== "tasks") {
      fail(`unsupported persisted field ${JSON.stringify(key)}`);
    }
  }
  const sprint = validateSprint(record.sprint);
  if (sprint.id !== input.sprint_id) {
    fail(`persisted sprint id ${JSON.stringify(sprint.id)} does not match requested ${JSON.stringify(input.sprint_id)}`);
  }
  if (!Array.isArray(record.tasks)) {
    fail("persisted tasks must be an array");
  }
  const tasks = record.tasks.map((entry) => validateTask(entry));
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) {
      fail(`persisted duplicate task id ${JSON.stringify(task.id)}`);
    }
    seen.add(task.id);
  }
  checkLink(sprint, tasks);
  return Object.freeze({ sprint, tasks: Object.freeze(tasks) });
}
