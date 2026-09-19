/**
 * Testing-tool detection (A-004).
 *
 * Read-only, deterministic, project-agnostic detection of the
 * `testing_tools` category from a fixed whitelist of config files,
 * manifest dependencies, and script commands. Positive evidence yields
 * `detected`; an assessed project with no positive evidence yields
 * `not_detected`; a project with no relevant files at all yields
 * `unknown` — never a guess. No writes, no subprocesses, no network,
 * no providers, no test execution.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  DiscoveryEvidence,
  DiscoveryFinding,
  ProjectContext,
  validateFinding,
  validateProjectContext,
} from "./contract";

function has(root: string, rel: string): boolean {
  try {
    return statSync(join(root, rel)).isFile();
  } catch {
    return false;
  }
}

function readText(root: string, rel: string): string | undefined {
  try {
    const path = join(root, rel);
    if (!statSync(path).isFile()) {
      return undefined;
    }
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Explicit config-file patterns to generic testing tool names. */
const TEST_CONFIGS: Array<[rel: string, tool: string]> = [
  ["jest.config.js", "jest"],
  ["jest.config.ts", "jest"],
  ["jest.config.cjs", "jest"],
  ["jest.config.mjs", "jest"],
  ["vitest.config.js", "vitest"],
  ["vitest.config.ts", "vitest"],
  ["vitest.config.mjs", "vitest"],
  ["cypress.config.js", "cypress"],
  ["cypress.config.ts", "cypress"],
  ["cypress.config.mjs", "cypress"],
  ["playwright.config.js", "playwright"],
  ["playwright.config.ts", "playwright"],
  ["playwright.config.mjs", "playwright"],
  ["pytest.ini", "pytest"],
  ["tox.ini", "pytest"],
  ["noxfile.py", "pytest"],
  ["phpunit.xml", "phpunit"],
  ["phpunit.xml.dist", "phpunit"],
  ["pest.php", "pest"],
];

/** Dependency name (lowercase) to generic testing tool. */
const TEST_DEPS: Record<string, string> = {
  jest: "jest",
  vitest: "vitest",
  "@playwright/test": "playwright",
  cypress: "cypress",
  pytest: "pytest",
  "phpunit/phpunit": "phpunit",
  "pestphp/pest": "pest",
  junit: "junit",
  "junit-jupiter": "junit",
  "junit-jupiter-api": "junit",
  "junit-jupiter-params": "junit",
  "junit-jupiter-engine": "junit",
  "junit-platform": "junit",
  "junit-vintage-engine": "junit",
  testng: "testng",
  "org.testng": "testng",
  mockito: "mockito",
  "org.mockito": "mockito",
  assertj: "assertj",
  "org.assertj": "assertj",
  "org.junit.jupiter": "junit",
};

function parseJsonDeps(text: string, sections: string[]): string[] {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return [];
  }
  const deps: string[] = [];
  for (const section of sections) {
    const bucket = data[section];
    if (typeof bucket !== "object" || bucket === null) {
      continue;
    }
    for (const name of Object.keys(bucket as Record<string, unknown>)) {
      deps.push(name);
    }
  }
  return deps;
}

function matchDeps(deps: string[], table: Record<string, string>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const dep of deps) {
    const display = table[dep.toLowerCase()];
    if (display && !seen.has(display)) {
      seen.add(display);
      found.push(display);
    }
  }
  return found;
}

/** Recognized test binaries in package.json scripts. */
const SCRIPT_TEST_BINARIES: Array<[binary: string, tool: string]> = [
  ["jest", "jest"],
  ["vitest", "vitest"],
  ["cypress", "cypress"],
  ["playwright", "playwright"],
  ["pytest", "pytest"],
  ["phpunit", "phpunit"],
  ["pest", "pest"],
];

