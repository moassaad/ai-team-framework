import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentProvider } from "../src/providers/agent";
import { runProductionCoordinatorFromSource } from "../src/runtime/application";
import { CoordinatorTicket } from "../src/runtime/coordinator";
import { TicketSource } from "../src/runtime/ticket-source";
import { TicketSink, isTicketSink } from "../src/runtime/ticket-sink";

// Ticket sink boundary tests (M18 R-008): optional write-only
// sink after source → Coordinator composition. All sources,
// sinks, and agents are hermetic fakes; no tracker, network,
// filesystem, Git, configuration, delegate, retry, or
// persistence implementation anywhere.

interface CallLog {
  prompts: string[];
}

interface SinkLog {
  writes: CoordinatorTicket[];
}

function fakeStringAgent(log: CallLog, behavior?: () => Promise<string>): AgentProvider<string> {
  return {
    name: "fake-opencode",
    execute: async (invocation) => {
      log.prompts.push(invocation.prompt);
      return behavior === undefined ? "Shipped; gates pass." : behavior();
    },
  };
}

function ticket(id: string, state: CoordinatorTicket["state"], feedback?: string): CoordinatorTicket {
  return {
    id,
    title: `Work ${id}`,
    description: `Description for ${id}.`,
    requirements: `Requirements for ${id}.`,
    state,
    ...(feedback !== undefined ? { feedback } : {}),
  };
}

function sourceOf(tickets: CoordinatorTicket[], counts: { reads: number }): TicketSource {
  return {
    listTickets: async () => {
      counts.reads += 1;
      return tickets;
    },
  };
}

function recordingSink(log: SinkLog, behavior?: (ticket: CoordinatorTicket) => Promise<void>): TicketSink {
  return {
    updateTicket: async (entry) => {
      log.writes.push(entry);
      if (behavior !== undefined) {
        await behavior(entry);
      }
    },
  };
}

function baseInput(overrides: {
  tickets: CoordinatorTicket[];
  sink?: TicketSink;
  reads?: { reads: number };
  log?: CallLog;
  agentBehavior?: () => Promise<string>;
  reviewDecision?: "approved" | "changes_requested";
  reviewFeedback?: string;
}): Parameters<typeof runProductionCoordinatorFromSource>[0] {
  const reads = overrides.reads ?? { reads: 0 };
  return {
    ticketSource: sourceOf(overrides.tickets, reads),
    ...(overrides.sink !== undefined ? { ticketSink: overrides.sink } : {}),
    specialty: "backend",
    openCodeAgent: fakeStringAgent(overrides.log ?? { prompts: [] }, overrides.agentBehavior),
    project_root: "/proj",
    timeout_ms: 5000,
    reviewDecision: overrides.reviewDecision ?? "approved",
    ...(overrides.reviewFeedback !== undefined ? { reviewFeedback: overrides.reviewFeedback } : {}),
  };
}

