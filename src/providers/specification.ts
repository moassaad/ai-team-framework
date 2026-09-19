/**
 * Generic specification provider contract (P-001).
 *
 * The stable seam between the core framework and any planning artifact
 * producer (plan §8.3, §9.2). Core code depends only on this module;
 * every concrete adapter lives behind it. P-002 provides the first
 * adapter, P-003/P-004 map artifacts to plans and tickets, and P-005
 * adds the unavailable-provider fallback — none of that lives here.
 *
 * This module performs no I/O, runs nothing, contacts nothing, keeps
 * no registry, and names no external tool, command, path, or syntax.
 */

export const SPECIFICATION_ARTIFACTS = ["specification", "plan"] as const;
export type SpecificationArtifactKind = (typeof SPECIFICATION_ARTIFACTS)[number];

/** True for supported specification artifact kinds. */
export function isSpecificationArtifactKind(value: unknown): value is SpecificationArtifactKind {
  return value === "specification" || value === "plan";
}

export interface SpecificationRequest {
  /**
   * Requirements text owned by the Project Manager. Opaque to the
   * provider: requirement decisions stay with the role, this contract
   * only carries the finished text.
   */
  readonly requirements: string;
  /**
   * Target project the artifact is bounded to. A filesystem path to
   * the project root; never the framework workspace.
   */
  readonly project_root: string;
  /** Which planning artifact to produce. */
  readonly artifact: SpecificationArtifactKind;
}

export interface SpecificationArtifact {
  /** The artifact kind that was produced. Echoes the request. */
  readonly artifact: SpecificationArtifactKind;
  /** Generated artifact content. Provider-neutral text. */
  readonly content: string;
}

function fail(what: string): never {
  throw new Error(`specification provider: invalid input (${what})`);
}

/**
 * Validate raw data as a specification request and return a frozen
 * copy. Rejects missing or empty requirements/project_root, unknown
 * artifact kinds, and wrong types. Says nothing about any provider.
 */
export function validateSpecificationRequest(data: unknown): SpecificationRequest {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  if (typeof raw.requirements !== "string" || raw.requirements.length === 0) {
    fail("requirements must be a non-empty string");
  }
  if (typeof raw.project_root !== "string" || raw.project_root.length === 0) {
    fail("project_root must be a non-empty string");
  }
  if (!isSpecificationArtifactKind(raw.artifact)) {
    fail(`unknown artifact ${JSON.stringify(raw.artifact)}`);
  }
  return Object.freeze({
    requirements: raw.requirements,
    project_root: raw.project_root,
    artifact: raw.artifact,
  });
}

/**
 * Validate raw data as a specification artifact and return a frozen
 * copy. Rejects unknown artifact kinds and missing or empty content.
 */
export function validateSpecificationArtifact(data: unknown): SpecificationArtifact {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  if (!isSpecificationArtifactKind(raw.artifact)) {
    fail(`unknown artifact ${JSON.stringify(raw.artifact)}`);
  }
  if (typeof raw.content !== "string" || raw.content.length === 0) {
    fail("content must be a non-empty string");
  }
  return Object.freeze({ artifact: raw.artifact, content: raw.content });
}

/**
 * Generic planning boundary. Implementations accept an already-prepared
 * request and return the produced artifact; failures reject, following
 * the same execution boundary as the M7 provider contract. `name` is
 * the stable provider identifier, so a future fallback (P-005) can
 * stand beside an adapter behind this same contract.
 */
export interface SpecificationProvider {
  readonly name: string;
  generate(request: SpecificationRequest): Promise<SpecificationArtifact>;
}

/** True for values shaped like a specification provider. */
export function isSpecificationProvider(value: unknown): value is SpecificationProvider {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    typeof candidate.generate === "function"
  );
}
