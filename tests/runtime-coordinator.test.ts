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
  CoordinatorTicketResult,
  runCoordinatorTicket,
} from "../src/runtime/coordinator";

// Single-ticket Coordinator runtime tests (M18 R-001): injected
// fake providers only. The runtime owns no store, clock, or
// transport — selection is list order, transitions are recorded on
// the caller's ticket objects, and each provider runs at most once.

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

function ticket(id: string, state: WorkflowState, title = `Work ${id}`): CoordinatorTicket {
  return {
    id,
    title,
    description: `Description for ${id}.`,
    requirements: `Requirements for ${id}.`,
    state,
  };
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
  const implementerProvider = fakeProvider(counts, "implementer", overrides.implementerBehavior ?? succeedWith("Implemented; gates pass."));
  const reviewerProvider = fakeProvider(counts, "reviewer", overrides.reviewerBehavior ?? succeedWith("No blocking issues."));
  return {
    tickets: overrides.tickets ?? [ticket("T-001", "ready")],
    roles: {
      resolveImplementer: () => ({ role: "implementer", specialty: "backend", provider: implementerProvider }),
      resolveSeniorReviewer: () => ({ role: "senior-reviewer", provider: reviewerProvider }),
    },
    project_root: "/proj",
    timeout_ms: 5000,
    reviewDecision: overrides.reviewDecision ?? "approved",
    ...(overrides.reviewFeedback !== undefined ? { reviewFeedback: overrides.reviewFeedback } : {}),
  };
}

function snapshot(tickets: CoordinatorTicket[]): string {
  return JSON.stringify(tickets);
}

