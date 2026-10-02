/**
 * `ai-team setup` command (M17 U-004).
 *
 * The thin async entry point for explicit single-integration
 * setup: `ai-team setup <integration> [--yes]`. Like `status`,
 * the synchronous role-command CLI (`src/cli.ts`) cannot host it
 * — detection and installation are asynchronous — so `src/index.ts`
 * routes `setup …` here. No setup logic lives in this layer; it
 * only composes existing seams:
 *
 * ```text
 * parse argv (setup <integration> [--yes], nothing else)
 *        ↓
 * loadConfiguration (existing config mechanism, read-only)
 *        ↓
 * buildRegistry (production assembly, default)
 *        ↓
 * planIntegrationSetup (U-003: read-only explanation)
 *        ↓
 * ask (injectable confirmation; --yes means confirmed = true)
 *        ↓
 * runIntegrationSetup (U-003: re-plans, mutates at most once, verifies)
 *        ↓
 * bounded CLI output
 * ```
 *
 * The first plan exists only to show the user what would happen:
 * U-003 re-plans inside `runIntegrationSetup`, and that fresh
 * plan stays authoritative — this layer never duplicates
 * action-selection logic. Mutation is unreachable without an
 * explicit confirmation decision; absence of an answer is never
 * approval. Configuration is read, never written. Provider
 * commands are never executed here; the integration's own
 * `install()`/`configure()` runs inside U-003.
 */

import { createInterface } from "node:readline";
import { CliResult } from "./cli";
import { FrameworkConfig } from "./config/schema";
import { loadConfig } from "./config/loader";
import { validateConfig } from "./config/validator";
import { IntegrationRegistry } from "./providers/integration-registry";
import { isIntegrationEnabled } from "./providers/integration-config";
import { createProductionRegistry } from "./providers/integration-production";
import {
  planIntegrationSetup,
  runIntegrationSetup,
} from "./providers/integration-setup";
import { resolveConfigKey } from "./cli-status";

/** Setup command dependencies. Production callers use `createProductionSetupDeps`. */
export interface SetupCommandDeps {
  /** Target project root for configuration and registry assembly. */
  readonly projectRoot: string;
  /** Read and validate configuration. Must not write anything. */
  readonly loadConfiguration: (projectRoot: string) => FrameworkConfig;
  /** Build a fresh integration registry. Must not detect or mutate. */
  readonly buildRegistry: (projectRoot: string) => IntegrationRegistry;
  /** Ask the user a yes-or-no question. Only an explicit yes confirms. */
  readonly askConfirmation: (question: string) => Promise<boolean>;
}

/**
 * Production dependencies for one project root: the existing
 * load-then-validate configuration path, the production registry
 * assembly, and a stdin yes-or-no prompt (Node built-in only).
 */
export function createProductionSetupDeps(projectRoot: string): SetupCommandDeps {
  return {
    projectRoot,
    loadConfiguration: (root) => validateConfig(loadConfig(root)),
    buildRegistry: (root) => createProductionRegistry({ projectRoot: root }),
    askConfirmation: askStdin,
  };
}

/**
 * Stdin confirmation: only an explicit `y`/`yes` (any case, extra
 * whitespace tolerated) confirms. Anything else — empty, `n`,
 * EOF, prose — declines. Absence of an answer is never approval.
 */
async function askStdin(question: string): Promise<boolean> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => {
      terminal.question(`${question} [y/N] `, resolve);
    });
    return /^[yY]([eE][sS])?$/.test(answer.trim());
  } finally {
    terminal.close();
  }
}

function fail(what: string): never {
  throw new Error(`setup command: ${what}`);
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0];
}

function usageError(): CliResult {
  return {
    exitCode: 1,
    stdout: "",
    stderr: 'error: usage: ai-team setup <integration> [--yes]\nRun "ai-team --help" for usage.\n',
  };
}

function toYesNo(value: boolean): string {
  return value ? "yes" : "no";
}

/**
 * Run explicit single-integration setup. Always resolves to a
 * `CliResult` — never rejects. Exit 0 means setup succeeded, was
 * already complete, or was declined by the user; exit 1 means bad
 * arguments, unknown integration, detection failure, mutation or
 * verification failure, or any other failure of the operation
 * itself.
 */
export async function runSetupCommand(
  deps: SetupCommandDeps,
  argv: string[],
): Promise<CliResult> {
  try {
    if (typeof deps !== "object" || deps === null || Array.isArray(deps)) {
      fail("expected a dependencies object");
    }
    if (typeof deps.projectRoot !== "string" || deps.projectRoot.length === 0) {
      fail("projectRoot must be a non-empty string");
    }
    if (typeof deps.loadConfiguration !== "function") {
      fail("loadConfiguration must be a function");
    }
    if (typeof deps.buildRegistry !== "function") {
      fail("buildRegistry must be a function");
    }
    if (typeof deps.askConfirmation !== "function") {
      fail("askConfirmation must be a function");
    }
    if (!Array.isArray(argv) || argv[0] !== "setup") {
      return usageError();
    }
    const name = argv[1];
    const flag = argv[2];
    if (
      typeof name !== "string" ||
      name.length === 0 ||
      name.startsWith("-") ||
      !(
        argv.length === 2 ||
        (argv.length === 3 && flag === "--yes")
      )
    ) {
      return usageError();
    }
    const explicitYes = argv.length === 3;
    const config = deps.loadConfiguration(deps.projectRoot);
    const registry = deps.buildRegistry(deps.projectRoot);
    const isEnabled = (candidate: string): boolean =>
      isIntegrationEnabled(config, resolveConfigKey(candidate));
    const plan = await planIntegrationSetup({ registry, name, isEnabled });
    const detectedWord = plan.detectionFailed ? "detection failed" : toYesNo(plan.detected);
    const header = [
      `Setup: ${plan.integration}`,
      `Enabled: ${toYesNo(plan.enabled)}`,
      `Detected: ${detectedWord}`,
      `Proposed action: ${plan.action ?? "none"} (${plan.reason})`,
      plan.explanation,
    ].join("\n");
    if (plan.action === null) {
      const exitCode = plan.reason === "detection-failed" || plan.reason === "no-mutation-capability" ? 1 : 0;
      return { exitCode, stdout: `${header}\n`, stderr: "" };
    }
    let confirmed: boolean;
    if (explicitYes) {
      confirmed = true;
    } else {
      // The plan travels inside the question so the user reads the
      // explanation before answering; the final output repeats it as
      // the complete record. The returned CliResult stays the only
      // output channel — this layer never writes mid-command.
      confirmed = await deps.askConfirmation(`${header}\nProceed with ${plan.action} of ${plan.integration}?`);
      if (typeof confirmed !== "boolean") {
        fail("askConfirmation must resolve to a boolean");
      }
    }
    const result = await runIntegrationSetup({ registry, name, isEnabled, confirmed });
    const exitCode = !result.mutated || (result.verified && result.detected) ? 0 : 1;
    return { exitCode, stdout: `${header}\nResult: ${result.message}\n`, stderr: "" };
  } catch (error: unknown) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `error: setup failed: ${errorMessage(error)}\nRun "ai-team --help" for usage.\n`,
    };
  }
}
