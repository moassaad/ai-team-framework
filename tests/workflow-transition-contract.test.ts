import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  WORKFLOW_STATES,
  WorkflowState,
  isTerminalState,
} from "../src/workflow/states";
import {
  WORKFLOW_TRANSITIONS,
  isValidTransition,
} from "../src/workflow/transitions";

// Transition-contract tests (T-002): the full W-002 edge set verified
// systematically. The EXPECTED set below is test data used to validate
// the implementation; `src/workflow/transitions.ts` remains the sole
// production authority. No execution, mutation, or filesystem use.
const STATES = Object.keys(WORKFLOW_STATES) as WorkflowState[];

type Edge = readonly [WorkflowState, WorkflowState];

const EXPECTED_EDGES: readonly Edge[] = [
  ["ready", "in_progress"],
  ["in_progress", "implementation_review"],
  ["in_progress", "blocked"],
  ["in_progress", "needs_user_input"],
  ["in_progress", "failed"],
  ["implementation_review", "technical_approval"],
  ["implementation_review", "changes_requested"],
  ["changes_requested", "in_progress"],
  ["technical_approval", "pm_review"],
  ["technical_approval", "changes_requested"],
  ["pm_review", "closed"],
  ["pm_review", "needs_user_input"],
  ["pm_review", "changes_requested"],
  ["needs_user_input", "in_progress"],
  ["needs_user_input", "closed"],
  ["needs_user_input", "changes_requested"],
  ["blocked", "in_progress"],
  ["blocked", "needs_user_input"],
  ["failed", "in_progress"],
  ["failed", "cancelled"],
  ["ready", "cancelled"],
  ["in_progress", "cancelled"],
  ["implementation_review", "cancelled"],
  ["technical_approval", "cancelled"],
  ["pm_review", "cancelled"],
  ["blocked", "cancelled"],
  ["needs_user_input", "cancelled"],
  ["changes_requested", "cancelled"],
  ["failed", "cancelled"],
];

const EXPECTED_KEYS = new Set(EXPECTED_EDGES.map(([from, to]) => `${from} → ${to}`));

function outgoing(from: WorkflowState): WorkflowState[] {
  return WORKFLOW_TRANSITIONS.filter((t) => t.from === from).map((t) => t.to);
}

function incoming(to: WorkflowState): WorkflowState[] {
  return WORKFLOW_TRANSITIONS.filter((t) => t.to === to).map((t) => t.from);
}

describe("workflow transition contract", () => {
  it("defines exactly the eleven approved states with two terminals", () => {
    assert.deepEqual([...STATES].sort(), [
      "blocked",
      "cancelled",
      "changes_requested",
      "closed",
      "failed",
      "implementation_review",
      "in_progress",
      "needs_user_input",
      "pm_review",
      "ready",
      "technical_approval",
    ]);
    const terminals = STATES.filter(isTerminalState);
    assert.deepEqual([...terminals].sort(), ["cancelled", "closed"]);
  });

  it("accepts every expected edge and rejects every other pair", () => {
    // 29 table rows; 28 distinct pairs because failed → cancelled has
    // two owner rows (technical-lead abort, coordinator cancel).
    assert.equal(WORKFLOW_TRANSITIONS.length, EXPECTED_EDGES.length);
    assert.equal(EXPECTED_EDGES.length, 29);
    assert.equal(EXPECTED_KEYS.size, 28);
    let invalidCount = 0;
    for (const from of STATES) {
      for (const to of STATES) {
        const expected = EXPECTED_KEYS.has(`${from} → ${to}`);
        assert.equal(
          isValidTransition(from, to),
          expected,
          `${from} → ${to} must be ${expected ? "accepted" : "rejected"}`,
        );
        if (!expected) {
          invalidCount += 1;
        }
      }
    }
    assert.equal(invalidCount, STATES.length * STATES.length - EXPECTED_KEYS.size);
  });

  it("creates no outgoing transitions from terminal states", () => {
    for (const from of ["closed", "cancelled"] as const) {
      assert.deepEqual(outgoing(from), []);
      for (const to of STATES) {
        assert.equal(isValidTransition(from, to), false, `${from} → ${to} must be absent`);
      }
    }
  });

  it("allows no bypass around required review and approval stages", () => {
    assert.deepEqual([...incoming("closed")].sort(), ["needs_user_input", "pm_review"]);
    assert.deepEqual(incoming("pm_review"), ["technical_approval"]);
    assert.deepEqual(incoming("implementation_review"), ["in_progress"]);
    assert.deepEqual(incoming("technical_approval"), ["implementation_review"]);
  });

  it("keeps stage ownership: approval decisions owned only by the Project Manager", () => {
    // The three pm_review decision edges are project-manager owned;
    // pm_review → cancelled is the coordinator's user-driven cancel.
    for (const to of ["closed", "needs_user_input", "changes_requested"] as const) {
      const found = WORKFLOW_TRANSITIONS.find((t) => t.from === "pm_review" && t.to === to);
      assert.equal(found?.owner, "project-manager", `pm_review → ${to}`);
    }
    const pmCancel = WORKFLOW_TRANSITIONS.find(
      (t) => t.from === "pm_review" && t.to === "cancelled",
    );
    assert.equal(pmCancel?.owner, "coordinator");
    for (const transition of WORKFLOW_TRANSITIONS.filter((t) => t.to === "cancelled")) {
      assert.ok(
        transition.owner === "coordinator" ||
          (transition.from === "failed" && transition.owner === "technical-lead"),
        `unexpected cancellation owner for ${transition.from}`,
      );
    }
    const retry = WORKFLOW_TRANSITIONS.find((t) => t.from === "failed" && t.to === "in_progress");
    assert.equal(retry?.owner, "technical-lead");
  });

  it("keeps failed exits to retry-or-abort only", () => {
    // Two owner rows share the abort pair: technical-lead abort and
    // coordinator cancel, plus the single retry edge.
    assert.deepEqual([...outgoing("failed")].sort(), [
      "cancelled",
      "cancelled",
      "in_progress",
    ]);
  });

  it("keeps W-002 the sole production transition source", () => {
    const dir = path.join(__dirname, "..", "..", "src", "workflow");
    const tables: string[] = [];
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(".ts")) {
        continue;
      }
      const code = fs.readFileSync(path.join(dir, entry), "utf8");
      if (/:\s*WorkflowTransition\[\]\s*=/.test(code)) {
        tables.push(entry);
      }
    }
    assert.deepEqual(tables, ["transitions.ts"]);
  });

  it("evaluates the contract deterministically", () => {
    const first = STATES.map((from) => STATES.map((to) => isValidTransition(from, to)));
    const second = STATES.map((from) => STATES.map((to) => isValidTransition(from, to)));
    assert.deepEqual(first, second);
  });
});
