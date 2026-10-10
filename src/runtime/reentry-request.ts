/**
 * Re-entry Request Contract (M28 T-036).
 *
 * The unified, reusable representation of a re-entry request
 * across the T-033/T-034/T-035 correction paths: one validated
 * `CorrectionReference`, one canonical `AgentHandoff`, and the
 * discriminator naming which supported form they take —
 * `tl-implementer`, `pm-technical-lead`, or `final-approval`.
 * A data contract only: validation describes re-entry intent
 * and authorizes nothing.
 *
 * Pair validation without duplicated policy (the design point
 * of this module): rather than re-implementing the three
 * route mappings, the constructor rebuilds the expected
 * handoff through the existing route constructor for the
 * correction's origin and requires byte-level equivalence
 * with the supplied handoff. The route constructors stay the
 * single source of mapping truth; this module only routes to
 * the right one and compares:
 *
 * - origin `technical-lead` → T-033 (`technical-lead` →
 *   `implementer`);
 * - origin `project-manager` → T-034 (`project-manager` →
 *   `technical-lead`);
 * - origin `final-approval` → T-035 (`coordinator` →
 *   caller-supplied destination, validated by the operating
 *   model as usual).
 *
 * Origins without a re-entry form (`reviewer`,
 * `planning-approval`) are rejected outright. A valid
 * correction paired with any other handoff — however
 * canonical on its own — fails the equivalence check, so no
 * weaker path accepts unrelated pairs. Objective, notes, and
 * artifacts therefore correspond to the correction's action
 * description, feedback, and ticket references by
 * construction, never by prose parsing.
 *
 * Provenance limits inherited unchanged: the origin names a
 * category, not a proven event; final approval is not shown
 * to have returned `changes-required`; nothing claims
 * resolution, completion, or execution. Pure and synchronous:
 * validate, reconstruct, compare, freeze. No providers, no
 * executors, no dispatch, no status changes, no persistence,
 * no CLI, no retry, no loops, no orchestration.
 */

import { AgentHandoff } from "../roles/handoff";
import { validateAgentHandoff } from "../roles/handoff-validation";
import { validateCorrectionReference, CorrectionReference } from "./correction-reference";
import { createTlImplementerReworkHandoff } from "./tl-implementer-rework-handoff";
import { createPmTlReentryHandoff } from "./pm-tl-reentry-handoff";
import { createFinalApprovalReentryHandoff } from "./final-approval-reentry-handoff";

/** Supported re-entry forms, one per established route. */
export const REENTRY_FORMS = ["tl-implementer", "pm-technical-lead", "final-approval"] as const;

/** Which established route a re-entry request takes. */
export type ReentryForm = (typeof REENTRY_FORMS)[number];

/**
 * One validated re-entry request: the correction being
 * addressed, the canonical handoff requesting re-entry, and
 * the discriminator naming their established form. The
 * correction and handoff are the validated objects
 * themselves, not copies of their fields — no second schema.
 */
export interface ReentryRequest {
  readonly form: ReentryForm;
  readonly correction: CorrectionReference;
  readonly handoff: AgentHandoff;
}

export interface ReentryRequestInput {
  readonly correction: unknown;
  readonly handoff: unknown;
}

function fail(what: string): never {
  throw new Error(`re-entry request: ${what}`);
}

function deepEqual(value: unknown, expected: unknown): boolean {
  return JSON.stringify(value) === JSON.stringify(expected);
}

/**
 * Validate raw data as a re-entry request and return the
 * frozen result. Validates the correction (T-032) and the
 * handoff (canonical, direction-approved), routes on the
 * correction origin, rebuilds the expected handoff through
 * the origin's route constructor, and requires equivalence
 * with the supplied handoff. Any mismatch — wrong form,
 * unrelated handoff, altered fields — fails clearly.
 * Caller input is never mutated.
 */
export function validateReentryRequest(data: unknown): ReentryRequest {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected a re-entry request object");
  }
  const raw = data as Record<string, unknown>;
  const correction = validateCorrectionReference(raw.correction);
  const handoff = validateAgentHandoff(raw.handoff);
  let form: ReentryForm;
  let expected: AgentHandoff;
  try {
    if (correction.origin === "technical-lead") {
      form = "tl-implementer";
      expected = createTlImplementerReworkHandoff({ correction });
    } else if (correction.origin === "project-manager") {
      form = "pm-technical-lead";
      expected = createPmTlReentryHandoff({ correction });
    } else if (correction.origin === "final-approval") {
      form = "final-approval";
      expected = createFinalApprovalReentryHandoff({ correction, to: handoff.to });
    } else {
      fail(`origin ${JSON.stringify(correction.origin)} has no supported re-entry form`);
    }
  } catch (error: unknown) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (!deepEqual(handoff, expected!)) {
    fail("handoff does not correspond to the supplied correction under the established route mapping");
  }
  return Object.freeze({ form: form!, correction, handoff });
}

/**
 * Build a re-entry request from an explicit correction and
 * handoff pair. Same validation as `validateReentryRequest`;
 * the two arguments keep the pair visibly separate at the
 * call site.
 */
export function createReentryRequest(input: ReentryRequestInput): ReentryRequest {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a re-entry request input object");
  }
  return validateReentryRequest({ correction: input.correction, handoff: input.handoff });
}
