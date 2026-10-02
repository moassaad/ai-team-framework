import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentInvocation, AgentProvider } from "../src/providers/agent";
import { ExecutionResult } from "../src/providers/result";
import { CoordinatorTicket } from "../src/runtime/coordinator";
import { validateProjectManagerReference } from "../src/runtime/roles";
import {
  PmUserTestingDecisionResolver,
  runPmUserTestingReview,
} from "../src/runtime/pm-testing";
import { TechnicalLeadReviewResult } from "../src/runtime/technical-lead";
import { executePmUserTesting } from "../src/execution/pm-testing";

// PM / User Testing boundary tests (M18 R-019): explicit TL
// gate, one PM invocation with project-manager identity,
// opaque report, explicit verdict. Read-only: fakes capture
// requests; no tickets created or mutated, no
// IssueProvider/sink/Coordinator calls, no GitHub, no config.

type Gate = TechnicalLeadReviewResult;

function ticket(id: string, state: CoordinatorTicket["state"] = "technical_approval", feedback?: string): CoordinatorTicket {
  return {
    id,
    title: `Work ${id}`,
    description: `Description for ${id}.`,
    requirements: `Requirements for ${id}.`,
    state,
    ...(feedback !== undefined ? { feedback } : {}),
  };
}

function approvedGate(): Gate {
  return { outcome: "approved", ticket_ids: ["T-001"], report: "TL: coherent." };
}

function pmProvider(calls: AgentInvocation[], text = "PM: matches what was agreed."): AgentProvider<ExecutionResult> {
  return {
    name: "fake-pm",
    execute: async (invocation) => {
      calls.push({ ...invocation });
      return { status: "succeeded", text };
    },
  };
}

function baseInput(calls: AgentInvocation[], overrides: {
  tickets?: CoordinatorTicket[];
  technicalLeadReview?: Gate | never;
  decidePmUserTesting?: PmUserTestingDecisionResolver;
} = {}): Parameters<typeof runPmUserTestingReview>[0] {
  return {
    tickets: overrides.tickets ?? [ticket("T-001"), ticket("T-002", "closed")],
    technicalLeadReview: ("technicalLeadReview" in overrides ? overrides.technicalLeadReview : approvedGate()) as never,
    projectManager: { role: "project-manager", provider: pmProvider(calls) },
    project_root: "/proj",
    timeout_ms: 5000,
    decidePmUserTesting: overrides.decidePmUserTesting ?? (async () => ({ decision: "approved" })),
  };
}

