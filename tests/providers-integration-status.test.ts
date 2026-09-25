import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateDetectionResult } from "../src/providers/integration";
import { createIntegrationRegistry } from "../src/providers/integration-registry";
import {
  formatIntegrationStatus,
  getIntegrationStatus,
  IntegrationState,
} from "../src/providers/integration-status";

// Integration runtime state tests (M17 U-001): injected fakes only.
// The composition under test has no install, configure, git,
// persistence, retry, or config seams at all — the only calls it
// can make are registry.list() and each integration's detect().

interface Counts {
  detect: Record<string, number>;
  install: number;
  configure: number;
}

function fakeIntegration(
  counts: Counts,
  name: string,
  behavior: () => unknown,
  withOptional = false,
): Parameters<ReturnType<typeof createIntegrationRegistry>["register"]>[0] {
  return {
    name,
    capabilities: (withOptional
      ? ["detect", "install", "configure"]
      : ["detect"]) as readonly ("detect" | "install" | "configure")[],
    detect: async () => {
      counts.detect[name] = (counts.detect[name] ?? 0) + 1;
      return behavior() as import("../src/providers/integration").DetectionResult;
    },
    ...(withOptional
      ? {
          install: async (): Promise<void> => {
            counts.install += 1;
          },
          configure: async (): Promise<void> => {
            counts.configure += 1;
          },
        }
      : {}),
  };
}

const present = () => validateDetectionResult({ available: true, detail: "there" });
const absent = (detail: string) => validateDetectionResult({ available: false, detail });
const broken = (message: string) => () => {
  throw new Error(message);
};

async function runScenario(entries: {
  names: string[];
  behaviors: Record<string, () => unknown>;
  enabled: Record<string, boolean>;
  withOptional?: boolean;
}): Promise<{ counts: Counts; states: readonly IntegrationState[]; registry: ReturnType<typeof createIntegrationRegistry> }> {
  const counts: Counts = { detect: {}, install: 0, configure: 0 };
  const registry = createIntegrationRegistry();
  for (const name of entries.names) {
    registry.register(fakeIntegration(counts, name, entries.behaviors[name], entries.withOptional));
  }
  const enabled = { ...entries.enabled };
  const before = JSON.stringify(enabled);
  const states = await getIntegrationStatus({
    registry,
    isEnabled: (name) => enabled[name] ?? false,
  });
  assert.equal(JSON.stringify(enabled), before, "enabled map untouched");
  return { counts, states, registry };
}

