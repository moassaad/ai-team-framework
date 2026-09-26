/**
 * Spec Kit detection integration (S-002).
 *
 * The smallest useful current Spec Kit integration over the M14
 * foundation (I-001): answers whether the Spec Kit capability is
 * available and usable for one target project. Exposes `detect`
 * (required) and `version` (optional); the optional `install()`
 * capability composes on top in `./speckit-install` (S-003), while
 * `configure` remains out of scope.
 *
 * Detection order, each step read-only:
 *
 * ```text
 * 1. `specify version --features --json` (stable machine-readable
 *    form, verified against upstream `command_version.py`); on any
 *    non-authoritative result, fall back to plain `specify version`
 *    exit status as presence-only evidence. Plain `specify version`
 *    renders a human-oriented table, so no version text is ever
 *    parsed out of it.
 * 2. Read `<projectRoot>/.specify/integration.json` (verified
 *    against upstream `integration_state.py`): absent means not
 *    initialized; malformed/unreadable/newer-schema means detection
 *    failure; otherwise the expected integration key must be among
 *    the installed keys (or be the default) for availability.
 * ```
 *
 * Fresh every call: no cache, no persistence, no registry mutation,
 * no config reads (`speckit.enabled` is user intent, never evidence),
 * no writes anywhere (`.specify/` is only read). Only the fixed
 * `specify version` argument lists ever execute; `init`, `install`,
 * `use`, and `switch` never run here. Process launch uses an argument
 * array with no shell; all environment access (process launch, file
 * read) funnels through injected seams so tests stay hermetic.
 *
 * The default seams and small state helpers are exported for S-003,
 * which composes this module's `detect()`/`version()` with a confirmed
 * `install()` capability in `./speckit-install`. No other module needs
 * them.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DetectionResult,
  Integration,
  validateDetectionResult,
} from "./integration";

/** Stable integration identity, local to this concrete module. */
export const SPECKIT_INTEGRATION_NAME = "spec-kit" as const;

/** Spec Kit executable. Always this command; never caller-supplied. */
export const SPECKIT_COMMAND = "specify" as const;

/** Initial expected coding-agent integration key (S-001 audit). */
export const SPECKIT_EXPECTED_INTEGRATION_KEY = "opencode" as const;

/** Project-local integration-state file, relative to the project root. */
const INTEGRATION_STATE_DIR = ".specify" as const;
const INTEGRATION_STATE_FILENAME = "integration.json" as const;

/** Upstream integration-state schema this detector understands. */
const SUPPORTED_STATE_SCHEMA = 1;

/** Hang guard for the read-only version probe. */
const COMMAND_TIMEOUT_MS = 30_000;

/** Completed read-only command execution. */
export interface SpecKitCommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
}

/** Launch-function seam. Production spawns `specify`; tests inject a fake. */
export interface SpecKitCommandRunner {
  (
    command: string,
    args: readonly string[],
    options: { readonly cwd: string; readonly timeoutMs?: number },
  ): SpecKitCommandResult | Promise<SpecKitCommandResult>;
}

/** File-read seam. Throws when the file is missing or unreadable. */
export interface SpecKitFileReader {
  (absolutePath: string): string | Promise<string>;
}

export interface SpecKitIntegrationOptions {
  /** Target project root the detection is bounded to. Never the framework workspace. */
  readonly projectRoot: string;
  /** Expected coding-agent integration key. Defaults to `"opencode"`. */
  readonly integrationKey?: string;
  /** Command runner; defaults to a `spawnSync` runner with no shell. */
  readonly runCommand?: SpecKitCommandRunner;
  /** File reader; defaults to a UTF-8 read. */
  readonly readFile?: SpecKitFileReader;
}

