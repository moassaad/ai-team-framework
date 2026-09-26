import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentProvider } from "../src/providers/agent";
import { runProductionCoordinatorFromSource } from "../src/runtime/application";
import { CoordinatorTicket } from "../src/runtime/coordinator";
import {
  TicketSource,
  isTicketSource,
  validateSourceTickets,
} from "../src/runtime/ticket-source";

// Ticket source boundary tests (M18 R-007): read-only source
// feeding the composed production application. All sources and
// agents are hermetic fakes; no tracker, network, filesystem,
// Git, configuration, delegate, or persistence anywhere.

interface CallLog {
  prompts: string[];
}

function fakeStringAgent(log: CallLog): AgentProvider<string> {
  return {
    name: "fake-opencode",
    execute: async (invocation) => {
      log.prompts.push(invocation.prompt);
      return "Shipped; gates pass.";
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

function countingSource(tickets: CoordinatorTicket[], counts: { reads: number }): TicketSource & { observed: unknown[] } {
  const observed: unknown[] = [];
  return {
    observed,
    listTickets: async () => {
      counts.reads += 1;
      observed.push(tickets);
      return tickets;
    },
  };
}

function baseInput(overrides: {
  ticketSource: TicketSource;
  reviewDecision?: "approved" | "changes_requested";
  reviewFeedback?: string;
  log?: CallLog;
}): Parameters<typeof runProductionCoordinatorFromSource>[0] {
  return {
    ticketSource: overrides.ticketSource,
    specialty: "backend",
    openCodeAgent: fakeStringAgent(overrides.log ?? { prompts: [] }),
    project_root: "/proj",
    timeout_ms: 5000,
    decideReview: async () => ({
      decision: overrides.reviewDecision ?? "approved",
      ...(overrides.reviewFeedback !== undefined ? { feedback: overrides.reviewFeedback } : {}),
    }),
  };
}

describe("ticket source boundary", () => {
  it("accepts a valid source and reaches technical approval", async () => {
    const log: CallLog = { prompts: [] };
    const counts = { reads: 0 };
    const tickets = [ticket("T-001", "ready")];
    const source = countingSource(tickets, counts);
    const result = await runProductionCoordinatorFromSource(baseInput({ ticketSource: source, log }));
    assert.ok(isTicketSource(source), "source satisfies the contract");
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.final_state === "technical_approval");
    assert.ok(result.outcome === "completed" && result.ticket_id === "T-001");
    assert.equal(counts.reads, 1, "exactly one source read");
    assert.equal(tickets[0].state, "technical_approval");
  });

  it("passes the source result unchanged into Coordinator selection", async () => {
    const counts = { reads: 0 };
    const tickets = [ticket("T-001", "ready"), ticket("T-002", "ready")];
    const source = countingSource(tickets, counts);
    const result = await runProductionCoordinatorFromSource(baseInput({ ticketSource: source }));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.ticket_id === "T-001", "list order preserved, no resorting");
    assert.deepEqual(source.observed.length, 1);
    assert.ok(source.observed[0] === tickets, "same collection reference observed");
    assert.equal(tickets[1].state, "ready", "non-selected ticket untouched");
    assert.equal(counts.reads, 1);
  });

  it("empty source reaches the existing no-work behavior", async () => {
    const counts = { reads: 0 };
    const result = await runProductionCoordinatorFromSource(
      baseInput({ ticketSource: countingSource([], counts) }),
    );
    assert.deepEqual(result, {
      outcome: "no-work",
      reason: "no ready tickets (0 tickets: 0 ready)",
    });
    assert.equal(counts.reads, 1, "source still read exactly once");
  });

  it("source failure prevents Coordinator invocation and is not retried", async () => {
    const log: CallLog = { prompts: [] };
    const counts = { reads: 0 };
    const cause = new Error("tracker unreachable");
    const source: TicketSource = {
      listTickets: async () => {
        counts.reads += 1;
        throw cause;
      },
    };
    await assert.rejects(
      runProductionCoordinatorFromSource(baseInput({ ticketSource: source, log })),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /production application: ticket source failed/);
        assert.equal((error as { cause?: unknown }).cause, cause, "original failure preserved as cause");
        return true;
      },
    );
    assert.equal(counts.reads, 1, "no retry");
    assert.deepEqual(log.prompts, [], "no provider invoked");
  });

  it("malformed source results fail before Coordinator invocation", async () => {
    const badSources: Array<{ name: string; value: unknown }> = [
      { name: "non-array", value: { tickets: [] } },
      { name: "missing identity", value: [{ title: "x", description: "x", requirements: "x", state: "ready" }] },
      { name: "invalid state", value: [{ id: "T-1", title: "x", description: "x", requirements: "x", state: "done" }] },
      { name: "empty fields", value: [{ id: "", title: "x", description: "x", requirements: "x", state: "ready" }] },
    ];
    for (const { name, value } of badSources) {
      const log: CallLog = { prompts: [] };
      const counts = { reads: 0 };
      const source: TicketSource = {
        listTickets: async () => {
          counts.reads += 1;
          return value as never;
        },
      };
      await assert.rejects(
        runProductionCoordinatorFromSource(baseInput({ ticketSource: source, log })),
        /ticket source: /,
        name,
      );
      assert.equal(counts.reads, 1, `${name}: read once, then rejected`);
      assert.deepEqual(log.prompts, [], `${name}: Coordinator never executed`);
    }
    assert.throws(() => validateSourceTickets("nope"), /must resolve to an array/);
    assert.ok(!isTicketSource({}), "object without listTickets rejected");
    assert.ok(!isTicketSource({ listTickets: "list" }), "non-function listTickets rejected");
    assert.ok(!isTicketSource(null), "null rejected");
  });

  it("multiple source tickets still execute exactly one", async () => {
    const log: CallLog = { prompts: [] };
    const counts = { reads: 0 };
    const tickets = [ticket("T-001", "ready"), ticket("T-002", "ready"), ticket("T-003", "ready")];
    const result = await runProductionCoordinatorFromSource(
      baseInput({ ticketSource: countingSource(tickets, counts), log }),
    );
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.ticket_id === "T-001");
    assert.deepEqual(log.prompts.length, 2, "one implementer + one reviewer call total");
    assert.equal(counts.reads, 1);
    assert.equal(tickets[1].state, "ready");
    assert.equal(tickets[2].state, "ready");
  });

  it("rework priority from source results is unchanged", async () => {
    const counts = { reads: 0 };
    const tickets = [
      ticket("T-001", "ready"),
      ticket("T-002", "changes_requested", "Tighten it."),
      ticket("T-003", "ready"),
    ];
    const result = await runProductionCoordinatorFromSource(
      baseInput({ ticketSource: countingSource(tickets, counts) }),
    );
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.ticket_id === "T-002");
    assert.ok(result.outcome === "completed" && result.final_state === "technical_approval");
    assert.equal(tickets[0].state, "ready");
    assert.equal(tickets[2].state, "ready");
  });

  it("rework path through the source boundary remains functional", async () => {
    const counts = { reads: 0 };
    const tickets = [ticket("T-001", "changes_requested", "Fix the edge.")];
    const result = await runProductionCoordinatorFromSource(
      baseInput({ ticketSource: countingSource(tickets, counts) }),
    );
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.final_state === "technical_approval");
    assert.ok(
      result.outcome === "completed" &&
        result.transitions.some((edge) => edge.from === "changes_requested" && edge.to === "in_progress"),
      "R-002 transition preserved",
    );
    assert.equal(counts.reads, 1);
  });

  it("rejects a malformed source before any composition or execution", async () => {
    const log: CallLog = { prompts: [] };
    await assert.rejects(
      runProductionCoordinatorFromSource(baseInput({ ticketSource: { name: "broken" } as never, log })),
      /ticketSource must satisfy the ticket source contract/,
    );
    await assert.rejects(runProductionCoordinatorFromSource("nope" as never), /expected an application input object/);
    assert.deepEqual(log.prompts, [], "nothing executed");
  });

  it("repeated invocation is stateless with one read each", async () => {
    const firstCounts = { reads: 0 };
    const secondCounts = { reads: 0 };
    const first = await runProductionCoordinatorFromSource(
      baseInput({ ticketSource: countingSource([ticket("T-001", "ready")], firstCounts) }),
    );
    const second = await runProductionCoordinatorFromSource(
      baseInput({ ticketSource: countingSource([ticket("T-002", "ready")], secondCounts) }),
    );
    assert.deepEqual(first.outcome, second.outcome);
    assert.ok(second.outcome === "completed" && second.ticket_id === "T-002", "no caching between invocations");
    assert.deepEqual(firstCounts.reads, 1);
    assert.deepEqual(secondCounts.reads, 1);
  });

  it("source boundary introduces no tracker, persistence, or workflow seams", () => {
    const sourceCode = readFileSync(join(__dirname, "..", "..", "src", "runtime", "ticket-source.ts"), "utf8");
    const code = sourceCode.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(importedModules, ["./coordinator"], "only the existing ticket guard is reused");
    const members = [...code.matchAll(/(?:export )?(?:async )?(\w+)\s*\(/g)].map((m) => m[1]);
    assert.ok(members.includes("listTickets"), "read capability present");
    for (const forbidden of ["create", "update", "delete", "complete", "transition", "sync", "poll", "persist", "store", "cache"]) {
      assert.ok(
        !new RegExp(`\\b${forbidden}\\w*\\s*\\(`).test(code),
        `no ${forbidden} capability on the source contract`,
      );
    }
    assert.ok(!/github|gh\b|rest|graphql|sdk|token|credential|owner\/repo/i.test(code), "no tracker client");
    assert.ok(!/writeFile|mkdir|readFile|database|checkpoint|event.?log/i.test(code), "no persistence");
    assert.ok(!/child_process|spawn|exec\(|shell|git\b/i.test(code), "no process or git");
    assert.ok(!/loadConfig|validateConfig|FrameworkConfig|enabled/i.test(code), "no configuration");
    assert.ok(!/delegate|skill|fleet|lane|model|session|relay/i.test(code), "no delegate logic");
    assert.ok(!/setTimeout|setInterval|retry|backoff|while|schedule/i.test(code), "no scheduler or retries");
    assert.ok(!/WorkflowState|isValidTransition|advance|approve|requestChanges/i.test(code), "no workflow ownership");
  });
});
