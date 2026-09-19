import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProjectTools } from "../src/discovery/tools";
import { DiscoveryFinding } from "../src/discovery/contract";

// Tool-detection tests only: temp fixture projects, never this repo.
// Every fixture root is removed after its test.
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "tools-"));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

function byCategory(findings: DiscoveryFinding[], category: string): DiscoveryFinding {
  const finding = findings.find((entry) => entry.category === category);
  assert.ok(finding, `expected a ${category} finding`);
  return finding;
}

function managers(root: string): DiscoveryFinding {
  return byCategory(detectProjectTools({ root }), "package_managers");
}

function tools(root: string): DiscoveryFinding {
  return byCategory(detectProjectTools({ root }), "build_tools");
}

describe("detectProjectTools", () => {
  it("detects npm/yarn/pnpm/bun from lockfiles", () => {
    const npm = fixture({ "package.json": "{}", "package-lock.json": "{}" });
    assert.deepEqual(managers(npm), {
      category: "package_managers",
      status: "detected",
      value: "npm",
      evidence: [{ kind: "manifest", ref: "package-lock.json" }],
    });
    assert.equal(managers(fixture({ "package.json": "{}", "yarn.lock": "" })).value, "yarn");
    assert.equal(managers(fixture({ "package.json": "{}", "pnpm-lock.yaml": "" })).value, "pnpm");
    assert.equal(managers(fixture({ "package.json": "{}", "bun.lockb": "" })).value, "bun");
  });

  it("detects composer from lockfile or manifest, poetry/uv from lockfiles", () => {
    assert.equal(managers(fixture({ "composer.json": "{}", "composer.lock": "{}" })).value, "composer");
    assert.equal(managers(fixture({ "composer.json": "{}" })).value, "composer");
    assert.equal(managers(fixture({ "pyproject.toml": "", "poetry.lock": "" })).value, "poetry");
    assert.equal(managers(fixture({ "requirements.txt": "", "uv.lock": "" })).value, "uv");
    assert.equal(
      managers(fixture({ "package.json": JSON.stringify({ packageManager: "pnpm@9.1.0" }) })).value,
      "pnpm 9.1.0",
    );
  });

  it("detects single-manager ecosystems and maven/gradle overlap", () => {
    assert.equal(managers(fixture({ "go.mod": "module example\n" })).value, "go modules");
    assert.equal(managers(fixture({ "Cargo.toml": "[package]\n" })).value, "cargo");
    assert.equal(managers(fixture({ Gemfile: 'source "https://rubygems.org"\n' })).value, "bundler");
    const maven = fixture({ "pom.xml": "<project></project>" });
    assert.equal(managers(maven).value, "maven");
    assert.equal(tools(maven).value, "maven");
    const gradle = fixture({ "build.gradle.kts": 'plugins { id("java") }\n' });
    assert.equal(managers(gradle).value, "gradle");
    assert.equal(tools(gradle).value, "gradle");
  });

  it("detects build tools from explicit configs and package scripts", () => {
    assert.equal(tools(fixture({ "package.json": "{}", "vite.config.ts": "" })).value, "vite");
    assert.equal(tools(fixture({ "package.json": "{}", "webpack.config.js": "" })).value, "webpack");
    assert.equal(tools(fixture({ Makefile: "all:\n" })).value, "make");
    assert.equal(tools(fixture({ "CMakeLists.txt": "" })).value, "cmake");
    assert.equal(tools(fixture({ "Cargo.toml": "[package]\n" })).value, "cargo");
    const scripts = fixture({
      "package.json": JSON.stringify({ scripts: { build: "vite build", test: "echo ok" } }),
    });
    assert.deepEqual(tools(scripts), {
      category: "build_tools",
      status: "detected",
      value: "vite",
      evidence: [{ kind: "manifest", ref: "package.json", note: 'script "build"' }],
    });
  });

  it("detects multiple managers and tools where legitimately evidenced", () => {
    const root = fixture({
      "package.json": "{}",
      "package-lock.json": "{}",
      "yarn.lock": "",
      Makefile: "all:\n",
      "CMakeLists.txt": "",
    });
    assert.equal(managers(root).value, "npm, yarn");
    assert.equal(tools(root).value, "make, cmake");
  });

  it("reports unknown when no relevant files exist", () => {
    const root = fixture({});
    assert.equal(managers(root).status, "unknown");
    assert.equal(tools(root).status, "unknown");
    assert.equal(managers(root).evidence, undefined);
  });

  it("reports not_detected when the project was assessed but empty", () => {
    const root = fixture({ "package.json": JSON.stringify({ dependencies: { lodash: "4.17.21" } }) });
    for (const finding of [managers(root), tools(root)]) {
      assert.equal(finding.status, "not_detected");
      assert.equal(finding.value, undefined);
      assert.ok(finding.evidence?.some((entry) => entry.kind === "manifest" && entry.ref === "package.json"));
    }
    const ambiguous = fixture({ "requirements.txt": "requests==2.0\n" });
    assert.equal(managers(ambiguous).status, "not_detected");
  });

  it("never names a manager from ambiguous manifests alone", () => {
    assert.equal(managers(fixture({ "package.json": "{}" })).status, "not_detected");
    assert.equal(managers(fixture({ "pyproject.toml": "" })).status, "not_detected");
  });

  it("never exposes secrets and keeps evidence to path references", () => {
    const root = fixture({
      "package.json": "{}",
      "package-lock.json": "{}",
      ".env": "PASSWORD=hunter2\nAPI_KEY=sekret\n",
    });
    const dumped = JSON.stringify(detectProjectTools({ root }));
    assert.ok(!dumped.includes("hunter2") && !dumped.includes("sekret") && !dumped.includes(".env"));
    for (const finding of detectProjectTools({ root })) {
      for (const entry of finding.evidence ?? []) {
        assert.ok(!entry.ref.includes("/") || !entry.ref.startsWith("/"));
        assert.ok(!entry.ref.includes(".."));
      }
    }
  });

  it("is read-only, deterministic, and root-safe", () => {
    const root = fixture({ "package.json": "{}", "yarn.lock": "", Makefile: "all:\n" });
    const before = readdirSync(root)
      .sort()
      .map((entry) => `${entry}:${statSync(join(root, entry)).mtimeMs}`);
    const first = detectProjectTools({ root });
    assert.deepEqual(
      readdirSync(root)
        .sort()
        .map((entry) => `${entry}:${statSync(join(root, entry)).mtimeMs}`),
      before,
    );
    assert.deepEqual(detectProjectTools({ root }), first);
    const other = fixture({ "pom.xml": "<project></project>" });
    assert.notDeepEqual(detectProjectTools({ root }), detectProjectTools({ root: other }));
    assert.throws(() => detectProjectTools({ root: join(root, "missing") }), /not a readable directory/);
  });
});
