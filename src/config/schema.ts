/**
 * Configuration schema contract for `.ai-team/config.yaml`.
 *
 * Derived from `docs/specification/configuration.md` (plan §5, §6.3).
 * This file DEFINES what valid configuration looks like. It performs no
 * I/O, no YAML parsing, no loading, and no runtime validation — those
 * belong to C-002 (loader) and C-003 (validation).
 *
 * Field names use snake_case to mirror `config.yaml` exactly so C-002 can
 * map parsed YAML 1:1 onto `FrameworkConfig` without renaming.
 */

export const CONFIG_VERSION = 1 as const;
export type ConfigVersion = typeof CONFIG_VERSION;

export type ApprovalMode = "manual" | "automatic";
export type ApprovalAfter = "ticket" | "sprint";
export type SensitiveChanges = "always" | "configured" | "never";
export type WorkflowExecution = "sequential";

export interface ApprovalConfig {
  /** How approval is granted. @default "manual" (plan §6.3). */
  mode?: ApprovalMode;
  /**
   * Granularity of approval gates. @default "ticket" (plan §6.3).
   * "sprint" is an allowed value but its semantics are deferred (OQ-3);
   * no sprint behavior is defined here.
   */
  after?: ApprovalAfter;
  /** Which changes require approval. @default "always" (plan §6.3). */
  sensitive_changes?: SensitiveChanges;
  /**
   * Custom sensitive-change rules. Used only when `sensitive_changes`
   * is "configured". @default [].
   */
  sensitive_rules?: string[];
}

export interface WorkflowConfig {
  /**
   * Execution model. Only "sequential" is supported in 0.1.0;
   * parallel execution is out of scope. @default "sequential".
   */
  execution?: WorkflowExecution;
  /** Initial state for new tickets. @default "ready". */
  default_state?: string;
}

export interface OpenCodeProviderConfig {
  /** Required first-class execution provider. @default true. */
  enabled?: boolean;
}

export interface SpecKitProviderConfig {
  /** Optional specification/planning integration. @default false. */
  enabled?: boolean;
}

export interface GitHubProviderConfig {
  /** Optional tracking provider; local-only is the default. @default false. */
  enabled?: boolean;
  /**
   * Repository owner. No default. Required (non-empty) when
   * `enabled` is true — enforced by C-003.
   */
  owner?: string;
  /**
   * Repository name. No default. Required (non-empty) when
   * `enabled` is true — enforced by C-003.
   */
  repo?: string;
  /**
   * Managed-issue label selecting AI Team tickets (R-011). No
   * default — never assumed. Required (non-empty) when
   * `enabled` is true.
   */
  managedLabel?: string;
  /**
   * Implementer specialty staffing the production runtime
   * (R-012). No default and never inferred — the CLI fails
   * with a bounded missing-input error when it is absent.
   * Required (a valid specialty) when `enabled` is true.
   */
  specialty?: string;
}

export interface DelegateProviderConfig {
  /**
   * Optional delegation provider. Requires explicit enablement;
   * never auto-enabled. @default false.
   */
  enabled?: boolean;
}

export interface ProvidersConfig {
  opencode?: OpenCodeProviderConfig;
  speckit?: SpecKitProviderConfig;
  github?: GitHubProviderConfig;
  delegate?: DelegateProviderConfig;
}

export interface FrameworkConfig {
  /** Schema version. Required; only version 1 is supported. */
  version: ConfigVersion;
  approval?: ApprovalConfig;
  workflow?: WorkflowConfig;
  providers?: ProvidersConfig;
}

/** Approved approval defaults (plan §6.3). Applied by C-003/C-005. */
export const APPROVAL_DEFAULTS: Required<ApprovalConfig> = {
  mode: "manual",
  after: "ticket",
  sensitive_changes: "always",
  sensitive_rules: [],
};

/** Approved workflow defaults (configuration.md §2). Applied by C-003/C-005. */
export const WORKFLOW_DEFAULTS: Required<WorkflowConfig> = {
  execution: "sequential",
  default_state: "ready",
};

/** Approved provider enablement defaults. Applied by C-003/C-005. */
export const PROVIDER_DEFAULTS: {
  opencode: { enabled: boolean };
  speckit: { enabled: boolean };
  github: { enabled: boolean };
  delegate: { enabled: boolean };
} = {
  opencode: { enabled: true },
  speckit: { enabled: false },
  github: { enabled: false },
  delegate: { enabled: false },
};

/**
 * Unknown top-level keys are rejected (strict) so weak agents get
 * deterministic feedback instead of silently ignoring typos
 * (configuration.md §4). Enforced by C-003.
 */
export const UNKNOWN_TOP_LEVEL_KEY_POLICY = "reject" as const;

/**
 * Unknown provider keys are configuration errors
 * (configuration.md §4). Enforced by C-003.
 */
export const UNKNOWN_PROVIDER_KEY_POLICY = "reject" as const;
