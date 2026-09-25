/**
 * Optional Spec Kit installation capability (S-003).
 *
 * Composes the S-002 detection integration: the returned `Integration`
 * reuses its `detect()`/`version()` unchanged and additionally exposes
 * the optional `install()` capability. `configure()` remains out of
 * scope.
 *
 * Confirmation boundary: this module performs NO prompting. Call
 * `install()` only after the Framework has completed Detect →
 * Explain → explicit user confirmation. Installation itself then
 * follows Detect → Install → Verify, where Verify is a fresh S-002
 * `detect()` whose result is authoritative: a successful command exit
 * without a confirming detection is reported as failure.
 *
 * What `install()` may change, and nothing else:
 *
 * ```text
 * - CLI missing: `<tool> install specify-cli` with a supported tool
 *   (verified upstream routes: `uv tool install`, `pipx install`,
 *   `pip install`; default official PyPI route, no version pinning).
 * - CLI present, project initialized, key missing:
 *   `specify integration install <key>` without `--force`.
 * ```
 *
 * What it never does: install `uv`/Python, touch the OS package
 * manager, require sudo, prompt, modify configuration
 * (`speckit.enabled` stays user intent), write `.specify/` by hand,
 * run `specify init` (uninitialized projects fail with a clear
 * not-initialized outcome for S-004), add `--force`, roll anything
 * back, or run shell strings (fixed argument arrays, no shell).
 */

