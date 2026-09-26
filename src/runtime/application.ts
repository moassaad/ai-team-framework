/**
 * Production Coordinator application boundary (M18 R-006).
 *
 * The smallest real-application composition of the M18 runtime:
 * one async operation binding an explicit OpenCode string agent
 * through the R-005 execution adapter and the R-004 production
 * dependencies into a single `runCoordinatorTicket(...)` call.
 * Composition lives here; orchestration stays in the
 * Coordinator; OpenCode execution stays in the provider.
 *
 * ```text
 * openCodeAgent (caller-supplied AgentProvider<string>)
 *        ↓ createOpenCodeExecutionProvider
 * AgentProvider<ExecutionResult> (one shared instance, both roles)
 *        ↓ createProductionCoordinatorDeps
 * RoleResolver
 *        ↓ runCoordinatorTicket
 * Coordinator result (passed through unchanged)
 * ```
 *
 * The caller owns the ticket collection — it arrives in the
 * input and is never stored, copied to a database, polled, or
 * scheduled. One application call means one Coordinator call:
 * no loops, no background work, no CLI, no persistence. The
 * specialty arrives explicitly (never classified); the same
 * adapted provider serves Implementer and Reviewer (the role
 * contract permits sharing; distinct instances are neither
 * required nor constructed). Composition failures (malformed
 * agent, unknown specialty) throw before any ticket executes
 * and stay distinguishable from Coordinator workflow failures,
 * which return as results. No delegate, model, fleet, session,
 * retry, Git, or configuration behavior exists here.
 */

import { AgentProvider } from "../providers/agent";
import { ImplementerSpecialty } from "../roles/contract";
import { createOpenCodeExecutionProvider } from "../providers/opencode-execution";
import { createProductionCoordinatorDeps } from "./production";
import {
  CoordinatorTicket,
  CoordinatorTicketResult,
  runCoordinatorTicket,
} from "./coordinator";
import { ReviewDecisionResolver } from "./review-decision";
import {
  TicketSource,
  isTicketSource,
  validateSourceTickets,
} from "./ticket-source";
import { TicketSink, isTicketSink } from "./ticket-sink";

/**
 * Application input. Tickets and every production ingredient
 * arrive explicitly; nothing is defaulted, discovered, or read
 * from configuration or the environment.
 */
export interface ProductionApplicationInput {
  /** Caller-owned tickets; the Coordinator selects and mutates in place. */
  readonly tickets: CoordinatorTicket[];
  /** Implementer specialty, decided externally by the caller. */
  readonly specialty: ImplementerSpecialty;
  /** Ready-made OpenCode string agent (such as `createOpenCodeProvider()` output). */
  readonly openCodeAgent: AgentProvider<string>;
  /** Target project root for both provider invocations. */
  readonly project_root: string;
  /** Execution bound in milliseconds for each invocation. */
  readonly timeout_ms: number;
  /**
   * Explicit review decision resolver, passed through to the
   * Coordinator unchanged; resolved after Reviewer execution.
   */
  readonly decideReview: ReviewDecisionResolver;
  /** Pre-computed discovery summary, when available. */
  readonly discovery_summary?: string;
}

function fail(what: string): never {
  throw new Error(`production application: ${what}`);
}

/**
 * Run one production Coordinator invocation: adapt, assemble,
 * execute, pass the Coordinator result through unchanged.
 * Composition errors throw before execution; workflow outcomes
 * (including failures) return as results.
 */
export async function runProductionCoordinator(
  input: ProductionApplicationInput,
): Promise<CoordinatorTicketResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected an application input object");
  }
  const execution = createOpenCodeExecutionProvider(input.openCodeAgent);
  const deps = createProductionCoordinatorDeps({
    specialty: input.specialty,
    implementerProvider: execution,
    reviewerProvider: execution,
  });
  return runCoordinatorTicket({
    tickets: input.tickets,
    roles: deps.roles,
    project_root: input.project_root,
    timeout_ms: input.timeout_ms,
    decideReview: input.decideReview,
    ...(input.discovery_summary !== undefined ? { discovery_summary: input.discovery_summary } : {}),
  });
}

/**
 * Source-fed production application input (M18 R-007). The
 * explicit production path: identical to
 * `ProductionApplicationInput` except tickets arrive through a
 * caller-supplied read-only `TicketSource` instead of a
 * caller-owned array. The direct-array operation above remains
 * as the lower-level seam (runtime tests compose through it);
 * production callers use this function so there is exactly one
 * source-driven production API, never an ambiguous
 * tickets-or-source union.
 */
