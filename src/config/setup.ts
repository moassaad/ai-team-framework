/**
 * Project Setup Workflow (M30 T-044).
 *
 * The dedicated workflow that prepares a target project to
 * use the AI Team Framework: resolve and validate the
 * project root, ensure the canonical `.ai-team/` workspace
 * (C-004), ensure the canonical `config.yaml` (C-005), and
 * validate the final configuration through the existing
 * schema (C-003). Nothing more.
 *
 * This workflow reuses the established seams instead of
 * reimplementing them: `initializeWorkspace` owns root
 * validation and workspace creation, `generateDefaultConfig`
 * owns default generation and the never-overwrite rule, and
 * `loadConfig`/`validateConfig` own loading and validation.
 * No second schema, no second defaults, no second
 * path-safety utility, no second setup command — the
 * existing `ai-team setup <integration>` stays the
 * per-integration entry point, untouched.
 *
 * Safety and scope: additive and idempotent. Existing files
 * are never overwritten, merged, deleted, or repaired —
 * an existing `config.yaml` is preserved byte-for-byte
 * whether valid (kept, reported `existing`) or invalid
 * (kept, reported `invalid-configuration` with diagnostics).
 * Only `<projectRoot>/.ai-team/` is ever written; project
 * source, tests, dependencies, build configuration, and
 * user-owned guidance files such as `AGENTS.md` are never
 * touched (no `AGENTS.md` management exists in this
 * repository, and none is added here). New and existing
 * projects receive identical setup — workspace plus
 * configuration only — so no sample application is ever
 * scaffolded and no language, framework, or architecture is
 * ever inferred. No role executes, no lifecycle runs, no
 * mode is selected, no integration is installed, enabled,
 * or detected: availability is recorded from configuration
 * alone and detection stays with `ai-team status`.
 *
 * Pure composition and synchronous: validate, ensure,
 * validate again, freeze, return. Invalid project roots
 * throw through the existing workspace contract; an invalid
 * existing configuration returns a diagnostic result; a
 * configuration write failure after a valid root returns a
 * partial-failure result. Nothing is retried, repaired, or
 * rolled back.
 */

import { existsSync, readdirSync } from "node:fs";
import { loadConfig, resolveConfigPath } from "./loader";
import { validateConfig } from "./validator";
import { FrameworkConfig } from "./schema";
import { generateDefaultConfig } from "./defaults";
import { initializeWorkspace, resolveWorkspacePath } from "./workspace";

/** Per-file setup report. `invalid` marks a kept file that failed validation. */
export type SetupFileAction = "created" | "existing" | "invalid";

export interface SetupFileReport {
  readonly path: string;
  readonly action: SetupFileAction;
}

/** Integration availability as recorded from configuration alone. Detection is never performed here. */
export interface SetupIntegrationState {
  readonly name: string;
  readonly enabled: boolean;
  readonly detected: "not-checked";
}

export interface ProjectSetupInput {
  /** Target project root. Must exist and be a directory; validated by the workspace contract. */
  readonly project_root: string;
}

interface SetupPaths {
  readonly projectRoot: string;
  readonly workspacePath: string;
  readonly configPath: string;
}

interface SetupShared {
  readonly projectRoot: string;
  readonly workspacePath: string;
  readonly configPath: string;
  readonly files: readonly SetupFileReport[];
}

/** Setup created at least one artifact; the configuration is valid. */
export interface ProjectSetupCompleted extends SetupShared {
  readonly status: "completed";
  readonly config: FrameworkConfig;
  readonly integrations: readonly SetupIntegrationState[];
  readonly notes: readonly string[];
}

/** Nothing to do: workspace and a valid configuration already existed. */
export interface ProjectSetupAlreadyConfigured extends SetupShared {
  readonly status: "already-configured";
  readonly config: FrameworkConfig;
  readonly integrations: readonly SetupIntegrationState[];
  readonly notes: readonly string[];
}

/** The existing configuration is invalid. It was kept byte-for-byte; nothing was repaired. */
export interface ProjectSetupInvalidConfiguration extends SetupShared {
  readonly status: "invalid-configuration";
  readonly issues: readonly string[];
}

/** A filesystem write failed after a valid root. Partial outcome reported; nothing claimed complete. */
export interface ProjectSetupFailed extends SetupShared {
  readonly status: "failed";
  readonly stage: "write-configuration";
  readonly message: string;
}

export type ProjectSetupResult =
  | ProjectSetupCompleted
  | ProjectSetupAlreadyConfigured
  | ProjectSetupInvalidConfiguration
  | ProjectSetupFailed;

const SETUP_NOTES: readonly string[] = Object.freeze([
  "project setup manages <projectRoot>/.ai-team/ only; project source, tests, dependencies, and user-owned files are never modified",
  "integrations are neither installed, enabled, nor detected during setup; use ai-team status for detection and ai-team setup <integration> for per-integration setup",
  "new and existing projects receive identical setup; no sample application is scaffolded and no stack is inferred",
]);

