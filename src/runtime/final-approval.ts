/**
 * Final Coordinator approval boundary (M18 R-020).
 *
 * The last review/approval boundary of M18, after explicit
 * PM/User Testing approval: one explicit caller-supplied
 * final decision over bounded sprint evidence, returned as an
 * immutable result. No provider execution step — final
 * approval is a caller/human authority, and fabricating an AI
 * stage to approve would add machinery without meaning — so
 * the only new seam is the decision resolver plus a
 * provider-less Coordinator authority reference.
 *
 * ```text
 * PM review result (must be approved)
 *    ↓ gate
 * explicit FinalApprovalDecisionResolver (once)
 * approved | changes-required (+notes)
 * ```
 *
 * Read-only throughout: no ticket mutation (nothing moves to
 * `closed` or any other state here), no correction tickets,
 * no IssueProvider/Source/Sink calls, no Coordinator
 * recursion, no PM/user re-entry. A non-approved PM result
 * returns `not-ready` with zero decision calls. Resolver
 * failure returns bounded `decision-failed` with the opaque
 * PM report preserved; malformed resolutions return
 * `invalid-input`. Exactly one decision resolution per call
 * at most — never a retry, never a loop. Later
 * orchestration/E2E work owns translating approval into
 * actual state transitions; M18 stays a collection of
 * explicit boundaries, never a hidden workflow engine.
 */

import { CoordinatorTicket, isTicket } from "./coordinator";
import {
  CoordinatorApprovalReference,
  validateCoordinatorApprovalReference,
} from "./roles";
import { PmUserTestingReviewResult } from "./pm-testing";
import { WorkflowState } from "../workflow/states";

/**
 * Bounded sprint evidence for one ticket: identity, current
 * state, task context, and preserved feedback when the
 * runtime carries it. Current snapshot only, caller order.
 */
export interface FinalApprovalTicketEvidence {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly requirements: string;
  readonly state: WorkflowState;
  readonly feedback?: string;
}

/**
 * Final decision context: sprint scope, bounded evidence,
 * explicit PM approval context, and the opaque PM report.
 * The report is evidence only — never parsed, classified,
 * scored, or mined for corrections.
 */
export interface FinalApprovalDecisionRequest {
  readonly ticket_ids: readonly string[];
  readonly evidence: readonly FinalApprovalTicketEvidence[];
  readonly pmReport: string;
}

/**
 * Final Coordinator decision. `approved` is final Coordinator
 * approval; `changes-required` withholds it (a later layer
 * owns follow-up work — nothing is created here). Deliberately
 * distinct spellings from ticket `changes_requested` and TL
 * `corrections-required`, which carry other semantics.
 */
export interface FinalApprovalDecisionResolution {
  readonly decision: "approved" | "changes-required";
  readonly notes?: string;
}

/**
 * Caller-supplied final decision resolver. Invoked exactly
 * once per approval, with the bounded context above. May be
 * async; never retried.
 */
export type FinalApprovalDecisionResolver = (
  request: FinalApprovalDecisionRequest,
) => FinalApprovalDecisionResolution | Promise<FinalApprovalDecisionResolution>;

/** Structural guard: a callable resolver. */
export function isFinalApprovalDecisionResolver(value: unknown): value is FinalApprovalDecisionResolver {
  return typeof value === "function";
}

export interface FinalApprovalInput {
  /** Caller-owned tickets; evidenced, never mutated. */
  readonly tickets: CoordinatorTicket[];
  /**
   * Completed PM/User Testing result. Only an explicit
   * `approved` opens this stage — never inferred from
   * states, counts, references, or report text.
   */
  readonly pmReview: PmUserTestingReviewResult;
  /** Explicit Coordinator approval authority (no provider). */
  readonly coordinator: CoordinatorApprovalReference;
  /** Explicit final decision resolver; never defaulted. */
  readonly decideFinalApproval: FinalApprovalDecisionResolver;
}

export interface FinalApprovalNotReady {
  readonly outcome: "not-ready";
  /** The PM outcome that closed this stage (or "invalid" for malformed results). */
  readonly pmOutcome: string;
}

export interface FinalApprovalInvalidInput {
  readonly outcome: "invalid-input";
  readonly error: { readonly kind: string; readonly message: string };
}

export interface FinalApprovalApproved {
  readonly outcome: "approved";
  readonly ticket_ids: readonly string[];
  readonly pmReport: string;
}

