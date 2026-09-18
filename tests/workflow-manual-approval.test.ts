import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FrameworkConfig } from "../src/config/schema";
import * as manualApprovalModule from "../src/workflow/manual-approval";
import {
  handleManualApprovalDecision,
  startManualApproval,
} from "../src/workflow/manual-approval";
import { isValidTransition } from "../src/workflow/transitions";

// Manual-approval tests only: gate entry, decisions, errors, scope.
// No automatic flow, sprint engine, detection, persistence, or execution.
const MANUAL: FrameworkConfig = { version: 1 };
const AUTOMATIC: FrameworkConfig = { version: 1, approval: { mode: "automatic" } };
const SPRINT: FrameworkConfig = { version: 1, approval: { after: "sprint" } };

describe("manual approval", () => {
  it("opens the gate from pm_review in manual ticket mode", () => {
    const outcome = startManualApproval(MANUAL, "pm_review", "T-1");
    assert.deepEqual(outcome, {
      status: "waiting_for_user",
      request: { ticketId: "T-1", from: "pm_review", to: "needs_user_input" },
      nextState: "needs_user_input",
    });
  });

  it("does not run in automatic mode", () => {
    assert.deepEqual(startManualApproval(AUTOMATIC, "pm_review", "T-1"), {
      status: "not_applicable",
    });
    assert.deepEqual(handleManualApprovalDecision(AUTOMATIC, "needs_user_input", "approve", "T-1"), {
      status: "not_applicable",
    });
  });

  it("approves and rejects through the specified transitions only", () => {
    assert.deepEqual(
      handleManualApprovalDecision(MANUAL, "needs_user_input", "approve", "T-1"),
      { status: "approved", nextState: "closed" },
    );
    assert.deepEqual(
      handleManualApprovalDecision(MANUAL, "needs_user_input", "reject", "T-1"),
      { status: "changes_requested", nextState: "changes_requested" },
    );
  });

  it("rejects unknown decisions deterministically", () => {
    assert.throws(
      () =>
        handleManualApprovalDecision(
          MANUAL,
          "needs_user_input",
          "maybe" as "approve",
          "T-1",
        ),
      /unknown decision/,
    );
  });

  it("rejects invocation outside the gate states", () => {
    for (const state of ["ready", "in_progress", "closed"] as const) {
      assert.throws(() => startManualApproval(MANUAL, state, "T-1"), /expected state "pm_review"/);
    }
    for (const state of ["pm_review", "closed", "in_progress"] as const) {
      assert.throws(
        () => handleManualApprovalDecision(MANUAL, state, "approve", "T-1"),
        /expected state "needs_user_input"/,
      );
    }
  });

  it("emits only transitions defined by W-002", () => {
    const edges: Array<[string, string]> = [
      ["pm_review", "needs_user_input"],
      ["needs_user_input", "closed"],
      ["needs_user_input", "changes_requested"],
    ];
    for (const [from, to] of edges) {
      assert.equal(
        isValidTransition(from as "pm_review", to as "closed"),
        true,
        `${from} → ${to}`,
      );
    }
  });

  it("never mutates its inputs", () => {
    const config: FrameworkConfig = { version: 1 };
    const before = JSON.parse(JSON.stringify(config));
    startManualApproval(config, "pm_review", "T-1");
    handleManualApprovalDecision(config, "needs_user_input", "approve", "T-1");
    assert.deepEqual(config, before);
  });

  it("defers sprint scope explicitly in both entry points", () => {
    assert.deepEqual(startManualApproval(SPRINT, "pm_review", "T-1"), {
      status: "unsupported_scope",
    });
    assert.deepEqual(
      handleManualApprovalDecision(SPRINT, "needs_user_input", "approve", "T-1"),
      { status: "unsupported_scope" },
    );
  });

  it("ignores the sensitive-change policy entirely", () => {
    for (const sensitive_changes of ["always", "configured", "never"] as const) {
      const outcome = startManualApproval(
        { version: 1, approval: { sensitive_changes } },
        "pm_review",
        "T-1",
      );
      assert.deepEqual(outcome, {
        status: "waiting_for_user",
        request: { ticketId: "T-1", from: "pm_review", to: "needs_user_input" },
        nextState: "needs_user_input",
      });
    }
  });

  it("is deterministic across repeated calls", () => {
    assert.deepEqual(
      startManualApproval(MANUAL, "pm_review", "T-1"),
      startManualApproval(MANUAL, "pm_review", "T-1"),
    );
    assert.deepEqual(
      handleManualApprovalDecision(MANUAL, "needs_user_input", "reject", "T-1"),
      handleManualApprovalDecision(MANUAL, "needs_user_input", "reject", "T-1"),
    );
  });

  it("exposes no execution, persistence, or flow API", () => {
    assert.deepEqual(Object.keys(manualApprovalModule).sort(), [
      "handleManualApprovalDecision",
      "startManualApproval",
    ]);
  });
});
