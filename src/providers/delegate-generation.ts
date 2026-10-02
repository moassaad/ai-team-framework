/**
 * Delegate failure and fallback selection (D-106).
 *
 * The one missing composition seam between the modern delegate-skills
 * integration (D-102 detection, D-104 relay, D-105 result mapping) and
 * the generic non-delegate path: given desired state, fresh detection,
 * and whether the caller explicitly requires delegation, route one
 * delegation request through the delegate or the fallback. No manager,
 * no taxonomy, no framework — one function reusing existing contracts:
 *
 * ```text
 * disabled                     → fallback (generic) / failure (required);
 *                                 delegate never invoked, not even probed
 * enabled + detection failure  → fallback (generic) / failure (required)
 * enabled + detected absence   → fallback (generic) / failure (required)
 * enabled + available          → primary attempt, then
 *                                fallback (generic) / identical
 *                                rejection (required)
 * ```
 *
 * Detection absence (`available: false`) and detection failure (the
 * probe threw or broke its contract) stay distinct all the way into
 * the required-operation error text. Nothing is ever installed,
 * initialized, retried, persisted, reconfigured, or committed here:
 * recovery is "fallback or bounded failure", and every upstream seam
 * (D-102, D-104, D-105) is composed, never reimplemented. The generic
 * framework cares only about success vs failure plus the existing
 * bounded error information; upstream-only fields (session, touched
 * files, usage, skill metadata) stay adapter-local because the result
 * contract is unchanged.
 */

import {
  DelegateProvider,
  DelegationRequest,
  DelegationResult,
  isDelegateProvider,
  validateDelegationRequest,
} from "./delegate";
import {
  DetectionResult,
  isDetectionResult,
} from "./integration";

/** Selection input. Desired state arrives as a boolean (I-004 at the caller); no config is read here. */
export interface DelegateGenerationInput {
  /** Work handed to whichever provider runs, carried verbatim. */
  readonly request: DelegationRequest;
  /** Desired state: false means delegation is not selected, never probed. */
  readonly delegateEnabled: boolean;
  /** True when the caller explicitly requires delegation: never silently fall back. */
  readonly requireDelegate: boolean;
  /** Fresh D-102 detection; rejection means detection failure. */
  readonly detectDelegate: () => Promise<DetectionResult>;
  /** The delegate path (D-104 relay provider); invoked only when selected. */
  readonly primary: DelegateProvider;
  /** Generic non-delegate path; receives the original request on fallback. */
  readonly fallback: DelegateProvider;
}

function fail(what: string): never {
  throw new Error(`delegate fallback: ${what}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Route one delegation request through the delegate path when it is
 * selected and healthy, else through the generic fallback (optional
 * operations) or a bounded failure (explicitly required operations).
 * Single attempt per provider, no retries, no side effects beyond the
 * providers' own delegation.
 */
export async function generateDelegateResult(
  input: DelegateGenerationInput,
): Promise<DelegationResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a generation input object");
  }
  const request = validateDelegationRequest(input.request);
  if (typeof input.delegateEnabled !== "boolean") {
    fail("delegateEnabled must be a boolean");
  }
  if (typeof input.requireDelegate !== "boolean") {
    fail("requireDelegate must be a boolean");
  }
  if (typeof input.detectDelegate !== "function") {
    fail("detectDelegate must be a function");
  }
  if (!isDelegateProvider(input.primary)) {
    fail("primary must be a delegation provider");
  }
  if (!isDelegateProvider(input.fallback)) {
    fail("fallback must be a delegation provider");
  }

  if (!input.delegateEnabled) {
    if (input.requireDelegate) {
      fail(
        "delegate is explicitly required but disabled " +
          "(delegateEnabled is false); not falling back",
      );
    }
    return input.fallback.delegate(request);
  }

  let detected: DetectionResult;
  try {
    const raw = await input.detectDelegate();
    if (!isDetectionResult(raw)) {
      throw new Error("detection broke its result contract");
    }
    detected = raw;
  } catch (error: unknown) {
    if (input.requireDelegate) {
      fail(
        "delegate is explicitly required but detection failed " +
          `(${errorMessage(error)})`,
      );
    }
    return input.fallback.delegate(request);
  }
  if (!detected.available) {
    if (input.requireDelegate) {
      fail(
        "delegate is explicitly required but unavailable " +
          `(${detected.detail ?? "no detail"})`,
      );
    }
    return input.fallback.delegate(request);
  }
  try {
    return await input.primary.delegate(request);
  } catch (error: unknown) {
    if (input.requireDelegate) {
      throw error;
    }
    return input.fallback.delegate(request);
  }
}
