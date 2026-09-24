/**
 * Generic issue provider contract (G-001, extended by G-005).
 *
 * The stable seam between the core framework and any issue-tracking
 * provider. Core code depends only on this module; every concrete
 * tracker lives behind it. G-002 provides the first adapter — this
 * ticket defines the boundary only, with no tracker concepts, no
 * transport, no secret handling, and no lifecycle coupling.
 *
 * G-005 adds one optional member: providers able to revise an
 * existing entry expose `update`, providers without it simply omit
 * the member. Creation behavior is unchanged.
 *
 * This module performs no I/O, runs nothing, contacts nothing, keeps
 * no registry, and names no external tracker, API, or host.
 */

export interface IssueRequest {
  /**
   * Issue title. Required, non-empty.
   */
  readonly title: string;
  /**
   * Issue body. Required, non-empty.
   */
  readonly description: string;
  /**
   * Requirements context carried from the planning layer, when
   * available. Opaque to the provider: requirement decisions stay
   * with their owners, this contract only carries the text.
   */
  readonly requirements?: string;
}

export interface IssueReference {
  /**
   * Provider-assigned opaque identifier for the created issue.
   * Nothing may be assumed from it beyond identity.
   */
  readonly id: string;
}

function fail(what: string): never {
  throw new Error(`issue provider: invalid input (${what})`);
}

/**
 * Validate raw data as an issue request and return a frozen copy.
 * Rejects missing or empty title/description and wrong types.
 * Says nothing about any tracker.
 */
export function validateIssueRequest(data: unknown): IssueRequest {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  if (typeof raw.title !== "string" || raw.title.length === 0) {
    fail("title must be a non-empty string");
  }
  if (typeof raw.description !== "string" || raw.description.length === 0) {
    fail("description must be a non-empty string");
  }
  const request: IssueRequest = { title: raw.title, description: raw.description };
  if (raw.requirements !== undefined) {
    if (typeof raw.requirements !== "string" || raw.requirements.length === 0) {
      fail("requirements must be a non-empty string");
    }
    (request as { requirements?: string }).requirements = raw.requirements;
  }
  return Object.freeze(request);
}

/**
 * Validate raw data as an issue reference and return a frozen copy.
 * Rejects missing or empty identifiers and wrong types.
 */
export function validateIssueReference(data: unknown): IssueReference {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    fail("id must be a non-empty string");
  }
  return Object.freeze({ id: raw.id });
}

/**
 * Partial revision of an existing entry (G-005).
 *
 * Every member is optional; only supplied members are revised, so a
 * caller sends exactly the fields that changed. At least one member
 * must be present — an empty revision is rejected rather than sent
 * as a silent no-op. Members carry the same meaning as their
 * `IssueRequest` counterparts.
 */
export interface IssueUpdate {
  /**
   * Revised title. When present, non-empty.
   */
  readonly title?: string;
  /**
   * Revised body. When present, non-empty.
   */
  readonly description?: string;
  /**
   * Revised requirements context. When present, non-empty.
   */
  readonly requirements?: string;
}

/**
 * Validate raw data as an issue revision and return a frozen copy.
 * Rejects non-objects, empty revisions, and empty or mistyped
 * members. Says nothing about any tracker.
 */
export function validateIssueUpdate(data: unknown): IssueUpdate {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  const update: { title?: string; description?: string; requirements?: string } = {};
  const fields = ["title", "description", "requirements"] as const;
  for (const field of fields) {
    const value = raw[field];
    if (value !== undefined) {
      if (typeof value !== "string" || value.length === 0) {
        fail(`${field} must be a non-empty string`);
      }
      update[field] = value;
    }
  }
  if (update.title === undefined && update.description === undefined && update.requirements === undefined) {
    fail("at least one field is required");
  }
  return Object.freeze(update);
}

/**
 * Generic issue-tracking boundary. Implementations accept a
 * fully-built request and return the tracker's opaque reference;
 * failures reject, following the same execution boundary as the M7
 * provider contracts. `name` is the stable provider identifier.
 *
 * Providers able to revise an existing entry additionally expose
 * `update`, which revises the entry named by the reference and
 * returns its reference; providers without revision support omit it.
 */
export interface IssueProvider {
  readonly name: string;
  create(request: IssueRequest): Promise<IssueReference>;
  readonly update?: (reference: IssueReference, update: IssueUpdate) => Promise<IssueReference>;
}

/** True for values shaped like an issue provider. */
export function isIssueProvider(value: unknown): value is IssueProvider {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    typeof candidate.create === "function"
  );
}
