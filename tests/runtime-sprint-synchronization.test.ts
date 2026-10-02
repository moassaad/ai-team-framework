import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CoordinatorTicket } from "../src/runtime/coordinator";
import { TicketSink } from "../src/runtime/ticket-sink";
import { SprintWorkflowResult } from "../src/runtime/sprint-workflow";
import {
  SprintSynchronizationResult,
  sprintReentryStatus,
  synchronizeSprintOutcome,
} from "../src/runtime/sprint-synchronization";

// Sprint synchronization and re-entry tests (M19 E2E-002):
// explicit close-on-approval through a fake sink plus a pure
// re-entry classifier. No config, network, filesystem,
// GitHub, providers, scheduler, or parallelism anywhere.

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

function completed(ids: readonly string[] = ["T-001"]): SprintWorkflowResult {
  return {
    outcome: "completed",
    ticket_ids: ids,
    finalApproval: { outcome: "approved", ticket_ids: ids, pmReport: "PM: matches." },
  };
}

function recordingSink(written: CoordinatorTicket[], failAt?: number): TicketSink {
  let calls = 0;
  return {
    updateTicket: async (entry) => {
      calls += 1;
      if (failAt !== undefined && calls >= failAt) {
        throw new Error("sink offline");
      }
      written.push(entry);
    },
  };
}

describe("sprint synchronization", () => {
  it("final approval closes eligible tickets as frozen copies in order", async () => {
    const written: CoordinatorTicket[] = [];
    const tickets = [ticket("T-001"), ticket("T-002", "pm_review"), ticket("T-003", "closed"), ticket("T-004", "ready")];
    const before = JSON.stringify(tickets);
    const result = await synchronizeSprintOutcome({
      tickets,
      workflow: completed(["T-001", "T-002", "T-003", "T-004"]),
      ticketSink: recordingSink(written),
    });
    assert.equal(result.outcome, "synchronized");
    assert.deepEqual(result.outcome === "synchronized" ? [...result.synchronizedIds] : [], ["T-001", "T-002"], "order preserved, terminal and incomplete excluded");
    assert.equal(written.length, 2, "exactly one sink call per eligible ticket");
    assert.deepEqual(written.map((entry) => [entry.id, entry.state]), [["T-001", "closed"], ["T-002", "closed"]]);
    assert.deepEqual(
      written.map(({ state, ...rest }) => rest),
      tickets.slice(0, 2).map(({ state, ...rest }) => rest),
      "all other ticket data preserved byte-for-byte",
    );
    assert.ok(written.every((entry) => Object.isFrozen(entry)), "immutable copies");
    assert.equal(JSON.stringify(tickets), before, "original objects unchanged");
    assert.deepEqual(Object.isFrozen(result), true, "frozen result");
  });

  it("non-final outcomes and invalid inputs mean zero sink calls", async () => {
    const outcomes: Array<SprintWorkflowResult> = [
      { outcome: "work-remaining", evaluation: { readyForTechnicalLeadReview: false, counts: { total: 1, executable: 1, inFlight: 0, blocked: 0, failed: 0, invalid: 0, complete: 0 }, workRemaining: ["T-1"], attentionNeeded: [] } },
      { outcome: "failed", coordinator: { outcome: "implementer-failed", ticket_id: "T-1", final_state: "failed", transitions: [], error: { kind: "x", message: "y" } } },
      { outcome: "technical-lead-not-ready", technicalLead: { outcome: "not-ready", evaluation: { readyForTechnicalLeadReview: false, counts: { total: 0, executable: 0, inFlight: 0, blocked: 0, failed: 0, invalid: 0, complete: 0 }, workRemaining: [], attentionNeeded: [] } } },
      { outcome: "pm-changes-required", pmReview: { outcome: "changes-required", ticket_ids: ["T-1"], report: "r", notes: "n" } },
      { outcome: "final-approval-rejected", finalApproval: { outcome: "changes-required", ticket_ids: ["T-1"], pmReport: "r" } },
    ];
    for (const workflow of outcomes) {
      const written: CoordinatorTicket[] = [];
      const result = await synchronizeSprintOutcome({
        tickets: [ticket("T-001")],
        workflow,
        ticketSink: recordingSink(written),
      });
      assert.equal(result.outcome, "sync-not-ready", workflow.outcome);
      assert.deepEqual(written, [], `${workflow.outcome}: zero sink calls`);
    }
    const emptyWritten: CoordinatorTicket[] = [];
    const empty = await synchronizeSprintOutcome({ tickets: [], workflow: completed([]), ticketSink: recordingSink(emptyWritten) });
    assert.equal(empty.outcome, "synchronized", "empty approved sprint stays successful");
    assert.deepEqual(emptyWritten, [], "no synthetic ticket created");
    await assert.rejects(synchronizeSprintOutcome("nope" as never), /expected a synchronization input object/);
    await assert.rejects(
      synchronizeSprintOutcome({ tickets: [ticket("T-001")], workflow: completed(), ticketSink: { name: "x" } as never }),
      /must satisfy the ticket sink contract/,
    );
  });

  it("sink failure stops with partial success observable and no retry", async () => {
    const written: CoordinatorTicket[] = [];
    const tickets = [ticket("T-001"), ticket("T-002"), ticket("T-003")];
    const before = JSON.stringify(tickets);
    const result = await synchronizeSprintOutcome({
      tickets,
      workflow: completed(["T-001", "T-002", "T-003"]),
      ticketSink: recordingSink(written, 2),
    });
    assert.equal(result.outcome, "sync-failed");
    assert.ok(result.outcome === "sync-failed" && result.error.kind === "ticket-synchronization-failed");
    assert.ok(result.outcome === "sync-failed" && result.error.message === "sink offline", "bounded diagnostic preserved");
    assert.deepEqual(result.outcome === "sync-failed" ? [...result.synchronizedIds] : [], ["T-001"], "prior success observable, later tickets unattempted");
    assert.equal(written.length, 1, "stopped at first failure, no retry, no rollback");
    assert.equal(JSON.stringify(tickets), before, "originals untouched, no compensation");
    assert.deepEqual(sprintReentryStatus(result), "synchronization-failed", "never terminal success");
  });

  it("duplicate ids close once and incomplete states never close", async () => {
    const written: CoordinatorTicket[] = [];
    const tickets = [
      ticket("T-001"),
      { ...ticket("T-001"), title: "Same id again" },
      ticket("T-002", "in_progress"),
      ticket("T-003", "implementation_review"),
      ticket("T-004", "blocked"),
      ticket("T-005", "needs_user_input"),
      ticket("T-006", "failed"),
      ticket("T-007", "changes_requested", "notes"),
      ticket("T-008", "cancelled"),
    ];
    const result = await synchronizeSprintOutcome({ tickets, workflow: completed(), ticketSink: recordingSink(written) });
    assert.equal(result.outcome, "synchronized");
    assert.deepEqual(result.outcome === "synchronized" ? [...result.synchronizedIds] : [], ["T-001"], "one call per id, nothing incomplete forced shut");
    assert.equal(written.length, 1);
  });
});

