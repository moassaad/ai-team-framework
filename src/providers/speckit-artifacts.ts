/**
 * Spec Kit feature-artifact mapping (S-005).
 *
 * Consumes a current Spec Kit feature directory (`spec.md`, `plan.md`,
 * `tasks.md`) and produces the framework's own plan and tickets through
 * the unchanged provider-neutral P-003/P-004 layer:
 *
 * ```text
 * SpecKit adapter (this module)
 *       ↓  generic P-001 artifact
 * generic mapper (P-003)
 *       ↓  framework plan
 * generic tickets (P-004)
 *       ↓  AI Team tickets
 * ```
 *
 * Verified upstream syntax only (current `tasks-template.md`):
 * `- [ ] T001 ...` unchecked entries with `T\d+` identifiers, `[P]`
 * parallel markers, `[USn]` story labels, inline `(depends on ...)`
 * notes, `## Phase ...` headings, `[x]` completion marks. Placeholders
 * such as `TXXX` never match and never become work. HTML comment spans
 * are scaffolding, never work items, and are skipped.
 *
 * Precedence is structural, never invented: `spec.md` travels verbatim
 * first (requirements/behavior), then `plan.md` (technical
 * approach/constraints), then one `# Task <ID>` section per unchecked
 * task entry (implementation work, document order preserved,
 * dependencies and file mentions preserved verbatim as text).
 * Requirements themselves stay PM-owned caller input, as P-003
 * requires. Checked (`[x]`) entries are finished work and are
 * excluded; nothing is ever reordered, completed, or rewritten.
 *
 * Read-only and command-free: this module only reads the three feature
 * files (missing `spec.md`/`plan.md` are simply absent context;
 * missing `tasks.md` fails because there are no work items to map)
 * and never invokes Spec Kit commands, skills, or `/speckit.implement`.
 * Ticket identity stays framework-owned (`T-001`, … from P-004);
 * source IDs survive only as visible text. File-path mentions stay
 * prose in descriptions — PlanTicket has no permission fields, so no
 * blanket edit permission can be created here; the Technical Lead owns
 * final scope. `[P]` markers likewise stay text: the one-ticket-at-a-time
 * workflow is unchanged.
 */

import { join } from "node:path";
import {
  Plan,
  mapRequirementsToPlan,
} from "../planning/mapper";
import {
  PlanTicket,
  generateTicketsFromPlan,
} from "../planning/tickets";
import {
  validateSpecificationArtifact,
} from "./specification";
import {
  SpecKitFileReader,
  defaultSpecKitReadFile,
  isSpecKitNotFoundError,
} from "./speckit-detection";

/** Feature-directory artifact filenames. Always these; never caller-supplied. */
const SPEC_FILENAME = "spec.md" as const;
const PLAN_FILENAME = "plan.md" as const;
const TASKS_FILENAME = "tasks.md" as const;

/** One parsed work item: entry line plus continuations, verbatim. */
export interface SpecKitTask {
  /** Source identifier as written (e.g. `"T001"`). */
  readonly id: string;
  /** First-line remainder, or the id when the entry line carries no text. */
  readonly title: string;
  /** Most recent `## ` heading text, when the entry sits under one. */
  readonly phase: string | undefined;
  /** Entry line plus continuation lines, verbatim and in order. */
  readonly lines: readonly string[];
}

/** Feature files as loaded: context is optional, work items are required. */
export interface SpecKitFeatureFiles {
  readonly specMd: string | undefined;
  readonly planMd: string | undefined;
  readonly tasksMd: string;
}

function fail(what: string): never {
  throw new Error(`spec-kit mapping: ${what}`);
}

function nonEmptyText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  return text.length > 0 ? value : undefined;
}

function stripCommentSpans(tasksMd: string): string[] {
  const kept: string[] = [];
  let inside = false;
  for (const line of tasksMd.split("\n")) {
    if (!inside && line.includes("<!--")) {
      inside = !line.includes("-->");
      continue;
    }
    if (inside) {
      inside = !line.includes("-->");
      continue;
    }
    kept.push(line);
  }
  return kept;
}

function parseEntryLine(line: string): { id: string; rest: string; checked: boolean } | undefined {
  const match = /^(\s*)[-*] \[([ xX])\] (T\d+)\b\s?(.*)$/.exec(line);
  if (!match) {
    return undefined;
  }
  return {
    id: match[3] as string,
    rest: (match[4] ?? "").trim(),
    checked: match[2] !== " ",
  };
}

function isHeading(line: string): boolean {
  return /^#{1,6}\s+/.test(line.trim());
}

function isPhaseHeading(line: string): string | undefined {
  const match = /^##\s+(.+)$/.exec(line.trim());
  return match ? (match[1] as string).trim() : undefined;
}

function isRule(line: string): boolean {
  return /^\s*-{3,}\s*$/.test(line);
}

/**
 * Parse `tasks.md` into work items in document order. Only the verified
 * entry shape counts; everything else is context or scaffolding.
 * Checked entries are finished work: they (with their continuations)
 * are excluded so mapped tickets never redo completed items.
 */
