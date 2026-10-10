/**
 * Work Mode Contract (M27 T-026).
 *
 * The canonical representation of the three workflow
 * compositions the framework supports:
 *
 * - `fast`: minimal implementation/review lifecycle —
 *   User → Implementer → Senior Reviewer → Done. No planning
 *   roles, no Sprint/Task generation, no approval gates.
 * - `standard`: coordinator plus technical planning around
 *   implementation/review — User → Coordinator → Technical
 *   Lead → Implementer → Senior Reviewer → Done. Planning
 *   participates; Sprint/Task generation and approval gates
 *   are not part of the composition.
 * - `full`: the complete planning/business/technical lifecycle —
 *   User → Coordinator → Project Manager → Technical Lead →
 *   Sprint/Task generation → Implementer → Senior Reviewer →
 *   technical acceptance → PM validation → Final approval →
 *   Done. Planning, Sprint/Task generation, and approval gates
 *   all participate.
 *
 * Data only: identity plus a declarative composition policy
 * future tickets consume. No execution paths (T-027/T-028/T-029),
 * no recommendation (T-030), no guardrails (T-031), no runners,
 * no providers, no transports, no persistence, no state, no
 * configuration. The `lifecycle` role sequences describe which
 * roles a composition involves in order — they are not
 * instructions to invoke anyone, and the trailing acceptance
 * entries in `full` reuse the existing roles rather than
 * inventing new ones (Final approval itself is not a role and
 * appears in no list). The boolean flags describe the same
 * composition from the planning/sprint/approval angle so later
 * tickets need not re-derive product meaning; they permit
 * nothing and forbid nothing.
 *
 * Conventions follow the `RoleId` model: stable lowercase
 * identifiers, exact matching, no aliases, no coercion, no
 * default. A mode is independent of providers, transports,
 * capability, users, tasks, and artifacts — it means the same
 * thing in every environment. Modes are not quality tiers,
 * priorities, timeouts, or costs: nothing here ranks them.
 */

import { RoleId } from "../roles/contract";

/** Stable machine-readable work mode identifiers. */
export const WORK_MODES = ["fast", "standard", "full"] as const;

/** Canonical work mode: one of the three workflow compositions. */
export type WorkMode = (typeof WORK_MODES)[number];

/** True for canonical work mode ids; rejects aliases and free text. */
export function isWorkMode(value: unknown): value is WorkMode {
  return (
    typeof value === "string" &&
    (WORK_MODES as readonly string[]).includes(value)
  );
}

/**
 * Declarative composition policy for one work mode. Describes
 * the intended lifecycle shape only: which roles participate in
 * order, and whether planning roles, Sprint/Task generation,
 * and approval gates are part of the composition. Frozen
 * throughout; enforced by nobody in this ticket.
 */
export interface WorkModeDescriptor {
  readonly id: WorkMode;
  /** Roles involved in order; descriptive, never an invocation plan. */
  readonly lifecycle: readonly RoleId[];
  /** Whether planning roles participate in the composition. */
  readonly planning: boolean;
  /** Whether Sprint/Task generation is part of the composition. */
  readonly sprints: boolean;
  /** Whether approval gates are part of the composition. */
  readonly approvals: boolean;
}

function descriptor(
  id: WorkMode,
  lifecycle: readonly RoleId[],
  planning: boolean,
  sprints: boolean,
  approvals: boolean,
): WorkModeDescriptor {
  return Object.freeze({ id, lifecycle: Object.freeze([...lifecycle]), planning, sprints, approvals });
}

/** Canonical descriptor per mode; frozen. */
export const WORK_MODE_DESCRIPTORS: Record<WorkMode, WorkModeDescriptor> = Object.freeze({
  fast: descriptor("fast", ["implementer", "senior-reviewer"], false, false, false),
  standard: descriptor("standard", ["coordinator", "technical-lead", "implementer", "senior-reviewer"], true, false, false),
  full: descriptor(
    "full",
    ["coordinator", "project-manager", "technical-lead", "implementer", "senior-reviewer", "technical-lead", "project-manager"],
    true,
    true,
    true,
  ),
});

function fail(what: string): never {
  throw new Error(`work mode: ${what}`);
}

/**
 * Validate raw data as a canonical work mode. Accepts only the
 * three exact identifiers; rejects unknown modes, aliases, case
 * variants, wrong types, and arbitrary objects. No coercion.
 */
export function validateWorkMode(data: unknown): WorkMode {
  if (!isWorkMode(data)) {
    fail(`expected a canonical work mode ("fast", "standard", or "full"), got ${JSON.stringify(data)}`);
  }
  return data;
}

/**
 * Return the canonical descriptor for a validated work mode.
 * Validates its input; the returned descriptor is the frozen
 * canonical object, safe to share.
 */
export function getWorkModeDescriptor(mode: unknown): WorkModeDescriptor {
  return WORK_MODE_DESCRIPTORS[validateWorkMode(mode)];
}
