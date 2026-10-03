/**
 * Plan-to-Ticket Mapper (M24 T-014).
 *
 * Pure transformation from the planning domain (validated T-012
 * Task) into the repository's two existing ticket
 * representations (roadmap T-014 names both; no new ticket
 * schema is created):
 *
 * - `CoordinatorTicket`: the internal workflow ticket, validated
 *   by `isTicket`. Returned unfrozen on purpose — the runtime
 *   advances `state` in place by design, so freezing would break
 *   the existing contract.
 * - `IssueRequest`: the external issue payload, built through
 *   `validateIssueRequest` (frozen copy). Identity is never set
 *   here — the provider assigns `IssueReference.id` externally.
 *
 * Field mapping (explicit; every Task field has a recorded
 * disposition, none silently dropped):
 *
 * | Task field          | CoordinatorTicket      | IssueRequest           |
 * |---------------------|------------------------|------------------------|
 * | id                  | id (identity preserved,| — (provider assigns   |
 * |                     | never generated)       | IssueReference.id)     |
 * | title               | title (verbatim)       | title (verbatim)       |
 * | description         | description base       | description base       |
 * | requirements        | requirements (verbatim)| requirements (verbatim)|
 * | acceptance_criteria | appended labeled       | appended labeled       |
 * |                     | section, see below     | section, see below     |
 * | dependencies        | not represented        | not represented        |
 * | specialty           | not represented        | not represented        |
 * | sprint              | not represented        | not represented        |
 *
 * Acceptance criteria have no structured home in either
 * destination, so non-empty criteria ride as a labeled
 * `"\n\nAcceptance criteria:\n"` section on the description —
 * the repository's established labeled-append convention
 * (rework appends reviewer feedback the same way), never a new
 * field. Dependencies stay with decomposition/persistence
 * (no ticket representation exists); specialty resolves at
 * runtime through the existing RoleResolver (no ticket field
 * exists); sprint grouping stays with the Sprint model (no
 * ticket field exists, no Sprint ticket invented).
 *
 * New tickets enter the workflow as `"ready"` — the lifecycle's
 * only entry state for new work (the runtime selects ready
 * tickets; no transition is performed here). Task → exactly one
 * ticket; no aggregation, no fan-out, no Sprint ticket.
 *
 * Synchronous, pure, deterministic, side-effect free: no
 * providers, no transport, no persistence, no mutation of
 * inputs, no orchestration. Malformed tasks are rejected
 * through T-012 validation, never repaired.
 */

import { Task, validateTask } from "./task-model";
import { CoordinatorTicket, isTicket } from "./coordinator";
import { IssueRequest, validateIssueRequest } from "../providers/issue";

function fail(what: string): never {
  throw new Error(`plan ticket mapper: ${what}`);
}

function descriptionWithCriteria(description: string, acceptanceCriteria: readonly string[] | undefined): string {
  if (acceptanceCriteria === undefined || acceptanceCriteria.length === 0) {
    return description;
  }
  return `${description}\n\nAcceptance criteria:\n${acceptanceCriteria.join("\n")}`;
}

/**
 * Map one validated Task to one workflow ticket. Identity
 * preserved (`Task.id` → `Ticket.id`, the shared T-NNN
 * convention — nothing generated); title, description, and
 * requirements verbatim; acceptance criteria as a labeled
 * description section when present; state `"ready"` as the
 * lifecycle entry point. Returns a fresh, intentionally
 * unfrozen ticket; throws on malformed tasks.
 */
export function mapTaskToTicket(task: unknown): CoordinatorTicket {
  const validated: Task = validateTask(task);
  const ticket: CoordinatorTicket = {
    id: validated.id,
    title: validated.title,
    description: descriptionWithCriteria(validated.description, validated.acceptance_criteria),
    requirements: validated.requirements,
    state: "ready",
  };
  if (!isTicket(ticket)) {
    fail("mapped ticket does not satisfy the ticket contract");
  }
  return ticket;
}

/**
 * Map one validated Task to one issue payload through the
 * canonical `validateIssueRequest` contract (frozen result).
 * Same field mapping as tickets; no identifier is set — issue
 * identity is provider-assigned externally. Throws on malformed
 * tasks.
 */
export function mapTaskToIssueRequest(task: unknown): IssueRequest {
  const validated: Task = validateTask(task);
  return validateIssueRequest({
    title: validated.title,
    description: descriptionWithCriteria(validated.description, validated.acceptance_criteria),
    requirements: validated.requirements,
  });
}
