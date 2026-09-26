import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Installation verification tests (T-009): the documented local
// install path — package metadata, built CLI invocable from a clean
// directory, and packed contents. No network, no global install, no
// sudo, no publishing, no external services. The `npm pack --dry-run`
// check needs the npm executable only (a documented prerequisite);
// a registry/network install is intentionally not performed.
// Tests execute compiled from dist-test/tests/, so the repository
// root is two levels up (the established ../.. test convention).
const REPO_ROOT = path.join(__dirname, "..", "..");
const DIST_ENTRY = path.join(REPO_ROOT, "dist", "index.js");

interface PackageJson {
  name?: unknown;
  version?: unknown;
  main?: unknown;
  bin?: unknown;
  files?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
}

function readPackageJson(): PackageJson {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as PackageJson;
}

function withCleanDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-team-install-test-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runCli(args: string[], cwd: string): { exitCode: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [DIST_ENTRY, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 30000,
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (error: unknown) {
    const failure = error as { status?: number; stdout?: unknown; stderr?: unknown };
    return {
      exitCode: failure.status ?? 1,
      stdout: typeof failure.stdout === "string" ? failure.stdout : "",
      stderr: typeof failure.stderr === "string" ? failure.stderr : "",
    };
  }
}

function packFileList(): string[] {
  const probed = spawnSync("npm", ["pack", "--dry-run"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 60000,
  });
  if (probed.error !== undefined || probed.status !== 0) {
    assert.fail(
      `npm pack --dry-run is required for installation verification: ${String(probed.error ?? probed.stderr)}`,
    );
  }
  return `${probed.stdout ?? ""}${probed.stderr ?? ""}`.split("\n");
}

describe("installation verification", () => {
  it("declares the documented package metadata contract", () => {
    const pkg = readPackageJson();
    assert.equal(pkg.name, "ai-team-framework");
    assert.equal(pkg.version, "0.1.0");
    assert.match(String(pkg.version), /^\d+\.\d+\.\d+$/);
    assert.equal(pkg.main, "dist/index.js");
    assert.deepEqual(pkg.bin, { "ai-team": "dist/index.js" });
    assert.ok(
      Array.isArray(pkg.files) && (pkg.files as unknown[]).includes("dist"),
      "package ships dist/",
    );
    assert.deepEqual(Object.keys((pkg.dependencies ?? {}) as Record<string, unknown>), ["yaml"]);
  });

  it("ships the built entry points the metadata promises", () => {
    const pkg = readPackageJson();
    const bin = pkg.bin as Record<string, string>;
    assert.equal(fs.statSync(DIST_ENTRY).isFile(), true);
    assert.equal(
      fs.statSync(path.join(REPO_ROOT, bin["ai-team"] as string)).isFile(),
      true,
    );
    assert.equal(fs.statSync(path.join(REPO_ROOT, "package.json")).isFile(), true);
  });

  it("starts the built CLI from a clean directory without services", () => {
    withCleanDir((dir) => {
      const help = runCli(["--help"], dir);
      assert.equal(help.exitCode, 0);
      assert.ok(help.stdout.includes("Usage:"));
      assert.ok(help.stdout.includes("ai-team run"));

      const version = runCli(["--version"], dir);
      assert.equal(version.exitCode, 0);
      assert.equal(version.stdout, "0.1.0\n");

      const missingConfig = runCli(["run"], dir);
      assert.equal(missingConfig.exitCode, 1);
      assert.equal(missingConfig.stdout, "");
      assert.ok(
        missingConfig.stderr.includes("run error: Configuration file not found"),
        "bare run fails bounded without services, credentials, or hangs",
      );
    });
  });

  it("fails cleanly for unknown commands without external calls", () => {
    withCleanDir((dir) => {
      const result = runCli(["deploy", "--force"], dir);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.ok(result.stderr.includes("unknown command"));
    });
  });

  it("packs only distributable artifacts, never sources or tests", () => {
    const lines = packFileList();
    const names = lines.join("\n");
    assert.ok(names.includes("package.json"), "package.json ships (version lookup needs it)");
    assert.ok(names.includes("README.md"), "README ships");
    assert.ok(names.includes("LICENSE"), "LICENSE ships");
    assert.ok(names.includes("dist/index.js"), "built entry ships");
    assert.ok(names.includes("dist/cli.js"), "built CLI ships");
    for (const line of lines) {
      const entry = line.replace(/^npm notice\s+/, "").trim();
      assert.ok(!entry.startsWith("src/"), `source must not ship: ${entry}`);
      assert.ok(!entry.startsWith("tests/"), `tests must not ship: ${entry}`);
      assert.ok(!entry.startsWith("node_modules/"), `dependencies must not ship: ${entry}`);
      assert.ok(!entry.startsWith("dist-test/"), `test output must not ship: ${entry}`);
    }
  });

  it("resolves deterministically across repeated invocations", () => {
    withCleanDir((dir) => {
      assert.deepEqual(runCli(["--version"], dir), runCli(["--version"], dir));
      assert.deepEqual(runCli(["run"], dir).exitCode, runCli(["run"], dir).exitCode);
    });
  });
});
