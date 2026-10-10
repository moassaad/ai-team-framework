/**
 * Final Approval Re-entry Handoff (M28 T-035).
 *
 * Turns a valid final-approval correction reference (T-032)
 * into the existing canonical `AgentHandoff` toward an
 * explicitly caller-supplied destination — creation and
 * validation only, never dispatch, execution, or re-entry.
 * Field mapping follows the tested T-033/T-034 convention,
 * which is semantically appropriate here for the same
 * reasons:
 *
 * - `from`: `coordinator`. R-020 vests final approval in the
 *   explicit coordinator identity, so the coordinator role
 *   is the source this contract supports.
 * - `to`: explicit caller-supplied destination. Never
 *   guessed, defaulted, or promoted: a missing destination
 *   fails, and the pair is validated against the operating
 *   model (coordinator reaches project-manager and
 *   technical-lead; anything else is rejected by the
 *   existing validator, not retargeted).
 * - `objective`: `action.description` — what the receiver
 *   must do, per the handoff contract.
 * - `notes`: `feedback` verbatim — bounded extras
 *   accompanying the objective. Byte-identical, never
 *   paraphrased, summarized, or parsed.
 * - `artifacts`: every `ticketIds` entry, bare and stable,
 *   plus `action.ticketId` when it names a ticket outside
 *   that set. Tasks are supported artifact references.
 * - `requirements`, `acceptance_criteria`, `constraints`,
 *   `context`, `next_action`: absent. Nothing structured is
 *   derived from opaque feedback; nothing is synthesized.
 *
 * Provenance limitation (documented, not hidden): origin
 * `final-approval` records the stage literal from the
 * correction, and `from: coordinator` reflects the R-020
 * authority role. Neither independently proves a specific
 * final-approval event occurred — the caller must actually
 * hold a final-approval changes-required outcome, which no
 * constructor can verify. Only supported provenance is
 * claimed.
 *
 * Pure and synchronous: validate the correction, enforce
 * the final-approval origin, require the explicit
 * destination, map, and return the frozen handoff through
 * the existing validators. No providers, no role executors,
 * no dispatch, no status changes, no persistence, no CLI, no
 * retry, no re-entry, no orchestration.
 */

import { AgentHandoff } from "../roles/handoff";
import { validateAgentHandoff } from "../roles/handoff-validation";
import { validateCorrectionReference, CorrectionReference } from "./correction-reference";

export interface FinalApprovalReentryHandoffInput {
  /** Valid correction reference with the `final-approval` origin. */
  readonly correction: unknown;
  /** Explicit destination role; required, never inferred. */
  readonly to: unknown;
}

function fail(what: string): never {
  throw new Error(`final approval re-entry handoff: ${what}`);
}

/**
 * Build the canonical final-approval re-entry handoff for
 * one validated final-approval correction reference and one
 * explicit destination. Rejects non-final-approval origins,
 * missing destinations, and unsupported pairs before
 * returning anything; the returned handoff satisfies the
 * full canonical contract including direction approval.
 * Caller input is never mutated.
 */
export function createFinalApprovalReentryHandoff(input: FinalApprovalReentryHandoffInput): AgentHandoff {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a re-entry handoff input object");
  }
  const correction: CorrectionReference = validateCorrectionReference(input.correction);
  if (correction.origin !== "final-approval") {
    fail(`re-entry handoff requires a final-approval correction, got origin ${JSON.stringify(correction.origin)}`);
  }
  if (input.to === undefined) {
    fail("destination role is required; the re-entry target is never guessed");
  }
  const artifacts = [...correction.ticketIds];
  if (correction.action.ticketId !== undefined && !artifacts.includes(correction.action.ticketId)) {
    artifacts.push(correction.action.ticketId);
  }
  return validateAgentHandoff({
    from: "coordinator",
    to: input.to,
    objective: correction.action.description,
    notes: correction.feedback,
    artifacts,
  });
}
