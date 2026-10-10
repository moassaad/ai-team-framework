/**
 * Project Manager → Technical Lead Re-entry Handoff (M28 T-034).
 *
 * Turns a valid PM-origin correction reference (T-032) into
 * the existing canonical `AgentHandoff` directed at the
 * Technical Lead — creation and validation only, never
 * dispatch, execution, or re-entry looping. Field mapping
 * follows the tested T-033 convention, which is semantically
 * appropriate here for the same reasons:
 *
 * - `from`/`to`: `project-manager` → `technical-lead`. The
 *   correction origin is preserved structurally as the
 *   sender; the operating model approves this direction, and
 *   `validateAgentHandoff` enforces it. Any other origin is
 *   rejected, never reinterpreted as a PM correction.
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
 * Planning vs re-entry (do not confuse them): the existing
 * PM→TL planning handoff carries forward-looking business
 * content (requirements, acceptance criteria, constraints)
 * for first-pass technical planning. This re-entry handoff
 * carries backward-looking correction content (verbatim
 * feedback plus an explicit action) for rework. Same
 * direction, different meaning — the fields prove which is
 * which, and neither is reused as the other.
 *
 * Provenance precision: origin `project-manager` records the
 * PM role as the correction source. It does not independently
 * prove the PM user-testing stage produced it — a planning
 * rejection or any PM-origin correction uses the same
 * literal. Only the provenance the contract supports is
 * claimed.
 *
 * Pure and synchronous: validate the correction, enforce the
 * PM origin, map, and return the frozen handoff through the
 * existing validators. No providers, no role executors, no
 * dispatch, no status changes, no persistence, no CLI, no
 * retry, no looping, no orchestration.
 */

import { AgentHandoff } from "../roles/handoff";
import { validateAgentHandoff } from "../roles/handoff-validation";
import { validateCorrectionReference, CorrectionReference } from "./correction-reference";

export interface PmReentryHandoffInput {
  /** Valid correction reference with the `project-manager` origin. */
  readonly correction: unknown;
}

function fail(what: string): never {
  throw new Error(`pm re-entry handoff: ${what}`);
}

/**
 * Build the canonical Project Manager → Technical Lead
 * re-entry handoff for one validated PM correction
 * reference. Rejects non-PM origins and malformed
 * corrections before reading any field; the returned
 * handoff satisfies the full canonical contract including
 * direction approval. Caller input is never mutated.
 */
export function createPmTlReentryHandoff(input: PmReentryHandoffInput): AgentHandoff {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a re-entry handoff input object");
  }
  const correction: CorrectionReference = validateCorrectionReference(input.correction);
  if (correction.origin !== "project-manager") {
    fail(`re-entry handoff requires a project-manager correction, got origin ${JSON.stringify(correction.origin)}`);
  }
  const artifacts = [...correction.ticketIds];
  if (correction.action.ticketId !== undefined && !artifacts.includes(correction.action.ticketId)) {
    artifacts.push(correction.action.ticketId);
  }
  return validateAgentHandoff({
    from: "project-manager",
    to: "technical-lead",
    objective: correction.action.description,
    notes: correction.feedback,
    artifacts,
  });
}
