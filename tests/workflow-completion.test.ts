import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FrameworkConfig } from "../src/config/schema";
import * as completionModule from "../src/workflow/completion";
import {
  canCompleteTicket,
  validateCompletion,
} from "../src/workflow/completion";
import { handleManualApprovalDecision, startManualApproval } from "../src/workflow/manual-approval";
import { startAutomaticApproval } from "../src/workflow/automatic-approval";
import { enterBlocked, requestUserInput } from "../src/workflow/exceptional-states";

// Completion-rule tests only: eligibility and evidence for `closed`.
// No transitions, approvals, reviews, retries, persistence, or execution.
const MANUAL: FrameworkConfig = { version: 1 };
const AUTOMATIC: FrameworkConfig = { version: 1, approval: { mode: "automatic" } };
const FULL_EVIDENCE = { approvalGranted: true, reviewClean: true, validationPresent: true };

describe("ticket completion", () => {
  it("completes manual tickets at the gate with full evidence", () => {
    assert.deepEqual(
      validateCompletion(MANUAL, "needs_user_input", FULL_EVIDENCE),
      { complete: true, missing: [], nextState: "closed" },
    );
    assert.equal(canCompleteTicket(MANUAL, "needs_user_input", FULL_EVIDENCE), true);
  });

  it("completes automatic tickets at pm_review without approval evidence", () => {
    const withoutApproval = { approvalGranted: false, reviewClean: true, validationPresent: true };
    assert.deepEqual(validateCompletion(AUTOMATIC, "pm_review", withoutApproval), {
      complete: true,
      missing: [],
      nextState: "closed",
    });
  });

  it("blocks completion on each missing evidence category", () => {
    assert.deepEqual(
      validateCompletion(MANUAL, "needs_user_input", { ...FULL_EVIDENCE, approvalGranted: false }),
      { complete: false, missing: ["approval"] },
    );
    assert.deepEqual(
      validateCompletion(MANUAL, "needs_user_input", { ...FULL_EVIDENCE, reviewClean: false }),
      { complete: false, missing: ["review"] },
    );
    assert.deepEqual(
      validateCompletion(MANUAL, "needs_user_input", { ...FULL_EVIDENCE, validationPresent: false }),
      { complete: false, missing: ["validation"] },
    );
    assert.deepEqual(
      validateCompletion(MANUAL, "needs_user_input", {
        approvalGranted: false,
        reviewClean: false,
        validationPresent: false,
      }),
      { complete: false, missing: ["approval", "review", "validation"] },
    );
  });

  it("never completes from the wrong state, including terminal states", () => {
    // Manual mode may only complete at the gate; automatic only at pm_review.
    assert.deepEqual(validateCompletion(MANUAL, "pm_review", FULL_EVIDENCE).missing, ["state"]);
    assert.deepEqual(validateCompletion(AUTOMATIC, "needs_user_input", FULL_EVIDENCE).missing, ["state"]);
    for (const state of [
      "ready",
      "in_progress",
      "implementation_review",
      "technical_approval",
      "blocked",
      "changes_requested",
      "failed",
      "closed",
      "cancelled",
    ] as const) {
      assert.deepEqual(validateCompletion(MANUAL, state, FULL_EVIDENCE).missing, ["state"]);
      assert.deepEqual(validateCompletion(AUTOMATIC, state, FULL_EVIDENCE).missing, ["state"]);
      assert.equal(canCompleteTicket(MANUAL, state, FULL_EVIDENCE), false);
    }
  });

  it("does not treat generic user input as approval", () => {
    // A generic W-006 input request carries no approval evidence.
    requestUserInput("in_progress", { reason: "clarify requirement", requestedBy: "technical-lead" });
    assert.deepEqual(
      validateCompletion(MANUAL, "needs_user_input", {
        approvalGranted: false,
        reviewClean: true,
        validationPresent: true,
      }),
      { complete: false, missing: ["approval"] },
    );
  });

  it("leaves W-004, W-005, and W-006 behavior unchanged", () => {
    assert.deepEqual(startManualApproval(MANUAL, "pm_review", "T-1").status, "waiting_for_user");
    assert.deepEqual(
      handleManualApprovalDecision(MANUAL, "needs_user_input", "approve", "T-1"),
      { status: "approved", nextState: "closed" },
    );
    assert.deepEqual(startAutomaticApproval(AUTOMATIC, "pm_review", "T-1"), {
      status: "approved",
      nextState: "closed",
    });
    assert.equal(enterBlocked("in_progress", { reason: "x" }).kind, "blocked");
  });

  it("is deterministic without mutation or side effects", () => {
    const config: FrameworkConfig = { version: 1 };
    const evidence = { ...FULL_EVIDENCE };
    const before = JSON.stringify([config, evidence]);
    assert.deepEqual(
      validateCompletion(config, "needs_user_input", evidence),
      validateCompletion(config, "needs_user_input", evidence),
    );
    assert.equal(JSON.stringify([config, evidence]), before);
  });

  it("rejects malformed evidence deterministically", () => {
    assert.throws(
      () =>
        validateCompletion(MANUAL, "needs_user_input", {
          approvalGranted: "yes",
        } as unknown as typeof FULL_EVIDENCE),
      /boolean flags/,
    );
  });

  it("exposes only the completion API", () => {
    assert.deepEqual(Object.keys(completionModule).sort(), [
      "canCompleteTicket",
      "validateCompletion",
    ]);
  });
});
