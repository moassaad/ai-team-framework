/**
 * FAST Bug Lifecycle (M29 T-041).
 *
 * The dedicated public entry point for running one bug fix
 * through the established FAST lifecycle. A thin, honest
 * wrapper following the T-039/T-040 pattern: it fixes the
 * mode to `fast`, refuses any caller mode field rather than
 * silently replacing it (explicit selection disputes belong
 * to the mode recommendation/guardrail contracts, not to
 * this entry point), and delegates everything else to the
 * canonical `runFast` engine unchanged — Implementer over
 * the caller ticket, Senior Reviewer plus the explicit
 * review decision, with the existing `FastResult` union
 * returned verbatim. The ticket is preserved as supplied:
 * no bug-report schema is invented, no severity or priority
 * inferred, no free text parsed, and the project root is
 * never treated as proof of discovery.
 *
 * Deliberately absent: no second fixing engine, no
 * Coordinator/PM/TL planning, no Sprint/Task work, no
 * approvals, acceptance, or validation stages, no correction
 * dispatch or re-entry (a changes-required outcome stops
 * here; M28 contracts are never applied automatically), no
 * delegation, no CLI, no orchestration framework.
 * Validation describes and executes nothing beyond
 * delegating to `runFast`.
 */

import { runFast, FastInput, FastResult } from "./fast-path";

/**
 * Bug-lifecycle inputs: exactly the FAST path contract
 * minus the mode, which this workflow fixes. The ticket
 * describes the bug or correction; no mode field is
 * accepted — a present one is rejected, never replaced.
 */
export type FastBugLifecycleInput = Omit<FastInput, "mode">;

/** Bug-lifecycle outcomes: the canonical FAST result union, preserved verbatim. */
export type FastBugLifecycleResult = FastResult;

function fail(what: string): never {
  throw new Error(`fast bug lifecycle: ${what}`);
}

/**
 * Run one bug fix through the FAST lifecycle. Validates the
 * envelope, rejects any caller-supplied mode field
 * explicitly, and delegates to `runFast` with mode fixed to
 * `fast`. Returns the engine result unchanged. Pure
 * delegation: no stages, no retries, no side effects of its
 * own.
 */
export async function runFastBugLifecycle(
  input: FastBugLifecycleInput,
): Promise<FastBugLifecycleResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a bug lifecycle input object");
  }
  if ("mode" in input && (input as Record<string, unknown>).mode !== undefined) {
    fail('explicit mode selection is not accepted here; resolve mode choice through checkModeGuardrails before selecting this workflow');
  }
  return runFast({ ...(input as FastInput), mode: "fast" });
}
