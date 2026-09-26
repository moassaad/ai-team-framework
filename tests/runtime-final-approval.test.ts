import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CoordinatorTicket } from "../src/runtime/coordinator";
import { validateCoordinatorApprovalReference } from "../src/runtime/roles";
import {
  FinalApprovalDecisionResolver,
  runFinalApproval,
} from "../src/runtime/final-approval";
import { PmUserTestingReviewResult } from "../src/runtime/pm-testing";

// Final Coordinator approval tests (M18 R-020): explicit PM
// gate, explicit Coordinator authority, one final decision,
// immutable result. No execution, mutation, creation, sink,
// or follow-on work anywhere.

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

function pmApproved(): PmUserTestingReviewResult {
  return { outcome: "approved", ticket_ids: ["T-001"], report: "PM: matches what was agreed." };
}

function baseInput(overrides: {
  tickets?: CoordinatorTicket[];
  pmReview?: PmUserTestingReviewResult | never;
  coordinator?: { role: string } | never;
  decideFinalApproval?: FinalApprovalDecisionResolver;
} = {}): Parameters<typeof runFinalApproval>[0] {
  return {
    tickets: overrides.tickets ?? [ticket("T-001"), ticket("T-002", "closed")],
    pmReview: (("pmReview" in overrides ? overrides.pmReview : pmApproved()) as PmUserTestingReviewResult),
    coordinator: (("coordinator" in overrides ? overrides.coordinator : { role: "coordinator" }) as { role: "coordinator" }),
    decideFinalApproval: overrides.decideFinalApproval ?? (async () => ({ decision: "approved" })),
  };
}

