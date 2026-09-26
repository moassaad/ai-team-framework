import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDefaultConfig } from "../src/config/defaults";
import { validateConfig } from "../src/config/validator";
import { FrameworkConfig } from "../src/config/schema";
import { createIntegrationRegistry } from "../src/providers/integration-registry";
import { IntegrationRegistry } from "../src/providers/integration-registry";
import { createProductionRegistry } from "../src/providers/integration-production";
import { planIntegrationSetup } from "../src/providers/integration-setup";
import { run as runSync } from "../src/cli";
import { runStatusCommand, StatusCommandDeps } from "../src/cli-status";
import { runSetupCommand, SetupCommandDeps } from "../src/cli-setup";

// M17 lifecycle acceptance (U-005): status → setup → status through
// the real U-001/U-003 seams with hermetic stateful fakes. The only
// real production piece exercised here is registry assembly shape;
// no test depends on machine state, performs I/O, or persists
// anything. "delegate" below is an arbitrary test-double name with
// no skill semantics.

interface Counts {
  detect: Record<string, number>;
  install: Record<string, number>;
  configure: Record<string, number>;
  asked: string[];
}

function freshCounts(): Counts {
  return { detect: {}, install: {}, configure: {}, asked: [] };
}

function configWith(enabled: Record<string, boolean>): FrameworkConfig {
  const base = buildDefaultConfig();
  const providers = { ...base.providers };
  for (const [name, value] of Object.entries(enabled)) {
    providers[name as keyof typeof providers] = { enabled: value } as never;
  }
  return validateConfig({ ...base, providers });
}

const present = (detail = "there") => ({ available: true, detail });
const absent = (detail: string) => ({ available: false, detail });

interface World {
  counts: Counts;
  registry: IntegrationRegistry;
  config: FrameworkConfig;
  configSnapshot: string;
  flipped: { available: boolean };
}

function createWorld(overrides: { enabled?: Record<string, boolean>; installFlips?: boolean } = {}): World {
  const counts = freshCounts();
  const flipped = { available: false };
  const registry = createIntegrationRegistry();
  registry.register({
    name: "delegate",
    capabilities: Object.freeze(["detect", "install"] as const),
    detect: async () => {
      counts.detect["delegate"] = (counts.detect["delegate"] ?? 0) + 1;
      return (flipped.available ? present("installed") : absent("missing")) as never;
    },
    install: async (): Promise<void> => {
      counts.install["delegate"] = (counts.install["delegate"] ?? 0) + 1;
      if (overrides.installFlips !== false) {
        flipped.available = true;
      }
    },
  });
  const config = configWith({ delegate: true, ...overrides.enabled });
  return { counts, registry, config, configSnapshot: JSON.stringify(config), flipped };
}

function statusDeps(world: World): StatusCommandDeps {
  return {
    projectRoot: "/proj",
    loadConfiguration: () => world.config,
    buildRegistry: () => world.registry,
  };
}

function setupDeps(world: World, answer: boolean): SetupCommandDeps {
  return {
    projectRoot: "/proj",
    loadConfiguration: () => world.config,
    buildRegistry: () => world.registry,
    askConfirmation: async (question) => {
      world.counts.asked.push(question);
      return answer;
    },
  };
}

function checkPristine(world: World): void {
  assert.equal(JSON.stringify(world.config), world.configSnapshot, "configuration untouched");
  assert.deepEqual(world.registry.list().map((entry) => entry.name), ["delegate"], "registry intact");
}

