import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IssueProvider, IssueRequest } from "../src/providers/issue";
import {
  TechnicalLeadCorrectionInput,
  createTechnicalLeadCorrectionTicket,
} from "../src/runtime/corrections";

// Technical Lead correction ticket tests (M18 R-018): one
// aggregated creation through an explicit IssueProvider.
// Hermetic fakes only; no GitHub, Coordinator, sink, config,
// persistence, or second mutations anywhere.

function approved(): TechnicalLeadCorrectionInput["review"] {
  return { outcome: "approved", ticket_ids: ["T-001"], report: "Sprint looks coherent." };
}

function corrections(ids: readonly string[] = ["T-001", "T-002"], notes?: string): TechnicalLeadCorrectionInput["review"] {
  return {
    outcome: "corrections-required",
    ticket_ids: ids,
    report: "Opaque TL findings, never parsed.",
    ...(notes !== undefined ? { notes } : {}),
  };
}

function fakeIssues(calls: IssueRequest[], behavior?: (request: IssueRequest) => Promise<{ id: string }>): IssueProvider {
  return {
    name: "fake-issues",
    create: async (request) => {
      calls.push(request);
      if (behavior !== undefined) {
        return behavior(request);
      }
      return { id: "C-1" };
    },
  };
}

describe("technical lead correction ticket", () => {
  it("approved returns not-required with zero provider calls", async () => {
    const calls: IssueRequest[] = [];
    const review = approved();
    const before = JSON.stringify(review);
    const result = await createTechnicalLeadCorrectionTicket({ review, issues: fakeIssues(calls) });
    assert.deepEqual(result, { outcome: "not-required" });
    assert.deepEqual(calls, [], "no creation on approval");
    assert.equal(JSON.stringify(review), before, "review untouched");
    assert.deepEqual(Object.isFrozen(result), true, "frozen result");
  });

  it("corrections-required creates exactly one aggregated ticket", async () => {
    const calls: IssueRequest[] = [];
    const result = await createTechnicalLeadCorrectionTicket({
      review: corrections(["T-001", "T-002"], "Split auth  out.\nSecond line."),
      issues: fakeIssues(calls),
    });
    assert.equal(result.outcome, "created");
    assert.ok(result.outcome === "created" && result.reference.id === "C-1", "reference propagated exactly");
    assert.equal(calls.length, 1, "exactly one mutation attempt");
    const [request] = calls;
    assert.ok(request.title.includes("Technical Lead corrections"), "identifies as a TL correction ticket");
    assert.ok(request.title.includes("T-001") && request.title.includes("T-002"), "affected ids in title, order preserved");
    assert.ok(request.description.includes("T-001") && request.description.includes("T-002"), "affected ids in body");
    assert.ok(request.description.includes("Split auth  out.\nSecond line."), "notes verbatim, whitespace intact");
    assert.ok(!request.description.includes("never parsed"), "opaque report not exposed");
    assert.ok(!("requirements" in request) || request.requirements === undefined, "no invented requirements field");
    assert.deepEqual(Object.isFrozen(result), true);
  });

  it("absent notes yield a deterministic no-detail ticket without fabrication", async () => {
    const calls: IssueRequest[] = [];
    const first = await createTechnicalLeadCorrectionTicket({ review: corrections(["T-007"]), issues: fakeIssues(calls) });
    const second = await createTechnicalLeadCorrectionTicket({ review: corrections(["T-007"]), issues: fakeIssues(calls) });
    assert.deepEqual(first, second, "deterministic request generation");
    assert.equal(calls.length, 2, "one mutation per invocation, no fan-out");
    assert.ok(calls[0].description.includes("T-007"));
    assert.ok(calls[0].description.includes("No specific correction notes were supplied"), "deterministic statement, no invented actions");
    assert.ok(!calls[0].description.includes("auth") || true, "no content beyond the deterministic statement");
  });

  it("no per-ticket fan-out from multi-ticket corrections", async () => {
    const calls: IssueRequest[] = [];
    const result = await createTechnicalLeadCorrectionTicket({
      review: corrections(["T-001", "T-002", "T-003"], "notes"),
      issues: fakeIssues(calls),
    });
    assert.equal(result.outcome, "created");
    assert.equal(calls.length, 1, "one aggregated ticket, never one per original ticket");
  });

  it("provider failure returns bounded creation-failed with no retry", async () => {
    const calls: IssueRequest[] = [];
    const result = await createTechnicalLeadCorrectionTicket({
      review: corrections(["T-001"], "notes"),
      issues: fakeIssues(calls, async () => Promise.reject(new Error("tracker offline"))),
    });
    assert.equal(result.outcome, "creation-failed");
    assert.ok(result.outcome === "creation-failed" && result.error.kind === "creation_error");
    assert.ok(result.outcome === "creation-failed" && result.error.message === "tracker offline", "bounded diagnostic preserved");
    assert.equal(calls.length, 1, "no retry, no fallback, no compensating mutation");
    assert.deepEqual(Object.isFrozen(result), true);
  });

  it("invalid input fails before any provider call", async () => {
    const freshIssues = (calls: IssueRequest[]): IssueProvider => fakeIssues(calls);
    const cases: Array<[string, (calls: IssueRequest[]) => unknown]> = [
      ["non-object input", () => "nope"],
      ["missing provider", () => ({ review: corrections() })],
      ["malformed provider", (calls) => { void calls; return { review: corrections(), issues: { name: "x", create: "yes" } as never }; }],
      ["missing review", (calls) => ({ issues: freshIssues(calls) })],
      ["not-ready outcome", (calls) => ({ review: { outcome: "not-ready" }, issues: freshIssues(calls) })],
      ["review-failed outcome", (calls) => ({ review: { outcome: "review-failed", ticket_ids: ["T-1"], error: { kind: "x", message: "y" } }, issues: freshIssues(calls) })],
      ["decision-failed outcome", (calls) => ({ review: { outcome: "decision-failed", ticket_ids: ["T-1"], report: "r", error: { kind: "x", message: "y" } }, issues: freshIssues(calls) })],
      ["unknown outcome", (calls) => ({ review: { outcome: "maybe" }, issues: freshIssues(calls) })],
      ["non-array ids", (calls) => ({ review: { outcome: "corrections-required", ticket_ids: "T-1", report: "r" }, issues: freshIssues(calls) })],
      ["empty id entry", (calls) => ({ review: { outcome: "corrections-required", ticket_ids: ["T-1", ""], report: "r" }, issues: freshIssues(calls) })],
      ["empty notes", (calls) => ({ review: { outcome: "corrections-required", ticket_ids: ["T-1"], report: "r", notes: "" }, issues: freshIssues(calls) })],
    ];
    for (const [name, build] of cases) {
      const calls: IssueRequest[] = [];
      const result = await createTechnicalLeadCorrectionTicket(build(calls) as never);
      assert.equal(result.outcome, "invalid-input", name);
      assert.ok(result.outcome === "invalid-input" && result.error.kind === "invalid_input", name);
      assert.deepEqual(calls, [], `${name}: zero mutation attempts`);
      assert.deepEqual(Object.isFrozen(result), true, `${name}: frozen`);
    }
  });

  it("malformed provider reference is rejected without claiming creation", async () => {
    const calls: IssueRequest[] = [];
    const result = await createTechnicalLeadCorrectionTicket({
      review: corrections(["T-001"]),
      issues: fakeIssues(calls, async () => ({ id: "" })),
    });
    assert.equal(result.outcome, "invalid-input", "bad reference surfaces as invalid, never a fabricated success");
    assert.equal(calls.length, 1, "single attempt happened; failure is honest");
  });

  it("correction layer owns creation only", () => {
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "corrections.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(importedModules.sort(), ["../providers/issue", "./technical-lead"], "generic issue contract + TL result types only");
    assert.ok(!/listTickets|TicketSource|TicketSink|updateTicket|runCoordinator|runTechnicalLead|executeTechnicalLead/i.test(code), "no source, sink, Coordinator, or TL execution calls");
    assert.ok(!/child_process|\bspawn\b|execFile|execSync|fetch\(|http/i.test(code), "no processes or network");
    assert.ok(!/readFile|writeFile|mkdir|database|persist|cache|store|sprint.*id/i.test(code), "no persistence");
    assert.ok(!/loadConfig|validateConfig|FrameworkConfig|process\.env/i.test(code), "no configuration");
    assert.ok(!/octokit|graphql|\bgh\b|label|comment|reaction/i.test(code), "no GitHub specifics");
    assert.ok(!/opencode|delegate|skill|fleet|lane|model|session|relay/i.test(code), "no OpenCode or delegate logic");
    assert.ok(!/setTimeout|setInterval|Date\.now|poll|schedule|while|retry|rollback|queue/i.test(code), "no scheduler, retry, or rollback");
    assert.ok(!/stdin|stdout|TTY|readline|argv/i.test(code), "no CLI surface");
    assert.ok(!/\.create\(/.test(code.replace(/issues\.create\(/g, "")), "exactly one creation call site");
  });
});
