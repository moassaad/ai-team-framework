/**
 * Read-only ticket source boundary (M18 R-007).
 *
 * The smallest generic seam letting the production Coordinator
 * runtime obtain its tickets from an external source instead of
 * a caller-owned array. One capability only: list the current
 * tickets for a single Coordinator invocation. No create,
 * update, delete, complete, transition, sync, polling,
 * scheduling, or persistence — the source is read-only from
 * the application's perspective, and returned tickets stay
 * caller/application-owned values the Coordinator mutates in
 * memory exactly as before.
 *
 * ```text
 * TicketSource.listTickets()
 *        ↓ (once per application invocation, unchanged)
 * runCoordinatorTicket(tickets)
 * ```
 *
 * The source returns the existing `CoordinatorTicket` shape —
 * no parallel ticket model. Validation reuses the Coordinator's
 * own `isTicket` guard so malformed source output fails at the
 * boundary before `runCoordinatorTicket` is invoked; empty
 * collections pass through to the Coordinator's authoritative
 * no-work behavior. This seam is deliberately separate from
 * `IssueProvider` (external issue operations, no workflow
 * transitions) and from any tracker: no GitHub, SDK, CLI,
 * network, filesystem, configuration, delegate, model, or
 * session behavior exists here. External synchronization is a
 * later write boundary, not this ticket.
 */

import { CoordinatorTicket, isTicket } from "./coordinator";

/**
 * Read-only ticket source: supply the current tickets for one
 * Coordinator invocation. Called exactly once per application
 * call; must not mutate, persist, or synchronize anything.
 */
export interface TicketSource {
  listTickets(): Promise<CoordinatorTicket[]>;
}

/** Structural guard: an object exposing an async `listTickets`. */
export function isTicketSource(value: unknown): value is TicketSource {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return typeof (value as { listTickets?: unknown }).listTickets === "function";
}

/**
 * Validate a source result with the Coordinator's own ticket
 * guard and return the same collection (never copied or
 * reordered). Throws on non-arrays, malformed entries, invalid
 * states, or missing identity — before the Coordinator runs.
 */
export function validateSourceTickets(value: unknown): CoordinatorTicket[] {
  if (!Array.isArray(value)) {
    throw new Error("ticket source: listTickets must resolve to an array of tickets");
  }
  for (const ticket of value) {
    if (!isTicket(ticket)) {
      throw new Error("ticket source: every ticket must carry id, title, description, requirements, and a valid state");
    }
  }
  return value;
}
