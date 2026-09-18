import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FrameworkConfig } from "../src/config/schema";
import * as exceptionalModule from "../src/workflow/exceptional-states";
import {
  enterBlocked,
  requestUserInput,
  resolveBlocked,
  resolveUserInput,
} from "../src/workflow/exceptional-states";
import { handleManualApprovalDecision, startManualApproval } from "../src/workflow/manual-approval";
import { startAutomaticApproval } from "../src/workflow/automatic-approval";
import { isValidTransition } from "../src/workflow/transitions";
import { WorkflowState } from "../src/workflow/states";

// Exceptional-state tests only: generic blocked/user-input entry,
// context, resolution, and approval isolation. No approval flows,
// retries, handoffs, persistence, or execution.
const MANUAL: FrameworkConfig = { version: 1 };

describe("exceptional states", () => {
  it("enters blocked from specified sources with preserved context", () => {
    const context = enterBlocked("in_progress", {
      reason: "waiting on database migration",
      resolutionNeeded: "DBA applies migration v42",
    });
    assert.deepEqual(context, {
      kind: "blocked",
      from: "in_progress",
      blocker: {
        reason: "waiting on database migration",
        resolutionNeeded: "DBA applies migration v42",
      },
    });
    for (const state of ["ready", "pm_review", "closed", "cancelled", "blocked"] as const) {
      assert.throws(() => enterBlocked(state, { reason: "x" }), /not defined|expected state/);
    }
  });

  it("keeps blocker inputs immutable", () => {
    const blocker = { reason: "x" };
    const before = JSON.parse(JSON.stringify(blocker));
    enterBlocked("in_progress", blocker);
    assert.deepEqual(blocker, before);
  });

  it("resolves blocked only toward specified destinations", () => {
    assert.deepEqual(resolveBlocked("blocked", "in_progress", "migration applied"), {
      kind: "resolved",
      from: "blocked",
      to: "in_progress",
      summary: "migration applied",
    });
    assert.deepEqual(resolveBlocked("blocked", "needs_user_input"), {
      kind: "resolved",
      from: "blocked",
      to: "needs_user_input",
      summary: undefined,
    });
    for (const destination of ["closed", "cancelled", "changes_requested"] as const) {
      assert.throws(
        () => resolveBlocked("blocked", destination as "in_progress"),
        /unsupported blocked resolution/,
      );
    }
    assert.throws(() => resolveBlocked("in_progress", "in_progress"), /expected state "blocked"/);
  });

  it("enters generic user input without touching the approval gate", () => {
    const context = requestUserInput("in_progress", {
      reason: "missing requirement clarification",
      requestedBy: "technical-lead",
      context: "which database the target uses",
      expectedResolution: "user names the database",
    });
    assert.equal(context.kind, "needs_user_input");
    assert.equal(context.from, "in_progress");
    assert.deepEqual(context.request, {
      reason: "missing requirement clarification",
      requestedBy: "technical-lead",
      context: "which database the target uses",
      expectedResolution: "user names the database",
    });
    assert.deepEqual(
      requestUserInput("blocked", { reason: "x", requestedBy: "technical-lead" }).from,
      "blocked",
    );
    assert.throws(
      () => requestUserInput("pm_review", { reason: "x", requestedBy: "y" }),
      /manual approval gate owned by W-004/,
    );
    for (const state of ["ready", "closed", "cancelled"] as const) {
      assert.throws(() => requestUserInput(state, { reason: "x", requestedBy: "y" }), /not defined/);
    }
  });

  it("resolves user input without an approval bypass", () => {
    assert.deepEqual(resolveUserInput("needs_user_input", "in_progress", "answered"), {
      kind: "resolved",
      from: "needs_user_input",
      to: "in_progress",
      summary: "answered",
    });
    assert.deepEqual(resolveUserInput("needs_user_input", "changes_requested").to, "changes_requested");
    assert.throws(
      () => resolveUserInput("needs_user_input", "closed" as "in_progress"),
      /requires manual approval/,
    );
    assert.throws(() => resolveUserInput("pm_review", "in_progress"), /expected state/);
  });

  it("leaves the W-004 manual approval flow intact", () => {
    const opened = startManualApproval(MANUAL, "pm_review", "T-9");
    assert.equal(opened.status, "waiting_for_user");
    assert.deepEqual(handleManualApprovalDecision(MANUAL, "needs_user_input", "approve", "T-9"), {
      status: "approved",
      nextState: "closed",
    });
    assert.deepEqual(handleManualApprovalDecision(MANUAL, "needs_user_input", "reject", "T-9"), {
      status: "changes_requested",
      nextState: "changes_requested",
    });
  });

  it("leaves automatic approval as the only approval-result producer", () => {
    const automatic: FrameworkConfig = { version: 1, approval: { mode: "automatic" } };
    assert.deepEqual(startAutomaticApproval(automatic, "pm_review", "T-9"), {
      status: "approved",
      nextState: "closed",
    });
    for (const result of [
      enterBlocked("in_progress", { reason: "x" }),
      requestUserInput("in_progress", { reason: "x", requestedBy: "y" }),
      resolveBlocked("blocked", "in_progress"),
      resolveUserInput("needs_user_input", "in_progress"),
    ]) {
      assert.ok((result.kind as string) !== "approved");
    }
  });

  it("rejects terminal states in every operation", () => {
    for (const state of ["closed", "cancelled"] as const) {
      assert.throws(() => enterBlocked(state, { reason: "x" }));
      assert.throws(() => requestUserInput(state, { reason: "x", requestedBy: "y" }));
      assert.throws(() => resolveBlocked(state, "in_progress"));
      assert.throws(() => resolveUserInput(state, "in_progress"));
    }
  });

  it("emits only W-002-defined edges and stays deterministic", () => {
    const emitted: Array<[WorkflowState, WorkflowState]> = [
      ["in_progress", "blocked"],
      ["blocked", "in_progress"],
      ["blocked", "needs_user_input"],
      ["in_progress", "needs_user_input"],
      ["needs_user_input", "in_progress"],
      ["needs_user_input", "changes_requested"],
    ];
    for (const [from, to] of emitted) {
      assert.equal(isValidTransition(from, to), true, `${from} → ${to}`);
    }
    assert.deepEqual(
      enterBlocked("in_progress", { reason: "x" }),
      enterBlocked("in_progress", { reason: "x" }),
    );
    assert.deepEqual(
      requestUserInput("blocked", { reason: "x", requestedBy: "y" }),
      requestUserInput("blocked", { reason: "x", requestedBy: "y" }),
    );
  });

  it("exposes no generic state mutator", () => {
    assert.deepEqual(Object.keys(exceptionalModule).sort(), [
      "enterBlocked",
      "requestUserInput",
      "resolveBlocked",
      "resolveUserInput",
    ]);
  });
});
