/**
 * Delegate-skill installation capability (D-103).
 *
 * Composes the D-102 detection integration: the returned `Integration`
 * reuses its `detect()` unchanged and additionally exposes the optional
 * `install()` capability. `configure()` and `version()` remain out of
 * scope.
 *
 * Confirmation boundary: this module performs NO prompting. Call
 * `install()` only after the Framework has completed Detect →
 * Explain → explicit user confirmation (the pure
 * `describeDelegateSkillInstall()` helper exists so a future setup
 * layer can explain source, skill, agent, and scope first).
 * Installation itself then follows Detect → Install → Verify, where
 * Verify is a fresh D-102 `detect()` whose result is authoritative: a
 * successful command exit without a confirming detection is reported
 * as failure.
 *
 * What `install()` may change, and nothing else: exactly one
 * explicitly requested `<name>-delegate` skill, installed through the
 * Skills CLI as `npx skills add amElnagdy/delegate-skills --skill
 * <skill> [--agent <agent>] [--global] -y` (verified upstream flags;
 * `-y` only suppresses the second prompt after Framework-level
 * confirmation already happened; `--all` is never used).
 * `delegate-setup` is never installed or invoked; no fleet, lane,
 * model, or session state is created; no implementer is executed;
 * no authentication is performed.
 *
 * Scope default is `project` (the upstream default: `./<agent>/skills/`,
 * committed with the project). `global` (`~/<agent>/skills/`) requires
 * an explicit option because it reaches beyond the target project.
 * Project-scope installs run with the given project root as working
 * directory.
 *
 * Environment rule: the Skills CLI requires Node >= 22.20.0 per its
 * package metadata. The runtime is checked before anything runs and
 * installation fails clearly on incompatibility — the framework never
 * upgrades Node, installs system packages, uses sudo, or bootstraps
 * environments. A missing `npx` likewise fails closed with its
 * prerequisite named.
 */

import {
  DetectionResult,
  Integration,
} from "./integration";
import {
  DelegateCommandResult,
  DelegateSkillIntegrationOptions,
  createDelegateSkillIntegration,
  defaultRunCommand,
} from "./delegate-detection";

/** Installation source. Always this repository; never caller-supplied. */
export const DELEGATE_SKILLS_SOURCE = "amElnagdy/delegate-skills" as const;

/** Skills CLI engine floor per its package metadata. */
const SKILLS_CLI_NODE_MAJOR = 22;
const SKILLS_CLI_NODE_MINOR = 20;

/** Network allowance for the Skills CLI install command. */
const INSTALL_COMMAND_TIMEOUT_MS = 300_000;

/** Installation scope. `project` is the upstream default. */
export const DELEGATE_INSTALL_SCOPES = ["project", "global"] as const;
export type DelegateInstallScope = (typeof DELEGATE_INSTALL_SCOPES)[number];

export interface DelegateSkillInstallOptions extends DelegateSkillIntegrationOptions {
  /**
   * Installation scope. Defaults to `"project"` (the upstream
   * default); `"global"` must be chosen explicitly.
   */
  readonly installScope?: DelegateInstallScope;
  /**
   * Target agent passed as `--agent` (e.g. `"opencode"`). Passed only
   * when explicitly known; otherwise the flag is omitted and the
   * Skills CLI auto-detects. Never expanded to multi-agent installs.
   */
  readonly targetAgent?: string;
  /**
   * Working directory for the install command (the project a
   * project-scope install lands in). Defaults to the process working
   * directory; callers should pass the target project explicitly.
   */
  readonly projectRoot?: string;
  /**
   * Node version string checked for Skills CLI compatibility.
   * Defaults to the running `process.version`; exposed so tests stay
   * hermetic without touching the real runtime.
   */
  readonly nodeVersion?: string;
}

/** Deterministic install plan for the Framework explanation layer. */
export interface DelegateSkillInstallPlan {
  readonly source: string;
  readonly skill: string;
  readonly agent: string | undefined;
  readonly scope: DelegateInstallScope;
  readonly command: readonly string[];
}