export interface ProductionSourceApplicationInput {
  /** Read-only ticket source; read exactly once per invocation. */
  readonly ticketSource: TicketSource;
  /**
   * Optional write-only sink for the selected ticket. When
   * omitted the Coordinator runs normally with no persistence
   * (current in-memory behavior); never defaulted, never a
   * local-file fallback.
   */
  readonly ticketSink?: TicketSink;
  /** Implementer specialty, decided externally by the caller. */
  readonly specialty: ImplementerSpecialty;
  /** Ready-made OpenCode string agent (such as `createOpenCodeProvider()` output). */
  readonly openCodeAgent: AgentProvider<string>;
  /** Target project root for both provider invocations. */
  readonly project_root: string;
  /** Execution bound in milliseconds for each invocation. */
  readonly timeout_ms: number;
  /**
   * Explicit review decision resolver, passed through to the
   * Coordinator unchanged; resolved after Reviewer execution.
   */
  readonly decideReview: ReviewDecisionResolver;
  /** Pre-computed discovery summary, when available. */
  readonly discovery_summary?: string;
}

/**
 * Bounded synchronization failure (M18 R-008): the Coordinator
 * ran and advanced the selected ticket, but the caller-supplied
 * sink rejected. The preserved Coordinator result is the
 * evidence that workflow execution completed/advanced; the
 * error says only that synchronization failed. No retry, no
 * rollback, no second ticket — recovery belongs to a later
 * persistence/integration ticket.
 */
export interface ProductionSynchronizationFailed {
  readonly outcome: "sync-failed";
  readonly ticket_id: string;
  readonly coordinatorResult: CoordinatorTicketResult;
  readonly error: { readonly kind: string; readonly message: string };
}

/**
 * Run one source-fed production Coordinator invocation: read
 * the source once, validate its result with the Coordinator's
 * own ticket guard, then delegate to the tickets-based
 * operation (which owns provider assembly and the single
 * Coordinator call). Source rejection propagates wrapped —
 * the Coordinator never runs, nothing is fabricated or
 * retried, and no ticket state mutates. Empty collections
 * reach the Coordinator's authoritative no-work behavior.
 *
 * When `ticketSink` is supplied, the selected ticket is
 * synchronized after Coordinator execution: exactly one
 * `updateTicket` call with the final in-memory ticket, only
 * when a Coordinator result shows the ticket was actually
 * processed and advanced (`completed`, `implementer-failed`
 * to `failed`, `reviewer-failed` to `implementation_review`).
 * `no-work` and `conflict` never touch the sink; unexpected
 * Coordinator errors never touch the sink; sink rejection
 * returns a bounded `sync-failed` result preserving the
 * Coordinator outcome.
 */
export async function runProductionCoordinatorFromSource(
  input: ProductionSourceApplicationInput,
): Promise<CoordinatorTicketResult | ProductionSynchronizationFailed> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected an application input object");
  }
  if (!isTicketSource(input.ticketSource)) {
    fail("ticketSource must satisfy the ticket source contract");
  }
  if (input.ticketSink !== undefined && !isTicketSink(input.ticketSink)) {
    fail("ticketSink must satisfy the ticket sink contract");
  }
  let listed: unknown;
  try {
    listed = await input.ticketSource.listTickets();
  } catch (error) {
    throw new Error("production application: ticket source failed", { cause: error });
  }
  const tickets = validateSourceTickets(listed);
  const result = await runProductionCoordinator({
    tickets,
    specialty: input.specialty,
    openCodeAgent: input.openCodeAgent,
    project_root: input.project_root,
    timeout_ms: input.timeout_ms,
    decideReview: input.decideReview,
    ...(input.discovery_summary !== undefined ? { discovery_summary: input.discovery_summary } : {}),
  });
  if (input.ticketSink === undefined) {
    return result;
  }
  if (
    result.outcome !== "completed" &&
    result.outcome !== "implementer-failed" &&
    result.outcome !== "reviewer-failed"
  ) {
    return result;
  }
  const selected = tickets.find((ticket) => ticket.id === result.ticket_id);
  if (selected === undefined || selected.state !== result.final_state) {
    fail(`ticket ${result.ticket_id} is not in its reported final state; refusing synchronization`);
  }
  try {
    await input.ticketSink.updateTicket(selected);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Object.freeze({
      outcome: "sync-failed",
      ticket_id: result.ticket_id,
      coordinatorResult: result,
      error: { kind: "ticket-synchronization-failed", message },
    } as const);
  }
  return result;
}
