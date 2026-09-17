#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { run } from "./cli";

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

function main(): void {
  const result = run(process.argv.slice(2), readVersion());
  if (result.stdout.length > 0) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }
  process.exitCode = result.exitCode;
}

main();
