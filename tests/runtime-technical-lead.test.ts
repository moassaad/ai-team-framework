import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentInvocation, AgentProvider } from "../src/providers/agent";
import { ExecutionResult } from "../src/providers/result";
import { CoordinatorTicket } from "../src/runtime/coordinator";
import { validateTechnicalLeadReference } from "../src/runtime/roles";
import {
  TechnicalLeadDecisionResolver,
  runTechnicalLeadReview,
} from "../src/runtime/technical-lead";
import { executeTechnicalLeadReview } from "../src/execution/technical-lead";

// Technical Lead sprint review tests (M18 R-017): readiness
// gate, one explicit TL invocation with technical-lead
// identity, opaque report, explicit verdict. Read-only:
// fakes capture requests; no tickets created or mutated, no
// IssueProvider/sink calls, no GitHub, no config.

function ticket(id: string, state: CoordinatorTicket["state"] = "technical_approval"): CoordinatorTicket {
  return { id, title: `Work ${id}`, description: `Description for ${id}.`, requirements: `Requirements for ${id}.`, state };
}

function tlProvider(calls: AgentInvocation[], text = "Sprint looks coherent."): AgentProvider<ExecutionResult> {
  return {
    name: "fake-tl",
    execute: async (invocation) => {
      calls.push({ ...invocation });
      return { status: "succeeded", text };
    },
  };
}

function baseInput(calls: AgentInvocation[], overrides: {
  tickets?: CoordinatorTicket[];
  decideTechnicalLead?: TechnicalLeadDecisionResolver;
} = {}): Parameters<typeof runTechnicalLeadReview>[0] {
  return {
    tickets: overrides.tickets ?? [ticket("T-001"), ticket("T-002")],
    technicalLead: { role: "technical-lead", provider: tlProvider(calls) },
    project_root: "/proj",
    timeout_ms: 5000,
    decideTechnicalLead: overrides.decideTechnicalLead ?? (async () => ({ decision: "approved" })),
  };
}