import {
  DetectionResult,
  Integration,
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

/** Supported CLI installers, in official-recommendation probe order. */
export const SPECKIT_CLI_INSTALLERS = ["uv", "pipx", "pip"] as const;
export type SpecKitCliInstaller = (typeof SPECKIT_CLI_INSTALLERS)[number];

/** Package installed for the CLI route. Always this package; never caller-supplied. */
export const SPECKIT_CLI_PACKAGE = "specify-cli" as const;

/** Network allowance for installer/package-manager commands. */
const INSTALL_COMMAND_TIMEOUT_MS = 300_000;

export interface SpecKitInstallOptions extends SpecKitIntegrationOptions {
  /**
   * CLI installer to use. Defaults to `"auto"`, which probes `uv`,
   * then `pipx`, then `pip` in official-recommendation order and uses
   * the first one that responds. An explicit tool is probed once and
   * fails clearly when unavailable; nothing is ever bootstrapped.
   */
  readonly cliInstaller?: SpecKitCliInstaller | "auto";
}

function fail(what: string): never {
  throw new Error(`spec-kit install: ${what}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isInstallerName(value: unknown): value is SpecKitCliInstaller {
  return value === "uv" || value === "pipx" || value === "pip";
}

function installerInstallArgs(tool: SpecKitCliInstaller): readonly string[] {
  switch (tool) {
    case "uv":
      return ["tool", "install", SPECKIT_CLI_PACKAGE];
    case "pipx":
    case "pip":
      return ["install", SPECKIT_CLI_PACKAGE];
  }
}

/**
 * Build the Spec Kit integration with the optional installation
 * capability for one target project. Construction performs no calls;
 * every `install()` starts with fresh detection and ends with fresh
 * verification.
 */
export function createSpecKitIntegrationWithInstall(
  options: SpecKitInstallOptions,
): Integration {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    fail("expected an options object");
  }
  const cliInstaller = options.cliInstaller ?? "auto";
  if (cliInstaller !== "auto" && !isInstallerName(cliInstaller)) {
    fail(`unknown CLI installer ${JSON.stringify(cliInstaller)}`);
  }
  const runCommand = options.runCommand ?? defaultSpecKitRunCommand;
  if (typeof runCommand !== "function") {
    fail("runCommand must be a function");
  }
  const readFile = options.readFile ?? defaultSpecKitReadFile;
  if (typeof readFile !== "function") {
    fail("readFile must be a function");
  }
  const base = createSpecKitIntegration({
    projectRoot: options.projectRoot,
    integrationKey: options.integrationKey,
    runCommand,
    readFile,
  });
  const projectRoot = options.projectRoot;
  const integrationKey = options.integrationKey ?? SPECKIT_EXPECTED_INTEGRATION_KEY;

  async function runOnly(
    command: string,
    args: readonly string[],
    timeoutMs?: number,
  ): Promise<SpecKitCommandResult> {
    try {
      return await runCommand(
        command,
        args,
        timeoutMs === undefined ? { cwd: projectRoot } : { cwd: projectRoot, timeoutMs },
      );
    } catch (error: unknown) {
      fail(`${command} ${args.join(" ")} failed to start (${errorMessage(error)})`);
    }
  }

  async function cliPresent(): Promise<boolean> {
    let probed: SpecKitCommandResult;
    try {
      probed = await runCommand(SPECKIT_COMMAND, ["version"], { cwd: projectRoot });
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

  async function usableInstaller(): Promise<SpecKitCliInstaller> {
    const candidates =
      cliInstaller === "auto" ? [...SPECKIT_CLI_INSTALLERS] : [cliInstaller];
    for (const tool of candidates) {
      let probed: SpecKitCommandResult;
      try {
        probed = await runCommand(tool, ["--version"], { cwd: projectRoot });
      } catch (error: unknown) {
        if (cliInstaller !== "auto") {
          fail(`selected CLI installer ${tool} is unavailable (${errorMessage(error)})`);
        }
        continue;
      }
      if (probed.exitCode === 0) {
        return tool;
      }
      if (cliInstaller !== "auto") {
        fail(`selected CLI installer ${tool} is unusable (exit ${String(probed.exitCode)})`);
      }
    }
    fail(
      "no supported CLI installer available " +
        `(tried ${candidates.join(", ")}); ` +
        "install uv or ensure pipx/pip is on PATH",
    );
  }

  async function installCli(): Promise<void> {
    const tool = await usableInstaller();
    const args = installerInstallArgs(tool);
    const done = await runOnly(tool, args, INSTALL_COMMAND_TIMEOUT_MS);
    if (done.exitCode !== 0) {
      fail(`${tool} ${args.join(" ")} failed (exit ${String(done.exitCode)})`);
    }
  }

  async function installProjectIntegration(): Promise<void> {
    try {
      await readFile(specKitStateFilePath(projectRoot));
    } catch (error: unknown) {
      if (isSpecKitNotFoundError(error)) {
        fail(
          "project is not initialized as a Spec Kit project; " +
            "initialization is handled separately and was not performed",
        );
      }
      fail(`unable to read project integration state (${errorMessage(error)})`);
    }
    const done = await runOnly(
      SPECKIT_COMMAND,
      ["integration", "install", integrationKey],
      INSTALL_COMMAND_TIMEOUT_MS,
    );
    if (done.exitCode !== 0) {
      fail(
        `specify integration install ${integrationKey} failed ` +
          `(exit ${String(done.exitCode)}); --force was not used`,
      );
    }
  }

  async function guardedDetect(stage: string, onFailure: string): Promise<DetectionResult> {
    try {
      return await base.detect();
    } catch (error: unknown) {
      fail(`${stage} (${errorMessage(error)}); ${onFailure}`);
    }
  }

  async function install(): Promise<void> {
    const initial = await guardedDetect(
      "fresh detection failed",
      "refusing to modify anything",
    );
    if (initial.available) {
      return;
    }
    if (!(await cliPresent())) {
      await installCli();
      const afterCli = await guardedDetect(
        "post-CLI-install detection failed",
        "stopping after CLI installation",
      );
      if (afterCli.available) {
        return;
      }
    }
    await installProjectIntegration();
    const verified = await guardedDetect(
      "post-install verification failed",
      "installation did not converge",
    );
    if (!verified.available) {
      fail(`verification failed: ${verified.detail ?? "expected state not observed"}`);
    }
  }

  const versionCapability = base.version;
  if (versionCapability === undefined) {
    fail("detection integration unexpectedly lacks version()");
  }

  return Object.freeze({
    name: base.name,
    capabilities: Object.freeze(["detect", "version", "install"] as const),
    detect: base.detect,
    version: versionCapability,
    install,
  });
}
