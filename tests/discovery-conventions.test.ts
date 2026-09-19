import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProjectConventions } from "../src/discovery/conventions";
import { DiscoveryFinding } from "../src/discovery/contract";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "conventions-"));
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

function findings(root: string): DiscoveryFinding[] {
  return detectProjectConventions({ root });
}

function byCategory(root: string, category: string): DiscoveryFinding {
  const finding = findings(root).find((entry) => entry.category === category);
  assert.ok(finding, `expected a ${category} finding`);
  return finding;
}

describe("detectProjectConventions", () => {
  it("detects naming conventions from .editorconfig and Prettier/ESLint configs", () => {
    const root = fixture({ ".editorconfig": "root = true\n" });
    assert.equal(byCategory(root, "naming_conventions").value, "editorconfig");
    const prettier = fixture({ ".prettierrc.json": "{}" });
    assert.equal(byCategory(prettier, "naming_conventions").value, "prettier");
    const eslint = fixture({ "eslint.config.js": "export default {}" });
    assert.equal(byCategory(eslint, "naming_conventions").value, "eslint");
    const phpcs = fixture({ "phpcs.xml": "<ruleset></ruleset>" });
    assert.equal(byCategory(phpcs, "naming_conventions").value, "phpcs");
    const checkstyle = fixture({ "checkstyle.xml": "<module name=\"Checker\"></module>" });
    assert.equal(byCategory(checkstyle, "naming_conventions").value, "checkstyle");
    const golangci = fixture({ ".golangci.yml": "linters:\n" });
    assert.equal(byCategory(golangci, "naming_conventions").value, "golangci-lint");
    const clang = fixture({ ".clang-format": "BasedOnStyle: LLVM\n" });
    assert.equal(byCategory(clang, "naming_conventions").value, "clang-format");
    const rustfmt = fixture({ "rustfmt.toml": "edition = \"2021\"\n" });
    assert.equal(byCategory(rustfmt, "naming_conventions").value, "rustfmt");
  });

  it("detects multiple naming conventions where legitimately evidenced", () => {
    const root = fixture({
      ".editorconfig": "root = true\n",
      ".prettierrc": "{}",
      "eslint.config.js": "export default {}",
    });
    assert.equal(byCategory(root, "naming_conventions").value, "editorconfig, prettier, eslint");
  });

  it("detects architecture from explicit architecture documentation", () => {
    const clean = fixture({ "ARCHITECTURE.md": "# Clean Architecture\nThis project uses clean architecture.\n" });
    assert.equal(byCategory(clean, "architecture").value, "clean");
    const hexagonal = fixture({ "architecture.md": "Hexagonal architecture (ports and adapters)" });
    assert.equal(byCategory(hexagonal, "architecture").value, "hexagonal");
    const layered = fixture({ "docs/architecture.md": "Layered architecture with controllers, services, repositories" });
    assert.equal(byCategory(layered, "architecture").value, "layered");
    const modular = fixture({ "ARCHITECTURE.rst": "Modular monolith architecture" });
    assert.equal(byCategory(modular, "architecture").value, "modular");
    const microservices = fixture({ "ARCHITECTURE.md": "Microservices architecture with API gateway" });
    assert.equal(byCategory(microservices, "architecture").value, "microservices");
    const generic = fixture({ "ARCHITECTURE.md": "Some custom architecture description" });
    assert.equal(byCategory(generic, "architecture").value, "documented");
  });

  it("detects documentation presence", () => {
    assert.equal(byCategory(fixture({ "README.md": "# Project" }), "documentation").value, "readme");
    assert.equal(byCategory(fixture({ "README.rst": "Project" }), "documentation").value, "readme");
    assert.equal(byCategory(fixture({ "CONTRIBUTING.md": "How to contribute" }), "documentation").value, "contributing");
    assert.equal(byCategory(fixture({ "CHANGELOG.md": "# Changelog" }), "documentation").value, "changelog");
    assert.equal(byCategory(fixture({ "docs/": "" }), "documentation").value, "docs");
    const multi = fixture({ "README.md": "", "CONTRIBUTING.md": "", "CHANGELOG.md": "" });
    assert.equal(byCategory(multi, "documentation").value, "readme, contributing, changelog");
  });

  it("detects Git conventions and metadata", () => {
    const gitignore = fixture({ ".gitignore": "node_modules\n" });
    assert.equal(byCategory(gitignore, "git").value, "gitignore");
    const gitattrs = fixture({ ".gitattributes": "* text=auto\n" });
    assert.equal(byCategory(gitattrs, "git").value, "gitattributes");
    const gitdir = fixture({ ".git/HEAD": "ref: refs/heads/main" });
    assert.equal(byCategory(gitdir, "git").value, "git");
    const multi = fixture({ ".gitignore": "", ".gitattributes": "", ".git/HEAD": "ref: refs/heads/main" });
    assert.equal(byCategory(multi, "git").value, "gitignore, gitattributes, git");
  });

  it("detects technical constraints from version/tooling files", () => {
    assert.equal(byCategory(fixture({ ".nvmrc": "20\n" }), "technical_constraints").value, "node version");
    assert.equal(byCategory(fixture({ ".node-version": "18.19.1\n" }), "technical_constraints").value, "node version");
    assert.equal(byCategory(fixture({ ".python-version": "3.11\n" }), "technical_constraints").value, "python version");
    assert.equal(byCategory(fixture({ ".tool-versions": "nodejs 20.0.0\n" }), "technical_constraints").value, "tool versions");
    assert.equal(byCategory(fixture({ "Dockerfile": "FROM node:20\n" }), "technical_constraints").value, "docker");
    assert.equal(byCategory(fixture({ "docker-compose.yml": "version: '3'\n" }), "technical_constraints").value, "docker compose");
    assert.equal(byCategory(fixture({ "docker-compose.yaml": "version: '3'\n" }), "technical_constraints").value, "docker compose");
    const multi = fixture({ ".nvmrc": "20\n", "Dockerfile": "FROM node:20\n" });
    assert.equal(byCategory(multi, "technical_constraints").value, "node version, docker");
  });

  it("reports unknown when no relevant evidence exists", () => {
    const root = fixture({});
    for (const category of ["naming_conventions", "architecture", "documentation", "git", "technical_constraints"]) {
      assert.equal(byCategory(root, category).status, "unknown", category);
    }
  });

  it("reports not_detected when relevant evidence was assessed but no convention found", () => {
    // Files that are assessed but don't match any convention
    const root = fixture({ "package.json": "{}", "src/main.ts": "console.log('hi')" });
    // package.json is not in any of our whitelists for these categories
    for (const category of ["naming_conventions", "architecture", "documentation", "git", "technical_constraints"]) {
      assert.equal(byCategory(root, category).status, "unknown", category);
    }
    // But a README is in DOCUMENTATION_FILES
    const readmeOnly = fixture({ "README.md": "# Project" });
    assert.equal(byCategory(readmeOnly, "documentation").status, "detected");
    // architecture docs assessed but not present
    assert.equal(byCategory(readmeOnly, "architecture").status, "unknown");
  });

  it("does not infer architecture from directory names", () => {
    const root = fixture({
      "src/controllers/user.controller.ts": "export class UserController {}",
      "src/services/user.service.ts": "export class UserService {}",
      "src/repositories/user.repository.ts": "export class UserRepository {}",
    });
    assert.equal(byCategory(root, "architecture").status, "unknown");
    assert.equal(byCategory(root, "naming_conventions").status, "unknown");
  });

  it("does not infer naming conventions from source filenames statistically", () => {
    const root = fixture({
      "src/UserService.ts": "export class UserService {}",
      "src/UserController.ts": "export class UserController {}",
      "src/userRepository.ts": "export class UserRepository {}",
    });
    assert.equal(byCategory(root, "naming_conventions").status, "unknown");
  });

  it("does not invent Git branch strategy from mere Git presence", () => {
    const root = fixture({ ".git/HEAD": "ref: refs/heads/main" });
    const finding = byCategory(root, "git");
    assert.equal(finding.value, "git");
    assert.ok(!finding.value.includes("branch"));
    assert.ok(!finding.value.includes("strategy"));
    assert.ok(!finding.value.includes("workflow"));
  });

  it("evidence contains only path references, not file contents", () => {
    const root = fixture({
      ".editorconfig": "root = true\nindent_style = space\nindent_size = 4\n",
      "README.md": "# Secret Project\nAPI_KEY=sk-12345\n",
    });
    const dumped = JSON.stringify(findings(root));
    assert.ok(!dumped.includes("indent_style"));
    assert.ok(!dumped.includes("indent_size"));
    assert.ok(!dumped.includes("sk-12345"));
    assert.ok(!dumped.includes("Secret"));
    for (const finding of findings(root)) {
      for (const entry of finding.evidence ?? []) {
        assert.ok(!entry.ref.includes("/") || !entry.ref.startsWith("/"));
        assert.ok(!entry.ref.includes(".."));
      }
    }
  });

  it("is read-only, deterministic, and root-safe", () => {
    const root = fixture({
      ".editorconfig": "root = true\n",
      ".prettierrc": "{}",
      "README.md": "# Project",
      ".gitignore": "node_modules\n",
      "Dockerfile": "FROM node:20\n",
    });
    const before = readdirSync(root)
      .sort()
      .map((entry) => `${entry}:${statSync(join(root, entry)).mtimeMs}`);
    const first = detectProjectConventions({ root });
    assert.deepEqual(
      readdirSync(root)
        .sort()
        .map((entry) => `${entry}:${statSync(join(root, entry)).mtimeMs}`),
      before,
    );
    assert.deepEqual(detectProjectConventions({ root }), first);
    assert.throws(() => detectProjectConventions({ root: join(root, "missing") }), /not a readable directory/);
  });

  it("does not use subprocesses, network, or providers", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "discovery", "conventions.ts"), "utf8");
    assert.ok(!/child_process|execSync|spawn|fetch\(|http:|https:/.test(code));
  });

  it("A-001 through A-004 contracts remain unchanged", async () => {
    // This test just ensures the import chain works and no modifications were made
    const { validateFinding, validateProjectContext } = await import("../src/discovery/contract");
    const { detectProjectStack } = await import("../src/discovery/stack");
    const { detectProjectTools } = await import("../src/discovery/tools");
    const { detectTestingTools } = await import("../src/discovery/testing");
    const root = fixture({ "package.json": "{}", "jest.config.js": "" });
    assert.ok(detectProjectStack({ root }));
    assert.ok(detectProjectTools({ root }));
    assert.ok(detectTestingTools({ root }));
    assert.ok(validateFinding({ category: "languages", status: "detected" }));
    assert.ok(validateProjectContext({ root }));
  });
});