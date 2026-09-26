/**
 * Generic ticket write boundary (M18 R-008).
 *
 * The smallest seam that lets the production Coordinator
 * runtime persist/synchronize its workflow result without
 * coupling orchestration to GitHub, a database, or any
 * tracker. One capability only: write one
 * Coordinator-compatible ticket after the Coordinator has
 * already selected it and owns its transitions. No create,
 * delete, complete, list, search, poll, sync-all, retry,
 * rollback, queue, or event behavior — the sink owns
 * persistence/synchronization only, never workflow decisions.
 *
 * ```text
 * TicketSource  → obtaining work (read-only)
 * Coordinator   → selecting work, owning transitions
 * TicketSink    → persisting the resulting ticket (write-only)
 * ```
 *
 * The sink receives the existing `CoordinatorTicket` shape —
 * no parallel ticket model, no state mapping, no tracker
 * labels or comments. It knows nothing about selection,
 * transitions, roles, providers, OpenCode, or delegate-skills;
 * the Coordinator never knows about the sink; the source
 * never knows about the sink. No GitHub, SDK, CLI, network,
 * filesystem, configuration, or persistence implementation
 * exists here — those are concrete integrations for later
 * tickets. Hermetic callers use fakes.
 */

import { CoordinatorTicket } from "./coordinator";

/**
 * Write-only ticket sink: persist/synchronize one ticket the
 * Coordinator already processed. Called at most once per
 * application invocation, with the final in-memory ticket
 * representation, never a reconstructed one.
 */
export interface TicketSink {
  updateTicket(ticket: CoordinatorTicket): Promise<void>;
}

/** Structural guard: an object exposing an async `updateTicket`. */
export function isTicketSink(value: unknown): value is TicketSink {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return typeof (value as { updateTicket?: unknown }).updateTicket === "function";
}
