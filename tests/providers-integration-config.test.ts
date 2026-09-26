import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config/loader";
import { validateConfig } from "../src/config/validator";
import { isIntegrationEnabled } from "../src/providers/integration-config";
import { createIntegrationRegistry } from "../src/providers/integration-registry";
import { detectIntegration } from "../src/providers/integration-detection";
import { withTempProject } from "./helpers/temp-project";

// Desired-state tests only: generic enabled/disabled reads over the
// existing config system, with separation from detection proven
// behaviorally and structurally. No external tools or network.
describe("integration desired state", () => {
  it("reads explicit enablement per integration", () => {
    const config = validateConfig({
      version: 1,
      providers: {
        delegate: { enabled: true },
        speckit: { enabled: false },
        github: { enabled: true, owner: "acme", repo: "shop", managedLabel: "ai-team", specialty: "backend" },
        opencode: { enabled: true },
      },
    });
    assert.equal(isIntegrationEnabled(config, "delegate"), true);
    assert.equal(isIntegrationEnabled(config, "speckit"), false);
    assert.equal(isIntegrationEnabled(config, "github"), true);
    assert.equal(isIntegrationEnabled(config, "opencode"), true);
  });

  it("follows established defaults for unspecified integrations", () => {
    const config = validateConfig({ version: 1 });
    // Required provider on; optional integrations off unless opted in.
    assert.equal(isIntegrationEnabled(config, "opencode"), true);
    assert.equal(isIntegrationEnabled(config, "speckit"), false);
    assert.equal(isIntegrationEnabled(config, "github"), false);
    assert.equal(isIntegrationEnabled(config, "delegate"), false);
    assert.equal(isIntegrationEnabled({ version: 1 }, "delegate"), false);
  });

  it("treats unknown names as not wanted without throwing", () => {
    const config = validateConfig({ version: 1 });
    assert.equal(isIntegrationEnabled(config, "spec-kit"), false);
    assert.equal(isIntegrationEnabled(config, " marketplace "), false);
  });

  it("rejects malformed configuration input and non-boolean flags", () => {
    for (const config of [null, [], "x", 7]) {
      assert.throws(
        () => isIntegrationEnabled(config as never, "delegate"),
        /integration config: expected a validated framework configuration object/,
      );
    }
    for (const name of ["", 7, null] as const) {
      assert.throws(
        () => isIntegrationEnabled({ version: 1 }, name as unknown as string),
        /integration config: expected a non-empty integration name/,
      );
    }
    assert.throws(
      () => isIntegrationEnabled({ version: 1, providers: 7 } as never, "delegate"),
      /integration config: expected a providers section object/,
    );
    assert.throws(
      () =>
        isIntegrationEnabled(
          { version: 1, providers: { delegate: "yes" } } as never,
          "delegate",
        ),
      /integration config: expected providers\.delegate to be an object/,
    );
    assert.throws(
      () =>
        isIntegrationEnabled(
          { version: 1, providers: { delegate: { enabled: "yes" } } } as never,
          "delegate",
        ),
      /integration config: expected providers\.delegate\.enabled to be a boolean/,
    );
    // The validator itself rejects the same value consistently.
    assert.throws(
      () => validateConfig({ version: 1, providers: { delegate: { enabled: "yes" } } }),
      /providers\.delegate\.enabled/,
    );
  });

  it("loads configuration files without invoking detection", () => {
    const calls = { detect: 0 };
    const registry = createIntegrationRegistry();
    registry.register({
      name: "delegate",
      capabilities: ["detect"],
      detect: () => {
        calls.detect += 1;
        return { available: true };
      },
    });
    const before = JSON.stringify(registry.list());
    withTempProject(
      { ".ai-team/config.yaml": "version: 1\nproviders:\n  delegate:\n    enabled: true\n" },
      (root) => {
        const config = validateConfig(loadConfig(root));
        assert.equal(isIntegrationEnabled(config, "delegate"), true);
      },
    );
    assert.equal(calls.detect, 0);
    assert.equal(JSON.stringify(registry.list()), before);
  });

  it("keeps enabled independent from availability in both directions", async () => {
    const enabled = validateConfig({
      version: 1,
      providers: { delegate: { enabled: true } },
    });
    const failing = createIntegrationRegistry();
    failing.register({
      name: "delegate",
      capabilities: ["detect"],
      detect: () => {
        throw new Error("probe exploded");
      },
    });
    assert.equal(isIntegrationEnabled(enabled, "delegate"), true);
    assert.deepEqual(await detectIntegration(failing, "delegate"), {
      status: "failed",
      error: "probe exploded",
    });

    const disabled = validateConfig({
      version: 1,
      providers: { delegate: { enabled: false } },
    });
    const present = createIntegrationRegistry();
    present.register({
      name: "delegate",
      capabilities: ["detect"],
      detect: () => ({ available: true }),
    });
    assert.equal(isIntegrationEnabled(disabled, "delegate"), false);
    assert.deepEqual(await detectIntegration(present, "delegate"), {
      status: "detected",
      result: { available: true },
    });
  });

  it("keeps the config system free of detection and provider coupling", () => {
    for (const entry of ["loader.ts", "validator.ts", "schema.ts", "defaults.ts"]) {
      const source = readFileSync(join(__dirname, "..", "..", "src", "config", entry), "utf8");
      assert.ok(!/from ["']\.\.\/providers/.test(source), `${entry} imports no provider module`);
      assert.ok(!/detectIntegration|\.detect\(/.test(source), `${entry} performs no detection`);
    }
    const bridge = readFileSync(
      join(__dirname, "..", "..", "src", "providers", "integration-config.ts"),
      "utf8",
    );
    const imports = [...bridge.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(imports, ["../config/schema"]);
  });
});
