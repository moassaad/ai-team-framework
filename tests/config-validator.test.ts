import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateConfig } from "../src/config/validator";

// Validation tests only: accept/reject behavior of the C-001 contract.
// No YAML parsing, no filesystem, no workspace, no provider execution.
describe("config validator", () => {
  it("accepts a minimal config and fills approved defaults", () => {
    assert.deepEqual(validateConfig({ version: 1 }), {
      version: 1,
      approval: {
        mode: "manual",
        after: "ticket",
        sensitive_changes: "always",
        sensitive_rules: [],
      },
      workflow: { execution: "sequential", default_state: "ready" },
      providers: {
        opencode: { enabled: true },
        speckit: { enabled: false },
        github: { enabled: false },
        delegate: { enabled: false },
      },
    });
  });

  it("accepts a full custom config with non-default approved values", () => {
    assert.deepEqual(
      validateConfig({
        version: 1,
        approval: {
          mode: "automatic",
          after: "sprint",
          sensitive_changes: "configured",
          sensitive_rules: ["database migrations"],
        },
        workflow: { execution: "sequential", default_state: "ready" },
        providers: {
          github: { enabled: true, owner: "acme", repo: "shop" },
          delegate: { enabled: true },
        },
      }),
      {
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
          speckit: { enabled: false },
          github: { enabled: true, owner: "acme", repo: "shop" },
          delegate: { enabled: true },
        },
      },
    );
  });

  it("rejects invalid root values without coercing them", () => {
    for (const data of [null, "version: 1", 1, true, ["version"]]) {
      assert.throws(() => validateConfig(data), /config: expected a configuration object/);
    }
  });

  it("requires version 1 and rejects missing or unsupported versions", () => {
    assert.throws(() => validateConfig({}), /config\.version: required field is missing/);
    for (const version of [2, "1", null, true]) {
      assert.throws(
        () => validateConfig({ version }),
        /config\.version: unsupported version/,
      );
    }
  });

  it("rejects invalid approval values and wrong types", () => {
    assert.throws(
      () => validateConfig({ version: 1, approval: { mode: "sometimes" } }),
      /config\.approval\.mode: expected one of "manual", "automatic"/,
    );
    assert.throws(
      () => validateConfig({ version: 1, approval: { after: "month" } }),
      /config\.approval\.after: expected one of "ticket", "sprint"/,
    );
    assert.throws(
      () => validateConfig({ version: 1, approval: { sensitive_changes: "rarely" } }),
      /config\.approval\.sensitive_changes: expected one of/,
    );
    assert.throws(
      () => validateConfig({ version: 1, approval: { sensitive_rules: "all" } }),
      /config\.approval\.sensitive_rules: expected an array of strings/,
    );
    assert.throws(
      () => validateConfig({ version: 1, approval: "manual" }),
      /config\.approval: expected an object/,
    );
  });

  it("rejects invalid workflow values and wrong types", () => {
    assert.throws(
      () => validateConfig({ version: 1, workflow: { execution: "parallel" } }),
      /config\.workflow\.execution: expected one of "sequential"/,
    );
    assert.throws(
      () => validateConfig({ version: 1, workflow: { default_state: 7 } }),
      /config\.workflow\.default_state: expected a string/,
    );
  });

  it("rejects unknown top-level and provider keys", () => {
    assert.throws(
      () => validateConfig({ version: 1, database: { url: "x" } }),
      /unknown top-level key/,
    );
    assert.throws(
      () => validateConfig({ version: 1, providers: { jira: { enabled: true } } }),
      /unknown provider key/,
    );
  });

  it("enforces the github owner/repo condition only when enabled", () => {
    assert.throws(
      () => validateConfig({ version: 1, providers: { github: { enabled: true } } }),
      /config\.providers\.github\.owner: required non-empty string/,
    );
    assert.throws(
      () =>
        validateConfig({
          version: 1,
          providers: { github: { enabled: true, owner: "acme" } },
        }),
      /config\.providers\.github\.repo: required non-empty string/,
    );
    // Disabled github needs neither owner nor repo.
    const validated = validateConfig({
      version: 1,
      providers: { github: { owner: "acme" } },
    });
    assert.deepEqual(validated.providers?.github, { enabled: false, owner: "acme" });
  });

  it("rejects wrong provider field types", () => {
    assert.throws(
      () => validateConfig({ version: 1, providers: { opencode: { enabled: "yes" } } }),
      /config\.providers\.opencode\.enabled: expected a boolean/,
    );
    assert.throws(
      () => validateConfig({ version: 1, providers: "github" }),
      /config\.providers: expected an object/,
    );
  });
});
