/**
 * Role operating model (M22 T-001).
 *
 * The canonical definition of what the five AI Team roles own, what
 * they must not touch, what authority each holds, which handoff
 * directions are approved, and which assumptions are prohibited.
 *
 * This module reuses the existing `RoleContract` shape and the five
 * concrete contracts (`coordinator.ts`, `project-manager.ts`,
 * `technical-lead.ts`, `implementer.ts`, `senior-reviewer.ts`) as the
 * source of truth for responsibilities, prohibitions, inputs, outputs,
 * decision authority, and escalation rules — nothing in those files is
 * duplicated here. This module adds only what no existing contract
 * expresses in one place:
 *
 * - one authority label per role (scoped authority, never a generic
 *   hierarchy: no role is "higher" than another);
 * - one output-responsibility label per role (what each role's output
 *   must later be able to become as a canonical handoff; the handoff
 *   schema itself belongs to M22 T-003);
 * - the approved logical handoff directions as data plus a pure
 *   predicate (definition only: no routing, no execution, no state,
 *   no wiring into `workflow/retry-handoff.ts`, which keeps its own
 *   M0 retry-context semantics untouched);
 * - the role-independence rule (every role is directly invocable;
 *   invoking one role never automatically invokes another);
 * - the prohibited assumptions no role may act on.
 *
 * Data only: no I/O, no registry, no orchestration engines, no
 * providers, no workflow states, no configuration loading, no stored
 * state, no timers, no automatic repetition, no inference. Planning
 * (M23/M24), handoff mechanics (M22 T-003/T-004), independent
 * execution (M22 T-005), CLI role commands (M25), agent delegation
 * transport (M26), and work modes (M27) are all out of scope.
 */

import { RoleId, ROLE_IDS, isRoleId } from "./contract";

/** The five independently executable roles. Identical to `ROLE_IDS`; no new identity. */
export const OPERATING_MODEL_ROLES: readonly RoleId[] = ROLE_IDS;

/**
 * Scoped authority per role. Each entry names the judgment a role may
 * exercise on its own; anything outside it belongs to another role's
 * authority, the workflow, or the user. Deliberately not a ranking.
 */
export const ROLE_AUTHORITY: Record<RoleId, string> = {
  coordinator: "workflow and orchestration authority",
  "project-manager": "requirements, scope, and business authority",
  "technical-lead": "technical architecture and decomposition authority",
  implementer: "implementation authority within approved scope",
  "senior-reviewer": "implementation review authority",
};

/**
 * Output responsibility per role: what each role produces that must
 * later be representable as a canonical handoff (M22 T-003).
 */
export const ROLE_OUTPUT: Record<RoleId, string> = {
  coordinator: "planning and orchestration direction",
  "project-manager": "requirements, scope, acceptance, and business plan",
  "technical-lead": "technical plan, decomposition, and constraints",
  implementer: "implementation result with tests and result evidence",
  "senior-reviewer": "review result with actionable feedback",
};

/**
 * Approved logical handoff directions (M22 T-001 baseline). Definition
 * only: the actual handoff contract, validation, rendering, and
 * transport belong to M22 T-003 and later. Intentionally separate
 * from `workflow/retry-handoff.ts`, whose supported pairs serve the
 * narrower M0 retry-context purpose and are left untouched.
 */
export const APPROVED_HANDOFFS: ReadonlyArray<readonly [RoleId, RoleId]> = [
  ["coordinator", "project-manager"],
  ["coordinator", "technical-lead"],
  ["project-manager", "technical-lead"],
  ["project-manager", "coordinator"],
  ["technical-lead", "implementer"],
  ["technical-lead", "project-manager"],
  ["technical-lead", "coordinator"],
  ["implementer", "senior-reviewer"],
  ["implementer", "technical-lead"],
  ["senior-reviewer", "implementer"],
  ["senior-reviewer", "technical-lead"],
];

/**
 * Whether a handoff direction is part of the approved operating
 * model. Pure predicate over canonical `RoleId` values: aliases,
 * free text, and anything outside the approved set return false.
 */
export function isApprovedHandoff(from: unknown, to: unknown): boolean {
  if (!isRoleId(from) || !isRoleId(to)) {
    return false;
  }
  return APPROVED_HANDOFFS.some(([approvedFrom, approvedTo]) => approvedFrom === from && approvedTo === to);
}

/**
 * Direct invocation entry points: `User → <role>` is valid for every
 * role without constructing or invoking the rest of the team. The
 * full Coordinator → PM → TL → Implementer → Reviewer chain is one
 * possible composition, never a dependency requirement; invoking one
 * role never automatically invokes another.
 */
export const INDEPENDENT_ENTRY_POINTS: readonly RoleId[] = ROLE_IDS;

/**
 * Assumptions no role may act on. Boundary behavior itself (surface,
 * don't silently rewrite; escalate to the owning authority) lives in
 * each contract's `must_escalate` and `escalation_rules`.
 */
export const PROHIBITED_ASSUMPTIONS: readonly string[] = [
  "no role is universally higher than another; authority is scoped per role",
  "invoking one role never automatically invokes another role",
  "the full team chain is one possible composition, never a dependency requirement",
  "the Implementer never silently rewrites requirements or becomes the Technical Lead",
  "the Senior Reviewer never silently redefines business scope or replaces the Technical Lead",
  "the Project Manager and Technical Lead never silently replace each other's authority",
];