describe("pm user testing", () => {
  it("explicit TL approval opens one PM invocation with sprint context", async () => {
    const calls: AgentInvocation[] = [];
    const seen: { ids: readonly string[]; report: string }[] = [];
    const tickets = [ticket("T-001"), ticket("T-002", "closed", "Kept notes.")];
    const result = await runPmUserTestingReview(baseInput(calls, {
      tickets,
      decidePmUserTesting: async (request) => {
        seen.push({ ids: request.ticket_ids, report: request.report });
        return { decision: "approved" };
      },
    }));
    assert.equal(result.outcome, "approved");
    assert.ok(result.outcome === "approved" && result.report === "PM: matches what was agreed.");
    assert.deepEqual(result.outcome === "approved" ? [...result.ticket_ids] : [], ["T-001", "T-002"]);
    assert.equal(calls.length, 1, "exactly one PM invocation");
    assert.equal(calls[0].role, "project-manager", "explicit PM identity");
    assert.ok(calls[0].prompt.includes("# Project Manager (project-manager)"));
    assert.ok(calls[0].prompt.includes("T-001") && calls[0].prompt.includes("T-002"), "bounded snapshot evidence");
    assert.ok(calls[0].prompt.includes("[technical_approval]") && calls[0].prompt.includes("[closed]"), "current states only");
    assert.ok(calls[0].prompt.includes("Kept notes."), "preserved feedback carried exactly");
    assert.deepEqual(seen.length, 1, "decision resolved once, after PM execution");
    assert.deepEqual([...seen[0].ids], ["T-001", "T-002"]);
    assert.deepEqual(tickets.map((entry) => entry.state), ["technical_approval", "closed"], "no state mutation");
  });

  it("non-approved TL results block everything with diagnostics", async () => {
    const gates: Array<[string, unknown, string]> = [
      ["corrections-required", { outcome: "corrections-required", ticket_ids: ["T-1"], report: "r", notes: "n" }, "corrections-required"],
      ["not-ready", { outcome: "not-ready", evaluation: {} }, "not-ready"],
      ["review-failed", { outcome: "review-failed", ticket_ids: ["T-1"], error: { kind: "x", message: "y" } }, "review-failed"],
      ["decision-failed", { outcome: "decision-failed", ticket_ids: ["T-1"], report: "r", error: { kind: "x", message: "y" } }, "decision-failed"],
      ["unknown outcome", { outcome: "maybe" }, "maybe"],
      ["malformed gate", null, "invalid"],
    ];
    for (const [name, gate, diagnostic] of gates) {
      const calls: AgentInvocation[] = [];
      let decisions = 0;
      const tickets = [ticket("T-001")];
      const before = JSON.stringify(tickets);
      const result = await runPmUserTestingReview(baseInput(calls, {
        tickets,
        technicalLeadReview: gate as never,
        decidePmUserTesting: async () => {
          decisions += 1;
          return { decision: "approved" };
        },
      }));
      assert.equal(result.outcome, "not-ready", name);
      assert.ok(result.outcome === "not-ready" && result.technicalLeadOutcome === diagnostic, `${name}: diagnostic preserved`);
      assert.deepEqual(calls, [], `${name}: zero provider calls`);
      assert.equal(decisions, 0, `${name}: zero decision calls`);
      assert.equal(JSON.stringify(tickets), before, `${name}: no mutation`);
    }
  });

  it("changes-required carries verbatim notes and creates nothing", async () => {
    const calls: AgentInvocation[] = [];
    const tickets = [ticket("T-001")];
    const result = await runPmUserTestingReview(baseInput(calls, {
      tickets,
      decidePmUserTesting: async () => ({ decision: "changes-required", notes: "Copy  drifts  on mobile.\nSecond line." }),
    }));
    assert.equal(result.outcome, "changes-required");
    assert.ok(result.outcome === "changes-required" && result.report === "PM: matches what was agreed.");
    assert.ok(result.outcome === "changes-required" && result.notes === "Copy  drifts  on mobile.\nSecond line.", "verbatim notes");
    assert.ok(!("feedback" in result), "ticket-level feedback semantics not reused");
    assert.equal(tickets[0].state, "technical_approval", "no mutation, no ticket creation possible here");
    assert.equal(calls.length, 1, "no retry, no second invocation");
  });

  it("invalid and missing decisions fail safely with the report preserved", async () => {
    for (const [name, resolution] of [
      ["unknown verdict", { decision: "someday" }],
      ["missing verdict", {}],
      ["null resolution", null],
      ["ticket-level spelling", { decision: "changes_requested", feedback: "x" }],
      ["tl-level spelling", { decision: "corrections-required", notes: "x" }],
      ["empty notes", { decision: "changes-required", notes: "" }],
    ] as Array<[string, never]>) {
      const calls: AgentInvocation[] = [];
      const tickets = [ticket("T-001")];
      const result = await runPmUserTestingReview(baseInput(calls, {
        tickets,
        decidePmUserTesting: async () => resolution,
      }));
      assert.equal(result.outcome, "decision-failed", name);
      assert.ok(result.outcome === "decision-failed" && result.error.kind === "invalid_decision", name);
      assert.ok(result.outcome === "decision-failed" && result.report === "PM: matches what was agreed.", `${name}: report preserved`);
      assert.equal(tickets[0].state, "technical_approval", `${name}: no mutation`);
      assert.equal(calls.length, 1, `${name}: single PM call, no retry`);
    }
  });

  it("provider and resolver failures stay bounded with no follow-on work", async () => {
    const failing: AgentProvider<ExecutionResult> = {
      name: "fake-pm",
      execute: async () => {
        throw new Error("opencode provider: process error");
      },
    };
    const tickets = [ticket("T-001")];
    const failed = await runPmUserTestingReview({
      ...baseInput([], { tickets }),
      projectManager: { role: "project-manager", provider: failing },
    });
    assert.equal(failed.outcome, "review-failed");
    assert.ok(failed.outcome === "review-failed" && failed.error.kind === "provider_error");
    assert.ok(!("report" in failed), "no report fabricated on provider failure");
    assert.equal(tickets[0].state, "technical_approval", "no auto-approval, no mutation");

    const calls: AgentInvocation[] = [];
    const decided = await runPmUserTestingReview(baseInput(calls, {
      tickets: [ticket("T-001")],
      decidePmUserTesting: async () => Promise.reject(new Error("operator hung up")),
    }));
    assert.equal(decided.outcome, "decision-failed");
    assert.ok(decided.outcome === "decision-failed" && decided.error.kind === "decision_error");
    assert.ok(decided.outcome === "decision-failed" && decided.report === "PM: matches what was agreed.");
    assert.equal(calls.length, 1, "nothing rerun");
  });

  it("execution seam validates PM identity, evidence, and provider before running", async () => {
    const calls: AgentInvocation[] = [];
    const provider = pmProvider(calls);
    const evidence = [{ id: "T-1", title: "t", description: "d", requirements: "r", state: "technical_approval" as const }];
    const base = { evidence, project_root: "/proj", provider, timeout_ms: 1000 };
    const completed = await executePmUserTesting({ ...base, role: "project-manager" });
    assert.equal(completed.outcome, "completed");
    assert.ok(completed.outcome === "completed" && completed.report === "PM: matches what was agreed.");
    for (const role of ["senior-reviewer", "technical-lead", "implementer"]) {
      await assert.rejects(executePmUserTesting({ ...base, role: role as never }), /role must be "project-manager"/, role);
    }
    await assert.rejects(
      executePmUserTesting({ ...base, role: "project-manager", evidence: [{ id: "", title: "t", description: "d", requirements: "r", state: "technical_approval" }] }),
      /evidence\.id must be a non-empty string/,
    );
    assert.equal(calls.length, 1, "only the valid call reached the provider");
  });

  it("PM reference validation rejects silent reuse of other roles", async () => {
    const provider: AgentProvider<ExecutionResult> = { name: "x", execute: async () => ({ status: "succeeded", text: "ok" }) };
    assert.deepEqual(validateProjectManagerReference({ role: "project-manager", provider }), { role: "project-manager", provider });
    for (const role of ["senior-reviewer", "technical-lead", "implementer"] as const) {
      assert.throws(() => validateProjectManagerReference({ role, provider }), /must be the role "project-manager"/, role);
    }
    assert.throws(() => validateProjectManagerReference({ role: "project-manager", provider: { name: "x" } }), /must satisfy the agent provider contract/);
    const calls: AgentInvocation[] = [];
    const result = await runPmUserTestingReview({ ...baseInput(calls), projectManager: { role: "technical-lead", provider } as never });
    assert.equal(result.outcome, "invalid-input", "wrong identity is bounded invalid input, never executed");
    assert.deepEqual(calls, [], "wrong identity never executes");
  });

  it("input validation fails before evaluation, PM, or decision", async () => {
    const calls: AgentInvocation[] = [];
    const valid = baseInput(calls);
    for (const [name, input] of [
      ["non-object", "nope"],
      ["non-array tickets", { ...valid, tickets: "nope" }],
      ["malformed ticket", { ...valid, tickets: [{ id: "", title: "t", description: "d", requirements: "r", state: "ready" }] }],
      ["empty project root", { ...valid, project_root: "" }],
      ["bad timeout", { ...valid, timeout_ms: 0 }],
      ["non-function resolver", { ...valid, decidePmUserTesting: "yes" }],
    ] as Array<[string, unknown]>) {
      const result = await runPmUserTestingReview(input as never);
      assert.equal(result.outcome, "invalid-input", name);
      assert.ok(result.outcome === "invalid-input" && result.error.kind === "invalid_input", name);
    }
    assert.deepEqual(calls, [], "no PM invocation on invalid input");
  });

  it("repeated composition is deterministic and stateless", async () => {
    const firstCalls: AgentInvocation[] = [];
    const secondCalls: AgentInvocation[] = [];
    const first = await runPmUserTestingReview(baseInput(firstCalls));
    const second = await runPmUserTestingReview(baseInput(secondCalls));
    assert.deepEqual(first, second);
    assert.equal(firstCalls.length, 1);
    assert.equal(secondCalls.length, 1);
    assert.ok(Object.isFrozen(first), "frozen result");
  });

  it("PM boundary owns review orchestration only", () => {
    for (const file of ["runtime/pm-testing.ts", "execution/pm-testing.ts"]) {
      const source = readFileSync(join(__dirname, "..", "..", "src", file), "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
      assert.ok(!/IssueProvider|\.create\(|TicketSource|listTickets|TicketSink|updateTicket|runCoordinator|runTechnicalLead|executeTechnicalLead/i.test(code), `${file}: no creation, sync, or other-stage calls`);
      assert.ok(!/child_process|\bspawn\b|execFile|execSync|fetch\(|http/i.test(code), `${file}: no processes or network`);
      assert.ok(!/readFile|writeFile|mkdir|database|persist|cache|store/i.test(code), `${file}: no persistence`);
      assert.ok(!/loadConfig|validateConfig|FrameworkConfig|process\.env/i.test(code), `${file}: no configuration`);
      assert.ok(!/delegate|skill|fleet|lane|model|session|relay/i.test(code.replace(/ProjectManagerRoleReference|projectManagerRole|project manager reference/gi, "")), `${file}: no delegate logic`);
      assert.ok(!/setTimeout|setInterval|Date\.now|poll|schedule|while/i.test(code), `${file}: no scheduler or time`);
      assert.ok(!/\.state\s*=(?![=>])/i.test(code), `${file}: no ticket mutation`);
      assert.ok(!/pm_review_pending|user_testing|uat_|test_approved|test_rejected|sprint_/i.test(code), `${file}: no new workflow states`);
    }
    const runtimeCode = readFileSync(join(__dirname, "..", "..", "src", "runtime", "pm-testing.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const runtimeImports = [...new Set([...runtimeCode.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(
      runtimeImports.sort(),
      ["../execution/pm-testing", "./coordinator", "./roles", "./technical-lead"],
      "ticket guard + PM role + PM execution + TL result types only",
    );
    const seamCode = readFileSync(join(__dirname, "..", "..", "src", "execution", "pm-testing.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const seamImports = [...new Set([...seamCode.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(
      seamImports.sort(),
      ["../providers/agent", "../providers/execution", "../providers/prompt", "../providers/result", "../roles/contract", "../roles/project-manager", "../workflow/states"],
      "generic execution contracts plus the PM role contract only",
    );
  });
});
