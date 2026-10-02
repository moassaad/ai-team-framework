/**
 * Technical Lead sprint review boundary (M18 R-017).
 *
 * The first sprint-level review stage after Coordinator work
 * is ready: the sprint completion evaluation gates a single
 * Technical Lead provider invocation, whose opaque report
 * feeds an explicit caller-supplied decision. Ticket-level
 * `technical_approval` and sprint-level TL approval stay
 * distinct concepts; Senior Reviewer `changes_requested`
 * (ticket rework) and TL `corrections-required` (new
 * tickets, owned by R-018) never collapse.
 *
 * ```text
 * tickets → evaluateSprintCompletion
 *    ↓ readyForTechnicalLeadReview = true
 * TL provider (role technical-lead, once) → opaque report
 *    ↓ TechnicalLeadDecisionResolver
 * approved | corrections-required (+notes)
 * ```
 *
 * Read-only throughout: no ticket mutation, no correction
 * tickets, no IssueProvider/sink calls, no PM/user stages.
 * A not-ready sprint returns its diagnostics without
 * invoking anything; provider or decision failures return
 * bounded failures with the report preserved when already
 * available. Exactly one TL invocation and one decision
 * resolution per call at most — never a retry, never a loop.
 */

import { CoordinatorTicket, isTicket } from "./coordinator";
import { SprintCompletionResult, evaluateSprintCompletion } from "./sprint";
import {
  TechnicalLeadRoleReference,
  validateTechnicalLeadReference,
} from "./roles";
import {
  TechnicalLeadTicketEvidence,
  executeTechnicalLeadReview,
} from "../execution/technical-lead";

/**
 * TL decision context: sprint scope plus the opaque TL
 * report. No ticket-level fields — the decision is about the
 * sprint, not one ticket.
 */
export interface TechnicalLeadDecisionRequest {
  readonly ticket_ids: readonly string[];
  readonly report: string;
}

/**
 * TL decision resolution. `approved` accepts the sprint;
 * `corrections-required` records that the sprint needs new
 * tickets (created by R-018, never here). Optional notes
 * travel verbatim when the caller supplies them.
 */
export interface TechnicalLeadDecisionResolution {
  readonly decision: "approved" | "corrections-required";
  readonly notes?: string;
}

/**
 * Caller-supplied TL decision resolver. Invoked exactly once
 * per review, after TL provider execution with the opaque
 * report as context. May be async; never retried.
 */
export type TechnicalLeadDecisionResolver = (
  request: TechnicalLeadDecisionRequest,
) => TechnicalLeadDecisionResolution | Promise<TechnicalLeadDecisionResolution>;

/** Structural guard: a callable resolver. */
export function isTechnicalLeadDecisionResolver(value: unknown): value is TechnicalLeadDecisionResolver {
  return typeof value === "function";
}

export interface TechnicalLeadReviewInput {
  /** Caller-owned tickets; evaluated and evidenced, never mutated. */
  readonly tickets: CoordinatorTicket[];
  /** Explicit TL reference (distinct `technical-lead` identity). */
  readonly technicalLead: TechnicalLeadRoleReference;
  /** Target project root for the provider invocation. */
  readonly project_root: string;
  /** Execution bound in milliseconds. */
  readonly timeout_ms: number;
  /** Explicit TL decision resolver; never defaulted. */
  readonly decideTechnicalLead: TechnicalLeadDecisionResolver;
}

export interface TechnicalLeadNotReady {
  readonly outcome: "not-ready";
  readonly evaluation: SprintCompletionResult;
}

export interface TechnicalLeadEvaluationFailed {
  readonly outcome: "evaluation-failed";
  readonly error: { readonly kind: string; readonly message: string };
}

export interface TechnicalLeadApproved {
  readonly outcome: "approved";
  readonly ticket_ids: readonly string[];
  readonly report: string;
}

export interface TechnicalLeadCorrectionsRequired {
  readonly outcome: "corrections-required";
  readonly ticket_ids: readonly string[];
  readonly report: string;
  readonly notes?: string;
}

export interface TechnicalLeadReviewFailed {
  readonly outcome: "review-failed";
  readonly ticket_ids: readonly string[];
  readonly error: { readonly kind: string; readonly message: string };
}

export interface TechnicalLeadDecisionFailed {
  readonly outcome: "decision-failed";
  readonly ticket_ids: readonly string[];
  readonly report: string;
  readonly error: { readonly kind: string; readonly message: string };
}

