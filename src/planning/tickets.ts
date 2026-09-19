/**
 * Plan-to-ticket decomposition (P-004).
 *
 * Pure planning-domain transformation: a P-003 plan becomes an ordered
 * list of ticket structures. Segmentation follows explicit document
 * structure only — one ticket per markdown section, leading unheaded
 * content as an overview ticket — with every text carried verbatim.
 * No providers, no execution, no surrounding systems, nothing external.
 */

import { Plan } from "./mapper";
import { isSpecificationArtifactKind } from "../providers/specification";

export interface PlanTicket {
  /** Deterministic index-based identifier (`T-001`, `T-002`, …). */
  readonly id: string;
  /** Section heading text, or `Overview` for leading content. */
  readonly title: string;
  /** Section block text, verbatim including its heading line. */
  readonly description: string;
  /** Plan requirements text, verbatim on every ticket. */
  readonly requirements: string;
}

function fail(what: string): never {
  throw new Error(`ticket generation: invalid input (${what})`);
}

/**
 * Validate raw data as a P-003 plan and return a frozen copy. Checks
 * shape only: non-empty requirements and specification, supported
 * basis kind. Unknown extra fields are ignored, never carried over.
 */
export function validatePlan(data: unknown): Plan {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  if (typeof raw.requirements !== "string" || raw.requirements.length === 0) {
    fail("requirements must be a non-empty string");
  }
  if (!isSpecificationArtifactKind(raw.basis)) {
    fail(`unknown basis ${JSON.stringify(raw.basis)}`);
  }
  if (typeof raw.specification !== "string" || raw.specification.length === 0) {
    fail("specification must be a non-empty string");
  }
  return Object.freeze({
    requirements: raw.requirements,
    basis: raw.basis,
    specification: raw.specification,
  });
}

interface Section {
  title: string;
  lines: string[];
}

function splitSections(specification: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const line of specification.split("\n")) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (heading) {
      current = { title: heading[2]!.trim(), lines: [line] };
      sections.push(current);
    } else {
      if (current === null) {
        current = { title: "Overview", lines: [] };
        sections.push(current);
      }
      current.lines.push(line);
    }
  }
  return sections.filter((section) =>
    section.lines.some((line) => line.trim().length > 0),
  );
}

function ticketId(index: number): string {
  return `T-${String(index + 1).padStart(3, "0")}`;
}

/**
 * Decompose a validated plan into ticket structures. Deterministic and
 * side-effect free: document order is preserved, identical inputs yield
 * identical frozen output, caller inputs never mutated. A specification
 * with no substantive content yields zero tickets rather than invented
 * ones.
 */
export function generateTicketsFromPlan(plan: Plan): readonly PlanTicket[] {
  const validated = validatePlan(plan);
  const tickets = splitSections(validated.specification).map((section, index) =>
    Object.freeze({
      id: ticketId(index),
      title: section.title,
      description: section.lines.join("\n"),
      requirements: validated.requirements,
    }),
  );
  return Object.freeze(tickets);
}
