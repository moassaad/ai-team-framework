/**
 * Existing-project Spec Kit initialization (S-004).
 *
 * Initializes Spec Kit inside a non-empty target project through the
 * Framework-owned flow: Preflight → Explain → explicit user
 * confirmation → init → fresh verification. This module performs NO
 * prompting: calling `initSpecKitProject()` IS the confirmed step, and
 * the separate `preflightSpecKitInit()` result exists so the future
 * confirmation layer can explain the planned change first.
 *
 * Responsibility split (plan M15): CLI installation and
 * integration installation inside an already initialized project stay
 * with S-003 (`./speckit-install`); this module only initializes an
 * uninitialized project and otherwise delegates or refuses:
 *
 * ```text
 * already correct            → no-op
 * CLI missing                → fail (install it first via S-003)
 * state readable (initialized, key missing or different)
 *                            → S-003 install path (adds only; never
 *                              switches, uninstalls, or forces)
 * state absent               → documented `specify init`
 * ```
 *
 * The init command is the verified upstream existing-project form
 * `specify init --here --force --non-interactive --integration <key>`
 * run with the project root as working directory: `--here` targets the
 * project, `--force` acknowledges the confirmed merge into a non-empty
 * directory (managed paths only; application source is not rewritten
 * by the Framework), `--non-interactive` keeps automated execution
 * deterministic. `--non-interactive` support is probed via the
 * read-only `specify init --help` first; when unavailable the operation
 * fails with an upgrade message instead of falling back to a command
 * that could block on a prompt. `--force` is therefore used ONLY on
 * this confirmed path — never speculatively, never as a retry.
 *
 * Safety: fixed argument arrays, no shell, project root passed only
 * via `cwd`. Spec Kit owns its managed files (`.specify/`, agent
 * skill/command files); this module never writes them by hand and
 * never deletes anything — no rollback is implemented, and failures
 * say so. Git is observed read-only (`rev-parse`, `status
 * --porcelain`) on a best-effort basis because the repository has no
 * Git mechanism of its own; Git state is advisory only, baseline
 * creation (commit/stash/branch) stays with the user, and Git is never
 * a prerequisite. Configuration (`speckit.enabled`) is never touched.
 */

import { readdirSync } from "node:fs";
import {
  DetectionResult,
} from "./integration";
import {
  SPECKIT_COMMAND,
  SPECKIT_EXPECTED_INTEGRATION_KEY,
  SpecKitCommandResult,
  SpecKitIntegrationOptions,
  createSpecKitIntegration,
  defaultSpecKitReadFile,
  defaultSpecKitRunCommand,
  isSpecKitNotFoundError,
  specKitStateFilePath,
} from "./speckit-detection";
import {
  createSpecKitIntegrationWithInstall,
} from "./speckit-install";

/** Directory-listing seam. Throws when the directory is missing or unreadable. */
export interface SpecKitDirReader {
  (absolutePath: string): readonly string[] | Promise<readonly string[]>;
}

/** Default directory reader. Shared semantics with the other default seams. */
export function defaultSpecKitReadDir(absolutePath: string): readonly string[] {
  return readdirSync(absolutePath);
}

/** Advisory Git working-tree state for the confirmation layer. */
export const SPECKIT_GIT_STATES = ["absent", "clean", "dirty", "unknown"] as const;
export type SpecKitGitState = (typeof SPECKIT_GIT_STATES)[number];

/** Allowance for the init command and its help probe. */
const INIT_COMMAND_TIMEOUT_MS = 300_000;

export interface SpecKitInitOptions extends SpecKitIntegrationOptions {
  /** Directory reader; defaults to a filesystem listing. */
  readonly readDir?: SpecKitDirReader;
}

/** Read-only preflight report for the confirmation layer. */
export interface SpecKitPreflight {
  readonly projectRoot: string;
  readonly integrationKey: string;
  readonly directoryExists: boolean;
  /** Entry count; undefined when the directory is missing. */
  readonly entryCount: number | undefined;
  /** True when a `.specify` entry is present in the project root. */
  readonly hasSpecKitDir: boolean;
  /** Advisory only; never blocks and never mutates. */
  readonly git: SpecKitGitState;
  /** Fresh S-002 detection at preflight time. */
  readonly detection: DetectionResult;
}

