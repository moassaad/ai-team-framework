import { ImplementerSpecialty, RoleId, isRoleId } from "./contract";
import { IMPLEMENTER_ROLE } from "./implementer";
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
 * Parse a slash command into a role selection, or `undefined` when the
 * input is not a documented slash form. The specialty form is accepted
 * only for Implementer; anything else with a second word is rejected.
 */
export function resolveSlashCommand(input: string): SlashSelection | undefined {
  if (typeof input !== "string" || !input.startsWith("/") || input.startsWith("//")) {
    return undefined;
  }
  const parts = input.slice(1).split(" ");
  if (parts.length === 1) {
    if (!isRoleId(parts[0])) {
      return undefined;
    }
    const selection = resolveRole(parts[0]);
    return selection === undefined ? undefined : { role: selection.role };
  }
  if (parts.length === 2 && parts[0] === IMPLEMENTER_ROLE.id) {
    const specialty = resolveImplementerSpecialty(parts[1]);
    if (specialty === undefined) {
      return undefined;
    }
    const selection = resolveRole(parts[0]);
    return selection === undefined ? undefined : { role: selection.role, specialty };
  }
  return undefined;
}
