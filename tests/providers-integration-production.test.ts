import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createProductionRegistry } from "../src/providers/integration-production";

// Production registry tests (M17 U-002-A): construction only. The
// factories under test perform no calls at construction, so these
// tests assert assembly shape, determinism, and boundaries —
// detection behavior itself belongs to U-001 and the adapter tests.

describe("production integration registry", () => {
  it("registers the deterministically constructible integrations in explicit order", () => {
    const first = createProductionRegistry({ projectRoot: "/proj" });
    const second = createProductionRegistry({ projectRoot: "/proj" });
    assert.deepEqual(first.list().map((entry) => entry.name), ["spec-kit"]);
    assert.deepEqual(second.list().map((entry) => entry.name), ["spec-kit"]);
  });

  it("returns independent registries that share no state", () => {
    const first = createProductionRegistry({ projectRoot: "/proj" });
    const second = createProductionRegistry({ projectRoot: "/proj" });
    assert.notEqual(first, second);
    assert.deepEqual(first.list().map((entry) => entry.name), ["spec-kit"]);
    assert.deepEqual(second.list().map((entry) => entry.name), ["spec-kit"]);
  });

  it("reuses the existing Spec Kit factory with its detect capability", () => {
    const registry = createProductionRegistry({ projectRoot: "/proj" });
    const specKit = registry.get("spec-kit");
    assert.notEqual(specKit, undefined);
    assert.ok((specKit?.capabilities ?? []).includes("detect"));
    assert.equal(typeof specKit?.detect, "function");
  });

  it("registers the install-capable variant so confirmed setup can propose installation", () => {
    const registry = createProductionRegistry({ projectRoot: "/proj" });
    const specKit = registry.get("spec-kit");
    assert.ok((specKit?.capabilities ?? []).includes("install"), "install declared");
    assert.equal(typeof specKit?.install, "function");
  });

  it("rejects duplicate registration through the existing registry", () => {
    const registry = createProductionRegistry({ projectRoot: "/proj" });
    const specKit = registry.get("spec-kit");
    assert.notEqual(specKit, undefined);
    assert.throws(
      () => registry.register(specKit ?? ({} as never)),
      /duplicate integration "spec-kit"/,
    );
    assert.deepEqual(registry.list().map((entry) => entry.name), ["spec-kit"]);
  });

  it("does not invent delegate or OpenCode registrations", () => {
    const registry = createProductionRegistry({ projectRoot: "/proj" });
    assert.equal(registry.get("delegate"), undefined);
    assert.equal(registry.get("opencode"), undefined);
    assert.equal(registry.list().length, 1);
  });

  it("validates its input and mutates nothing", () => {
    const input = Object.freeze({ projectRoot: "/proj" });
    createProductionRegistry(input);
    assert.deepEqual(input, { projectRoot: "/proj" });
    assert.throws(
      () => createProductionRegistry({ projectRoot: "" }),
      /projectRoot must be a non-empty string/,
    );
    assert.throws(
      () => createProductionRegistry("nope" as never),
      /expected a registry input object/,
    );
  });

  it("constructs without detecting, installing, configuring, or touching I/O", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "providers", "integration-production.ts"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(
      importedModules.sort(),
      ["./integration-registry", "./speckit-install"],
      "existing install-capable factory reused, nothing else imported",
    );
    assert.ok(!/\.detect\(|\.install\(|\.configure\(|loadConfig|validateConfig/.test(code), "no detection, install, or config calls");
    assert.ok(!/child_process|spawn|exec|fs\.|readFile|writeFile|mkdir/i.test(code), "no processes or filesystem");
    assert.ok(!/delegate|opencode|skillRoots|skillName/i.test(code), "no delegate skill or OpenCode invention");
    assert.ok(!/specify |integration\.json|uv |pipx/.test(code), "no duplicated Spec Kit mechanics");
  });
});
