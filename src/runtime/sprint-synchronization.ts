/**
 * Explicit state synchronization and sprint re-entry policy
 * (M19 E2E-002).
 *
 * Two small pieces beside (never inside) the E2E-001
 * traversal, keeping orchestration and persistence separate:
 *
 * 1. `synchronizeSprintOutcome` closes exactly the tickets
 *    eligible for closure after explicit final approval —
 *    one sequential `TicketSink.updateTicket` call per
 *    eligible ticket, in caller order, with defensive frozen
 *    copies (`state: "closed"`, all other data preserved).
 *    The caller's objects are never mutated.
 * 2. `sprintReentryStatus` purely classifies whether the
 *    caller may explicitly invoke the workflow again. It
 *    invokes nothing, schedules nothing, and creates
 *    nothing.
 *
 * Eligibility uses existing workflow semantics, never a new
 * state machine: only `technical_approval` and `pm_review`
 * tickets close — both have passed the ticket-level
 * implementation boundary (their onward edges are TL/PM
 * owned), so they are actually part of the completed flow.
 * Every other state is excluded: terminal tickets need no
 * re-closure, and incomplete, blocked, waiting, failed, or
 * unactionable tickets are never forced shut. Any
 * non-`completed` workflow outcome (or empty eligibility)
 * means zero sink calls: `sync-not-ready` for non-final
 * outcomes, vacuous `synchronized` when nothing is eligible.
 *
 * Sink failure stops at the first rejection with a bounded
 * `sync-failed` carrying the ids already synchronized —
 * partial success stays observable, with no retry, no
 * rollback, no compensation, and no atomicity claims.
 *
 * Re-entry stays caller-controlled: `work-remaining` and
 * post-correction states are reenterable by explicit
 * re-invocation (R-002 selection still owns ticket choice);
 * failures and withheld approvals need attention first;
 * `completed` is terminal; a `sync-failed` result is never
 * terminal success. The aggregated TL correction
 * `IssueReference` never becomes an implicit
 * `CoordinatorTicket` here — translating externally created
 * correction work into executable work belongs to a later
 * production layer.
 */

import { CoordinatorTicket, isTicket } from "./coordinator";
import { TicketSink, isTicketSink } from "./ticket-sink";
import { SprintWorkflowResult } from "./sprint-workflow";

/**
 * States eligible for final closure: past the ticket-level
 * implementation boundary per W-002 (TL acceptance passed),
 * hence actually part of the completed flow. Nothing else —
 * terminal, incomplete, blocked, waiting, failed, or
 * unactionable states never close here.
 */
function isClosable(ticket: CoordinatorTicket): boolean {
  return ticket.state === "technical_approval" || ticket.state === "pm_review";
}

export interface SprintSynchronizationInput {
  /** Caller-owned tickets; read for eligibility, never mutated. */
  readonly tickets: CoordinatorTicket[];
  /** Explicit E2E-001 orchestration result; only `completed` synchronizes. */
  readonly workflow: SprintWorkflowResult;
  /** Caller-supplied sink; the only persistence boundary. */
  readonly ticketSink: TicketSink;
}

export interface SprintSynchronized {
  readonly outcome: "synchronized";
  /** Ids actually closed, in caller order (empty when nothing was eligible). */
  readonly synchronizedIds: readonly string[];
}

export interface SprintSyncNotReady {
  readonly outcome: "sync-not-ready";
  readonly reason: string;
}

export interface SprintSyncFailed {
  readonly outcome: "sync-failed";
  /** Ids closed before the failure; later tickets were not attempted. */
  readonly synchronizedIds: readonly string[];
  readonly error: { readonly kind: string; readonly message: string };
}

export type SprintSynchronizationResult =
  | SprintSynchronized
  | SprintSyncNotReady
  | SprintSyncFailed;

function fail(what: string): never {
  throw new Error(`sprint synchronization: ${what}`);
}

/**
 * Synchronize one explicit final approval: close each
 * eligible ticket through the sink, sequentially and in
 * caller order. All validation happens before the first
 * sink call; the first rejection stops the pass.
 */
export async function synchronizeSprintOutcome(
  input: SprintSynchronizationInput,
): Promise<SprintSynchronizationResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a synchronization input object");
  }
  if (!Array.isArray(input.tickets)) {
    fail("tickets must be an array");
  }
  for (const ticket of input.tickets) {
    if (!isTicket(ticket)) {
      fail("every ticket must carry id, title, description, requirements, and a valid state");
    }
  }
  if (!isTicketSink(input.ticketSink)) {
    fail("ticketSink must satisfy the ticket sink contract");
  }
  const workflow = input.workflow;
  if (typeof workflow !== "object" || workflow === null || Array.isArray(workflow)) {
    return Object.freeze({ outcome: "sync-not-ready", reason: "sprint workflow: no orchestration result" } as const);
  }
  const outcome = (workflow as { outcome?: unknown }).outcome;
  if (outcome !== "completed") {
    return Object.freeze({
      outcome: "sync-not-ready",
      reason: `sprint workflow outcome ${JSON.stringify(outcome)} is not final approval`,
    } as const);
  }
  const seen = new Set<string>();
  const eligible: CoordinatorTicket[] = [];
  for (const ticket of input.tickets) {
    if (isClosable(ticket) && !seen.has(ticket.id)) {
      seen.add(ticket.id);
      eligible.push(ticket);
    }
  }
  const synchronizedIds: string[] = [];
  for (const ticket of eligible) {
    const closed: CoordinatorTicket = Object.freeze({ ...ticket, state: "closed" as const });
    try {
      await input.ticketSink.updateTicket(closed);
    } catch (error) {
      return Object.freeze({
        outcome: "sync-failed",
        synchronizedIds: Object.freeze([...synchronizedIds]),
        error: {
          kind: "ticket-synchronization-failed",
          message: error instanceof Error ? error.message : String(error),
        },
      } as const);
    }
    synchronizedIds.push(ticket.id);
  }
  return Object.freeze({ outcome: "synchronized", synchronizedIds: Object.freeze([...synchronizedIds]) } as const);
}

export type SprintReentryStatus =
  | "reenterable"
  | "terminal"
  | "attention-required"
  | "synchronization-failed";

/**
 * Classify whether the caller may explicitly invoke the
 * sprint workflow again. Pure and deterministic: reads one
 * explicit result outcome, invokes nothing, mutates nothing,
 * schedules nothing. `work-remaining` and post-correction
 * states are reenterable once their external work lands;
 * failures and withheld approvals need attention first;
 * `completed` is terminal; a sync failure is never terminal
 * success. Unknown outcomes throw rather than guess.
 */
export function sprintReentryStatus(
  result: SprintWorkflowResult | SprintSynchronizationResult,
): SprintReentryStatus {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    fail("expected a workflow or synchronization result object");
  }
  switch ((result as { outcome?: unknown }).outcome) {
    case "completed":
      return "terminal";
    case "work-remaining":
    case "technical-lead-corrections-required":
      return "reenterable";
    case "failed":
    case "technical-lead-not-ready":
    case "correction-creation-failed":
    case "pm-not-ready":
    case "pm-changes-required":
    case "final-approval-not-ready":
    case "final-approval-rejected":
    case "sync-not-ready":
      return "attention-required";
    case "synchronized":
      return "terminal";
    case "sync-failed":
      return "synchronization-failed";
    default:
      fail(`unknown result outcome ${JSON.stringify((result as { outcome?: unknown }).outcome)}`);
  }
}
