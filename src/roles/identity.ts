/**
 * Agent identity contract (M22 T-002).
 *
 * The canonical answer to "who am I?" for one invocation: exactly
 * one of the five `RoleId` values, validated and frozen. Identity
 * answers WHO; the invocation's ticket, context, and provider answer
 * WHAT INFORMATION and HOW it executes — those stay separate (the
 * `AgentInvocation` and execution seams keep their own shapes).
 *
 * Relationship to existing mechanisms (no merging, no hiding):
 *
 * - `RoleId` / `isRoleId` (`contract.ts`) remain the identity
 *   vocabulary; nothing new is introduced there.
 * - CLI aliases, prompt keywords, and slash forms (`selection.ts`,
 *   `prompt.ts`, `slash.ts`) stay at the presentation layer: they
 *   resolve to a canonical `RoleId` before validation, never inside
 *   it. `pm`, `tl`, `reviewer`, and `sr` are rejected here.
 * - `AgentInvocation.role` (providers) stays the optional
 *   invocation-scoped marker; it constrains nothing by itself.
 * - The five `runtime/roles.ts` references stay the
 *   execution/provider seam (who fulfills the work); an identity
 *   selects which reference shape applies but never replaces it.
 * - `RoleContract` and the T-001 operating model stay the
 *   responsibility/authority source: `getRoleContract` returns the
 *   existing contract object for an identity — never a copy, never
 *   a new description, never an inference.
 *
 * Identity carries no provider, transport, session, model, user,
 * configuration, or credential fields, and this module depends on
 * nothing outside `src/roles/`. No routing, no inference, no role
 * switching, no managers, no registries. Later tickets (handoff
 * T-003, independent execution T-005, modes M27) consume identities;
 * none are implemented here.
 */

import { RoleContract, RoleId, isRoleId } from "./contract";
import { COORDINATOR_ROLE } from "./coordinator";
import { PROJECT_MANAGER_ROLE } from "./project-manager";
import { TECHNICAL_LEAD_ROLE } from "./technical-lead";
import { IMPLEMENTER_ROLE } from "./implementer";
import { SENIOR_REVIEWER_ROLE } from "./senior-reviewer";

/**
 * Who this invocation performs as: one canonical role. Frozen on
 * creation; a different role means a different identity, never a
 * mutation of this one.
 */
export interface AgentIdentity {
  readonly role: RoleId;
}

function fail(what: string): never {
  throw new Error(`agent identity: ${what}`);
}

/** True for values shaped like an agent identity: an object whose `role` is canonical. */
export function isAgentIdentity(value: unknown): value is AgentIdentity {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return isRoleId((value as Record<string, unknown>).role);
}

/**
 * Validate raw data as an agent identity and return a frozen copy
 * containing only the role. Rejects missing, unknown, and malformed
 * roles — including presentation aliases such as `pm`, which must be
 * resolved to a canonical `RoleId` before validation. Extra fields
 * (provider, session, model, transport, user, configuration, or
 * anything else) never become identity: they are dropped, not
 * carried. Deterministic: same input, same output or same error.
 * Never mutates the input.
 */
export function validateAgentIdentity(data: unknown): AgentIdentity {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an identity object");
  }
  const role = (data as Record<string, unknown>).role;
  if (!isRoleId(role)) {
    fail(`expected one of the five canonical roles, got ${JSON.stringify(role)}`);
  }
  return Object.freeze({ role });
}

/**
 * The existing canonical role contract governing an identity. Pure
 * lookup over the five identities: returns the shared contract
 * object itself (identity comparison with `===` holds), creates
 * nothing, mutates nothing, infers nothing. Rejects non-identities
 * instead of guessing.
 */
export function getRoleContract(identity: AgentIdentity): RoleContract {
  if (!isAgentIdentity(identity)) {
    fail("expected a valid agent identity");
  }
  switch (identity.role) {
    case "coordinator":
      return COORDINATOR_ROLE;
    case "project-manager":
      return PROJECT_MANAGER_ROLE;
    case "technical-lead":
      return TECHNICAL_LEAD_ROLE;
    case "implementer":
      return IMPLEMENTER_ROLE;
    case "senior-reviewer":
      return SENIOR_REVIEWER_ROLE;
    default:
      return fail(`unknown role ${JSON.stringify((identity as AgentIdentity).role)}`);
  }
}

/**
 * Whether an identity is the role an execution requires. Strict
 * equality on canonical roles: a Technical Lead execution holding a
 * Senior Reviewer identity does not match, and nothing is silently
 * reused. Non-identities and non-roles never match.
 */
export function identityMatchesRole(identity: unknown, required: unknown): boolean {
  if (!isAgentIdentity(identity) || !isRoleId(required)) {
    return false;
  }
  return identity.role === required;
}
