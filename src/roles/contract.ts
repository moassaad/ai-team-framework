/**
 * Role contract format (R-001).
 *
 * The reusable shape every AI team role contract must take. Later tickets
 * (R-002 through R-006) fill this shape with one concrete contract per
 * role; runtime loading, validation, and selection belong to later work.
 *
 * Types only: this module performs no I/O, keeps no registry, and takes
 * no dependency. Field names use snake_case to match the configuration
 * contract style (`src/config/schema.ts`).
 */

/** Stable machine-readable role identifiers (M0 roles.md). */
export const ROLE_IDS = [
  "coordinator",
  "project-manager",
  "technical-lead",
  "implementer",
  "senior-reviewer",
] as const;
export type RoleId = (typeof ROLE_IDS)[number];

/** True for canonical role ids; rejects aliases and free text. */
export function isRoleId(value: unknown): value is RoleId {
  return (
    typeof value === "string" &&
    (ROLE_IDS as readonly string[]).includes(value)
  );
}

/**
 * Implementer specialties (M0 roles.md §5). These qualify an Implementer,
 * they are never roles themselves: no specialty may equal a `RoleId`.
 */
export const IMPLEMENTER_SPECIALTIES = [
  "backend",
  "frontend",
  "integration",
  "database",
  "testing",
  "documentation",
] as const;
export type ImplementerSpecialty = (typeof IMPLEMENTER_SPECIALTIES)[number];

/** True for known Implementer specialties. */
export function isImplementerSpecialty(value: unknown): value is ImplementerSpecialty {
  return (
    typeof value === "string" &&
    (IMPLEMENTER_SPECIALTIES as readonly string[]).includes(value)
  );
}

/**
 * Role-level input/output categories. Each names a kind of artifact from
 * the approved workflow (user requests, requirements, project or technical
 * context, tickets, results, approvals) — never a provider-specific
 * message format. Concrete payload schemas belong to later tickets.
 */
export type ContractArtifact =
  | "user_request"
  | "requirements"
  | "project_context"
  | "technical_context"
  | "ticket"
  | "implementation_result"
  | "review_result"
  | "approval_decision";

/**
 * What a role may decide on its own, what it must hand to another role,
 * and what needs the user. Conceptual only: enforcement belongs to the
 * workflow milestone, and sensitive-change rules stay in configuration.
 */
export interface DecisionAuthority {
  can_decide: string[];
  must_escalate: string[];
  requires_user_approval: string[];
}

/** Direction of a single role-to-role relationship. No routing implied. */
export type CollaborationDirection = "sends_to" | "receives_from" | "bidirectional";

/** One declared relationship to another role, e.g. Implementer → Senior Reviewer. */
export interface Collaboration {
  role: RoleId;
  direction: CollaborationDirection;
  description: string;
}

/**
 * The role contract. `responsibilities` and `non_responsibilities` are
 * non-empty by construction: a role without an explicit boundary is not
 * a valid contract. `specialties` is meaningful only for `implementer`.
 */
export interface RoleContract {
  id: RoleId;
  name: string;
  purpose: string;
  responsibilities: [string, ...string[]];
  non_responsibilities: [string, ...string[]];
  inputs: ContractArtifact[];
  outputs: ContractArtifact[];
  decision_authority: DecisionAuthority;
  escalation_rules: string[];
  constraints: string[];
  collaboration: Collaboration[];
  specialties?: ImplementerSpecialty[];
}
