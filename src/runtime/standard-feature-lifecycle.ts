/**
 * STANDARD Feature Lifecycle (M29 T-040).
 *
 * The dedicated public entry point for running one feature
 * through the established STANDARD lifecycle. A thin, honest
 * wrapper following the T-039 pattern: it fixes the mode to
 * `standard`, refuses any caller mode field rather than
 * silently replacing it (explicit selection disputes belong
 * to the mode recommendation/guardrail contracts, not to
 * this entry point), and delegates everything else to the
 * canonical `runStandard` engine unchanged — Coordinator
 * Planning (its PM-bound handoff exposed as provenance,
 * never consumed), Technical Lead evidence review over
 * caller-supplied evidence, Implementer over the caller
 * ticket, Senior Reviewer plus the explicit review decision,
 * with the existing `StandardResult` union returned
 * verbatim. No direct Coordinator→TL handoff is invented:
 * none exists in the engine, and this wrapper adds none.
 *
 * Deliberately absent: no second role pipeline, no PM
 * planning, no dual approvals, no Sprint/Task generation or
 * persistence, no TL acceptance, PM validation, or final
 * approval, no re-entry loops, no delegation, no CLI, no
 * orchestration framework. Validation describes and executes
 * nothing beyond delegating to `runStandard`.
 */

import { runStandard, StandardInput, StandardResult } from "./standard-path";

/**
 * Feature-lifecycle inputs: exactly the STANDARD path
 * contract minus the mode, which this workflow fixes. No
 * mode field is accepted — a present one is rejected, never
 * replaced.
 */
export type StandardFeatureLifecycleInput = Omit<StandardInput, "mode">;

/** Feature-lifecycle outcomes: the canonical STANDARD result union, preserved verbatim. */
export type StandardFeatureLifecycleResult = StandardResult;

function fail(what: string): never {
  throw new Error(`standard feature lifecycle: ${what}`);
}

/**
 * Run one feature through the STANDARD lifecycle. Validates
 * the envelope, rejects any caller-supplied mode field
 * explicitly, and delegates to `runStandard` with mode fixed
 * to `standard`. Returns the engine result unchanged. Pure
 * delegation: no stages, no retries, no side effects of its
 * own.
 */
export async function runStandardFeatureLifecycle(
  input: StandardFeatureLifecycleInput,
): Promise<StandardFeatureLifecycleResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a feature lifecycle input object");
  }
  if ("mode" in input && (input as Record<string, unknown>).mode !== undefined) {
    fail('explicit mode selection is not accepted here; resolve mode choice through checkModeGuardrails before selecting this workflow');
  }
  return runStandard({ ...(input as StandardInput), mode: "standard" });
}