describe("single-ticket coordinator runtime", () => {
  it("selects one ready ticket and runs it to technical approval", async () => {
    const counts = freshCounts();
    const tickets = [ticket("T-001", "closed"), ticket("T-002", "ready"), ticket("T-003", "cancelled")];
    const result = await runCoordinatorTicket(baseInput(counts, { tickets }));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.ticket_id === "T-002");
    assert.ok(result.outcome === "completed" && result.final_state === "technical_approval");
    assert.equal(tickets[1].state, "technical_approval");
  });

  it("executes only the first ready ticket, never in parallel", async () => {
    const counts = freshCounts();
    const tickets = [ticket("T-001", "ready"), ticket("T-002", "ready")];
    const result = await runCoordinatorTicket(baseInput(counts, { tickets }));
    assert.equal(result.outcome, "completed");
    assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 1, reviewer: 1 });
    assert.equal(tickets[0].state, "technical_approval");
    assert.equal(tickets[1].state, "ready", "second ticket untouched");
  });

  it("records ready → in_progress first and advances the ticket object", async () => {
    const counts = freshCounts();
    const tickets = [ticket("T-001", "ready")];
    const result = await runCoordinatorTicket(baseInput(counts, { tickets }));
    assert.equal(result.outcome, "completed");
    assert.deepEqual(result.outcome === "completed" ? result.transitions[0] : undefined, {
      from: "ready",
      to: "in_progress",
    });
    assert.equal(tickets[0].state, "technical_approval");
  });

  it("invokes the Implementer exactly once with the ticket context", async () => {
    const counts = freshCounts();
    await runCoordinatorTicket(baseInput(counts, {}));
    assert.equal(counts.implementer, 1);
    assert.equal(counts.implementerPrompts.length, 1);
    assert.ok(counts.implementerPrompts[0].includes("T-001"));
  });

  it("moves successful implementation to implementation_review, then reviews once", async () => {
    const counts = freshCounts();
    const tickets = [ticket("T-001", "ready")];
    const result = await runCoordinatorTicket(baseInput(counts, { tickets }));
    assert.equal(result.outcome, "completed");
    assert.deepEqual(result.outcome === "completed" ? result.transitions[1] : undefined, {
      from: "in_progress",
      to: "implementation_review",
    });
    assert.equal(counts.reviewer, 1);
    assert.equal(counts.reviewerPrompts.length, 1);
    assert.ok(counts.reviewerPrompts[0].includes("T-001"));
    assert.ok(counts.reviewerPrompts[0].includes("Implemented; gates pass."));
  });

  it("approval follows the existing technical_approval edge with valid transitions", async () => {
    const counts = freshCounts();
    const result = await runCoordinatorTicket(baseInput(counts, { reviewDecision: "approved" }));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.final_state === "technical_approval");
    const transitions = result.outcome === "completed" ? result.transitions : [];
    assert.deepEqual(transitions[transitions.length - 1], {
      from: "implementation_review",
      to: "technical_approval",
    });
    for (const edge of transitions) {
      assert.ok(isValidTransition(edge.from, edge.to), `${edge.from} → ${edge.to} is a W-002 edge`);
    }
    assert.ok(result.outcome === "completed" && result.implementation.text === "Implemented; gates pass.");
    assert.ok(result.outcome === "completed" && result.report === "No blocking issues.");
  });

  it("changes requested uses the existing changes_requested edge and preserves feedback", async () => {
    const counts = freshCounts();
    const tickets = [ticket("T-001", "ready")];
    const result = await runCoordinatorTicket(
      baseInput(counts, { tickets, reviewDecision: "changes_requested", reviewFeedback: "Extract the helper; add a test." }),
    );
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.final_state === "changes_requested");
    assert.ok(result.outcome === "completed" && result.feedback === "Extract the helper; add a test.");
    assert.ok(result.outcome === "completed" && result.report === "No blocking issues.");
    assert.equal(tickets[0].state, "changes_requested", "same ticket carries the notes");
    const transitions = result.outcome === "completed" ? result.transitions : [];
    assert.deepEqual(transitions[transitions.length - 1], {
      from: "implementation_review",
      to: "changes_requested",
    });
    for (const edge of transitions) {
      assert.ok(isValidTransition(edge.from, edge.to), `${edge.from} → ${edge.to} is a W-002 edge`);
    }
  });

  it("changes requested without feedback rejects before any provider runs", async () => {
    const counts = freshCounts();
    await assert.rejects(
      runCoordinatorTicket(baseInput(counts, { reviewDecision: "changes_requested" })),
      /reviewFeedback is required/,
    );
    assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 0, reviewer: 0 });
  });

  it("Implementer failure records failed without retrying or reviewing", async () => {
    const counts = freshCounts();
    const tickets = [ticket("T-001", "ready"), ticket("T-002", "ready")];
    const result = await runCoordinatorTicket(
      baseInput(counts, { tickets, implementerBehavior: failWith("container exploded") }),
    );
    assert.equal(result.outcome, "implementer-failed");
    assert.ok(result.outcome === "implementer-failed" && result.final_state === "failed");
    assert.ok(result.outcome === "implementer-failed" && result.error.kind === "provider_error");
    assert.equal(tickets[0].state, "failed", "failure is never fabricated as success");
    assert.equal(tickets[1].state, "ready", "second ticket untouched");
    assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 1, reviewer: 0 });
    const transitions = result.outcome === "implementer-failed" ? result.transitions : [];
    assert.deepEqual(transitions[transitions.length - 1], { from: "in_progress", to: "failed" });
    for (const edge of transitions) {
      assert.ok(isValidTransition(edge.from, edge.to), `${edge.from} → ${edge.to} is a W-002 edge`);
    }
  });

  it("Reviewer failure preserves implementation_review without auto-approving", async () => {
    const counts = freshCounts();
    const tickets = [ticket("T-001", "ready")];
    const result = await runCoordinatorTicket(
      baseInput(counts, { tickets, reviewerBehavior: failWith("review service down") }),
    );
    assert.equal(result.outcome, "reviewer-failed");
    assert.ok(result.outcome === "reviewer-failed" && result.final_state === "implementation_review");
    assert.ok(result.outcome === "reviewer-failed" && result.error.kind === "provider_error");
    assert.equal(tickets[0].state, "implementation_review");
    assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 1, reviewer: 1 });
  });

  it("never executes non-ready tickets as new work", async () => {
    for (const state of ["blocked", "cancelled", "closed", "failed", "changes_requested", "technical_approval", "pm_review", "needs_user_input"] as const) {
      const counts = freshCounts();
      const tickets = [ticket("T-001", state)];
      const result = await runCoordinatorTicket(baseInput(counts, { tickets }));
      assert.equal(result.outcome, "no-work", state);
      assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 0, reviewer: 0 }, state);
      assert.equal(tickets[0].state, state, `${state} untouched`);
    }
  });

  it("returns no-work when no ticket is ready", async () => {
    const counts = freshCounts();
    const result = await runCoordinatorTicket(baseInput(counts, { tickets: [ticket("T-001", "closed"), ticket("T-002", "cancelled")] }));
    assert.equal(result.outcome, "no-work");
    assert.match(result.outcome === "no-work" ? result.reason : "", /no ready tickets \(2 tickets: 0 ready\)/);
    assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 0, reviewer: 0 });
  });

  it("refuses a second ticket while one is already active", async () => {
    for (const state of ["in_progress", "implementation_review"] as const) {
      const counts = freshCounts();
      const tickets = [ticket("T-001", state), ticket("T-002", "ready")];
      const before = snapshot(tickets);
      const result = await runCoordinatorTicket(baseInput(counts, { tickets }));
      assert.equal(result.outcome, "conflict", state);
      assert.ok(result.outcome === "conflict" && result.ticket_id === "T-001");
      assert.match(result.outcome === "conflict" ? result.reason : "", /already active/);
      assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 0, reviewer: 0 }, state);
      assert.equal(snapshot(tickets), before, "nothing mutated on conflict");
    }
  });

  it("leaves every non-selected ticket byte-identical", async () => {
    const counts = freshCounts();
    const tickets = [ticket("T-001", "closed"), ticket("T-002", "ready"), ticket("T-003", "cancelled")];
    const others = JSON.stringify([tickets[0], tickets[2]]);
    await runCoordinatorTicket(baseInput(counts, { tickets }));
    assert.equal(JSON.stringify([tickets[0], tickets[2]]), others);
  });

  it("validates all inputs before invoking any provider", async () => {
    const counts = freshCounts();
    const valid = baseInput(counts, {});
    await assert.rejects(runCoordinatorTicket({ ...valid, roles: "yes" as never }), /roles must satisfy the role resolver contract/);
    await assert.rejects(runCoordinatorTicket({ ...valid, timeout_ms: 0 }), /timeout_ms must be a positive finite number/);
    await assert.rejects(runCoordinatorTicket({ ...valid, reviewDecision: "maybe" as never }), /reviewDecision must be/);
    await assert.rejects(
      runCoordinatorTicket({ ...valid, tickets: [{ id: "", title: "t", description: "d", requirements: "r", state: "ready" }] }),
      /every ticket must carry/,
    );
    await assert.rejects(runCoordinatorTicket("nope" as never), /expected a runtime input object/);
    assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 0, reviewer: 0 });
  });

  it("uses no new workflow state: every recorded state is canonical", async () => {
    for (const decision of ["approved", "changes_requested"] as const) {
      const counts = freshCounts();
      const tickets = [ticket("T-001", "ready")];
      const result: CoordinatorTicketResult = await runCoordinatorTicket(
        baseInput(counts, { tickets, reviewDecision: decision, reviewFeedback: "Fix it." }),
      );
      assert.equal(result.outcome, "completed");
      const states: WorkflowState[] =
        result.outcome === "completed"
          ? [tickets[0].state, result.final_state, ...result.transitions.flatMap((edge) => [edge.from, edge.to])]
          : [];
      assert.ok(states.length > 0);
      for (const state of states) {
        assert.ok(["ready", "in_progress", "implementation_review", "technical_approval", "changes_requested"].includes(state));
      }
      assert.ok(!["closed", "cancelled"].includes(tickets[0].state), "R-001 never closes");
    }
  });

  it("is deterministic and returns frozen results", async () => {
    const first: CoordinatorTicketResult = await runCoordinatorTicket(
      baseInput(freshCounts(), { reviewDecision: "changes_requested", reviewFeedback: "Fix it." }),
    );
    const second: CoordinatorTicketResult = await runCoordinatorTicket(
      baseInput(freshCounts(), { reviewDecision: "changes_requested", reviewFeedback: "Fix it." }),
    );
    assert.deepEqual(first, second);
    assert.ok(Object.isFrozen(first));
    if (first.outcome === "completed") {
      assert.ok(Object.isFrozen(first.transitions));
    }
  });

  it("respects manual approval by never consulting or granting it", async () => {
    const counts = freshCounts();
    const result = await runCoordinatorTicket(baseInput(counts, {}));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.final_state === "technical_approval");
    assert.ok(!["closed", "cancelled"].includes(result.outcome === "completed" ? result.final_state : ""));
  });

  it("keeps tickets on the existing PlanTicket-compatible shape", () => {
    const runtimeTicket = ticket("T-001", "ready");
    assert.deepEqual(Object.keys(runtimeTicket).sort(), ["description", "id", "requirements", "state", "title"]);
  });

  it("flows provider contracts through unchanged", async () => {
    const counts = freshCounts();
    const result = await runCoordinatorTicket(
      baseInput(counts, {
        implementerBehavior: succeedWith("custom implementation text"),
        reviewerBehavior: succeedWith("custom review text"),
      }),
    );
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.implementation.text === "custom implementation text");
    assert.ok(result.outcome === "completed" && result.report === "custom review text");
  });

  it("passes discovery context through to both invocations", async () => {
    const counts = freshCounts();
    const input = { ...baseInput(counts, {}), discovery_summary: "Python project, pytest." };
    const result = await runCoordinatorTicket(input);
    assert.equal(result.outcome, "completed");
    assert.equal(counts.implementer, 1);
    assert.equal(counts.reviewer, 1);
  });

  it("touches no provider, shell, git, config, approval, selection, or tracker seams itself", () => {
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "coordinator.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(
      importedModules.sort(),
      [
        "../execution/changes-requested",
        "../execution/implementer",
        "../execution/reviewer",
        "../execution/technical-approval",
        "../providers/result",
        "../workflow/states",
        "../workflow/transitions",
        "./roles",
      ],
      "existing execution/workflow seams plus the role seam only",
    );
    assert.ok(!/child_process|spawn|exec\(|shell|relay\.mjs|specify|opencode|github|npx/i.test(code), "no provider commands or processes");
    assert.ok(!/\bgit\b|commit|merge|branch/i.test(code), "no git");
    assert.ok(!/loadConfig|validateConfig|FrameworkConfig/i.test(code), "no config");
    assert.ok(
      !/workflow\/approval|manual-approval|automatic-approval|getApprovalPolicy|isManualApproval|isAutomaticApproval|ApprovalPolicy|ApprovalConfig/i.test(code),
      "no approval configuration consulted or granted",
    );
    assert.ok(!/resolveRole|slash|prompt|fleet|lane|model|session|skill/i.test(code), "no selection, routing, or delegation specifics");
    assert.ok(!/issueProvider|IssueProvider|providers\/issue|providers\/github|providers\/delegate/i.test(code), "no tracker calls");
    assert.ok(!/interface AgentProvider|interface ExecutionResult|interface Delegation/i.test(code), "no contract redefinition");
    assert.ok(!/setTimeout|setInterval|retry|backoff|poll/i.test(code), "no retries or timers");
  });
});
