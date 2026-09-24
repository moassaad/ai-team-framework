import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentInvocation, AgentProvider } from "../src/providers/agent";
import {
  ProviderExecutionError,
  executeWithTimeout,
} from "../src/providers/execution";
import { ExecutionResult } from "../src/providers/result";
import { createOpenCodeProvider } from "../src/providers/opencode";
import { createSpecKitProvider } from "../src/providers/speckit";
import {
  createGitHubIssueProvider,
  HttpRequest,
} from "../src/providers/github";
import { createDelegateSkillsProvider } from "../src/providers/delegate-skills";
import { delegateWithFallback } from "../src/providers/delegate-fallback";

// Provider failure-contract tests (T-005): cross-family principles
// not pinned by any per-adapter suite — failure composition through
// the execution boundary, late success after timeout, and the raw
// adapter vs D-006 fallback distinction. Per-adapter mechanics
// (launch, transport, validation, sanitization) stay in their own
// suites and are not duplicated here. Injected fakes and short real
// timers only; no network, credentials, or installed tools.
function failingAgent(calls: AgentInvocation[], message: string): AgentProvider<ExecutionResult> {
  return {
    name: "failing-agent",
    execute: async (request: AgentInvocation): Promise<ExecutionResult> => {
      calls.push(request);
      throw new Error(message);
    },
  };
}

describe("provider failure contract", () => {
  it("propagates SpecKit adapter failure through execution as provider_error", async () => {
    const calls: AgentInvocation[] = [];
    const provider = createSpecKitProvider(failingAgent(calls, "agent exploded"));
    const error = await executeWithTimeout(
      {
        name: provider.name,
        execute: async (invocation: AgentInvocation): Promise<ExecutionResult> => {
          const artifact = await provider.generate({
            requirements: "R",
            project_root: invocation.project_root,
            artifact: "specification",
          });
          return { status: "succeeded", text: artifact.content };
        },
      },
      { prompt: "do it", project_root: "/proj" },
      { timeout_ms: 1000 },
    ).then(
      () => assert.fail("must reject"),
      (reason: unknown) => reason,
    );
    assert.ok(error instanceof ProviderExecutionError);
    assert.equal((error as ProviderExecutionError).kind, "provider_error");
    assert.equal((error as Error).message, "provider execution failed");
    assert.equal(calls.length, 1);
  });

  it("propagates OpenCode launch failure through execution as provider_error", async () => {
    let launches = 0;
    const provider = createOpenCodeProvider(() => {
      launches += 1;
      throw new Error("spawn ENOENT");
    });
    const error = await executeWithTimeout(
      {
        name: provider.name,
        execute: (invocation: AgentInvocation) =>
          provider.execute(invocation).then((text) => ({ status: "succeeded" as const, text })),
      },
      { prompt: "do it", project_root: "/proj" },
      { timeout_ms: 1000 },
    ).then(
      () => assert.fail("must reject"),
      (reason: unknown) => reason,
    );
    assert.ok(error instanceof ProviderExecutionError);
    assert.equal((error as ProviderExecutionError).kind, "provider_error");
    assert.equal(launches, 1);
  });

  it("lets a late provider success never override a timeout", async () => {
    let calls = 0;
    const error = await executeWithTimeout(
      {
        name: "slow",
        execute: async (): Promise<ExecutionResult> => {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 80));
          return { status: "succeeded", text: "too late" };
        },
      },
      { prompt: "do it", project_root: "/proj" },
      { timeout_ms: 20 },
    ).then(
      () => assert.fail("must reject"),
      (reason: unknown) => reason,
    );
    assert.ok(error instanceof ProviderExecutionError);
    assert.equal((error as ProviderExecutionError).kind, "timeout");
    assert.equal((error as Error).message, "provider execution timed out after 20 ms");
    assert.equal(calls, 1);
  });

  it("carries no prompt content in the timeout error", async () => {
    const prompt = "migrate SECRET=abc123 billing data";
    const error = await executeWithTimeout(
      {
        name: "hanging",
        execute: () => new Promise<ExecutionResult>(() => {}),
      },
      { prompt, project_root: "/proj" },
      { timeout_ms: 20 },
    ).then(
      () => assert.fail("must reject"),
      (reason: unknown) => reason as Error,
    );
    assert.equal(error.message, "provider execution timed out after 20 ms");
    assert.ok(!error.message.includes("SECRET"));
    assert.ok(!error.message.includes("migrate"));
  });

  it("keeps raw delegate failure a rejection while D-006 converts it", async () => {
    const adapter = createDelegateSkillsProvider(() => {
      throw new Error("delegate provider: failed to start process");
    });
    await assert.rejects(
      adapter.delegate({ task: "migrate data" }),
      /delegate provider: failed to start process/,
    );
    const outcome = await delegateWithFallback(
      { task: "migrate data" },
      {
        enabled: true,
        checkAvailability: () => ({ available: true }),
        confirmation: "confirmed",
        delegate: async () => {
          throw new Error("delegate provider: failed to start process");
        },
      },
    );
    assert.deepEqual(outcome, {
      status: "not_delegated",
      reason: "failed",
      detail: "delegate provider: failed to start process",
    });
    assert.ok(!("result" in outcome), "no fabricated delegation result");
  });

  it("reproduces identical failures deterministically", async () => {
    const requests: HttpRequest[] = [];
    const github = createGitHubIssueProvider({
      owner: "o",
      repo: "r",
      token: "t",
      transport: async (request: HttpRequest) => {
        requests.push(request);
        return { status: 500, body: { message: "boom" } };
      },
    });
    const first = await github.create({ title: "T", description: "D" }).then(
      () => assert.fail("must reject"),
      (error: unknown) => (error as Error).message,
    );
    const second = await github.create({ title: "T", description: "D" }).then(
      () => assert.fail("must reject"),
      (error: unknown) => (error as Error).message,
    );
    assert.equal(first, second);
    assert.equal(first, "github provider: request failed with status 500");
    assert.equal(requests.length, 2);

    const fallbackInput = {
      enabled: true,
      checkAvailability: () => ({ available: true }),
      confirmation: "confirmed" as const,
      delegate: async (): Promise<never> => {
        throw new Error("delegate provider: process error");
      },
    };
    assert.deepEqual(
      await delegateWithFallback({ task: "t" }, { ...fallbackInput }),
      await delegateWithFallback({ task: "t" }, { ...fallbackInput }),
    );
  });
});
