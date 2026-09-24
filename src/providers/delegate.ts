/**
 * Generic delegate provider contract (D-001).
 *
 * The stable seam between the core framework and any external
 * delegation system (providers.md §1). Core code depends only on this
 * module; every concrete delegation integration lives behind it.
 * Later tickets own availability, concrete adapters, and failure
 * handling — none of that lives here.
 *
 * This module performs no I/O, runs nothing, contacts nothing, keeps
 * no provider list, and names no external tool, transport, or
 * offering.
 */

export interface DelegationRequest {
  /**
   * Work handed to the delegation system. Opaque to the provider:
   * this contract only carries the finished text.
   */
  readonly task: string;
  /**
   * Surrounding material the delegated work may need, when available.
   * Opaque to the provider; never a path, command, or setting.
   */
  readonly context?: string;
}

export interface DelegationResult {
  /**
   * Provider-produced outcome text for the delegated work. Nothing
   * may be assumed from it beyond what the provider documents.
   */
  readonly outcome: string;
}

function fail(what: string): never {
  throw new Error(`delegate provider: invalid input (${what})`);
}

/**
 * Validate raw data as a delegation request and return a frozen copy.
 * Rejects missing or empty task and wrong types. Says nothing about
 * any provider or external system.
 */
export function validateDelegationRequest(data: unknown): DelegationRequest {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  if (typeof raw.task !== "string" || raw.task.length === 0) {
    fail("task must be a non-empty string");
  }
  const request: DelegationRequest = { task: raw.task };
  if (raw.context !== undefined) {
    if (typeof raw.context !== "string" || raw.context.length === 0) {
      fail("context must be a non-empty string");
    }
    (request as { context?: string }).context = raw.context;
  }
  return Object.freeze(request);
}

/**
 * Validate raw data as a delegation result and return a frozen copy.
 * Rejects missing or empty outcome and wrong types.
 */
export function validateDelegationResult(data: unknown): DelegationResult {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  if (typeof raw.outcome !== "string" || raw.outcome.length === 0) {
    fail("outcome must be a non-empty string");
  }
  return Object.freeze({ outcome: raw.outcome });
}

/**
 * Generic delegation boundary. Implementations accept an
 * already-prepared request and return the provider outcome; failures
 * reject, following the same execution boundary as the M7 provider
 * contracts. `name` is the stable provider identifier.
 */
export interface DelegateProvider {
  readonly name: string;
  delegate(request: DelegationRequest): Promise<DelegationResult>;
}

/** True for values shaped like a delegation provider. */
export function isDelegateProvider(value: unknown): value is DelegateProvider {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    typeof candidate.delegate === "function"
  );
}
