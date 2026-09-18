import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FrameworkConfig } from "../src/config/schema";
import * as automaticApprovalModule from "../src/workflow/automatic-approval";
import { startAutomaticApproval } from "../src/workflow/automatic-approval";
import { startManualApproval } from "../src/workflow/manual-approval";
import { isValidTransition } from "../src/workflow/transitions";
import { WorkflowState } from "../src/workflow/states";

// Automatic-approval tests only: mode gating, scope, entry state, and
// the single specified edge. No manual flow, sprint engine, detection,
// persistence, or execution.
const AUTOMATIC: FrameworkConfig = { version: 1, approval: { mode: "automatic" } };
const MANUAL: FrameworkConfig = { version: 1 };
const SPRINT: FrameworkConfig = {
  version: 1,
  approval: { mode: "automatic", after: "sprint" },
};

describe("automatic approval", () => {
  it("approves from pm_review in automatic ticket mode", () => {
    assert.deepEqual(startAutomaticApproval(AUTOMATIC, "pm_review", "T-1"), {
      status: "approved",
      nextState: "closed",
    });
  });

  it("does not run in manual mode, including the M2 default", () => {
    assert.deepEqual(startAutomaticApproval(MANUAL, "pm_review", "T-1"), {
      status: "not_applicable",
    });
    // Manual mode never reaches closed through the automatic flow,
    // while the manual flow owns that mode.
    assert.deepEqual(startManualApproval(MANUAL, "pm_review", "T-1").status, "waiting_for_user");
  });

  it("consumes exactly the specified W-002 edge without a user gate", () => {
    assert.equal(isValidTransition("pm_review", "closed"), true);
    assert.equal(isValidTransition("pm_review", "needs_user_input"), true);
    const outcome = startAutomaticApproval(AUTOMATIC, "pm_review", "T-1");
    assert.equal(outcome.status, "approved");
    if (outcome.status === "approved") {
      assert.equal(outcome.nextState, "closed");
      assert.notEqual(outcome.nextState, "needs_user_input");
    }
  });

  it("rejects every non-entry source state", () => {
    const others: WorkflowState[] = [
      "ready",
      "in_progress",
      "implementation_review",
      "needs_user_input",
      "closed",
      "changes_requested",
      "blocked",
      "failed",
      "cancelled",
      "technical_approval",
    ];
    for (const state of others) {
      assert.throws(
        () => startAutomaticApproval(AUTOMATIC, state, "T-1"),
        /expected state "pm_review"/,
        `must fail from ${state}`,
      );
    }
  });

  it("defers sprint scope without sprint machinery", () => {
    assert.deepEqual(startAutomaticApproval(SPRINT, "pm_review", "T-1"), {
      status: "unsupported_scope",
    });
  });

  it("ignores sensitive-change configuration entirely", () => {
    for (const sensitive_changes of ["always", "configured", "never"] as const) {
      const outcome = startAutomaticApproval(
        { version: 1, approval: { mode: "automatic", sensitive_changes } },
        "pm_review",
        "T-1",
      );
      assert.deepEqual(outcome, { status: "approved", nextState: "closed" });
    }
    const withRules = startAutomaticApproval(
      {
        version: 1,
        approval: { mode: "automatic", sensitive_changes: "configured", sensitive_rules: ["db"] },
      },
      "pm_review",
      "T-1",
    );
    assert.deepEqual(withRules, { status: "approved", nextState: "closed" });
  });

  it("requires a non-empty ticket id and never mutates inputs", () => {
    assert.throws(() => startAutomaticApproval(AUTOMATIC, "pm_review", ""), /non-empty ticket id/);
    const config: FrameworkConfig = { version: 1, approval: { mode: "automatic" } };
    const before = JSON.parse(JSON.stringify(config));
    startAutomaticApproval(config, "pm_review", "T-1");
    startAutomaticApproval(config, "pm_review", "T-1");
    assert.deepEqual(config, before);
  });

  it("is deterministic across repeated calls", () => {
    assert.deepEqual(
      startAutomaticApproval(AUTOMATIC, "pm_review", "T-1"),
      startAutomaticApproval(AUTOMATIC, "pm_review", "T-1"),
    );
  });

  it("exposes only the automatic approval API", () => {
    assert.deepEqual(Object.keys(automaticApprovalModule).sort(), ["startAutomaticApproval"]);
  });
});