export function parseSpecKitTasks(tasksMd: string): readonly SpecKitTask[] {
  if (typeof tasksMd !== "string") {
    fail("tasks.md content must be a string");
  }
  interface OpenEntry {
    id: string;
    rest: string;
    checked: boolean;
    phase: string | undefined;
    lines: string[];
  }
  const tasks: SpecKitTask[] = [];
  let phase: string | undefined;
  let current: OpenEntry | null = null;
  const close = (): void => {
    if (current !== null) {
      const lines = [...current.lines];
      while (lines.length > 1 && (lines[lines.length - 1] as string).trim().length === 0) {
        lines.pop();
      }
      if (!current.checked) {
        tasks.push(
          Object.freeze({
            id: current.id,
            title: current.rest.length > 0 ? current.rest : current.id,
            phase: current.phase,
            lines: Object.freeze(lines),
          }),
        );
      }
      current = null;
    }
  };
  for (const line of stripCommentSpans(tasksMd)) {
    const phaseName = isPhaseHeading(line);
    if (phaseName !== undefined) {
      close();
      phase = phaseName.length > 0 ? phaseName : undefined;
      continue;
    }
    if (isHeading(line) || isRule(line)) {
      close();
      continue;
    }
    const entry = parseEntryLine(line);
    if (entry !== undefined) {
      close();
      current = { ...entry, phase, lines: [line] };
      continue;
    }
    if (current !== null) {
      current.lines.push(line);
    }
  }
  close();
  return Object.freeze(tasks);
}

/**
 * Compose the generic grounding document: `spec.md` verbatim, then
 * `plan.md` verbatim, then one `# Task <ID>` section per parsed work
 * item. No wrapper headings are added around the verbatim artifacts,
 * so P-004 sections them on their own structure; the task headings are
 * the mapping act itself, carrying source IDs and phase provenance as
 * visible text without changing any contract.
 */
export function composeSpecKitPlanContent(files: {
  readonly specMd?: string;
  readonly planMd?: string;
  readonly tasksMd: string;
}): string {
  if (typeof files !== "object" || files === null || Array.isArray(files)) {
    fail("expected a feature-files object");
  }
  if (typeof files.tasksMd !== "string") {
    fail("tasks.md content must be a string");
  }
  const parts: string[] = [];
  const spec = nonEmptyText(files.specMd);
  if (spec !== undefined) {
    parts.push(spec.trim());
  }
  const plan = nonEmptyText(files.planMd);
  if (plan !== undefined) {
    parts.push(plan.trim());
  }
  for (const task of parseSpecKitTasks(files.tasksMd)) {
    const section = [`# Task ${task.id}: ${task.title}`];
    if (task.phase !== undefined) {
      section.push(`Phase: ${task.phase}`);
    }
    section.push(...task.lines);
    parts.push(section.join("\n"));
  }
  return parts.join("\n\n");
}

async function readOptional(
  readFile: SpecKitFileReader,
  path: string,
): Promise<string | undefined> {
  try {
    return await readFile(path);
  } catch (error: unknown) {
    if (isSpecKitNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Read-only load of one feature directory. `spec.md`/`plan.md` are
 * optional context; `tasks.md` is required work-item evidence. Never
 * writes, never executes.
 */
export async function loadSpecKitFeatureFiles(
  featureDir: string,
  readFile: SpecKitFileReader = defaultSpecKitReadFile,
): Promise<SpecKitFeatureFiles> {
  if (typeof featureDir !== "string" || featureDir.length === 0) {
    fail("featureDir must be a non-empty string");
  }
  if (typeof readFile !== "function") {
    fail("readFile must be a function");
  }
  const [specRaw, planRaw, tasksRaw] = await Promise.all([
    readOptional(readFile, join(featureDir, SPEC_FILENAME)),
    readOptional(readFile, join(featureDir, PLAN_FILENAME)),
    readOptional(readFile, join(featureDir, TASKS_FILENAME)),
  ]);
  if (tasksRaw === undefined) {
    if (specRaw === undefined && planRaw === undefined) {
      fail(`no Spec Kit artifacts found in ${featureDir}`);
    }
    fail("tasks.md is required for mapping work items");
  }
  return Object.freeze({
    specMd: nonEmptyText(specRaw),
    planMd: nonEmptyText(planRaw),
    tasksMd: tasksRaw,
  });
}

/** Mapped result: framework plan plus framework tickets, in order. */
export interface SpecKitFeatureMapping {
  readonly plan: Plan;
  readonly tickets: readonly PlanTicket[];
}

/**
 * Map Spec Kit feature files to the framework's plan and tickets via
 * P-003/P-004. `requirements` stay PM-owned caller input; the
 * artifacts ground them. Fails when no actionable task exists rather
 * than producing an empty successful plan.
 */
export function mapSpecKitFeatureToTickets(input: {
  readonly requirements: string;
  readonly specMd?: string;
  readonly planMd?: string;
  readonly tasksMd: string;
}): SpecKitFeatureMapping {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a mapping input object");
  }
  if (typeof input.requirements !== "string" || input.requirements.length === 0) {
    fail("requirements must be a non-empty string");
  }
  const tasks = parseSpecKitTasks(input.tasksMd);
  if (tasks.length === 0) {
    fail("tasks.md contains no actionable tasks");
  }
  const plan = mapRequirementsToPlan({
    requirements: input.requirements,
    artifact: validateSpecificationArtifact({
      artifact: "plan",
      content: composeSpecKitPlanContent({
        specMd: input.specMd,
        planMd: input.planMd,
        tasksMd: input.tasksMd,
      }),
    }),
  });
  return Object.freeze({ plan, tickets: generateTicketsFromPlan(plan) });
}
