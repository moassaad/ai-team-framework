import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { reportCompletion, validateCompletionReportInput } from "../src/execution/completion";

// Completion-reporting tests: eligibility reports only, no closure.
describe("completion reporting", () => {
  const manualConfig = { version: 1, approval: { mode: "manual", after: "ticket" } };
  const automaticConfig = { version: 1, approval: { mode: "automatic", after: "ticket" } };

  it("reports eligibility through W-008 in manual mode", () => {
    const report = reportCompletion({
      ticket_id: "T-001",
      config: manualConfig as Parameters<typeof reportCompletion>[0]["config"],
      from_state: "needs_user_input",
      approval_granted: true,
      review_clean: true,
      validation_present: true,
    });
    assert.deepEqual(report, { ticket_id: "T-001", eligible: true, missing: [], next_state: "closed" });
    assert.equal(Object.isFrozen(report), true);
  });

  it("reports eligibility through W-008 in automatic mode", () => {
    const report = reportCompletion({
      ticket_id: "T-001",
      config: automaticConfig as Parameters<typeof reportCompletion>[0]["config"],
      from_state: "pm_review",
      approval_granted: false,
      review_clean: true,
      validation_present: true,
    });
    assert.equal(report.eligible, true);
    assert.equal(report.next_state, "closed");
  });

  it("reports ineligibility without closing anything", () => {
    const missing = reportCompletion({
      ticket_id: "T-001",
      config: manualConfig as Parameters<typeof reportCompletion>[0]["config"],
      from_state: "needs_user_input",
      approval_granted: false,
      review_clean: true,
      validation_present: true,
    });
    assert.equal(missing.eligible, false);
    assert.deepEqual(missing.missing, ["approval"]);
    assert.equal(missing.next_state, null);
    const wrongState = reportCompletion({
      ticket_id: "T-001",
      config: manualConfig as Parameters<typeof reportCompletion>[0]["config"],
      from_state: "in_progress",
      approval_granted: true,
      review_clean: true,
      validation_present: true,
    });
    assert.equal(wrongState.eligible, false);
    assert.deepEqual(wrongState.missing, ["state"]);
    assert.equal(wrongState.next_state, null);
  });

  it("rejects malformed input without reporting", () => {
    for (const data of [
      null,
      {},
      { ticket_id: "", config: manualConfig, from_state: "needs_user_input", approval_granted: true, review_clean: true, validation_present: true },
      { ticket_id: "T-001", config: { version: 2 }, from_state: "needs_user_input", approval_granted: true, review_clean: true, validation_present: true },
      { ticket_id: "T-001", config: manualConfig, from_state: "nope", approval_granted: true, review_clean: true, validation_present: true },
      { ticket_id: "T-001", config: manualConfig, from_state: "needs_user_input", approval_granted: "yes", review_clean: true, validation_present: true },
      { ticket_id: "T-001", config: manualConfig, from_state: "needs_user_input", approval_granted: true, review_clean: true },
    ] as unknown[]) {
      assert.throws(
        () => reportCompletion(data as Parameters<typeof reportCompletion>[0]),
        /completion reporting: invalid input/,
      );
    }
    assert.ok(Object.isFrozen(validateCompletionReportInput({ ticket_id: "T-001", config: manualConfig, from_state: "needs_user_input", approval_granted: true, review_clean: true, validation_present: true })));
  });

  it("infers nothing from reports and mutates nothing", () => {
    const input = {
      ticket_id: "T-001",
      config: manualConfig,
      from_state: "needs_user_input" as const,
      approval_granted: true,
      review_clean: true,
      validation_present: true,
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    const first = reportCompletion(input as Parameters<typeof reportCompletion>[0]);
    assert.deepEqual(reportCompletion(input as Parameters<typeof reportCompletion>[0]), first);
    assert.deepEqual(input, snapshot);
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/execution/completion");
    assert.deepEqual(Object.keys(module).sort(), ["reportCompletion", "validateCompletionReportInput"]);
  });

  it("touches no execution, approval machinery, or foreign systems", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "execution", "completion.ts"), "utf8");
    assert.ok(!/child_process|execSync|spawn|fetch\(|http|node:/i.test(code), "no execution");
    assert.ok(!/opencode|AgentProvider|execute/i.test(code), "no provider coupling");
    assert.ok(!/startManualApproval|startAutomaticApproval|canCompleteTicket/i.test(code), "no approval machinery");
    assert.ok(!/github|issue|retry|telemetry/i.test(code), "no foreign systems");
  });
});