import { COORDINATOR_ROLE } from "./roles/coordinator";
import { IMPLEMENTER_ROLE } from "./roles/implementer";
import { PROJECT_MANAGER_ROLE } from "./roles/project-manager";
import { SENIOR_REVIEWER_ROLE } from "./roles/senior-reviewer";
import { TECHNICAL_LEAD_ROLE } from "./roles/technical-lead";
import { RoleContract, RoleId } from "./roles/contract";
import { resolveRole } from "./roles/selection";

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
 * The five concrete role contracts, looked up by their own canonical ids.
 * No identifiers are duplicated here: matching uses each contract's `id`.
 */
const ROLE_CONTRACTS: readonly RoleContract[] = [
  COORDINATOR_ROLE,
  PROJECT_MANAGER_ROLE,
  TECHNICAL_LEAD_ROLE,
  IMPLEMENTER_ROLE,
  SENIOR_REVIEWER_ROLE,
];

function findContract(id: RoleId): RoleContract | undefined {
  return ROLE_CONTRACTS.find((contract) => contract.id === id);
}

/**
 * Present a resolved role contract. Shared by the default Coordinator
 * entry point and explicit `--role` selection; role execution remains
 * unimplemented in both cases.
 */
function presentRole(contract: RoleContract): CliResult {
  return {
    exitCode: 0,
    stdout:
      `${contract.name} (${contract.id})\n` +
      `${contract.purpose}\n` +
      `Role execution is not implemented yet.\n`,
    stderr: "",
  };
}

/**
 * Default Coordinator entry point (`ai-team run`). A bare `run` selects
 * the Coordinator per the role-selection contract (omitting `--role`
 * always selects `coordinator`); role identity and purpose come from the
 * existing contract, and execution remains unimplemented. Extra arguments
 * such as `--role` belong to later CLI tickets and are rejected here.
 */
function runCoordinator(): CliResult {
  return presentRole(COORDINATOR_ROLE);
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
    if (argv.length === 3 && argv[1] === "--role") {
      const selection = resolveRole(argv[2]);
      if (selection !== undefined) {
        const contract = findContract(selection.role);
        if (contract !== undefined) {
          return presentRole(contract);
        }
      }
    }
  }
  const command = argv.join(" ");
  return {
    exitCode: 1,
    stdout: "",
    stderr: `error: unknown command "${command}".\nRun "ai-team --help" for usage.\n`,
  };
}
