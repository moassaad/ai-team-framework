/**
 * Manual handoff resume parser (M25 T-018).
 *
 * The parsing side of the canonical handoff round trip: text
 * produced by T-004 `renderAgentHandoff` — and only that exact
 * grammar — back into a validated `AgentHandoff`. Never a
 * general text parser: unknown prose is content or rejection,
 * never inference.
 *
 * Grammar safety (why this terminates rather than STOPs): the
 * renderer emits sections in one fixed order separated by
 * exactly one blank line, with content verbatim. The parser
 * mirrors that structure with three exactness rules:
 *
 * 1. A heading line starts a section only when the previous
 *    input line is blank (From/To/Objective are positional).
 *    Heading-like text anywhere else stays content — so pasted
 *    prose can never silently become structure.
 * 2. Headings must follow canonical order with no duplicates;
 *    anything else is rejected, never first/last-wins.
 * 3. The parsed candidate is validated (`validateAgentHandoff`,
 *    the semantic authority, including direction approval) and
 *    re-rendered; the rendering must equal the normalized input
 *    byte for byte. Any misparse changes structure, and changed
 *    structure never re-renders identically — so every accepted
 *    parse is exactly correct.
 *
 * Lists use the renderer's own numbering: items start at `1.`
 * and increment by one with the exact `N. ` prefix (no leading
 * zeros, no gaps — the renderer never emits those, so they are
 * malformed here). Non-matching lines inside a list section
 * continue the current item verbatim. Normalization is limited
 * to CRLF conversion and stripping blank lines at the very
 * start/end of the document (the renderer never emits those);
 * all other bytes, including content case, spacing, and order,
 * are preserved exactly. No roles, objectives, requirements, or
 * actions are ever inferred: every field comes from an explicit
 * rendered section.
 */

import { AgentHandoff } from "./handoff";
import { renderAgentHandoff, validateAgentHandoff } from "./handoff-validation";

function fail(what: string): never {
  throw new Error(`handoff parser: ${what}`);
}

const OPENING_MARKER = "=== AI TEAM HANDOFF ===";

const SECTION_ORDER = [
  "From:",
  "To:",
  "Objective:",
  "Context:",
  "Requirements:",
  "Acceptance Criteria:",
  "Constraints:",
  "Artifacts:",
  "Notes:",
  "Next Action:",
] as const;

const LIST_SECTIONS: ReadonlySet<string> = new Set([
  "Requirements:",
  "Acceptance Criteria:",
  "Constraints:",
  "Artifacts:",
]);

function sectionIndex(heading: string): number {
  return (SECTION_ORDER as readonly string[]).indexOf(heading);
}

function isHeading(line: string): boolean {
  return sectionIndex(line) >= 0;
}

function parseListItem(line: string): { digits: string; number: number; text: string } | undefined {
  const match = /^(\d+)\. (.*)$/.exec(line);
  if (match === null) {
    return undefined;
  }
  return { digits: match[1], number: Number(match[1]), text: match[2] };
}

/**
 * Parse canonical rendered handoff text into a validated
 * `AgentHandoff`. Accepts only the exact T-004 grammar (with
 * CRLF and document-edge blank-line tolerance); rejects
 * malformed structure, unknown orderings, duplicates, and
 * anything that does not re-render byte-identically.
 * Deterministic, synchronous, no I/O, no inference.
 */
