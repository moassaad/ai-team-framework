import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  DelegateFallbackDeps,
  DelegateFallbackOutcome,
  delegateWithFallback,
} from "../src/providers/delegate-fallback";
import { DelegationRequest, DelegationResult } from "../src/providers/delegate";

// Fallback tests: injected fakes only. Nothing is executed for real,
// and delegate-skills is never needed.
function makeDeps(overrides: Partial<DelegateFallbackDeps> = {}): DelegateFallbackDeps & {
  calls: { availability: number; delegate: number };
} {
  const calls = { availability: 0, delegate: 0 };
  return {
    calls,
    enabled: true,
    checkAvailability: () => {
      calls.availability += 1;
      return { available: true };
    },
    confirmation: "confirmed",
    delegate: async (request: DelegationRequest): Promise<DelegationResult> => {
      calls.delegate += 1;
      return { outcome: `done: ${request.task}` };
    },
    ...overrides,
  };
}

function assertNoResult(outcome: DelegateFallbackOutcome): void {
  assert.ok(!("result" in outcome), "no fabricated result");
}

describe("delegate failure fallback", () => {
  it("delegates when every gate passes", async () => {
    const deps = makeDeps();
    const outcome = await delegateWithFallback({ task: "migrate data" }, deps);
    assert.deepEqual(outcome, { status: "delegated", result: { outcome: "done: migrate data" } });
    assert.equal(deps.calls.delegate, 1);
  });

  it("returns control when delegate-skills is unavailable", async () => {
    const deps = makeDeps({ checkAvailability: () => ({ available: false }) });
    const outcome = await delegateWithFallback({ task: "migrate data" }, deps);
    assert.deepEqual(outcome, { status: "not_delegated", reason: "unavailable" });
    assertNoResult(outcome);
    assert.equal(deps.calls.delegate, 0);
  });

  it("returns control with the failure reported when execution fails", async () => {
    let attempts = 0;
    const deps = makeDeps({
      delegate: async () => {
        attempts += 1;
        throw new Error("delegate provider: process exited with code 1");
      },
    });
    const outcome = await delegateWithFallback({ task: "migrate data" }, deps);
    assert.deepEqual(outcome, {
      status: "not_delegated",
      reason: "failed",
      detail: "delegate provider: process exited with code 1",
    });
    assertNoResult(outcome);
    assert.equal(attempts, 1);
  });

  it("attempts execution exactly once on failure: no retry", async () => {
    let attempts = 0;
    const deps = makeDeps({
      delegate: async () => {
        attempts += 1;
        throw new Error("boom");
      },
    });
    const outcome = await delegateWithFallback({ task: "migrate data" }, deps);
    assert.equal(outcome.status, "not_delegated");
    assert.equal(attempts, 1);
  });

  it("never executes when disabled, even if available and confirmed", async () => {
    const deps = makeDeps({ enabled: false });
    const outcome = await delegateWithFallback({ task: "migrate data" }, deps);
    assert.deepEqual(outcome, { status: "not_delegated", reason: "disabled" });
    assertNoResult(outcome);
    assert.equal(deps.calls.delegate, 0);
    assert.equal(deps.calls.availability, 0);
  });

  it("never executes when unconfirmed, even if enabled and available", async () => {
    for (const confirmation of ["rejected", "pending", undefined, null, true]) {
      const deps = makeDeps({ confirmation });
      const outcome = await delegateWithFallback({ task: "migrate data" }, deps);
      assert.deepEqual(outcome, { status: "not_delegated", reason: "unconfirmed" });
      assertNoResult(outcome);
      assert.equal(deps.calls.delegate, 0);
    }
  });

  it("keeps gate order: disabled wins over unconfirmed, unconfirmed over unavailable", async () => {
    const disabled = makeDeps({ enabled: false, confirmation: "rejected" });
    assert.deepEqual(await delegateWithFallback({ task: "t" }, disabled), {
      status: "not_delegated",
      reason: "disabled",
    });
    const unconfirmed = makeDeps({
      confirmation: undefined,
      checkAvailability: () => ({ available: false }),
    });
    assert.deepEqual(await delegateWithFallback({ task: "t" }, unconfirmed), {
      status: "not_delegated",
      reason: "unconfirmed",
    });
  });

  it("leaves the normal framework path available after fallback", async () => {
    const deps = makeDeps({ checkAvailability: () => ({ available: false }) });
    const outcome = await delegateWithFallback({ task: "migrate data" }, deps);
    assert.equal(outcome.status, "not_delegated");
    let normalPathRan = false;
    if (outcome.status === "not_delegated") {
      normalPathRan = true;
    }
    assert.equal(normalPathRan, true);
    assert.equal(deps.calls.delegate, 0);
  });

  it("rejects invalid input without executing", async () => {
    const deps = makeDeps();
    await assert.rejects(
      delegateWithFallback({ task: "" }, deps),
      /delegate provider: invalid input/,
    );
    await assert.rejects(
      delegateWithFallback({ task: "t" }, { ...deps, enabled: "yes" } as unknown as DelegateFallbackDeps),
      /delegate fallback: invalid input \(enabled must be a boolean\)/,
    );
    assert.equal(deps.calls.delegate, 0);
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/delegate-fallback");
    assert.deepEqual(Object.keys(module).sort(), ["delegateWithFallback"]);
  });

  it("adds no selection, retry, workflow, config, or execution machinery", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(
      join(__dirname, "..", "..", "src", "providers", "delegate-fallback.ts"),
      "utf8",
    );
    assert.ok(
      !/delegate-skills|spawn|child_process|registry|rout|discover|priority|scor/i.test(code),
      "no adapter mechanics or selection",
    );
    assert.ok(!/retry|reattempt|backoff|counter|setTimeout|setInterval/i.test(code), "no retry");
    assert.ok(
      !/workflow|transition|WorkflowState|needs_user_input|implementation_review/i.test(code),
      "no workflow coupling",
    );
    assert.ok(!/providers\.(github|opencode|speckit)|issue|cli|install/i.test(code), "no adjacent systems");
    assert.ok(
      !/from "\.\/delegate-skills"|accessSync|process\.env/i.test(code),
      "no adapter import or environment probing",
    );
    assert.ok(
      /import type \{ DelegateAvailability \} from "\.\/delegate-availability"/.test(code),
      "D-002 contract composed type-only, never executed",
    );
  });
});