function fail(what: string): never {
  throw new Error(`delegate install: ${what}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSkillName(value: unknown): boolean {
  return (
    typeof value === "string" && /^[a-z0-9]+(-[a-z0-9]+)*-delegate$/.test(value)
  );
}

function resolveScope(value: unknown): DelegateInstallScope {
  if (value === undefined) {
    return "project";
  }
  if (value === "project" || value === "global") {
    return value;
  }
  return fail(`unknown install scope ${JSON.stringify(value)}`);
}

function resolveAgent(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    fail("targetAgent must be a non-empty string");
  }
  return value;
}

/** True when the runtime satisfies the Skills CLI engine floor. */
function nodeSatisfiesSkillsCli(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major !== Math.floor(major) || minor !== Math.floor(minor)) {
    return false;
  }
  return (
    major > SKILLS_CLI_NODE_MAJOR ||
    (major === SKILLS_CLI_NODE_MAJOR && minor >= SKILLS_CLI_NODE_MINOR)
  );
}

/**
 * Describe exactly what `install()` would do, without doing it. Pure
 * and deterministic: the future explanation layer calls this before
 * asking for confirmation.
 */
export function describeDelegateSkillInstall(
  options: DelegateSkillInstallOptions,
): DelegateSkillInstallPlan {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    fail("expected an options object");
  }
  if (!isSkillName(options.skillName)) {
    fail(
      `unknown delegate skill ${JSON.stringify(options.skillName)} ` +
        '(expected "<name>-delegate")',
    );
  }
  const scope = resolveScope(options.installScope);
  const agent = resolveAgent(options.targetAgent);
  const command = [
    "skills",
    "add",
    DELEGATE_SKILLS_SOURCE,
    "--skill",
    options.skillName as string,
    ...(agent === undefined ? [] : ["--agent", agent]),
    ...(scope === "global" ? ["--global"] : []),
    "-y",
  ];
  return Object.freeze({
    source: DELEGATE_SKILLS_SOURCE,
    skill: options.skillName as string,
    agent,
    scope,
    command: Object.freeze(command),
  });
}

/**
 * Build the delegate-skill integration with the optional installation
 * capability for one requested skill. Construction performs no calls;
 * every `install()` starts with fresh detection and ends with fresh
 * verification.
 */
export function createDelegateSkillIntegrationWithInstall(
  options: DelegateSkillInstallOptions,
): Integration {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    fail("expected an options object");
  }
  const plan = describeDelegateSkillInstall(options);
  const projectRoot =
    options.projectRoot === undefined ? process.cwd() : options.projectRoot;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    fail("projectRoot must be a non-empty string");
  }
  const nodeVersion = options.nodeVersion ?? process.version;
  const base = createDelegateSkillIntegration({
    skillName: plan.skill,
    implementerCommand: options.implementerCommand,
    skillRoots: options.skillRoots,
    runCommand: options.runCommand,
    readFile: options.readFile,
  });
  const runCommand = options.runCommand ?? defaultRunCommand;
  if (typeof runCommand !== "function") {
    fail("runCommand must be a function");
  }

  async function runOnly(
    command: string,
    args: readonly string[],
    timeoutMs?: number,
  ): Promise<DelegateCommandResult> {
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

  async function install(): Promise<void> {
    if (!nodeSatisfiesSkillsCli(nodeVersion)) {
      fail(
        `Skills CLI requires Node >= 22.20.0 (current runtime ${nodeVersion}); ` +
          "upgrade Node manually — the framework never modifies the runtime",
      );
    }
    let initial: DetectionResult;
    try {
      initial = await base.detect();
    } catch (error: unknown) {
      fail(`fresh detection failed (${errorMessage(error)}); refusing to modify anything`);
    }
    if (initial.available) {
      return;
    }
    let npx: DelegateCommandResult;
    try {
      npx = await runCommand("npx", ["--version"], { cwd: projectRoot });
    } catch (error: unknown) {
      fail(`npx is not available (${errorMessage(error)}); install Node.js first`);
    }
    if (npx.exitCode !== 0) {
      fail(`npx probe failed (exit ${String(npx.exitCode)})`);
    }
    const done = await runOnly("npx", plan.command, INSTALL_COMMAND_TIMEOUT_MS);
    if (done.exitCode !== 0) {
      fail(`skills install failed (exit ${String(done.exitCode)})`);
    }
    let verified: DetectionResult;
    try {
      verified = await base.detect();
    } catch (error: unknown) {
      fail(`post-install verification failed (${errorMessage(error)})`);
    }
    if (!verified.available) {
      fail(`verification failed: ${verified.detail ?? "expected state not observed"}`);
    }
  }

  return Object.freeze({
    name: base.name,
    capabilities: Object.freeze(["detect", "install"] as const),
    detect: base.detect,
    install,
  });
}
