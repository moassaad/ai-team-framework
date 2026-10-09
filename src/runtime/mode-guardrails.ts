/**
 * Mode Guardrails (M27 T-031).
 *
 * Deterministic capability check over an explicitly selected
 * work mode plus the T-030 caller signals — distinct from
 * recommendation (which mode best matches), confirmation
 * (caller acknowledgement of a compatible discrepancy), and
 * execution (which this module never initiates):
 *
 * - FULL-required signals (`needsBusinessPlanning`,
 *   `needsSprintDecomposition`, `needsApprovals`): only
 *   `full` composes PM planning, Sprint/Task generation, and
 *   approval gates. `fast`/`standard` are rejected, and no
 *   confirmation can bypass the missing capability.
 * - `needsTechnicalPlanning` alone: `standard` and `full`
 *   compose Coordinator/TL planning; `fast` does not.
 * - No signals: every mode is capability-compatible.
 *
 * A compatible selection that differs from the recommendation
 * is not a violation, but it requires explicit confirmation
 * before an allow decision: absent confirmation is never
 * approval, and confirmation acknowledges the discrepancy
 * only — never unmet capabilities. The recommendation itself
 * is reused verbatim (`recommendMode` with the same signals
 * and selection); both values are preserved separately in
 * every result, and the selection is never replaced.
 *
 * Enforcement boundary: this module evaluates; it does not
 * execute, approve, persist, or re-enter anything, and it
 * claims nothing about direct runtime calls made outside it.
 * M29 owns orchestration-wide enforcement.
 */

import { WorkMode, isWorkMode, validateWorkMode, getWorkModeDescriptor } from "./work-mode";
import { recommendMode, ModeRecommendationSignals } from "./mode-recommendation";

/** Explicit discrepancy confirmation: acknowledgement, never inferred. */
export interface ModeConfirmation {
  readonly confirmed: boolean;
}

export interface ModeGuardrailInput {
  /** Explicitly selected mode; required, never defaulted. */
  readonly selectedMode: unknown;
  /** Required capability signals; validated strictly like T-030. */
  readonly signals: unknown;
  /** Explicit discrepancy confirmation; absent means unconfirmed. */
  readonly confirmation?: unknown;
}

export interface ModeGuardrailAllow {
  readonly decision: "allow";
  readonly selected: WorkMode;
  readonly recommended: WorkMode;
  readonly matchesRecommendation: boolean;
  /** True when an explicit confirmation resolved a compatible discrepancy. */
  readonly confirmationApplied: boolean;
  readonly reasons: readonly string[];
}

export interface ModeGuardrailConfirmationRequired {
  readonly decision: "confirmation-required";
  readonly selected: WorkMode;
  readonly recommended: WorkMode;
  readonly matchesRecommendation: false;
  readonly unmetCapabilities: readonly [];
  readonly reasons: readonly string[];
}

export interface ModeGuardrailReject {
  readonly decision: "reject";
  readonly selected: WorkMode;
  readonly recommended: WorkMode;
  readonly matchesRecommendation: boolean;
  /** Required capabilities the selected mode lacks, in signal order. */
  readonly unmetCapabilities: readonly string[];
  readonly reasons: readonly string[];
}

export type ModeGuardrailResult = ModeGuardrailAllow | ModeGuardrailConfirmationRequired | ModeGuardrailReject;

function fail(what: string): never {
  throw new Error(`mode guardrails: ${what}`);
}

function checkConfirmation(value: unknown): ModeConfirmation | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("confirmation must be an object with a boolean confirmed field");
  }
  const confirmed = (value as Record<string, unknown>).confirmed;
  if (typeof confirmed !== "boolean") {
    fail("confirmation.confirmed must be a boolean");
  }
  return Object.freeze({ confirmed });
}

/** Minimum modes satisfying each signal, derived from the live T-026 descriptors. */
function unmetFor(selected: WorkMode, signals: ModeRecommendationSignals): string[] {
  // Capability sets come from the descriptors, not prose: the
  // full-lifecycle composition is exactly the modes carrying
  // the sprint and approval flags; technical planning is
  // exactly the modes carrying the planning flag.
  const modes = ["fast", "standard", "full"] as const;
  const fullLifecycle = modes.filter((mode) => {
    const descriptor = getWorkModeDescriptor(mode);
    return descriptor.sprints && descriptor.approvals;
  });
  const technicalPlanning = modes.filter((mode) => getWorkModeDescriptor(mode).planning);
  const unmet: string[] = [];
  if (signals.needsBusinessPlanning && !fullLifecycle.includes(selected)) {
    unmet.push("needsBusinessPlanning requires full");
  }
  if (signals.needsSprintDecomposition && !fullLifecycle.includes(selected)) {
    unmet.push("needsSprintDecomposition requires full");
  }
  if (signals.needsApprovals && !fullLifecycle.includes(selected)) {
    unmet.push("needsApprovals requires full");
  }
  if (signals.needsTechnicalPlanning && !technicalPlanning.includes(selected)) {
    unmet.push("needsTechnicalPlanning requires standard or full");
  }
  return unmet;
}

/**
 * Evaluate whether an explicitly selected mode satisfies the
 * required lifecycle capabilities. Validates the selection,
 * signals, and optional confirmation strictly; reuses the
 * T-030 recommendation for the recommended value; returns a
 * frozen discriminated result. Synchronous, pure, and
 * side-effect free: no runners, providers, I/O, approvals, or
 * state. Invalid input throws; the selection is never
 * replaced or promoted.
 */
export function checkModeGuardrails(input: ModeGuardrailInput): ModeGuardrailResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a guardrail input object");
  }
  if (!isWorkMode(input.selectedMode)) {
    fail(`selectedMode must be a canonical work mode, got ${JSON.stringify(input.selectedMode)}`);
  }
  const selected = validateWorkMode(input.selectedMode);
  const confirmation = checkConfirmation(input.confirmation);
  const recommendation = recommendMode({ signals: input.signals as ModeRecommendationSignals, selectedMode: selected });
  const recommended = recommendation.recommended;
  const matchesRecommendation = recommendation.matchesSelection;
  const unmet = Object.freeze(unmetFor(selected, recommendation.signals));

  if (unmet.length > 0) {
    return Object.freeze({
      decision: "reject",
      selected,
      recommended,
      matchesRecommendation,
      unmetCapabilities: unmet,
      reasons: Object.freeze(unmet.map((capability) => `${capability}; selected ${selected}`)),
    } as const);
  }
  if (matchesRecommendation) {
    return Object.freeze({
      decision: "allow",
      selected,
      recommended,
      matchesRecommendation: true,
      confirmationApplied: false,
      reasons: Object.freeze([`selected ${selected} satisfies all required capabilities and matches the recommendation`]),
    } as const);
  }
  if (confirmation !== undefined && confirmation.confirmed) {
    return Object.freeze({
      decision: "allow",
      selected,
      recommended,
      matchesRecommendation: false,
      confirmationApplied: true,
      reasons: Object.freeze([`selected ${selected} satisfies all required capabilities; explicit confirmation resolved the recommendation discrepancy`]),
    } as const);
  }
  return Object.freeze({
    decision: "confirmation-required",
    selected,
    recommended,
    matchesRecommendation: false,
    unmetCapabilities: Object.freeze([] as []),
    reasons: Object.freeze([`selected ${selected} satisfies all required capabilities but differs from recommended ${recommended}; explicit confirmation required`]),
  } as const);
}
