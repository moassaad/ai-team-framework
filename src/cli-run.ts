/**
 * Production runtime CLI command (M18 R-012): `ai-team run`.
 *
 * The first user-facing entry point executing the production
 * Coordinator runtime. One bare invocation means exactly one
 * composed application call — one source read, one Coordinator
 * invocation, at most one ticket, at most one sink write — and
 * then the command reports the result and exits. No loops, no
 * scheduler, no sprint, no second ticket.
 *
 * ```text
 * CLI (argument + config + credential assembly only)
 *  ↓ runGitHubProductionCoordinator (R-011, sole runtime seam)
 * TicketSource → Coordinator → TicketSink
 * ```
 *
 * The CLI never selects tickets, transitions workflow states,
 * resolves roles, infers specialty, calls OpenCode or GitHub,
 * or touches Git: it assembles validated configuration
 * (`providers.github`, including the R-012 `managedLabel`
 * and `specialty` keys), reads the token through an injected
 * secure reader, and translates the existing application
 * result into concise bounded output plus an exit code. The
 * token travels only in memory into the production call —
 * never argv, history, logs, output, errors, or disk.
 */

import { FrameworkConfig } from "./config/schema";
import { loadConfig } from "./config/loader";
import { validateConfig } from "./config/validator";
import { AgentProvider } from "./providers/agent";
import { isImplementerSpecialty } from "./roles/contract";
import { createOpenCodeProvider } from "./providers/opencode";
import { CliResult } from "./cli";
import { CoordinatorTicketResult } from "./runtime/coordinator";
import { ProductionSynchronizationFailed } from "./runtime/application";
import {
  GitHubProductionOptions,
  runGitHubProductionCoordinator,
} from "./runtime/github-production";

/** Production review verdict and execution bound for `ai-team run`. */
const RUN_REVIEW_DECISION = "approved" as const;
const RUN_TIMEOUT_MS = 300000;

/**
 * Secure credential reader: one token string, injectable for
 * hermetic tests. Production reads a single line from stdin
 * (pipe the token in; it never appears in argv or history).
 */
export type TokenReader = () => Promise<string>;

function readTokenFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data.split("\n")[0].replace(/\r$/, "").trim());
    });
    process.stdin.on("error", (error: Error) => {
      reject(error);
    });
    process.stdin.resume();
  });
}

/**
 * Injectable production dependencies, following the
 * cli-status/cli-setup seam pattern. Production uses config
 * files, stdin credentials, the real OpenCode provider, and
 * the R-011 composition; tests inject fakes for all four.
 */
export interface RunCommandDeps {
  readonly projectRoot: string;
  readonly loadConfiguration: (projectRoot: string) => FrameworkConfig;
  readonly readToken: TokenReader;
  readonly createAgent: () => AgentProvider<string>;
  readonly runProduction: (
    options: GitHubProductionOptions,
  ) => Promise<CoordinatorTicketResult | ProductionSynchronizationFailed>;
}

export function createProductionRunDeps(projectRoot: string): RunCommandDeps {
  return {
    projectRoot,
    loadConfiguration: (root) => validateConfig(loadConfig(root)),
    readToken: readTokenFromStdin,
    createAgent: () => createOpenCodeProvider(),
    runProduction: (options) => runGitHubProductionCoordinator(options),
  };
}

function fail(what: string): never {
  throw new Error(`run command: ${what}`);
}

function ok(stdout: string): CliResult {
  return { exitCode: 0, stdout, stderr: "" };
}

function commandError(stderr: string): CliResult {
  return { exitCode: 1, stdout: "", stderr };
}

const RUN_USAGE = `usage: ai-team run
Executes one production Coordinator ticket: reads managed GitHub
issues once, runs at most one ticket, synchronizes it once.
Configuration (providers.github with owner, repo, managedLabel,
specialty) comes from .ai-team/config.yaml; the GitHub token is
read from stdin (pipe it in, never pass it as an argument).
`;

function finalStateOf(result: CoordinatorTicketResult): string {
  if ("final_state" in result) {
    return result.final_state;
  }
  return "unknown";
}

function describeResult(result: CoordinatorTicketResult | ProductionSynchronizationFailed): CliResult {
  switch (result.outcome) {
    case "completed":
      return ok(`run completed: ticket ${result.ticket_id} -> ${result.final_state}.\n`);
    case "no-work":
      return ok(`run no-work: ${result.reason}.\n`);
    case "conflict":
      return commandError(
        `run conflict: ticket ${result.ticket_id} (${result.state}): ${result.reason}.\n`,
      );
    case "implementer-failed":
      return commandError(
        `run implementer-failed: ticket ${result.ticket_id} (${result.error.kind}): ${result.error.message}.\n`,
      );
    case "reviewer-failed":
      return commandError(
        `run reviewer-failed: ticket ${result.ticket_id} (${result.error.kind}): ${result.error.message}.\n`,
      );
    case "sync-failed":
      return commandError(
        `run sync-failed: ticket ${result.ticket_id} advanced to ${finalStateOf(result.coordinatorResult)} but synchronization failed (${result.error.kind}): ${result.error.message}.\n`,
      );
    default:
      return commandError("run error: unknown runtime result.\n");
  }
}

/**
 * Execute bare `ai-team run` exactly once. Any other argument
 * shape is a usage error and never reaches the runtime.
 * Configuration, credential, and runtime failures become
 * bounded exit-1 results; this function never rejects.
 */
export async function runRunCommand(deps: RunCommandDeps, argv: string[]): Promise<CliResult> {
  try {
    if (typeof deps !== "object" || deps === null) {
      fail("expected a dependencies object");
    }
    if (typeof deps.projectRoot !== "string") {
      fail("projectRoot must be a string");
    }
    if (typeof deps.loadConfiguration !== "function") {
      fail("loadConfiguration must be a function");
    }
    if (typeof deps.readToken !== "function") {
      fail("readToken must be a function");
    }
    if (typeof deps.createAgent !== "function") {
      fail("createAgent must be a function");
    }
    if (typeof deps.runProduction !== "function") {
      fail("runProduction must be a function");
    }
    if (argv.length !== 1 || argv[0] !== "run") {
      return commandError(RUN_USAGE);
    }
    const config = deps.loadConfiguration(deps.projectRoot);
    const github =
      typeof config === "object" && config !== null
        ? (config as FrameworkConfig).providers?.github
        : undefined;
    const managedLabel = github?.managedLabel;
    if (typeof managedLabel !== "string" || managedLabel.length === 0) {
      fail("providers.github.managedLabel is required for ai-team run");
    }
    const specialty = github?.specialty;
    if (!isImplementerSpecialty(specialty)) {
      fail("providers.github.specialty is required for ai-team run");
    }
    let token: unknown;
    try {
      token = await deps.readToken();
    } catch {
      token = "";
    }
    if (typeof token !== "string" || token.trim().length === 0) {
      fail("a non-empty GitHub token on stdin is required for ai-team run");
    }
    const cleanToken = token.trim();
    const result = await deps.runProduction({
      config,
      token: cleanToken,
      managedLabel,
      specialty,
      openCodeAgent: deps.createAgent(),
      project_root: deps.projectRoot,
      timeout_ms: RUN_TIMEOUT_MS,
      reviewDecision: RUN_REVIEW_DECISION,
    });
    return describeResult(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return commandError(`run error: ${message}.\n`);
  }
}
