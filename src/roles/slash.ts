import { ImplementerSpecialty, RoleId } from "./contract";
import { resolveImplementerSpecialty, resolveRole } from "./selection";

/**
 * Slash-command role selection (CLI-005).
 *
 * Lightweight, host-optional alias interface over the existing
 * role-selection contract: exact strings only (`/technical-lead`,
 * `/implementer backend`). No fuzzy or substring matching, no inference,
 * no new aliases — undocumented forms resolve to `undefined`. Slash
 * availability depends on the host agent; this parser assumes nothing
 * about OpenCode or any other host. Resolution always lands on canonical
 * role IDs through `resolveRole()`.
 */

export interface SlashSelection {
  role: RoleId;
  specialty?: ImplementerSpecialty;
}

/**
 * Slash-command alias contract (official CLI-005).
 *
 * The framework-level definition of which slash commands exist, which
 * canonical role each selects, and whether it accepts an Implementer
 * specialty. Pure data, host-neutral: it assumes nothing about how a
 * host passes input (one string or several arguments), performs no
 * parsing, and invokes nothing. CLI-006 host integration consumes this
 * contract instead of redefining the alias set.
 */
export interface SlashAlias {
  command: string;
  role: RoleId;
  specialtyAllowed: boolean;
}

export const SLASH_ALIASES: readonly SlashAlias[] = Object.freeze([
  { command: "/coordinator", role: "coordinator", specialtyAllowed: false },
  { command: "/project-manager", role: "project-manager", specialtyAllowed: false },
  { command: "/technical-lead", role: "technical-lead", specialtyAllowed: false },
  { command: "/implementer", role: "implementer", specialtyAllowed: true },
  { command: "/senior-reviewer", role: "senior-reviewer", specialtyAllowed: false },
]);

/**
 * Look up a slash alias by its exact command text. Specialty identifiers
 * themselves come from the existing specialty union
 * (`resolveImplementerSpecialty`); only `/implementer` accepts one, per
 * its `specialtyAllowed` flag. Multi-word input such as
 * "/implementer backend" is a host-parsing concern, not a contract entry.
 */
export function findSlashAlias(command: string): SlashAlias | undefined {
  return SLASH_ALIASES.find((alias) => alias.command === command);
}

/**
 * Parse a slash command into a role selection, or `undefined` when the
 * input is not a documented slash form (official CLI-006 host behavior).
 *
 * Every rule comes from the CLI-005 contract above: the command word must
 * match a `SLASH_ALIASES` entry, and a second word is accepted only when
 * that entry's `specialtyAllowed` flag permits it. No implicit lists, no
 * fuzzy matching, no inference.
 */
export function resolveSlashCommand(input: string): SlashSelection | undefined {
  if (typeof input !== "string" || !input.startsWith("/") || input.startsWith("//")) {
    return undefined;
  }
  const parts = input.slice(1).split(" ");
  if (parts.length !== 1 && parts.length !== 2) {
    return undefined;
  }
  const alias = findSlashAlias(`/${parts[0]}`);
  if (alias === undefined) {
    return undefined;
  }
  if (parts.length === 1) {
    const selection = resolveRole(alias.role);
    return selection === undefined ? undefined : { role: selection.role };
  }
  if (!alias.specialtyAllowed) {
    return undefined;
  }
  const specialty = resolveImplementerSpecialty(parts[1]);
  if (specialty === undefined) {
    return undefined;
  }
  const selection = resolveRole(alias.role);
  return selection === undefined ? undefined : { role: selection.role, specialty };
}
