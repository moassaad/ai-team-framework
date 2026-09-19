import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectTestingTools } from "../src/discovery/testing";
import { DiscoveryFinding } from "../src/discovery/contract";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "testing-"));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

function finding(root: string): DiscoveryFinding {
  const results = detectTestingTools({ root });
  assert.equal(results.length, 1);
  return results[0];
}

describe("detectTestingTools", () => {
  it("detects Jest from config and dependency", () => {
    const root = fixture({ "package.json": "{}", "jest.config.js": "module.exports = {}" });
    assert.deepEqual(finding(root), {
      category: "testing_tools",
      status: "detected",
      value: "jest",
      evidence: [{ kind: "manifest", ref: "jest.config.js" }],
    });
    const deps = fixture({ "package.json": JSON.stringify({ devDependencies: { jest: "^29.0.0" } }) });
    assert.equal(finding(deps).value, "jest");
    assert.equal(finding(deps).evidence?.[0].note, "dependency");
  });

  it("detects Vitest from config and dependency", () => {
    const root = fixture({ "package.json": "{}", "vitest.config.ts": "export default {}" });
    assert.equal(finding(root).value, "vitest");
    const deps = fixture({ "package.json": JSON.stringify({ devDependencies: { vitest: "^1.0.0" } }) });
    assert.equal(finding(deps).value, "vitest");
  });

  it("detects Playwright and Cypress from config and dependency", () => {
    assert.equal(finding(fixture({ "package.json": "{}", "playwright.config.js": "" })).value, "playwright");
    assert.equal(finding(fixture({ "package.json": "{}", "cypress.config.ts": "" })).value, "cypress");
    const pwDep = fixture({ "package.json": JSON.stringify({ devDependencies: { "@playwright/test": "^1.40.0" } }) });
    assert.equal(finding(pwDep).value, "playwright");
    const cyDep = fixture({ "package.json": JSON.stringify({ devDependencies: { cypress: "^13.0.0" } }) });
    assert.equal(finding(cyDep).value, "cypress");
  });

  it("detects Pytest from ini, tox, nox, pyproject, setup.cfg", () => {
    assert.equal(finding(fixture({ "pytest.ini": "[pytest]\n" })).value, "pytest");
    assert.equal(finding(fixture({ "tox.ini": "[testenv]\n" })).value, "pytest");
    assert.equal(finding(fixture({ "noxfile.py": "" })).value, "pytest");
    const pyprojectDep = fixture({ "pyproject.toml": 'pytest = "^7.0"\n' });
    assert.equal(finding(pyprojectDep).value, "pytest");
    const pyprojectCfg = fixture({ "pyproject.toml": "[tool.pytest.ini_options]\n" });
    assert.equal(finding(pyprojectCfg).value, "pytest");
    const setupCfg = fixture({ "setup.cfg": "[tool:pytest]\n" });
    assert.equal(finding(setupCfg).value, "pytest");
  });

  it("detects PHPUnit and Pest from config and composer deps", () => {
    assert.equal(finding(fixture({ "phpunit.xml": "<phpunit></phpunit>" })).value, "phpunit");
    assert.equal(finding(fixture({ "phpunit.xml.dist": "<phpunit></phpunit>" })).value, "phpunit");
    assert.equal(finding(fixture({ "pest.php": "" })).value, "pest");
    const composer = fixture({
      "composer.json": JSON.stringify({ "require-dev": { "phpunit/phpunit": "^10.0", "pestphp/pest": "^2.0" } }),
    });
    assert.equal(finding(composer).value, "phpunit, pest");
  });

  it("detects JUnit/TestNG/Mockito/AssertJ from pom.xml and Gradle", () => {
    const pom = fixture({ "pom.xml": "<project><dependencies><dependency><artifactId>junit-jupiter</artifactId></dependency></dependencies></project>" });
    assert.equal(finding(pom).value, "junit");
    const gradle = fixture({ "build.gradle.kts": 'dependencies { testImplementation("org.junit.jupiter:junit-jupiter:5.10.0") }\n' });
    assert.equal(finding(gradle).value, "junit");
    const gradleMulti = fixture({ "build.gradle.kts": 'dependencies { testImplementation("org.testng:testng:7.8.0") testImplementation("org.mockito:mockito-core:5.7.0") }\n' });
    assert.equal(finding(gradleMulti).value, "testng, mockito");
  });

  it("detects cargo test only when dev-dependencies exist", () => {
    const cargoEmpty = fixture({ "Cargo.toml": "[package]\nname = \"x\"\nversion = \"0.1.0\"\nedition = \"2021\"\n" });
    assert.equal(finding(cargoEmpty).status, "not_detected");
    const cargoTest = fixture({ "Cargo.toml": "[package]\nname = \"x\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dev-dependencies]\n" });
    assert.equal(finding(cargoTest).value, "cargo test");
    assert.equal(finding(cargoTest).evidence?.[0].note, "dev-dependencies");
  });

  it("detects from package.json test scripts", () => {
    const scripts = fixture({
      "package.json": JSON.stringify({ scripts: { test: "jest --coverage", "test:e2e": "cypress run" } }),
    });
    assert.equal(finding(scripts).value, "jest, cypress");
    assert.equal(finding(scripts).evidence?.[0].note, 'script "test"');
  });

  it("detects multiple testing tools where legitimately evidenced", () => {
    const root = fixture({
      "package.json": JSON.stringify({ devDependencies: { jest: "^29.0.0", vitest: "^1.0.0" } }),
      "jest.config.js": "",
      "vitest.config.ts": "",
    });
    assert.equal(finding(root).value, "jest, vitest");
  });

  it("reports unknown when no testing evidence exists", () => {
    assert.equal(finding(fixture({})).status, "unknown");
  });

  it("reports not_detected when assessed but no supported tool found", () => {
    const root = fixture({ "package.json": JSON.stringify({ dependencies: { lodash: "4.17.21" } }) });
    assert.equal(finding(root).status, "not_detected");
    assert.ok(finding(root).evidence?.some((entry) => entry.ref === "package.json"));
    assert.equal(finding(fixture({ "pyproject.toml": "name = 'x'\n" })).status, "not_detected");
    assert.equal(finding(fixture({ "composer.json": "{}" })).status, "not_detected");
    assert.equal(finding(fixture({ "pom.xml": "<project></project>" })).status, "not_detected");
    assert.equal(finding(fixture({ "Cargo.toml": "[package]\nname = \"x\"\nversion = \"0.1.0\"\nedition = \"2021\"\n" })).status, "not_detected");
  });

  it("does not produce false detection from generic test scripts", () => {
    const root = fixture({ "package.json": JSON.stringify({ scripts: { test: "echo placeholder" } }) });
    assert.equal(finding(root).status, "not_detected");
    const root2 = fixture({ "package.json": JSON.stringify({ scripts: { test: "npm run build" } }) });
    assert.equal(finding(root2).status, "not_detected");
  });

  it("does not falsely report standard-language testing as named external tools", () => {
    const goOnly = fixture({ "go.mod": "module example\n" });
    assert.equal(finding(goOnly).status, "not_detected");
    const rustOnly = fixture({ "Cargo.toml": "[package]\nname = \"x\"\nversion = \"0.1.0\"\nedition = \"2021\"\n" });
    assert.equal(finding(rustOnly).status, "not_detected");
  });

  it("never exposes secrets and keeps evidence to path references", () => {
    const root = fixture({
      "package.json": JSON.stringify({ devDependencies: { jest: "^29.0.0" } }),
      ".env": "PASSWORD=hunter2\nAPI_KEY=sekret\n",
    });
    const dumped = JSON.stringify(detectTestingTools({ root }));
    assert.ok(!dumped.includes("hunter2") && !dumped.includes("sekret") && !dumped.includes(".env"));
    for (const entry of finding(root).evidence ?? []) {
      assert.ok(!entry.ref.includes("/") || !entry.ref.startsWith("/"));
      assert.ok(!entry.ref.includes(".."));
    }
  });

  it("is read-only, deterministic, and root-safe", () => {
    const root = fixture({ "package.json": JSON.stringify({ devDependencies: { jest: "^29.0.0", vitest: "^1.0.0" } }), "jest.config.js": "" });
    const before = readdirSync(root)
      .sort()
      .map((entry) => `${entry}:${statSync(join(root, entry)).mtimeMs}`);
    const first = detectTestingTools({ root });
    assert.deepEqual(
      readdirSync(root)
        .sort()
        .map((entry) => `${entry}:${statSync(join(root, entry)).mtimeMs}`),
      before,
    );
    assert.deepEqual(detectTestingTools({ root }), first);
    assert.throws(() => detectTestingTools({ root: join(root, "missing") }), /not a readable directory/);
  });

  it("does not use subprocesses, network, or providers", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "discovery", "testing.ts"), "utf8");
    assert.ok(!/child_process|execSync|spawn|fetch\(|http:|https:/.test(code));
  });
});