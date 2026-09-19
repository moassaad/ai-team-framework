import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProjectStack } from "../src/discovery/stack";
import { DiscoveryFinding } from "../src/discovery/contract";

// Stack-detection tests only: temp fixture projects, never this repo.
// Every fixture root is removed after its test.
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "stack-"));
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

function snapshot(root: string): string[] {
  return readdirSync(root)
    .sort()
    .map((entry) => `${entry}:${statSync(join(root, entry)).mtimeMs}`);
}

describe("detectProjectStack", () => {
  it("detects a node/react/express/postgres stack", () => {
    const root = fixture({
      "package.json": JSON.stringify({
        dependencies: { express: "^4.18.2", react: "18.2.0", pg: "8.11.0" },
        devDependencies: { typescript: "~5.2.0" },
      }),
      "tsconfig.json": "{}",
    });
    const findings = detectProjectStack({ root });
    assert.equal(byCategory(findings, "languages").status, "detected");
    assert.equal(byCategory(findings, "languages").value, "javascript, typescript");
    assert.deepEqual(byCategory(findings, "backend_framework"), {
      category: "backend_framework",
      status: "detected",
      value: "express 4.18.2",
      evidence: [{ kind: "manifest", ref: "package.json" }],
    });
    assert.equal(byCategory(findings, "frontend_framework").value, "react 18.2.0");
    assert.equal(byCategory(findings, "database").value, "postgresql 8.11.0");
  });

  it("detects a python/django/postgres stack", () => {
    const root = fixture({
      "requirements.txt": "django==4.2\npsycopg2-binary==2.9.9\n",
    });
    const findings = detectProjectStack({ root });
    assert.equal(byCategory(findings, "languages").value, "python");
    assert.equal(byCategory(findings, "backend_framework").value, "django 4.2");
    assert.equal(byCategory(findings, "frontend_framework").status, "unknown");
    assert.equal(byCategory(findings, "database").value, "postgresql 2.9.9");
  });

  it("detects multiple languages across manifests", () => {
    const root = fixture({
      "package.json": JSON.stringify({ dependencies: { lodash: "4.17.21" } }),
      "requirements.txt": "flask==3.0.0\n",
    });
    const findings = detectProjectStack({ root });
    assert.equal(byCategory(findings, "languages").value, "javascript, python");
    assert.equal(byCategory(findings, "backend_framework").value, "flask 3.0.0");
  });

  it("detects databases from prisma schema and rails config", () => {
    const sqlite = fixture({ "prisma/schema.prisma": 'datasource db {\n  provider = "sqlite"\n}\n' });
    assert.equal(byCategory(detectProjectStack({ root: sqlite }), "database").value, "sqlite");
    const rails = fixture({
      Gemfile: 'gem "rails", "7.1.0"\ngem "pg", "1.5.0"\n',
      "config/database.yml": "production:\n  adapter: postgresql\n",
    });
    const railsFindings = detectProjectStack({ root: rails });
    assert.equal(byCategory(railsFindings, "languages").value, "ruby");
    assert.equal(byCategory(railsFindings, "backend_framework").value, "rails 7.1.0");
    assert.ok((byCategory(railsFindings, "database").value ?? "").includes("postgresql"));
  });

  it("reports unknown when no evidence exists", () => {
    const findings = detectProjectStack({ root: fixture({}) });
    for (const category of ["languages", "backend_framework", "frontend_framework", "database"]) {
      assert.equal(byCategory(findings, category).status, "unknown", category);
    }
  });

  it("reports not_detected when manifests were checked but empty", () => {
    const root = fixture({ "package.json": JSON.stringify({ dependencies: { lodash: "4.17.21" } }) });
    const findings = detectProjectStack({ root });
    assert.equal(byCategory(findings, "languages").status, "detected");
    for (const category of ["backend_framework", "frontend_framework", "database"]) {
      const finding = byCategory(findings, category);
      assert.equal(finding.status, "not_detected", category);
      assert.ok(finding.evidence?.some((entry) => entry.ref === "package.json"), category);
      assert.equal(finding.value, undefined, category);
    }
  });

  it("never exposes sensitive contents and never reads .env", () => {
    const root = fixture({
      "package.json": JSON.stringify({ dependencies: { express: "4.18.2" } }),
      ".env": "PASSWORD=hunter2\nAPI_KEY=sekret\n",
    });
    const dumped = JSON.stringify(detectProjectStack({ root }));
    assert.ok(!dumped.includes("hunter2") && !dumped.includes("sekret"));
    assert.ok(!dumped.includes(".env"));
  });

  it("respects the supplied root and rejects bad roots", () => {
    const node = fixture({ "package.json": JSON.stringify({ dependencies: { express: "4.18.2" } }) });
    const go = fixture({ "go.mod": "module example\n\ngo 1.21\n" });
    assert.equal(byCategory(detectProjectStack({ root: node }), "languages").value, "javascript");
    assert.equal(byCategory(detectProjectStack({ root: go }), "languages").value, "go");
    assert.throws(() => detectProjectStack({ root: join(node, "missing") }), /not a readable directory/);
    const fileRoot = fixture({ "package.json": "{}" });
    assert.throws(
      () => detectProjectStack({ root: join(fileRoot, "package.json") }),
      /not a readable directory/,
    );
  });

  it("is read-only and deterministic", () => {
    const root = fixture({
      "package.json": JSON.stringify({ dependencies: { fastify: "^4.20.0", vue: "^3.3.0" } }),
    });
    const before = snapshot(root);
    const first = detectProjectStack({ root });
    assert.deepEqual(snapshot(root), before);
    assert.deepEqual(detectProjectStack({ root }), first);
    assert.equal(byCategory(first, "backend_framework").value, "fastify 4.20.0");
    assert.equal(byCategory(first, "frontend_framework").value, "vue 3.3.0");
    assert.equal(byCategory(first, "database").status, "not_detected");
  });
});
