import {
  RoleId,
  ImplementerSpecialty,
  isImplementerSpecialty,
  isRoleId,
} from "./contract";

/**
 * Role selection rules (R-007).
 *
 * Deterministic mapping from an explicit selection value to one canonical
 * `RoleId`. Pure functions, no I/O, no routing, no inference: anything
 * that is not a canonical id or a listed alias resolves to `undefined`.
 * Natural-language interpretation and runtime invocation belong to later
 * milestones.
 */

export type RoleSelectionSource = "canonical" | "alias";

export interface RoleSelection {
  role: RoleId;
  source: RoleSelectionSource;
}

/**
 * The complete alias set. Each alias is a short form of exactly one
 * multiword role id (`pm`, `tl`, `sr`) or its natural short name
 * (`reviewer` for senior-reviewer). No alias equals a canonical id or a
 * specialty, and no prefix or fuzzy matching is performed.
 */
export const ROLE_ALIASES: Readonly<Record<string, RoleId>> = {
  pm: "project-manager",
  tl: "technical-lead",
  reviewer: "senior-reviewer",
  sr: "senior-reviewer",
};

function normalizeSelection(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Resolve an explicit selection value to a canonical role.
 * Returns `undefined` for unknown input — never a fallback role.
 */
export function resolveRole(input: string): RoleSelection | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  const normalized = normalizeSelection(input);
  if (isRoleId(normalized)) {
    return { role: normalized, source: "canonical" };
  }
  const aliased: RoleId | undefined = ROLE_ALIASES[normalized];
  if (aliased !== undefined) {
    return { role: aliased, source: "alias" };
  }
  return undefined;
}

/**
 * Resolve an Implementer specialization. Fully independent from role
 * resolution: specialties are never roles, and `resolveRole` never
 * returns `implementer` for a specialty value.
 */
export function resolveImplementerSpecialty(
  input: string,
): ImplementerSpecialty | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  const normalized = normalizeSelection(input);
  return isImplementerSpecialty(normalized) ? normalized : undefined;
}
