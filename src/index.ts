#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { run } from "./cli";
import { createProductionStatusDeps, runStatusCommand } from "./cli-status";
import { createProductionSetupDeps, runSetupCommand } from "./cli-setup";
import { createProductionRunDeps, runRunCommand } from "./cli-run";

function readVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8");
    const pkg: unknown = JSON.parse(raw);
    if (typeof pkg === "object" && pkg !== null && "version" in pkg) {
      const version: unknown = (pkg as { version?: unknown }).version;
      return typeof version === "string" ? version : "unknown";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // `status` and `setup` need async detection/installation, and
  // bare `run` executes the production Coordinator runtime, all
  // of which the synchronous `run` cannot host: route them to
  // the dedicated async commands, which validate their own
  // shapes. They never reject (failures become exit-1 results),
  // so no further error handling is required here. Anything
  // else follows the existing sync command path (including
  // `run --role ...`, prompts, and slash commands).
  const result =
    argv.length === 1 && argv[0] === "status"
      ? await runStatusCommand(createProductionStatusDeps(process.cwd()))
      : argv.length >= 1 && argv[0] === "setup"
        ? await runSetupCommand(createProductionSetupDeps(process.cwd()), argv)
        : argv.length === 1 && argv[0] === "run"
          ? await runRunCommand(createProductionRunDeps(process.cwd()), argv)
          : run(argv, readVersion());
  if (result.stdout.length > 0) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }
  process.exitCode = result.exitCode;
}

void main();
