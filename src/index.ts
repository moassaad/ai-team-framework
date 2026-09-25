#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { run } from "./cli";
import { createProductionStatusDeps, runStatusCommand } from "./cli-status";
import { createProductionSetupDeps, runSetupCommand } from "./cli-setup";

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
  // `status` and `setup` need async detection/installation, which
  // the synchronous `run` cannot host: route them to the dedicated
  // async commands, which validate their own shapes. They never
  // reject (failures become exit-1 results), so no further error
  // handling is required here. Anything else follows the existing
  // sync command path.
  const result =
    argv.length === 1 && argv[0] === "status"
      ? await runStatusCommand(createProductionStatusDeps(process.cwd()))
      : argv.length >= 1 && argv[0] === "setup"
        ? await runSetupCommand(createProductionSetupDeps(process.cwd()), argv)
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
