/**
 * Canonical handoff contract (M22 T-003).
 *
 * The structured work artifact one role (or, later, the user
 * boundary) hands to another: who sends, who receives, what the
 * receiver is expected to do, and the bounded information needed to
 * do it. Data contract only: no rendering (T-004), no transport, no
 * routing, no execution, no persistence.
 *
 * Semantic layering (deliberate, not a mismatch to fix):
 *
 * - T-001 `operating-model.ts` declares which role-to-role
 *   directions are approved (`isApprovedHandoff`, 11 pairs). This
 *   module does not re-check that table: any two distinct canonical
 *   roles form a structurally valid handoff, and direction approval
 *   stays with the operating model (T-004 composes both).
 * - `workflow/retry-handoff.ts` stays the narrower retry/rework
 *   mechanism with its own 9 M0 pairs (`HandoffContext`,
 *   `createHandoff`). It is untouched: retry transport directions
 *   and canonical role directions are different layers, so their
 *   sets are not required to be identical.
 * - `RoleContract` stays the responsibility source; `AgentIdentity`
 *   stays the WHO. This module carries no responsibilities, no
 *   authority, and no provider/session/transport fields.
 *
 * Every field is justified by existing role behavior: `from`/`to`
 * are the canonical sender/receiver; `objective` states what the
 * receiver must do; `context` is bounded background (never a
 * mandatory transcript); `requirements` preserves business
 * requirements verbatim and separately from `constraints`
 * (technical/scope/security/compatibility limits); explicit
 * `acceptance_criteria` stay optional because not every handoff
 * needs them; `artifacts` are bounded textual references (plan,
 * spec, task, review result) with no URI system; `notes` carry
 * bounded extras without decision semantics; `next_action`
 * describes the expected next step without commanding execution.
 * There is deliberately no approval flag, no workflow-state field,
 * no report parser, no generated ID, and no timestamp: a handoff
 * transports information and intended next work, never implicit
 * decisions or authority.
 */

import { RoleId, isRoleId } from "./contract";

/** Maximum length of any single text field: background, never a transcript. */
export const MAX_HANDOFF_TEXT_LENGTH = 8000;

/** Maximum entries in any collection field. */
export const MAX_HANDOFF_ITEMS = 100;

/**
 * Work moving from one canonical role to another. Frozen on
 * creation, including defensive copies of every collection: the
 * sender's artifact can never be modified by the receiver, and the
 * caller's input is never retained by reference.
 */
export interface AgentHandoff {
  readonly from: RoleId;
  readonly to: RoleId;
  readonly objective: string;
  readonly context?: string;
  readonly requirements?: readonly string[];
  readonly acceptance_criteria?: readonly string[];
  readonly constraints?: readonly string[];
  readonly artifacts?: readonly string[];
  readonly notes?: string;
  readonly next_action?: string;
}

function fail(what: string): never {
  throw new Error(`agent handoff: ${what}`);
}

/** True for values shaped like a canonical handoff. Structural only; bounds belong to creation. */
export function isAgentHandoff(value: unknown): value is AgentHandoff {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const raw = value as Record<string, unknown>;
  if (!isRoleId(raw.from) || !isRoleId(raw.to)) {
    return false;
  }
  return typeof raw.objective === "string";
}

function checkText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  if (value.length > MAX_HANDOFF_TEXT_LENGTH) {
    fail(`${field} exceeds the ${MAX_HANDOFF_TEXT_LENGTH}-character bound`);
  }
  return value;
}

function checkOptionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return checkText(value, field);
}

function checkItems(value: unknown, field: string): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    fail(`${field} must be an array of strings`);
  }
  if (value.length > MAX_HANDOFF_ITEMS) {
    fail(`${field} exceeds the ${MAX_HANDOFF_ITEMS}-item bound`);
  }
  for (const entry of value) {
    checkText(entry, `${field} entry`);
  }
  return Object.freeze([...(value as string[])]);
}

/**
 * Build a canonical handoff from raw data and return it frozen.
 * Rejects unknown roles (aliases included — `pm` never validates),
 * identical sender and receiver (no repository use case requires
 * self-handoff), missing or unbounded objective, unbounded or
 * malformed collections. Extra fields — approvals, workflow states,
 * provider metadata, timestamps, IDs, reports — never become part
 * of the handoff: they are dropped, not carried. Deterministic:
 * same input, same frozen output or same error. Never mutates the
 * input and never retains its collections by reference.
 */
export function createAgentHandoff(data: unknown): AgentHandoff {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected a handoff object");
  }
  const raw = data as Record<string, unknown>;
  if (!isRoleId(raw.from)) {
    fail(`expected a canonical sender role, got ${JSON.stringify(raw.from)}`);
  }
  if (!isRoleId(raw.to)) {
    fail(`expected a canonical receiver role, got ${JSON.stringify(raw.to)}`);
  }
  if (raw.from === raw.to) {
    fail(`sender and receiver must differ, got ${JSON.stringify(raw.from)} twice`);
  }
  const handoff: {
    from: RoleId;
    to: RoleId;
    objective: string;
    context?: string;
    requirements?: readonly string[];
    acceptance_criteria?: readonly string[];
    constraints?: readonly string[];
    artifacts?: readonly string[];
    notes?: string;
    next_action?: string;
  } = {
    from: raw.from,
    to: raw.to,
    objective: checkText(raw.objective, "objective"),
  };
  const context = checkOptionalText(raw.context, "context");
  if (context !== undefined) {
    handoff.context = context;
  }
  const requirements = checkItems(raw.requirements, "requirements");
  if (requirements !== undefined) {
    handoff.requirements = requirements;
  }
  const acceptanceCriteria = checkItems(raw.acceptance_criteria, "acceptance_criteria");
  if (acceptanceCriteria !== undefined) {
    handoff.acceptance_criteria = acceptanceCriteria;
  }
  const constraints = checkItems(raw.constraints, "constraints");
  if (constraints !== undefined) {
    handoff.constraints = constraints;
  }
  const artifacts = checkItems(raw.artifacts, "artifacts");
  if (artifacts !== undefined) {
    handoff.artifacts = artifacts;
  }
  const notes = checkOptionalText(raw.notes, "notes");
  if (notes !== undefined) {
    handoff.notes = notes;
  }
  const nextAction = checkOptionalText(raw.next_action, "next_action");
  if (nextAction !== undefined) {
    handoff.next_action = nextAction;
  }
  return Object.freeze(handoff);
}
