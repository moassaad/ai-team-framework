import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { AgentInvocation, AgentProvider } from "../src/providers/agent";
import { ExecutionResult, executionResultFromText } from "../src/providers/result";
import { renderRolePrompt } from "../src/providers/prompt";
import { SENIOR_REVIEWER_ROLE } from "../src/roles/senior-reviewer";
import { executeReviewerTicket, validateReviewerInput } from "../src/execution/reviewer";

// Reviewer-flow tests: fake provider only, never real execution.
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

function succeed(text = "looks good"): (request: AgentInvocation) => Promise<ExecutionResult> {
  return async () => executionResultFromText(text);
}

describe("reviewer execution flow", () => {
  it("executes a valid review to completion with the report", async () => {
    const calls: AgentInvocation[] = [];
    const outcome = await executeReviewerTicket({
      ticket,
      implementation_result: "Implemented catalog with tests.",
      project_root: "/proj",
      discovery_summary: "languages: typescript.",
      provider: fakeProvider(calls, succeed("No blocking issues.")),
      timeout_ms: 1000,
    });
    assert.equal(outcome.outcome, "completed");
    assert.equal(outcome.ticket_id, "T-001");
    if (outcome.outcome === "completed") {
      assert.equal(outcome.report, "No blocking issues.");
      assert.equal(outcome.next_state, null);
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.project_root, "/proj");
  });

  it("renders the canonical reviewer prompt with review context", async () => {
    const calls: AgentInvocation[] = [];
    await executeReviewerTicket({
      ticket,
      implementation_result: "Implemented catalog.",
      project_root: "/proj",
      provider: fakeProvider(calls, succeed()),
      timeout_ms: 1000,
    });
    const expected = renderRolePrompt({
      role: SENIOR_REVIEWER_ROLE,
      task: "Review ticket T-001: Catalog\n\nImplementation result under review:\nImplemented catalog.\n\nTicket description:\n# Catalog\n\nList products.\n\n\nRequirements:\nBuild a shop.",
      project: { root: "/proj" },
    });
    assert.equal(calls[0]?.prompt, expected);
    assert.ok((calls[0]?.prompt ?? "").includes("# Senior Reviewer (senior-reviewer)"));
    assert.ok((calls[0]?.prompt ?? "").includes("modify implementation code"));
    assert.ok((calls[0]?.prompt ?? "").includes("Implemented catalog."));
    assert.ok(!(calls[0]?.prompt ?? "").includes("Specialty:"));
  });

  it("rejects malformed input without executing", async () => {
    const calls: AgentInvocation[] = [];
    const provider = fakeProvider(calls, succeed());
    const base = {
      ticket,
      implementation_result: "Implemented.",
      project_root: "/proj",
      provider,
      timeout_ms: 1000,
    };
    const cases: unknown[] = [
      null,
      {},
      { ...base, implementation_result: "" },
      { ...base, ticket: { ...ticket, requirements: "" } },
      { ...base, project_root: "" },
      { ...base, provider: { name: "x" } },
      { ...base, timeout_ms: -1 },
    ];
    for (const data of cases) {
      await assert.rejects(
        executeReviewerTicket(data as Parameters<typeof executeReviewerTicket>[0]),
        /reviewer execution: invalid input/,
      );
    }
    assert.equal(calls.length, 0);
    assert.ok(Object.isFrozen(validateReviewerInput(base)));
  });

  it("maps provider failure to a failed outcome with no transition", async () => {
    const calls: AgentInvocation[] = [];
    const outcome = await executeReviewerTicket({
      ticket,
      implementation_result: "Implemented.",
      project_root: "/proj",
      provider: fakeProvider(calls, async () => {
        throw new Error("agent exploded with SECRET=1");
      }),
      timeout_ms: 1000,
    });
    assert.equal(outcome.outcome, "failed");
    if (outcome.outcome === "failed") {
      assert.equal(outcome.error.kind, "provider_error");
      assert.equal(outcome.error.message, "provider execution failed");
      assert.equal(outcome.next_state, null);
    }
    assert.equal(calls.length, 1);
  });

  it("maps timeouts to a failed outcome with one attempt", async () => {
    const calls: AgentInvocation[] = [];
    const outcome = await executeReviewerTicket({
      ticket,
      implementation_result: "Implemented.",
      project_root: "/proj",
      provider: fakeProvider(calls, () => new Promise<ExecutionResult>(() => {})),
      timeout_ms: 20,
    });
    assert.equal(outcome.outcome, "failed");
    if (outcome.outcome === "failed") {
      assert.equal(outcome.error.kind, "timeout");
      assert.equal(outcome.next_state, null);
    }
    assert.equal(calls.length, 1);
  });

  it("exposes no approval, decision, or completion bookkeeping", async () => {
    const calls: AgentInvocation[] = [];
    const outcome = await executeReviewerTicket({
      ticket,
      implementation_result: "Implemented.",
      project_root: "/proj",
      provider: fakeProvider(calls, succeed()),
      timeout_ms: 1000,
    });
    assert.deepEqual(Object.keys(outcome).sort(), ["next_state", "outcome", "report", "ticket_id"]);
    assert.ok(!JSON.stringify(outcome).includes("approval"));
    assert.ok(!JSON.stringify(outcome).includes("changes_requested"));
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/execution/reviewer");
    assert.deepEqual(Object.keys(module).sort(), ["executeReviewerTicket", "validateReviewerInput"]);
  });

  it("couples to no transport, workflow mutation, or policy machinery", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "execution", "reviewer.ts"), "utf8");
    assert.ok(!/child_process|execSync|spawn|fetch\(|http|node:/i.test(code), "no transport");
    assert.ok(!/opencode/i.test(code), "no provider specifics");
    assert.ok(!/setTimeout|AbortController|backoff/i.test(code), "no policy machinery");
    assert.ok(!/closed|cancelled|blocked|changes_requested|approve/i.test(code), "no foreign decisions");
  });
});