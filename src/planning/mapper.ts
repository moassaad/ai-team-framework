/**
 * Requirements-to-plan mapping (P-003).
 *
 * Pure planning-domain layer: binds PM-owned requirements to the
 * specification artifact that grounds them, producing the framework's
 * plan representation for later decomposition (P-004). Consumes the
 * generic P-001 artifact only — never a provider, never an adapter.
 * No content parsing, no invented scope: both texts travel verbatim
 * and the artifact kind is recorded for traceability.
 */

import {
  SpecificationArtifact,
  SpecificationArtifactKind,
  validateSpecificationArtifact,
} from "../providers/specification";

export interface PlanInput {
  /** PM-owned requirements text, preserved verbatim. */
  readonly requirements: string;
  /** Grounding artifact from any specification provider. */
  readonly artifact: SpecificationArtifact;
}

export interface Plan {
  /** PM-owned requirements text, verbatim from the input. */
  readonly requirements: string;
  /** Which artifact kind grounds this plan. */
  readonly basis: SpecificationArtifactKind;
  /** Grounding artifact content, verbatim from the input. */
  readonly specification: string;
}

function fail(what: string): never {
  throw new Error(`plan mapping: invalid input (${what})`);
}

/**
 * Validate raw data as plan input and return a frozen copy. The
 * artifact is validated through the shared P-001 validator, so any
 * conforming provider output is accepted regardless of origin.
 */
export function validatePlanInput(data: unknown): PlanInput {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  if (typeof raw.requirements !== "string" || raw.requirements.length === 0) {
    fail("requirements must be a non-empty string");
  }
  return Object.freeze({
    requirements: raw.requirements,
    artifact: validateSpecificationArtifact(raw.artifact),
  });
}

/**
 * Map validated requirements plus a specification artifact to a plan.
 * Deterministic and side-effect free: same input always yields the
 * same frozen output, caller inputs never mutated.
 */
export function mapRequirementsToPlan(input: PlanInput): Plan {
  const validated = validatePlanInput(input);
  return Object.freeze({
    requirements: validated.requirements,
    basis: validated.artifact.artifact,
    specification: validated.artifact.content,
  });
}