describe("final approval", () => {
  it("explicit PM approval opens one final decision with full context", async () => {
    const seen: { ids: readonly string[]; evidence: readonly unknown[]; report: string }[] = [];
    const tickets = [ticket("T-001"), ticket("T-002", "closed", "Kept notes.")];
    const before = JSON.stringify(tickets);
    const result = await runFinalApproval(baseInput({
      tickets,
      decideFinalApproval: async (request) => {
        seen.push({ ids: request.ticket_ids, report: request.pmReport, evidence: request.evidence });
        return { decision: "approved" };
      },
    }));
    assert.equal(result.outcome, "approved");
    assert.ok(result.outcome === "approved" && result.pmReport === "PM: matches what was agreed.", "report passed through unchanged");
    assert.deepEqual(result.outcome === "approved" ? [...result.ticket_ids] : [], ["T-001", "T-002"], "caller order preserved");
    assert.equal(seen.length, 1, "exactly one decision call");
    assert.deepEqual([...seen[0].ids], ["T-001", "T-002"]);
    assert.equal(seen[0].report, "PM: matches what was agreed.", "opaque report delivered, never parsed");
    assert.deepEqual(seen[0].evidence, [
      { id: "T-001", title: "Work T-001", description: "Description for T-001.", requirements: "Requirements for T-001.", state: "technical_approval" },
      { id: "T-002", title: "Work T-002", description: "Description for T-002.", requirements: "Requirements for T-002.", state: "closed", feedback: "Kept notes." },
    ], "bounded snapshot evidence only");
    assert.equal(JSON.stringify(tickets), before, "no ticket mutation");
    assert.deepEqual(Object.isFrozen(result), true, "frozen result");
  });

  it("non-approved PM results block with diagnostics and zero decision calls", async () => {
    const gates: Array<[string, unknown, string]> = [
      ["changes-required", { outcome: "changes-required", ticket_ids: ["T-1"], report: "r", notes: "n" }, "changes-required"],
      ["not-ready", { outcome: "not-ready", technicalLeadOutcome: "x" }, "not-ready"],
      ["review-failed", { outcome: "review-failed", ticket_ids: ["T-1"], error: { kind: "x", message: "y" } }, "review-failed"],
      ["decision-failed", { outcome: "decision-failed", ticket_ids: ["T-1"], report: "r", error: { kind: "x", message: "y" } }, "decision-failed"],
      ["invalid-input", { outcome: "invalid-input", error: { kind: "x", message: "y" } }, "invalid-input"],
      ["unknown outcome", { outcome: "maybe" }, "maybe"],
      ["malformed gate", null, "invalid"],
    ];
    for (const [name, gate, diagnostic] of gates) {
      let decisions = 0;
      const tickets = [ticket("T-001")];
      const before = JSON.stringify(tickets);
      const result = await runFinalApproval(baseInput({
        tickets,
        pmReview: gate as never,
        decideFinalApproval: async () => {
          decisions += 1;
          return { decision: "approved" };
        },
      }));
      assert.equal(result.outcome, "not-ready", name);
      assert.ok(result.outcome === "not-ready" && result.pmOutcome === diagnostic, `${name}: diagnostic preserved`);
      assert.equal(decisions, 0, `${name}: zero final decision calls`);
      assert.equal(JSON.stringify(tickets), before, `${name}: no mutation`);
    }
  });

  it("Coordinator authority is explicit and exclusive", async () => {
    assert.deepEqual(validateCoordinatorApprovalReference({ role: "coordinator" }), { role: "coordinator" });
    for (const role of ["senior-reviewer", "technical-lead", "project-manager", "implementer"]) {
      assert.throws(() => validateCoordinatorApprovalReference({ role }), /must be the role "coordinator"/, role);
      const result = await runFinalApproval(baseInput({ coordinator: { role } as never }));
      assert.equal(result.outcome, "invalid-input", role);
      assert.ok(result.outcome === "invalid-input" && result.error.kind === "invalid_input", role);
    }
  });

  it("changes-required withholds approval without follow-on work", async () => {
    const tickets = [ticket("T-001")];
    const result = await runFinalApproval(baseInput({
      tickets,
      decideFinalApproval: async () => ({ decision: "changes-required", notes: "Revisit  scope.\nSecond line." }),
    }));
    assert.equal(result.outcome, "changes-required");
    assert.ok(result.outcome === "changes-required" && result.pmReport === "PM: matches what was agreed.");
    assert.ok(result.outcome === "changes-required" && result.notes === "Revisit  scope.\nSecond line.", "verbatim notes");
    assert.equal(tickets[0].state, "technical_approval", "no mutation, no rework started, no tickets created");
  });

  it("invalid decisions and failures stay bounded with the report preserved", async () => {
    for (const [name, resolution, kind] of [
      ["unknown verdict", { decision: "someday" }, "invalid_decision"],
      ["missing verdict", {}, "invalid_decision"],
      ["null resolution", null, "invalid_decision"],
      ["ticket-level spelling", { decision: "changes_requested", feedback: "x" }, "invalid_decision"],
      ["tl-level spelling", { decision: "corrections-required", notes: "x" }, "invalid_decision"],
      ["empty notes", { decision: "changes-required", notes: "" }, "invalid_decision"],
    ] as Array<[string, never, string]>) {
      const tickets = [ticket("T-001")];
      const result = await runFinalApproval(baseInput({
        tickets,
        decideFinalApproval: async () => resolution,
      }));
      assert.equal(result.outcome, "invalid-input", name);
      assert.ok(result.outcome === "invalid-input" && result.error.kind === kind, name);
      assert.equal(tickets[0].state, "technical_approval", `${name}: no mutation`);
    }
    const tickets = [ticket("T-001")];
    const failed = await runFinalApproval(baseInput({
      tickets,
      decideFinalApproval: async () => Promise.reject(new Error("operator hung up")),
    }));
    assert.equal(failed.outcome, "decision-failed");
    assert.ok(failed.outcome === "decision-failed" && failed.error.kind === "decision_error");
    assert.ok(failed.outcome === "decision-failed" && failed.pmReport === "PM: matches what was agreed.", "report preserved");
    assert.ok(failed.outcome === "decision-failed" && failed.error.message === "operator hung up");
    assert.equal(tickets[0].state, "technical_approval", "no retry, no fallback, no mutation");
  });

  it("input validation fails before any decision call", async () => {
    const valid = baseInput();
    for (const [name, input] of [
      ["non-object", "nope"],
      ["non-array tickets", { ...valid, tickets: "nope" }],
      ["malformed ticket", { ...valid, tickets: [{ id: "", title: "t", description: "d", requirements: "r", state: "ready" }] }],
      ["non-function resolver", { ...valid, decideFinalApproval: "yes" }],
      ["approved PM without report", { ...valid, pmReview: { outcome: "approved", ticket_ids: ["T-1"] } }],
    ] as Array<[string, unknown]>) {
      let decisions = 0;
      const counting = typeof input === "object" && input !== null && !Array.isArray(input) && !("decideFinalApproval" in input)
        ? { ...(input as Record<string, unknown>), decideFinalApproval: async () => { decisions += 1; return { decision: "approved" as const }; } }
        : input;
      const result = await runFinalApproval(counting as never);
      assert.equal(result.outcome, "invalid-input", name);
      assert.ok(result.outcome === "invalid-input" && result.error.kind === "invalid_input", name);
      assert.equal(decisions, 0, `${name}: zero decision calls`);
    }
  });

  it("repeated approval is deterministic and stateless", async () => {
    const first = await runFinalApproval(baseInput());
    const second = await runFinalApproval(baseInput());
    assert.deepEqual(first, second);
    assert.ok(Object.isFrozen(first), "frozen result");
  });

  it("approval boundary owns decision routing only", () => {
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "final-approval.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(
      importedModules.sort(),
      ["../workflow/states", "./coordinator", "./pm-testing", "./roles"],
      "ticket guard + PM result types + Coordinator authority + state type only",
    );
    assert.ok(!/IssueProvider|\.create\(|TicketSource|listTickets|TicketSink|updateTicket|runCoordinator|runTechnicalLead|runPmUserTesting|execute[A-Z]/i.test(code), "no creation, sync, Coordinator, or execution calls");
    assert.ok(!/child_process|\bspawn\b|execFile|execSync|fetch\(|http/i.test(code), "no processes or network");
    assert.ok(!/readFile|writeFile|mkdir|database|persist|cache|store/i.test(code), "no persistence");
    assert.ok(!/loadConfig|validateConfig|FrameworkConfig|process\.env/i.test(code), "no configuration");
    assert.ok(!/octokit|graphql|\bgh\b|label|comment|reaction/i.test(code), "no GitHub specifics");
    assert.ok(!/opencode|delegate|skill|fleet|lane|model|session|relay/i.test(code), "no OpenCode or delegate logic");
    assert.ok(!/setTimeout|setInterval|Date\.now|poll|schedule|while|retry|rollback|queue/i.test(code), "no scheduler, retry, or rollback");
    assert.ok(!/stdin|stdout|TTY|readline|argv/i.test(code), "no CLI surface");
    assert.ok(!/\.state\s*=(?![=>])/i.test(code), "no ticket mutation");
    assert.ok(!/closed|sprint_|final_approved|approved_state/i.test(code.replace(/final approval|Final Approval|final Approval|approval decision|approval authority|approval input|approval context/gi, "")), "no state transitions or new states");
  });
});
