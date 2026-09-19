/**
 * Role prompt rendering (O-003).
 *
 * Pure, deterministic composition: an already-selected `RoleContract`
 * plus already-prepared context becomes the finished prompt string for
 * an `AgentProvider`. Every role section derives from the contract; no
 * wording is invented here and nothing is resolved, detected, executed,
 * or contacted. Provider-agnostic: this module never mentions any
 * provider and performs no I/O.
 */

import {
  ImplementerSpecialty,
  RoleContract,
  isImplementerSpecialty,
  isRoleId,
} from "../roles/contract";
import { ProjectContext, validateProjectContext } from "../discovery/contract";

export interface RolePromptInput {
  /** Already-selected role contract. Aliases and fuzzy names rejected. */
  readonly role: RoleContract;
  /** User/task intent, preserved verbatim in the prompt. */
  readonly task: string;
  /** Already-resolved Implementer specialty; implementer only. */
  readonly specialty?: ImplementerSpecialty;
  /** Target project context, when known. */
  readonly project?: ProjectContext;
  /**
   * Concise pre-computed discovery summary, when available. Opaque to
   * the renderer: another layer discovers and summarizes, this layer
   * only presents the text.
   */
  readonly discovery_summary?: string;
}

function fail(what: string): never {
  throw new Error(`role prompt: invalid input (${what})`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

function requiredStringList(value: unknown, field: string): [string, ...string[]] {
  const list = optionalStringList(value, field);
  if (list.length === 0) {
    fail(`${field} must be a non-empty string array`);
  }
  return list as [string, ...string[]];
}

function optionalStringList(value: unknown, field: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    fail(`${field} must be a string array`);
  }
  return [...(value as string[])];
}

/**
 * Validate raw data as renderer input and return a frozen copy. Checks
 * shape only: role identity via `isRoleId` (no alias resolution, no
 * fuzzy matching), specialty via `isImplementerSpecialty` and only for
 * the implementer role, project via the discovery contract.
 */
export function validateRolePromptInput(data: unknown): RolePromptInput {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  if (typeof raw.role !== "object" || raw.role === null) {
    fail("role must be a role contract object");
  }
  const role = raw.role as Record<string, unknown>;
  if (!isRoleId(role.id)) {
    fail(`unknown role ${JSON.stringify(role.id)}`);
  }
  const contract: RoleContract = {
    ...(role as object),
    id: role.id,
    name: nonEmptyString(role.name, "role.name"),
    purpose: nonEmptyString(role.purpose, "role.purpose"),
    responsibilities: requiredStringList(role.responsibilities, "role.responsibilities"),
    non_responsibilities: requiredStringList(role.non_responsibilities, "role.non_responsibilities"),
    constraints: optionalStringList(role.constraints, "role.constraints"),
    escalation_rules: optionalStringList(role.escalation_rules, "role.escalation_rules"),
  } as RoleContract;
  const task = nonEmptyString(raw.task, "task");
  const input: RolePromptInput = { role: Object.freeze(contract), task };
  if (raw.specialty !== undefined) {
    if (!isImplementerSpecialty(raw.specialty)) {
      fail(`unknown specialty ${JSON.stringify(raw.specialty)}`);
    }
    if (role.id !== "implementer") {
      fail("specialty applies to the implementer role only");
    }
    (input as { specialty?: ImplementerSpecialty }).specialty = raw.specialty;
  }
  if (raw.project !== undefined) {
    (input as { project?: ProjectContext }).project = validateProjectContext(raw.project);
  }
  if (raw.discovery_summary !== undefined) {
    (input as { discovery_summary?: string }).discovery_summary = nonEmptyString(
      raw.discovery_summary,
      "discovery_summary",
    );
  }
  return Object.freeze(input);
}

function section(title: string, lines: string[]): string {
  return [`## ${title}`, ...lines.map((line) => `- ${line}`)].join("\n");
}

/**
 * Render the finished prompt string. Pure and deterministic: same input
 * always yields the same output; no timestamps, ids, environment, or
 * host data. Section order is fixed.
 */
export function renderRolePrompt(input: RolePromptInput): string {
  const validated = validateRolePromptInput(input);
  const role = validated.role;
  const parts: string[] = [
    `# ${role.name} (${role.id})`,
    "",
    role.purpose,
    "",
    section("Responsibilities", [...role.responsibilities]),
    "",
    section("Boundaries", [...role.non_responsibilities]),
  ];
  if (validated.specialty !== undefined) {
    parts.push("", `Specialty: ${validated.specialty}.`);
  }
  if (role.constraints.length > 0) {
    parts.push("", section("Constraints", [...role.constraints]));
  }
  if (role.escalation_rules.length > 0) {
    parts.push("", section("Escalation", [...role.escalation_rules]));
  }
  if (validated.project !== undefined) {
    const project = validated.project;
    const detail =
      project.name !== undefined ? `${project.root} (${project.name})` : project.root;
    parts.push("", `Project root: ${detail}`);
  }
  if (validated.discovery_summary !== undefined) {
    parts.push("", "Discovery summary:", validated.discovery_summary);
  }
  parts.push("", "Task:", validated.task);
  return parts.join("\n");
}
