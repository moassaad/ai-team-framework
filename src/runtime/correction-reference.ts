/**
 * Correction Reference to Actionable Work (M28 T-032).
 *
 * The smallest traceability contract between a correction
 * raised by an existing review or approval stage and the
 * explicit action expected to address it — foundation for
 * the later M28 re-entry tickets, which own all rework
 * routing and execution. This module records; it never acts.
 *
 * Source stages (existing vocabularies, nothing redefined):
 * reviewer decisions (`changes_requested` + feedback),
 * Technical Lead reviews (`corrections-required` + notes),
 * PM/User Testing reviews (`changes-required` + notes),
 * final approvals (`changes-required` + notes), and planning
 * approvals (`changes-required` + notes). Whatever the stage
 * supplied as feedback travels verbatim: opaque text is never
 * parsed into requirements, and no summary replaces it.
 *
 * Everything relational is caller-supplied, nothing derived:
 * the concerned ticket ids, the verbatim feedback, and the
 * action (a caller-authored description plus, when known, the
 * existing ticket id it applies to). A correction without
 * stated feedback cannot ground action and is rejected rather
 * than guessed. No status is invented — the reference claims
 * nothing about resolution, severity, priority, ownership, or
 * completion — and no existing result shape is changed.
 *
 * Pure and synchronous: validate, freeze, return. No
 * providers, no execution, no persistence, no registries, no
 * queues, no re-entry, no orchestration.
 */

/** Stages whose corrections can be referenced. Existing stage names only. */
export const CORRECTION_ORIGINS = [
  "reviewer",
  "technical-lead",
  "project-manager",
  "final-approval",
  "planning-approval",
] as const;

/** Origin of a referenced correction. */
export type CorrectionOrigin = (typeof CORRECTION_ORIGINS)[number];

/** True for canonical correction origins; rejects free text. */
export function isCorrectionOrigin(value: unknown): value is CorrectionOrigin {
  return (
    typeof value === "string" &&
    (CORRECTION_ORIGINS as readonly string[]).includes(value)
  );
}

/**
 * The action expected to address a correction. Caller-authored
 * in full: a non-empty description of what should happen, plus
 * the existing ticket id it applies to when the caller knows
 * it. Never derived from feedback text.
 */
export interface CorrectiveAction {
  readonly description: string;
  readonly ticketId?: string;
}

/**
 * A referenced correction: where it originated, the exact
 * feedback supplied, the existing ticket ids it concerns,
 * and the explicit action intended to address it. Source and
 * action stay distinct fields; nothing is merged or
 * summarized.
 */
export interface CorrectionReference {
  readonly origin: CorrectionOrigin;
  readonly ticketIds: readonly string[];
  readonly feedback: string;
  readonly action: CorrectiveAction;
}

export interface CorrectionReferenceInput {
  readonly origin: unknown;
  readonly ticketIds: unknown;
  readonly feedback: unknown;
  readonly action: unknown;
}

function fail(what: string): never {
  throw new Error(`correction reference: ${what}`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

function checkTicketIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail("ticketIds must be a non-empty array of ticket id strings");
  }
  return Object.freeze(value.map((entry) => nonEmptyString(entry, "ticketIds entry")));
}

function checkAction(value: unknown): CorrectiveAction {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("action must be an object with a description and an optional ticketId");
  }
  const raw = value as Record<string, unknown>;
  const description = nonEmptyString(raw.description, "action.description");
  if (raw.ticketId === undefined) {
    return Object.freeze({ description });
  }
  return Object.freeze({ description, ticketId: nonEmptyString(raw.ticketId, "action.ticketId") });
}

/**
 * Validate raw data as a correction reference and return a
 * frozen defensive copy. Rejects unknown origins, empty or
 * malformed ticket ids, missing feedback, and malformed
 * actions. Never mutates its input, never parses feedback.
 */
export function validateCorrectionReference(data: unknown): CorrectionReference {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected a correction reference object");
  }
  const raw = data as Record<string, unknown>;
  if (!isCorrectionOrigin(raw.origin)) {
    fail(`origin must be one of ${CORRECTION_ORIGINS.join(", ")}, got ${JSON.stringify(raw.origin)}`);
  }
  return Object.freeze({
    origin: raw.origin,
    ticketIds: checkTicketIds(raw.ticketIds),
    feedback: nonEmptyString(raw.feedback, "feedback"),
    action: checkAction(raw.action),
  });
}

/**
 * Build a correction reference from explicit caller parts.
 * Same validation as `validateCorrectionReference`; the
 * four arguments keep source, targets, feedback, and action
 * visibly separate at the call site.
 */
export function createCorrectionReference(input: CorrectionReferenceInput): CorrectionReference {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a correction reference input object");
  }
  return validateCorrectionReference({
    origin: input.origin,
    ticketIds: input.ticketIds,
    feedback: input.feedback,
    action: input.action,
  });
}
