import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentProvider } from "../src/providers/agent";
import { ExecutionResult } from "../src/providers/result";
import { WorkflowState } from "../src/workflow/states";
import { isValidTransition } from "../src/workflow/transitions";
import {
  CoordinatorTicket,
  runCoordinatorTicket,
} from "../src/runtime/coordinator";

// Rework cycle tests (M18 R-002): one changes_requested ticket
// runs one Implementer rework plus one Senior Reviewer re-review
// per invocation, then stops. Same hermetic fakes as R-001; the
// R-001 suite file itself is untouched.

interface ProviderCounts {
  implementer: number;
  reviewer: number;
  implementerPrompts: string[];
  reviewerPrompts: string[];
}

function freshCounts(): ProviderCounts {
  return { implementer: 0, reviewer: 0, implementerPrompts: [], reviewerPrompts: [] };
}

function succeedWith(text: string) {
  return async (): Promise<ExecutionResult> => ({ status: "succeeded", text });
}

function failWith(message: string) {
  return async (): Promise<ExecutionResult> => {
    throw new Error(message);
  };
}

function fakeProvider(
  counts: ProviderCounts,
  side: "implementer" | "reviewer",
  behavior: (prompt: string) => Promise<ExecutionResult>,
): AgentProvider<ExecutionResult> {
  return {
    name: `fake-${side}`,
    execute: async (invocation) => {
      counts[side] += 1;
      counts[`${side}Prompts`].push(invocation.prompt);
      return behavior(invocation.prompt);
    },
  };
}

function ticket(id: string, state: WorkflowState, extra: Partial<CoordinatorTicket> = {}): CoordinatorTicket {
  return {
    id,
    title: `Work ${id}`,
    description: `Description for ${id}.`,
    requirements: `Requirements for ${id}.`,
    state,
    ...extra,
  };
}

function reworkTicket(id: string, feedback = "Extract the helper; add a test."): CoordinatorTicket {
  return ticket(id, "changes_requested", { feedback });
}

function baseInput(
  counts: ProviderCounts,
  overrides: {
    tickets?: CoordinatorTicket[];
    implementerBehavior?: (prompt: string) => Promise<ExecutionResult>;
    reviewerBehavior?: (prompt: string) => Promise<ExecutionResult>;
    reviewDecision?: "approved" | "changes_requested";
    reviewFeedback?: string;
  } = {},
): Parameters<typeof runCoordinatorTicket>[0] {
  return {
    tickets: overrides.tickets ?? [reworkTicket("T-001")],
    specialty: "backend",
    project_root: "/proj",
    implementerProvider: fakeProvider(counts, "implementer", overrides.implementerBehavior ?? succeedWith("Reworked; gates pass.")),
    reviewerProvider: fakeProvider(counts, "reviewer", overrides.reviewerBehavior ?? succeedWith("Clean now.")),
    timeout_ms: 5000,
    reviewDecision: overrides.reviewDecision ?? "approved",
    ...(overrides.reviewFeedback !== undefined ? { reviewFeedback: overrides.reviewFeedback } : {}),
  };
}

