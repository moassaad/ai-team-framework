import {
  APPROVAL_DEFAULTS,
  ApprovalAfter,
  ApprovalMode,
  FrameworkConfig,
  SensitiveChanges,
} from "../config/schema";

/**
 * Approval policy for workflow logic (W-003).
 *
 * A read-only view over the M2 approval configuration. No flows are
 * implemented here: manual approval belongs to W-004, automatic approval
 * to W-005, and `after: sprint` semantics remain deferred (OQ-3) — the
 * value is exposed, never executed.
 */
export interface ApprovalPolicy {
  mode: ApprovalMode;
  after: ApprovalAfter;
  sensitive_changes: SensitiveChanges;
}

/**
 * Normalize a validated configuration into its approval policy.
 * Omitted fields receive the M2 approved defaults; present values pass
 * through untouched. Expects validated input — full schema enforcement
 * stays in the M2 validator.
 */
export function getApprovalPolicy(config: FrameworkConfig): ApprovalPolicy {
  if (typeof config !== "object" || config === null) {
    throw new Error("getApprovalPolicy: expected a validated FrameworkConfig object");
  }
  const approval = config.approval ?? {};
  return {
    mode: approval.mode ?? APPROVAL_DEFAULTS.mode,
    after: approval.after ?? APPROVAL_DEFAULTS.after,
    sensitive_changes: approval.sensitive_changes ?? APPROVAL_DEFAULTS.sensitive_changes,
  };
}

/** True when the policy selects the manual approval flow (W-004). */
export function isManualApproval(config: FrameworkConfig): boolean {
  return getApprovalPolicy(config).mode === "manual";
}

/** True when the policy selects the automatic approval flow (W-005). */
export function isAutomaticApproval(config: FrameworkConfig): boolean {
  return getApprovalPolicy(config).mode === "automatic";
}

/**
 * Expose the configured sensitive-change policy for later workflow
 * logic. Interpretation stays minimal: `always` applies approval to
 * sensitive changes, `never` applies none, and `configured` defers to
 * the `sensitive_rules` handled by later tickets. No change detection
 * happens here.
 */
export function sensitiveChangePolicy(config: FrameworkConfig): SensitiveChanges {
  return getApprovalPolicy(config).sensitive_changes;
}
