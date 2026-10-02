/**
 * Explicit Senior Reviewer decision boundary (M18 R-013).
 *
 * One small seam replacing the static review verdict: after
 * the Senior Reviewer produces its opaque report, the
 * Coordinator invokes a caller-supplied resolver with the
 * report as context, and the resolution — never reviewer-text
 * interpretation — selects the IR-004/IR-003 branch. No
 * keyword parsing, classification, scoring, or automatic
 * approval exists here or anywhere downstream.
 *
 * ```text
 * Senior Reviewer report (opaque)
 *        ↓ ReviewDecisionRequest (identity + task + report only)
 * caller/external ReviewDecisionResolver
 *        ↓ ReviewDecisionResolution (approved | changes_requested + feedback)
 * IR-004 technical approval | IR-003 changes requested
 * ```
 *
 * The context carries no provider internals, sessions,
 * models, relay paths, Git details, configuration, or
 * credentials — the resolver cannot leak what it never
 * receives. `changes_requested` requires non-empty feedback,
 * transported verbatim; `approved` carries no extra data. A
 * missing decision is never approval: a resolver that
 * returns nothing usable fails validation before any
 * transition. This module performs no I/O and depends on
 * nothing at runtime.
 */

import { ReviewDecision } from "./coordinator";

/**
 * Decision context: the generic information needed to decide.
 * The report is opaque evidence — resolvers must not parse or
 * classify it.
 */
export interface ReviewDecisionRequest {
  readonly ticket_id: string;
  readonly title: string;
  readonly description: string;
  readonly requirements: string;
  readonly report: string;
}

/**
 * Decision resolution reusing the existing verdict semantics:
 * `approved` alone, or `changes_requested` with non-empty
 * feedback. Nothing else exists.
 */
export interface ReviewDecisionResolution {
  readonly decision: ReviewDecision;
  readonly feedback?: string;
}

/**
 * Caller/external decision resolver. Invoked exactly once per
 * Coordinator invocation, after Senior Reviewer execution and
 * before the approval/changes branch. May be async (human
 * prompt) or sync (deterministic injection); never retries.
 */
export type ReviewDecisionResolver = (
  request: ReviewDecisionRequest,
) => ReviewDecisionResolution | Promise<ReviewDecisionResolution>;

/** Structural guard: a callable resolver. */
export function isReviewDecisionResolver(value: unknown): value is ReviewDecisionResolver {
  return typeof value === "function";
}

function fail(ticketId: string, what: string): never {
  throw new Error(`review decision: ticket ${ticketId} (${what})`);
}

/**
 * Validate a resolver outcome before any transition and return
 * a normalized copy. Rejects non-objects, unknown verdicts,
 * `changes_requested` without non-empty feedback, and
 * `approved` with extra data — never fabricating a decision.
 */
export function validateReviewDecisionResolution(
  value: unknown,
  ticketId: string,
): ReviewDecisionResolution {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(ticketId, "resolution must be an object");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.decision !== "approved" && candidate.decision !== "changes_requested") {
    fail(ticketId, `unknown verdict ${JSON.stringify(candidate.decision)}`);
  }
  if (candidate.decision === "changes_requested") {
    if (typeof candidate.feedback !== "string" || candidate.feedback.length === 0) {
      fail(ticketId, "changes_requested requires non-empty feedback");
    }
    return Object.freeze({ decision: candidate.decision, feedback: candidate.feedback });
  }
  if (candidate.feedback !== undefined) {
    fail(ticketId, "approved carries no feedback");
  }
  return Object.freeze({ decision: candidate.decision });
}
