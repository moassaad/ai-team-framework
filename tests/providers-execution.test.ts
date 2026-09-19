import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { AgentInvocation, AgentProvider } from "../src/providers/agent";
import { ExecutionResult, executionResultFromText } from "../src/providers/result";
import {
  ProviderExecutionError,
  executeWithTimeout,
  validateExecutionOptions,
} from "../src/providers/execution";

// Execution-handling tests: fake providers and short real timers only.
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

function trackTimers(): { created: () => number; cleared: () => number; restore: () => void } {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let created = 0;
  let cleared = 0;
  (globalThis as Record<string, unknown>).setTimeout = (
    ...args: Parameters<typeof setTimeout>
  ): ReturnType<typeof setTimeout> => {
    created += 1;
    return (realSetTimeout as (...inner: Parameters<typeof setTimeout>) => ReturnType<typeof setTimeout>)(...args);
  };
  (globalThis as Record<string, unknown>).clearTimeout = (
    ...args: Parameters<typeof clearTimeout>
  ): void => {
    cleared += 1;
    (realClearTimeout as (...inner: Parameters<typeof clearTimeout>) => void)(...args);
  };
  return {
    created: () => created,
    cleared: () => cleared,
    restore: () => {
      (globalThis as Record<string, unknown>).setTimeout = realSetTimeout;
      (globalThis as Record<string, unknown>).clearTimeout = realClearTimeout;
    },
  };
}

describe("provider execution handling", () => {
  it("passes successful results through and validates options", async () => {
    assert.deepEqual(validateExecutionOptions({ timeout_ms: 1000 }), { timeout_ms: 1000 });
    assert.equal(Object.isFrozen(validateExecutionOptions({ timeout_ms: 1000 })), true);
    for (const data of [null, {}, [], { timeout_ms: 0 }, { timeout_ms: -5 }, { timeout_ms: NaN }, { timeout_ms: Infinity }, { timeout_ms: "1000" }]) {
      assert.throws(() => validateExecutionOptions(data), /execution options: invalid options/);
    }
    const calls: AgentInvocation[] = [];
    const result = await executeWithTimeout(
      fakeProvider(calls, async () => executionResultFromText("done")),
      { prompt: "do it", project_root: "/proj" },
      { timeout_ms: 1000 },
    );
    assert.deepEqual(result, { status: "succeeded", text: "done" });
    assert.equal(calls.length, 1);
  });

  it("rejects invalid invocations and options without executing", async () => {
    const calls: AgentInvocation[] = [];
    const provider = fakeProvider(calls, async () => executionResultFromText("done"));
    await assert.rejects(
      executeWithTimeout(provider, { prompt: "", project_root: "/proj" }, { timeout_ms: 1000 }),
      /invalid invocation/,
    );
    await assert.rejects(
      executeWithTimeout(provider, { prompt: "do it", project_root: "/proj" }, { timeout_ms: 0 }),
      /invalid options/,
    );
    assert.equal(calls.length, 0);
  });

  it("times out hanging executions with exactly one attempt", async () => {
    const calls: AgentInvocation[] = [];
    const provider = fakeProvider(calls, () => new Promise<ExecutionResult>(() => {}));
    const error = await executeWithTimeout(
      provider,
      { prompt: "do it", project_root: "/proj" },
      { timeout_ms: 20 },
    ).then(
      () => assert.fail("must reject"),
      (reason: unknown) => reason,
    );
    assert.ok(error instanceof ProviderExecutionError);
    assert.equal((error as ProviderExecutionError).kind, "timeout");
    assert.equal((error as Error).message, "provider execution timed out after 20 ms");
    assert.equal(calls.length, 1);
  });

  it("normalizes provider rejections without leaking details", async () => {
    const calls: AgentInvocation[] = [];
    const provider = fakeProvider(calls, async () => {
      throw new Error("opencode exploded with SECRET=abc123");
    });
    const error = await executeWithTimeout(
      provider,
      { prompt: "do it", project_root: "/proj" },
      { timeout_ms: 1000 },
    ).then(
      () => assert.fail("must reject"),
      (reason: unknown) => reason,
    );
    assert.ok(error instanceof ProviderExecutionError);
    assert.equal((error as ProviderExecutionError).kind, "provider_error");
    assert.equal((error as Error).message, "provider execution failed");
    assert.ok(!(error as Error).message.includes("SECRET"));
    assert.equal(calls.length, 1);
  });

  it("cleans timers on success, timeout, and provider failure", async () => {
    const timers = trackTimers();
    try {
      const okCalls: AgentInvocation[] = [];
      await executeWithTimeout(
        fakeProvider(okCalls, async () => executionResultFromText("done")),
        { prompt: "do it", project_root: "/proj" },
        { timeout_ms: 1000 },
      );
      assert.equal(timers.created(), 1);
      assert.equal(timers.cleared(), 1);

      const hanging: AgentInvocation[] = [];
      await executeWithTimeout(
        fakeProvider(hanging, () => new Promise<ExecutionResult>(() => {})),
        { prompt: "do it", project_root: "/proj" },
        { timeout_ms: 10 },
      ).then(
        () => assert.fail("must reject"),
        () => {},
      );
      assert.equal(timers.created(), 2);
      assert.equal(timers.cleared(), 2);

      const failing: AgentInvocation[] = [];
      await executeWithTimeout(
        fakeProvider(failing, async () => {
          throw new Error("nope");
        }),
        { prompt: "do it", project_root: "/proj" },
        { timeout_ms: 1000 },
      ).then(
        () => assert.fail("must reject"),
        () => {},
      );
      assert.equal(timers.created(), 3);
      assert.equal(timers.cleared(), 3);
    } finally {
      timers.restore();
    }
  });

  it("rejects promptly without waiting out the timeout on provider failure", async () => {
    const calls: AgentInvocation[] = [];
    const start = Date.now();
    await executeWithTimeout(
      fakeProvider(calls, async () => {
        throw new Error("fast failure");
      }),
      { prompt: "do it", project_root: "/proj" },
      { timeout_ms: 5000 },
    ).then(
      () => assert.fail("must reject"),
      () => {},
    );
    assert.ok(Date.now() - start < 1000, "must not wait for the timeout");
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/execution");
    assert.deepEqual(Object.keys(module).sort(), [
      "ProviderExecutionError",
      "executeWithTimeout",
      "validateExecutionOptions",
    ]);
  });

  it("adds no retry, workflow, provider-specific, or secret-handling logic", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "providers", "execution.ts"), "utf8");
    assert.ok(!/retry|backoff|counter/i.test(code), "no retry");
    assert.ok(!/"failed"|"blocked"|"changes_requested"|"cancelled"/.test(code), "no workflow states");
    assert.ok(!/opencode|stdout|stderr|exit_code|model|token|session/i.test(code), "no provider specifics");
    assert.ok(!/AbortController|kill|signal|env\b|process\.env|secret|credential/i.test(code), "no cancellation or secret handling");
  });
});