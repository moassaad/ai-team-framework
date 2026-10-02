/**
 * PM / User Testing boundary (M18 R-019).
 *
 * The sprint-level review stage after explicit Technical Lead
 * approval: a caller-supplied PM reviewer runs once over
 * bounded snapshot evidence, and an explicit caller-supplied
 * decision resolves once from the opaque report. Ticket-level
 * `changes_requested` (Coordinator rework) and TL
 * `corrections-required` (R-018 correction tickets) stay
 * distinct from PM `changes-required` (a later orchestration
 * layer decides what follows; nothing is created here).
 *
 * ```text
 * TL review result (must be approved)
 *    ↓ gate
 * PM provider (role project-manager, once) → opaque report
 *    ↓ PmUserTestingDecisionResolver
 * approved | changes-required (+notes)
 * ```
 *
 * Read-only throughout: no ticket mutation, no correction
 * tickets, no IssueProvider/sink/Coordinator calls, no final
 * approval, no `closed` transitions. A non-approved TL result
 * returns `not-ready` with zero provider and zero decision
 * calls. Provider or decision failures return bounded
 * failures with the report preserved when already available.
 * Exactly one PM invocation and one decision resolution per
 * call at most — never a retry, never a loop. This boundary
 * performs no product testing itself; capabilities like
 * browsers, HTTP, UI frameworks, fixtures, or environments
 * belong to callers/providers outside R-019.
 */

import { CoordinatorTicket, isTicket } from "./coordinator";
import {
  ProjectManagerRoleReference,
  validateProjectManagerReference,
} from "./roles";
import {
  PmUserTestingTicketEvidence,
  executePmUserTesting,
} from "../execution/pm-testing";
import { TechnicalLeadReviewResult } from "./technical-lead";

/**
 * PM decision context: sprint scope plus the opaque PM
 * report. No ticket-level fields — the decision is about the
 * sprint, not one ticket.
 */
export interface PmUserTestingDecisionRequest {
  readonly ticket_ids: readonly string[];
  readonly report: string;
}

/**
 * PM decision resolution. `approved` accepts the sprint as
 * matching what was agreed; `changes-required` records that
 * changes are needed (a later layer owns what follows —
 * nothing is created here). Optional notes travel verbatim
 * when the caller supplies them.
 */
export interface PmUserTestingDecisionResolution {
  readonly decision: "approved" | "changes-required";
  readonly notes?: string;
}

/**
 * Caller-supplied PM decision resolver. Invoked exactly once
 * per review, after PM provider execution with the opaque
 * report as context. May be async; never retried.
 */
export type PmUserTestingDecisionResolver = (
  request: PmUserTestingDecisionRequest,
) => PmUserTestingDecisionResolution | Promise<PmUserTestingDecisionResolution>;

/** Structural guard: a callable resolver. */
export function isPmUserTestingDecisionResolver(value: unknown): value is PmUserTestingDecisionResolver {
  return typeof value === "function";
}

export interface PmUserTestingReviewInput {
  /** Caller-owned tickets; evidenced, never mutated. */
  readonly tickets: CoordinatorTicket[];
  /**
   * Completed Technical Lead review result. Only an explicit
   * `approved` opens this stage — never inferred from ticket
   * states, correction references, or report text.
   */
  readonly technicalLeadReview: TechnicalLeadReviewResult;
  /** Explicit PM reference (distinct `project-manager` identity). */
  readonly projectManager: ProjectManagerRoleReference;
  /** Target project root for the provider invocation. */
  readonly project_root: string;
  /** Execution bound in milliseconds. */
  readonly timeout_ms: number;
  /** Explicit PM decision resolver; never defaulted. */
  readonly decidePmUserTesting: PmUserTestingDecisionResolver;
}

export interface PmUserTestingNotReady {
  readonly outcome: "not-ready";
  /** The TL outcome that closed this stage (or "invalid" for malformed results). */
  readonly technicalLeadOutcome: string;
}

export interface PmUserTestingInvalidInput {
  readonly outcome: "invalid-input";
  readonly error: { readonly kind: string; readonly message: string };
}

export interface PmUserTestingApproved {
  readonly outcome: "approved";
  readonly ticket_ids: readonly string[];
  readonly report: string;
}