function fail(what: string): never {
  throw new Error(`spec-kit init: ${what}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ResolvedInit {
  readonly projectRoot: string;
  readonly integrationKey: string;
  readonly runCommand: NonNullable<SpecKitIntegrationOptions["runCommand"]>;
  readonly readFile: NonNullable<SpecKitIntegrationOptions["readFile"]>;
  readonly readDir: SpecKitDirReader;
  readonly base: ReturnType<typeof createSpecKitIntegration>;
}

function resolveInitOptions(options: SpecKitInitOptions): ResolvedInit {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    fail("expected an options object");
  }
  const runCommand = options.runCommand ?? defaultSpecKitRunCommand;
  if (typeof runCommand !== "function") {
    fail("runCommand must be a function");
  }
  const readFile = options.readFile ?? defaultSpecKitReadFile;
  if (typeof readFile !== "function") {
    fail("readFile must be a function");
  }
  const readDir = options.readDir ?? defaultSpecKitReadDir;
  if (typeof readDir !== "function") {
    fail("readDir must be a function");
  }
  const base = createSpecKitIntegration({
    projectRoot: options.projectRoot,
    integrationKey: options.integrationKey,
    runCommand,
    readFile,
  });
  return {
    projectRoot: options.projectRoot,
    integrationKey: options.integrationKey ?? SPECKIT_EXPECTED_INTEGRATION_KEY,
    runCommand,
    readFile,
    readDir,
    base,
  };
}

/**
 * Observe Git working-tree state read-only. Never throws and never
 * mutates: any probe failure degrades to `"absent"` (not a work tree
 * or Git unavailable) or `"unknown"` (unexpected status failure).
 * Advisory only — baseline creation stays with the user.
 */
async function observeGitState(
  runCommand: ResolvedInit["runCommand"],
  projectRoot: string,
): Promise<SpecKitGitState> {
  let inside: SpecKitCommandResult;
  try {
    inside = await runCommand("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: projectRoot,
    });
  } catch {
    return "absent";
  }
  if (inside.exitCode !== 0) {
    return "absent";
  }
  let status: SpecKitCommandResult;
  try {
    status = await runCommand("git", ["status", "--porcelain"], { cwd: projectRoot });
  } catch {
    return "unknown";
  }
  if (status.exitCode !== 0) {
    return "unknown";
  }
  return status.stdout.trim().length > 0 ? "dirty" : "clean";
}

/**
 * Read-only preflight for existing-project initialization. Establishes
 * directory reality, `.specify` presence, advisory Git state, and fresh
 * S-002 detection for the confirmation layer. Throws when detection
 * itself fails or the directory cannot be listed: proceeding would be
 * unsafe.
 */
export async function preflightSpecKitInit(
  options: SpecKitInitOptions,
): Promise<SpecKitPreflight> {
  const resolved = resolveInitOptions(options);
  let entries: readonly string[];
  try {
    entries = await resolved.readDir(resolved.projectRoot);
  } catch (error: unknown) {
    if (isSpecKitNotFoundError(error)) {
      throw new Error(
        "spec-kit init: target project root does not exist; refusing to create it",
      );
    }
    throw new Error(
      `spec-kit init: unable to list target project root (${errorMessage(error)})`,
    );
  }
  const git = await observeGitState(resolved.runCommand, resolved.projectRoot);
  let detection: DetectionResult;
  try {
    detection = await resolved.base.detect();
  } catch (error: unknown) {
    throw new Error(`spec-kit init: fresh detection failed (${errorMessage(error)})`);
  }
  return Object.freeze({
    projectRoot: resolved.projectRoot,
    integrationKey: resolved.integrationKey,
    directoryExists: true,
    entryCount: entries.length,
    hasSpecKitDir: entries.includes(".specify"),
    git,
    detection,
  });
}

async function specifyPresent(resolved: ResolvedInit): Promise<boolean> {
  let probed: SpecKitCommandResult;
  try {
    probed = await resolved.runCommand(SPECKIT_COMMAND, ["version"], {
      cwd: resolved.projectRoot,
    });
  } catch (error: unknown) {
    if (isSpecKitNotFoundError(error)) {
      return false;
    }
    fail(`unable to establish specify presence (${errorMessage(error)})`);
  }
  if (probed.exitCode !== 0) {
    fail(`specify version failed (exit ${String(probed.exitCode)})`);
  }
  return true;
}

async function runInitOnly(
  resolved: ResolvedInit,
  command: string,
  args: readonly string[],
): Promise<SpecKitCommandResult> {
  try {
    return await resolved.runCommand(command, args, {
      cwd: resolved.projectRoot,
      timeoutMs: INIT_COMMAND_TIMEOUT_MS,
    });
  } catch (error: unknown) {
    fail(`${command} ${args.join(" ")} failed to start (${errorMessage(error)})`);
  }
}

async function runConfirmedInit(resolved: ResolvedInit): Promise<void> {
  const help = await runInitOnly(resolved, SPECKIT_COMMAND, ["init", "--help"]);
  if (help.exitCode !== 0) {
    fail(
      `specify init --help failed (exit ${String(help.exitCode)}); ` +
        "cannot establish non-interactive support",
    );
  }
  if (!help.stdout.includes("--non-interactive")) {
    fail("installed specify CLI does not support --non-interactive; upgrade specify-cli");
  }
  const done = await runInitOnly(resolved, SPECKIT_COMMAND, [
    "init",
    "--here",
    "--force",
    "--non-interactive",
    "--integration",
    resolved.integrationKey,
  ]);
  if (done.exitCode !== 0) {
    fail(
      `specify init failed (exit ${String(done.exitCode)}); ` +
        "project files were left as Spec Kit left them; no rollback was performed",
    );
  }
}

/**
 * Initialize Spec Kit in an existing project. Call ONLY after the
 * Framework has shown the `preflightSpecKitInit()` report and collected
 * explicit user confirmation: a non-empty project runs with `--force`,
 * and Spec Kit may create or update its own managed project files
 * (application source files are not rewritten by the Framework
 * itself). Already-correct projects are a no-op; readable Spec Kit
 * state converges through the S-003 install path (which only adds,
 * never switches or uninstalls); anything else fails clearly.
 * Verification is a fresh S-002 `detect()` and is authoritative.
 */
export async function initSpecKitProject(options: SpecKitInitOptions): Promise<void> {
  const resolved = resolveInitOptions(options);
  const preflight = await preflightSpecKitInit(options);
  if (preflight.detection.available) {
    return;
  }
  if (!(await specifyPresent(resolved))) {
    fail("specify CLI is not installed; install it first through the install() capability");
  }
  let stateReadable = false;
  try {
    await resolved.readFile(specKitStateFilePath(resolved.projectRoot));
    stateReadable = true;
  } catch (error: unknown) {
    if (!isSpecKitNotFoundError(error)) {
      fail(`unable to read project integration state (${errorMessage(error)})`);
    }
  }
  if (stateReadable) {
    const withInstall = createSpecKitIntegrationWithInstall({
      projectRoot: resolved.projectRoot,
      integrationKey: resolved.integrationKey,
      runCommand: resolved.runCommand,
      readFile: resolved.readFile,
    });
    if (withInstall.install === undefined) {
      fail("installation integration unexpectedly lacks install()");
    }
    await withInstall.install();
    return;
  }
  await runConfirmedInit(resolved);
  let verified: DetectionResult;
  try {
    verified = await resolved.base.detect();
  } catch (error: unknown) {
    fail(`post-init verification failed (${errorMessage(error)})`);
  }
  if (!verified.available) {
    fail(`verification failed: ${verified.detail ?? "expected state not observed"}`);
  }
}
