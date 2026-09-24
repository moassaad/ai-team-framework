import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { WorkflowState } from "../src/workflow/states";
import { PlanTicket } from "../src/planning/tickets";
import { generateTicketsFromPlan } from "../src/planning/tickets";
import { IssueState, mapTicketStateToIssueState } from "../src/issues/state-map";
import { extractIssueMetadata, isIssueMetadata, validateIssueMetadata } from "../src/issues/metadata";

// Metadata tests: pure transformation only, no trackers involved.
function sampleTicket(): PlanTicket {
  return {
    id: "T-001",
    title: "Catalog",
    description: "# Catalog\nList products.",
    requirements: "Build a shop.",
  };
}

describe("issue metadata extraction", () => {
  it("extracts exact metadata from a ticket and state", () => {
    const metadata = extractIssueMetadata(sampleTicket(), "in_progress");
    assert.deepEqual(metadata, {
      title: "Catalog",
      description: "# Catalog\nList products.",
      requirements: "Build a shop.",
      state: "open",
    });
    assert.equal(Object.isFrozen(metadata), true);
    assert.deepEqual(extractIssueMetadata(sampleTicket(), "closed"), {
      title: "Catalog",
      description: "# Catalog\nList products.",
      requirements: "Build a shop.",
      state: "closed",
    });
  });

  it("carries every text verbatim with no invented framing", () => {
    const ticket: PlanTicket = {
      id: "T-007",
      title: "  [T-007] Mixed CASE Title  ",
      description: "line one\n\nline two  ",
      requirements: "Do NOT rewrite; keep  spacing.",
    };
    const metadata = extractIssueMetadata(ticket, "ready");
    assert.equal(metadata.title, "  [T-007] Mixed CASE Title  ");
    assert.equal(metadata.description, "line one\n\nline two  ");
    assert.equal(metadata.requirements, "Do NOT rewrite; keep  spacing.");
    assert.ok(!("id" in metadata), "ticket identifier stays in planning");
  });

  it("derives state through G-003 for every workflow state", () => {
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
    for (const state of all) {
      const expected: IssueState = mapTicketStateToIssueState(state);
      assert.equal(extractIssueMetadata(sampleTicket(), state).state, expected, state);
    }
  });

  it("consumes P-004 output directly", () => {
    const tickets = generateTicketsFromPlan({
      requirements: "Build a shop.",
      basis: "plan",
      specification: "# Catalog\nList products.",
    });
    assert.equal(tickets.length, 1);
    const metadata = extractIssueMetadata(tickets[0] as PlanTicket, "ready");
    assert.deepEqual(metadata, {
      title: "Catalog",
      description: "# Catalog\nList products.",
      requirements: "Build a shop.",
      state: "open",
    });
  });

  it("validates metadata shapes and freezes copies", () => {
    const metadata = validateIssueMetadata({
      title: "T",
      description: "D",
      requirements: "R",
      state: "closed",
      extra: "ignored",
    });
    assert.deepEqual(metadata, { title: "T", description: "D", requirements: "R", state: "closed" });
    assert.equal(Object.isFrozen(metadata), true);
    assert.equal(isIssueMetadata(metadata), true);
    assert.equal(isIssueMetadata({ title: "T", description: "D", requirements: "R", state: "open" }), true);
    for (const data of [
      null,
      "x",
      [],
      {},
      { title: "", description: "D", requirements: "R", state: "open" },
      { title: "T", description: "", requirements: "R", state: "open" },
      { title: "T", description: "D", requirements: "", state: "open" },
      { title: "T", description: "D", state: "open" },
      { title: "T", description: "D", requirements: "R", state: "resolved" },
      { title: "T", description: "D", requirements: "R" },
    ]) {
      assert.equal(isIssueMetadata(data), false);
      assert.throws(() => validateIssueMetadata(data), /issue metadata: invalid input/);
    }
  });

  it("rejects malformed tickets and states without defaults", () => {
    const ticket = sampleTicket();
    for (const bad of [null, "x", [], {}, { ...ticket, title: "" }, { ...ticket, requirements: "" }, { id: "T-1" }]) {
      assert.throws(
        () => extractIssueMetadata(bad as unknown as PlanTicket, "ready"),
        /issue metadata: invalid input/,
      );
    }
    for (const state of [null, "", "open", "resolved", 7, [], {}]) {
      assert.throws(
        () => extractIssueMetadata(ticket, state as unknown as WorkflowState),
        /issue metadata: invalid input/,
      );
    }
    assert.throws(
      () => extractIssueMetadata({ title: "T", description: "D" } as unknown as PlanTicket, "ready"),
      /issue metadata: invalid input/,
      "missing requirements are rejected, never defaulted",
    );
  });

  it("is deterministic and never mutates caller inputs", () => {
    const ticket = sampleTicket();
    const frozen = Object.freeze({ ...ticket });
    const before = JSON.stringify(frozen);
    const first = extractIssueMetadata(frozen, "pm_review");
    const second = extractIssueMetadata(frozen, "pm_review");
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(frozen), before);
    assert.throws(() => {
      (first as { title?: string }).title = "changed";
    });
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/issues/metadata");
    assert.deepEqual(Object.keys(module).sort(), ["extractIssueMetadata", "isIssueMetadata", "validateIssueMetadata"]);
  });

  it("duplicates no state map and touches no tracker or provider", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "issues", "metadata.ts"), "utf8");
    assert.ok(!/TRANSITIONS|ready:|in_progress:|closed:/i.test(code), "no state table");
    assert.ok(!/github|octokit|gitlab|jira/i.test(code), "no tracker");
    assert.ok(!/fetch\(|http|node:/i.test(code), "no transport");
    assert.ok(!/IssueProvider|\.create\(/i.test(code), "no provider calls");
    assert.ok(!/label|milestone|assignee|priority|timestamp|uuid|token/i.test(code), "no tracker extras");
    assert.ok(!/providers\//i.test(code), "no provider import");
  });
});
