/**
 * Issue metadata extraction (G-004).
 *
 * Pure planning-to-issue transformation: a P-004 ticket plus its
 * current workflow state becomes the provider-neutral metadata that
 * a later creation step consumes. Title, description, and
 * requirements pass through verbatim — no prefixes, no footers, no
 * rewrites. The issue state comes only from the G-003 seam; no
 * mapping table lives here. No trackers, no transport, no network,
 * no creation, no synchronization, no workflow changes.
 */

import { PlanTicket } from "../planning/tickets";
import { WorkflowState, isWorkflowState } from "../workflow/states";
import { IssueState, isIssueState, mapTicketStateToIssueState } from "./state-map";

export interface IssueMetadata {
  /** Ticket title, verbatim. Required, non-empty. */
  readonly title: string;
  /** Ticket description, verbatim. Required, non-empty. */
  readonly description: string;
  /** Ticket requirements, verbatim. Required, non-empty. */
  readonly requirements: string;
  /** Provider-neutral issue state derived through G-003. */
  readonly state: IssueState;
}

function fail(what: string): never {
  throw new Error(`issue metadata: invalid input (${what})`);
}

function nonEmptyText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

/** True for values shaped like extracted issue metadata. */
export function isIssueMetadata(value: unknown): value is IssueMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.title === "string" &&
    candidate.title.length > 0 &&
    typeof candidate.description === "string" &&
    candidate.description.length > 0 &&
    typeof candidate.requirements === "string" &&
    candidate.requirements.length > 0 &&
    isIssueState(candidate.state)
  );
}

/**
 * Validate raw data as issue metadata and return a frozen copy.
 * Unknown extra fields are ignored, never carried over.
 */
export function validateIssueMetadata(data: unknown): IssueMetadata {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  const metadata: IssueMetadata = {
    title: nonEmptyText(raw.title, "title"),
    description: nonEmptyText(raw.description, "description"),
    requirements: nonEmptyText(raw.requirements, "requirements"),
    state: isIssueState(raw.state) ? raw.state : fail(`unknown issue state ${JSON.stringify(raw.state)}`),
  };
  return Object.freeze(metadata);
}

/**
 * Extract provider-neutral metadata from a planning ticket and its
 * workflow state. The ticket identifier stays in the planning layer;
 * only title, description, requirements, and the G-003 issue state
 * cross into the metadata. Deterministic and side-effect free.
 */
export function extractIssueMetadata(ticket: PlanTicket, state: WorkflowState): IssueMetadata {
  if (typeof ticket !== "object" || ticket === null || Array.isArray(ticket)) {
    fail("expected a ticket object");
  }
  const source = ticket as unknown as Record<string, unknown>;
  const title = nonEmptyText(source.title, "title");
  const description = nonEmptyText(source.description, "description");
  const requirements = nonEmptyText(source.requirements, "requirements");
  if (!isWorkflowState(state)) {
    fail(`unknown workflow state ${JSON.stringify(state)}`);
  }
  return validateIssueMetadata({
    title,
    description,
    requirements,
    state: mapTicketStateToIssueState(state),
  });
}
