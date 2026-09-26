import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentInvocation, AgentProvider, validateAgentInvocation } from "../src/providers/agent";
import { ExecutionResult } from "../src/providers/result";
import { CoordinatorTicket, runCoordinatorTicket } from "../src/runtime/coordinator";
import { createProductionCoordinatorDeps } from "../src/runtime/production";
import { executeImplementerTicket } from "../src/execution/implementer";
import { executeReviewerTicket } from "../src/execution/reviewer";

// Role-specific execution context tests (M18 R-015): the
// resolved role identity travels as structured invocation
// data to the correct seam. Fake providers capture requests;
// no OpenCode, GitHub, delegate, or filesystem anywhere.

interface Calls {
  implementer: AgentInvocation[];
  reviewer: AgentInvocation[];
}

function capturingProvider(calls: AgentInvocation[], text: string): AgentProvider<ExecutionResult> {
  return {
    name: "fake-capturing",
    execute: async (invocation) => {
      calls.push({ ...invocation });
      return { status: "succeeded", text };
    },
  };
}

function ticket(id: string, state: CoordinatorTicket["state"] = "ready"): CoordinatorTicket {
  return { id, title: `Work ${id}`, description: `Description for ${id}.`, requirements: `Requirements for ${id}.`, state };
}

async function run(tickets: CoordinatorTicket[], calls: Calls, specialty: "backend" | "testing" = "backend") {
  const deps = createProductionCoordinatorDeps({
    specialty,
    implementerProvider: capturingProvider(calls.implementer, "Shipped; gates pass."),
    reviewerProvider: capturingProvider(calls.reviewer, "Reviewer notes: solid."),
  });
  return runCoordinatorTicket({
    tickets,
    roles: deps.roles,
    project_root: "/proj",
    timeout_ms: 5000,
    decideReview: async () => ({ decision: "approved" }),
  });
}

