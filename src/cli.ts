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

export function run(argv: string[], version: string): CliResult {
  if (argv.length === 0 || argv.some(isHelpFlag)) {
    return { exitCode: 0, stdout: HELP_TEXT, stderr: "" };
  }
  if (argv.some(isVersionFlag)) {
    return { exitCode: 0, stdout: `${version}\n`, stderr: "" };
  }
  const command = argv[0];
  return {
    exitCode: 1,
    stdout: "",
    stderr: `error: unknown command "${command}".\nRun "ai-team --help" for usage.\n`,
  };
}
