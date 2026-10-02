import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentProvider } from "../src/providers/agent";
import { ExecutionResult } from "../src/providers/result";
import { CoordinatorTicket, runCoordinatorTicket } from "../src/runtime/coordinator";
import {
  ReviewDecisionRequest,
  ReviewDecisionResolution,
  isReviewDecisionResolver,
  validateReviewDecisionResolution,
} from "../src/runtime/review-decision";
import { createProductionCoordinatorDeps } from "../src/runtime/production";

// Explicit Senior Reviewer decision boundary tests (M18 R-013):
// the resolver runs once after Reviewer execution with the
// opaque report, and only its validated resolution selects the
// outgoing edge. No parsing, no inference, no auto-approval.

interface Counts {
  implementer: number;
  reviewer: number;
  decisions: number;
}

function fakeProvider(counts: Counts, side: "implementer" | "reviewer", text = "Done; gates pass."): AgentProvider<ExecutionResult> {
  return {
    name: `fake-${side}`,
    execute: async () => {
      counts[side] += 1;
      return { status: "succeeded", text };
    },
  };
}

function ticket(id: string, state: CoordinatorTicket["state"] = "ready"): CoordinatorTicket {
  return { id, title: `Work ${id}`, description: `Description for ${id}.`, requirements: `Requirements for ${id}.`, state };
}

async function run(
  tickets: CoordinatorTicket[],
  counts: Counts,
  decideReview: (request: ReviewDecisionRequest) => ReviewDecisionResolution | Promise<ReviewDecisionResolution>,
  seen: ReviewDecisionRequest[] = [],
) {
  const deps = createProductionCoordinatorDeps({
    specialty: "backend",
    implementerProvider: fakeProvider(counts, "implementer"),
    reviewerProvider: fakeProvider(counts, "reviewer", "Reviewer notes: solid."),
  });
  return runCoordinatorTicket({
    tickets,
    roles: deps.roles,
    project_root: "/proj",
    timeout_ms: 5000,
    decideReview: async (request) => {
      counts.decisions += 1;
      seen.push(request);
      return decideReview(request);
    },
  });
}

