/**
 * `ai-team status` command (M17 U-002).
 *
 * The thin async entry point the synchronous role-command CLI
 * (`src/cli.ts`, pure `run(argv, version)`) cannot host: real
 * detection is asynchronous, so status lives here as
 * `runStatusCommand`, and `src/index.ts` routes an exact
 * `ai-team status` invocation to it. No new status logic lives in
 * this layer — it only composes existing seams:
 *
 * ```text
 * loadConfiguration (existing config mechanism, read-only)
 *        ↓
 * buildRegistry (production assembly, default)
 *        ↓
 * getIntegrationStatus (U-001: fresh detection + desired state)
 *        ↓
 * formatIntegrationStatus (U-001: existing renderer)
 *        ↓
 * CLI output
 * ```
 *
 * Observation only: configuration is read, never written;
 * detection is the integrations' own read-only `detect()`;
 * install, configure, setup, delegation, and Git mutation cannot
 * be reached from here (the seams for them are never imported,
 * let alone called). One integration's detection failure stays
 * that integration's state line — the command still exits 0.
 * Only a failure of the status operation itself (bad deps,
 * configuration loading failure, registry construction failure,
 * unexpected fatal error) exits non-zero with a bounded message.
 */

import { CliResult } from "./cli";
import { FrameworkConfig } from "./config/schema";
import { loadConfig } from "./config/loader";
import { validateConfig } from "./config/validator";
import { IntegrationRegistry } from "./providers/integration-registry";
import { isIntegrationEnabled } from "./providers/integration-config";
import {
  formatIntegrationStatus,
  getIntegrationStatus,
} from "./providers/integration-status";
import {
  createProductionRegistry,
} from "./providers/integration-production";

/** Status command dependencies. Production callers use `createProductionStatusDeps`. */
export interface StatusCommandDeps {
  /** Target project root for configuration and registry assembly. */
  readonly projectRoot: string;
  /** Read and validate configuration. Must not write anything. */
  readonly loadConfiguration: (projectRoot: string) => FrameworkConfig;
  /** Build a fresh integration registry. Must not detect or mutate. */
  readonly buildRegistry: (projectRoot: string) => IntegrationRegistry;
}

/**
 * Production dependencies for one project root: the existing
 * load-then-validate configuration path and the production
 * registry assembly. Reading a missing or invalid configuration
 * throws here, at command scope — never inside the status layer.
 */
export function createProductionStatusDeps(projectRoot: string): StatusCommandDeps {
  return {
    projectRoot,
    loadConfiguration: (root) => validateConfig(loadConfig(root)),
    buildRegistry: (root) => createProductionRegistry({ projectRoot: root }),
  };
}

/**
 * Registry identifiers (I-001) predate the configuration provider
 * keys (M2) and differ for Spec Kit (`spec-kit` vs `speckit`).
 * Bridge them at this composition edge so desired state resolves
 * correctly; names without an entry pass through unchanged. This
 * is a name mapping only — no configuration is owned, parsed, or
 * extended here.
 */
const CONFIG_KEY_BY_INTEGRATION: Record<string, string> = {
  "spec-kit": "speckit",
};

function fail(what: string): never {
  throw new Error(`status command: ${what}`);
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0];
}

/**
 * Report fresh integration status for one project. Always resolves
 * to a `CliResult` — never rejects — so the entry point needs no
 * other error handling. Exit 0 carries the formatted states
 * (including per-integration detection failures); exit 1 means
 * the status operation itself could not run.
 */
export async function runStatusCommand(deps: StatusCommandDeps): Promise<CliResult> {
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
    const config = deps.loadConfiguration(deps.projectRoot);
    const registry = deps.buildRegistry(deps.projectRoot);
    const states = await getIntegrationStatus({
      registry,
      isEnabled: (name) => isIntegrationEnabled(config, CONFIG_KEY_BY_INTEGRATION[name] ?? name),
    });
    return { exitCode: 0, stdout: formatIntegrationStatus(states), stderr: "" };
  } catch (error: unknown) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `error: status failed: ${errorMessage(error)}\nRun "ai-team --help" for usage.\n`,
    };
  }
}