function findScriptTools(root: string, evidence: Array<{ name: string; ref: string; note?: string }>): void {
  const text = readText(root, "package.json");
  if (text === undefined) {
    return;
  }
  let scripts: unknown;
  try {
    scripts = (JSON.parse(text) as Record<string, unknown>)["scripts"];
  } catch {
    return;
  }
  if (typeof scripts !== "object" || scripts === null) {
    return;
  }
  for (const [scriptName, command] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof command !== "string") {
      continue;
    }
    for (const [binary, tool] of SCRIPT_TEST_BINARIES) {
      if (new RegExp(`(^|[\\s"';=&|])${binary}(\\s|$)`).test(command)) {
        if (!evidence.some((entry) => entry.name === tool)) {
          evidence.push({ name: tool, ref: "package.json", note: `script "${scriptName}"` });
        }
      }
    }
  }
}

function checkPyprojectForPytest(root: string, evidence: Array<{ name: string; ref: string; note?: string }>): void {
  const text = readText(root, "pyproject.toml");
  if (text === undefined) {
    return;
  }
  const hasPytestDep = /^\s*pytest\s*[=<>!]/.test(text);
  const hasPytestConfig = /\[tool\.pytest\b/.test(text) || /\[tool\.pytestini\b/.test(text);
  if (hasPytestDep || hasPytestConfig) {
    if (!evidence.some((entry) => entry.name === "pytest")) {
      evidence.push({ name: "pytest", ref: "pyproject.toml", note: hasPytestDep ? "dependency" : "config" });
    }
  }
}

function checkSetupCfgForPytest(root: string, evidence: Array<{ name: string; ref: string; note?: string }>): void {
  const text = readText(root, "setup.cfg");
  if (text === undefined) {
    return;
  }
  if (/^\[tool:pytest\]/m.test(text) || /^\[pytest\]/m.test(text)) {
    if (!evidence.some((entry) => entry.name === "pytest")) {
      evidence.push({ name: "pytest", ref: "setup.cfg", note: "config" });
    }
  }
}

function checkComposerForPhpTests(root: string, evidence: Array<{ name: string; ref: string; note?: string }>): void {
  const text = readText(root, "composer.json");
  if (text === undefined) {
    return;
  }
  const deps = parseJsonDeps(text, ["require", "require-dev"]);
  const tools = matchDeps(deps, TEST_DEPS);
  for (const tool of tools) {
    if (!evidence.some((entry) => entry.name === tool)) {
      evidence.push({ name: tool, ref: "composer.json", note: "dependency" });
    }
  }
}

function checkPomForJavaTests(root: string, evidence: Array<{ name: string; ref: string; note?: string }>): void {
  const text = readText(root, "pom.xml");
  if (text === undefined) {
    return;
  }
  const artifacts: string[] = [];
  for (const match of text.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)) {
    artifacts.push(match[1]!.trim());
  }
  const tools = matchDeps(artifacts, TEST_DEPS);
  for (const tool of tools) {
    if (!evidence.some((entry) => entry.name === tool)) {
      evidence.push({ name: tool, ref: "pom.xml", note: "dependency" });
    }
  }
}

function checkGradleForJavaTests(root: string, evidence: Array<{ name: string; ref: string; note?: string }>): void {
  for (const rel of ["build.gradle", "build.gradle.kts"]) {
    const text = readText(root, rel);
    if (text === undefined) {
      continue;
    }
    // Check for test dependencies/plugins
    const hasJunit = /junit/.test(text);
    const hasTestng = /testng/.test(text);
    const hasMockito = /mockito/.test(text);
    const hasAssertj = /assertj/.test(text);
    const tools: string[] = [];
    if (hasJunit) tools.push("junit");
    if (hasTestng) tools.push("testng");
    if (hasMockito) tools.push("mockito");
    if (hasAssertj) tools.push("assertj");
    for (const tool of tools) {
      if (!evidence.some((entry) => entry.name === tool)) {
        evidence.push({ name: tool, ref: rel, note: "dependency" });
      }
    }
  }
}

function checkCargoForTests(root: string, evidence: Array<{ name: string; ref: string; note?: string }>): void {
  const text = readText(root, "Cargo.toml");
  if (text === undefined) {
    return;
  }
  // Rust's standard testing is cargo test - only report if test dependencies exist
  const hasTestDeps = /\[dev-dependencies\]/.test(text);
  if (hasTestDeps) {
    if (!evidence.some((entry) => entry.name === "cargo test")) {
      evidence.push({ name: "cargo test", ref: "Cargo.toml", note: "dev-dependencies" });
    }
  }
}

interface TestEvidence {
  tools: Array<{ name: string; ref: string; note?: string }>;
  assessedRefs: string[];
}

function collect(root: string): TestEvidence {
  const evidence: TestEvidence = { tools: [], assessedRefs: [] };
  const assessed = (rel: string): void => {
    if (!evidence.assessedRefs.includes(rel)) {
      evidence.assessedRefs.push(rel);
    }
  };

  for (const [rel, tool] of TEST_CONFIGS) {
    if (has(root, rel)) {
      assessed(rel);
      if (!evidence.tools.some((entry) => entry.name === tool)) {
        evidence.tools.push({ name: tool, ref: rel });
      }
    }
  }

  // Assess ambiguous manifests that could contain test config
  for (const rel of ["package.json", "pyproject.toml", "composer.json", "pom.xml", "build.gradle", "build.gradle.kts", "Cargo.toml", "go.mod", "setup.cfg", "tox.ini", "noxfile.py"]) {
    if (has(root, rel)) {
      assessed(rel);
    }
  }

  // package.json deps and scripts
  const pkgJson = readText(root, "package.json");
  if (pkgJson !== undefined) {
    const deps = parseJsonDeps(pkgJson, ["dependencies", "devDependencies"]);
    const tools = matchDeps(deps, TEST_DEPS);
    for (const tool of tools) {
      if (!evidence.tools.some((entry) => entry.name === tool)) {
        evidence.tools.push({ name: tool, ref: "package.json", note: "dependency" });
      }
    }
    findScriptTools(root, evidence.tools);
  }

  checkPyprojectForPytest(root, evidence.tools);
  checkSetupCfgForPytest(root, evidence.tools);
  checkComposerForPhpTests(root, evidence.tools);
  checkPomForJavaTests(root, evidence.tools);
  checkGradleForJavaTests(root, evidence.tools);
  checkCargoForTests(root, evidence.tools);

  return evidence;
}

function toEvidence(entries: Array<{ ref: string; note?: string }>): DiscoveryEvidence[] {
  return entries.map((entry) =>
    entry.note ? { kind: "manifest" as const, ref: entry.ref, note: entry.note } : { kind: "manifest" as const, ref: entry.ref },
  );
}

/**
 * Detect testing tools under `context.root`.
 * Read-only and deterministic: the same root always yields the same
 * validated findings; nothing is written, executed, or contacted.
 */
export function detectTestingTools(context: ProjectContext): DiscoveryFinding[] {
  const { root } = validateProjectContext(context);
  try {
    if (!statSync(root).isDirectory()) {
      throw new Error();
    }
  } catch {
    throw new Error(`discovery: project root is not a readable directory: ${root}`);
  }

  const found = collect(root);
  const assessed = toEvidence(found.assessedRefs.map((ref) => ({ ref })));
  return [
    found.tools.length > 0
      ? validateFinding({
          category: "testing_tools",
          status: "detected",
          value: found.tools.map((entry) => entry.name).join(", "),
          evidence: toEvidence(found.tools),
        })
      : found.assessedRefs.length > 0
        ? validateFinding({ category: "testing_tools", status: "not_detected", evidence: assessed })
        : validateFinding({ category: "testing_tools", status: "unknown" }),
  ];
}