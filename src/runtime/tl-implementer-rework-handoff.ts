/**
 * Technical Lead → Implementer Rework Handoff (M28 T-033).
 *
 * Turns a valid Technical Lead correction reference (T-032)
 * into the existing canonical `AgentHandoff` directed at the
 * Implementer — creation and validation only, never dispatch
 * or execution. The explicit field mapping, documented here
 * because the alternative is guessing:
 *
 * - `from`/`to`: `technical-lead` → `implementer`. The
 *   correction origin is preserved structurally as the
 *   sender; the operating model approves this direction, and
 *   `validateAgentHandoff` enforces it. Any other origin is
 *   rejected, never reinterpreted as a TL correction.
 * - `objective`: `action.description`. The handoff contract
 *   defines objective as what the receiver must do, and the
 *   T-032 action is exactly the caller-authored description
 *   of what should happen — the one mapping the handoff
 *   contract supports.
 * - `notes`: `feedback` verbatim. Notes carry bounded extras
 *   accompanying the objective, which is precisely the role
 *   of the originating correction record next to the rework
 *   order. Byte-identical, including whitespace: never
 *   paraphrased, summarized, or parsed.
 * - `artifacts`: every `ticketIds` entry, bare and stable,
 *   plus `action.ticketId` when it names a ticket outside
 *   that set. Artifacts are bounded textual references and
 *   the contract names tasks among them; identifiers ride
 *   unchanged so they round-trip exactly.
 * - `requirements`, `acceptance_criteria`, `constraints`,
 *   `context`, `next_action`: absent. Opaque feedback is
 *   never converted into structured fields, and nothing is
 *   synthesized — no criteria, estimates, priorities, or
 *   next-step commands.
 *
 * Pure and synchronous: validate the correction, enforce the
 * TL origin, map, and return the frozen handoff through the
 * existing validators (`createAgentHandoff` structure plus
 * `validateAgentHandoff` direction approval). The result
 * renders with the existing renderer and resumes through the
 * existing manual parser unchanged. No providers, no role
 * executors, no dispatch, no status changes, no persistence,
 * no CLI, no retry, no re-entry, no orchestration.
 */

import { AgentHandoff } from "../roles/handoff";
import { validateAgentHandoff } from "../roles/handoff-validation";
import { validateCorrectionReference, CorrectionReference } from "./correction-reference";

export interface TlReworkHandoffInput {
  /** Valid correction reference with the `technical-lead` origin. */
  readonly correction: unknown;
}

function fail(what: string): never {
  throw new Error(`tl rework handoff: ${what}`);
}

/**
 * Build the canonical Technical Lead → Implementer rework
 * handoff for one validated TL correction reference.
 * Rejects non-TL origins and malformed corrections before
 * reading any field; the returned handoff satisfies the full
 * canonical contract including direction approval. Caller
 * input is never mutated.
 */
export function createTlImplementerReworkHandoff(input: TlReworkHandoffInput): AgentHandoff {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a rework handoff input object");
  }
  const correction: CorrectionReference = validateCorrectionReference(input.correction);
  if (correction.origin !== "technical-lead") {
    fail(`rework handoff requires a technical-lead correction, got origin ${JSON.stringify(correction.origin)}`);
  }
  const artifacts = [...correction.ticketIds];
  if (correction.action.ticketId !== undefined && !artifacts.includes(correction.action.ticketId)) {
    artifacts.push(correction.action.ticketId);
  }
  return validateAgentHandoff({
    from: "technical-lead",
    to: "implementer",
    objective: correction.action.description,
    notes: correction.feedback,
    artifacts,
  });
}