describe("ticket sink boundary", () => {
  it("accepts a valid sink and composes source → Coordinator → sink", async () => {
    const sinkLog: SinkLog = { writes: [] };
    const tickets = [ticket("T-001", "ready")];
    const result = await runProductionCoordinatorFromSource(
      baseInput({ tickets, sink: recordingSink(sinkLog) }),
    );
    assert.ok(isTicketSink(recordingSink({ writes: [] })), "sink satisfies the contract");
    assert.equal(result.outcome, "completed");
    assert.deepEqual(sinkLog.writes.length, 1, "exactly one sink call");
    assert.ok(sinkLog.writes[0] === tickets[0], "same ticket object, never cloned or replaced");
    assert.equal(sinkLog.writes[0].id, "T-001", "source = selected = sink identity");
    assert.ok(
      result.outcome === "completed" && result.ticket_id === sinkLog.writes[0].id,
      "Coordinator result and sink agree on identity",
    );
    assert.equal(sinkLog.writes[0].state, "technical_approval", "final state, not reconstructed");
  });

  it("omitted sink preserves current in-memory behavior", async () => {
    const tickets = [ticket("T-001", "ready")];
    const result = await runProductionCoordinatorFromSource(baseInput({ tickets }));
    assert.equal(result.outcome, "completed");
    assert.equal(tickets[0].state, "technical_approval", "Coordinator still mutates in memory");
  });

  it("changes-requested path writes once with state and feedback intact", async () => {
    const sinkLog: SinkLog = { writes: [] };
    const tickets = [ticket("T-001", "ready")];
    const result = await runProductionCoordinatorFromSource(
      baseInput({
        tickets,
        sink: recordingSink(sinkLog),
        reviewDecision: "changes_requested",
        reviewFeedback: "Tighten the edge handling.",
      }),
    );
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.final_state === "changes_requested");
    assert.deepEqual(sinkLog.writes.length, 1);
    assert.equal(sinkLog.writes[0].state, "changes_requested");
    assert.equal(sinkLog.writes[0].feedback, undefined, "runtime writes no tracker feedback onto the ticket");
    assert.ok(result.outcome === "completed" && result.feedback === "Tighten the edge handling.");
  });

  it("failed Implementer path writes only when the ticket actually reached failed", async () => {
    const sinkLog: SinkLog = { writes: [] };
    const log: CallLog = { prompts: [] };
    const tickets = [ticket("T-001", "ready")];
    const result = await runProductionCoordinatorFromSource(
      baseInput({
        tickets,
        sink: recordingSink(sinkLog),
        log,
        agentBehavior: () => Promise.reject<string>(new Error("opencode provider: process error")),
      }),
    );
    assert.equal(result.outcome, "implementer-failed");
    assert.ok(result.outcome === "implementer-failed" && result.final_state === "failed");
    assert.deepEqual(sinkLog.writes.length, 1, "advanced to failed, so synchronized");
    assert.equal(sinkLog.writes[0].state, "failed");
    assert.deepEqual(log.prompts.length, 1, "no retry");
  });

  it("no-work and conflict perform zero sink calls", async () => {
    const emptyLog: SinkLog = { writes: [] };
    const empty = await runProductionCoordinatorFromSource(
      baseInput({ tickets: [], sink: recordingSink(emptyLog) }),
    );
    assert.equal(empty.outcome, "no-work");
    const conflictLog: SinkLog = { writes: [] };
    const conflict = await runProductionCoordinatorFromSource(
      baseInput({ tickets: [ticket("T-001", "in_progress")], sink: recordingSink(conflictLog) }),
    );
    assert.equal(conflict.outcome, "conflict");
    assert.deepEqual(emptyLog.writes, [], "no-work never touches the sink");
    assert.deepEqual(conflictLog.writes, [], "conflict never touches the sink");
  });

  it("Coordinator throw before a valid result performs zero sink calls and propagates", async () => {
    const sinkLog: SinkLog = { writes: [] };
    const log: CallLog = { prompts: [] };
    const reads = { reads: 0 };
    const tickets = [ticket("T-001", "ready")];
    const input = baseInput({ tickets, reads, log, sink: recordingSink(sinkLog) });
    await assert.rejects(
      runProductionCoordinatorFromSource({ ...input, reviewDecision: "maybe" as never }),
      /coordinator runtime: reviewDecision must be/,
    );
    assert.deepEqual(sinkLog.writes, [], "no partial synchronization");
    assert.deepEqual(log.prompts, [], "no provider invoked");
    assert.equal(reads.reads, 1, "source read stands alone; nothing retried");
    assert.equal(tickets[0].state, "ready", "in-memory state left as-is, no rollback invented");
  });

  it("sink failure returns a bounded sync failure without rerunning anything", async () => {
    const sinkLog: SinkLog = { writes: [] };
    const log: CallLog = { prompts: [] };
    const reads = { reads: 0 };
    const tickets = [ticket("T-001", "ready")];
    const result = await runProductionCoordinatorFromSource(
      baseInput({
        tickets,
        reads,
        log,
        sink: recordingSink(sinkLog, async () => {
          throw new Error("tracker offline");
        }),
      }),
    );
    assert.equal(result.outcome, "sync-failed");
    assert.ok(result.outcome === "sync-failed" && result.ticket_id === "T-001");
    assert.ok(result.outcome === "sync-failed" && result.coordinatorResult.outcome === "completed");
    assert.ok(
      result.outcome === "sync-failed" &&
        result.coordinatorResult.outcome === "completed" &&
        result.coordinatorResult.final_state === "technical_approval",
      "Coordinator result preserved: execution advanced, sync failed",
    );
    assert.ok(result.outcome === "sync-failed" && result.error.kind === "ticket-synchronization-failed");
    assert.ok(result.outcome === "sync-failed" && result.error.message === "tracker offline");
    assert.deepEqual(sinkLog.writes.length, 1, "sink not retried");
    assert.deepEqual(log.prompts.length, 2, "Coordinator not rerun");
    assert.equal(reads.reads, 1, "source not re-read");
    assert.equal(tickets[0].state, "technical_approval", "no rollback invented");
    assert.deepEqual(Object.isFrozen(result), true, "bounded result is frozen like Coordinator results");
  });

  it("writes only the selected ticket and leaves the rest untouched", async () => {
    const sinkLog: SinkLog = { writes: [] };
    const tickets = [
      ticket("T-001", "ready"),
      ticket("T-002", "changes_requested", "Finish me first."),
      ticket("T-003", "ready"),
    ];
    const result = await runProductionCoordinatorFromSource(
      baseInput({ tickets, sink: recordingSink(sinkLog) }),
    );
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.ticket_id === "T-002", "rework priority unchanged");
    assert.deepEqual(sinkLog.writes.length, 1, "never one call per source ticket");
    assert.equal(sinkLog.writes[0].id, "T-002");
    assert.equal(sinkLog.writes[0].feedback, "Finish me first.", "preserved feedback passes through verbatim");
    assert.equal(tickets[0].state, "ready");
    assert.equal(tickets[2].state, "ready");
  });

  it("invalid sink fails before Coordinator execution with zero side effects", async () => {
    const log: CallLog = { prompts: [] };
    const tickets = [ticket("T-001", "ready")];
    for (const bad of [{ name: "broken" }, { updateTicket: "write" }, null] as never[]) {
      await assert.rejects(
        runProductionCoordinatorFromSource(baseInput({ tickets, log, sink: bad })),
        /ticketSink must satisfy the ticket sink contract/,
      );
    }
    assert.deepEqual(log.prompts, [], "no provider invoked");
    assert.equal(tickets[0].state, "ready", "no ticket mutated");
  });

  it("source is still read exactly once and repeats stay stateless", async () => {
    const firstReads = { reads: 0 };
    const secondReads = { reads: 0 };
    const firstLog: SinkLog = { writes: [] };
    const secondLog: SinkLog = { writes: [] };
    const first = await runProductionCoordinatorFromSource(
      baseInput({ tickets: [ticket("T-001", "ready")], reads: firstReads, sink: recordingSink(firstLog) }),
    );
    const second = await runProductionCoordinatorFromSource(
      baseInput({ tickets: [ticket("T-002", "ready")], reads: secondReads, sink: recordingSink(secondLog) }),
    );
    assert.deepEqual(first.outcome, second.outcome);
    assert.deepEqual(firstReads.reads, 1);
    assert.deepEqual(secondReads.reads, 1);
    assert.deepEqual(firstLog.writes.length, 1);
    assert.deepEqual(secondLog.writes.length, 1);
    assert.equal(secondLog.writes[0].id, "T-002", "no caching between invocations");
  });

  it("sink boundary owns persistence only: no workflow, tracker, or machinery seams", () => {
    const sinkCode = readFileSync(join(__dirname, "..", "..", "src", "runtime", "ticket-sink.ts"), "utf8");
    const code = sinkCode.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(importedModules, ["./coordinator"], "only the existing ticket type is reused");
    const members = [...code.matchAll(/(?:export )?(?:async )?(\w+)\s*\(/g)].map((m) => m[1]);
    assert.ok(members.includes("updateTicket"), "write capability present");
    for (const forbidden of ["create", "delete", "complete", "transition", "list", "search", "poll", "syncAll"]) {
      assert.ok(
        !new RegExp(`\\b${forbidden}\\w*\\s*\\(`).test(code),
        `no ${forbidden} capability on the sink contract`,
      );
    }
    assert.ok(!/octokit|rest|graphql|\bgh\b|sdk|token|credential|label|comment/i.test(code), "no tracker client");
    assert.ok(!/writeFile|mkdir|readFile|database|checkpoint|event.?log|outbox|queue/i.test(code), "no persistence implementation");
    assert.ok(!/child_process|spawn|exec\(|shell|git\b|commit|push|merge|branch/i.test(code), "no process or git");
    assert.ok(!/loadConfig|validateConfig|FrameworkConfig|enabled/i.test(code), "no configuration");
    assert.ok(!/delegate|skill|fleet|lane|model|session|relay|opencode/i.test(code), "no delegate or provider logic");
    assert.ok(!/setTimeout|setInterval|retry|backoff|while|schedule|rollback|transaction|dead.?letter|lock|snapshot/i.test(code), "no retry or rollback machinery");
    assert.ok(!/WorkflowState|isValidTransition|advance|approve|requestChanges|resolveImplementer|resolveSeniorReviewer/i.test(code), "no workflow ownership");
    const appCode = readFileSync(join(__dirname, "..", "..", "src", "runtime", "application.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/\.state\s*=\s*[^=]/.test(appCode), "application never assigns workflow state");
    const coordinatorCode = readFileSync(join(__dirname, "..", "..", "src", "runtime", "coordinator.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/sink|updateTicket/i.test(coordinatorCode), "Coordinator stays sink-blind");
  });

  it("generic workflow and ticket contracts are unchanged", () => {
    const coordinatorCode = readFileSync(join(__dirname, "..", "..", "src", "runtime", "coordinator.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    for (const outcome of ["no-work", "conflict", "completed", "implementer-failed", "reviewer-failed"]) {
      assert.ok(coordinatorCode.includes(`"${outcome}"`), `Coordinator outcome ${outcome} intact`);
    }
    assert.ok(!/sync-failed/.test(coordinatorCode), "sync failure lives at the application layer only");
    const sinkCode = readFileSync(join(__dirname, "..", "..", "src", "runtime", "ticket-sink.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/technical_approval|changes_requested|in_progress|failed/.test(sinkCode), "sink names no workflow state");
  });
});