describe("M17 lifecycle acceptance", () => {
  it("fresh production registry can be used by status", async () => {
    const first = createProductionRegistry({ projectRoot: "/proj" });
    const second = createProductionRegistry({ projectRoot: "/proj" });
    assert.deepEqual(first.list().map((entry) => entry.name), ["spec-kit"]);
    assert.deepEqual(second.list().map((entry) => entry.name), ["spec-kit"]);
    const result = await runStatusCommand({
      projectRoot: "/proj",
      loadConfiguration: () => configWith({}),
      buildRegistry: () => first,
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /^Integration status:\nspec-kit: (ready|disabled|unavailable|detection failed)/);
  });

  it("status observes a disabled integration without mutating", async () => {
    const world = createWorld({ enabled: { delegate: false } });
    world.flipped.available = true;
    const result = await runStatusCommand(statusDeps(world));
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "Integration status:\ndelegate: disabled\n");
    assert.deepEqual(world.counts.install, {}, "status never installs");
    assert.deepEqual(world.counts.configure, {});
    checkPristine(world);
  });

  it("status → declined setup → confirmed setup → status reflects verification", async () => {
    const world = createWorld();
    const initial = await runStatusCommand(statusDeps(world));
    assert.equal(initial.exitCode, 0);
    assert.ok(initial.stdout.includes("delegate: unavailable (missing)"), "initially not ready");

    const declined = await runSetupCommand(setupDeps(world, false), ["setup", "delegate"]);
    assert.equal(declined.exitCode, 0);
    assert.ok(declined.stdout.includes("Proposed action: install (proposed-install)"), "correct action proposed");
    assert.ok(declined.stdout.includes("nothing was changed"));
    assert.deepEqual(world.counts.install, {}, "declined setup performs zero mutation");

    const confirmed = await runSetupCommand(setupDeps(world, true), ["setup", "delegate"]);
    assert.equal(confirmed.exitCode, 0);
    assert.ok(confirmed.stdout.includes("completed and verified: installed."));
    assert.deepEqual(world.counts.install, { delegate: 1 }, "exactly one mutation");
    assert.deepEqual(
      world.counts.detect,
      { delegate: 1 + 2 + 3 },
      "status(1) + declined plan+replan(2) + confirmed plan+replan+verify(3), no retries",
    );

    const final = await runStatusCommand(statusDeps(world));
    assert.equal(final.exitCode, 0);
    assert.ok(final.stdout.includes("delegate: ready (installed)"), "subsequent status reflects verified state");
    checkPristine(world);
  });

  it("verification failure returns non-success and status still reports unavailable", async () => {
    const world = createWorld({ installFlips: false });
    const result = await runSetupCommand(setupDeps(world, true), ["setup", "delegate"]);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stdout.includes("not treated as success"));
    assert.deepEqual(world.counts.install, { delegate: 1 });
    const after = await runStatusCommand(statusDeps(world));
    assert.ok(after.stdout.includes("delegate: unavailable (missing)"));
    checkPristine(world);
  });

  it("unknown setup integration fails before any detection", async () => {
    const world = createWorld();
    const result = await runSetupCommand(setupDeps(world, true), ["setup", "bogus"]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /unknown integration "bogus"/);
    assert.deepEqual(world.counts.detect, {});
    assert.deepEqual(world.counts.install, {});
    checkPristine(world);
  });

  it("detection failure stays distinct from unavailable state", async () => {
    const counts = freshCounts();
    const registry = createIntegrationRegistry();
    registry.register({
      name: "opencode",
      capabilities: Object.freeze(["detect"] as const),
      detect: async () => present(),
    });
    registry.register({
      name: "delegate",
      capabilities: Object.freeze(["detect"] as const),
      detect: async () => {
        throw new Error("probe exploded");
      },
    });
    const result = await runStatusCommand({
      projectRoot: "/proj",
      loadConfiguration: () => configWith({ opencode: true, delegate: true }),
      buildRegistry: () => registry,
    });
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("opencode: ready (there)"));
    assert.ok(result.stdout.includes("delegate: detection failed (probe exploded)"));
    void counts;
  });

  it("setup failure corrupts neither registry nor configuration", async () => {
    const counts = freshCounts();
    const registry = createIntegrationRegistry();
    registry.register({
      name: "delegate",
      capabilities: Object.freeze(["detect", "install"] as const),
      detect: async () => {
        counts.detect["delegate"] = (counts.detect["delegate"] ?? 0) + 1;
        return absent("missing") as never;
      },
      install: async (): Promise<void> => {
        counts.install["delegate"] = (counts.install["delegate"] ?? 0) + 1;
        throw new Error("network down");
      },
    });
    const config = configWith({ delegate: true });
    const snapshot = JSON.stringify(config);
    const failingLoad: SetupCommandDeps = {
      projectRoot: "/proj",
      loadConfiguration: () => config,
      buildRegistry: () => registry,
      askConfirmation: async () => true,
    };
    const result = await runSetupCommand(failingLoad, ["setup", "delegate"]);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stdout.includes("install of delegate failed: network down"));
    assert.deepEqual(counts.install, { delegate: 1 }, "no retry");
    assert.equal(JSON.stringify(config), snapshot);
    assert.deepEqual(registry.list().map((entry) => entry.name), ["delegate"]);
  });

  it("repeated status and planning calls are stateless", async () => {
    const world = createWorld();
    const first = await runStatusCommand(statusDeps(world));
    const second = await runStatusCommand(statusDeps(world));
    assert.equal(first.stdout, second.stdout);
    assert.deepEqual(world.counts.detect, { delegate: 2 });
    const planInput = {
      registry: world.registry,
      name: "delegate",
      isEnabled: () => true,
    };
    assert.deepEqual(await planIntegrationSetup(planInput), await planIntegrationSetup(planInput));
  });

  it("production registry construction detects and mutates nothing", () => {
    const input = Object.freeze({ projectRoot: "/proj" });
    const registry = createProductionRegistry(input);
    assert.deepEqual(registry.list().map((entry) => entry.name), ["spec-kit"]);
    assert.equal(registry.get("delegate"), undefined, "no delegate invented");
    assert.equal(registry.get("opencode"), undefined, "no OpenCode special case");
    assert.deepEqual(input, { projectRoot: "/proj" });
  });

  it("existing non-status/non-setup CLI behavior is unchanged", () => {
    assert.equal(runSync([], "0.1.0").exitCode, 0);
    assert.match(runSync([], "0.1.0").stdout, /ai-team setup <integration> \[--yes\]/);
    assert.match(runSync([], "0.1.0").stdout, /ai-team status/);
    assert.ok(runSync(["run"], "0.1.0").stdout.includes("Coordinator"));
    assert.equal(runSync(["frobnicate"], "0.1.0").exitCode, 1);
    assert.equal(runSync(["setup"], "0.1.0").exitCode, 1, "sync path still rejects async commands");
    assert.equal(runSync(["status"], "0.1.0").exitCode, 1, "sync path still rejects async commands");
  });

  it("M17 layers reach no git, delegate-invention, or retry seams", () => {
    for (const file of [
      "providers/integration-status.ts",
      "providers/integration-production.ts",
      "providers/integration-setup.ts",
      "cli-status.ts",
      "cli-setup.ts",
    ]) {
      const source = readFileSync(join(__dirname, "..", "..", "src", file), "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
      assert.ok(!/\bgit\b|commit|merge|branch/i.test(code), `${file}: no git`);
      assert.ok(!/retry|backoff|poll|setTimeout|setInterval/i.test(code), `${file}: no retries`);
    }
    for (const file of ["providers/integration-production.ts", "cli-status.ts", "cli-setup.ts"]) {
      const source = readFileSync(join(__dirname, "..", "..", "src", file), "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
      assert.ok(!/skillRoots|skillName|fleet|lane|delegate-setup/i.test(code), `${file}: no delegate invention`);
    }
  });
});