describe("integration runtime state", () => {
  it("enabled + available derives ready", async () => {
    const { counts, states } = await runScenario({
      names: ["opencode"],
      behaviors: { opencode: async () => present() },
      enabled: { opencode: true },
    });
    assert.deepEqual(states, [
      { name: "opencode", enabled: true, detected: true, ready: true, detail: "there" },
    ]);
    assert.deepEqual(counts.detect, { opencode: 1 });
  });

  it("disabled + available derives not ready while preserving availability", async () => {
    const { states } = await runScenario({
      names: ["spec-kit"],
      behaviors: { "spec-kit": async () => present() },
      enabled: { "spec-kit": false },
    });
    assert.deepEqual(states, [
      { name: "spec-kit", enabled: false, detected: true, ready: false, detail: "disabled" },
    ]);
  });

  it("enabled + unavailable derives not ready with the detection detail", async () => {
    const { states } = await runScenario({
      names: ["delegate"],
      behaviors: { delegate: async () => absent("skill not detected") },
      enabled: { delegate: true },
    });
    assert.deepEqual(states, [
      { name: "delegate", enabled: true, detected: false, ready: false, detail: "skill not detected" },
    ]);
  });

  it("disabled + unavailable derives not ready without fabricating anything", async () => {
    const { states } = await runScenario({
      names: ["delegate"],
      behaviors: { delegate: async () => absent("skill not detected") },
      enabled: { delegate: false },
    });
    assert.deepEqual(states, [
      { name: "delegate", enabled: false, detected: false, ready: false, detail: "disabled" },
    ]);
  });

  it("ready is exactly enabled && detected across the full matrix", async () => {
    const { states } = await runScenario({
      names: ["a", "b", "c", "d"],
      behaviors: {
        a: async () => present(),
        b: async () => present(),
        c: async () => absent("nope"),
        d: async () => absent("nope"),
      },
      enabled: { a: true, b: false, c: true, d: false },
    });
    for (const state of states) {
      assert.equal(state.ready, state.enabled && state.detected, state.name);
    }
    assert.deepEqual(states.map((s) => s.ready), [true, false, false, false]);
  });

  it("detection failure stays distinguishable from unavailability", async () => {
    const { states } = await runScenario({
      names: ["rejected", "contract-breaker"],
      behaviors: {
        rejected: broken("probe exploded"),
        "contract-breaker": async () => ({ available: "yes" }),
      },
      enabled: { rejected: true, "contract-breaker": true },
    });
    assert.equal(states.length, 2);
    for (const state of states) {
      assert.equal(state.detected, false);
      assert.equal(state.ready, false);
      assert.match(state.detail ?? "", /^detection failed: /);
    }
    assert.match(states[0].detail ?? "", /probe exploded/);
    assert.match(states[1].detail ?? "", /result contract|boolean available/);
    assert.ok(
      !(states[0].detail ?? "").includes("unavailable") ||
        (states[0].detail ?? "").startsWith("detection failed:"),
      "never collapsed into plain unavailability",
    );
  });

  it("one failed integration does not hide the others, in registration order", async () => {
    const { states } = await runScenario({
      names: ["opencode", "delegate", "spec-kit"],
      behaviors: {
        opencode: async () => present(),
        delegate: broken("relay probe failed"),
        "spec-kit": async () => absent("not initialized"),
      },
      enabled: { opencode: true, delegate: true, "spec-kit": true },
    });
    assert.deepEqual(states.map((s) => s.name), ["opencode", "delegate", "spec-kit"]);
    assert.equal(states[0].ready, true);
    assert.match(states[1].detail ?? "", /^detection failed: relay probe failed$/);
    assert.equal(states[2].detail, "not initialized");
  });

  it("performs fresh detection on every status operation", async () => {
    const counts: Counts = { detect: {}, install: 0, configure: 0 };
    const registry = createIntegrationRegistry();
    registry.register(fakeIntegration(counts, "opencode", async () => present()));
    const input = { registry, isEnabled: () => true };
    await getIntegrationStatus(input);
    await getIntegrationStatus(input);
    assert.deepEqual(counts.detect, { opencode: 2 }, "no caching between calls");
  });

  it("keeps registry order stable", async () => {
    const { states, registry } = await runScenario({
      names: ["zulu", "alpha", "mike"],
      behaviors: {
        zulu: async () => present(),
        alpha: async () => present(),
        mike: async () => present(),
      },
      enabled: {},
    });
    assert.deepEqual(states.map((s) => s.name), ["zulu", "alpha", "mike"]);
    assert.deepEqual(registry.list().map((e) => e.name), ["zulu", "alpha", "mike"]);
  });

  it("never installs, configures, or mutates registry and inputs", async () => {
    const counts: Counts = { detect: {}, install: 0, configure: 0 };
    const registry = createIntegrationRegistry();
    registry.register(fakeIntegration(counts, "delegate", async () => present(), true));
    const before = registry.list().map((e) => e.name);
    const input = Object.freeze({ registry, isEnabled: () => true });
    const snapshot = JSON.stringify({ detect: counts.detect });
    await getIntegrationStatus(input);
    assert.equal(counts.install, 0, "install never called");
    assert.equal(counts.configure, 0, "configure never called");
    assert.deepEqual(registry.list().map((e) => e.name), before, "registry untouched");
    assert.equal(JSON.stringify({ detect: { delegate: 1 } }), JSON.stringify({ detect: counts.detect }));
    assert.equal(snapshot, JSON.stringify({ detect: {} }), "only detection ran");
    assert.ok(Object.isFrozen(input), "input untouched");
  });

  it("represents optional integration absence truthfully", async () => {
    const { states } = await runScenario({
      names: ["delegate"],
      behaviors: { delegate: async () => absent("delegate skill \"x\" not installed (searched 2 locations)") },
      enabled: { delegate: true },
    });
    assert.deepEqual(states, [
      {
        name: "delegate",
        enabled: true,
        detected: false,
        ready: false,
        detail: "delegate skill \"x\" not installed (searched 2 locations)",
      },
    ]);
  });

  it("is deterministic and stateless", async () => {
    const counts: Counts = { detect: {}, install: 0, configure: 0 };
    const registry = createIntegrationRegistry();
    registry.register(fakeIntegration(counts, "a", async () => present()));
    registry.register(fakeIntegration(counts, "b", broken("boom")));
    const input = { registry, isEnabled: (name: string) => name === "a" };
    const first = await getIntegrationStatus(input);
    const second = await getIntegrationStatus(input);
    assert.deepEqual(first, second);
    assert.ok(Object.isFrozen(first), "array frozen");
    for (const state of first) {
      assert.ok(Object.isFrozen(state), "states frozen");
    }
  });

  it("validates its input before detecting anything", async () => {
    const counts: Counts = { detect: {}, install: 0, configure: 0 };
    const registry = createIntegrationRegistry();
    registry.register(fakeIntegration(counts, "a", async () => present()));
    await assert.rejects(
      getIntegrationStatus({ registry, isEnabled: "yes" as unknown as (name: string) => boolean }),
      /isEnabled must be a function/,
    );
    await assert.rejects(
      getIntegrationStatus({ registry: {} as never, isEnabled: () => true }),
      /registry must be an integration registry/,
    );
    await assert.rejects(
      getIntegrationStatus({ registry, isEnabled: () => "yes" as unknown as boolean }),
      /isEnabled must return a boolean/,
    );
    await assert.rejects(
      getIntegrationStatus("nope" as never),
      /expected a status input object/,
    );
    assert.deepEqual(counts.detect, {}, "nothing detected on invalid input");
  });

  it("formats ready, disabled, unavailable, and detection-failed distinctly", () => {
    const output = formatIntegrationStatus([
      { name: "opencode", enabled: true, detected: true, ready: true },
      { name: "spec-kit", enabled: false, detected: true, ready: false, detail: "disabled" },
      { name: "delegate", enabled: true, detected: false, ready: false, detail: "skill not detected" },
      { name: "other", enabled: true, detected: false, ready: false, detail: "detection failed: probe exploded" },
    ]);
    assert.equal(
      output,
      "Integration status:\n" +
        "opencode: ready\n" +
        "spec-kit: disabled\n" +
        "delegate: unavailable (skill not detected)\n" +
        "other: detection failed (probe exploded)\n",
    );
  });

  it("formats bare details without duplicating the condition word", () => {
    const output = formatIntegrationStatus([
      { name: "a", enabled: true, detected: true, ready: true, detail: "specify 1.0" },
      { name: "b", enabled: true, detected: false, ready: false, detail: "unavailable" },
      { name: "c", enabled: true, detected: false, ready: false, detail: "detection failed: " },
    ]);
    assert.equal(
      output,
      "Integration status:\n" + "a: ready (specify 1.0)\n" + "b: unavailable\n" + "c: detection failed\n",
    );
  });

  it("formats an empty registry truthfully", () => {
    assert.equal(formatIntegrationStatus([]), "No integrations registered.\n");
  });

  it("round-trips evaluated states through the formatter", async () => {
    const { states } = await runScenario({
      names: ["opencode", "spec-kit", "delegate"],
      behaviors: {
        opencode: async () => present(),
        "spec-kit": async () => present(),
        delegate: broken("relay probe failed"),
      },
      enabled: { opencode: true, "spec-kit": false, delegate: true },
    });
    const output = formatIntegrationStatus(states);
    assert.ok(output.includes("opencode: ready (there)"));
    assert.ok(output.includes("spec-kit: disabled"));
    assert.ok(output.includes("delegate: detection failed (relay probe failed)"));
  });

  it("touches no process, filesystem, config, or git seams itself", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "providers", "integration-status.ts"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(
      importedModules.sort(),
      ["./integration-detection", "./integration-registry"],
      "registry + detection seams only",
    );
    assert.ok(!/child_process|spawn\(|exec\(|\bgit\b|commit|merge/i.test(code), "no processes or git");
    assert.ok(!/readFile|writeFile|mkdir|rmSync|fs\./i.test(code), "no filesystem");
    assert.ok(!/install|configure|version/i.test(code.replace(/integration-registry|integration-detection/g, "")), "no optional capabilities");
    assert.ok(!/yaml|loadConfig|FrameworkConfig/i.test(code), "no config loading");
    assert.ok(!/setTimeout|setInterval|retry|backoff|poll|cache/i.test(code), "no timers, retries, or caches");
  });

  it("leaves generic contracts and the CLI untouched", () => {
    for (const file of ["integration.ts", "integration-registry.ts", "integration-detection.ts", "integration-config.ts"]) {
      const foundation = readFileSync(
        join(__dirname, "..", "..", "src", "providers", file),
        "utf8",
      );
      assert.ok(!/integration-status|IntegrationState/i.test(foundation), `${file} unchanged`);
    }
    const cli = readFileSync(join(__dirname, "..", "..", "src", "cli.ts"), "utf8");
    assert.ok(!/getIntegrationStatus|runStatusCommand|providers\//.test(cli), "cli.ts keeps no status logic");
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/integration-status");
    assert.deepEqual(Object.keys(module).sort(), ["formatIntegrationStatus", "getIntegrationStatus"]);
  });
});
