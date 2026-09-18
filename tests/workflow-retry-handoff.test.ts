import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as retryHandoffModule from "../src/workflow/retry-handoff";
import {
  canHandoff,
  canRetry,
  createHandoff,
  createRetryContext,
} from "../src/workflow/retry-handoff";
import { isValidTransition } from "../src/workflow/transitions";
import { RoleId } from "../src/roles/contract";
import { WorkflowState } from "../src/workflow/states";

// Retry/handoff tests only: eligibility, context shape, supported pairs,
// and isolation. No execution, queues, routing, approval, or persistence.
describe("retry and handoff", () => {
  it("allows retry only from failed with explicit conditions", () => {
    assert.equal(canRetry("failed", "flaky network; rerun isolated test"), true);
    assert.equal(canRetry("failed", ""), false);
    for (const state of [
      "ready",
      "in_progress",
      "implementation_review",
      "technical_approval",
      "pm_review",
      "blocked",
      "needs_user_input",
      "closed",
      "cancelled",
    ] as const) {
      assert.equal(canRetry(state, "conditions stated"), false, `no retry from ${state}`);
    }
  });

  it("builds retry context naming the exact recovery edge", () => {
    assert.deepEqual(createRetryContext("failed", "timeout", "isolated rerun with logs"), {
      from: "failed",
      to: "in_progress",
      reason: "timeout",
      conditions: "isolated rerun with logs",
    });
    assert.equal(isValidTransition("failed", "in_progress"), true);
    assert.throws(() => createRetryContext("blocked", "x", "y"), /requires source "failed"/);
    assert.throws(() => createRetryContext("failed", "x", ""), /requires source "failed"/);
  });

  it("imposes no invented retry count or attempt tracking", () => {
    const context = createRetryContext("failed", "x", "y");
    assert.deepEqual(Object.keys(context).sort(), ["conditions", "from", "reason", "to"]);
  });

  it("keeps retry free of approval results", () => {
    const context = createRetryContext("failed", "x", "y");
    assert.ok(!("status" in context) || (context as { status?: string }).status === undefined);
    assert.notEqual(context.to, "closed");
  });

  it("supports only specification-backed handoff pairs", () => {
    const supported: Array<[RoleId, RoleId]> = [
      ["coordinator", "project-manager"],
      ["coordinator", "technical-lead"],
      ["coordinator", "implementer"],
      ["coordinator", "senior-reviewer"],
      ["project-manager", "technical-lead"],
      ["technical-lead", "implementer"],
      ["implementer", "technical-lead"],
      ["implementer", "senior-reviewer"],
      ["senior-reviewer", "technical-lead"],
    ];
    for (const [from, to] of supported) {
      assert.equal(canHandoff(from, to), true, `${from} → ${to}`);
    }
    assert.deepEqual(createHandoff("implementer", "senior-reviewer", "ready for review", "ticket T-3"), {
      from: "implementer",
      to: "senior-reviewer",
      reason: "ready for review",
      context: "ticket T-3",
    });
  });

  it("rejects free text, aliases, and specialties as handoff roles", () => {
    for (const [from, to] of [
      ["implementer", "implementer"],
      ["senior-reviewer", "implementer"],
      ["pm", "technical-lead"],
      ["backend", "technical-lead"],
      ["implementer", "backend"],
      ["anyone", "technical-lead"],
    ] as const) {
      assert.equal(
        canHandoff(from as RoleId, to as RoleId),
        false,
        `${from} → ${to} must not be a handoff`,
      );
      assert.throws(() => createHandoff(from as RoleId, to as RoleId, "x"), /unsupported handoff/);
    }
  });

  it("keeps handoff state-free and terminal-safe", () => {
    const handoff = createHandoff("technical-lead", "implementer", "implement T-4");
    assert.deepEqual(Object.keys(handoff).sort(), ["from", "reason", "to"]);
    assert.ok(!("state" in handoff) && !("to_state" in handoff));
    for (const state of ["closed", "cancelled"] as const) {
      assert.equal(canRetry(state as WorkflowState, "conditions"), false);
    }
  });

  it("is deterministic with immutable inputs", () => {
    assert.deepEqual(
      createRetryContext("failed", "x", "y"),
      createRetryContext("failed", "x", "y"),
    );
    assert.deepEqual(
      createHandoff("coordinator", "project-manager", "plan this", "ctx"),
      createHandoff("coordinator", "project-manager", "plan this", "ctx"),
    );
  });

  it("exposes only the retry/handoff API", () => {
    assert.deepEqual(Object.keys(retryHandoffModule).sort(), [
      "canHandoff",
      "canRetry",
      "createHandoff",
      "createRetryContext",
    ]);
  });
});
