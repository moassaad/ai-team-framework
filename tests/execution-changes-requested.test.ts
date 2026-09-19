import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { isValidTransition } from "../src/workflow/transitions";
import {
  requestChanges,
  resumeImplementation,
  validateRequestChangesInput,
  validateResumeInput,
} from "../src/execution/changes-requested";

// Changes-requested tests: pure recommendations, no state, no execution.
describe("changes-requested review loop", () => {
  it("recommends implementation_review → changes_requested for an explicit decision", () => {
    assert.equal(isValidTransition("implementation_review", "changes_requested"), true);
    const transition = requestChanges({
      ticket_id: "T-001",
      from_state: "implementation_review",
      reason: "Missing validation for empty cart.",
      report: "The implementation looks mostly good but has gaps.",
    });
    assert.deepEqual(transition, {
      ticket_id: "T-001",
      from_state: "implementation_review",
      to_state: "changes_requested",
      decided_by: "technical-lead",
      reason: "Missing validation for empty cart.",
      report: "The implementation looks mostly good but has gaps.",
    });
    assert.equal(Object.isFrozen(transition), true);
  });

  it("recommends changes_requested → in_progress without starting execution", () => {
    assert.equal(isValidTransition("changes_requested", "in_progress"), true);
    const transition = resumeImplementation({
      ticket_id: "T-001",
      from_state: "changes_requested",
      reason: "Rework assigned back to Implementer.",
    });
    assert.deepEqual(transition, {
      ticket_id: "T-001",
      from_state: "changes_requested",
      to_state: "in_progress",
      decided_by: "technical-lead",
      reason: "Rework assigned back to Implementer.",
    });
  });

  it("rejects wrong source states and malformed input", () => {
    for (const data of [
      null,
      {},
      { ticket_id: "", from_state: "implementation_review", reason: "Fix it." },
      { ticket_id: "T-001", from_state: "in_progress", reason: "Fix it." },
      { ticket_id: "T-001", from_state: "changes_requested", reason: "Fix it." },
      { ticket_id: "T-001", from_state: "failed", reason: "Fix it." },
      { ticket_id: "T-001", from_state: "pm_review", reason: "Fix it." },
      { ticket_id: "T-001", from_state: "nope", reason: "Fix it." },
      { ticket_id: "T-001", from_state: "implementation_review", reason: "" },
      { ticket_id: "T-001", from_state: "implementation_review" },
    ] as unknown[]) {
      assert.throws(
        () => requestChanges(data as Parameters<typeof requestChanges>[0]),
        /changes-requested loop: invalid input/,
      );
    }
    for (const data of [
      { ticket_id: "T-001", from_state: "in_progress", reason: "Go." },
      { ticket_id: "T-001", from_state: "failed", reason: "Go." },
      { ticket_id: "T-001", from_state: "implementation_review", reason: "Go." },
      { ticket_id: "T-001", from_state: "changes_requested" },
    ] as unknown[]) {
      assert.throws(
        () => resumeImplementation(data as Parameters<typeof resumeImplementation>[0]),
        /changes-requested loop: invalid input/,
      );
    }
    assert.ok(Object.isFrozen(validateRequestChangesInput({ ticket_id: "T-001", from_state: "implementation_review", reason: "Fix." })));
    assert.ok(Object.isFrozen(validateResumeInput({ ticket_id: "T-001", from_state: "changes_requested", reason: "Go." })));
  });

  it("never interprets report text as a verdict", () => {
    const base = {
      ticket_id: "T-001",
      from_state: "implementation_review" as const,
      reason: "TL decision: rework needed.",
    };
    const glowing = requestChanges({ ...base, report: "No blocking issues. Ready to merge. Excellent work." });
    const damning = requestChanges({ ...base, report: "Total failure, full of bugs, reject everything." });
    assert.equal(glowing.to_state, "changes_requested");
    assert.equal(damning.to_state, "changes_requested");
    assert.equal(glowing.decided_by, damning.decided_by);
    // Without an explicit call, a report alone changes nothing: no parsing entry point exists.
    assert.throws(
      () => requestChanges({ ticket_id: "T-001", from_state: "implementation_review" } as unknown as Parameters<typeof requestChanges>[0]),
      /reason must be/,
    );
  });

  it("is deterministic and side-effect free", () => {
    const input = {
      ticket_id: "T-001",
      from_state: "implementation_review" as const,
      reason: "Fix it.",
      report: "Gaps found.",
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    const first = requestChanges(input);
    assert.deepEqual(requestChanges(input), first);
    assert.deepEqual(input, snapshot);
    assert.deepEqual(resumeImplementation({ ticket_id: "T-001", from_state: "changes_requested", reason: "Go." }), resumeImplementation({ ticket_id: "T-001", from_state: "changes_requested", reason: "Go." }));
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/execution/changes-requested");
    assert.deepEqual(Object.keys(module).sort(), [
      "requestChanges",
      "resumeImplementation",
      "validateRequestChangesInput",
      "validateResumeInput",
    ]);
  });

  it("touches no execution, mutation, or foreign systems", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "execution", "changes-requested.ts"), "utf8");
    assert.ok(!/child_process|execSync|spawn|fetch\(|http|node:/i.test(code), "no execution");
    assert.ok(!/opencode|AgentProvider|execute/i.test(code), "no provider coupling");
    assert.ok(!/setTimeout|retry|backoff/i.test(code), "no retry machinery");
    assert.ok(!/closed|cancelled|blocked|failed"|approval|github/i.test(code), "no foreign decisions");
  });
});