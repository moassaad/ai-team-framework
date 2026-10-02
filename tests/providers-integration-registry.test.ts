import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { supportsCapability } from "../src/providers/integration";
import { createIntegrationRegistry } from "../src/providers/integration-registry";

// Registry tests only: catalog behavior over injected fakes.
// No detection, installation, configuration, or external access.
function detectOnly(name: string, calls: { detect: number; install: number }): Record<string, unknown> {
  return {
    name,
    capabilities: ["detect"],
    detect: () => {
      calls.detect += 1;
      return { available: true };
    },
  };
}

describe("integration registry", () => {
  it("registers and retrieves integrations by stable identifier", () => {
    const registry = createIntegrationRegistry();
    const calls = { detect: 0, install: 0 };
    registry.register(
      detectOnly("example", calls) as unknown as Parameters<typeof registry.register>[0],
    );
    const found = registry.get("example");
    assert.ok(found !== undefined);
    assert.equal(found.name, "example");
    assert.deepEqual([...found.capabilities], ["detect"]);
    assert.equal(Object.isFrozen(found), true);
  });

  it("lists multiple registrations deterministically in registration order", () => {
    const registry = createIntegrationRegistry();
    const calls = { detect: 0, install: 0 };
    const register = (name: string): void => {
      registry.register(
        detectOnly(name, calls) as unknown as Parameters<typeof registry.register>[0],
      );
    };
    register("beta");
    register("alpha");
    register("gamma");
    assert.deepEqual(
      registry.list().map((entry) => entry.name),
      ["beta", "alpha", "gamma"],
    );
    assert.deepEqual(
      registry.list().map((entry) => entry.name),
      ["beta", "alpha", "gamma"],
    );
  });

  it("rejects duplicate identifiers without replacing the original", () => {
    const registry = createIntegrationRegistry();
    const calls = { detect: 0, install: 0 };
    const first = detectOnly("example", calls);
    registry.register(first as unknown as Parameters<typeof registry.register>[0]);
    assert.throws(
      () =>
        registry.register({
          name: "example",
          capabilities: ["detect"],
          detect: () => ({ available: false }),
        }),
      /integration registry: duplicate integration "example"/,
    );
    assert.equal(registry.list().length, 1);
    assert.deepEqual(registry.get("example")?.capabilities, ["detect"]);
  });

  it("rejects invalid registrations and keeps the registry unchanged", () => {
    const registry = createIntegrationRegistry();
    for (const bad of [
      null,
      {},
      { name: "", capabilities: ["detect"], detect: () => ({}) },
      { name: "x", capabilities: ["version"], version: () => "1.0" },
      { name: "x", capabilities: ["detect", "install"], detect: () => ({}) },
    ]) {
      assert.throws(
        () => registry.register(bad as unknown as Parameters<typeof registry.register>[0]),
        /integration/,
      );
    }
    assert.deepEqual(registry.list(), []);
    assert.equal(registry.get("x"), undefined);
  });

  it("returns undefined for unknown or non-string identifiers", () => {
    const registry = createIntegrationRegistry();
    assert.equal(registry.get("missing"), undefined);
    assert.equal(registry.get(""), undefined);
    for (const name of [null, undefined, 7, {}] as const) {
      assert.equal(registry.get(name as unknown as string), undefined);
    }
  });

  it("never executes detection or installation through registry operations", () => {
    const registry = createIntegrationRegistry();
    const calls = { detect: 0, install: 0 };
    registry.register({
      name: "example",
      capabilities: ["detect", "install"],
      detect: () => {
        calls.detect += 1;
        return { available: true };
      },
      install: async () => {
        calls.install += 1;
      },
    });
    registry.get("example");
    registry.get("missing");
    registry.list();
    assert.deepEqual(calls, { detect: 0, install: 0 });
  });

  it("preserves optional capabilities per integration", () => {
    const registry = createIntegrationRegistry();
    const calls = { detect: 0, install: 0 };
    registry.register(
      detectOnly("minimal", calls) as unknown as Parameters<typeof registry.register>[0],
    );
    registry.register({
      name: "full",
      capabilities: ["detect", "version", "install", "configure"],
      detect: () => ({ available: true }),
      version: () => "2.0.0",
      install: async () => {},
      configure: async () => {},
    });
    const minimal = registry.get("minimal");
    const full = registry.get("full");
    assert.ok(minimal !== undefined && full !== undefined);
    assert.equal(supportsCapability(minimal, "install"), false);
    assert.equal(supportsCapability(full, "install"), true);
    assert.equal(supportsCapability(full, "version"), true);
  });

  it("keeps registry instances independent", () => {
    const first = createIntegrationRegistry();
    const second = createIntegrationRegistry();
    const calls = { detect: 0, install: 0 };
    first.register(
      detectOnly("example", calls) as unknown as Parameters<typeof first.register>[0],
    );
    assert.equal(first.list().length, 1);
    assert.equal(second.list().length, 0);
    assert.equal(second.get("example"), undefined);
  });

  it("embeds no detection, installation, or provider-specific logic", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "providers", "integration-registry.ts"),
      "utf8",
    );
    assert.ok(!/\.detect\(|\.install\(|\.configure\(|\.version\(/.test(source), "never invokes capabilities");
    assert.ok(!/spawn|exec|fetch|http|child_process|node:/i.test(source), "no execution or transport");
    assert.ok(!/opencode|github|spec.?kit|delegate/i.test(source), "no provider-specific logic");
    assert.ok(!/status|enabled|ready/i.test(source), "no stored state");
  });
});