describe("review decision boundary", () => {
  it("approved resolution reaches technical_approval after the reviewer", async () => {
    const counts: Counts = { implementer: 0, reviewer: 0, decisions: 0 };
    const seen: ReviewDecisionRequest[] = [];
    const tickets = [ticket("T-001")];
    const result = await run(tickets, counts, () => ({ decision: "approved" }), seen);
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.final_state === "technical_approval");
    assert.deepEqual(counts, { implementer: 1, reviewer: 1, decisions: 1 }, "one of each, reviewer before decision");
    assert.deepEqual(seen.length, 1);
    assert.equal(seen[0].ticket_id, "T-001");
    assert.equal(seen[0].report, "Reviewer notes: solid.", "resolver receives the opaque report");
    assert.equal(seen[0].title, "Work T-001");
  });

  it("changes_requested resolution reaches changes_requested with verbatim feedback", async () => {
    const counts: Counts = { implementer: 0, reviewer: 0, decisions: 0 };
    const tickets = [ticket("T-001")];
    const result = await run(tickets, counts, () => ({ decision: "changes_requested", feedback: "Tighten the  edge.\nSecond line." }));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.final_state === "changes_requested");
    assert.ok(result.outcome === "completed" && result.feedback === "Tighten the  edge.\nSecond line.", "verbatim, whitespace intact");
    assert.equal(tickets[0].state, "changes_requested");
    assert.deepEqual(counts, { implementer: 1, reviewer: 1, decisions: 1 });
  });

  it("missing decision never becomes approved", async () => {
    for (const resolution of [undefined, null, {}, { decision: "eventually" }, { decision: "approved", feedback: "extra" }] as never[]) {
      const counts: Counts = { implementer: 0, reviewer: 0, decisions: 0 };
      const tickets = [ticket("T-001")];
      const result = await run(tickets, counts, () => resolution);
      assert.equal(result.outcome, "decision-failed", JSON.stringify(resolution));
      assert.ok(result.outcome === "decision-failed" && result.final_state === "implementation_review");
      assert.ok(result.outcome === "decision-failed" && result.error.kind === "invalid_decision");
      assert.equal(tickets[0].state, "implementation_review", "no transition recorded");
      assert.deepEqual(counts, { implementer: 1, reviewer: 1, decisions: 1 }, "single attempt each, no retry");
    }
  });

  it("reviewer failure skips the resolver entirely", async () => {
    const counts: Counts = { implementer: 0, reviewer: 0, decisions: 0 };
    const failingReviewer: AgentProvider<ExecutionResult> = {
      name: "fake-reviewer",
      execute: async () => {
        counts.reviewer += 1;
        throw new Error("opencode provider: process error");
      },
    };
    const deps = createProductionCoordinatorDeps({
      specialty: "backend",
      implementerProvider: fakeProvider(counts, "implementer"),
      reviewerProvider: failingReviewer,
    });
    const tickets = [ticket("T-001")];
    const result = await runCoordinatorTicket({
      tickets,
      roles: deps.roles,
      project_root: "/proj",
      timeout_ms: 5000,
      decideReview: async () => {
        counts.decisions += 1;
        return { decision: "approved" };
      },
    });
    assert.equal(result.outcome, "reviewer-failed");
    assert.equal(counts.decisions, 0, "resolver never invoked");
    assert.equal(tickets[0].state, "implementation_review");
  });

  it("resolver failure preserves implementation_review without retry", async () => {
    const counts: Counts = { implementer: 0, reviewer: 0, decisions: 0 };
    const tickets = [ticket("T-001")];
    const result = await run(tickets, counts, () => Promise.reject(new Error("operator hung up")));
    assert.equal(result.outcome, "decision-failed");
    assert.ok(result.outcome === "decision-failed" && result.final_state === "implementation_review");
    assert.ok(result.outcome === "decision-failed" && result.error.kind === "decision_error");
    assert.ok(result.outcome === "decision-failed" && result.error.message === "operator hung up");
    assert.equal(tickets[0].state, "implementation_review");
    assert.deepEqual(counts, { implementer: 1, reviewer: 1, decisions: 1 }, "nothing rerun");
    assert.deepEqual(Object.isFrozen(result), true, "bounded result frozen like other outcomes");
  });

  it("rework selected by the Coordinator still flows through the resolver", async () => {
    const counts: Counts = { implementer: 0, reviewer: 0, decisions: 0 };
    const seen: ReviewDecisionRequest[] = [];
    const tickets = [ticket("T-001"), { ...ticket("T-002"), state: "changes_requested" as const, feedback: "Earlier notes." }];
    const result = await run(tickets, counts, () => ({ decision: "approved" }), seen);
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.ticket_id === "T-002", "rework priority unchanged");
    assert.equal(seen[0].ticket_id, "T-002");
    assert.equal(tickets[0].state, "ready", "one-ticket guarantee intact");
  });

  it("resolver validation is structural and report-blind", () => {
    assert.ok(isReviewDecisionResolver(async () => ({ decision: "approved" })));
    assert.ok(!isReviewDecisionResolver("approved"), "a bare verdict is not a resolver");
    assert.ok(!isReviewDecisionResolver(null));
    assert.deepEqual(validateReviewDecisionResolution({ decision: "approved" }, "T-1"), { decision: "approved" });
    assert.deepEqual(
      validateReviewDecisionResolution({ decision: "changes_requested", feedback: "x" }, "T-1"),
      { decision: "changes_requested", feedback: "x" },
    );
    assert.throws(() => validateReviewDecisionResolution({ decision: "changes_requested", feedback: "" }, "T-1"), /non-empty feedback/);
    assert.throws(() => validateReviewDecisionResolution({ decision: "approved", feedback: "x" }, "T-1"), /no feedback/);
    assert.throws(() => validateReviewDecisionResolution({ decision: "maybe" }, "T-1"), /unknown verdict/);
  });

  it("decision seam owns review context only", () => {
    const seamCode = readFileSync(join(__dirname, "..", "..", "src", "runtime", "review-decision.ts"), "utf8");
    const code = seamCode.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(importedModules, ["./coordinator"], "verdict type reuse only");
    assert.ok(!/LGTM|\bscore\b|confidence|rating|sentiment|classif|RegExp|\.match\(|\.search\(|indexOf|includes\(|startsWith/i.test(code), "no report interpretation machinery");
    assert.ok(!/github|opencode|delegate|relay|shell|exec|filesystem|readFile|loadConfig|process\.env/i.test(code), "no provider, platform, or config seams");
    assert.ok(!/token|credential|secret|session|model/i.test(code), "context carries no secrets");
    assert.ok(!/setTimeout|setInterval|retry|backoff|while|schedule/i.test(code), "no retry machinery");
    const coordinatorCode = readFileSync(join(__dirname, "..", "..", "src", "runtime", "coordinator.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/reviewDecision|reviewFeedback/.test(coordinatorCode), "static verdict inputs fully removed");
    assert.ok(!/\.includes\(|\.match\(|\.test\(|indexOf/i.test(coordinatorCode), "no text matching anywhere in orchestration");
  });
});
