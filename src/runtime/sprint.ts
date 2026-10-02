/**
 * Sprint completion evaluation (M18 R-016).
 *
 * One pure function answering whether the sprint's executable
 * ticket work is done and the Technical Lead review stage may
 * begin. Read-only over a caller-supplied ticket collection:
 * no mutation, no providers, no source, no configuration, no
 * network, no time, no sprint identity or persistence. The
 * result is runtime metadata, never a workflow state.
 *
 * Classification is derived from the existing W-002 edges and
 * the Coordinator's own selection semantics (R-001/R-002):
 *
 * - `ready`, and `changes_requested` carrying preserved
 *   feedback, are Coordinator-executable (edges to
 *   `in_progress` exist and R-002 requires the feedback).
 * - `in_progress` and `implementation_review` are in-flight:
 *   owned by an ongoing invocation, never completed work.
 * - `technical_approval` and `pm_review` have passed the
 *   ticket-level implementation boundary (their onward edges
 *   are TL/PM-owned), so no executable work remains on them.
 * - `closed` and `cancelled` are terminal (`isTerminalState`).
 * - `blocked` and `needs_user_input` wait on external
 *   resolution (their only exits need a human or TL); they
 *   are reported, never auto-completed.
 * - `failed` needs explicit TL-ordered retry or abort; it is
 *   reported as unresolved, never retried or reopened here.
 * - `changes_requested` without feedback is unactionable
 *   (R-002 cannot run it) and is reported as invalid rather
 *   than silently completed or executed.
 *
 * Readiness holds only when every ticket is complete
 * (`technical_approval`, `pm_review`, `closed`, `cancelled`).
 * An empty collection is vacuously ready: no executable,
 * in-flight, blocked, failed, or invalid work exists. Caller
 * ordering is preserved in every diagnostic list; nothing is
 * sorted, and the full ticket objects never enter the result.
 */

import { CoordinatorTicket, isTicket } from "./coordinator";

export interface SprintCompletionCounts {
  readonly total: number;
  /** Ready plus actionable rework: the Coordinator could act now. */
  readonly executable: number;
  /** In progress or awaiting review: owned by an ongoing invocation. */
  readonly inFlight: number;
  /** Blocked or waiting on human input: needs external resolution. */
  readonly blocked: number;
  /** Failed: needs explicit retry-or-abort handling. */
  readonly failed: number;
  /** Changes requested without feedback: unactionable as given. */
  readonly invalid: number;
  /** Past the implementation boundary or terminal. */
  readonly complete: number;
}

export interface SprintCompletionResult {
  /** True only when no executable, in-flight, blocked, failed, or invalid work remains. */
  readonly readyForTechnicalLeadReview: boolean;
  readonly counts: SprintCompletionCounts;
  /** Ticket ids with executable or in-flight work, in caller order. */
  readonly workRemaining: readonly string[];
  /** Ticket ids needing attention (blocked, failed, invalid), in caller order. */
  readonly attentionNeeded: readonly string[];
}

function fail(what: string): never {
  throw new Error(`sprint completion: ${what}`);
}

function isActionableRework(ticket: CoordinatorTicket): boolean {
  return (
    ticket.state === "changes_requested" &&
    typeof ticket.feedback === "string" &&
    ticket.feedback.length > 0
  );
}

/**
 * Evaluate sprint completion over the caller-owned collection.
 * Pure and deterministic: same input, same frozen result, no
 * side effects of any kind.
 */
export function evaluateSprintCompletion(tickets: CoordinatorTicket[]): SprintCompletionResult {
  if (!Array.isArray(tickets)) {
    fail("tickets must be an array");
  }
  for (const ticket of tickets) {
    if (!isTicket(ticket)) {
      fail("every ticket must carry id, title, description, requirements, and a valid state");
    }
  }
  const counts = { total: 0, executable: 0, inFlight: 0, blocked: 0, failed: 0, invalid: 0, complete: 0 };
  const workRemaining: string[] = [];
  const attentionNeeded: string[] = [];
  for (const ticket of tickets) {
    counts.total += 1;
    switch (ticket.state) {
      case "ready":
        counts.executable += 1;
        workRemaining.push(ticket.id);
        break;
      case "changes_requested":
        if (isActionableRework(ticket)) {
          counts.executable += 1;
          workRemaining.push(ticket.id);
        } else {
          counts.invalid += 1;
          attentionNeeded.push(ticket.id);
        }
        break;
      case "in_progress":
      case "implementation_review":
        counts.inFlight += 1;
        workRemaining.push(ticket.id);
        break;
      case "blocked":
      case "needs_user_input":
        counts.blocked += 1;
        attentionNeeded.push(ticket.id);
        break;
      case "failed":
        counts.failed += 1;
        attentionNeeded.push(ticket.id);
        break;
      case "technical_approval":
      case "pm_review":
      case "closed":
      case "cancelled":
        counts.complete += 1;
        break;
    }
  }
  const readyForTechnicalLeadReview =
    counts.executable === 0 &&
    counts.inFlight === 0 &&
    counts.blocked === 0 &&
    counts.failed === 0 &&
    counts.invalid === 0;
  return Object.freeze({
    readyForTechnicalLeadReview,
    counts: Object.freeze({ ...counts }),
    workRemaining: Object.freeze([...workRemaining]),
    attentionNeeded: Object.freeze([...attentionNeeded]),
  });
}
