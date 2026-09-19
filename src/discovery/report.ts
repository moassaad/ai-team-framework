/**
 * Project analysis report generation (A-006).
 *
 * Pure composition layer: aggregates findings from existing detectors
 * (A-002 through A-005) without adding new detection logic, filesystem
 * scanning, subprocesses, network access, or invented findings.
 * Makes detection coverage explicit.
 */

import {
  DiscoveryFinding,
  ProjectContext,
  validateProjectContext,
  DISCOVERY_CATEGORIES,
  DiscoveryCategory,
} from "./contract";
import { detectProjectStack } from "./stack";
import { detectProjectTools } from "./tools";
import { detectTestingTools } from "./testing";
import { detectProjectConventions } from "./conventions";

/** Categories that have been analyzed by implemented detectors. */
export const ANALYZED_CATEGORIES: readonly DiscoveryCategory[] = [
  "languages",
  "backend_framework",
  "frontend_framework",
  "database",
  "package_managers",
  "build_tools",
  "testing_tools",
  "naming_conventions",
  "architecture",
  "documentation",
  "git",
  "technical_constraints",
] as const;

/** All specification categories (from DISCOVERY_CATEGORIES). */
export const ALL_SPEC_CATEGORIES: readonly DiscoveryCategory[] = DISCOVERY_CATEGORIES;

/** Categories not yet covered by any detector. */
export const UNCOVERED_CATEGORIES: readonly DiscoveryCategory[] = ALL_SPEC_CATEGORIES.filter(
  (c) => !ANALYZED_CATEGORIES.includes(c),
);

export interface CoverageInfo {
  /** Categories actually analyzed by at least one detector. */
  analyzed: readonly DiscoveryCategory[];
  /** Categories not yet covered by any implemented detector. */
  uncovered: readonly DiscoveryCategory[];
  /** Total categories in the specification. */
  totalSpecCategories: number;
}

/** Aggregated project analysis report. */
export interface ProjectAnalysisReport {
  /** The target project context (validated). */
  project: ProjectContext;
  /** All findings from composed detectors, in DISCOVERY_CATEGORIES order. */
  findings: readonly DiscoveryFinding[];
  /** Coverage metadata. */
  coverage: CoverageInfo;
  /** Generation metadata (deterministic, no timestamps). */
  meta: {
    /** Name of this report format for versioning. */
    format: "ai-team-discovery-report";
    /** Format version. */
    version: 1;
  };
}

/** Category order for deterministic report output. */
const REPORT_CATEGORY_ORDER: readonly DiscoveryCategory[] = DISCOVERY_CATEGORIES;

/**
 * Generate a project analysis report by composing existing detectors.
 *
 * Calls: detectProjectStack, detectProjectTools, detectTestingTools,
 * detectProjectConventions. No independent filesystem access.
 *
 * @param context - Target project context (validated via A-001 contract).
 * @returns Structured report with findings, coverage, and context.
 */
export function generateProjectAnalysis(context: ProjectContext): ProjectAnalysisReport {
  const project = validateProjectContext(context);

  // Compose all detector findings
  const stackFindings = detectProjectStack(project);
  const toolsFindings = detectProjectTools(project);
  const testingFindings = detectTestingTools(project);
  const conventionsFindings = detectProjectConventions(project);

  // Merge all findings, preserving detector output order within each detector
  // but overall ordered by DISCOVERY_CATEGORIES for determinism
  const allFindings: DiscoveryFinding[] = [
    ...stackFindings,
    ...toolsFindings,
    ...testingFindings,
    ...conventionsFindings,
  ];

  // Sort findings by DISCOVERY_CATEGORIES order for stable output
  const orderedFindings = [...allFindings].sort((a, b) => {
    const idxA = REPORT_CATEGORY_ORDER.indexOf(a.category);
    const idxB = REPORT_CATEGORY_ORDER.indexOf(b.category);
    return idxA - idxB;
  });

  const coverage: CoverageInfo = {
    analyzed: ANALYZED_CATEGORIES,
    uncovered: UNCOVERED_CATEGORIES,
    totalSpecCategories: ALL_SPEC_CATEGORIES.length,
  };

  return Object.freeze({
    project: Object.freeze({ ...project }),
    findings: Object.freeze(orderedFindings),
    coverage: Object.freeze(coverage),
    meta: Object.freeze({ format: "ai-team-discovery-report", version: 1 }),
  });
}