describe("sprint re-entry policy", () => {
  it("classifies every workflow outcome deterministically", async () => {
    const table: Array<[SprintWorkflowResult, string]> = [
      [completed(), "terminal"],
      [{ outcome: "work-remaining", evaluation: { readyForTechnicalLeadReview: false, counts: { total: 1, executable: 1, inFlight: 0, blocked: 0, failed: 0, invalid: 0, complete: 0 }, workRemaining: ["T-1"], attentionNeeded: [] } }, "reenterable"],
      [{ outcome: "failed", coordinator: { outcome: "decision-failed", ticket_id: "T-1", final_state: "implementation_review", transitions: [], error: { kind: "x", message: "y" } } }, "attention-required"],
      [{ outcome: "technical-lead-not-ready", technicalLead: { outcome: "not-ready", evaluation: { readyForTechnicalLeadReview: false, counts: { total: 0, executable: 0, inFlight: 0, blocked: 0, failed: 0, invalid: 0, complete: 0 }, workRemaining: [], attentionNeeded: [] } } }, "attention-required"],
      [{ outcome: "technical-lead-corrections-required", correction: { outcome: "created", reference: { id: "C-1" } } }, "reenterable"],
      [{ outcome: "correction-creation-failed", correction: { outcome: "creation-failed", error: { kind: "x", message: "y" } } }, "attention-required"],
      [{ outcome: "pm-not-ready", pmReview: { outcome: "review-failed", ticket_ids: ["T-1"], error: { kind: "x", message: "y" } } }, "attention-required"],
      [{ outcome: "pm-changes-required", pmReview: { outcome: "changes-required", ticket_ids: ["T-1"], report: "r" } }, "attention-required"],
      [{ outcome: "final-approval-not-ready", finalApproval: { outcome: "not-ready", pmOutcome: "x" } }, "attention-required"],
      [{ outcome: "final-approval-rejected", finalApproval: { outcome: "changes-required", ticket_ids: ["T-1"], pmReport: "r" } }, "attention-required"],
    ];
    for (const [result, expected] of table) {
      assert.equal(sprintReentryStatus(result), expected, result.outcome);
      assert.equal(sprintReentryStatus(result), sprintReentryStatus(JSON.parse(JSON.stringify(result))), `${result.outcome}: deterministic`);
    }
    assert.equal(sprintReentryStatus({ outcome: "synchronized", synchronizedIds: ["T-1"] }), "terminal");
    assert.equal(sprintReentryStatus({ outcome: "sync-not-ready", reason: "x" }), "attention-required");
    assert.throws(() => sprintReentryStatus({ outcome: "maybe" } as never), /unknown result outcome/);
    assert.throws(() => sprintReentryStatus("nope" as never), /expected a workflow or synchronization result object/);
  });

  it("correction references never become implicit tickets", async () => {
    const written: CoordinatorTicket[] = [];
    const tickets = [ticket("T-001")];
    const workflow: SprintWorkflowResult = {
      outcome: "technical-lead-corrections-required",
      correction: { outcome: "created", reference: { id: "C-1" } },
    };
    assert.equal(sprintReentryStatus(workflow), "reenterable", "later explicit invocation, never automatic");
    const sync = await synchronizeSprintOutcome({ tickets, workflow, ticketSink: recordingSink(written) });
    assert.equal(sync.outcome, "sync-not-ready", "no sink path for corrections");
    assert.deepEqual(written, [], "reference stays a reference");
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "sprint-synchronization.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/toCoordinatorTicket|fromReference|asTicket|IssueReference/i.test(source), "no hidden reference-to-ticket adapter");
  });

  it("synchronization owns persistence only", () => {
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "sprint-synchronization.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(importedModules.sort(), ["./coordinator", "./sprint-workflow", "./ticket-sink"], "ticket guard + workflow result + sink only");
    assert.ok(!/runSprintWorkflow|runCoordinatorTicket|evaluateSprintCompletion|createTechnicalLeadCorrectionTicket|runTechnicalLeadReview|runPmUserTestingReview|runFinalApproval/i.test(code), "no workflow invocation or recursion");
    assert.ok(!/\.create\(/.test(code), "no IssueProvider creation calls");
    assert.ok(!/TicketSource|listTickets|runCoordinator|runTechnicalLead|runPmUserTesting|runFinalApproval/i.test(code), "no source, Coordinator, or stage calls");
    assert.ok(!/child_process|\bspawn\b|execFile|execSync|fetch\(|http/i.test(code), "no processes or network");
    assert.ok(!/readFile|writeFile|mkdir|database|persist|cache|store/i.test(code.replace(/synchronizedIds|synchronizeSprintOutcome|sprintReentryStatus|sprint synchronization/gi, "")), "no persistence beyond the sink");
    assert.ok(!/loadConfig|validateConfig|FrameworkConfig|process\.env/i.test(code), "no configuration");
    assert.ok(!/octokit|graphql|\bgh\b|openCode|opencode|delegate|skill|fleet|lane|model|session|relay/i.test(code), "no provider specifics");
    assert.ok(!/setTimeout|setInterval|Date\.now|poll|schedule|queue|retry|rollback|drain/i.test(code.replace(/synchronizedIds|synchronizeSprintOutcome|sprintReentryStatus|sprint synchronization/gi, "")), "no scheduler, retry, rollback, or drain");
    assert.ok(!/stdin|stdout|TTY|readline|argv/i.test(code), "no CLI surface");
    assert.ok(!/isValidTransition|to_state|from_state|advance\(/i.test(code), "no transition machinery");
    assert.deepEqual((code.match(/"closed"/g) ?? []).length, 1, "exactly one closed literal: the defensive copy");
    assert.ok((code.match(/await input\.ticketSink\.updateTicket\(/g) ?? []).length === 1, "exactly one sink call site, sequential by construction");
    assert.ok(!/Promise\.all|Promise\.race/i.test(code), "no parallel execution");
    assert.ok(!/coordinator.*select|selection.*algorithm|find\(.*ready|find\(.*rework/i.test(code), "R-001/R-002 selection untouched");
  });
});