export interface PmUserTestingChangesRequired {
  readonly outcome: "changes-required";
  readonly ticket_ids: readonly string[];
  readonly report: string;
  readonly notes?: string;
}

export interface PmUserTestingReviewFailed {
  readonly outcome: "review-failed";
  readonly ticket_ids: readonly string[];
  readonly error: { readonly kind: string; readonly message: string };
}

export interface PmUserTestingDecisionFailed {
  readonly outcome: "decision-failed";
  readonly ticket_ids: readonly string[];
  readonly report: string;
  readonly error: { readonly kind: string; readonly message: string };
}

export type PmUserTestingReviewResult =
  | PmUserTestingNotReady
  | PmUserTestingInvalidInput
  | PmUserTestingApproved
  | PmUserTestingChangesRequired
  | PmUserTestingReviewFailed
  | PmUserTestingDecisionFailed;

function invalid(message: string): PmUserTestingInvalidInput {
  return Object.freeze({
    outcome: "invalid-input",
    error: { kind: "invalid_input", message },
  } as const);
}

function nonEmptyString(value: unknown, field: string): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  return value;
}

function failDecision(what: string): never {
  throw new Error(`pm user testing decision: ${what}`);
}

function validateResolution(value: unknown): PmUserTestingDecisionResolution {
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
 * Run one PM/User Testing review: validate everything, gate
 * on explicit TL approval, invoke the PM provider once,
 * resolve the explicit decision once, and return the bounded
 * result. Tickets are never mutated; nothing is created,
 * persisted, scheduled, closed, or retried.
 */
export async function runPmUserTestingReview(
  input: PmUserTestingReviewInput,
): Promise<PmUserTestingReviewResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return invalid("pm user testing: expected a review input object");
  }
  if (!Array.isArray(input.tickets)) {
    return invalid("pm user testing: tickets must be an array");
  }
  for (const ticket of input.tickets) {
    if (!isTicket(ticket)) {
      return invalid("pm user testing: every ticket must carry id, title, description, requirements, and a valid state");
    }
  }
  let projectManager: ProjectManagerRoleReference;
  try {
    projectManager = validateProjectManagerReference(input.projectManager);
  } catch (error) {
    return invalid(error instanceof Error ? error.message : String(error));
  }
  const project_root = nonEmptyString(input.project_root, "project_root");
  if (project_root === undefined) {
    return invalid("pm user testing: project_root must be a non-empty string");
  }
  if (typeof input.timeout_ms !== "number" || !Number.isFinite(input.timeout_ms) || input.timeout_ms <= 0) {
    return invalid("pm user testing: timeout_ms must be a positive finite number");
  }
  if (!isPmUserTestingDecisionResolver(input.decidePmUserTesting)) {
    return invalid("pm user testing: decidePmUserTesting must be a decision resolver");
  }
  const technicalLeadReview = input.technicalLeadReview;
  const technicalLeadOutcome =
    typeof technicalLeadReview === "object" && technicalLeadReview !== null && !Array.isArray(technicalLeadReview)
      ? String((technicalLeadReview as { outcome?: unknown }).outcome)
      : "invalid";
  if (technicalLeadOutcome !== "approved") {
    return Object.freeze({ outcome: "not-ready", technicalLeadOutcome } as const);
  }
  const ticket_ids = Object.freeze(input.tickets.map((ticket) => ticket.id));

  const evidence: PmUserTestingTicketEvidence[] = input.tickets.map((ticket) => ({
    id: ticket.id,
    title: ticket.title,
    description: ticket.description,
    requirements: ticket.requirements,
    state: ticket.state,
    ...(ticket.feedback !== undefined ? { feedback: ticket.feedback } : {}),
  }));
  const reviewed = await executePmUserTesting({
    evidence,
    role: projectManager.role,
    project_root,
    provider: projectManager.provider,
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
    resolved = await input.decidePmUserTesting({ ticket_ids, report: reviewed.report });
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
  let resolution: PmUserTestingDecisionResolution;
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
    outcome: "changes-required",
    ticket_ids,
    report: reviewed.report,
    ...(resolution.notes !== undefined ? { notes: resolution.notes } : {}),
  } as const);
}
