import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { isValidTransition } from "../src/workflow/transitions";
import { recommendPmReview, validatePmReviewInput } from "../src/execution/pm-review";

// PM-review tests: pure recommendations, no state, no execution.
describe("pm review flow", () => {
  it("records acceptance with no transition for clean evidence", () => {
    const outcome = recommendPmReview({
      ticket_id: "T-001",
      from_state: "pm_review",
      requirements_accepted: true,
      reason: "Scope matches the agreed requirements.",
      report: "All acceptance points verified.",
    });
    assert.deepEqual(outcome, { outcome: "accepted", ticket_id: "T-001", next_state: null });
    assert.equal(Object.isFrozen(outcome), true);
  });

  it("recommends pm_review → changes_requested for requirement gaps", () => {
    assert.equal(isValidTransition("pm_review", "changes_requested"), true);
    const outcome = recommendPmReview({
      ticket_id: "T-001",
      from_state: "pm_review",
      requirements_accepted: false,
      reason: "Checkout scope missing from the agreed requirements.",
    });
    assert.deepEqual(outcome, {
      ticket_id: "T-001",
      from_state: "pm_review",
      outcome: "changes_requested",
      to_state: "changes_requested",
      decided_by: "project-manager",
      reason: "Checkout scope missing from the agreed requirements.",
    });
  });

  it("rejects malformed input and wrong source states", () => {
    for (const data of [
      null,
      {},
      { ticket_id: "", from_state: "pm_review", requirements_accepted: true, reason: "Ok." },
      { ticket_id: "T-001", from_state: "technical_approval", requirements_accepted: true, reason: "Ok." },
      { ticket_id: "T-001", from_state: "implementation_review", requirements_accepted: false, reason: "Gap." },
      { ticket_id: "T-001", from_state: "needs_user_input", requirements_accepted: true, reason: "Ok." },
      { ticket_id: "T-001", from_state: "closed", requirements_accepted: true, reason: "Ok." },
      { ticket_id: "T-001", from_state: "nope", requirements_accepted: true, reason: "Ok." },
      { ticket_id: "T-001", from_state: "pm_review", requirements_accepted: "yes", reason: "Ok." },
      { ticket_id: "T-001", from_state: "pm_review", requirements_accepted: true },
      { ticket_id: "T-001", from_state: "pm_review", requirements_accepted: true, reason: "" },
    ] as unknown[]) {
      assert.throws(
        () => recommendPmReview(data as Parameters<typeof recommendPmReview>[0]),
        /pm review: invalid input/,
      );
    }
    assert.ok(Object.isFrozen(validatePmReviewInput({ ticket_id: "T-001", from_state: "pm_review", requirements_accepted: true, reason: "Ok." })));
  });

  it("never infers acceptance from report text", () => {
    const base = {
      ticket_id: "T-001",
      from_state: "pm_review" as const,
      requirements_accepted: false,
      reason: "Gap found.",
    };
    const glowing = recommendPmReview({ ...base, report: "Perfect, accept immediately." });
    assert.equal(glowing.outcome, "changes_requested");
    if (glowing.outcome === "changes_requested") {
      assert.equal(glowing.to_state, "changes_requested");
    }
    const accepted = recommendPmReview({ ...base, requirements_accepted: true, report: "Broken, reject." });
    assert.equal(accepted.outcome, "accepted");
  });

  it("is deterministic and side-effect free", () => {
    const input = {
      ticket_id: "T-001",
      from_state: "pm_review" as const,
      requirements_accepted: false,
      reason: "Gap.",
      report: "Notes.",
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    const first = recommendPmReview(input);
    assert.deepEqual(recommendPmReview(input), first);
    assert.deepEqual(input, snapshot);
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/execution/pm-review");
    assert.deepEqual(Object.keys(module).sort(), ["recommendPmReview", "validatePmReviewInput"]);
  });

  it("touches no approval machinery, execution, or foreign systems", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "execution", "pm-review.ts"), "utf8");
    assert.ok(!/validateCompletion|approvalGranted|startManualApproval|startAutomaticApproval/i.test(code), "no approval machinery");
    assert.ok(!/child_process|execSync|spawn|fetch\(|http|node:/i.test(code), "no execution");
    assert.ok(!/opencode|AgentProvider|execute/i.test(code), "no provider coupling");
    assert.ok(!/requestChanges|resumeImplementation|recommendTechnicalApproval/i.test(code), "no sibling duplication");
  });
});