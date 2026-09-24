/**
 * Delegation safety confirmation (D-005).
 *
 * The explicit pre-delegation boundary: delegation is never an
 * implicitly trusted operation. The runtime gathers the human decision
 * through its existing channel (the `needs_user_input` ticket state,
 * mediated by the Coordinator) and calls `requireDelegationConfirmation`
 * with that decision before any delegate operation is allowed.
 *
 * Three states only: an explicit "confirmed", an explicit "rejected",
 * and "pending" for a missing decision. Missing input is never
 * confirmation, and nothing here confirms automatically. In
 * particular, the D-004 setting and D-002 detection never imply
 * confirmation — they are separate concerns owned by other tickets
 * and are not consulted here.
 *
 * This module is generic: it names no tool, command, integration, or
 * transport, runs nothing, and changes no ticket state. It is not a
 * second gate system — the W-004/W-005 ticket flows are untouched;
 * this is the smaller check the runtime applies to the explicit
 * human decision.
 */

/** Explicit human decision for a pending delegation. */
export type DelegationConfirmation = "confirmed" | "rejected" | "pending";

/** True for the exact decision strings this seam accepts. */
export function isDelegationConfirmation(value: unknown): value is DelegationConfirmation {
  return value === "confirmed" || value === "rejected" || value === "pending";
}

/**
 * Normalize raw input to an explicit decision. Only the exact
 * decision strings are accepted; `undefined`/`null` (no answer yet)
 * resolve to "pending". Anything else — booleans, numbers, objects,
 * natural-language text — is rejected rather than interpreted, so
 * setting flags, detection results, and prose can never read
 * as confirmation.
 */
export function resolveDelegationConfirmation(value: unknown): DelegationConfirmation {
  if (value === undefined || value === null) {
    return "pending";
  }
  if (isDelegationConfirmation(value)) {
    return value;
  }
  throw new Error(
    `delegate confirmation: unknown confirmation ${JSON.stringify(value) ?? String(value)}; expected "confirmed" or "rejected"`,
  );
}

/**
 * Enforce the confirmation boundary. Returns only for an explicit
 * "confirmed"; every other decision — rejected, pending, or missing —
 * throws, so the caller must not proceed with delegation.
 */
export function requireDelegationConfirmation(value: unknown): void {
  const confirmation = resolveDelegationConfirmation(value);
  if (confirmation !== "confirmed") {
    throw new Error("delegate confirmation: delegation requires explicit confirmation");
  }
}
