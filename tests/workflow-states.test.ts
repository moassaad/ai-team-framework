import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as statesModule from "../src/workflow/states";
import {
  WORKFLOW_STATES,
  WorkflowState,
  isTerminalState,
  isWorkflowState,
} from "../src/workflow/states";

// State-model tests only: set, identifiers, metadata, terminal and
// group semantics. Transition rules belong to W-002 and are not tested.
const PRIMARY_STATES: readonly string[] = [
  "ready",
  "in_progress",
  "implementation_review",
  "technical_approval",
  "pm_review",
  "closed",
];
const ADDITIONAL_STATES: readonly string[] = [
  "blocked",
  "needs_user_input",
  "changes_requested",
  "failed",
  "cancelled",
];

describe("workflow states", () => {
  it("contains exactly the approved canonical states", () => {
    assert.deepEqual(Object.keys(WORKFLOW_STATES).sort(), [...PRIMARY_STATES, ...ADDITIONAL_STATES].sort());
  });

  it("uses stable identifiers and rejects the rest", () => {
    const state: WorkflowState = "in_progress";
    assert.equal(isWorkflowState(state), true);
    for (const id of [...PRIMARY_STATES, ...ADDITIONAL_STATES]) {
      assert.equal(isWorkflowState(id), true);
    }
    for (const notId of ["done", "archived", "Ready", "in-progress", "", null, 3]) {
      assert.equal(isWorkflowState(notId), false);
    }
  });

  it("carries consistent metadata for every state", () => {
    for (const [id, meta] of Object.entries(WORKFLOW_STATES)) {
      assert.ok(meta.kind === "normal" || meta.kind === "exceptional", `bad kind: ${id}`);
      assert.equal(typeof meta.terminal, "boolean", `bad terminal flag: ${id}`);
      assert.ok(meta.description.length > 0, `missing description: ${id}`);
    }
  });

  it("marks closed and cancelled terminal and nothing else", () => {
    assert.equal(isTerminalState("closed"), true);
    assert.equal(isTerminalState("cancelled"), true);
    for (const id of [...PRIMARY_STATES, ...ADDITIONAL_STATES]) {
      if (id !== "closed" && id !== "cancelled") {
        assert.equal(isTerminalState(id as WorkflowState), false, `${id} must not be terminal`);
      }
    }
  });

  it("distinguishes normal from exceptional states", () => {
    for (const id of PRIMARY_STATES) {
      assert.equal(WORKFLOW_STATES[id as WorkflowState].kind, "normal");
    }
    for (const id of ADDITIONAL_STATES) {
      assert.equal(WORKFLOW_STATES[id as WorkflowState].kind, "exceptional");
    }
  });

  it("offers ready as the configured default state without duplicating config", () => {
    assert.equal(isWorkflowState("ready"), true);
    assert.equal(WORKFLOW_STATES.ready.terminal, false);
    assert.equal(WORKFLOW_STATES.ready.kind, "normal");
  });

  it("exposes no transition graph or execution API", () => {
    assert.deepEqual(Object.keys(statesModule).sort(), [
      "WORKFLOW_STATES",
      "isTerminalState",
      "isWorkflowState",
    ]);
  });
});
