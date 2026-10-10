/**
 * Handoff validation and rendering (M22 T-004).
 *
 * Ownership split: T-003 (`handoff.ts`) owns the data model, field
 * set, bounds, and structural construction; T-001
 * (`operating-model.ts`) owns which role-to-role directions are
 * approved. This module owns only validation (structure plus
 * direction approval) and presentation (one deterministic
 * human-readable rendering). Nothing is duplicated: structural
 * rules and bounds are reused from T-003, the direction table is
 * reused from T-001, and no renderer-specific fields exist.
 *
 * `validateAgentHandoff` accepts raw data, enforces the full
 * contract — canonical sender, canonical receiver, distinct
 * endpoints, approved direction, present bounded objective, bounded
 * optional fields — and returns the frozen handoff. Failures throw
 * through the repository `fail()` convention: nothing is coerced,
 * inferred, or redirected into a valid direction.
 *
 * `renderAgentHandoff` validates first, then renders one stable
 * artifact: fixed section order, caller ordering preserved in
 * lists, absent optional sections omitted (never placeholder
 * text), all content verbatim (never truncated, summarized, or
 * classified). The result is plain text with no JSON, commands,
 * IDs, or provider syntax — directly copyable into the next role
 * manually today, transportable by delegation later. Reports stay
 * opaque: field text renders as data, never parsed for decisions,
 * roles, or status. `next_action` stays descriptive; rendering
 * executes nothing, persists nothing, and routes nowhere.
 */

import { AgentHandoff, createAgentHandoff } from "./handoff";
import { isApprovedHandoff } from "./operating-model";

function fail(what: string): never {
  throw new Error(`agent handoff: ${what}`);
}

/**
 * Fully validate raw data as a canonical handoff: T-003 structure
 * and bounds, plus T-001 direction approval. A structurally valid
 * role pair is not automatically a valid handoff — only approved
 * operating-model directions pass. Returns the frozen handoff;
 * throws on anything else without mutating the input.
 */
export function validateAgentHandoff(data: unknown): AgentHandoff {
  const handoff = createAgentHandoff(data);
  if (!isApprovedHandoff(handoff.from, handoff.to)) {
    fail(`unsupported handoff direction ${JSON.stringify(handoff.from)} → ${JSON.stringify(handoff.to)}`);
  }
  return handoff;
}

function listSection(title: string, items: readonly string[]): string[] {
  return [title, ...items.map((item, index) => `${index + 1}. ${item}`)];
}

/**
 * Render a handoff as deterministic human-readable text. Validates
 * first, so rendering never succeeds on an invalid handoff. Same
 * input always yields byte-identical output: fixed section order,
 * no timestamps, no environment, no provider metadata. Bounded by
 * construction — every field already satisfies the T-003 limits,
 * and nothing is added except fixed labels and numbering.
 */
export function renderAgentHandoff(data: unknown): string {
  const handoff = validateAgentHandoff(data);
  const parts: string[] = ["=== AI TEAM HANDOFF ===", "", `From: ${handoff.from}`, `To: ${handoff.to}`, "", "Objective:", handoff.objective];
  if (handoff.context !== undefined) {
    parts.push("", "Context:", handoff.context);
  }
  if (handoff.requirements !== undefined) {
    parts.push("", ...listSection("Requirements:", [...handoff.requirements]));
  }
  if (handoff.acceptance_criteria !== undefined) {
    parts.push("", ...listSection("Acceptance Criteria:", [...handoff.acceptance_criteria]));
  }
  if (handoff.constraints !== undefined) {
    parts.push("", ...listSection("Constraints:", [...handoff.constraints]));
  }
  if (handoff.artifacts !== undefined) {
    parts.push("", ...listSection("Artifacts:", [...handoff.artifacts]));
  }
  if (handoff.notes !== undefined) {
    parts.push("", "Notes:", handoff.notes);
  }
  if (handoff.next_action !== undefined) {
    parts.push("", "Next Action:", handoff.next_action);
  }
  return `${parts.join("\n")}\n`;
}
