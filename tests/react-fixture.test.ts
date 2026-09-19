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
  const root = mkdtempSync(join(tmpdir(), "react-fixture-"));
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

describe("React-shaped project fixture (A-008 example)", () => {
  it("analyzes a conventional React-shaped project using generic detectors", () => {
    const root = fixture({
      "package.json": JSON.stringify({
        name: "example-react-app",
        version: "0.1.0",
        private: true,
        type: "module",
        dependencies: {
          react: "^18.2.0",
          "react-dom": "^18.2.0",
        },
        devDependencies: {
          typescript: "~5.2.0",
          vite: "^5.0.0",
          vitest: "^1.0.0",
          "@vitejs/plugin-react": "^4.2.0",
        },
      }),
      "package-lock.json": "{}",
      "tsconfig.json": '{ "compilerOptions": { "target": "ES2022", "jsx": "react-jsx" } }',
      "vite.config.ts": "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({ plugins: [react()] });\n",
      "vitest.config.ts": "import { defineConfig } from 'vitest/config';\n\nexport default defineConfig({ test: { environment: 'jsdom' } });\n",
      "src/App.tsx": "export default function App() { return <h1>Hello</h1>; }\n",
      "README.md": "# React Application\n\nA sample React project for discovery testing.\n",
      ".editorconfig": "root = true\n\n[*.{js,jsx,ts,tsx}]\nindent_style = space\nindent_size = 2\n",
      ".gitignore": "node_modules/\ndist/\n.env\n",
      ".gitattributes": "* text=auto\n",
      ".env.example": "VITE_API_URL=http://localhost:3000\nVITE_APP_NAME=example\n",
    });

    const report = generateProjectAnalysis({ root, name: "react-app", kind: "existing" });

    // Project context preserved
    assert.equal(report.project.root, root);
    assert.equal(report.project.name, "react-app");
    assert.equal(report.project.kind, "existing");

    const byCat = findingsByCategory(report);

    // languages: JavaScript + TypeScript from package.json + tsconfig.json
    assert.equal(byCat.languages.category, "languages");
    assert.equal(byCat.languages.status, "detected");
    assert.ok(byCat.languages.value?.includes("javascript"), "JavaScript should be detected");
    assert.ok(byCat.languages.value?.includes("typescript"), "TypeScript should be detected");

    // frontend_framework: React detected from package.json dependencies
    assert.equal(byCat.frontend_framework.category, "frontend_framework");
    assert.equal(byCat.frontend_framework.status, "detected");
    assert.ok(byCat.frontend_framework.value?.includes("react"), "React should be detected");

    // backend_framework: not_detected (package.json checked, no backend deps)
    assert.equal(byCat.backend_framework.category, "backend_framework");
    assert.equal(byCat.backend_framework.status, "not_detected");

    // database: not_detected (package.json checked, no database deps)
    assert.equal(byCat.database.category, "database");
    assert.equal(byCat.database.status, "not_detected");

    // package_managers: npm detected from package-lock.json
    assert.equal(byCat.package_managers.category, "package_managers");
    assert.equal(byCat.package_managers.status, "detected");
    assert.ok(byCat.package_managers.value?.includes("npm"), "npm should be detected");

    // build_tools: vite detected from vite.config.ts
    assert.equal(byCat.build_tools.category, "build_tools");
    assert.equal(byCat.build_tools.status, "detected");
    assert.ok(byCat.build_tools.value?.includes("vite"), "Vite should be detected");

    // testing_tools: vitest detected from vitest.config.ts and devDependency
    assert.equal(byCat.testing_tools.category, "testing_tools");
    assert.equal(byCat.testing_tools.status, "detected");
    assert.ok(byCat.testing_tools.value?.includes("vitest"), "Vitest should be detected");

    // documentation: README.md present
    assert.equal(byCat.documentation.category, "documentation");
    assert.equal(byCat.documentation.status, "detected");
    assert.ok(byCat.documentation.value?.includes("readme"), "README should be detected");

    // naming_conventions: .editorconfig present
    assert.equal(byCat.naming_conventions.category, "naming_conventions");
    assert.equal(byCat.naming_conventions.status, "detected");
    assert.ok(byCat.naming_conventions.value?.includes("editorconfig"), ".editorconfig should be detected");

    // git: .gitignore and .gitattributes present
    assert.equal(byCat.git.category, "git");
    assert.equal(byCat.git.status, "detected");
    const gitValue = byCat.git.value ?? "";
    assert.ok(gitValue.includes("gitignore"), ".gitignore should be detected");
    assert.ok(gitValue.includes("gitattributes"), ".gitattributes should be detected");

    // architecture: unknown (no ARCHITECTURE.md)
    assert.equal(byCat.architecture.category, "architecture");
    assert.equal(byCat.architecture.status, "unknown");

    // technical_constraints: unknown (no version/docker constraint files)
    assert.equal(byCat.technical_constraints.category, "technical_constraints");
    assert.equal(byCat.technical_constraints.status, "unknown");

    // Coverage: analyzed categories present, uncovered listed explicitly
    assert.deepEqual(report.coverage.analyzed, ANALYZED_CATEGORIES);
    assert.deepEqual(report.coverage.uncovered, UNCOVERED_CATEGORIES);
    assert.equal(report.coverage.totalSpecCategories, 18);

    // No React-specific synthetic findings exist
    const allCategories = report.findings.map((f) => f.category);
    for (const cat of allCategories) {
      assert.ok(ANALYZED_CATEGORIES.includes(cat) || UNCOVERED_CATEGORIES.includes(cat), `unexpected category ${cat}`);
    }
    assert.ok(!allCategories.some((c) => c.includes("react")), "no React-specific category");

    // Evidence points to expected fixture files
    const evidenceRefs = new Set<string>();
    for (const f of report.findings) {
      for (const e of f.evidence ?? []) {
        evidenceRefs.add(e.ref);
      }
    }
    assert.ok(evidenceRefs.has("package.json"), "package.json should be in evidence");
    assert.ok(evidenceRefs.has("package-lock.json"), "package-lock.json should be in evidence");
    assert.ok(evidenceRefs.has("tsconfig.json"), "tsconfig.json should be in evidence");
    assert.ok(evidenceRefs.has("vite.config.ts"), "vite.config.ts should be in evidence");
    assert.ok(evidenceRefs.has("vitest.config.ts"), "vitest.config.ts should be in evidence");
    assert.ok(evidenceRefs.has("README.md"), "README.md should be in evidence");
    assert.ok(evidenceRefs.has(".editorconfig"), ".editorconfig should be in evidence");
    assert.ok(evidenceRefs.has(".gitignore"), ".gitignore should be in evidence");
    assert.ok(evidenceRefs.has(".gitattributes"), ".gitattributes should be in evidence");

    // No .env contents exposed (only .env.example present, not read)
    const dumped = JSON.stringify(report);
    assert.ok(!dumped.includes("VITE_API_URL"), "no env values exposed");
    assert.ok(!dumped.includes("localhost:3000"), "no env values exposed");
  });

  it("report is deterministic across repeated runs", () => {
    const root = fixture({
      "package.json": JSON.stringify({ dependencies: { react: "^18.2.0" } }),
      "package-lock.json": "{}",
      "vite.config.ts": "",
      "README.md": "# X\n",
    });
    const r1 = generateProjectAnalysis({ root });
    const r2 = generateProjectAnalysis({ root });
    assert.deepEqual(r1, r2);
  });

  it("does not require npm, build, test, database, or network", () => {
    const root = fixture({ "package.json": "{}" });
    assert.doesNotThrow(() => generateProjectAnalysis({ root }));
  });

  it("no secrets in fixture", () => {
    const root = fixture({
      "package.json": "{}",
      ".env.example": "VITE_API_KEY=\nVITE_SECRET=\n",
    });
    const report = generateProjectAnalysis({ root });
    const dumped = JSON.stringify(report);
    assert.ok(!dumped.includes("VITE_API_KEY="));
    assert.ok(!dumped.includes("VITE_SECRET"));
  });
});