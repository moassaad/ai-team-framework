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
  const root = mkdtempSync(join(tmpdir(), "laravel-fixture-"));
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

describe("Laravel-shaped project fixture (A-007 example)", () => {
  it("analyzes a conventional Laravel-shaped project using generic detectors", () => {
    const root = fixture({
      "composer.json": JSON.stringify({
        name: "example/laravel-app",
        type: "project",
        description: "A Laravel application",
        require: {
          php: "^8.2",
          "laravel/framework": "^11.0",
          "laravel/sanctum": "^4.0",
          "laravel/tinker": "^2.9",
        },
        "require-dev": {
          "fakerphp/faker": "^1.23",
          "laravel/pint": "^1.13",
          "laravel/sail": "^1.26",
          "mockery/mockery": "^1.6",
          "nunomaduro/collision": "^8.1",
          "phpunit/phpunit": "^10.5",
        },
        config: {
          "optimize-autoloader": true,
          "preferred-install": "dist",
          "sort-packages": true,
          "allow-plugins": {
            "pestphp/pest-plugin": true,
            "php-http/discovery": true,
          },
        },
        "minimum-stability": "stable",
        "prefer-stable": true,
      }),
      "composer.lock": "{}",
      "artisan": "#!/usr/bin/env php\n<?php\n",
      "phpunit.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<phpunit>\n  <testsuites>\n    <testsuite name=\"Unit\">\n      <directory suffix=\"Test.php\">./tests/Unit</directory>\n    </testsuite>\n    <testsuite name=\"Feature\">\n      <directory suffix=\"Test.php\">./tests/Feature</directory>\n    </testsuite>\n  </testsuites>\n</phpunit>\n",
      "README.md": "# Laravel Application\n\nA sample Laravel project for discovery testing.\n",
      ".editorconfig": "root = true\n\n[*.php]\nindent_style = space\nindent_size = 4\n",
      ".gitignore": "/vendor\n/node_modules\n/.env\n/.env.backup\n/phpunit.xml.phpunit\n/homestead.yaml\n/homestead.json\n",
      ".gitattributes": "* text=auto\n",
      "docker-compose.yml": "version: '3'\nservices:\n  app:\n    build:\n      context: .\n      dockerfile: Dockerfile\n    volumes:\n      - ./:/var/www/html\n",
      ".env.example": "APP_NAME=Laravel\nAPP_ENV=local\nAPP_KEY=\nAPP_DEBUG=true\nAPP_URL=http://localhost\n\nDB_CONNECTION=sqlite\nDB_DATABASE=database/database.sqlite\n\nCACHE_DRIVER=file\nSESSION_DRIVER=file\nQUEUE_CONNECTION=sync\n",
    });

    const report = generateProjectAnalysis({ root, name: "laravel-app", kind: "existing" });

    // Project context preserved
    assert.equal(report.project.root, root);
    assert.equal(report.project.name, "laravel-app");
    assert.equal(report.project.kind, "existing");

    const byCat = findingsByCategory(report);

    // languages: PHP detected from composer.json
    assert.equal(byCat.languages.category, "languages");
    assert.equal(byCat.languages.status, "detected");
    assert.ok(byCat.languages.value?.includes("php"), "PHP should be detected");

    // backend_framework: Laravel detected from composer.json require
    assert.equal(byCat.backend_framework.category, "backend_framework");
    assert.equal(byCat.backend_framework.status, "detected");
    assert.ok(byCat.backend_framework.value?.includes("laravel"), "Laravel should be detected from composer.json");

    // package_managers: Composer detected from composer.lock and composer.json
    assert.equal(byCat.package_managers.category, "package_managers");
    assert.equal(byCat.package_managers.status, "detected");
    assert.ok(byCat.package_managers.value?.includes("composer"), "Composer should be detected");

    // testing_tools: PHPUnit detected from phpunit.xml and composer.json require-dev
    assert.equal(byCat.testing_tools.category, "testing_tools");
    assert.equal(byCat.testing_tools.status, "detected");
    assert.ok(byCat.testing_tools.value?.includes("phpunit"), "PHPUnit should be detected");

    // documentation: README.md present
    assert.equal(byCat.documentation.category, "documentation");
    assert.equal(byCat.documentation.status, "detected");
    assert.ok(byCat.documentation.value?.includes("readme"), "README should be detected");

    // git: .gitignore and .gitattributes present
    assert.equal(byCat.git.category, "git");
    assert.equal(byCat.git.status, "detected");
    const gitValue = byCat.git.value ?? "";
    assert.ok(gitValue.includes("gitignore"), ".gitignore should be detected");
    assert.ok(gitValue.includes("gitattributes"), ".gitattributes should be detected");

    // naming_conventions: .editorconfig present
    assert.equal(byCat.naming_conventions.category, "naming_conventions");
    assert.equal(byCat.naming_conventions.status, "detected");
    assert.ok(byCat.naming_conventions.value?.includes("editorconfig"), ".editorconfig should be detected");

    // architecture: unknown (no ARCHITECTURE.md)
    assert.equal(byCat.architecture.category, "architecture");
    assert.equal(byCat.architecture.status, "unknown");

    // database: unknown (no DB driver deps or config)
    assert.equal(byCat.database.category, "database");
    assert.equal(byCat.database.status, "unknown");

    // build_tools: not_detected (no build config)
    assert.equal(byCat.build_tools.category, "build_tools");
    assert.equal(byCat.build_tools.status, "not_detected");

    // frontend_framework: unknown (no frontend evidence)
    assert.equal(byCat.frontend_framework.category, "frontend_framework");
    assert.equal(byCat.frontend_framework.status, "unknown");

    // technical_constraints: detected (docker-compose.yml from Laravel Sail)
    assert.equal(byCat.technical_constraints.category, "technical_constraints");
    assert.equal(byCat.technical_constraints.status, "detected");
    assert.ok(byCat.technical_constraints.value?.includes("docker compose"), "docker compose should be detected");

    // Coverage: analyzed categories present, uncovered listed explicitly
    assert.deepEqual(report.coverage.analyzed, ANALYZED_CATEGORIES);
    assert.deepEqual(report.coverage.uncovered, UNCOVERED_CATEGORIES);
    assert.equal(report.coverage.totalSpecCategories, 18);

    // No Laravel-specific synthetic findings exist
    const allCategories = report.findings.map((f) => f.category);
    for (const cat of allCategories) {
      assert.ok(ANALYZED_CATEGORIES.includes(cat) || UNCOVERED_CATEGORIES.includes(cat), `unexpected category ${cat}`);
    }
    // No "laravel" category or similar
    assert.ok(!allCategories.some((c) => c.includes("laravel")), "no Laravel-specific category");

    // Evidence points to expected fixture files
    const evidenceRefs = new Set<string>();
    for (const f of report.findings) {
      for (const e of f.evidence ?? []) {
        evidenceRefs.add(e.ref);
      }
    }
    assert.ok(evidenceRefs.has("composer.json"), "composer.json should be in evidence");
    assert.ok(evidenceRefs.has("composer.lock"), "composer.lock should be in evidence");
    assert.ok(evidenceRefs.has("phpunit.xml"), "phpunit.xml should be in evidence");
    assert.ok(evidenceRefs.has("README.md"), "README.md should be in evidence");
    assert.ok(evidenceRefs.has(".editorconfig"), ".editorconfig should be in evidence");
    assert.ok(evidenceRefs.has(".gitignore"), ".gitignore should be in evidence");
    assert.ok(evidenceRefs.has(".gitattributes"), ".gitattributes should be in evidence");
    assert.ok(evidenceRefs.has("docker-compose.yml"), "docker-compose.yml should be in evidence");

    // No .env contents exposed (only .env.example present, not read)
    const dumped = JSON.stringify(report);
    assert.ok(!dumped.includes("APP_KEY"), "no secret values exposed");
    assert.ok(!dumped.includes("DB_DATABASE"), "no database config exposed");
  });

  it("report is deterministic across repeated runs", () => {
    const root = fixture({
      "composer.json": JSON.stringify({ require: { "laravel/framework": "^11.0" } }),
      "composer.lock": "{}",
      "phpunit.xml": "<phpunit></phpunit>",
      "README.md": "# X\n",
      ".gitignore": "/vendor\n",
    });
    const r1 = generateProjectAnalysis({ root });
    const r2 = generateProjectAnalysis({ root });
    assert.deepEqual(r1, r2);
  });

  it("does not require Composer, PHP, database, or network", () => {
    // The fixture test runs without any external execution
    // If this test passes, the requirement is satisfied
    const root = fixture({ "composer.json": "{}" });
    assert.doesNotThrow(() => generateProjectAnalysis({ root }));
  });

  it("no secrets in fixture", () => {
    const root = fixture({
      "composer.json": "{}",
      ".env.example": "APP_KEY=\nDB_PASSWORD=\n",
    });
    const report = generateProjectAnalysis({ root });
    const dumped = JSON.stringify(report);
    assert.ok(!dumped.includes("APP_KEY="));
    assert.ok(!dumped.includes("DB_PASSWORD"));
  });
});