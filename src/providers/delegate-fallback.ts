/**
 * Delegate failure fallback (D-006).
 *
 * The safe boundary for optional delegation: when delegation cannot
 * be used — disabled, unconfirmed, unavailable, or failed — control
 * returns to the normal framework path instead. The approved fallback
 * operation comes from `providers.md` §5: absent or disabled
 * delegation means the same work is performed in the normal
 * single-role flow. This module reports that outcome; it does not
 * perform the normal flow itself, which belongs to the caller.
 *
 * Gate order is cheapest and safest first: setting, then human
 * decision, then presence, then exactly one execution attempt. A
 * `not_delegated` outcome carries no result — failure is never
 * reported as success and nothing is fabricated to hide it. No
 * second attempt, no alternate provider, no state change, no
 * ticket edge.
 */

import {
  DelegationRequest,
  DelegationResult,
  validateDelegationRequest,
} from "./delegate";
import type { DelegateAvailability } from "./delegate-availability";
import { resolveDelegationConfirmation } from "./delegate-confirmation";

/** Why delegation was not used. */
export type DelegateFallbackReason = "disabled" | "unconfirmed" | "unavailable" | "failed";

/** Fallback outcome: delegated work, or control returned with a reason. */
export type DelegateFallbackOutcome =
  | { status: "delegated"; result: DelegationResult }
  | { status: "not_delegated"; reason: DelegateFallbackReason; detail?: string };

/**
 * Injected seams. The caller supplies the D-004 setting value, the
 * D-002 detector check, the explicit human decision checked through
 * the D-005 decision semantics, and the D-003 execution function.
 * This module owns none of those behaviors; it only orders them.
 */
export interface DelegateFallbackDeps {
  /** D-004 `providers.delegate.enabled` value. Must be a boolean. */
  readonly enabled: boolean;
  /** D-002 detector check. Must not throw for probe failures. */
  readonly checkAvailability: () => DelegateAvailability;
  /** Explicit human decision; missing input never confirms. */
  readonly confirmation: unknown;
  /** D-003 execution; called at most once. */
  readonly delegate: (request: DelegationRequest) => Promise<DelegationResult>;
}

function fail(what: string): never {
  throw new Error(`delegate fallback: invalid input (${what})`);
}

function requireDeps(deps: DelegateFallbackDeps): void {
  if (typeof deps !== "object" || deps === null) {
    fail("expected a dependencies object");
  }
  if (typeof deps.enabled !== "boolean") {
    fail("enabled must be a boolean");
  }
  if (typeof deps.checkAvailability !== "function") {
    fail("checkAvailability must be a function");
  }
  if (typeof deps.delegate !== "function") {
    fail("delegate must be a function");
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Attempt delegation exactly once when all gates pass; otherwise
 * return control with the reason. Never throws for unavailable or
 * failed delegation — those are outcomes, not contract violations.
 */
export async function delegateWithFallback(
  request: DelegationRequest,
  deps: DelegateFallbackDeps,
): Promise<DelegateFallbackOutcome> {
  const invocation = validateDelegationRequest(request);
  requireDeps(deps);
  if (!deps.enabled) {
    return { status: "not_delegated", reason: "disabled" };
  }
  let confirmation: string;
  try {
    confirmation = resolveDelegationConfirmation(deps.confirmation);
  } catch {
    return { status: "not_delegated", reason: "unconfirmed" };
  }
  if (confirmation !== "confirmed") {
    return { status: "not_delegated", reason: "unconfirmed" };
  }
  if (deps.checkAvailability().available !== true) {
    return { status: "not_delegated", reason: "unavailable" };
  }
  try {
    return { status: "delegated", result: await deps.delegate(invocation) };
  } catch (error: unknown) {
    return { status: "not_delegated", reason: "failed", detail: errorDetail(error) };
  }
}
