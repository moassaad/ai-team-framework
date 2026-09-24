import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  DiscoveryFinding,
  DISCOVERY_CATEGORIES,
} from "../src/discovery/contract";
import { detectProjectStack } from "../src/discovery/stack";
import {
  ANALYZED_CATEGORIES,
  UNCOVERED_CATEGORIES,
  generateProjectAnalysis,
} from "../src/discovery/report";
import { withTempProject } from "./helpers/temp-project";

// Discovery robustness tests (T-006): gaps beyond the per-detector
// suites — malformed manifests, multi-ecosystem agnosticism,
// provider-less database evidence, the exact uncovered set, and
// empty-project report integrity. Hermetic temp fixtures only;
// nothing is executed, contacted, or mutated.
function byCategory(findings: readonly DiscoveryFinding[], category: string): DiscoveryFinding {
  const found = findings.find((finding) => finding.category === category);
  assert.ok(found, `missing finding for ${category}`);
  return found;
}

function snapshot(root: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        entries[path.relative(root, full)] = fs.readFileSync(full, "utf8");
      }
    }
  };
  walk(root);
  return entries;
}

describe("discovery robustness contract", () => {
  it("survives malformed manifests without crashing or fabricating", () => {
    withTempProject({ "package.json": "{not valid json" }, (root) => {
      const findings = detectProjectStack({ root });
      assert.equal(byCategory(findings, "languages").value, "javascript");
      for (const category of ["backend_framework", "frontend_framework", "database"]) {
        const finding = byCategory(findings, category);
        assert.equal(finding.status, "not_detected", category);
        assert.equal(finding.value, undefined, category);
        assert.ok(
          finding.evidence?.some((entry) => entry.ref === "package.json"),
          category,
        );
      }
    });
    withTempProject({ "composer.json": "[broken" }, (root) => {
      const findings = detectProjectStack({ root });
      assert.equal(byCategory(findings, "languages").value, "php");
      assert.equal(byCategory(findings, "backend_framework").status, "not_detected");
      assert.equal(byCategory(findings, "frontend_framework").status, "unknown");
    });
    withTempProject(
      { "requirements.txt": "@@@\n# just a comment\n\ndjango==4.2\n" },
      (root) => {
        const findings = detectProjectStack({ root });
        assert.equal(byCategory(findings, "languages").value, "python");
        assert.equal(byCategory(findings, "backend_framework").value, "django 4.2");
      },
    );
  });

  it("aggregates go, rust, and java ecosystems without forcing a stack", () => {
    withTempProject(
      {
        "go.mod": "module example\n\ngo 1.21\n",
        "Cargo.toml": '[package]\nname = "x"\n\n[dependencies]\naxum = "0.7"\n',
        "pom.xml":
          "<project><dependencies><dependency><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>",
      },
      (root) => {
        const before = snapshot(root);
        const findings = detectProjectStack({ root });
        assert.equal(byCategory(findings, "languages").value, "go, rust, java");
        assert.equal(byCategory(findings, "backend_framework").value, "axum 0.7, spring boot");
        assert.equal(byCategory(findings, "frontend_framework").status, "unknown");
        assert.deepEqual(snapshot(root), before);
      },
    );
  });

  it("reports assessed-but-unmatched database evidence as not_detected", () => {
    withTempProject(
      { "prisma/schema.prisma": 'datasource db {\n  url = "file:./dev.db"\n}\n' },
      (root) => {
        const finding = byCategory(detectProjectStack({ root }), "database");
        assert.equal(finding.status, "not_detected");
        assert.equal(finding.value, undefined);
        assert.ok(
          finding.evidence?.some((entry) => entry.ref === "prisma/schema.prisma"),
        );
      },
    );
    withTempProject(
      { "config/database.yml": "production:\n  host: localhost\n" },
      (root) => {
        const finding = byCategory(detectProjectStack({ root }), "database");
        assert.equal(finding.status, "not_detected");
        assert.equal(finding.value, undefined);
      },
    );
  });

  it("pins the exact uncovered category set", () => {
    assert.deepEqual([...UNCOVERED_CATEGORIES].sort(), [
      "ci_cd",
      "containers",
      "development_commands",
      "entry_points",
      "existing_issues",
      "sensitive_files",
    ]);
    assert.equal(
      ANALYZED_CATEGORIES.length + UNCOVERED_CATEGORIES.length,
      DISCOVERY_CATEGORIES.length,
    );
  });

  it("reports an empty project with all-unknown findings and stable metadata", () => {
    withTempProject({}, (root) => {
      const before = snapshot(root);
      const report = generateProjectAnalysis({ root });
      assert.equal(report.findings.length, ANALYZED_CATEGORIES.length);
      for (const finding of report.findings) {
        assert.equal(finding.status, "unknown", finding.category);
        assert.equal(finding.value, undefined, finding.category);
      }
      assert.deepEqual(report.meta, { format: "ai-team-discovery-report", version: 1 });
      assert.equal(report.coverage.totalSpecCategories, DISCOVERY_CATEGORIES.length);
      assert.deepEqual(report.project, { root });
      assert.deepEqual(
        generateProjectAnalysis({ root }).findings,
        report.findings,
      );
      assert.deepEqual(snapshot(root), before);
    });
  });
});
