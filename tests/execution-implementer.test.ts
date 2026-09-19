import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { AgentInvocation, AgentProvider } from "../src/providers/agent";
import { ExecutionResult, executionResultFromText } from "../src/providers/result";
import { renderRolePrompt } from "../src/providers/prompt";
import { IMPLEMENTER_ROLE } from "../src/roles/implementer";
import { isValidTransition } from "../src/workflow/transitions";
import { executeImplementerTicket, validateImplementerInput } from "../src/execution/implementer";

// Implementer-flow tests: fake provider only, never real execution.
const ticket = {
  id: "T-001",
  title: "Catalog",
  description: "# Catalog\n\nList products.\n",
  requirements: "Build a shop.",
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

function succeed(text = "implemented"): (request: AgentInvocation) => Promise<ExecutionResult> {
  return async () => executionResultFromText(text);
}

describe("implementer execution flow", () => {
  it("executes a valid ticket to completion with the review edge", async () => {
    const calls: AgentInvocation[] = [];
    const outcome = await executeImplementerTicket({
      ticket,
      specialty: "backend",
      project_root: "/proj",
      discovery_summary: "languages: typescript.",
      provider: fakeProvider(calls, succeed("done")),
      timeout_ms: 1000,
    });
    assert.equal(outcome.outcome, "completed");
    assert.equal(outcome.ticket_id, "T-001");
    if (outcome.outcome === "completed") {
      assert.deepEqual(outcome.result, { status: "succeeded", text: "done" });
      assert.equal(outcome.next_state, "implementation_review");
    }
    assert.equal(isValidTransition("in_progress", "implementation_review"), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.project_root, "/proj");
  });

  it("renders the canonical implementer prompt with task context", async () => {
    const calls: AgentInvocation[] = [];
    await executeImplementerTicket({
      ticket,
      specialty: "backend",
      project_root: "/proj",
      provider: fakeProvider(calls, succeed()),
      timeout_ms: 1000,
    });
    const expected = renderRolePrompt({
      role: IMPLEMENTER_ROLE,
      specialty: "backend",
      task: "Ticket T-001: Catalog\n\n# Catalog\n\nList products.\n\n\nRequirements:\nBuild a shop.",
      project: { root: "/proj" },
    });
    assert.equal(calls[0]?.prompt, expected);
    assert.ok((calls[0]?.prompt ?? "").includes("# Implementer (implementer)"));
    assert.ok((calls[0]?.prompt ?? "").includes("Specialty: backend."));
    assert.ok((calls[0]?.prompt ?? "").includes("Project root: /proj"));
  });

  it("rejects aliases, bad tickets, bad providers, and bad timeouts without executing", async () => {
    const calls: AgentInvocation[] = [];
    const provider = fakeProvider(calls, succeed());
    const cases: unknown[] = [
      null,
      {},
      { ticket, specialty: "wizard", project_root: "/proj", provider, timeout_ms: 1000 },
      { ticket: { ...ticket, id: "" }, specialty: "backend", project_root: "/proj", provider, timeout_ms: 1000 },
      { ticket, specialty: "backend", project_root: "", provider, timeout_ms: 1000 },
      { ticket, specialty: "backend", project_root: "/proj", provider: { name: "x" }, timeout_ms: 1000 },
      { ticket, specialty: "backend", project_root: "/proj", provider, timeout_ms: 0 },
      { ticket, specialty: "backend", project_root: "/proj", provider, timeout_ms: Infinity },
    ];
    for (const data of cases) {
      await assert.rejects(
        executeImplementerTicket(data as Parameters<typeof executeImplementerTicket>[0]),
        /implementer execution: invalid input/,
      );
    }
    assert.equal(calls.length, 0);
    assert.ok(Object.isFrozen(validateImplementerInput({ ticket, specialty: "backend", project_root: "/proj", provider, timeout_ms: 1000 })));
  });

  it("maps provider failure to a failed outcome with no transition", async () => {
    const calls: AgentInvocation[] = [];
    const outcome = await executeImplementerTicket({
      ticket,
      specialty: "testing",
      project_root: "/proj",
      provider: fakeProvider(calls, async () => {
        throw new Error("agent exploded with SECRET=1");
      }),
      timeout_ms: 1000,
    });
    assert.equal(outcome.outcome, "failed");
    assert.equal(outcome.ticket_id, "T-001");
    if (outcome.outcome === "failed") {
      assert.equal(outcome.error.kind, "provider_error");
      assert.equal(outcome.error.message, "provider execution failed");
      assert.equal(outcome.next_state, null);
    }
    assert.equal(calls.length, 1);
  });

  it("maps timeouts to a failed outcome with no transition and one attempt", async () => {
    const calls: AgentInvocation[] = [];
    const outcome = await executeImplementerTicket({
      ticket,
      specialty: "frontend",
      project_root: "/proj",
      provider: fakeProvider(calls, () => new Promise<ExecutionResult>(() => {})),
      timeout_ms: 20,
    });
    assert.equal(outcome.outcome, "failed");
    if (outcome.outcome === "failed") {
      assert.equal(outcome.error.kind, "timeout");
      assert.ok(outcome.error.message.includes("20 ms"));
      assert.equal(outcome.next_state, null);
    }
    assert.equal(calls.length, 1);
  });

  it("exposes no approval, review, or completion bookkeeping", async () => {
    const calls: AgentInvocation[] = [];
    const outcome = await executeImplementerTicket({
      ticket,
      specialty: "backend",
      project_root: "/proj",
      provider: fakeProvider(calls, succeed()),
      timeout_ms: 1000,
    });
    const keys = Object.keys(outcome).sort();
    assert.deepEqual(keys, ["next_state", "outcome", "result", "ticket_id"]);
    assert.ok(!JSON.stringify(outcome).includes("approval"));
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/execution/implementer");
    assert.deepEqual(Object.keys(module).sort(), ["executeImplementerTicket", "validateImplementerInput"]);
  });

  it("couples to no transport, workflow mutation, or policy machinery", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "execution", "implementer.ts"), "utf8");
    assert.ok(!/child_process|execSync|spawn|fetch\(|http|node:/i.test(code), "no transport");
    assert.ok(!/opencode/i.test(code), "no provider specifics");
    assert.ok(!/setTimeout|AbortController|retry|backoff/i.test(code), "no policy machinery");
    assert.ok(!/closed|cancelled|blocked|changes_requested/i.test(code), "no foreign transitions");
  });
});