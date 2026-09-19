import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateProjectAnalysis } from "../src/discovery/report";
import { ProjectAnalysisReport, ANALYZED_CATEGORIES, UNCOVERED_CATEGORIES } from "../src/discovery/report";
import { DiscoveryFinding, DiscoveryCategory } from "../src/discovery/contract";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "unknown-stack-"));
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

const FORBIDDEN_FRAMEWORKS = [
  "react", "laravel", "vue", "angular", "spring", "django", "flask",
  "rails", "express", "node", "python", "php", "java", "next", "nuxt",
];

describe("Unknown-stack safety (A-009)", () => {
  it("completes successfully on a project with no recognized evidence", () => {
    const root = fixture({
      "README.md": "# Mystery Project\n\nThis project is used for web development with a backend and a frontend.\n",
      "notes.txt": "TODO: decide on framework\n",
      "src/example.txt": "some generic content\n",
      "backend/handler.txt": "backend logic notes\n",
      "frontend/view.txt": "frontend layout notes\n",
      "tests/smoke.txt": "manual test checklist\n",
    });
    const report = generateProjectAnalysis({ root, name: "mystery", kind: "existing" });

    // Valid report structure preserved
    assert.equal(report.project.root, root);
    assert.equal(report.project.name, "mystery");
    assert.equal(report.meta.format, "ai-team-discovery-report");
    assert.equal(report.meta.version, 1);
    assert.equal(report.coverage.totalSpecCategories, 18);
    assert.deepEqual(report.coverage.analyzed, ANALYZED_CATEGORIES);
    assert.deepEqual(report.coverage.uncovered, UNCOVERED_CATEGORIES);

    const byCat = findingsByCategory(report);

    // No stack detection: no recognized manifests
    for (const cat of ["languages", "backend_framework", "frontend_framework", "database"] as const) {
      assert.notEqual(byCat[cat].status, "detected", `${cat} must not be detected`);
      assert.equal(byCat[cat].value, undefined, `${cat} must have no value`);
    }
    // No tool detection
    for (const cat of ["package_managers", "build_tools", "testing_tools"] as const) {
      assert.notEqual(byCat[cat].status, "detected", `${cat} must not be detected`);
    }
    // No convention detection beyond documentation
    for (const cat of ["naming_conventions", "architecture", "git", "technical_constraints"] as const) {
      assert.notEqual(byCat[cat].status, "detected", `${cat} must not be detected`);
      assert.equal(byCat[cat].status, "unknown", `${cat} must be unknown, not not_detected`);
    }

    // Documentation IS detected — unknown stack does not mean absent findings
    assert.equal(byCat.documentation.status, "detected");
    assert.ok(byCat.documentation.value?.includes("readme"));
  });

  it("never invents a framework, language, or tool from suggestive text or directory names", () => {
    const root = fixture({
      "README.md": "# Web App\n\nBuilt with a modern backend and frontend. Uses React-like components and Laravel-style routing.\n",
      "backend/server.txt": "node python java\n",
      "frontend/app.txt": "vue angular svelte\n",
      "src/": "",
    });
    const report = generateProjectAnalysis({ root });
    const dumped = JSON.stringify(report.findings).toLowerCase();
    for (const name of FORBIDDEN_FRAMEWORKS) {
      const hits = report.findings.filter(
        (f) => f.status === "detected" && (f.value ?? "").toLowerCase().includes(name),
      );
      assert.equal(hits.length, 0, `must not detect "${name}" from prose/directory names`);
    }
    assert.ok(!dumped.includes('"architecture":{"category":"architecture","status":"detected"'));
  });

  it("supports a mixed-evidence project: docs + naming detected, stack honestly unknown", () => {
    const root = fixture({
      "README.md": "# Notes\n",
      ".editorconfig": "root = true\n",
    });
    const report = generateProjectAnalysis({ root });
    const byCat = findingsByCategory(report);
    assert.equal(byCat.documentation.status, "detected");
    assert.equal(byCat.naming_conventions.status, "detected");
    assert.equal(byCat.languages.status, "unknown");
    assert.equal(byCat.backend_framework.status, "unknown");
    assert.equal(byCat.frontend_framework.status, "unknown");
    assert.equal(byCat.database.status, "unknown");
    assert.equal(byCat.package_managers.status, "unknown");
    assert.equal(byCat.build_tools.status, "unknown");
    assert.equal(byCat.testing_tools.status, "unknown");
  });

  it("unknown and not_detected remain distinct", () => {
    const empty = generateProjectAnalysis({ root: fixture({}) });
    const assessed = generateProjectAnalysis({
      root: fixture({ "package.json": JSON.stringify({ dependencies: { lodash: "4.17.21" } }) }),
    });
    const emptyByCat = findingsByCategory(empty);
    const assessedByCat = findingsByCategory(assessed);
    // Empty project: nothing assessed → unknown
    assert.equal(emptyByCat.backend_framework.status, "unknown");
    assert.equal(emptyByCat.testing_tools.status, "unknown");
    // Manifest assessed but empty → not_detected
    assert.equal(assessedByCat.backend_framework.status, "not_detected");
    assert.equal(assessedByCat.testing_tools.status, "not_detected");
  });

  it("uses no host-environment probing, subprocesses, or network", async () => {
    const fs = await import("node:fs/promises");
    for (const mod of ["stack", "tools", "testing", "conventions", "report"]) {
      const code = await fs.readFile(join(__dirname, "..", "..", "src", "discovery", `${mod}.ts`), "utf8");
      assert.ok(!/child_process|execSync|execFile|spawnSync|spawn\(|fetch\(|http:|https:|process\.env|process\.version/.test(code), mod);
    }
  });

  it("is deterministic, immutable, and timestamp-free", () => {
    const root = fixture({ "README.md": "# X\n", "notes.txt": "hi\n" });
    const r1 = generateProjectAnalysis({ root });
    const r2 = generateProjectAnalysis({ root });
    assert.deepEqual(r1, r2);
    assert.ok(Object.isFrozen(r1));
    assert.ok(!/timestamp|uuid|random/i.test(JSON.stringify(r1)));
    const ctx = { root };
    generateProjectAnalysis(ctx);
    assert.deepEqual(ctx, { root });
  });

  it("no secrets in fixture or report", () => {
    const root = fixture({ "README.md": "# X\n" });
    const dumped = JSON.stringify(generateProjectAnalysis({ root }));
    assert.ok(!dumped.includes(".env"));
    assert.ok(!/password|api[_-]?key|secret|token|private[_-]?key/i.test(dumped));
  });
});