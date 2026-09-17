import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  APPROVAL_DEFAULTS,
  CONFIG_VERSION,
  PROVIDER_DEFAULTS,
  UNKNOWN_PROVIDER_KEY_POLICY,
  UNKNOWN_TOP_LEVEL_KEY_POLICY,
  WORKFLOW_DEFAULTS,
  FrameworkConfig,
} from "../src/config/schema";

// Contract tests only: they pin the schema values derived from the
// approved specification. No loading, parsing, or runtime validation here.
describe("configuration schema", () => {
  it("supports config version 1 as the only required version", () => {
    assert.equal(CONFIG_VERSION, 1);
    const minimal: FrameworkConfig = { version: CONFIG_VERSION };
    assert.equal(minimal.version, 1);
  });

  it("declares the approved approval defaults", () => {
    assert.deepEqual(APPROVAL_DEFAULTS, {
      mode: "manual",
      after: "ticket",
      sensitive_changes: "always",
      sensitive_rules: [],
    });
  });

  it("declares the approved workflow defaults", () => {
    assert.deepEqual(WORKFLOW_DEFAULTS, {
      execution: "sequential",
      default_state: "ready",
    });
  });

  it("enables only the required OpenCode provider by default", () => {
    assert.equal(PROVIDER_DEFAULTS.opencode.enabled, true);
    assert.equal(PROVIDER_DEFAULTS.speckit.enabled, false);
    assert.equal(PROVIDER_DEFAULTS.github.enabled, false);
    assert.equal(PROVIDER_DEFAULTS.delegate.enabled, false);
  });

  it("rejects unknown top-level and provider keys", () => {
    assert.equal(UNKNOWN_TOP_LEVEL_KEY_POLICY, "reject");
    assert.equal(UNKNOWN_PROVIDER_KEY_POLICY, "reject");
  });
});