export type TechnicalLeadReviewResult =
  | TechnicalLeadNotReady
  | TechnicalLeadEvaluationFailed
  | TechnicalLeadApproved
  | TechnicalLeadCorrectionsRequired
  | TechnicalLeadReviewFailed
  | TechnicalLeadDecisionFailed;

function fail(what: string): never {
  throw new Error(`technical lead review: ${what}`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

function validateResolution(value: unknown): TechnicalLeadDecisionResolution {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("decision resolution must be an object");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.decision !== "approved" && candidate.decision !== "corrections-required") {
    fail(`unknown verdict ${JSON.stringify(candidate.decision)}`);
  }
  if (candidate.notes !== undefined) {
    if (typeof candidate.notes !== "string" || candidate.notes.length === 0) {
      fail("decision notes must be a non-empty string");
    }
    return Object.freeze({ decision: candidate.decision, notes: candidate.notes });
  }
  return Object.freeze({ decision: candidate.decision });
}

/**
 * Run one Technical Lead sprint review: validate everything,
 * gate on sprint completion, invoke the TL provider once,
 * resolve the explicit decision once, and return the bounded
 * result. Tickets are never mutated; nothing is created,
 * persisted, scheduled, or retried.
 */
export async function runTechnicalLeadReview(
  input: TechnicalLeadReviewInput,
): Promise<TechnicalLeadReviewResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a review input object");
  }
  if (!Array.isArray(input.tickets)) {
    fail("tickets must be an array");
  }
  for (const ticket of input.tickets) {
    if (!isTicket(ticket)) {
      fail("every ticket must carry id, title, description, requirements, and a valid state");
    }
  }
  const technicalLead = validateTechnicalLeadReference(input.technicalLead);
  const project_root = nonEmptyString(input.project_root, "project_root");
  if (typeof input.timeout_ms !== "number" || !Number.isFinite(input.timeout_ms) || input.timeout_ms <= 0) {
    fail("timeout_ms must be a positive finite number");
  }
  if (!isTechnicalLeadDecisionResolver(input.decideTechnicalLead)) {
    fail("decideTechnicalLead must be a technical lead decision resolver");
  }
  const ticket_ids = Object.freeze(input.tickets.map((ticket) => ticket.id));

  let evaluation: SprintCompletionResult;
  try {
    evaluation = evaluateSprintCompletion(input.tickets);
  } catch (error) {
    return Object.freeze({
      outcome: "evaluation-failed",
      error: {
        kind: "evaluation_error",
        message: error instanceof Error ? error.message : String(error),
      },
    } as const);
  }
  if (!evaluation.readyForTechnicalLeadReview) {
    return Object.freeze({ outcome: "not-ready", evaluation } as const);
  }

  const evidence: TechnicalLeadTicketEvidence[] = input.tickets.map((ticket) => ({
    id: ticket.id,
    title: ticket.title,
    description: ticket.description,
    requirements: ticket.requirements,
    state: ticket.state,
    ...(ticket.feedback !== undefined ? { feedback: ticket.feedback } : {}),
  }));
  const reviewed = await executeTechnicalLeadReview({
    evidence,
    role: technicalLead.role,
    project_root,
    provider: technicalLead.provider,
    timeout_ms: input.timeout_ms,
  });
  if (reviewed.outcome === "failed") {
    return Object.freeze({
      outcome: "review-failed",
      ticket_ids,
      error: reviewed.error,
    } as const);
  }

  let resolved: unknown;
  try {
    resolved = await input.decideTechnicalLead({ ticket_ids, report: reviewed.report });
  } catch (error) {
    return Object.freeze({
      outcome: "decision-failed",
      ticket_ids,
      report: reviewed.report,
      error: {
        kind: "decision_error",
        message: error instanceof Error ? error.message : String(error),
      },
    } as const);
  }
  let resolution: TechnicalLeadDecisionResolution;
  try {
    resolution = validateResolution(resolved);
  } catch (error) {
    return Object.freeze({
      outcome: "decision-failed",
      ticket_ids,
      report: reviewed.report,
      error: {
        kind: "invalid_decision",
        message: error instanceof Error ? error.message : String(error),
      },
    } as const);
  }
  if (resolution.decision === "approved") {
    return Object.freeze({ outcome: "approved", ticket_ids, report: reviewed.report } as const);
  }
  return Object.freeze({
    outcome: "corrections-required",
    ticket_ids,
    report: reviewed.report,
    ...(resolution.notes !== undefined ? { notes: resolution.notes } : {}),
  } as const);
}
