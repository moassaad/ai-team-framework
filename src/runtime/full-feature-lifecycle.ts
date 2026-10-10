/**
 * FULL Feature Lifecycle (M29 T-039).
 *
 * The dedicated public entry point for running one feature
 * through the established FULL lifecycle. A thin, honest
 * wrapper: it fixes the mode to `full`, refuses any caller
 * mode field rather than silently replacing it (explicit
 * selection disputes belong to the mode
 * recommendation/guardrail contracts, not to this entry
 * point), and delegates everything else to the canonical
 * `runFull` engine unchanged — same stages, same approvals,
 * same task selection, same persistence, same stop
 * semantics, same result union returned verbatim.
 *
 * Deliberately absent: no second lifecycle sequence, no
 * stage reimplementation, no provider parsing, no
 * discovery run (an extra planning Sprint would persist
 * before the feature begins — `discovery_summary`, when
 * supplied, passes straight through to the existing
 * contract), no re-entry loops over M28 outcomes, no
 * delegation, no scaffolding, no CLI, no orchestration
 * framework. Validation describes and executes nothing
 * beyond delegating to `runFull`.
 */

import { runFull, FullInput, FullResult } from "./full-path";

/**
 * Feature-lifecycle inputs: exactly the FULL path contract
 * minus the mode, which this workflow fixes. No mode field
 * is accepted — a present one is rejected, never replaced.
 */
export type FullFeatureLifecycleInput = Omit<FullInput, "mode">;

/** Feature-lifecycle outcomes: the canonical FULL result union, preserved verbatim. */
export type FullFeatureLifecycleResult = FullResult;

function fail(what: string): never {
  throw new Error(`full feature lifecycle: ${what}`);
}

/**
 * Run one feature through the FULL lifecycle. Validates the
 * envelope, rejects any caller-supplied mode field
 * explicitly, and delegates to `runFull` with mode fixed to
 * `full`. Returns the engine result unchanged. Pure
 * delegation: no stages, no retries, no side effects of its
 * own.
 */
export async function runFullFeatureLifecycle(
  input: FullFeatureLifecycleInput,
): Promise<FullFeatureLifecycleResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a feature lifecycle input object");
  }
  if ("mode" in input && (input as Record<string, unknown>).mode !== undefined) {
    fail('explicit mode selection is not accepted here; resolve mode choice through checkModeGuardrails before selecting this workflow');
  }
  return runFull({ ...(input as FullInput), mode: "full" });
}