export interface FinalApprovalChangesRequired {
  readonly outcome: "changes-required";
  readonly ticket_ids: readonly string[];
  readonly pmReport: string;
  readonly notes?: string;
}

export interface FinalApprovalDecisionFailed {
  readonly outcome: "decision-failed";
  readonly ticket_ids: readonly string[];
  readonly pmReport: string;
  readonly error: { readonly kind: string; readonly message: string };
}

export type FinalApprovalResult =
  | FinalApprovalNotReady
  | FinalApprovalInvalidInput
  | FinalApprovalApproved
  | FinalApprovalChangesRequired
  | FinalApprovalDecisionFailed;

function invalid(message: string): FinalApprovalInvalidInput {
  return Object.freeze({
    outcome: "invalid-input",
    error: { kind: "invalid_input", message },
  } as const);
}

function failDecision(what: string): never {
  throw new Error(`final approval decision: ${what}`);
}

function validateResolution(value: unknown): FinalApprovalDecisionResolution {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    failDecision("resolution must be an object");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.decision !== "approved" && candidate.decision !== "changes-required") {
    failDecision(`unknown verdict ${JSON.stringify(candidate.decision)}`);
  }
  if (candidate.notes !== undefined) {
    if (typeof candidate.notes !== "string" || candidate.notes.length === 0) {
      failDecision("notes must be a non-empty string");
    }
    return Object.freeze({ decision: candidate.decision, notes: candidate.notes });
  }
  return Object.freeze({ decision: candidate.decision });
}

/**
 * Run one final Coordinator approval: validate everything,
 * gate on explicit PM approval, resolve the explicit final
 * decision once, and return the bounded immutable result.
 * Tickets are never mutated; nothing is created, closed,
 * sunk, persisted, scheduled, or retried.
 */
export async function runFinalApproval(
  input: FinalApprovalInput,
): Promise<FinalApprovalResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return invalid("final approval: expected an approval input object");
  }
  if (!Array.isArray(input.tickets)) {
    return invalid("final approval: tickets must be an array");
  }
  for (const ticket of input.tickets) {
    if (!isTicket(ticket)) {
      return invalid("final approval: every ticket must carry id, title, description, requirements, and a valid state");
    }
  }
  try {
    validateCoordinatorApprovalReference(input.coordinator);
  } catch (error) {
    return invalid(error instanceof Error ? error.message : String(error));
  }
  if (!isFinalApprovalDecisionResolver(input.decideFinalApproval)) {
    return invalid("final approval: decideFinalApproval must be a decision resolver");
  }
  const pmReview = input.pmReview;
  const pmOutcome =
    typeof pmReview === "object" && pmReview !== null && !Array.isArray(pmReview)
      ? String((pmReview as { outcome?: unknown }).outcome)
      : "invalid";
  if (pmOutcome !== "approved") {
    return Object.freeze({ outcome: "not-ready", pmOutcome } as const);
  }
  const pmReport = (pmReview as { report?: unknown }).report;
  if (typeof pmReport !== "string" || pmReport.length === 0) {
    return invalid("final approval: approved PM result must carry a report");
  }
  const ticket_ids = Object.freeze(input.tickets.map((ticket) => ticket.id));
  const evidence: FinalApprovalTicketEvidence[] = input.tickets.map((ticket) => ({
    id: ticket.id,
    title: ticket.title,
    description: ticket.description,
    requirements: ticket.requirements,
    state: ticket.state,
    ...(ticket.feedback !== undefined ? { feedback: ticket.feedback } : {}),
  }));

  let resolved: unknown;
  try {
    resolved = await input.decideFinalApproval({ ticket_ids, evidence: Object.freeze(evidence), pmReport });
  } catch (error) {
    return Object.freeze({
      outcome: "decision-failed",
      ticket_ids,
      pmReport,
      error: {
        kind: "decision_error",
        message: error instanceof Error ? error.message : String(error),
      },
    } as const);
  }
  let resolution: FinalApprovalDecisionResolution;
  try {
    resolution = validateResolution(resolved);
  } catch (error) {
    return Object.freeze({
      outcome: "invalid-input",
      error: {
        kind: "invalid_decision",
        message: error instanceof Error ? error.message : String(error),
      },
    } as const);
  }
  if (resolution.decision === "approved") {
    return Object.freeze({ outcome: "approved", ticket_ids, pmReport } as const);
  }
  return Object.freeze({
    outcome: "changes-required",
    ticket_ids,
    pmReport,
    ...(resolution.notes !== undefined ? { notes: resolution.notes } : {}),
  } as const);
}
