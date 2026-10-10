/**
 * Generic Handoff Dispatcher (M26 T-021).
 *
 * The optional transport layer between an already-decided canonical
 * `AgentHandoff` and whatever delegation transport carries it:
 *
 *   AgentHandoff → dispatchHandoff → HandoffTransport → destination role
 *
 * Manual transport (`renderAgentHandoff` → human copy → `--handoff-stdin`
 * → parse → validate) keeps working with or without this module;
 * both paths preserve identical handoff semantics.
 *
 * Transport-seam decision (repository-grounded): the existing
 * generic delegation seam (`providers/delegate.ts`, D-001) is
 * execution-oriented — opaque text task in, outcome text out,
 * failures reject. The dispatcher must instead carry the
 * structured canonical handoff to the transport, because wire
 * representation belongs inside transport adapters (a T-022
 * adapter will wrap the existing delegation seam behind the small
 * `HandoffTransport` contract below). Reusing the execution-oriented
 * delegation seam directly would force the dispatcher to serialize the handoff
 * to text itself and would conflate dispatch acknowledgement
 * with execution outcome, so a minimal dedicated interface is
 * defined here: a name plus one `dispatch` attempt. No registry,
 * no bus, no configuration semantics — transport selection is an
 * explicit caller-supplied object, validated by shape.
 *
 * Rules (all ticket-derived, nothing invented):
 *
 * - input handoff validated via `validateAgentHandoff` (canonical
 *   shape, canonical roles, approved direction); malformed input
 *   is rejected, never repaired, never retargeted, never rewritten;
 * - destination comes from `handoff.to`; an optional caller
 *   `destination` must equal it exactly or the request is rejected;
 * - one dispatch attempt per call: no retry, no fallback (manual
 *   or otherwise), no local execution, no fan-out, no broadcast;
 * - transport failure yields a bounded `failed` result, never a
 *   second attempt and never a workflow decision; a string `kind`
 *   on the rejection is preserved so later tickets (T-025) can
 *   route on it, otherwise the kind is `transport-error`;
 * - the handoff is never mutated; the transport receives the
 *   validated frozen handoff, and the result carries a defensive
 *   copy of it;
 * - no persistence, no workflow state, no role execution, no
 *   provider reports, no next-role selection, no modes, no
 *   re-entry. Invalid input throws (programmer error, repository
 *   convention); transport failure does not throw.
 *
 * This module imports no delegation implementation and names no
 * external tool: core stays dependency-free and works manually
 * when no transport exists.
 */

import { AgentHandoff } from "../roles/handoff";
import { validateAgentHandoff } from "../roles/handoff-validation";
import { RoleId, isRoleId } from "../roles/contract";

/**
 * Generic delegation transport. Implementations accept the
 * validated canonical handoff and resolve with their own
 * acknowledgement receipt (opaque to the dispatcher, never
 * parsed); they reject on transport failure. Wire
 * representation, if any, lives inside the implementation.
 */
export interface HandoffTransport {
  /** Stable transport identifier, e.g. an adapter name. */
  readonly name: string;
  /** One transport attempt for one canonical handoff. */
  dispatch(handoff: AgentHandoff): Promise<unknown>;
}

/** True for values shaped like a handoff transport. */
export function isHandoffTransport(value: unknown): value is HandoffTransport {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    typeof candidate.dispatch === "function"
  );
}

export interface DispatchHandoffInput {
  /** Canonical handoff to dispatch; validated, never mutated. */
  readonly handoff: unknown;
  /** Explicitly selected transport; validated by shape. */
  readonly transport: unknown;
  /**
   * Optional explicit destination. Must be a canonical `RoleId`
   * exactly equal to `handoff.to`; anything else is rejected.
   * Never retargets the handoff.
   */
  readonly destination?: unknown;
}

export interface HandoffDispatched {
  readonly outcome: "dispatched";
  /** The transport that acknowledged the handoff. */
  readonly transport: string;
  /** The handoff destination (`handoff.to`). */
  readonly destination: RoleId;
  /** Defensive frozen copy of the dispatched handoff. */
  readonly handoff: AgentHandoff;
  /** The transport's acknowledgement, opaque and unparsed. */
  readonly receipt: unknown;
}

export interface HandoffDispatchFailed {
  readonly outcome: "failed";
  /** The transport that was attempted exactly once. */
  readonly transport: string;
  /** The handoff destination (`handoff.to`). */
  readonly destination: RoleId;
  /** Defensive frozen copy of the handoff that was attempted. */
  readonly handoff: AgentHandoff;
  readonly error: { readonly kind: string; readonly message: string };
}

export type DispatchHandoffResult = HandoffDispatched | HandoffDispatchFailed;

function fail(what: string): never {
  throw new Error(`handoff dispatcher: ${what}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorKind(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const kind = (error as Record<string, unknown>).kind;
    if (typeof kind === "string" && kind.length > 0) {
      return kind;
    }
  }
  return "transport-error";
}

/**
 * Dispatch one validated canonical handoff through one explicitly
 * selected transport. Validates the handoff (T-003/T-004) and the
 * transport shape, checks an optional explicit destination against
 * `handoff.to`, then performs exactly one transport attempt.
 * Resolves to a frozen `dispatched` result carrying the
 * transport's opaque receipt, or a frozen `failed` result on
 * transport rejection. Never retries, never falls back, never
 * executes a role, never persists anything.
 */
export async function dispatchHandoff(input: DispatchHandoffInput): Promise<DispatchHandoffResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a dispatch input object");
  }
  const handoff = validateAgentHandoff(input.handoff);
  if (!isHandoffTransport(input.transport)) {
    fail("transport must satisfy the handoff transport contract (non-empty name plus dispatch function)");
  }
  const transport = input.transport;
  if (input.destination !== undefined) {
    if (!isRoleId(input.destination)) {
      fail(`destination must be a canonical role, got ${JSON.stringify(input.destination)}`);
    }
    if (input.destination !== handoff.to) {
      fail(
        `destination ${JSON.stringify(input.destination)} does not match handoff destination ${JSON.stringify(handoff.to)}; retargeting is forbidden`,
      );
    }
  }
  let receipt: unknown;
  try {
    receipt = await transport.dispatch(handoff);
  } catch (error: unknown) {
    return Object.freeze({
      outcome: "failed",
      transport: transport.name,
      destination: handoff.to,
      handoff,
      error: Object.freeze({ kind: errorKind(error), message: errorMessage(error) }),
    } as const);
  }
  if (receipt === undefined) {
    return Object.freeze({
      outcome: "failed",
      transport: transport.name,
      destination: handoff.to,
      handoff,
      error: Object.freeze({ kind: "transport-error", message: "transport resolved without an acknowledgement receipt" }),
    } as const);
  }
  return Object.freeze({
    outcome: "dispatched",
    transport: transport.name,
    destination: handoff.to,
    handoff,
    receipt,
  } as const);
}
