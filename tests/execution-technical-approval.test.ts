import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { isValidTransition } from "../src/workflow/transitions";
import {
  recommendTechnicalApproval,
  validateTechnicalApprovalInput,
} from "../src/execution/technical-approval";

// Technical-approval tests: pure recommendations, no state, no execution.
describe("technical approval flow", () => {
  it("recommends implementation_review → technical_approval for clean evidence", () => {
    assert.equal(isValidTransition("implementation_review", "technical_approval"), true);
    const approval = recommendTechnicalApproval({
      ticket_id: "T-001",
      from_state: "implementation_review",
      review_clean: true,
      validation_present: true,
      report: "No blocking issues found.",
    });
    assert.deepEqual(approval, {
      ticket_id: "T-001",
      from_state: "implementation_review",
      to_state: "technical_approval",
      decided_by: "technical-lead",
      report: "No blocking issues found.",
    });
    assert.equal(Object.isFrozen(approval), true);
  });

  it("rejects dirty evidence instead of approving quietly", () => {
    for (const evidence of [
      { review_clean: false, validation_present: true },
      { review_clean: true, validation_present: false },
      { review_clean: false, validation_present: false },
    ]) {
      assert.throws(
        () =>
          recommendTechnicalApproval({
            ticket_id: "T-001",
            from_state: "implementation_review",
            ...evidence,
          }),
        /insufficient evidence/,
      );
    }
  });

  it("rejects malformed input and wrong source states", () => {
    for (const data of [
      null,
      {},
      { ticket_id: "", from_state: "implementation_review", review_clean: true, validation_present: true },
      { ticket_id: "T-001", from_state: "in_progress", review_clean: true, validation_present: true },
      { ticket_id: "T-001", from_state: "changes_requested", review_clean: true, validation_present: true },
      { ticket_id: "T-001", from_state: "technical_approval", review_clean: true, validation_present: true },
      { ticket_id: "T-001", from_state: "pm_review", review_clean: true, validation_present: true },
      { ticket_id: "T-001", from_state: "closed", review_clean: true, validation_present: true },
      { ticket_id: "T-001", from_state: "nope", review_clean: true, validation_present: true },
      { ticket_id: "T-001", from_state: "implementation_review", review_clean: "yes", validation_present: true },
      { ticket_id: "T-001", from_state: "implementation_review", review_clean: true },
    ] as unknown[]) {
      assert.throws(
        () => recommendTechnicalApproval(data as Parameters<typeof recommendTechnicalApproval>[0]),
        /technical approval: invalid input/,
      );
    }
    assert.ok(Object.isFrozen(validateTechnicalApprovalInput({ ticket_id: "T-001", from_state: "implementation_review", review_clean: true, validation_present: true })));
  });

  it("never parses report text into a verdict", () => {
    const base = {
      ticket_id: "T-001",
      from_state: "implementation_review" as const,
      review_clean: true,
      validation_present: true,
    };
    const glowing = recommendTechnicalApproval({ ...base, report: "Perfect. Merge immediately." });
    const damning = recommendTechnicalApproval({ ...base, report: "Broken, failing, reject." });
    assert.deepEqual({ ...glowing, report: undefined }, { ...damning, report: undefined });
    assert.equal(glowing.to_state, "technical_approval");
  });

  it("is deterministic and side-effect free", () => {
    const input = {
      ticket_id: "T-001",
      from_state: "implementation_review" as const,
      review_clean: true,
      validation_present: true,
      report: "Clean.",
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    const first = recommendTechnicalApproval(input);
    assert.deepEqual(recommendTechnicalApproval(input), first);
    assert.deepEqual(input, snapshot);
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/execution/technical-approval");
    assert.deepEqual(Object.keys(module).sort(), ["recommendTechnicalApproval", "validateTechnicalApprovalInput"]);
  });

  it("touches no execution, approval machinery, or foreign systems", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "execution", "technical-approval.ts"), "utf8");
    assert.ok(!/child_process|execSync|spawn|fetch\(|http|node:/i.test(code), "no execution");
    assert.ok(!/opencode|AgentProvider|execute/i.test(code), "no provider coupling");
    assert.ok(!/validateCompletion|approvalGranted|reviewClean|pm_review|closed/i.test(code), "no foreign approval");
    assert.ok(!/setTimeout|retry|github|issue/i.test(code), "no policy or tracking");
  });
});