export function parseAgentHandoffText(text: unknown): AgentHandoff {
  if (typeof text !== "string") {
    fail("expected handoff text");
  }
  const normalized = text.replace(/\r\n/g, "\n").split("\n");
  while (normalized.length > 0 && normalized[0] === "") {
    normalized.shift();
  }
  while (normalized.length > 0 && normalized[normalized.length - 1] === "") {
    normalized.pop();
  }
  if (normalized.length === 0) {
    fail("handoff input is empty");
  }
  const lines = normalized;
  if (lines[0] !== OPENING_MARKER) {
    fail("missing canonical opening marker");
  }
  if (lines.length < 3 || lines[1] !== "") {
    fail("malformed separator after opening marker");
  }
  if (lines.length < 4 || !lines[2].startsWith("From: ")) {
    fail("missing From role");
  }
  if (lines.length < 5 || !lines[3].startsWith("To: ")) {
    fail("missing To role");
  }
  const from = lines[2].slice("From: ".length);
  const to = lines[3].slice("To: ".length);
  if (lines.length < 6 || lines[4] !== "") {
    fail("malformed separator after To role");
  }
  if (lines.length < 7 || lines[5] !== "Objective:") {
    fail("missing Objective section");
  }

  const sections = new Map<string, string[]>();
  const seen = new Set<string>(["From:", "To:", "Objective:"]);
  let lastOrder = sectionIndex("Objective:");
  let current = "Objective:";
  let currentLines: string[] = [];
  const commit = (): void => {
    if (currentLines.length > 0 && currentLines[currentLines.length - 1] === "") {
      currentLines.pop();
    }
    sections.set(current, currentLines);
    currentLines = [];
  };

  for (let index = 6; index < lines.length; index += 1) {
    const line = lines[index];
    const previousBlank = lines[index - 1] === "";
    if (isHeading(line) && previousBlank) {
      const order = sectionIndex(line);
      if (order <= lastOrder || seen.has(line)) {
        fail(`duplicate or out-of-order section ${JSON.stringify(line)}`);
      }
      commit();
      seen.add(line);
      lastOrder = order;
      current = line;
    } else {
      currentLines.push(line);
    }
  }
  commit();

  const scalar = (heading: string): string | undefined => {
    const collected = sections.get(heading);
    if (collected === undefined) {
      return undefined;
    }
    return collected.join("\n");
  };

  const list = (heading: string): string[] | undefined => {
    const collected = sections.get(heading);
    if (collected === undefined) {
      return undefined;
    }
    const items: string[] = [];
    let expected = 1;
    let open = false;
    for (const line of collected) {
      if (line === "") {
        if (!open) {
          fail(`malformed empty line in ${heading} before any item`);
        }
        items[items.length - 1] += "\n";
        continue;
      }
      const parsed = parseListItem(line);
      if (parsed === undefined) {
        if (!open) {
          fail(`malformed ${heading}: expected numbered item`);
        }
        items[items.length - 1] += `\n${line}`;
      } else if (parsed.digits === String(expected) && parsed.number === expected) {
        items.push(parsed.text);
        expected += 1;
        open = true;
      } else {
        fail(`malformed numbering in ${heading}: expected ${expected}`);
      }
    }
    return items;
  };

  const objective = scalar("Objective:");
  if (objective === undefined) {
    fail("missing Objective section");
  }
  const candidate: {
    from: unknown;
    to: unknown;
    objective: unknown;
    context?: unknown;
    requirements?: unknown;
    acceptance_criteria?: unknown;
    constraints?: unknown;
    artifacts?: unknown;
    notes?: unknown;
    next_action?: unknown;
  } = { from, to, objective };
  const context = scalar("Context:");
  if (context !== undefined) {
    candidate.context = context;
  }
  const requirements = list("Requirements:");
  if (requirements !== undefined) {
    candidate.requirements = requirements;
  }
  const acceptanceCriteria = list("Acceptance Criteria:");
  if (acceptanceCriteria !== undefined) {
    candidate.acceptance_criteria = acceptanceCriteria;
  }
  const constraints = list("Constraints:");
  if (constraints !== undefined) {
    candidate.constraints = constraints;
  }
  const artifacts = list("Artifacts:");
  if (artifacts !== undefined) {
    candidate.artifacts = artifacts;
  }
  const notes = scalar("Notes:");
  if (notes !== undefined) {
    candidate.notes = notes;
  }
  const nextAction = scalar("Next Action:");
  if (nextAction !== undefined) {
    candidate.next_action = nextAction;
  }

  const validated = validateAgentHandoff(candidate);
  const canonical = `${lines.join("\n")}\n`;
  if (renderAgentHandoff(validated) !== canonical) {
    fail("input is not canonical rendering");
  }
  return validated;
}
