/**
 * Project discovery contract (A-001).
 *
 * Immutable data model for observations about an arbitrary target
 * project, derived from plan §7. Contract only: no filesystem scanning,
 * subprocess execution, detection, persistence, or provider calls.
 * Uncertainty is explicit — `unknown` is never collapsed into
 * `not_detected`, and neither is ever fabricated into a finding.
 */

export const DISCOVERY_CATEGORIES = [
  "languages",
  "backend_framework",
  "frontend_framework",
  "database",
  "package_managers",
  "build_tools",
  "testing_tools",
  "ci_cd",
  "containers",
  "git",
  "naming_conventions",
  "architecture",
  "documentation",
  "development_commands",
  "existing_issues",
  "entry_points",
  "technical_constraints",
  "sensitive_files",
] as const;
export type DiscoveryCategory = (typeof DISCOVERY_CATEGORIES)[number];

/** True for supported discovery categories. */
export function isDiscoveryCategory(value: unknown): value is DiscoveryCategory {
  return (
    typeof value === "string" &&
    (DISCOVERY_CATEGORIES as readonly string[]).includes(value)
  );
}

export type FindingStatus = "detected" | "not_detected" | "unknown";

/** True for supported finding statuses. */
export function isFindingStatus(value: unknown): value is FindingStatus {
  return value === "detected" || value === "not_detected" || value === "unknown";
}

export type EvidenceKind = "file" | "directory" | "manifest" | "command_output";

/**
 * Lightweight pointer to what supports a finding: a path, manifest,
 * command output, or directory listing. References only — never copied
 * project contents, never secret values.
 */
export interface DiscoveryEvidence {
  kind: EvidenceKind;
  ref: string;
  note?: string;
}

const EVIDENCE_KINDS: readonly string[] = ["file", "directory", "manifest", "command_output"];

export interface DiscoveryFinding {
  category: DiscoveryCategory;
  status: FindingStatus;
  /** The discovered fact in generic free text (e.g. "typescript", "react 18.2.0"). */
  value?: string;
  evidence?: DiscoveryEvidence[];
  /**
   * Classification flag only: marks findings that point at potentially
   * sensitive files/configuration. Never carries secret contents.
   */
  sensitive?: boolean;
}

export interface ProjectContext {
  /** Target project root. Framework workspace (`.ai-team/`) lives elsewhere. */
  root: string;
  name?: string;
  kind?: "new" | "existing";
}

function fail(what: string): never {
  throw new Error(`discovery contract: invalid finding (${what})`);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("expected an object");
  }
  return value as Record<string, unknown>;
}

/**
 * Validate raw data as a discovery finding and return a frozen copy.
 * Rejects unknown categories/statuses, missing required fields, wrong
 * types, and malformed evidence. Says nothing about any real project.
 */
export function validateFinding(data: unknown): DiscoveryFinding {
  const raw = asRecord(data);
  if (!isDiscoveryCategory(raw.category)) {
    fail(`unknown category ${JSON.stringify(raw.category)}`);
  }
  if (!isFindingStatus(raw.status)) {
    fail(`unknown status ${JSON.stringify(raw.status)}`);
  }
  const finding: DiscoveryFinding = { category: raw.category, status: raw.status };
  if (raw.value !== undefined) {
    if (typeof raw.value !== "string") {
      fail("value must be a string");
    }
    finding.value = raw.value;
  }
  if (raw.evidence !== undefined) {
    if (!Array.isArray(raw.evidence)) {
      fail("evidence must be an array");
    }
    finding.evidence = raw.evidence.map((entry) => {
      const item = asRecord(entry);
      if (typeof item.kind !== "string" || !EVIDENCE_KINDS.includes(item.kind)) {
        fail(`unknown evidence kind ${JSON.stringify(item.kind)}`);
      }
      if (typeof item.ref !== "string" || item.ref.length === 0) {
        fail("evidence ref must be a non-empty string");
      }
      const evidence: DiscoveryEvidence = {
        kind: item.kind as DiscoveryEvidence["kind"],
        ref: item.ref,
      };
      if (item.note !== undefined) {
        if (typeof item.note !== "string") {
          fail("evidence note must be a string");
        }
        evidence.note = item.note;
      }
      return Object.freeze(evidence);
    });
  }
  if (raw.sensitive !== undefined) {
    if (typeof raw.sensitive !== "boolean") {
      fail("sensitive must be a boolean");
    }
    finding.sensitive = raw.sensitive;
  }
  return Object.freeze(finding);
}

/**
 * Validate raw data as a target project context and return a frozen
 * copy. Only the root is required; nothing is read from disk.
 */
export function validateProjectContext(data: unknown): ProjectContext {
  const raw = asRecord(data);
  if (typeof raw.root !== "string" || raw.root.length === 0) {
    fail("project context requires a non-empty root");
  }
  const context: ProjectContext = { root: raw.root };
  if (raw.name !== undefined) {
    if (typeof raw.name !== "string") {
      fail("project name must be a string");
    }
    context.name = raw.name;
  }
  if (raw.kind !== undefined) {
    if (raw.kind !== "new" && raw.kind !== "existing") {
      fail(`unknown project kind ${JSON.stringify(raw.kind)}`);
    }
    context.kind = raw.kind;
  }
  return Object.freeze(context);
}