function fail(what: string): never {
  throw new Error(`spec-kit detection: ${what}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True for failed starts/reads where the target itself is absent. */
export function isSpecKitNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

/** Default command runner: `spawnSync` with no shell. Shared with S-003. */
export function defaultSpecKitRunCommand(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly timeoutMs?: number },
): SpecKitCommandResult {
  const completed = spawnSync(command, [...args], {
    cwd: options.cwd,
    shell: false,
    encoding: "utf8",
    timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
  });
  if (completed.error !== undefined) {
    throw completed.error;
  }
  return {
    exitCode: completed.status,
    stdout: typeof completed.stdout === "string" ? completed.stdout : "",
  };
}

/** Default file reader: UTF-8 read. Shared with S-003. */
export function defaultSpecKitReadFile(absolutePath: string): string {
  return readFileSync(absolutePath, "utf8");
}

/**
 * Best-effort version read from `specify version --features --json`
 * output. Returns the upstream `{"version": ...}` field only; anything
 * else (unparseable, wrong shape, empty) yields undefined so the caller
 * falls back to presence-only evidence instead of guessing.
 */
function readVersionPayload(stdout: string): string | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return undefined;
  }
  const version = (payload as Record<string, unknown>).version;
  return typeof version === "string" && version.length > 0 ? version : undefined;
}

interface VersionProbe {
  readonly present: boolean;
  readonly version: string | undefined;
}

async function probeVersion(
  runCommand: SpecKitCommandRunner,
  cwd: string,
): Promise<VersionProbe> {
  let machine: SpecKitCommandResult;
  try {
    machine = await runCommand(
      SPECKIT_COMMAND,
      ["version", "--features", "--json"],
      { cwd },
    );
  } catch (error: unknown) {
    if (isSpecKitNotFoundError(error)) {
      return { present: false, version: undefined };
    }
    throw new Error(`spec-kit detection: version probe failed (${errorMessage(error)})`);
  }
  if (machine.exitCode === 0) {
    const version = readVersionPayload(machine.stdout);
    if (version !== undefined) {
      return { present: true, version };
    }
  }
  let plain: SpecKitCommandResult;
  try {
    plain = await runCommand(SPECKIT_COMMAND, ["version"], { cwd });
  } catch (error: unknown) {
    if (isSpecKitNotFoundError(error)) {
      return { present: false, version: undefined };
    }
    throw new Error(`spec-kit detection: version probe failed (${errorMessage(error)})`);
  }
  if (plain.exitCode !== 0) {
    throw new Error(
      `spec-kit detection: specify version failed (exit ${String(plain.exitCode)})`,
    );
  }
  return { present: true, version: undefined };
}

/** True for non-empty strings after trimming; mirrors upstream key cleaning. */
function cleanIntegrationKey(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const key = value.trim();
  return key.length > 0 ? key : undefined;
}

interface ProjectIntegrationState {
  readonly defaultKey: string | undefined;
  readonly installedKeys: readonly string[];
}

/**
 * Minimal read of `.specify/integration.json`: default key plus
 * installed keys, with the same default-fallback rule as upstream
 * (default falls back to the first installed key; a default outside
 * the installed list counts as installed). Settings, manifests, and
 * managed-file checks are upstream concerns, not detection evidence.
 * Throws on malformed state or on a newer-than-understood schema.
 */
function parseIntegrationState(raw: string): ProjectIntegrationState {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    fail("project integration state is not valid JSON");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("project integration state is not an object");
  }
  const record = data as Record<string, unknown>;
  const schema = record.integration_state_schema;
  if (
    typeof schema === "number" &&
    Number.isInteger(schema) &&
    schema > SUPPORTED_STATE_SCHEMA
  ) {
    fail(`unsupported project integration state schema ${String(schema)}`);
  }
  const installed: string[] = [];
  const listed = record.installed_integrations;
  if (Array.isArray(listed)) {
    for (const entry of listed) {
      const key = cleanIntegrationKey(entry);
      if (key !== undefined && !installed.includes(key)) {
        installed.push(key);
      }
    }
  }
  const fallback = installed.length > 0 ? installed[0] : undefined;
  const defaultKey =
    cleanIntegrationKey(record.default_integration) ??
    cleanIntegrationKey(record.integration) ??
    fallback;
  if (defaultKey !== undefined && !installed.includes(defaultKey)) {
    installed.unshift(defaultKey);
  }
  return { defaultKey, installedKeys: installed };
}

/** Project-local integration-state path for a target project. Shared with S-003. */
export function specKitStateFilePath(projectRoot: string): string {
  return join(projectRoot, INTEGRATION_STATE_DIR, INTEGRATION_STATE_FILENAME);
}

/**
 * Build the Spec Kit detection integration for one target project.
 * Every `detect()` call re-probes the executable and re-reads the
 * project state; nothing is cached, stored, or repaired.
 */
export function createSpecKitIntegration(
  options: SpecKitIntegrationOptions,
): Integration {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    fail("expected an options object");
  }
  const { projectRoot } = options;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    fail("projectRoot must be a non-empty string");
  }
  const integrationKey = options.integrationKey ?? SPECKIT_EXPECTED_INTEGRATION_KEY;
  if (typeof integrationKey !== "string" || integrationKey.length === 0) {
    fail("integrationKey must be a non-empty string");
  }
  const runCommand = options.runCommand ?? defaultSpecKitRunCommand;
  if (typeof runCommand !== "function") {
    fail("runCommand must be a function");
  }
  const readFile = options.readFile ?? defaultSpecKitReadFile;
  if (typeof readFile !== "function") {
    fail("readFile must be a function");
  }

  async function currentVersion(): Promise<VersionProbe> {
    return probeVersion(runCommand, projectRoot);
  }

  async function detect(): Promise<DetectionResult> {
    const probe = await currentVersion();
    if (!probe.present) {
      return validateDetectionResult({
        available: false,
        detail: "specify executable not available",
      });
    }
    const versionLabel = probe.version ?? "unknown version";
    let raw: string;
    try {
      raw = await readFile(specKitStateFilePath(projectRoot));
    } catch (error: unknown) {
      if (isSpecKitNotFoundError(error)) {
        return validateDetectionResult({
          available: false,
          detail:
            `specify ${versionLabel} available; ` +
            "project is not initialized as a Spec Kit project",
        });
      }
      throw new Error(
        `spec-kit detection: unable to read project integration state (${errorMessage(error)})`,
      );
    }
    const state = parseIntegrationState(raw);
    if (state.installedKeys.includes(integrationKey)) {
      return validateDetectionResult({
        available: true,
        detail: `specify ${versionLabel}; project uses the ${integrationKey} integration`,
      });
    }
    return validateDetectionResult({
      available: false,
      detail:
        `specify ${versionLabel}; ` +
        `project is initialized without the ${integrationKey} integration`,
    });
  }

  async function version(): Promise<string> {
    const probe = await currentVersion();
    if (!probe.present) {
      throw new Error("spec-kit detection: specify executable not available");
    }
    if (probe.version === undefined) {
      throw new Error("spec-kit detection: specify version not determinable");
    }
    return probe.version;
  }

  return Object.freeze({
    name: SPECKIT_INTEGRATION_NAME,
    capabilities: Object.freeze(["detect", "version"] as const),
    detect,
    version,
  });
}
