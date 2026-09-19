import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { WorkflowState } from "../src/workflow/states";
import { isTerminalState } from "../src/workflow/states";
import { ISSUE_STATES, isIssueState, mapTicketStateToIssueState } from "../src/issues/state-map";

// State-mapping tests: pure mapping only, no trackers involved.
describe("ticket state mapping", () => {
  it("maps every workflow state with active work open", () => {
    assert.deepEqual(ISSUE_STATES, ["open", "closed"]);
    assert.equal(isIssueState("open"), true);
    assert.equal(isIssueState("closed"), true);
    assert.equal(isIssueState("resolved"), false);
    const expected: Record<string, string> = {
      ready: "open",
      in_progress: "open",
      implementation_review: "open",
      technical_approval: "open",
      pm_review: "open",
      needs_user_input: "open",
      changes_requested: "open",
      blocked: "open",
      failed: "open",
      closed: "closed",
      cancelled: "closed",
    };
    assert.equal(Object.keys(expected).length, 11);
    for (const [state, issue] of Object.entries(expected)) {
      assert.equal(mapTicketStateToIssueState(state as WorkflowState), issue, state);
    }
  });

  it("closes exactly the terminal states", () => {
    const all: WorkflowState[] = [
      "ready",
      "in_progress",
      "implementation_review",
      "technical_approval",
      "pm_review",
      "needs_user_input",
      "changes_requested",
      "blocked",
      "failed",
      "closed",
      "cancelled",
    ];
    const closedStates = all.filter((state) => mapTicketStateToIssueState(state) === "closed");
    assert.deepEqual(closedStates, ["closed", "cancelled"]);
    for (const state of closedStates) {
      assert.equal(isTerminalState(state), true, state);
    }
  });

  it("rejects invalid input without a fallback mapping", () => {
    for (const data of [null, "", "open", "resolved", 7, [], {}]) {
      assert.throws(
        () => mapTicketStateToIssueState(data as unknown as WorkflowState),
        /issue state mapping: invalid input/,
      );
    }
  });

  it("is deterministic with no caller-visible mutation", () => {
    assert.equal(mapTicketStateToIssueState("in_progress"), mapTicketStateToIssueState("in_progress"));
    assert.equal(mapTicketStateToIssueState("closed"), "closed");
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/issues/state-map");
    assert.deepEqual(Object.keys(module).sort(), ["ISSUE_STATES", "isIssueState", "mapTicketStateToIssueState"]);
  });

  it("duplicates no workflow table and touches no tracker", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "issues", "state-map.ts"), "utf8");
    assert.ok(!/TRANSITIONS|isValidTransition/i.test(code), "no transition table");
    assert.ok(!/github|octokit|gitlab|jira/i.test(code), "no tracker");
    assert.ok(!/fetch\(|http|node:/i.test(code), "no transport");
    assert.ok(!/IssueProvider|\.create\(/i.test(code), "no provider calls");
  });
});