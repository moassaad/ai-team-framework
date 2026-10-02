import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Integration,
  isDetectionResult,
  isIntegration,
  isIntegrationCapability,
  supportsCapability,
  validateDetectionResult,
  validateIntegration,
} from "../src/providers/integration";

// Integration-contract tests only: capability model, validation, and
// detection/configuration separation. No provider, installation, or
// external access.
describe("integration contract", () => {
  it("accepts a detect-only integration without optional capabilities", () => {
    const integration = validateIntegration({
      name: "example",
      capabilities: ["detect"],
      detect: () => ({ available: true }),
    });
    assert.equal(integration.name, "example");
    assert.deepEqual([...integration.capabilities], ["detect"]);
    assert.equal(Object.isFrozen(integration), true);
    assert.equal(supportsCapability(integration, "detect"), true);
    assert.equal(supportsCapability(integration, "version"), false);
    assert.equal(supportsCapability(integration, "install"), false);
    assert.equal(supportsCapability(integration, "configure"), false);
  });

  it("accepts declared optional capabilities backed by functions", () => {
    const integration = validateIntegration({
      name: "example",
      capabilities: ["detect", "version", "configure"],
      detect: async () => ({ available: false, detail: "not found" }),
      version: () => "1.2.3",
      configure: async () => {},
    });
    assert.equal(supportsCapability(integration, "version"), true);
    assert.equal(supportsCapability(integration, "configure"), true);
    assert.equal(supportsCapability(integration, "install"), false);
  });

  it("supports sync and async detect functions", async () => {
    const sync = validateIntegration({
      name: "sync",
      capabilities: ["detect"],
      detect: () => ({ available: true }),
    });
    const async = validateIntegration({
      name: "async",
      capabilities: ["detect"],
      detect: async () => ({ available: false }),
    });
    assert.deepEqual(await sync.detect(), { available: true });
    assert.deepEqual(await async.detect(), { available: false });
  });

  it("rejects missing detect, unknown, duplicate, and unbacked capabilities", () => {
    assert.throws(
      () =>
        validateIntegration({
          name: "example",
          capabilities: ["version"],
          version: () => "1.0.0",
        }),
      /integration: invalid input \(capabilities must include "detect"\)/,
    );
    assert.throws(
      () =>
        validateIntegration({
          name: "example",
          capabilities: ["detect", "healthCheck"],
          detect: () => ({ available: true }),
        }),
      /integration: invalid input \(unknown capability/,
    );
    assert.throws(
      () =>
        validateIntegration({
          name: "example",
          capabilities: ["detect", "detect"],
          detect: () => ({ available: true }),
        }),
      /integration: invalid input \(duplicate capability/,
    );
    assert.throws(
      () =>
        validateIntegration({
          name: "example",
          capabilities: ["detect", "install"],
          detect: () => ({ available: true }),
        }),
      /integration: invalid input \(declared capability "install" has no install function\)/,
    );
    for (const data of [null, "x", [], {}, { name: "", capabilities: ["detect"] }]) {
      assert.throws(() => validateIntegration(data), /integration: invalid input/);
    }
  });

  it("keeps detection results distinct from user configuration", () => {
    assert.deepEqual(validateDetectionResult({ available: true }), { available: true });
    assert.deepEqual(validateDetectionResult({ available: false, detail: "absent" }), {
      available: false,
      detail: "absent",
    });
    assert.equal(Object.isFrozen(validateDetectionResult({ available: true })), true);
    // Configuration-shaped fields are dropped, never carried over.
    assert.deepEqual(validateDetectionResult({ available: true, enabled: true }), {
      available: true,
    });
    for (const data of [null, {}, { available: "yes" }, { available: 1 }, []] as const) {
      assert.throws(() => validateDetectionResult(data), /integration: invalid input/);
    }
    assert.equal(isDetectionResult({ available: true }), true);
    assert.equal(isDetectionResult({ available: true, enabled: false }), true);
    assert.equal(isDetectionResult({}), false);
  });

  it("never assumes undeclared capabilities, even with same-named properties", () => {
    const loose = {
      name: "loose",
      capabilities: ["detect"],
      detect: () => ({ available: true }),
      version: () => "9.9.9",
    } as unknown as Integration;
    assert.equal(supportsCapability(loose, "version"), false);
    assert.equal(supportsCapability(loose, "detect"), true);
    assert.equal(isIntegration(loose), true);
    assert.equal(isIntegration({ name: "x" }), false);
    assert.equal(isIntegrationCapability("detect"), true);
    assert.equal(isIntegrationCapability("install"), true);
    assert.equal(isIntegrationCapability("setup"), false);
  });

  it("names no provider and imports no provider module", () => {
    const source = readFileSync(join(__dirname, "..", "..", "src", "providers", "integration.ts"), "utf8");
    assert.ok(!/^import /m.test(source), "contract module has no imports");
    assert.ok(!/opencode|github|spec.?kit|delegate/i.test(source), "no provider-specific logic");
  });
});