describe("role execution context", () => {
  it("Implementer identity and specialty reach the execution boundary", async () => {
    const calls: Calls = { implementer: [], reviewer: [] };
    const tickets = [ticket("T-001")];
    const result = await run(tickets, calls, "testing");
    assert.equal(result.outcome, "completed");
    assert.equal(calls.implementer.length, 1);
    assert.equal(calls.implementer[0].role, "implementer", "structured role, not parsed text");
    assert.equal(calls.implementer[0].project_root, "/proj");
    assert.ok(calls.implementer[0].prompt.includes("# Implementer (implementer)"), "prompt still carries the role");
    assert.ok(calls.implementer[0].prompt.includes("Specialty: testing."), "resolved specialty preserved verbatim");
  });

  it("Senior Reviewer identity reaches its own boundary without Implementer specialty", async () => {
    const calls: Calls = { implementer: [], reviewer: [] };
    await run([ticket("T-001")], calls);
    assert.equal(calls.reviewer.length, 1);
    assert.equal(calls.reviewer[0].role, "senior-reviewer");
    assert.notEqual(calls.reviewer[0].role, calls.implementer[0].role, "reviewer is never the Implementer role");
    assert.ok(calls.reviewer[0].prompt.includes("# Senior Reviewer (senior-reviewer)"));
    assert.ok(!calls.reviewer[0].prompt.includes("Specialty:"), "reviewer receives no Implementer specialty");
  });

  it("the same provider may serve both roles with distinct contexts", async () => {
    const seen: AgentInvocation[] = [];
    const shared = capturingProvider(seen, "ok");
    const deps = createProductionCoordinatorDeps({
      specialty: "backend",
      implementerProvider: shared,
      reviewerProvider: shared,
    });
    const tickets = [ticket("T-001")];
    const result = await runCoordinatorTicket({
      tickets,
      roles: deps.roles,
      project_root: "/proj",
      timeout_ms: 5000,
      decideReview: async () => ({ decision: "approved" }),
    });
    assert.equal(result.outcome, "completed");
    assert.deepEqual(seen.map((invocation) => invocation.role), ["implementer", "senior-reviewer"]);
  });

  it("role context survives the R-002 rework cycle", async () => {
    const tickets = [{ ...ticket("T-001"), state: "changes_requested" as const, feedback: "Tighten it." }];
    const implementerCalls: AgentInvocation[] = [];
    const reviewerCalls: AgentInvocation[] = [];
    const deps = createProductionCoordinatorDeps({
      specialty: "backend",
      implementerProvider: capturingProvider(implementerCalls, "Reworked."),
      reviewerProvider: capturingProvider(reviewerCalls, "Better."),
    });
    const result = await runCoordinatorTicket({
      tickets,
      roles: deps.roles,
      project_root: "/proj",
      timeout_ms: 5000,
      decideReview: async () => ({ decision: "approved" }),
    });
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.ticket_id === "T-001");
    assert.deepEqual(implementerCalls.map((invocation) => invocation.role), ["implementer"], "no ReworkImplementer role invented");
    assert.deepEqual(reviewerCalls.map((invocation) => invocation.role), ["senior-reviewer"]);
    assert.ok(implementerCalls[0].prompt.includes("Tighten it."), "feedback still transported verbatim");
  });

  it("wrong role identity fails before provider invocation", async () => {
    const calls: AgentInvocation[] = [];
    const provider = capturingProvider(calls, "ok");
    const base = { ticket: ticket("T-001"), project_root: "/proj", provider, timeout_ms: 1000 };
    await assert.rejects(
      executeImplementerTicket({ ...base, specialty: "backend", role: "senior-reviewer" }),
      /role must be "implementer"/,
    );
    await assert.rejects(
      executeReviewerTicket({ ...base, implementation_result: "done", role: "implementer" }),
      /role must be "senior-reviewer"/,
    );
    await assert.rejects(
      executeImplementerTicket({ ...base, specialty: "wizard" as never, role: "implementer" }),
      /unknown specialty/,
    );
    await assert.rejects(
      executeImplementerTicket({ ...base, specialty: "backend", role: "coordinator" }),
      /role must be "implementer"/,
    );
    assert.deepEqual(calls, [], "no provider invoked on role failure");
  });

  it("malformed resolver output still fails safely at the existing seam", async () => {
    const calls: AgentInvocation[] = [];
    const provider = capturingProvider(calls, "ok");
    await assert.rejects(
      runCoordinatorTicket({
        tickets: [ticket("T-001")],
        roles: {
          resolveImplementer: async () => ({ role: "coordinator", specialty: "backend", provider }),
          resolveSeniorReviewer: async () => ({ role: "senior-reviewer", provider }),
        },
        project_root: "/proj",
        timeout_ms: 5000,
        decideReview: async () => ({ decision: "approved" }),
      }),
      /must be the role "implementer"/,
    );
    assert.deepEqual(calls, [], "wrong identity never reaches execution");
  });

  it("decision still occurs after reviewer execution with an opaque report", async () => {
    const order: string[] = [];
    const deps = createProductionCoordinatorDeps({
      specialty: "backend",
      implementerProvider: { name: "i", execute: async () => ({ status: "succeeded", text: "code" }) },
      reviewerProvider: {
        name: "r",
        execute: async () => {
          order.push("reviewer");
          return { status: "succeeded", text: "Opaque findings." };
        },
      },
    });
    const tickets = [ticket("T-001")];
    const result = await runCoordinatorTicket({
      tickets,
      roles: deps.roles,
      project_root: "/proj",
      timeout_ms: 5000,
      decideReview: async (request) => {
        order.push("decision");
        assert.equal(request.report, "Opaque findings.");
        return { decision: "changes_requested", feedback: "Explain." };
      },
    });
    assert.deepEqual(order, ["reviewer", "decision"]);
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.final_state === "changes_requested");
  });

  it("invocation validation accepts structured role context", () => {
    const withRole = validateAgentInvocation({ prompt: "Do it.", project_root: "/proj", role: "implementer" });
    assert.equal(withRole.role, "implementer");
    assert.deepEqual(Object.isFrozen(withRole), true);
    const withoutRole = validateAgentInvocation({ prompt: "Do it.", project_root: "/proj" });
    assert.equal(withoutRole.role, undefined, "role stays optional for backward compatibility");
    assert.throws(
      () => validateAgentInvocation({ prompt: "Do it.", project_root: "/proj", role: "wizard" }),
      /role must be a valid role id/,
    );
  });

  it("role code owns execution context only", () => {
    for (const file of ["runtime/roles.ts", "runtime/coordinator.ts", "execution/implementer.ts", "execution/reviewer.ts", "providers/agent.ts"]) {
      const source = readFileSync(join(__dirname, "..", "..", "src", file), "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
      assert.ok(!/opencode run|child_process|\bspawn\b|execFile|execSync/i.test(code), `${file}: no process execution`);
      assert.ok(!/delegate|skill|fleet|lane|session|relay/i.test(code.replace(/resolveSeniorReviewer|RoleResolver|role resolution|selected role|Senior Reviewer/g, "")), `${file}: no delegate skill mapping`);
      assert.ok(!/github|octokit|rest|graphql|\bgh\b/i.test(code.replace(/github-production|GitHub-blind|github-blind/gi, "")), `${file}: no GitHub behavior`);
      assert.ok(!/loadConfig|validateConfig|FrameworkConfig|process\.env/i.test(code), `${file}: no configuration mutation`);
      assert.ok(!/\bgit\b|commit|merge|branch/i.test(code), `${file}: no git`);
    }
    const agentCode = readFileSync(join(__dirname, "..", "..", "src", "providers", "agent.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const agentImports = [...new Set([...agentCode.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(agentImports, ["../roles/contract"], "generic contract gains only the role identity type");
    assert.ok(!/session|fleet|skill|providerName|relayPath|cliCommand|model/i.test(agentCode), "no provider-specific metadata");
  });
});