describe("technical lead review", () => {
  it("ready sprint invokes TL once with explicit identity and sprint context", async () => {
    const calls: AgentInvocation[] = [];
    const seen: { ids: readonly string[]; report: string }[] = [];
    const tickets = [ticket("T-001"), ticket("T-002", "closed")];
    const result = await runTechnicalLeadReview(baseInput(calls, {
      tickets,
      decideTechnicalLead: async (request) => {
        seen.push({ ids: request.ticket_ids, report: request.report });
        return { decision: "approved" };
      },
    }));
    assert.equal(result.outcome, "approved");
    assert.ok(result.outcome === "approved" && result.report === "Sprint looks coherent.");
    assert.deepEqual(result.outcome === "approved" ? [...result.ticket_ids] : [], ["T-001", "T-002"]);
    assert.equal(calls.length, 1, "exactly one TL invocation");
    assert.equal(calls[0].role, "technical-lead", "distinct TL identity, never senior-reviewer");
    assert.ok(calls[0].prompt.includes("# Technical Lead (technical-lead)"));
    assert.ok(calls[0].prompt.includes("T-001") && calls[0].prompt.includes("T-002"), "sprint evidence present");
    assert.ok(calls[0].prompt.includes("[technical_approval]") && calls[0].prompt.includes("[closed]"), "final states present");
    assert.deepEqual(seen.length, 1, "decision resolved once, after TL execution");
    assert.deepEqual([...seen[0].ids], ["T-001", "T-002"]);
    assert.equal(tickets[0].state, "technical_approval", "no ticket mutation");
  });

  it("incomplete sprint blocks TL with diagnostics and zero invocations", async () => {
    const calls: AgentInvocation[] = [];
    let decisions = 0;
    const tickets = [ticket("T-001"), ticket("T-002", "ready"), ticket("T-003", "blocked")];
    const before = JSON.stringify(tickets);
    const result = await runTechnicalLeadReview(baseInput(calls, {
      tickets,
      decideTechnicalLead: async () => {
        decisions += 1;
        return { decision: "approved" };
      },
    }));
    assert.equal(result.outcome, "not-ready");
    assert.ok(result.outcome === "not-ready" && result.evaluation.readyForTechnicalLeadReview === false);
    assert.ok(result.outcome === "not-ready" && result.evaluation.counts.executable === 1);
    assert.ok(result.outcome === "not-ready" && result.evaluation.counts.blocked === 1);
    assert.deepEqual(calls, [], "TL never invoked");
    assert.equal(decisions, 0, "decision never resolved");
    assert.equal(JSON.stringify(tickets), before, "nothing mutated");
  });

  it("corrections-required carries report and verbatim notes without creating tickets", async () => {
    const calls: AgentInvocation[] = [];
    const tickets = [ticket("T-001")];
    const result = await runTechnicalLeadReview(baseInput(calls, {
      tickets,
      decideTechnicalLead: async () => ({ decision: "corrections-required", notes: "Split T-001: auth  needs  its own ticket." }),
    }));
    assert.equal(result.outcome, "corrections-required");
    assert.ok(result.outcome === "corrections-required" && result.report === "Sprint looks coherent.");
    assert.ok(result.outcome === "corrections-required" && result.notes === "Split T-001: auth  needs  its own ticket.", "verbatim notes");
    assert.ok(!("feedback" in result), "ticket-level feedback semantics not reused");
    assert.equal(tickets[0].state, "technical_approval");
    assert.equal(calls.length, 1, "no retry, no second invocation");
  });

  it("invalid and missing decisions fail safely with the report preserved", async () => {
    for (const [name, resolution] of [
      ["unknown verdict", { decision: "someday" }],
      ["missing verdict", {}],
      ["null resolution", null],
      ["ticket-level spelling", { decision: "changes_requested", feedback: "x" }],
      ["empty notes", { decision: "corrections-required", notes: "" }],
    ] as Array<[string, never]>) {
      const calls: AgentInvocation[] = [];
      const tickets = [ticket("T-001")];
      const result = await runTechnicalLeadReview(baseInput(calls, {
        tickets,
        decideTechnicalLead: async () => resolution,
      }));
      assert.equal(result.outcome, "decision-failed", name);
      assert.ok(result.outcome === "decision-failed" && result.error.kind === "invalid_decision", name);
      assert.ok(result.outcome === "decision-failed" && result.report === "Sprint looks coherent.", `${name}: report preserved`);
      assert.equal(tickets[0].state, "technical_approval", `${name}: no mutation`);
      assert.equal(calls.length, 1, `${name}: single TL call, no retry`);
    }
  });

  it("provider and resolver failures stay bounded with no follow-on work", async () => {
    const failing: AgentProvider<ExecutionResult> = {
      name: "fake-tl",
      execute: async () => {
        throw new Error("opencode provider: process error");
      },
    };
    const tickets = [ticket("T-001")];
    const failed = await runTechnicalLeadReview({
      ...baseInput([], { tickets }),
      technicalLead: { role: "technical-lead", provider: failing },
    });
    assert.equal(failed.outcome, "review-failed");
    assert.ok(failed.outcome === "review-failed" && failed.error.kind === "provider_error");
    assert.ok(!("report" in failed), "no report fabricated on provider failure");
    assert.equal(tickets[0].state, "technical_approval", "no auto-approval, no mutation");

    const calls: AgentInvocation[] = [];
    const decided = await runTechnicalLeadReview(baseInput(calls, {
      tickets: [ticket("T-001")],
      decideTechnicalLead: async () => Promise.reject(new Error("operator hung up")),
    }));
    assert.equal(decided.outcome, "decision-failed");
    assert.ok(decided.outcome === "decision-failed" && decided.error.kind === "decision_error");
    assert.ok(decided.outcome === "decision-failed" && decided.report === "Sprint looks coherent.");
    assert.equal(calls.length, 1, "nothing rerun");
  });

  it("execution seam validates TL identity, evidence, and provider before running", async () => {
    const calls: AgentInvocation[] = [];
    const provider = tlProvider(calls);
    const evidence = [{ id: "T-1", title: "t", description: "d", requirements: "r", state: "technical_approval" as const }];
    const base = { evidence, project_root: "/proj", provider, timeout_ms: 1000 };
    const completed = await executeTechnicalLeadReview({ ...base, role: "technical-lead" });
    assert.equal(completed.outcome, "completed");
    assert.ok(completed.outcome === "completed" && completed.report === "Sprint looks coherent.");
    await assert.rejects(
      executeTechnicalLeadReview({ ...base, role: "senior-reviewer" }),
      /role must be "technical-lead"/,
    );
    await assert.rejects(
      executeTechnicalLeadReview({ ...base, role: "technical-lead", evidence: [{ id: "", title: "t", description: "d", requirements: "r", state: "technical_approval" }] }),
      /evidence\.id must be a non-empty string/,
    );
    assert.equal(calls.length, 1, "only the valid call reached the provider");
  });

  it("TL reference validation rejects silent Senior Reviewer reuse", async () => {
    const provider: AgentProvider<ExecutionResult> = { name: "x", execute: async () => ({ status: "succeeded", text: "ok" }) };
    assert.deepEqual(validateTechnicalLeadReference({ role: "technical-lead", provider }), { role: "technical-lead", provider });
    assert.throws(() => validateTechnicalLeadReference({ role: "senior-reviewer", provider }), /must be the role "technical-lead"/);
    assert.throws(() => validateTechnicalLeadReference({ role: "technical-lead", provider: { name: "x" } }), /must satisfy the agent provider contract/);
    const calls: AgentInvocation[] = [];
    await assert.rejects(
      runTechnicalLeadReview({ ...baseInput(calls), technicalLead: { role: "senior-reviewer", provider } as never }),
      /must be the role "technical-lead"/,
    );
    assert.deepEqual(calls, [], "wrong identity never executes");
  });

  it("input validation fails before evaluation, TL, or decision", async () => {
    const calls: AgentInvocation[] = [];
    const valid = baseInput(calls);
    await assert.rejects(runTechnicalLeadReview("nope" as never), /expected a review input object/);
    await assert.rejects(runTechnicalLeadReview({ ...valid, tickets: "nope" as never }), /tickets must be an array/);
    await assert.rejects(
      runTechnicalLeadReview({ ...valid, tickets: [{ id: "", title: "t", description: "d", requirements: "r", state: "ready" }] }),
      /id, title, description, requirements, and a valid state/,
    );
    await assert.rejects(runTechnicalLeadReview({ ...valid, timeout_ms: 0 }), /timeout_ms must be a positive finite number/);
    await assert.rejects(runTechnicalLeadReview({ ...valid, decideTechnicalLead: "yes" as never }), /must be a technical lead decision resolver/);
    assert.deepEqual(calls, [], "no TL invocation on invalid input");
  });

  it("repeated composition is deterministic and stateless", async () => {
    const firstCalls: AgentInvocation[] = [];
    const secondCalls: AgentInvocation[] = [];
    const first = await runTechnicalLeadReview(baseInput(firstCalls));
    const second = await runTechnicalLeadReview(baseInput(secondCalls));
    assert.deepEqual(first, second);
    assert.equal(firstCalls.length, 1);
    assert.equal(secondCalls.length, 1);
    assert.ok(Object.isFrozen(first), "frozen result");
  });

  it("TL boundary owns review orchestration only", () => {
    for (const file of ["runtime/technical-lead.ts", "execution/technical-lead.ts"]) {
      const source = readFileSync(join(__dirname, "..", "..", "src", file), "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
      assert.ok(!/IssueProvider|\.create\(|TicketSink|updateTicket|listTickets/i.test(code), `${file}: no creation or sync calls`);
      assert.ok(!/child_process|\bspawn\b|execFile|execSync|fetch\(|http/i.test(code), `${file}: no processes or network`);
      assert.ok(!/readFile|writeFile|mkdir|database|persist|cache|store/i.test(code), `${file}: no persistence`);
      assert.ok(!/loadConfig|validateConfig|FrameworkConfig|process\.env/i.test(code), `${file}: no configuration`);
      assert.ok(!/delegate|skill|fleet|lane|model|session|relay/i.test(code.replace(/TechnicalLeadRoleReference|technicalLeadRole|technicalLead reference|technical lead reference/gi, "")), `${file}: no delegate logic`);
      assert.ok(!/setTimeout|setInterval|Date\.now|poll|schedule|while/i.test(code), `${file}: no scheduler or time`);
      assert.ok(!/\.state\s*=(?![=>])/i.test(code), `${file}: no ticket mutation`);
      assert.ok(!/technical_review|tl_review|tl_approved|tl_rejected|sprint_completed|sprint_in_review|tl_pending/i.test(code), `${file}: no new workflow states`);
    }
    const runtimeCode = readFileSync(join(__dirname, "..", "..", "src", "runtime", "technical-lead.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const runtimeImports = [...new Set([...runtimeCode.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(
      runtimeImports.sort(),
      ["../execution/technical-lead", "./coordinator", "./roles", "./sprint"],
      "sprint gate + ticket guard + TL role + TL execution only",
    );
    const seamCode = readFileSync(join(__dirname, "..", "..", "src", "execution", "technical-lead.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const seamImports = [...new Set([...seamCode.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(
      seamImports.sort(),
      ["../providers/agent", "../providers/execution", "../providers/prompt", "../providers/result", "../roles/contract", "../roles/technical-lead", "../workflow/states"],
      "generic execution contracts plus the TL role contract only",
    );
  });
});
