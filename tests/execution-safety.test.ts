import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentInvocation, AgentProvider } from "../src/providers/agent";
import { ExecutionResult, executionResultFromText } from "../src/providers/result";
import {
  executeImplementerTicket,
  ImplementerExecutionInput,
} from "../src/execution/implementer";
import { executeReviewerTicket } from "../src/execution/reviewer";
import { delegateWithFallback } from "../src/providers/delegate-fallback";

// Execution-safety tests (T-007): boundaries not pinned by the
// per-flow suites — which errors become failed outcomes vs propagate
// raw, late completion after timeout, caller-input integrity, and
// fallback-to-normal-execution composition. Injected fakes and short
// real timers only; no external systems, no filesystem use.
const ticket = {
  id: "T-007",
  title: "Safety",
  description: "Prove execution boundaries.",
  requirements: "No new semantics.",
};

function fakeProvider(
  calls: AgentInvocation[],
  behavior: (request: AgentInvocation) => Promise<ExecutionResult>,
): AgentProvider<ExecutionResult> {
  return {
    name: "fake",
    execute: async (request) => {
      calls.push(request);
      return behavior(request);
    },
  };
}

function syncThrowingProvider(calls: AgentInvocation[]): AgentProvider<ExecutionResult> {
  // Non-async execute: throws synchronously instead of rejecting.
  const execute = ((request: AgentInvocation): Promise<ExecutionResult> => {
    calls.push(request);
    throw new Error("synchronous SECRET_EXECUTION_TEST bug");
  }) as AgentProvider<ExecutionResult>["execute"];
  return { name: "sync-bug", execute };
}

function implementerInput(
  provider: AgentProvider<ExecutionResult>,
  timeout_ms = 1000,
): ImplementerExecutionInput {
  return { ticket, specialty: "backend", project_root: "/proj", provider, timeout_ms };
}

describe("execution safety contract", () => {
  it("propagates synchronous provider throws raw instead of failed outcomes", async () => {
    const calls: AgentInvocation[] = [];
    const provider = syncThrowingProvider(calls);
    await assert.rejects(
      executeImplementerTicket(implementerInput(provider)),
      /synchronous SECRET_EXECUTION_TEST bug/,
    );
    await assert.rejects(
      executeReviewerTicket({
        ticket,
        implementation_result: "Implemented.",
        project_root: "/proj",
        provider,
        timeout_ms: 1000,
      }),
      /synchronous SECRET_EXECUTION_TEST bug/,
    );
    assert.equal(calls.length, 2);
  });

  it("normalizes asynchronous foreign rejections into failed outcomes", async () => {
    const calls: AgentInvocation[] = [];
    const outcome = await executeImplementerTicket(
      implementerInput(
        fakeProvider(calls, async () => {
          throw new TypeError("fetch failed");
        }),
      ),
    );
    assert.equal(outcome.outcome, "failed");
    if (outcome.outcome === "failed") {
      assert.equal(outcome.error.kind, "provider_error");
      assert.equal(outcome.error.message, "provider execution failed");
      assert.equal(outcome.next_state, null);
    }
    assert.equal(calls.length, 1);
  });

  it("lets late provider completion never become a completed outcome", async () => {
    const calls: AgentInvocation[] = [];
    const outcome = await executeImplementerTicket(
      implementerInput(
        fakeProvider(calls, async () => {
          await new Promise((resolve) => setTimeout(resolve, 80));
          return executionResultFromText("too late");
        }),
        20,
      ),
    );
    assert.equal(outcome.outcome, "failed");
    if (outcome.outcome === "failed") {
      assert.equal(outcome.error.kind, "timeout");
      assert.equal(outcome.next_state, null);
    }
    assert.equal(calls.length, 1);
  });

  it("leaves caller input unchanged across success and failure", async () => {
    const calls: AgentInvocation[] = [];
    const provider = fakeProvider(calls, async () => executionResultFromText("done"));
    const input = implementerInput(provider);
    const before = JSON.stringify(input);
    const completed = await executeImplementerTicket(input);
    assert.equal(completed.outcome, "completed");
    assert.equal(JSON.stringify(input), before);

    const failing = implementerInput(
      fakeProvider(calls, async () => {
        throw new Error("nope");
      }),
    );
    const failedBefore = JSON.stringify({ ...failing, provider: "fake" });
    const failed = await executeImplementerTicket(failing);
    assert.equal(failed.outcome, "failed");
    assert.equal(JSON.stringify({ ...failing, provider: "fake" }), failedBefore);
  });

  it("keeps normal execution available after every fallback outcome", async () => {
    const fallbacks = {
      disabled: {
        enabled: false,
        checkAvailability: () => ({ available: true }),
        confirmation: "confirmed",
        delegate: async (): Promise<never> => {
          throw new Error("must not run");
        },
      },
      unconfirmed: {
        enabled: true,
        checkAvailability: () => ({ available: true }),
        confirmation: "rejected",
        delegate: async (): Promise<never> => {
          throw new Error("must not run");
        },
      },
      unavailable: {
        enabled: true,
        checkAvailability: () => ({ available: false }),
        confirmation: "confirmed",
        delegate: async (): Promise<never> => {
          throw new Error("must not run");
        },
      },
      failed: {
        enabled: true,
        checkAvailability: () => ({ available: true }),
        confirmation: "confirmed",
        delegate: async (): Promise<never> => {
          throw new Error("delegate provider: process error");
        },
      },
    } as const;
    for (const [reason, deps] of Object.entries(fallbacks)) {
      const fallback = await delegateWithFallback({ task: "migrate data" }, { ...deps });
      assert.equal(fallback.status, "not_delegated", reason);
      const calls: AgentInvocation[] = [];
      const outcome = await executeImplementerTicket(
        implementerInput(fakeProvider(calls, async () => executionResultFromText("done"))),
      );
      assert.equal(outcome.outcome, "completed", reason);
      assert.equal(outcome.ticket_id, "T-007", reason);
      assert.equal(calls.length, 1, reason);
    }
  });

  it("resolves identical safety scenarios deterministically", async () => {
    const runSyncThrow = (): Promise<string> =>
      executeImplementerTicket(implementerInput(syncThrowingProvider([]))).then(
        () => "completed",
        (error: unknown) => (error as Error).message,
      );
    assert.equal(await runSyncThrow(), await runSyncThrow());
  });
});
