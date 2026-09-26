/**
 * Explicit role resolution for the Coordinator runtime (M18 R-003).
 *
 * The single caller-supplied seam between the Coordinator and role
 * fulfillment: `resolveImplementer` and `resolveSeniorReviewer`
 * each answer "who does this responsibility for this ticket" with
 * a minimal reference the existing execution seams already
 * understand. The Coordinator reasons about `Implementer` and
 * `Senior Reviewer` — never about skills, models, CLIs, relays,
 * fleets, or sessions; those stay behind the generic
 * `AgentProvider` contract inside the reference.
 *
 * References reuse the existing `RoleId` identities
 * (`implementer`, `senior-reviewer`) and the existing
 * `ImplementerSpecialty` set. The full declarative
 * `RoleContract` is deliberately not reused here: it describes
 * responsibilities for humans, while these references carry only
 * what IR-001/IR-002 consume (identity, specialty where
 * supported, provider). Resolution is caller-supplied and
 * deterministic — no classification, no inference, no discovery:
 * a caller that already decides specialty/provider externally
 * returns it here. Either role may resolve synchronously or as a
 * promise; the Coordinator awaits both the same way.
 */

import { AgentProvider, isAgentProvider } from "../providers/agent";
import { ExecutionResult } from "../providers/result";
import { ImplementerSpecialty, RoleId, isImplementerSpecialty, isRoleId } from "../roles/contract";

/**
 * Who implements: identity plus everything IR-001 needs and
 * nothing more. No model, session, fleet, relay, CLI, or
 * credential fields exist here and none may be added without an
 * execution contract that requires them.
 */
export interface ImplementerRoleReference {
  readonly role: RoleId;
  readonly specialty: ImplementerSpecialty;
  readonly provider: AgentProvider<ExecutionResult>;
}

/** Who reviews: identity plus the IR-002 provider. Same minimality rule. */
export interface SeniorReviewerRoleReference {
  readonly role: RoleId;
  readonly provider: AgentProvider<ExecutionResult>;
}

/**
 * Caller-supplied role resolution. The Coordinator instantiates
 * nothing and discovers nothing; it calls each resolver exactly
 * once per invocation, after ticket selection and before the
 * corresponding provider invocation.
 */
export interface RoleResolver {
  resolveImplementer(ticket: {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly requirements: string;
  }): ImplementerRoleReference | Promise<ImplementerRoleReference>;
  resolveSeniorReviewer(ticket: {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly requirements: string;
  }): SeniorReviewerRoleReference | Promise<SeniorReviewerRoleReference>;
}

function fail(what: string): never {
  throw new Error(`role resolution: ${what}`);
}

/** True for values shaped like a role resolver. */
export function isRoleResolver(value: unknown): value is RoleResolver {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.resolveImplementer === "function" &&
    typeof candidate.resolveSeniorReviewer === "function"
  );
}

function checkRoleId(value: unknown, expected: RoleId, field: string): RoleId {
  if (!isRoleId(value) || value !== expected) {
    fail(`${field} must be the role ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
  }
  return value;
}

function checkProvider(value: unknown, field: string): AgentProvider<ExecutionResult> {
  if (!isAgentProvider(value)) {
    fail(`${field} must satisfy the agent provider contract`);
  }
  return value as AgentProvider<ExecutionResult>;
}

/**
 * Validate raw data as an Implementer reference and return it
 * unchanged. Rejects wrong role identities, unknown specialties,
 * and malformed providers — never fabricates or falls back.
 */
export function validateImplementerReference(data: unknown): ImplementerRoleReference {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an implementer reference object");
  }
  const raw = data as Record<string, unknown>;
  const role = checkRoleId(raw.role, "implementer", "role");
  if (!isImplementerSpecialty(raw.specialty)) {
    fail(`unknown specialty ${JSON.stringify(raw.specialty)}`);
  }
  const provider = checkProvider(raw.provider, "provider");
  return { role, specialty: raw.specialty, provider };
}

/**
 * Validate raw data as a Senior Reviewer reference and return it
 * unchanged. Same strictness: exact role identity, valid
 * provider, no fallback.
 */
export function validateSeniorReviewerReference(data: unknown): SeniorReviewerRoleReference {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected a senior reviewer reference object");
  }
  const raw = data as Record<string, unknown>;
  const role = checkRoleId(raw.role, "senior-reviewer", "role");
  const provider = checkProvider(raw.provider, "provider");
  return { role, provider };
}