function fail(what: string): never {
  throw new Error(`project setup: ${what}`);
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0];
}

function workspaceEntries(path: string): string[] {
  try {
    return readdirSync(path).sort();
  } catch {
    return [];
  }
}

function integrationStates(config: FrameworkConfig): readonly SetupIntegrationState[] {
  const providers = config.providers ?? {};
  const enabled = (section: { enabled?: boolean } | undefined): boolean => section?.enabled ?? false;
  return Object.freeze([
    Object.freeze({ name: "opencode", enabled: enabled(providers.opencode), detected: "not-checked" as const }),
    Object.freeze({ name: "speckit", enabled: enabled(providers.speckit), detected: "not-checked" as const }),
    Object.freeze({ name: "github", enabled: enabled(providers.github), detected: "not-checked" as const }),
    Object.freeze({ name: "delegate", enabled: enabled(providers.delegate), detected: "not-checked" as const }),
  ]);
}

/**
 * Prepare a target project for framework use and return the
 * frozen result. Reuses `initializeWorkspace` (root
 * validation plus workspace creation),
 * `generateDefaultConfig` (canonical defaults unless a
 * configuration already exists), and
 * `loadConfig`/`validateConfig` (final validation).
 *
 * Throws for invalid project roots through the existing
 * workspace contract. Returns `invalid-configuration` for
 * an existing configuration that fails loading or
 * validation — the file is kept untouched — and `failed`
 * for a configuration write failure after a valid root.
 * Repeated runs over a configured project return
 * `already-configured` without rewriting anything.
 */
export function runProjectSetup(input: ProjectSetupInput): ProjectSetupResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a project setup input object");
  }
  const projectRoot = (input as { project_root?: unknown }).project_root;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    fail("project_root must be a non-empty string");
  }
  const paths: SetupPaths = {
    projectRoot,
    workspacePath: resolveWorkspacePath(projectRoot),
    configPath: resolveConfigPath(projectRoot),
  };
  const entriesBefore = workspaceEntries(paths.workspacePath);
  const workspacePreexisted = entriesBefore.length > 0 || existsSync(paths.workspacePath);
  const configPreexisted = existsSync(paths.configPath);

  initializeWorkspace(projectRoot);

  if (configPreexisted) {
    let config: FrameworkConfig;
    try {
      config = validateConfig(loadConfig(projectRoot));
    } catch (error: unknown) {
      return Object.freeze({
        status: "invalid-configuration",
        projectRoot: paths.projectRoot,
        workspacePath: paths.workspacePath,
        configPath: paths.configPath,
        files: Object.freeze([
          Object.freeze({
            path: paths.workspacePath,
            action: workspaceEntries(paths.workspacePath).length > entriesBefore.length ? ("created" as const) : ("existing" as const),
          }),
          Object.freeze({ path: paths.configPath, action: "invalid" as const }),
        ]),
        issues: Object.freeze([errorMessage(error)]),
      });
    }
    const workspaceChanged = workspaceEntries(paths.workspacePath).length > entriesBefore.length;
    const files: readonly SetupFileReport[] = Object.freeze([
      Object.freeze({
        path: paths.workspacePath,
        action: workspaceChanged ? ("created" as const) : ("existing" as const),
      }),
      Object.freeze({ path: paths.configPath, action: "existing" as const }),
    ]);
    const shared = {
      projectRoot: paths.projectRoot,
      workspacePath: paths.workspacePath,
      configPath: paths.configPath,
      files,
      config,
      integrations: integrationStates(config),
      notes: SETUP_NOTES,
    };
    if (!workspaceChanged) {
      return Object.freeze({ status: "already-configured", ...shared });
    }
    return Object.freeze({ status: "completed", ...shared });
  }

  try {
    generateDefaultConfig(projectRoot);
  } catch (error: unknown) {
    return Object.freeze({
      status: "failed",
      stage: "write-configuration",
      message: `${errorMessage(error)}; configuration was not completed and must not be treated as configured`,
      projectRoot: paths.projectRoot,
      workspacePath: paths.workspacePath,
      configPath: paths.configPath,
      files: Object.freeze([
        Object.freeze({
          path: paths.workspacePath,
          action: workspacePreexisted ? ("existing" as const) : ("created" as const),
        }),
      ]),
    });
  }
  const config = validateConfig(loadConfig(projectRoot));
  return Object.freeze({
    status: "completed",
    projectRoot: paths.projectRoot,
    workspacePath: paths.workspacePath,
    configPath: paths.configPath,
    files: Object.freeze([
      Object.freeze({
        path: paths.workspacePath,
        action: workspacePreexisted ? ("existing" as const) : ("created" as const),
      }),
      Object.freeze({ path: paths.configPath, action: "created" as const }),
    ]),
    config,
    integrations: integrationStates(config),
    notes: SETUP_NOTES,
  });
}
