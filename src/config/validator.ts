import {
  APPROVAL_DEFAULTS,
  CONFIG_VERSION,
  PROVIDER_DEFAULTS,
  WORKFLOW_DEFAULTS,
  ApprovalAfter,
  ApprovalMode,
  FrameworkConfig,
  SensitiveChanges,
  WorkflowExecution,
} from "./schema";

// Runtime value lists for the C-001 string unions. Annotated with the
// schema types so a renamed union member breaks compilation here.
const APPROVAL_MODES: ApprovalMode[] = ["manual", "automatic"];
const APPROVAL_AFTER: ApprovalAfter[] = ["ticket", "sprint"];
const SENSITIVE_CHANGES: SensitiveChanges[] = ["always", "configured", "never"];
const WORKFLOW_EXECUTIONS: WorkflowExecution[] = ["sequential"];

const TOP_LEVEL_KEYS = ["version", "approval", "workflow", "providers"];
const PROVIDER_KEYS = ["opencode", "speckit", "github", "delegate"];

function fail(path: string, reason: string): never {
  throw new Error(path === "" ? `config: ${reason}` : `config.${path}: ${reason}`);
}

function formatValue(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asSection(value: unknown, path: string): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    fail(path, `expected an object, got ${formatValue(value)}`);
  }
  return value;
}

function asEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(
      path,
      `expected one of ${allowed.map((entry) => `"${entry}"`).join(", ")}, got ${formatValue(value)}`,
    );
  }
  return value as T;
}

function asBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    fail(path, `expected a boolean, got ${formatValue(value)}`);
  }
  return value;
}

function asString(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    fail(path, `expected a string, got ${formatValue(value)}`);
  }
  return value;
}

function asStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    fail(path, `expected an array of strings, got ${formatValue(value)}`);
  }
  return value as string[];
}

function checkKnownKeys(
  section: Record<string, unknown>,
  path: string,
  known: readonly string[],
  kind: string,
): void {
  for (const key of Object.keys(section)) {
    if (!known.includes(key)) {
      fail(
        path === "" ? key : `${path}.${key}`,
        `unknown ${kind} key; expected one of ${known.map((entry) => `"${entry}"`).join(", ")}`,
      );
    }
  }
}

function asNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(path, `required non-empty string, got ${formatValue(value)}`);
  }
  return value;
}

/**
 * Validate raw loaded data against the C-001 configuration contract and
 * return the canonical validated `FrameworkConfig`.
 *
 * Omitted optional fields are FILLED with the approved C-001 defaults, so
 * the result is fully normalized: every optional section and field is
 * present. Unknown top-level keys and unknown provider keys are rejected
 * (strict, per the schema). Unknown keys deeper inside sections have no
 * defined policy and are ignored — not rejected, not interpreted.
 * Nothing is read from or written to disk.
 */
export function validateConfig(data: unknown): FrameworkConfig {
  if (!isRecord(data)) {
    fail("", `expected a configuration object, got ${formatValue(data)}`);
  }
  checkKnownKeys(data, "", TOP_LEVEL_KEYS, "top-level");

  if (data.version === undefined) {
    fail("version", "required field is missing");
  }
  if (data.version !== CONFIG_VERSION) {
    fail("version", `unsupported version ${formatValue(data.version)}; expected 1`);
  }

  const approval = asSection(data.approval, "approval") ?? {};
  const mode = asEnum(approval.mode, "approval.mode", APPROVAL_MODES) ?? APPROVAL_DEFAULTS.mode;
  const after =
    asEnum(approval.after, "approval.after", APPROVAL_AFTER) ?? APPROVAL_DEFAULTS.after;
  const sensitiveChanges =
    asEnum(approval.sensitive_changes, "approval.sensitive_changes", SENSITIVE_CHANGES) ??
    APPROVAL_DEFAULTS.sensitive_changes;
  const sensitiveRules =
    asStringArray(approval.sensitive_rules, "approval.sensitive_rules") ??
    APPROVAL_DEFAULTS.sensitive_rules;

  const workflow = asSection(data.workflow, "workflow") ?? {};
  const execution =
    asEnum(workflow.execution, "workflow.execution", WORKFLOW_EXECUTIONS) ??
    WORKFLOW_DEFAULTS.execution;
  const defaultState =
    asString(workflow.default_state, "workflow.default_state") ?? WORKFLOW_DEFAULTS.default_state;

  const providers = asSection(data.providers, "providers") ?? {};
  checkKnownKeys(providers, "providers", PROVIDER_KEYS, "provider");

  const opencode = asSection(providers.opencode, "providers.opencode") ?? {};
  const speckit = asSection(providers.speckit, "providers.speckit") ?? {};
  const github = asSection(providers.github, "providers.github") ?? {};
  const delegate = asSection(providers.delegate, "providers.delegate") ?? {};

  const githubEnabled =
    asBoolean(github.enabled, "providers.github.enabled") ??
    PROVIDER_DEFAULTS.github.enabled;
  let githubOwner = asString(github.owner, "providers.github.owner");
  let githubRepo = asString(github.repo, "providers.github.repo");
  if (githubEnabled) {
    githubOwner = asNonEmptyString(githubOwner, "providers.github.owner");
    githubRepo = asNonEmptyString(githubRepo, "providers.github.repo");
  }

  return {
    version: CONFIG_VERSION,
    approval: {
      mode,
      after,
      sensitive_changes: sensitiveChanges,
      sensitive_rules: sensitiveRules,
    },
    workflow: {
      execution,
      default_state: defaultState,
    },
    providers: {
      opencode: {
        enabled:
          asBoolean(opencode.enabled, "providers.opencode.enabled") ??
          PROVIDER_DEFAULTS.opencode.enabled,
      },
      speckit: {
        enabled:
          asBoolean(speckit.enabled, "providers.speckit.enabled") ??
          PROVIDER_DEFAULTS.speckit.enabled,
      },
      github: {
        enabled: githubEnabled,
        ...(githubOwner !== undefined ? { owner: githubOwner } : {}),
        ...(githubRepo !== undefined ? { repo: githubRepo } : {}),
      },
      delegate: {
        enabled:
          asBoolean(delegate.enabled, "providers.delegate.enabled") ??
          PROVIDER_DEFAULTS.delegate.enabled,
      },
    },
  };
}
