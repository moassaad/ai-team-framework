import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CoordinatorTicket } from "../src/runtime/coordinator";
import { WorkflowState } from "../src/workflow/states";
import { evaluateSprintCompletion } from "../src/runtime/sprint";

// Sprint completion evaluation tests (M18 R-016): pure,
// read-only classification of ticket states. No providers,
// source, configuration, network, time, or mutation anywhere.

function ticket(id: string, state: WorkflowState, feedback?: string): CoordinatorTicket {
  return {
    id,
    title: `Work ${id}`,
    description: `Description for ${id}.`,
    requirements: `Requirements for ${id}.`,
    state,
    ...(feedback !== undefined ? { feedback } : {}),
  };
}

describe("sprint completion", () => {
  it("terminal-only collections are ready for Technical Lead review", async () => {
    for (const states of [
      ["closed", "cancelled"],
      ["closed"],
      ["cancelled", "cancelled"],
    ] as WorkflowState[][]) {
      const tickets = states.map((state, index) => ticket(`T-00${String(index + 1)}`, state));
      const result = evaluateSprintCompletion(tickets);
      assert.equal(result.readyForTechnicalLeadReview, true, states.join(","));
      assert.deepEqual(result.counts.complete, states.length);
      assert.deepEqual(result.workRemaining, []);
      assert.deepEqual(result.attentionNeeded, []);
    }
  });

  it("technical-approval and pm_review collections are ready without calling later stages", async () => {
    const tickets = [ticket("T-001", "technical_approval"), ticket("T-002", "pm_review"), ticket("T-003", "technical_approval")];
    const before = JSON.stringify(tickets);
    const result = evaluateSprintCompletion(tickets);
    assert.equal(result.readyForTechnicalLeadReview, true);
    assert.deepEqual(result.counts, {
      total: 3, executable: 0, inFlight: 0, blocked: 0, failed: 0, invalid: 0, complete: 3,
    });
    assert.equal(JSON.stringify(tickets), before, "states untouched, nothing moved toward pm_review");
    assert.deepEqual(result.workRemaining, []);
  });

  it("executable and in-flight work blocks readiness", async () => {
    const cases: Array<[WorkflowState, string | undefined]> = [
      ["ready", undefined],
      ["changes_requested", "Fix it."],
      ["in_progress", undefined],
      ["implementation_review", undefined],
    ];
    for (const [state, feedback] of cases) {
      const tickets = [ticket("T-001", "technical_approval"), ticket("T-002", state, feedback)];
      const result = evaluateSprintCompletion(tickets);
      assert.equal(result.readyForTechnicalLeadReview, false, state);
      assert.deepEqual(result.workRemaining, ["T-002"], `${state}: identified in caller order`);
      assert.equal(result.counts.complete, 1);
    }
    const active = evaluateSprintCompletion([ticket("T-001", "in_progress"), ticket("T-002", "ready")]);
    assert.equal(active.readyForTechnicalLeadReview, false);
    assert.deepEqual(active.counts.inFlight, 1);
    assert.deepEqual(active.counts.executable, 1);
    assert.deepEqual(active.workRemaining, ["T-001", "T-002"], "caller order preserved, no sorting");
  });

  it("changes_requested without feedback is invalid, never completed or executable", async () => {
    const tickets = [ticket("T-001", "technical_approval"), ticket("T-002", "changes_requested")];
    const before = JSON.stringify(tickets);
    const result = evaluateSprintCompletion(tickets);
    assert.equal(result.readyForTechnicalLeadReview, false);
    assert.deepEqual(result.counts.invalid, 1);
    assert.deepEqual(result.counts.executable, 0, "unactionable work is not executable");
    assert.deepEqual(result.workRemaining, [], "never offered for execution");
    assert.deepEqual(result.attentionNeeded, ["T-002"], "distinguished from actionable work");
    assert.equal(JSON.stringify(tickets), before, "no feedback fabricated, nothing executed");
  });

  it("blocked, waiting, and failed tickets are reported without blocking silently", async () => {
    const tickets = [
      ticket("T-001", "technical_approval"),
      ticket("T-002", "blocked"),
      ticket("T-003", "needs_user_input"),
      ticket("T-004", "failed"),
    ];
    const result = evaluateSprintCompletion(tickets);
    assert.equal(result.readyForTechnicalLeadReview, false);
    assert.deepEqual(result.counts.blocked, 2);
    assert.deepEqual(result.counts.failed, 1);
    assert.deepEqual(result.attentionNeeded, ["T-002", "T-003", "T-004"], "caller order, no sorting");
    assert.deepEqual(result.workRemaining, [], "waiting work is not executable");
    assert.ok(tickets.every((entry) => ["technical_approval", "blocked", "needs_user_input", "failed"].includes(entry.state)), "nothing reopened, retried, or closed");
  });

  it("empty collection is deterministically ready with zero counts", async () => {
    const first = evaluateSprintCompletion([]);
    const second = evaluateSprintCompletion([]);
    assert.deepEqual(first, second, "deterministic");
    assert.equal(first.readyForTechnicalLeadReview, true, "vacuously: no work of any kind remains");
    assert.deepEqual(first.counts, {
      total: 0, executable: 0, inFlight: 0, blocked: 0, failed: 0, invalid: 0, complete: 0,
    });
    assert.deepEqual(Object.isFrozen(first), true, "frozen result");
  });

  it("malformed input is rejected before evaluation", async () => {
    assert.throws(() => evaluateSprintCompletion("nope" as never), /tickets must be an array/);
    assert.throws(
      () => evaluateSprintCompletion([{ id: "T-1", title: "t", description: "d", requirements: "r", state: "done" }] as never),
      /id, title, description, requirements, and a valid state/,
    );
    assert.throws(
      () => evaluateSprintCompletion([{ id: "", title: "t", description: "d", requirements: "r", state: "ready" }] as never),
      /id, title, description, requirements, and a valid state/,
    );
  });

  it("mixed collections produce exact counts and diagnostics", async () => {
    const tickets = [
      ticket("T-001", "technical_approval"),
      ticket("T-002", "ready"),
      ticket("T-003", "changes_requested", "Rework notes."),
      ticket("T-004", "changes_requested"),
      ticket("T-005", "in_progress"),
      ticket("T-006", "blocked"),
      ticket("T-007", "failed"),
      ticket("T-008", "closed"),
    ];
    const before = JSON.stringify(tickets);
    const result = evaluateSprintCompletion(tickets);
    assert.equal(result.readyForTechnicalLeadReview, false);
    assert.deepEqual(result.counts, {
      total: 8, executable: 2, inFlight: 1, blocked: 1, failed: 1, invalid: 1, complete: 2,
    });
    assert.deepEqual(result.workRemaining, ["T-002", "T-003", "T-005"]);
    assert.deepEqual(result.attentionNeeded, ["T-004", "T-006", "T-007"]);
    assert.equal(JSON.stringify(tickets), before, "input objects unchanged");
    assert.deepEqual(evaluateSprintCompletion(tickets), result, "deterministic repeats");
  });

  it("evaluator is a pure state read with no outside seams", () => {
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "sprint.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(importedModules, ["./coordinator"], "ticket shape and guard reuse only");
    assert.ok(!/listTickets|TicketSource|TicketSink|updateTicket|runCoordinatorTicket/i.test(code), "no source, sink, or Coordinator calls");
    assert.ok(!/child_process|\bspawn\b|execFile|fetch\(|http/i.test(code), "no processes or network");
    assert.ok(!/readFile|writeFile|mkdir|database|persist|cache|store/i.test(code), "no persistence");
    assert.ok(!/loadConfig|validateConfig|FrameworkConfig|process\.env/i.test(code), "no configuration");
    assert.ok(!/delegate|skill|fleet|lane|model|session|relay|opencode/i.test(code), "no delegate or provider logic");
    assert.ok(!/setTimeout|setInterval|Date\.now|poll|schedule|while/i.test(code), "no scheduler or time");
    assert.ok(!/\.state\s*=(?![=>])/i.test(code), "no ticket mutation");
    const states = readFileSync(join(__dirname, "..", "..", "src", "workflow", "states.ts"), "utf8");
    assert.ok(!/sprint/i.test(states), "no sprint workflow states introduced");
  });
});
