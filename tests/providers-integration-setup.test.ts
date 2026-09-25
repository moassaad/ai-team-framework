import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateDetectionResult } from "../src/providers/integration";
import { createIntegrationRegistry } from "../src/providers/integration-registry";
import { createProductionRegistry } from "../src/providers/integration-production";
import {
  planIntegrationSetup,
  runIntegrationSetup,
  SetupPlan,
  SetupResult,
} from "../src/providers/integration-setup";

// Integration setup tests (M17 U-003): injected fakes only, except
// one production-registry reuse test that asserts shape (never
// machine state). Detection/install/configure calls are counted;
// the setup layer may only call detect() freely, install()/configure()
// at most once each, and nothing else.

interface Counts {
  detect: Record<string, number>;
  install: Record<string, number>;
  configure: Record<string, number>;
}

type Behavior = () => unknown;

function fakeIntegration(
  counts: Counts,
  name: string,
  detectBehavior: Behavior,
  options: { installBehavior?: Behavior | null; configureBehavior?: Behavior | null } = {},
): Parameters<ReturnType<typeof createIntegrationRegistry>["register"]>[0] {
  const capabilities: ("detect" | "install" | "configure")[] = ["detect"];
  if (options.installBehavior !== undefined && options.installBehavior !== null) {
    capabilities.push("install");
  }
  if (options.configureBehavior !== undefined && options.configureBehavior !== null) {
    capabilities.push("configure");
  }
  return {
    name,
    capabilities: Object.freeze(capabilities) as readonly ("detect" | "install" | "configure")[],
    detect: async () => {
      counts.detect[name] = (counts.detect[name] ?? 0) + 1;
      return detectBehavior() as import("../src/providers/integration").DetectionResult;
    },
    ...(options.installBehavior === undefined || options.installBehavior === null
      ? {}
      : {
          install: async (): Promise<void> => {
            counts.install[name] = (counts.install[name] ?? 0) + 1;
            await options.installBehavior?.();
          },
        }),
    ...(options.configureBehavior === undefined || options.configureBehavior === null
      ? {}
      : {
          configure: async (): Promise<void> => {
            counts.configure[name] = (counts.configure[name] ?? 0) + 1;
            await (options.configureBehavior as Behavior)();
          },
        }),
  };
}

const present = (detail = "there") => validateDetectionResult({ available: true, detail });
const absent = (detail: string) => validateDetectionResult({ available: false, detail });
const failWith = (message: string): Behavior => () => {
  throw new Error(message);
};
const succeedVoid: Behavior = () => undefined;

interface Scenario {
  behaviors: Record<string, { detect: Behavior; install?: Behavior | null; configure?: Behavior | null }>;
  enabled: Record<string, boolean>;
}

function setupScenario(scenario: Scenario): {
  counts: Counts;
  registry: ReturnType<typeof createIntegrationRegistry>;
  enabled: Record<string, boolean>;
} {
  const counts: Counts = { detect: {}, install: {}, configure: {} };
  const registry = createIntegrationRegistry();
  for (const [name, behavior] of Object.entries(scenario.behaviors)) {
    registry.register(
      fakeIntegration(counts, name, behavior.detect, {
        installBehavior: behavior.install,
        configureBehavior: behavior.configure,
      }),
    );
  }
  return { counts, registry, enabled: { ...scenario.enabled } };
}

function planInput(fixture: ReturnType<typeof setupScenario>, name: string) {
  return {
    registry: fixture.registry,
    name,
    isEnabled: (candidate: string) => fixture.enabled[candidate] ?? false,
  };
}

