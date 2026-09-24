/**
 * Local-only fallback issue provider (G-007).
 *
 * A concrete `IssueProvider` that keeps entries in memory inside the
 * provider instance: no remote tracker, no network, no secrets.
 * `create` assigns the next deterministic identifier, `update`
 * revises stored fields while preserving the rest, `complete` marks
 * an entry finished and stays idempotent. Entries start open.
 * Identifiers are runtime-local (`local-1`, `local-2`, …): a new
 * instance starts empty, and nothing survives a restart. One call
 * performs exactly one local operation and nothing more.
 */

import {
  IssueProvider,
  IssueReference,
  IssueRequest,
  IssueUpdate,
  validateIssueReference,
  validateIssueRequest,
  validateIssueUpdate,
} from "./issue";

/** Stable fallback identity, local to this concrete module. */
export const LOCAL_ISSUE_PROVIDER_NAME = "local" as const;

interface LocalEntry {
  readonly title: string;
  readonly description: string;
  readonly requirements?: string;
  state: "open" | "closed";
}

/**
 * Build a local-only issue provider. Each instance owns an
 * independent in-memory store; instances share nothing.
 */
export function createLocalIssueProvider(): IssueProvider {
  const entries = new Map<string, LocalEntry>();
  let next = 1;
  return {
    name: LOCAL_ISSUE_PROVIDER_NAME,
    create: async (request: IssueRequest): Promise<IssueReference> => {
      const invocation = validateIssueRequest(request);
      const id = `local-${next}`;
      next += 1;
      const entry: LocalEntry = { title: invocation.title, description: invocation.description, state: "open" };
      if (invocation.requirements !== undefined) {
        (entry as { requirements?: string }).requirements = invocation.requirements;
      }
      entries.set(id, entry);
      return validateIssueReference({ id });
    },
    update: async (reference: IssueReference, update: IssueUpdate): Promise<IssueReference> => {
      const target = validateIssueReference(reference);
      const change = validateIssueUpdate(update);
      const current = entries.get(target.id);
      if (current === undefined) {
        throw new Error("local issue provider: unknown issue");
      }
      const revised: LocalEntry = {
        title: change.title ?? current.title,
        description: change.description ?? current.description,
        state: current.state,
      };
      const requirements = change.requirements ?? current.requirements;
      if (requirements !== undefined) {
        (revised as { requirements?: string }).requirements = requirements;
      }
      entries.set(target.id, revised);
      return validateIssueReference({ id: target.id });
    },
    complete: async (reference: IssueReference): Promise<IssueReference> => {
      const target = validateIssueReference(reference);
      const current = entries.get(target.id);
      if (current === undefined) {
        throw new Error("local issue provider: unknown issue");
      }
      current.state = "closed";
      return validateIssueReference({ id: target.id });
    },
  };
}
