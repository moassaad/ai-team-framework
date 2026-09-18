import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as transitionsModule from "../src/workflow/transitions";
import {
  WORKFLOW_TRANSITIONS,
  isValidTransition,
} from "../src/workflow/transitions";
import { isWorkflowState } from "../src/workflow/states";

// Transition-table tests only: presence/absence of specification-backed
// edges, ownership, triggers, and determinism. No execution, mutation,
// guard evaluation, or approval behavior.
describe("workflow transitions", () => {
  it("contains the primary-flow edges", () => {
    for (const [from, to] of [
      ["ready", "in_progress"],
      ["in_progress", "implementation_review"],
      ["implementation_review", "technical_approval"],
      ["technical_approval", "pm_review"],
      ["pm_review", "closed"],
    ] as const) {
      assert.equal(isValidTransition(from, to), true, `${from} → ${to}`);
    }
  });

  it("contains every specified exceptional-state edge and nothing invented", () => {
    assert.equal(WORKFLOW_TRANSITIONS.length, 29);
    for (const [from, to] of [
      ["in_progress", "blocked"],
      ["in_progress", "needs_user_input"],
      ["in_progress", "failed"],
      ["implementation_review", "changes_requested"],
      ["changes_requested", "in_progress"],
      ["technical_approval", "changes_requested"],
      ["pm_review", "needs_user_input"],
      ["pm_review", "changes_requested"],
      ["needs_user_input", "in_progress"],
      ["needs_user_input", "closed"],
      ["needs_user_input", "changes_requested"],
      ["blocked", "in_progress"],
      ["blocked", "needs_user_input"],
      ["failed", "in_progress"],
      ["failed", "cancelled"],
    ] as const) {
      assert.equal(isValidTransition(from, to), true, `${from} → ${to}`);
    }
    for (const [from, to] of [
      ["failed", "ready"],
      ["blocked", "ready"],
      ["changes_requested", "ready"],
      ["in_progress", "closed"],
      ["in_progress", "pm_review"],
      ["ready", "closed"],
      ["pm_review", "in_progress"],
      ["needs_user_input", "ready"],
      ["ready", "failed"],
    ] as const) {
      assert.equal(isValidTransition(from, to), false, `${from} → ${to} must be absent`);
    }
  });

  it("uses only valid workflow states", () => {
    for (const transition of WORKFLOW_TRANSITIONS) {
      assert.equal(isWorkflowState(transition.from), true);
      assert.equal(isWorkflowState(transition.to), true);
    }
  });

  it("creates no outgoing transitions from terminal states", () => {
    for (const transition of WORKFLOW_TRANSITIONS) {
      assert.notEqual(transition.from, "closed");
      assert.notEqual(transition.from, "cancelled");
    }
  });

  it("assigns specification owners without reviewer-owned edges", () => {
    const ownerOf = (from: string, to: string): string => {
      const found = WORKFLOW_TRANSITIONS.find((t) => t.from === from && t.to === to);
      assert.ok(found, `${from} → ${to} missing`);
      return found.owner;
    };
    assert.equal(ownerOf("ready", "in_progress"), "technical-lead");
    assert.equal(ownerOf("in_progress", "implementation_review"), "implementer");
    assert.equal(ownerOf("pm_review", "closed"), "project-manager");
    assert.equal(ownerOf("needs_user_input", "in_progress"), "originating_role");
    assert.equal(ownerOf("blocked", "in_progress"), "technical-lead");
    for (const transition of WORKFLOW_TRANSITIONS) {
      assert.notEqual(transition.owner, "senior-reviewer");
      assert.ok(transition.trigger.length > 0);
    }
  });

  it("keeps cancellation user-driven under the Coordinator", () => {
    const cancellations = WORKFLOW_TRANSITIONS.filter((t) => t.to === "cancelled");
    assert.equal(cancellations.length, 10);
    const coordinatorCancels = cancellations.filter((t) => t.owner === "coordinator");
    assert.equal(coordinatorCancels.length, 9);
    for (const transition of coordinatorCancels) {
      assert.equal(transition.trigger, "User explicitly cancels");
    }
    assert.ok(
      cancellations.some((t) => t.from === "failed" && t.owner === "technical-lead"),
    );
  });

  it("is deterministic with no duplicate definitions", () => {
    const keys = WORKFLOW_TRANSITIONS.map((t) =>
      JSON.stringify([t.from, t.to, t.owner, t.trigger]),
    );
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(isValidTransition("ready", "in_progress"), isValidTransition("ready", "in_progress"));
  });

  it("exposes no mutation, execution, or approval API", () => {
    assert.deepEqual(Object.keys(transitionsModule).sort(), [
      "WORKFLOW_TRANSITIONS",
      "isValidTransition",
    ]);
    assert.equal(Object.isFrozen(WORKFLOW_TRANSITIONS), true);
  });
});