describe("integration setup", () => {
  it("already-ready integrations are a no-op without invoking anything", async () => {
    const fixture = setupScenario({
      behaviors: { "spec-kit": { detect: () => present(), install: succeedVoid } },
      enabled: { "spec-kit": true },
    });
    const plan = await planIntegrationSetup(planInput(fixture, "spec-kit"));
    assert.equal(plan.action, null);
    assert.equal(plan.reason, "already-ready");
    assert.equal(plan.confirmationRequired, false);
    assert.match(plan.explanation, /already ready/);
    const result = await runIntegrationSetup({ ...planInput(fixture, "spec-kit"), confirmed: true });
    assert.equal(result.mutated, false);
    assert.equal(result.verified, false);
    assert.deepEqual(fixture.counts.install, {}, "install never invoked");
    assert.deepEqual(fixture.counts.configure, {}, "configure never invoked");
    assert.deepEqual(fixture.counts.detect, { "spec-kit": 2 }, "plan + run plan only");
  });

  it("unavailable integrations with install propose installation", async () => {
    const fixture = setupScenario({
      behaviors: { "spec-kit": { detect: () => absent("not installed"), install: succeedVoid } },
      enabled: { "spec-kit": true },
    });
    const plan: SetupPlan = await planIntegrationSetup(planInput(fixture, "spec-kit"));
    assert.equal(plan.action, "install");
    assert.equal(plan.reason, "proposed-install");
    assert.equal(plan.confirmationRequired, true);
    assert.match(plan.explanation, /proposes install/);
    assert.match(plan.explanation, /Confirmation required/);
    assert.deepEqual(fixture.counts.install, {}, "planning never mutates");
  });

  it("unavailable integrations without install report bounded inability", async () => {
    const fixture = setupScenario({
      behaviors: { "spec-kit": { detect: () => absent("not installed") } },
      enabled: { "spec-kit": true },
    });
    const plan = await planIntegrationSetup(planInput(fixture, "spec-kit"));
    assert.equal(plan.action, null);
    assert.equal(plan.reason, "no-mutation-capability");
    assert.equal(plan.confirmationRequired, false);
    assert.match(plan.explanation, /cannot set up automatically/);
    const result = await runIntegrationSetup({ ...planInput(fixture, "spec-kit"), confirmed: true });
    assert.equal(result.mutated, false);
    assert.match(result.message, /cannot set up automatically/);
  });

  it("configure-only integrations propose configuration", async () => {
    const fixture = setupScenario({
      behaviors: { tracker: { detect: () => absent("needs token"), configure: succeedVoid } },
      enabled: { tracker: true },
    });
    const plan = await planIntegrationSetup(planInput(fixture, "tracker"));
    assert.equal(plan.action, "configure");
    assert.equal(plan.reason, "proposed-configure");
    assert.equal(plan.confirmationRequired, true);
  });

  it("detection failure mutates nothing and retains the distinction", async () => {
    const fixture = setupScenario({
      behaviors: { "spec-kit": { detect: failWith("probe exploded"), install: succeedVoid } },
      enabled: { "spec-kit": true },
    });
    const plan = await planIntegrationSetup(planInput(fixture, "spec-kit"));
    assert.equal(plan.action, null);
    assert.equal(plan.reason, "detection-failed");
    assert.equal(plan.detectionFailed, true);
    assert.match(plan.explanation, /detection failed/);
    const result = await runIntegrationSetup({ ...planInput(fixture, "spec-kit"), confirmed: true });
    assert.equal(result.mutated, false);
    assert.equal(result.verified, false);
    assert.deepEqual(fixture.counts.install, {}, "no install after detection failure");
    assert.deepEqual(fixture.counts.detect, { "spec-kit": 2 }, "no verification detection");
  });

  it("withheld confirmation mutates nothing", async () => {
    const fixture = setupScenario({
      behaviors: { "spec-kit": { detect: () => absent("not installed"), install: succeedVoid } },
      enabled: { "spec-kit": true },
    });
    const result = await runIntegrationSetup({ ...planInput(fixture, "spec-kit"), confirmed: false });
    assert.equal(result.mutated, false);
    assert.equal(result.verified, false);
    assert.equal(result.action, "install");
    assert.match(result.message, /requires explicit confirmation; nothing was changed/);
    assert.deepEqual(fixture.counts.install, {});
    assert.deepEqual(fixture.counts.detect, { "spec-kit": 1 });
  });

  it("granted confirmation mutates exactly once then verifies", async () => {
    let available = false;
    const fixture = setupScenario({
      behaviors: {
        "spec-kit": {
          detect: () => (available ? present("installed just now") : absent("not installed")),
          install: () => {
            available = true;
          },
        },
      },
      enabled: { "spec-kit": true },
    });
    const result: SetupResult = await runIntegrationSetup({ ...planInput(fixture, "spec-kit"), confirmed: true });
    assert.equal(result.mutated, true);
    assert.equal(result.verified, true);
    assert.equal(result.detected, true);
    assert.match(result.message, /completed and verified/);
    assert.deepEqual(fixture.counts.install, { "spec-kit": 1 }, "exactly one mutation");
    assert.deepEqual(fixture.counts.detect, { "spec-kit": 2 }, "initial + verification");
  });

  it("mutation uses the integration capability, verified by counts and source", async () => {
    const seen: string[] = [];
    const fixture = setupScenario({
      behaviors: {
        "spec-kit": {
          detect: () => absent("not installed"),
          install: () => {
            seen.push("install-capability");
          },
        },
      },
      enabled: { "spec-kit": true },
    });
    await runIntegrationSetup({ ...planInput(fixture, "spec-kit"), confirmed: true });
    assert.deepEqual(seen, ["install-capability"]);
  });

  it("verification failure is not treated as success", async () => {
    const fixture = setupScenario({
      behaviors: { "spec-kit": { detect: () => absent("still missing"), install: succeedVoid } },
      enabled: { "spec-kit": true },
    });
    const result = await runIntegrationSetup({ ...planInput(fixture, "spec-kit"), confirmed: true });
    assert.equal(result.mutated, true);
    assert.equal(result.verified, true);
    assert.equal(result.detected, false);
    assert.match(result.message, /still reports unavailable.*not treated as success/);
  });

  it("no retry after mutation failure and no verification afterwards", async () => {
    const fixture = setupScenario({
      behaviors: { "spec-kit": { detect: () => absent("not installed"), install: failWith("network down") } },
      enabled: { "spec-kit": true },
    });
    const result = await runIntegrationSetup({ ...planInput(fixture, "spec-kit"), confirmed: true });
    assert.equal(result.mutated, true);
    assert.equal(result.verified, false);
    assert.match(result.message, /install of spec-kit failed: network down/);
    assert.deepEqual(fixture.counts.install, { "spec-kit": 1 });
    assert.deepEqual(fixture.counts.detect, { "spec-kit": 1 }, "no verification after failure");
  });

  it("no retry after verification detection failure", async () => {
    let calls = 0;
    const fixture = setupScenario({
      behaviors: {
        "spec-kit": {
          detect: () => {
            calls += 1;
            if (calls === 1) {
              return absent("not installed");
            }
            throw new Error("verification probe exploded");
          },
          install: succeedVoid,
        },
      },
      enabled: { "spec-kit": true },
    });
    const result = await runIntegrationSetup({ ...planInput(fixture, "spec-kit"), confirmed: true });
    assert.equal(result.mutated, true);
    assert.equal(result.verified, true);
    assert.equal(result.detectionFailed, true);
    assert.match(result.message, /verification detection failed/);
    assert.deepEqual(fixture.counts.detect, { "spec-kit": 2 }, "exactly initial + verification");
    assert.deepEqual(fixture.counts.install, { "spec-kit": 1 });
  });

  it("configure is never invoked when install is available", async () => {
    const fixture = setupScenario({
      behaviors: {
        both: { detect: () => absent("missing"), install: succeedVoid, configure: succeedVoid },
      },
      enabled: { both: true },
    });
    const plan = await planIntegrationSetup(planInput(fixture, "both"));
    assert.equal(plan.action, "install");
    const result = await runIntegrationSetup({ ...planInput(fixture, "both"), confirmed: true });
    assert.equal(result.mutated, true);
    assert.deepEqual(fixture.counts.install, { both: 1 });
    assert.deepEqual(fixture.counts.configure, {}, "configure untouched");
  });

  it("configure-only runs configure exactly once when confirmed", async () => {
    const fixture = setupScenario({
      behaviors: { tracker: { detect: () => absent("needs token"), configure: succeedVoid } },
      enabled: { tracker: true },
    });
    const result = await runIntegrationSetup({ ...planInput(fixture, "tracker"), confirmed: true });
    assert.equal(result.mutated, true);
    assert.deepEqual(fixture.counts.configure, { tracker: 1 });
    assert.deepEqual(fixture.counts.install, {});
  });

  it("available-but-disabled leaves configuration unchanged", async () => {
    const fixture = setupScenario({
      behaviors: { "spec-kit": { detect: () => present(), install: succeedVoid, configure: succeedVoid } },
      enabled: { "spec-kit": false },
    });
    const before = JSON.stringify(fixture.enabled);
    const plan = await planIntegrationSetup(planInput(fixture, "spec-kit"));
    assert.equal(plan.action, null);
    assert.equal(plan.reason, "available-but-disabled");
    assert.match(plan.explanation, /leaving configuration unchanged/);
    const result = await runIntegrationSetup({ ...planInput(fixture, "spec-kit"), confirmed: true });
    assert.equal(result.mutated, false);
    assert.deepEqual(fixture.counts.install, {});
    assert.deepEqual(fixture.counts.configure, {});
    assert.equal(JSON.stringify(fixture.enabled), before);
  });

  it("disabled-but-unavailable still plans from capabilities without enabling", async () => {
    const fixture = setupScenario({
      behaviors: { "spec-kit": { detect: () => absent("not installed"), install: succeedVoid } },
      enabled: { "spec-kit": false },
    });
    const plan = await planIntegrationSetup(planInput(fixture, "spec-kit"));
    assert.equal(plan.action, "install");
    assert.equal(plan.enabled, false);
    const before = JSON.stringify(fixture.enabled);
    await runIntegrationSetup({ ...planInput(fixture, "spec-kit"), confirmed: false });
    assert.equal(JSON.stringify(fixture.enabled), before, "desired state never flipped");
  });

  it("unrelated integrations are untouched", async () => {
    const fixture = setupScenario({
      behaviors: {
        "spec-kit": { detect: () => absent("not installed"), install: succeedVoid },
        delegate: { detect: () => present() },
      },
      enabled: { "spec-kit": true, delegate: false },
    });
    await runIntegrationSetup({ ...planInput(fixture, "spec-kit"), confirmed: true });
    assert.deepEqual(fixture.counts.detect["delegate"], undefined);
    assert.deepEqual(fixture.counts.install["delegate" as never] ?? undefined, undefined);
    assert.deepEqual(fixture.registry.list().map((entry) => entry.name), ["spec-kit", "delegate"]);
  });

  it("reuses the production registry without mutating through it", async () => {
    const registry = createProductionRegistry({ projectRoot: "/proj" });
    const plan = await planIntegrationSetup({ registry, name: "spec-kit", isEnabled: () => false });
    assert.equal(plan.integration, "spec-kit");
    assert.deepEqual(registry.list().map((entry) => entry.name), ["spec-kit"]);
    const result = await runIntegrationSetup({ registry, name: "spec-kit", isEnabled: () => false, confirmed: true });
    assert.equal(result.mutated, false);
    assert.deepEqual(registry.list().map((entry) => entry.name), ["spec-kit"]);
  });

  it("is deterministic and stateless", async () => {
    const first = setupScenario({
      behaviors: { "spec-kit": { detect: () => absent("not installed"), install: succeedVoid } },
      enabled: { "spec-kit": true },
    });
    const second = setupScenario({
      behaviors: { "spec-kit": { detect: () => absent("not installed"), install: succeedVoid } },
      enabled: { "spec-kit": true },
    });
    assert.deepEqual(await planIntegrationSetup(planInput(first, "spec-kit")), await planIntegrationSetup(planInput(second, "spec-kit")));
    const runFirst = await runIntegrationSetup({ ...planInput(first, "spec-kit"), confirmed: false });
    const runSecond = await runIntegrationSetup({ ...planInput(second, "spec-kit"), confirmed: false });
    assert.deepEqual(runFirst, runSecond);
    assert.ok(Object.isFrozen(runFirst));
  });

  it("validates all inputs before any detection", async () => {
    const fixture = setupScenario({
      behaviors: { "spec-kit": { detect: () => present(), install: succeedVoid } },
      enabled: { "spec-kit": true },
    });
    const valid = { ...planInput(fixture, "spec-kit"), confirmed: true };
    await assert.rejects(planIntegrationSetup({ ...planInput(fixture, "spec-kit"), name: "" }), /name must be a non-empty string/);
    await assert.rejects(planIntegrationSetup({ ...planInput(fixture, "spec-kit"), name: "missing" }), /unknown integration "missing"/);
    await assert.rejects(
      planIntegrationSetup({ ...planInput(fixture, "spec-kit"), isEnabled: "yes" as never }),
      /isEnabled must be a function/,
    );
    await assert.rejects(planIntegrationSetup({ registry: {} as never, name: "spec-kit", isEnabled: () => true }), /registry must be an integration registry/);
    await assert.rejects(runIntegrationSetup({ ...valid, confirmed: "yes" as never }), /confirmed must be a boolean/);
    await assert.rejects(runIntegrationSetup("nope" as never), /expected a setup input object/);
    assert.deepEqual(fixture.counts.detect, {}, "nothing detected on invalid input");
  });

  it("keeps provider mechanics outside the setup layer", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "providers", "integration-setup.ts"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(
      importedModules.sort(),
      ["./integration", "./integration-detection", "./integration-registry"],
      "capability check + registry + detection only",
    );
    assert.ok(!/child_process|spawn|exec\(|shell/i.test(code), "no process execution");
    assert.ok(!/specify|relay|npx|skills|uv |pipx|SKILL\.md/i.test(code), "no provider commands");
    assert.ok(!/skill|fleet|lane|model|session|resume/i.test(code), "no delegate selection invention");
    assert.ok(!/readFile|writeFile|mkdir|readdir|glob|HOME|homedir/i.test(code), "no filesystem discovery");
    assert.ok(!/retry|backoff|poll|setTimeout|setInterval|cache/i.test(code), "no retries or caches");
    assert.ok(!/\.delegate\(|coordinator|ticket|workflow/i.test(code), "no runtime leakage");
  });
});
