import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config/loader";
import { validateConfig } from "../src/config/validator";
import { withTempProject } from "./helpers/temp-project";

// Configuration-validation contract tests (T-003): the validator,
// loader, and defaulting rules as one contract. Layer-specific
// behavior already covered elsewhere (config-loader, config-defaults,
// config-schema, config-validator, config-workspace, D-004
// enablement) is not duplicated; this suite fills the gaps: full
// enum acceptance, remaining type rejections, section-merge rules,
// deeper unknown-key policy, malformed input through the real
// parser, loader→validator integration, and determinism.
const FULL_VALID = {
  version: 1,
  approval: {
    mode: "automatic",
    after: "sprint",
    sensitive_changes: "configured",
    sensitive_rules: ["database migrations"],
  },
  workflow: { execution: "sequential", default_state: "ready" },
  providers: {
    opencode: { enabled: true },
    speckit: { enabled: true },
    github: { enabled: true, owner: "acme", repo: "shop" },
    delegate: { enabled: true },
  },
};

describe("configuration validation contract", () => {
  it("accepts every documented enum value", () => {
    for (const mode of ["manual", "automatic"] as const) {
      assert.equal(
        validateConfig({ version: 1, approval: { mode } }).approval?.mode,
        mode,
      );
    }
    for (const after of ["ticket", "sprint"] as const) {
      assert.equal(
        validateConfig({ version: 1, approval: { after } }).approval?.after,
        after,
      );
    }
    for (const sensitive_changes of ["always", "configured", "never"] as const) {
      assert.equal(
        validateConfig({ version: 1, approval: { sensitive_changes } }).approval
          ?.sensitive_changes,
        sensitive_changes,
      );
    }
  });

  it("rejects wrong-cased and empty enum values", () => {
    assert.throws(
      () => validateConfig({ version: 1, approval: { mode: "Manual" } }),
      /config\.approval\.mode: expected one of/,
    );
    assert.throws(
      () => validateConfig({ version: 1, approval: { after: "TICKET" } }),
      /config\.approval\.after: expected one of/,
    );
    assert.throws(
      () => validateConfig({ version: 1, approval: { sensitive_changes: "" } }),
      /config\.approval\.sensitive_changes: expected one of/,
    );
    assert.throws(
      () => validateConfig({ version: 1, workflow: { execution: "Sequential" } }),
      /config\.workflow\.execution: expected one of/,
    );
  });

  it("rejects non-object sections with the field path", () => {
    assert.throws(
      () => validateConfig({ version: 1, approval: "manual" }),
      /config\.approval: expected an object/,
    );
    assert.throws(
      () => validateConfig({ version: 1, workflow: 5 }),
      /config\.workflow: expected an object/,
    );
    assert.throws(
      () => validateConfig({ version: 1, providers: { opencode: true } }),
      /config\.providers\.opencode: expected an object/,
    );
    assert.throws(
      () => validateConfig({ version: 1, providers: { speckit: ["x"] } }),
      /config\.providers\.speckit: expected an object/,
    );
    assert.throws(
      () => validateConfig({ version: 1, providers: { github: "acme/shop" } }),
      /config\.providers\.github: expected an object/,
    );
    assert.throws(
      () => validateConfig({ version: 1, providers: { delegate: 1 } }),
      /config\.providers\.delegate: expected an object/,
    );
  });

  it("rejects mistyped provider and rule fields", () => {
    assert.throws(
      () => validateConfig({ version: 1, providers: { speckit: { enabled: "yes" } } }),
      /config\.providers\.speckit\.enabled: expected a boolean/,
    );
    assert.throws(
      () => validateConfig({ version: 1, providers: { github: { enabled: 1 } } }),
      /config\.providers\.github\.enabled: expected a boolean/,
    );
    assert.throws(
      () => validateConfig({ version: 1, approval: { sensitive_rules: ["ok", 7] } }),
      /config\.approval\.sensitive_rules: expected an array of strings/,
    );
    assert.throws(
      () =>
        validateConfig({
          version: 1,
          providers: { github: { enabled: false, owner: 5 } },
        }),
      /config\.providers\.github\.owner: expected a string/,
    );
  });

  it("requires non-empty github owner/repo exactly when enabled", () => {
    assert.throws(
      () =>
        validateConfig({
          version: 1,
          providers: { github: { enabled: true, owner: "", repo: "shop" } },
        }),
      /config\.providers\.github\.owner: required non-empty string/,
    );
    assert.throws(
      () =>
        validateConfig({
          version: 1,
          providers: { github: { enabled: true, owner: "acme", repo: "" } },
        }),
      /config\.providers\.github\.repo: required non-empty string/,
    );
    const disabled = validateConfig({
      version: 1,
      providers: { github: { enabled: false } },
    });
    assert.deepEqual(disabled.providers?.github, { enabled: false });
  });

  it("merges partial sections over defaults without touching present values", () => {
    assert.deepEqual(validateConfig({ version: 1, providers: {} }), validateConfig({ version: 1 }));
    const partial = validateConfig({
      version: 1,
      approval: { mode: "automatic" },
      workflow: { default_state: "in_progress" },
      providers: { speckit: { enabled: true } },
    });
    assert.deepEqual(partial.approval, {
      mode: "automatic",
      after: "ticket",
      sensitive_changes: "always",
      sensitive_rules: [],
    });
    assert.deepEqual(partial.workflow, { execution: "sequential", default_state: "in_progress" });
    assert.equal(partial.providers?.speckit?.enabled, true);
    assert.equal(partial.providers?.opencode?.enabled, true);
    assert.equal(partial.providers?.delegate?.enabled, false);
  });

  it("ignores unknown keys below the enforced levels", () => {
    const validated = validateConfig({
      version: 1,
      approval: { mode: "manual", extra: "dropped" },
      providers: {
        opencode: { enabled: true, extra: 1 },
        github: { enabled: false, extra: true },
      },
    });
    assert.deepEqual(validated.approval?.mode, "manual");
    assert.deepEqual(validated.providers?.opencode, { enabled: true });
    assert.deepEqual(validated.providers?.github, { enabled: false });
  });

  it("rejects scalar and array roots from the real parser path", () => {
    withTempProject({ ".ai-team/config.yaml": "just a string\n" }, (root) => {
      const loaded = loadConfig(root);
      assert.equal(loaded, "just a string");
      assert.throws(() => validateConfig(loaded), /expected a configuration object/);
    });
    withTempProject({ ".ai-team/config.yaml": "- version\n- 1\n" }, (root) => {
      assert.throws(() => validateConfig(loadConfig(root)), /expected a configuration object/);
    });
  });

  it("loads and validates a full config file end to end", () => {
    withTempProject(
      {
        ".ai-team/config.yaml": [
          "version: 1",
          "approval:",
          "  mode: automatic",
          "  after: sprint",
          "  sensitive_changes: configured",
          "  sensitive_rules:",
          "    - database migrations",
          "workflow:",
          "  execution: sequential",
          "  default_state: ready",
          "providers:",
          "  opencode:",
          "    enabled: true",
          "  speckit:",
          "    enabled: true",
          "  github:",
          "    enabled: true",
          "    owner: acme",
          "    repo: shop",
          "  delegate:",
          "    enabled: true",
          "",
        ].join("\n"),
      },
      (root) => {
        assert.deepEqual(validateConfig(loadConfig(root)), FULL_VALID);
      },
    );
  });

  it("loads a minimal file and fills defaults through validation only", () => {
    withTempProject({ ".ai-team/config.yaml": "version: 1\n" }, (root) => {
      const loaded = loadConfig(root);
      assert.deepEqual(loaded, { version: 1 });
      const validated = validateConfig(loaded);
      assert.equal(validated.providers?.delegate?.enabled, false);
      assert.equal(validated.providers?.opencode?.enabled, true);
      assert.equal(validated.approval?.mode, "manual");
    });
  });

  it("validates deterministically without mutating its input", () => {
    const before = JSON.stringify(FULL_VALID);
    const first = validateConfig(FULL_VALID);
    const second = validateConfig(FULL_VALID);
    assert.deepEqual(first, second);
    assert.deepEqual(first, FULL_VALID);
    assert.equal(JSON.stringify(FULL_VALID), before);
  });
});
