import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// npm package distribution contract (M20 NPM-001): what is
// published, and can the published artifact alone install
// and run. Manifest assertions are static; artifact and
// installation assertions pack the real tarball into a
// temporary directory and invoke the unpacked CLI there —
// hermetic apart from the local npm/tar toolchain (no
// registry, no credentials, no network). Nothing here
// publishes anything.

const REPO_ROOT = join(__dirname, "..", "..");

interface Manifest {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly description?: unknown;
  readonly license?: unknown;
  readonly private?: unknown;
  readonly type?: unknown;
  readonly main?: unknown;
  readonly bin?: unknown;
  readonly files?: unknown;
  readonly scripts?: Record<string, unknown>;
  readonly dependencies?: Record<string, unknown>;
  readonly devDependencies?: Record<string, unknown>;
  readonly repository?: unknown;
  readonly bugs?: unknown;
  readonly engines?: unknown;
  readonly publishConfig?: unknown;
}

function manifest(): Manifest {
  return JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as Manifest;
}

function npm(args: readonly string[], cwd: string): string {
  return execFileSync("npm", [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

describe("npm package identity and metadata", () => {
  it("declares a valid public identity with an untouched version", () => {
    const pkg = manifest();
    assert.equal(pkg.name, "ai-team-framework", "package name valid and unchanged");
    assert.equal(pkg.version, "0.1.0", "release version belongs to the later release ticket");
    assert.equal(pkg.private, undefined, "public package: private must be absent");
    assert.equal(typeof pkg.description, "string");
    assert.ok((pkg.description as string).length > 0, "description present");
    assert.equal(pkg.license, "MIT", "declared license matches the LICENSE file");
    assert.ok(existsSync(join(REPO_ROOT, "LICENSE")), "LICENSE file present for the artifact");
    assert.ok(existsSync(join(REPO_ROOT, "README.md")), "README present for the artifact");
  });

  it("exposes exactly the existing CLI surface", () => {
    const pkg = manifest();
    assert.equal(pkg.type, "commonjs", "module format matches the TypeScript build");
    assert.equal(pkg.main, "dist/index.js", "main is the compiled entry");
    assert.deepEqual(pkg.bin, { "ai-team": "dist/index.js" }, "one binary, the existing name, the compiled artifact");
    const entry = readFileSync(join(REPO_ROOT, "dist", "index.js"), "utf8");
    assert.ok(entry.startsWith("#!/usr/bin/env node"), "bin target carries a shebang for direct execution");
    assert.ok(existsSync(join(REPO_ROOT, "dist", "cli.js")), "build artifact exists");
    assert.ok(existsSync(join(REPO_ROOT, "dist", "cli-sprint.js")), "sprint command compiled into the artifact");
  });

  it("declares the smallest explicit files boundary", () => {
    const pkg = manifest();
    assert.deepEqual(pkg.files, ["dist"], "only the compiled output whitelisted; README/LICENSE travel via npm's always-included set");
  });

  it("carries real repository metadata and a documented runtime floor", () => {
    const pkg = manifest();
    assert.deepEqual(
      pkg.repository,
      { type: "git", url: "git+https://github.com/moassaad/ai-team-framework.git" },
      "repository mirrors the git remote; never fabricated",
    );
    assert.deepEqual(
      pkg.bugs,
      { url: "https://github.com/moassaad/ai-team-framework/issues" },
      "bugs follows the same repository",
    );
    assert.deepEqual(pkg.engines, { node: ">=18" }, "documented Node floor from docs/installation.md, verified on v18.19.1");
  });

  it("keeps the production dependency boundary exact", () => {
    const pkg = manifest();
    assert.deepEqual(pkg.dependencies, { yaml: "^2.9.1" }, "yaml alone: the only runtime require outside node builtins");
    assert.ok(pkg.devDependencies !== undefined && typeof pkg.devDependencies.typescript === "string", "build tools stay development-only");
    assert.ok(!Object.keys(pkg.devDependencies ?? {}).includes("yaml"), "runtime dependency never duplicated into devDependencies");
    const configLoader = readFileSync(join(REPO_ROOT, "dist", "config", "loader.js"), "utf8");
    assert.ok(/require\("yaml"\)/.test(configLoader), "the artifact actually requires the declared dependency");
  });

  it("adds no publish machinery", () => {
    const pkg = manifest();
    assert.equal(pkg.publishConfig, undefined, "no registry side-effects configured");
    const scripts = Object.entries(pkg.scripts ?? {});
    assert.ok(scripts.length > 0, "existing scripts intact");
    assert.ok(scripts.every(([name, command]) => !/publish/i.test(`${name} ${String(command)}`)), "no publish operation in any script");
  });
});

describe("npm package artifact boundary", () => {
  it("packs exactly the consumer boundary via npm itself", { timeout: 120000 }, () => {
    const workdir = mkdtempSync(join(tmpdir(), "ai-team-pack-"));
    try {
      npm(["pack", "--pack-destination", workdir, "--silent"], REPO_ROOT);
      const tarball = join(workdir, "ai-team-framework-0.1.0.tgz");
      assert.ok(existsSync(tarball), "local tarball produced, registry untouched");
      const listing = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
        .split("\n")
        .filter((line) => line.length > 0);
      const allowed = /^package\/(package\.json|README\.md|LICEN[CS]E|dist\/.+\.js|dist\/.+\.js\.map)$/;
      const unclassified = listing.filter((file) => !allowed.test(file));
      assert.deepEqual(unclassified, [], "every packed path classifies: metadata, README, LICENSE, or compiled dist output");
      for (const required of [
        "package/package.json",
        "package/README.md",
        "package/LICENSE",
        "package/dist/index.js",
        "package/dist/cli.js",
        "package/dist/cli-sprint.js",
        "package/dist/runtime/production-sprint.js",
        "package/dist/runtime/sprint-workflow.js",
        "package/dist/config/loader.js",
        "package/dist/providers/github-issues.js",
      ]) {
        assert.ok(listing.includes(required), `${required} shipped`);
      }
      const denied = ["/src/", "/tests/", "/docs/", "/.git", ".env", "package-lock", "coverage", "dist-test", "ai-team-framework-"];
      for (const fragment of denied) {
        assert.ok(!listing.some((file) => file.includes(fragment)), `excluded: ${fragment}`);
      }
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});

describe("npm installed package invocation", () => {
  it("runs the unpacked artifact with no repository paths", { timeout: 120000 }, () => {
    const workdir = mkdtempSync(join(tmpdir(), "ai-team-install-"));
    try {
      npm(["pack", "--pack-destination", workdir, "--silent"], REPO_ROOT);
      const consumer = join(workdir, "consumer");
      execFileSync("tar", ["-xzf", join(workdir, "ai-team-framework-0.1.0.tgz"), "-C", workdir]);
      execFileSync("mv", [join(workdir, "package"), consumer]);
      assert.ok(!existsSync(join(consumer, "src")), "no source beside the artifact");
      assert.ok(!existsSync(join(consumer, "tests")), "no tests beside the artifact");
      const nodePath = join(REPO_ROOT, "node_modules");
      const run = (args: readonly string[], cwd: string): string =>
        execFileSync("node", [join(consumer, "dist", "index.js"), ...args], {
          cwd,
          encoding: "utf8",
          env: { ...process.env, NODE_PATH: nodePath },
        });
      const help = run(["--help"], workdir);
      assert.ok(help.includes("ai-team sprint"), "installed CLI starts and presents the sprint command");
      const version = run(["--version"], workdir).trim();
      assert.equal(version, "0.1.0", "self-contained version read from the packed package.json, not the repo");
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it("installed CLI rejects bad input without credentials or network", { timeout: 120000 }, () => {
    const workdir = mkdtempSync(join(tmpdir(), "ai-team-install-bad-"));
    try {
      npm(["pack", "--pack-destination", workdir, "--silent"], REPO_ROOT);
      const consumer = join(workdir, "package");
      execFileSync("tar", ["-xzf", join(workdir, "ai-team-framework-0.1.0.tgz"), "-C", workdir]);
      let stderr = "";
      try {
        execFileSync("node", [join(consumer, "dist", "index.js"), "sprint", "--yes"], {
          cwd: workdir,
          encoding: "utf8",
          env: { ...process.env, NODE_PATH: join(REPO_ROOT, "node_modules") },
        });
      } catch (error) {
        assert.equal((error as { status?: unknown }).status, 1, "usage error exits non-success");
        stderr = String((error as { stderr?: unknown }).stderr ?? "");
      }
      assert.ok(stderr.includes("usage: ai-team sprint"), "bounded usage error from the installed artifact");
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
