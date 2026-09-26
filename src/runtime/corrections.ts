/**
 * Technical Lead correction ticket creation (M18 R-018).
 *
 * One small runtime operation turning an explicit R-017
 * `corrections-required` result into exactly one aggregated
 * correction ticket through the existing generic
 * `IssueProvider.create(...)`. No contract redesign: the
 * request shape already supports the operation, so it is
 * used unchanged.
 *
 * Aggregation is deliberate: R-017 yields sprint-level
 * correction information (ticket ids plus optional verbatim
 * notes), never per-ticket corrective actions — so one
 * correction ticket references the whole set. The opaque TL
 * report is never parsed, split, ranked, or reinterpreted,
 * and the actionable `notes` travel verbatim when present.
 * Without notes the request carries a deterministic
 * no-detail statement instead of fabricated specifics.
 *
 * Explicit gate, no fallback: `approved` returns
 * `not-required` with zero provider calls; any other R-017
 * outcome (or malformed input) returns `invalid-input`
 * without coercion; provider failure returns bounded
 * `creation-failed` with no retry and no compensating
 * mutation. Nothing is assigned, executed, closed, linked,
 * sunk, or re-reviewed here — creation is a single provider
 * mutation, and the original tickets are never touched (they
 * are not even inputs to this operation).
 */

import {
  IssueProvider,
  IssueReference,
  isIssueProvider,
  validateIssueReference,
  validateIssueRequest,
} from "../providers/issue";
import { TechnicalLeadReviewResult } from "./technical-lead";

export interface TechnicalLeadCorrectionInput {
  /** Completed R-017 review result; only its outcome is interpreted. */
  readonly review: TechnicalLeadReviewResult;
  /** Explicit issue tracker; never discovered or inferred. */
  readonly issues: IssueProvider;
}

export interface TechnicalLeadCorrectionNotRequired {
  readonly outcome: "not-required";
}

export interface TechnicalLeadCorrectionCreated {
  readonly outcome: "created";
  readonly reference: IssueReference;
}

export interface TechnicalLeadCorrectionFailed {
  readonly outcome: "creation-failed";
  readonly error: { readonly kind: string; readonly message: string };
}

export interface TechnicalLeadCorrectionInvalid {
  readonly outcome: "invalid-input";
  readonly error: { readonly kind: string; readonly message: string };
}

export type TechnicalLeadCorrectionResult =
  | TechnicalLeadCorrectionNotRequired
  | TechnicalLeadCorrectionCreated
  | TechnicalLeadCorrectionFailed
  | TechnicalLeadCorrectionInvalid;

function invalid(message: string): TechnicalLeadCorrectionInvalid {
  return Object.freeze({
    outcome: "invalid-input",
    error: { kind: "invalid_input", message },
  } as const);
}

function requestTitle(ticketIds: readonly string[]): string {
  const scope = ticketIds.length > 0 ? ticketIds.join(", ") : "(none)";
  return `Technical Lead corrections for tickets ${scope}`;
}

function requestDescription(ticketIds: readonly string[], notes: string | undefined): string {
  const scope = ticketIds.length > 0 ? ticketIds.join(", ") : "(none)";
  const lines = [`Technical Lead review requires corrections for tickets: ${scope}.`, ""];
  if (notes !== undefined) {
    lines.push("Correction notes:", notes);
  } else {
    lines.push("No specific correction notes were supplied; review the affected tickets against the Technical Lead findings.");
  }
  return lines.join("\n");
}

/**
 * Create one aggregated correction ticket for an explicit TL
 * `corrections-required` result, or return the bounded
 * non-creation outcome. Validates everything before the
 * single provider call; deterministic and side-effect free
 * on every path except that one call.
 */
export async function createTechnicalLeadCorrectionTicket(
  input: TechnicalLeadCorrectionInput,
): Promise<TechnicalLeadCorrectionResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return invalid("correction ticket: expected an input object");
  }
  if (!isIssueProvider(input.issues)) {
    return invalid("correction ticket: issues must satisfy the issue provider contract");
  }
  const review = input.review;
  if (typeof review !== "object" || review === null || Array.isArray(review)) {
    return invalid("correction ticket: review must be a Technical Lead review result");
  }
  const outcome = (review as { outcome?: unknown }).outcome;
  if (outcome === "approved") {
    return Object.freeze({ outcome: "not-required" } as const);
  }
  if (outcome !== "corrections-required") {
    return invalid(`correction ticket: unsupported review outcome ${JSON.stringify(outcome)}`);
  }
  const candidate = review as unknown as Record<string, unknown>;
  if (
    !Array.isArray(candidate.ticket_ids) ||
    candidate.ticket_ids.some((id) => typeof id !== "string" || id.length === 0)
  ) {
    return invalid("correction ticket: corrections require a ticket id list");
  }
  const ticketIds = candidate.ticket_ids as readonly string[];
  if (candidate.notes !== undefined && (typeof candidate.notes !== "string" || candidate.notes.length === 0)) {
    return invalid("correction ticket: notes must be a non-empty string");
  }
  const notes = candidate.notes as string | undefined;
  let request;
  try {
    request = validateIssueRequest({
      title: requestTitle(ticketIds),
      description: requestDescription(ticketIds, notes),
    });
  } catch (error) {
    return invalid(error instanceof Error ? error.message : String(error));
  }
  let reference: IssueReference;
  try {
    reference = validateIssueReference(await input.issues.create(request));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("issue provider: ")) {
      return invalid(error.message);
    }
    return Object.freeze({
      outcome: "creation-failed",
      error: {
        kind: "creation_error",
        message: error instanceof Error ? error.message : String(error),
      },
    } as const);
  }
  return Object.freeze({ outcome: "created", reference } as const);
}
