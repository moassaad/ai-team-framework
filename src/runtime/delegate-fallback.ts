/**
 * Delegate Failure Fallback (M26 T-025).
 *
 * Explicit, user-controlled manual continuation for a failed
 * delegated dispatch — the final M26 ticket:
 *
 *   delegate transport fails
 *     → createManualFallback(failure)
 *     → { transport: "manual", handoff, renderedHandoff }
 *     → human copies the rendering into `--handoff-stdin`
 *
 * Design determinations (repository-grounded, no STOP needed):
 *
 * - Explicit, not automatic: the caller invokes this helper, and
 *   nothing executes. The T-021 dispatcher is untouched —
 *   successful dispatches carry no fallback, and failures stay
 *   transport-level failures. Invocation is the opt-in.
 * - Every failure kind qualifies: each `HandoffDispatchFailed`
 *   already carries a validated canonical handoff, and manual
 *   continuation is valid regardless of why delegation failed
 *   (unsupported, unavailable relay, launch failure, malformed
 *   result, authentication, generic transport error). No
 *   evidence excludes any kind.
 * - Representation is the canonical renderer: `renderedHandoff`
 *   is byte-equal to `renderAgentHandoff(failure.handoff)` —
 *   no second handoff format, no wrapper, no delegate metadata
 *   inside the handoff. T-018 parses it unchanged.
 * - Fallback changes transport, never destination: `handoff.to`
 *   is preserved exactly; no retargeting, no retry, no second
 *   transport, no local execution, no persistence, no
 *   configuration or capability mutation.
 *
 * Pure and synchronous: validate the failure shape, re-validate
 * the handoff through the canonical contract, render, freeze.
 * Successful dispatch results are rejected (nothing failed, so
 * no fallback exists). Error text is carried, never parsed, and
 * never appended to the handoff.
 */

import { AgentHandoff } from "../roles/handoff";
import { renderAgentHandoff, validateAgentHandoff } from "../roles/handoff-validation";
import { RoleId, isRoleId } from "../roles/contract";
import { HandoffDispatchFailed } from "./handoff-dispatcher";

/** Manual transport marker for fallback results. */
export const MANUAL_FALLBACK_TRANSPORT = "manual" as const;

export interface ManualFallbackInput {
  /** An existing dispatch failure; successful results are rejected. */
  readonly failure: unknown;
}

/**
 * Explicit manual continuation for one failed dispatch. Carries
 * the original validated handoff untouched, its canonical
 * rendering for human copy/paste, and the preserved failure
 * identity (transport, destination, error kind/message).
 * Frozen. Performs nothing.
 */
export interface ManualFallback {
  readonly transport: typeof MANUAL_FALLBACK_TRANSPORT;
  /** The original handoff destination, unchanged. */
  readonly destination: RoleId;
  /** The original validated handoff, never reconstructed. */
  readonly handoff: AgentHandoff;
  /** Copy-ready text, byte-equal to the canonical rendering. */
  readonly renderedHandoff: string;
  /** The failed delegate transport name, for diagnostics only. */
  readonly failedTransport: string;
  /** The preserved dispatch error, carried never parsed. */
  readonly error: { readonly kind: string; readonly message: string };
}

function fail(what: string): never {
  throw new Error(`delegate fallback: ${what}`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

/**
 * Derive explicit manual continuation from one dispatch
 * failure. Validates the failure envelope (failed outcome,
 * named transport, canonical destination matching the handoff,
 * structured error), re-validates the handoff canonically,
 * renders it with the canonical renderer, and returns the
 * frozen fallback. Throws on successful dispatches and on
 * malformed failures; mutates, executes, retries, and persists
 * nothing.
 */
export function createManualFallback(input: ManualFallbackInput): ManualFallback {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a fallback input object");
  }
  const failure = input.failure as Partial<HandoffDispatchFailed> | null | undefined;
  if (typeof failure !== "object" || failure === null || Array.isArray(failure)) {
    fail("failure must be a dispatch result object");
  }
  if (failure.outcome !== "failed") {
    fail(`fallback requires a failed dispatch, got ${JSON.stringify(failure.outcome)}`);
  }
  const failedTransport = nonEmptyString(failure.transport, "failure.transport");
  const handoff = validateAgentHandoff(failure.handoff);
  if (!isRoleId(failure.destination)) {
    fail(`failure destination must be a canonical role, got ${JSON.stringify(failure.destination)}`);
  }
  if (failure.destination !== handoff.to) {
    fail(
      `failure destination ${JSON.stringify(failure.destination)} does not match handoff destination ${JSON.stringify(handoff.to)}`,
    );
  }
  const error = failure.error as { kind?: unknown; message?: unknown } | null | undefined;
  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    fail("failure error must be an object with kind and message");
  }
  const kind = nonEmptyString(error.kind, "failure.error.kind");
  const message = nonEmptyString(error.message, "failure.error.message");
  return Object.freeze({
    transport: MANUAL_FALLBACK_TRANSPORT,
    destination: handoff.to,
    handoff,
    renderedHandoff: renderAgentHandoff(handoff),
    failedTransport,
    error: Object.freeze({ kind, message }),
  } as const);
}
