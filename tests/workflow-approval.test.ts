import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { APPROVAL_DEFAULTS, FrameworkConfig } from "../src/config/schema";
import {
  getApprovalPolicy,
  isAutomaticApproval,
  isManualApproval,
  sensitiveChangePolicy,
} from "../src/workflow/approval";

// Approval-policy tests only: normalization and predicates over the M2
// shape. No flows, mutation, filesystem, interaction, or sprint behavior.
describe("approval policy", () => {
  it("matches the M2 canonical defaults when approval is omitted", () => {
    assert.deepEqual(getApprovalPolicy({ version: 1 }), {
      mode: "manual",
      after: "ticket",
      sensitive_changes: "always",
    });
    assert.deepEqual(getApprovalPolicy({ version: 1 }), {
      mode: APPROVAL_DEFAULTS.mode,
      after: APPROVAL_DEFAULTS.after,
      sensitive_changes: APPROVAL_DEFAULTS.sensitive_changes,
    });
  });

  it("identifies manual and automatic modes", () => {
    const manual: FrameworkConfig = { version: 1, approval: { mode: "manual" } };
    assert.equal(isManualApproval(manual), true);
    assert.equal(isAutomaticApproval(manual), false);

    const automatic: FrameworkConfig = { version: 1, approval: { mode: "automatic" } };
    assert.equal(isManualApproval(automatic), false);
    assert.equal(isAutomaticApproval(automatic), true);
  });

  it("represents ticket and sprint scopes without a third option", () => {
    assert.equal(getApprovalPolicy({ version: 1 }).after, "ticket");
    assert.equal(
      getApprovalPolicy({ version: 1, approval: { after: "sprint" } }).after,
      "sprint",
    );
  });

  it("keeps the three sensitive-change policies distinguishable", () => {
    assert.equal(sensitiveChangePolicy({ version: 1 }), "always");
    assert.equal(
      sensitiveChangePolicy({ version: 1, approval: { sensitive_changes: "configured" } }),
      "configured",
    );
    assert.equal(
      sensitiveChangePolicy({ version: 1, approval: { sensitive_changes: "never" } }),
      "never",
    );
  });

  it("preserves present values and never mutates its input", () => {
    const config: FrameworkConfig = {
      version: 1,
      approval: { mode: "automatic", after: "sprint", sensitive_changes: "never" },
    };
    const before = JSON.parse(JSON.stringify(config));
    assert.deepEqual(getApprovalPolicy(config), {
      mode: "automatic",
      after: "sprint",
      sensitive_changes: "never",
    });
    assert.deepEqual(config, before);
  });

  it("fails deterministically on non-object input", () => {
    assert.throws(
      () => getApprovalPolicy(null as unknown as FrameworkConfig),
      /expected a validated FrameworkConfig object/,
    );
  });
});
