import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Installed package smoke test (M20 NPM-002): the exact
// locally packed tarball is installed with real `npm
// install` into a minimal temporary consumer, and the
// installed `ai-team` binary is exercised there. Only safe
// non-destructive invocations run; no credentials, no
// network beyond npm's own dependency resolution, nothing
// published, no registry writes, no npm config changes. The
// registry read check is read-only and never gates local
// artifact validation.

const REPO_ROOT = join(__dirname, "..", "..");
const EXPECTED_VERSION = "0.3.0";
const TARBALL_NAME = `moassaad-ai-team-framework-${EXPECTED_VERSION}.tgz`;

function npm(args: readonly string[], cwd: string): string {
  return execFileSync("npm", [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Child environment with any repository NODE_PATH override removed. */
function consumerEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_PATH;
  assert.equal(env.NODE_PATH, undefined, "consumer proof requires no repository NODE_PATH");
  return env;
}

function setupConsumer(): { workdir: string; consumer: string; tarball: string } {
  // Rebuild dist from current sources so the packed tarball
  // is exactly the artifact under test, never a stale build.
  npm(["run", "build", "--silent"], REPO_ROOT);
  const workdir = mkdtempSync(join(tmpdir(), "ai-team-consumer-"));
  const tarball = join(workdir, TARBALL_NAME);
  npm(["pack", REPO_ROOT, "--pack-destination", workdir, "--silent"], REPO_ROOT);
  assert.ok(existsSync(tarball), "exact tarball under test produced");
  const consumer = join(workdir, "consumer");
  mkdirSync(consumer, { recursive: true });
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "ai-team-framework-consumer-test", private: true, version: "0.0.0" }),
  );
  npm(["install", tarball, "--no-audit", "--no-fund", "--no-save"], consumer);
  return { workdir, consumer, tarball };
}

function installedRoot(consumer: string): string {
  return join(consumer, "node_modules", "@moassaad", "ai-team-framework");
}

describe("npm consumer installation and smoke test", () => {
  it("installs the exact tarball and runs the installed ai-team CLI", { timeout: 180000 }, () => {
    const { workdir, consumer } = setupConsumer();
    try {
      const root = installedRoot(consumer);
      assert.ok(existsSync(join(root, "package.json")), "consumer gets the package under its expected name");
      const installed = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, unknown>;
      assert.equal(installed.name, "@moassaad/ai-team-framework", "installed name matches");
      assert.equal(installed.version, EXPECTED_VERSION, "installed version matches the tarball and repo manifest");
      assert.deepEqual(installed.bin, { "ai-team": "dist/index.js" }, "bin mapping survives installation");
      assert.deepEqual(installed.dependencies, { yaml: "^2.9.1" }, "production dependencies survive installation");
      assert.equal(installed.license, "MIT", "license survives installation");
      assert.equal(installed.private, undefined, "no accidental private flag in the artifact");
      const binPath = join(consumer, "node_modules", ".bin", "ai-team");
      assert.ok(existsSync(binPath), "npm installs the declared executable");
      const env = consumerEnv();
      const runBin = (args: readonly string[]): string =>
        execFileSync(binPath, [...args], { cwd: workdir, encoding: "utf8", env });
      const help = runBin(["--help"]);
      for (const command of ["run", "status", "setup", "sprint"]) {
        assert.ok(help.includes(command), `installed --help presents ${command}`);
      }
      const npxHelp = execFileSync("npx", ["--no-install", "ai-team", "--help"], { cwd: consumer, encoding: "utf8", env });
      assert.ok(npxHelp.includes("ai-team sprint"), "npx resolves the installed binary");
      assert.equal(runBin(["--version"]).trim(), EXPECTED_VERSION, "installed --version matches the tested artifact");
      const sprintHelp = runBin(["sprint", "--help"]);
      assert.ok(sprintHelp.includes("usage: ai-team sprint"), "installed sprint usage reachable");
      let usageError = "";
      try {
        runBin(["sprint", "--yes"]);
      } catch (error) {
        assert.equal((error as { status?: unknown }).status, 1, "invalid sprint input exits non-success");
        usageError = String((error as { stderr?: unknown }).stderr ?? "");
      }
      assert.ok(usageError.includes("usage: ai-team sprint"), "installed CLI fails safely with bounded usage");
      assert.ok(existsSync(join(consumer, "node_modules", "yaml", "package.json")), "yaml resolved from the installed production tree");
      assert.ok(!existsSync(join(root, "src")), "no repository src beside the artifact");
      assert.ok(!existsSync(join(root, "tests")), "no repository tests beside the artifact");
      assert.ok(!existsSync(join(root, "docs")), "no repository docs beside the artifact");
      assert.ok(existsSync(join(root, "dist", "index.js")), "installed CLI executes from the compiled artifact");
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it("registry read check is read-only and never gates local validation", { timeout: 60000 }, () => {
    // Classification only, stable before and after release:
    // "released" means the registry lists our exact
    // identity and version; "unclaimed" means the 404
    // pre-publish state; "unavailable" means no registry
    // access. All three keep local artifact validation
    // green — this check observes, never gates.
    let status = "unavailable";
    let detail = "registry unreachable or npm view failed";
    try {
      const raw = execFileSync("npm", ["view", "@moassaad/ai-team-framework", "name", "version", "--json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const metadata = JSON.parse(raw) as { name?: unknown; version?: unknown };
      if (metadata.name === "@moassaad/ai-team-framework" && metadata.version === EXPECTED_VERSION) {
        status = "released";
        detail = "registry reports the released identity and version";
      } else {
        status = "unclaimed";
        detail = `registry reports: ${raw.slice(0, 120)}`;
      }
    } catch (error) {
      const stderr = String((error as { stderr?: unknown }).stderr ?? "");
      status = /E404|404/.test(stderr) ? "unclaimed" : "unavailable";
      detail = status === "unclaimed"
        ? "candidate not on the registry (pre-publish state)"
        : "registry unreachable or npm view failed";
    }
    assert.ok(["released", "unclaimed", "unavailable"].includes(status), `registry check classified: ${status} (${detail})`);
  });
});
