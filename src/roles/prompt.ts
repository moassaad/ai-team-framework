import { RoleId } from "./contract";
import { resolveRole } from "./selection";

/**
 * Prompt-based role selection (CLI-004).
 *
 * Deterministic English keyword mapping from the approved specification
 * (roles.md §7): case-insensitive keyword matching over a fixed keyword
 * set. Exactly one distinct matched role resolves; zero or conflicting
 * matches yield `undefined` (no fallback, no guessing). This is not
 * natural-language understanding: no inference, scoring, fuzzy matching,
 * translations, or LLM calls. Arabic and other languages are out of scope
 * pending OQ-2. Matched keywords resolve through `resolveRole()` so the
 * single role-selection seam stays authoritative.
 */

const PROMPT_KEYWORDS: ReadonlyArray<readonly [keyword: string, role: RoleId]> = [
  ["coordinator", "coordinator"],
  ["project manager", "project-manager"],
  ["pm", "project-manager"],
  ["technical lead", "technical-lead"],
  ["tech lead", "technical-lead"],
  ["implementer", "implementer"],
  ["senior reviewer", "senior-reviewer"],
  ["reviewer", "senior-reviewer"],
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PROMPT_PATTERNS: ReadonlyArray<readonly [RegExp, RoleId]> =
  PROMPT_KEYWORDS.map(([keyword, role]) => [
    new RegExp(`\\b${escapeRegExp(keyword)}\\b`),
    role,
  ]);

/**
 * Map prompt text to a canonical role id, or `undefined` when the text
 * matches no keyword or matches keywords of more than one role.
 */
export function resolvePromptRole(input: string): RoleId | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  const text = input.toLowerCase();
  const matched = new Set<RoleId>();
  for (const [pattern, role] of PROMPT_PATTERNS) {
    if (pattern.test(text)) {
      matched.add(role);
    }
  }
  if (matched.size !== 1) {
    return undefined;
  }
  const only: RoleId = [...matched][0];
  return resolveRole(only)?.role;
}
