/**
 * Mode Recommendation (M27 T-030).
 *
 * Pure, deterministic advice over explicit caller-supplied
 * facts — never an authorization, never execution, never a
 * guardrail. The roadmap fixes the output surface (recommended
 * mode, reason, required confirmation) but defines no signal
 * policy, so this module establishes the smallest policy the
 * mode capabilities support, documented here and tested at
 * every boundary:
 *
 * - `needsBusinessPlanning`, `needsSprintDecomposition`, or
 *   `needsApprovals` true → `full`. Only FULL composes PM
 *   planning, Sprint/Task generation, and approval gates.
 * - Otherwise, `needsTechnicalPlanning` true → `standard`.
 *   STANDARD composes Coordinator/TL planning without the
 *   PM/sprint/approval lifecycle.
 * - Otherwise → `fast`. A bounded change with no planning
 *   needs fits the minimal Implementer/Reviewer lifecycle.
 *
 * The caller asserts the signals; the function never infers
 * them from text, reports, scope, risk, or size — the
 * rationale names only the supplied signals and the rule
 * applied. An explicit `selectedMode` is preserved verbatim:
 * agreement and disagreement are represented transparently
 * (`matchesSelection`), and disagreement is exactly what
 * `requiresConfirmation` means — the caller resolves it, this
 * module enforces nothing. T-031 owns guardrails; T-027/028/029
 * own execution; this module calls none of them.
 */

import { WorkMode, isWorkMode, validateWorkMode } from "./work-mode";

export interface ModeRecommendationSignals {
  /** PM/business-side planning is needed (requirements, scope, business rules). */
  readonly needsBusinessPlanning: boolean;
  /** Sprint/Task breakdown is needed. */
  readonly needsSprintDecomposition: boolean;
  /** Approval gates are needed (planning approval, acceptance, final approval). */
  readonly needsApprovals: boolean;
  /** Coordinator/TL planning involvement is needed. */
  readonly needsTechnicalPlanning: boolean;
}

export interface ModeRecommendationInput {
  /** The four capability signals; all required, all boolean, never inferred. */
  readonly signals: ModeRecommendationSignals;
  /** Explicit user-selected mode, preserved verbatim when supplied. */
  readonly selectedMode?: unknown;
}

export interface ModeRecommendation {
  readonly recommended: WorkMode;
  /** Deterministic explanation naming the supplied signals and the rule applied. */
  readonly rationale: string;
  /** Defensive frozen copy of the supplied signals. */
  readonly signals: ModeRecommendationSignals;
  /** The caller's explicit selection, present only when supplied. */
  readonly selected?: WorkMode;
  /** False exactly when an explicit selection differs from the recommendation. */
  readonly matchesSelection: boolean;
  /** True exactly when the caller must resolve a selection discrepancy. */
  readonly requiresConfirmation: boolean;
}

function fail(what: string): never {
  throw new Error(`mode recommendation: ${what}`);
}

function checkSignals(value: unknown): ModeRecommendationSignals {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("signals must be an object with four boolean capability flags");
  }
  const raw = value as Record<string, unknown>;
  for (const field of ["needsBusinessPlanning", "needsSprintDecomposition", "needsApprovals", "needsTechnicalPlanning"] as const) {
    if (typeof raw[field] !== "boolean") {
      fail(`signals.${field} must be a boolean`);
    }
  }
  return Object.freeze({
    needsBusinessPlanning: raw.needsBusinessPlanning as boolean,
    needsSprintDecomposition: raw.needsSprintDecomposition as boolean,
    needsApprovals: raw.needsApprovals as boolean,
    needsTechnicalPlanning: raw.needsTechnicalPlanning as boolean,
  });
}

/**
 * Recommend one work mode from explicit caller signals.
 * Validates the signals and an optional explicit selection,
 * applies the documented rules in fixed order, and returns
 * the frozen recommendation. Synchronous, pure, and
 * side-effect free: no providers, no execution paths, no
 * I/O, no state. Invalid input throws; the selection is
 * never replaced.
 */
export function recommendMode(input: ModeRecommendationInput): ModeRecommendation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a recommendation input object");
  }
  const signals = checkSignals(input.signals);
  let selected: WorkMode | undefined;
  if (input.selectedMode !== undefined) {
    if (!isWorkMode(input.selectedMode)) {
      fail(`selectedMode must be a canonical work mode, got ${JSON.stringify(input.selectedMode)}`);
    }
    selected = validateWorkMode(input.selectedMode);
  }

  let recommended: WorkMode;
  let rationale: string;
  const fullNeeds: string[] = [];
  if (signals.needsBusinessPlanning) {
    fullNeeds.push("business planning required");
  }
  if (signals.needsSprintDecomposition) {
    fullNeeds.push("sprint decomposition required");
  }
  if (signals.needsApprovals) {
    fullNeeds.push("approvals required");
  }
  if (fullNeeds.length > 0) {
    recommended = "full";
    rationale = `recommend full: ${fullNeeds.join("; ")}`;
  } else if (signals.needsTechnicalPlanning) {
    recommended = "standard";
    rationale = "recommend standard: technical planning required; no full-lifecycle needs";
  } else {
    recommended = "fast";
    rationale = "recommend fast: bounded change with no planning needs";
  }
  if (selected !== undefined && selected !== recommended) {
    rationale = `${rationale}; selected mode is ${selected}, which differs from the recommendation`;
  }
  const matchesSelection = selected === undefined || selected === recommended;
  return Object.freeze({
    recommended,
    rationale,
    signals,
    ...(selected !== undefined ? { selected } : {}),
    matchesSelection,
    requiresConfirmation: !matchesSelection,
  } as const);
}
