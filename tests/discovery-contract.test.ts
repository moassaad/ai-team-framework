import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DISCOVERY_CATEGORIES,
  isDiscoveryCategory,
  isFindingStatus,
  validateFinding,
  validateProjectContext,
} from "../src/discovery/contract";

// Discovery-contract tests only: shape, statuses, validation, purity.
// No detection, filesystem, subprocess, network, or provider behavior.
describe("discovery contract", () => {
  it("represents all eighteen required categories", () => {
    assert.deepEqual([...DISCOVERY_CATEGORIES].sort(), [
      "architecture",
      "backend_framework",
      "build_tools",
      "ci_cd",
      "containers",
      "database",
      "development_commands",
      "documentation",
      "entry_points",
      "existing_issues",
      "frontend_framework",
      "git",
      "languages",
      "naming_conventions",
      "package_managers",
      "sensitive_files",
      "technical_constraints",
      "testing_tools",
    ]);
    for (const category of DISCOVERY_CATEGORIES) {
      assert.equal(isDiscoveryCategory(category), true);
    }
    assert.equal(isDiscoveryCategory("laravel_version"), false);
    assert.equal(isDiscoveryCategory("react"), false);
  });

  it("represents detected findings with generic values", () => {
    assert.deepEqual(
      validateFinding({ category: "frontend_framework", status: "detected", value: "react 18.2.0" }),
      { category: "frontend_framework", status: "detected", value: "react 18.2.0" },
    );
    assert.deepEqual(validateFinding({ category: "languages", status: "detected" }), {
      category: "languages",
      status: "detected",
    });
  });

  it("keeps unknown distinct from not_detected", () => {
    const unknown = validateFinding({ category: "database", status: "unknown" });
    const absent = validateFinding({ category: "database", status: "not_detected" });
    assert.equal(unknown.status, "unknown");
    assert.equal(absent.status, "not_detected");
    assert.notDeepEqual(unknown, absent);
    assert.equal(isFindingStatus("detected") && isFindingStatus("not_detected") && isFindingStatus("unknown"), true);
    assert.equal(isFindingStatus("maybe"), false);
  });

  it("carries evidence as references with optional notes", () => {
    assert.deepEqual(
      validateFinding({
        category: "package_managers",
        status: "detected",
        value: "npm",
        evidence: [
          { kind: "file", ref: "package-lock.json" },
          { kind: "command_output", ref: "npm --version", note: "9.2.0" },
        ],
      }).evidence,
      [
        { kind: "file", ref: "package-lock.json" },
        { kind: "command_output", ref: "npm --version", note: "9.2.0" },
      ],
    );
  });

  it("classifies sensitive files without carrying secrets", () => {
    const finding = validateFinding({
      category: "sensitive_files",
      status: "detected",
      value: ".env",
      sensitive: true,
    });
    assert.equal(finding.sensitive, true);
    assert.equal(finding.value, ".env");
    assert.deepEqual(Object.keys(finding).sort(), ["category", "sensitive", "status", "value"]);
  });

  it("represents target project context without framework layout", () => {
    assert.deepEqual(validateProjectContext({ root: "/some/project" }), { root: "/some/project" });
    assert.deepEqual(
      validateProjectContext({ root: "/some/project", name: "shop", kind: "existing" }),
      { root: "/some/project", name: "shop", kind: "existing" },
    );
    assert.throws(() => validateProjectContext({}), /non-empty root/);
    assert.throws(() => validateProjectContext({ root: "/x", kind: "monorepo" }), /unknown project kind/);
  });

  it("rejects malformed findings deterministically", () => {
    for (const data of [
      null,
      "x",
      [],
      {},
      { category: "laravel_version", status: "detected" },
      { category: "languages", status: "maybe" },
      { category: "languages" },
      { category: "languages", status: "detected", value: 7 },
      { category: "git", status: "detected", evidence: "repo" },
      { category: "git", status: "detected", evidence: [{ kind: "smell", ref: "x" }] },
      { category: "git", status: "detected", evidence: [{ kind: "file", ref: "" }] },
      { category: "git", status: "detected", sensitive: "yes" },
    ]) {
      assert.throws(() => validateFinding(data), /discovery contract: invalid/, `must reject ${JSON.stringify(data)}`);
    }
  });

  it("returns frozen results and stays deterministic", () => {
    const input = { category: "git", status: "detected", value: "git", evidence: [{ kind: "directory" as const, ref: ".git" }] };
    const first = validateFinding(input);
    assert.equal(Object.isFrozen(first), true);
    assert.deepEqual(first, validateFinding(input));
    assert.deepEqual(input, {
      category: "git",
      status: "detected",
      value: "git",
      evidence: [{ kind: "directory", ref: ".git" }],
    });
  });

  it("exposes only the contract API surface", async () => {
    const module = await import("../src/discovery/contract");
    assert.deepEqual(Object.keys(module).sort(), [
      "DISCOVERY_CATEGORIES",
      "isDiscoveryCategory",
      "isFindingStatus",
      "validateFinding",
      "validateProjectContext",
    ]);
  });
});
