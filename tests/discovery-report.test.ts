import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateProjectAnalysis } from "../src/discovery/report";
import { ProjectAnalysisReport, ANALYZED_CATEGORIES, UNCOVERED_CATEGORIES, ALL_SPEC_CATEGORIES } from "../src/discovery/report";
import { DiscoveryFinding, DiscoveryCategory } from "../src/discovery/contract";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "report-"));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel);
    if (rel.endsWith("/")) {
      mkdirSync(path, { recursive: true });
    } else {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, content);
    }
  }
  return root;
}

function findingsByCategory(report: ProjectAnalysisReport): Record<DiscoveryCategory, DiscoveryFinding> {
  const map: Record<string, DiscoveryFinding> = {};
  for (const f of report.findings) {
    map[f.category] = f;
  }
  return map as Record<DiscoveryCategory, DiscoveryFinding>;
}

describe("generateProjectAnalysis", () => {
  it("produces a report with project context preserved", () => {
    const root = fixture({ "package.json": "{}" });
    const report = generateProjectAnalysis({ root, name: "test-project", kind: "existing" });
    assert.equal(report.project.root, root);
    assert.equal(report.project.name, "test-project");
    assert.equal(report.project.kind, "existing");
  });

  it("includes A-002 stack findings (languages, backend_framework, frontend_framework, database)", () => {
    const root = fixture({
      "package.json": JSON.stringify({ dependencies: { express: "^4.18.2", pg: "8.11.0" } }),
      "tsconfig.json": "{}",
    });
    const report = generateProjectAnalysis({ root });
    const byCat = findingsByCategory(report);
    assert.equal(byCat.languages.category, "languages");
    assert.equal(byCat.languages.status, "detected");
    assert.ok(byCat.languages.value?.includes("typescript"));
    assert.equal(byCat.backend_framework.category, "backend_framework");
    assert.equal(byCat.backend_framework.status, "detected");
    assert.ok(byCat.backend_framework.value?.includes("express"));
    assert.equal(byCat.database.category, "database");
    assert.equal(byCat.database.status, "detected");
    assert.ok(byCat.database.value?.includes("postgresql"));
  });

  it("includes A-003 tools findings (package_managers, build_tools)", () => {
    const root = fixture({
      "package.json": JSON.stringify({ scripts: { build: "vite build" } }),
      "package-lock.json": "{}",
      "vite.config.ts": "",
    });
    const report = generateProjectAnalysis({ root });
    const byCat = findingsByCategory(report);
    assert.equal(byCat.package_managers.status, "detected");
    assert.ok(byCat.package_managers.value?.includes("npm"));
    assert.equal(byCat.build_tools.status, "detected");
    assert.ok(byCat.build_tools.value?.includes("vite"));
  });

  it("includes A-004 testing findings (testing_tools)", () => {
    const root = fixture({
      "package.json": JSON.stringify({ devDependencies: { vitest: "^1.0.0" } }),
      "vitest.config.ts": "",
    });
    const report = generateProjectAnalysis({ root });
    const byCat = findingsByCategory(report);
    assert.equal(byCat.testing_tools.category, "testing_tools");
    assert.equal(byCat.testing_tools.status, "detected");
    assert.ok(byCat.testing_tools.value?.includes("vitest"));
  });

  it("includes A-005 conventions findings (naming_conventions, architecture, documentation, git, technical_constraints)", () => {
    const root = fixture({
      ".editorconfig": "root = true\n",
      "README.md": "# Project",
      ".gitignore": "node_modules\n",
      "Dockerfile": "FROM node:20\n",
      "ARCHITECTURE.md": "Clean architecture\n",
    });
    const report = generateProjectAnalysis({ root });
    const byCat = findingsByCategory(report);
    assert.equal(byCat.naming_conventions.status, "detected");
    assert.ok(byCat.naming_conventions.value?.includes("editorconfig"));
    assert.equal(byCat.architecture.status, "detected");
    assert.ok(byCat.architecture.value?.includes("clean"));
    assert.equal(byCat.documentation.status, "detected");
    assert.ok(byCat.documentation.value?.includes("readme"));
    assert.equal(byCat.git.status, "detected");
    assert.ok(byCat.git.value?.includes("gitignore"));
    assert.equal(byCat.technical_constraints.status, "detected");
    assert.ok(byCat.technical_constraints.value?.includes("docker"));
  });

  it("findings remain validated (frozen, contract-compliant)", () => {
    const root = fixture({ "package.json": "{}", "package-lock.json": "{}" });
    const report = generateProjectAnalysis({ root });
    for (const finding of report.findings) {
      assert.ok(Object.isFrozen(finding));
      assert.ok(["detected", "not_detected", "unknown"].includes(finding.status));
      if (finding.evidence) {
        for (const e of finding.evidence) {
          assert.ok(["file", "directory", "manifest", "command_output"].includes(e.kind));
          assert.ok(typeof e.ref === "string" && e.ref.length > 0);
        }
      }
    }
  });

  it("duplicate evidence paths across categories are preserved (not deduplicated by path)", () => {
    // package.json and pom.xml appear in multiple detector categories
    const root = fixture({
      "package.json": JSON.stringify({ dependencies: { express: "4.18.2" } }),
      "package-lock.json": "{}",
      "pom.xml": "<project></project>",
    });
    const report = generateProjectAnalysis({ root });
    const byCat = findingsByCategory(report);
    // package.json should appear as evidence in languages, backend_framework, package_managers, etc.
    const langs = byCat.languages.evidence?.map((e) => e.ref) ?? [];
    const backend = byCat.backend_framework.evidence?.map((e) => e.ref) ?? [];
    const pkgMgr = byCat.package_managers.evidence?.map((e) => e.ref) ?? [];
    assert.ok(langs.includes("package.json"));
    assert.ok(backend.includes("package.json"));
    assert.ok(pkgMgr.includes("package-lock.json"));
    // pom.xml appears in languages, backend_framework, build_tools
    const buildTools = byCat.build_tools.evidence?.map((e) => e.ref) ?? [];
    assert.ok(langs.includes("pom.xml"));
    assert.ok(buildTools.includes("pom.xml"));
  });

  it("stable category ordering per DISCOVERY_CATEGORIES", () => {
    const root = fixture({ "package.json": "{}" });
    const report = generateProjectAnalysis({ root });
    const categories = report.findings.map((f) => f.category);
    const expectedOrder = [
      "languages",
      "backend_framework",
      "frontend_framework",
      "database",
      "package_managers",
      "build_tools",
      "testing_tools",
      "ci_cd",
      "containers",
      "git",
      "naming_conventions",
      "architecture",
      "documentation",
      "development_commands",
      "existing_issues",
      "entry_points",
      "technical_constraints",
      "sensitive_files",
    ];
    // Only categories that have findings will appear; verify they follow the order
    const seen = new Set<DiscoveryCategory>();
    for (const cat of categories) {
      assert.ok(!seen.has(cat), `duplicate category ${cat}`);
      seen.add(cat);
    }
    let lastIdx = -1;
    for (const cat of categories) {
      const idx = expectedOrder.indexOf(cat);
      assert.ok(idx >= lastIdx, `ordering violated: ${cat} after ${expectedOrder[lastIdx]}`);
      lastIdx = idx;
    }
  });

  it("deterministic repeated reports", () => {
    const root = fixture({
      "package.json": JSON.stringify({ dependencies: { express: "4.18.2" } }),
      "package-lock.json": "{}",
      "tsconfig.json": "{}",
      ".editorconfig": "root = true\n",
      "README.md": "# X",
    });
    const r1 = generateProjectAnalysis({ root });
    const r2 = generateProjectAnalysis({ root });
    assert.deepEqual(r1, r2);
  });

  it("no timestamps, random IDs, or machine-specific metadata in report", () => {
    const root = fixture({ "package.json": "{}" });
    const report = generateProjectAnalysis({ root });
    const dumped = JSON.stringify(report);
    assert.ok(!/timestamp|uuid|random|process\.|hostname|os\./i.test(dumped));
    assert.equal(report.meta.format, "ai-team-discovery-report");
    assert.equal(report.meta.version, 1);
  });

  it("does not mutate input context or detector findings", () => {
    const root = fixture({ "package.json": "{}" });
    const ctx = { root, name: "orig" };
    const ctxCopy = { ...ctx };
    generateProjectAnalysis(ctx);
    assert.deepEqual(ctx, ctxCopy);
    // Findings are frozen by detectors
    const report = generateProjectAnalysis({ root });
    for (const f of report.findings) {
      assert.ok(Object.isFrozen(f));
    }
  });

  it("sensitive flags/metadata are preserved without secret contents", () => {
    const root = fixture({
      "package.json": JSON.stringify({ dependencies: { express: "4.18.2" } }),
      ".env": "PASSWORD=hunter2\n",
    });
    const report = generateProjectAnalysis({ root });
    const dumped = JSON.stringify(report);
    assert.ok(!dumped.includes("hunter2"));
    assert.ok(!dumped.includes(".env"));
    // Sensitive flag would be preserved if any detector set it
    for (const f of report.findings) {
      if (f.sensitive) {
        assert.equal(typeof f.sensitive, "boolean");
      }
    }
  });

  it("invalid project context follows existing error behavior", () => {
    assert.throws(
      () => generateProjectAnalysis({ root: join(tmpdir(), "does-not-exist") }),
      /not a readable directory/,
    );
    const fileRoot = fixture({ "package.json": "{}" });
    assert.throws(
      () => generateProjectAnalysis({ root: join(fileRoot, "package.json") }),
      /not a readable directory/,
    );
  });

  it("report clearly identifies currently covered categories", () => {
    const root = fixture({ "package.json": "{}" });
    const report = generateProjectAnalysis({ root });
    assert.deepEqual(report.coverage.analyzed, ANALYZED_CATEGORIES);
    assert.equal(report.coverage.totalSpecCategories, ALL_SPEC_CATEGORIES.length);
    assert.ok(report.coverage.analyzed.length > 0);
    assert.ok(report.coverage.uncovered.length > 0);
  });

  it("does NOT falsely claim unchecked categories were detected/unknown", () => {
    // Uncovered categories should NOT appear in findings at all
    const root = fixture({ "package.json": "{}" });
    const report = generateProjectAnalysis({ root });
    const findingCategories = report.findings.map((f) => f.category);
    for (const cat of UNCOVERED_CATEGORIES) {
      assert.ok(!findingCategories.includes(cat), `uncovered category ${cat} should not appear in findings`);
    }
    // But they should be listed in coverage.uncovered
    for (const cat of UNCOVERED_CATEGORIES) {
      assert.ok(report.coverage.uncovered.includes(cat), `uncovered category ${cat} should be in coverage.uncovered`);
    }
  });

  it("missing future detectors do not trigger invented detection behavior", () => {
    const root = fixture({ "package.json": "{}" });
    const report = generateProjectAnalysis({ root });
    // No findings for ci_cd, containers, development_commands, existing_issues, entry_points, sensitive_files
    const cats = report.findings.map((f) => f.category);
    for (const cat of ["ci_cd", "containers", "development_commands", "existing_issues", "entry_points", "sensitive_files"]) {
      assert.ok(!cats.includes(cat as DiscoveryCategory));
    }
  });

  it("A-001 through A-005 tests remain green (integration sanity)", () => {
    const root = fixture({
      "package.json": JSON.stringify({ dependencies: { express: "4.18.2" } }),
      "package-lock.json": "{}",
      "tsconfig.json": "{}",
      "vitest.config.ts": "",
      ".editorconfig": "root = true\n",
      "README.md": "# X",
    });
    const report = generateProjectAnalysis({ root });
    // Should have findings from all four detectors
    const cats = report.findings.map((f) => f.category);
    assert.ok(cats.includes("languages"));
    assert.ok(cats.includes("backend_framework"));
    assert.ok(cats.includes("package_managers"));
    assert.ok(cats.includes("build_tools"));
    assert.ok(cats.includes("testing_tools"));
    assert.ok(cats.includes("naming_conventions"));
    assert.ok(cats.includes("documentation"));
  });

  it("report module introduces no new filesystem/process/network I/O", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "discovery", "report.ts"), "utf8");
    assert.ok(!/readFileSync|writeFileSync|statSync|mkdirSync|readdirSync|child_process|execSync|spawn|fetch\(|http:|https:/.test(code));
  });

  it("project-agnostic: works with multi-ecosystem fixture", () => {
    const root = fixture({
      "package.json": JSON.stringify({
        dependencies: { fastify: "^4.0.0", pg: "8.11.0" },
        devDependencies: { typescript: "~5.0.0", vitest: "^1.0.0" },
        scripts: { test: "vitest run", build: "tsc" },
      }),
      "package-lock.json": "{}",
      "tsconfig.json": "{}",
      "vite.config.ts": "",
      "vitest.config.ts": "",
      "composer.json": JSON.stringify({ require: { "laravel/framework": "^10.0" } }),
      "composer.lock": "{}",
      ".editorconfig": "root = true\n",
      "README.md": "# Multi Project",
      ".gitignore": "vendor/\nnode_modules/\n",
      "Dockerfile": "FROM php:8.2\n",
    });
    const report = generateProjectAnalysis({ root, name: "multi", kind: "existing" });
    const byCat = findingsByCategory(report);
    // Stack
    assert.ok(byCat.languages.value?.includes("typescript"));
    assert.ok(byCat.backend_framework.value?.includes("fastify"));
    assert.ok(byCat.database.value?.includes("postgresql"));
    // Tools
    assert.ok(byCat.package_managers.value?.includes("npm"));
    assert.ok(byCat.package_managers.value?.includes("composer"));
    assert.ok(byCat.build_tools.value?.includes("vite"));
    assert.ok(byCat.build_tools.value?.includes("tsc"));
    // Testing
    assert.ok(byCat.testing_tools.value?.includes("vitest"));
    // Conventions
    assert.ok(byCat.naming_conventions.value?.includes("editorconfig"));
    assert.ok(byCat.documentation.value?.includes("readme"));
    assert.ok(byCat.git.value?.includes("gitignore"));
    assert.ok(byCat.technical_constraints.value?.includes("docker"));
  });
});