describe("rework cycle", () => {
  it("selects the first changes_requested ticket deterministically", async () => {
    const counts = freshCounts();
    const tickets = [ticket("T-001", "closed"), reworkTicket("T-002"), reworkTicket("T-003")];
    const result = await runCoordinatorTicket(baseInput(counts, { tickets }));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.ticket_id === "T-002");
    assert.equal(tickets[1].state, "technical_approval");
    assert.equal(tickets[2].state, "changes_requested", "second rework ticket untouched");
  });

  it("prefers eligible rework over ready tickets", async () => {
    const counts = freshCounts();
    const tickets = [ticket("T-001", "ready"), reworkTicket("T-002")];
    const result = await runCoordinatorTicket(baseInput(counts, { tickets }));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.ticket_id === "T-002");
    assert.equal(tickets[0].state, "ready", "ready ticket waits");
    assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 1, reviewer: 1 });
  });

  it("in-flight execution still conflicts before any rework", async () => {
    const counts = freshCounts();
    const tickets = [ticket("T-001", "in_progress"), reworkTicket("T-002")];
    const before = JSON.stringify(tickets);
    const result = await runCoordinatorTicket(baseInput(counts, { tickets }));
    assert.equal(result.outcome, "conflict");
    assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 0, reviewer: 0 });
    assert.equal(JSON.stringify(tickets), before);
  });

  it("a changes_requested ticket is not an in-flight conflict", async () => {
    const counts = freshCounts();
    const tickets = [reworkTicket("T-001"), ticket("T-002", "ready")];
    const result = await runCoordinatorTicket(baseInput(counts, { tickets }));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.ticket_id === "T-001");
  });

  it("keeps the same ticket id from entry to final state", async () => {
    for (const decision of ["approved", "changes_requested"] as const) {
      const counts = freshCounts();
      const tickets = [reworkTicket("T-007")];
      const result = await runCoordinatorTicket(
        baseInput(counts, { tickets, reviewDecision: decision, reviewFeedback: "One more nit." }),
      );
      assert.equal(result.outcome, "completed");
      assert.ok(result.outcome === "completed" && result.ticket_id === "T-007");
      assert.equal(tickets[0].id, "T-007", "never cloned");
      assert.equal(tickets[0].state, result.outcome === "completed" ? result.final_state : "");
    }
  });

  it("keeps original task fields and transports feedback verbatim", async () => {
    const counts = freshCounts();
    const tickets = [reworkTicket("T-001", "Rename the flag; keep the default.")];
    const stored = JSON.stringify(tickets[0]);
    const result = await runCoordinatorTicket(baseInput(counts, { tickets }));
    assert.equal(result.outcome, "completed");
    const storedAfter = JSON.parse(JSON.stringify(tickets[0])) as CoordinatorTicket;
    assert.equal(storedAfter.title, "Work T-001");
    assert.equal(storedAfter.description, "Description for T-001.");
    assert.equal(storedAfter.requirements, "Requirements for T-001.", "stored requirements untouched");
    assert.equal(storedAfter.feedback, "Rename the flag; keep the default.");
    assert.equal(JSON.parse(stored).requirements, storedAfter.requirements);
    assert.ok(counts.implementerPrompts[0].includes("Requirements for T-001."), "original task present");
    assert.ok(counts.implementerPrompts[0].includes("Rename the flag; keep the default."), "feedback transported verbatim");
  });

  it("enters in_progress through the valid rework edge", async () => {
    const counts = freshCounts();
    const result = await runCoordinatorTicket(baseInput(counts, {}));
    assert.equal(result.outcome, "completed");
    assert.deepEqual(result.outcome === "completed" ? result.transitions[0] : undefined, {
      from: "changes_requested",
      to: "in_progress",
    });
  });

  it("runs one rework Implementer and reaches implementation_review", async () => {
    const counts = freshCounts();
    const tickets = [reworkTicket("T-001")];
    const result = await runCoordinatorTicket(baseInput(counts, { tickets }));
    assert.equal(result.outcome, "completed");
    assert.equal(counts.implementer, 1);
    assert.deepEqual(result.outcome === "completed" ? result.transitions[1] : undefined, {
      from: "in_progress",
      to: "implementation_review",
    });
    assert.equal(tickets[0].state === "implementation_review" || tickets[0].state === "technical_approval", true);
  });

  it("reviews the rework exactly once with the new evidence", async () => {
    const counts = freshCounts();
    const result = await runCoordinatorTicket(baseInput(counts, {}));
    assert.equal(result.outcome, "completed");
    assert.equal(counts.reviewer, 1);
    assert.ok(counts.reviewerPrompts[0].includes("Reworked; gates pass."));
  });

  it("approved re-review reaches technical_approval with valid edges", async () => {
    const counts = freshCounts();
    const tickets = [reworkTicket("T-001")];
    const result = await runCoordinatorTicket(baseInput(counts, { tickets, reviewDecision: "approved" }));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.final_state === "technical_approval");
    assert.equal(tickets[0].state, "technical_approval");
    const transitions = result.outcome === "completed" ? result.transitions : [];
    assert.deepEqual(
      transitions.map((edge) => `${edge.from}→${edge.to}`),
      ["changes_requested→in_progress", "in_progress→implementation_review", "implementation_review→technical_approval"],
    );
    for (const edge of transitions) {
      assert.ok(isValidTransition(edge.from, edge.to), `${edge.from} → ${edge.to} is a W-002 edge`);
    }
  });

  it("changes-requested re-review returns to changes_requested and stops", async () => {
    const counts = freshCounts();
    const tickets = [reworkTicket("T-001", "Old notes.")];
    const result = await runCoordinatorTicket(
      baseInput(counts, { tickets, reviewDecision: "changes_requested", reviewFeedback: "New notes." }),
    );
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.final_state === "changes_requested");
    assert.ok(result.outcome === "completed" && result.feedback === "New notes.", "new feedback preserved");
    assert.equal(tickets[0].state, "changes_requested");
    assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 1, reviewer: 1 }, "no second Implementer");
  });

  it("missing re-review feedback rejects before the transition", async () => {
    const counts = freshCounts();
    const tickets = [reworkTicket("T-001")];
    await assert.rejects(
      runCoordinatorTicket(baseInput(counts, { tickets, reviewDecision: "changes_requested" })),
      /reviewFeedback is required/,
    );
    assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 0, reviewer: 0 });
    assert.equal(tickets[0].state, "changes_requested");
  });

  it("rework Implementer failure records failed without reviewing", async () => {
    const counts = freshCounts();
    const tickets = [reworkTicket("T-001", "Keep these notes.")];
    const result = await runCoordinatorTicket(
      baseInput(counts, { tickets, implementerBehavior: failWith("rework container exploded") }),
    );
    assert.equal(result.outcome, "implementer-failed");
    assert.ok(result.outcome === "implementer-failed" && result.final_state === "failed");
    assert.equal(tickets[0].state, "failed");
    assert.equal(tickets[0].feedback, "Keep these notes.", "original notes not erased");
    assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 1, reviewer: 0 });
    const transitions = result.outcome === "implementer-failed" ? result.transitions : [];
    assert.deepEqual(transitions[transitions.length - 1], { from: "in_progress", to: "failed" });
  });

  it("rework Reviewer failure preserves implementation_review", async () => {
    const counts = freshCounts();
    const tickets = [reworkTicket("T-001")];
    const result = await runCoordinatorTicket(
      baseInput(counts, { tickets, reviewerBehavior: failWith("review service down") }),
    );
    assert.equal(result.outcome, "reviewer-failed");
    assert.ok(result.outcome === "reviewer-failed" && result.final_state === "implementation_review");
    assert.equal(tickets[0].state, "implementation_review");
    assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 1, reviewer: 1 });
  });

  it("a later invocation can process the new changes_requested state", async () => {
    const counts = freshCounts();
    const tickets = [reworkTicket("T-001", "First notes.")];
    const first = await runCoordinatorTicket(
      baseInput(counts, { tickets, reviewDecision: "changes_requested", reviewFeedback: "Second notes." }),
    );
    assert.equal(first.outcome, "completed");
    assert.ok(first.outcome === "completed" && first.final_state === "changes_requested");
    // Caller persists the new feedback onto the ticket for the next cycle.
    tickets[0].feedback = first.outcome === "completed" ? first.feedback : undefined;
    const second = await runCoordinatorTicket(baseInput(counts, { tickets, reviewDecision: "approved" }));
    assert.equal(second.outcome, "completed");
    assert.ok(second.outcome === "completed" && second.final_state === "technical_approval");
    assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 2, reviewer: 2 }, "one cycle per invocation, no loop");
    assert.ok(counts.implementerPrompts[1].includes("Second notes."), "new notes drive the next rework");
  });

  it("non-rework states are untouched by the rework path", async () => {
    for (const state of ["failed", "blocked", "cancelled", "technical_approval", "pm_review", "closed"] as const) {
      const counts = freshCounts();
      const tickets = [ticket("T-001", state)];
      const result = await runCoordinatorTicket(baseInput(counts, { tickets }));
      assert.equal(result.outcome, "no-work", state);
      assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 0, reviewer: 0 }, state);
      assert.equal(tickets[0].state, state);
    }
  });

  it("feedback-less changes_requested tickets are not executed", async () => {
    const counts = freshCounts();
    const tickets = [ticket("T-001", "changes_requested")];
    const result = await runCoordinatorTicket(baseInput(counts, { tickets }));
    assert.equal(result.outcome, "no-work");
    assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 0, reviewer: 0 });
    assert.equal(tickets[0].state, "changes_requested");
  });

  it("empty-string feedback is rejected as invalid input", async () => {
    const counts = freshCounts();
    const tickets = [ticket("T-001", "changes_requested", { feedback: "" })];
    await assert.rejects(runCoordinatorTicket(baseInput(counts, { tickets })), /every ticket must carry/);
    assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 0, reviewer: 0 });
  });

  it("leaves non-selected tickets byte-identical", async () => {
    const counts = freshCounts();
    const tickets = [ticket("T-001", "closed"), reworkTicket("T-002"), ticket("T-003", "ready")];
    const others = JSON.stringify([tickets[0], tickets[2]]);
    await runCoordinatorTicket(baseInput(counts, { tickets }));
    assert.equal(JSON.stringify([tickets[0], tickets[2]]), others);
    assert.equal(tickets[2].state, "ready");
  });

  it("generic contracts and R-001 seams are unchanged", async () => {
    const counts = freshCounts();
    const result = await runCoordinatorTicket(
      baseInput(counts, {
        implementerBehavior: succeedWith("custom rework text"),
        reviewerBehavior: succeedWith("custom re-review text"),
      }),
    );
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.implementation.text === "custom rework text");
    assert.ok(result.outcome === "completed" && result.report === "custom re-review text");
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "coordinator.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/interface AgentProvider|interface ExecutionResult|interface Delegation/i.test(code), "no contract redefinition");
    assert.ok(!/ReworkCoordinator|RetryManager|ReviewLoop|StateMachineV2|Scheduler/i.test(code), "no new machinery");
    assert.ok(!/skill|fleet|lane|model|session|relay/i.test(code), "no delegate specifics");
    assert.ok(!/\bgit\b|commit|merge|branch/i.test(code), "no git");
  });
});
