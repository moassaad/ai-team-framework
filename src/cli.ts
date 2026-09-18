import { COORDINATOR_ROLE } from "./roles/coordinator";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const HELP_TEXT = `AI Team Framework CLI
Minimal command-line entry point. Framework orchestration is not implemented yet.

Usage:
  ai-team [options]

Options:
  -h, --help       Show this help message and exit.
  -V, --version    Show the CLI version and exit.
`;

function isHelpFlag(arg: string): boolean {
  return arg === "--help" || arg === "-h";
}

function isVersionFlag(arg: string): boolean {
  return arg === "--version" || arg === "-V";
}

/**
 * Default Coordinator entry point (`ai-team run`). A bare `run` selects
 * the Coordinator per the role-selection contract (omitting `--role`
 * always selects `coordinator`); role identity and purpose come from the
 * existing contract, and execution remains unimplemented. Extra arguments
 * such as `--role` belong to later CLI tickets and are rejected here.
 */
function runCoordinator(): CliResult {
  return {
    exitCode: 0,
    stdout:
      `${COORDINATOR_ROLE.name} (${COORDINATOR_ROLE.id})\n` +
      `${COORDINATOR_ROLE.purpose}\n` +
      `Role execution is not implemented yet.\n`,
    stderr: "",
  };
}

export function run(argv: string[], version: string): CliResult {
  if (argv.length === 0 || argv.some(isHelpFlag)) {
    return { exitCode: 0, stdout: HELP_TEXT, stderr: "" };
  }
  if (argv.some(isVersionFlag)) {
    return { exitCode: 0, stdout: `${version}\n`, stderr: "" };
  }
  if (argv[0] === "run") {
    if (argv.length === 1) {
      return runCoordinator();
    }
  }
  const command = argv.join(" ");
  return {
    exitCode: 1,
    stdout: "",
    stderr: `error: unknown command "${command}".\nRun "ai-team --help" for usage.\n`,
  };
}
