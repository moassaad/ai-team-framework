import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateConfig } from "../src/config/validator";
import { isAgentProvider } from "../src/providers/agent";
import {
  OPENCODE_PROVIDER_NAME,
  createOpenCodeProvider,
} from "../src/providers/opencode";
import { Integration } from "../src/providers/integration";
import { createIntegrationRegistry } from "../src/providers/integration-registry";
import { detectIntegration } from "../src/providers/integration-detection";
import { isIntegrationEnabled } from "../src/providers/integration-config";

// Foundation composition tests (I-005): I-001 through I-004 working
// as one coherent set. Each scenario keeps supported / available /
// enabled distinct using only existing seams and injected fakes —
// no new production abstraction, no external tools, no network.
function registered(name: string, detect: () => unknown) {
  const registry = createIntegrationRegistry();
  registry.register({
    name,
    capabilities: ["detect"],
    detect: detect as never,
  } as unknown as Integration);
  return registry;
}

function configured(opencodeEnabled: boolean) {
  return validateConfig({ version: 1, providers: { opencode: { enabled: opencodeEnabled } } });
}

describe("integration foundation", () => {
  it("scenario 1: enabled and detected stay three distinct facts", async () => {
    const registry = registered(OPENCODE_PROVIDER_NAME, () => ({ available: true }));
    const config = configured(true);
    assert.ok(registry.get(OPENCODE_PROVIDER_NAME) !== undefined, "supported");
    assert.equal(isIntegrationEnabled(config, OPENCODE_PROVIDER_NAME), true, "enabled");
    assert.deepEqual(await detectIntegration(registry, OPENCODE_PROVIDER_NAME), {
      status: "detected",
      result: { available: true },
    });
  });

  it("scenario 2: enabled but unavailable differs from failed detection", async () => {
    const registry = registered(OPENCODE_PROVIDER_NAME, () => ({ available: false }));
    const config = configured(true);
    assert.equal(isIntegrationEnabled(config, OPENCODE_PROVIDER_NAME), true);
    const outcome = await detectIntegration(registry, OPENCODE_PROVIDER_NAME);
    assert.deepEqual(outcome, { status: "detected", result: { available: false } });
    assert.notDeepEqual(outcome, { status: "failed" });
  });

  it("scenario 3: disabled but available never auto-enables", async () => {
    const registry = registered(OPENCODE_PROVIDER_NAME, () => ({ available: true }));
    const config = configured(false);
    assert.equal(isIntegrationEnabled(config, OPENCODE_PROVIDER_NAME), false);
    assert.deepEqual(await detectIntegration(registry, OPENCODE_PROVIDER_NAME), {
      status: "detected",
      result: { available: true },
    });
  });

  it("scenario 4: detection failure fabricates no availability", async () => {
    const registry = registered(OPENCODE_PROVIDER_NAME, () => {
      throw new Error("probe exploded");
    });
    const config = configured(true);
    assert.equal(isIntegrationEnabled(config, OPENCODE_PROVIDER_NAME), true);
    const outcome = await detectIntegration(registry, OPENCODE_PROVIDER_NAME);
    assert.deepEqual(outcome, { status: "failed", error: "probe exploded" });
    assert.ok(!("result" in outcome), "no fabricated availability");
    assert.notDeepEqual(outcome, {
      status: "detected",
      result: { available: false },
    });
  });

  it("scenario 5: configuration alone never confers registry support", async () => {
    const registry = registered(OPENCODE_PROVIDER_NAME, () => ({ available: true }));
    const config = validateConfig({
      version: 1,
      providers: { github: { enabled: true, owner: "acme", repo: "shop", managedLabel: "ai-team", specialty: "backend" } },
    });
    assert.equal(isIntegrationEnabled(config, "github"), true, "desired, not supported");
    assert.equal(registry.get("github"), undefined, "unsupported without registration");
    await assert.rejects(
      detectIntegration(registry, "github"),
      /integration detection: unknown integration "github"/,
    );
  });

  it("scenario 6: detect-only integrations participate fully", async () => {
    const registry = createIntegrationRegistry();
    registry.register({
      name: "minimal",
      capabilities: ["detect"],
      detect: () => ({ available: true }),
    });
    assert.equal(isIntegrationEnabled(configured(false), "minimal"), false);
    assert.deepEqual(await detectIntegration(registry, "minimal"), {
      status: "detected",
      result: { available: true },
    });
  });

  it("scenario 7: foundation works without Spec Kit, delegate-skills, or GitHub", async () => {
    const registry = registered(OPENCODE_PROVIDER_NAME, () => ({ available: true }));
    assert.deepEqual(
      registry.list().map((entry) => entry.name),
      [OPENCODE_PROVIDER_NAME],
    );
    assert.equal(isIntegrationEnabled(configured(true), OPENCODE_PROVIDER_NAME), true);
    assert.equal((await detectIntegration(registry, OPENCODE_PROVIDER_NAME)).status, "detected");
  });

  it("anchors the real OpenCode boundary without executing anything", () => {
    let launches = 0;
    const provider = createOpenCodeProvider(() => {
      launches += 1;
      throw new Error("must not launch");
    });
    assert.equal(isAgentProvider(provider), true);
    assert.equal(provider.name, OPENCODE_PROVIDER_NAME);
    assert.equal(launches, 0);
  });

  it("repeats fresh detection with configuration present and definitions intact", async () => {
    let present = true;
    const registry = createIntegrationRegistry();
    registry.register({
      name: OPENCODE_PROVIDER_NAME,
      capabilities: ["detect"],
      detect: () => ({ available: present }),
    });
    const config = configured(true);
    const before = JSON.stringify(registry.list());
    assert.deepEqual(await detectIntegration(registry, OPENCODE_PROVIDER_NAME), {
      status: "detected",
      result: { available: true },
    });
    present = false;
    assert.equal(isIntegrationEnabled(config, OPENCODE_PROVIDER_NAME), true);
    assert.deepEqual(await detectIntegration(registry, OPENCODE_PROVIDER_NAME), {
      status: "detected",
      result: { available: false },
    });
    assert.equal(JSON.stringify(registry.list()), before);
  });

  it("pins the foundation dependency graph with no provider coupling", () => {
    const allowed: Record<string, string[]> = {
      "integration.ts": [],
      "integration-registry.ts": ["./integration"],
      "integration-detection.ts": ["./integration", "./integration-registry"],
      "integration-config.ts": ["../config/schema"],
    };
    for (const [file, expected] of Object.entries(allowed)) {
      const source = readFileSync(join(__dirname, "..", "..", "src", "providers", file), "utf8");
      const imports = [...source.matchAll(/from "(\.[^"]+)"/g)].map((match) => match[1]);
      assert.deepEqual(imports.sort(), expected, file);
      assert.ok(!/opencode|github|spec.?kit|delegate-skills/i.test(source), `${file} names no tool`);
    }
  });
});
