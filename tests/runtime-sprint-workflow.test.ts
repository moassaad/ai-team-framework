import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentProvider } from "../src/providers/agent";
import { ExecutionResult } from "../src/providers/result";
import { IssueRequest } from "../src/providers/issue";
import { CoordinatorTicket } from "../src/runtime/coordinator";
import {
  SprintWorkflowInput,
  runSprintWorkflow,
} from "../src/runtime/sprint-workflow";

// Sprint orchestration skeleton tests (M19 E2E-001): one
// deterministic traversal over explicit outcomes. Every
// dependency is an injected fake; no config, network,
// filesystem, GitHub, OpenCode, delegate, sink, scheduler,
// or parallelism anywhere.

interface StageCalls {
  implementer: number;
  reviewer: number;
  technicalLead: number;
  pm: number;
  issues: IssueRequest[];
}

function ticket(id: string, state: CoordinatorTicket["state"] = "ready"): CoordinatorTicket {
  return { id, title: `Work ${id}`, description: `Description for ${id}.`, requirements: `Requirements for ${id}.`, state };
}

function baseInput(
  tickets: CoordinatorTicket[],
  calls: StageCalls,
  overrides: Partial<SprintWorkflowInput> = {},
): SprintWorkflowInput {
  return {
    tickets,
    roles: {
      resolveImplementer: async () => ({
        role: "implementer",
        specialty: "backend",
        provider: {
          name: "fake-implementer",
          execute: async () => {
            calls.implementer += 1;
            return { status: "succeeded", text: "Shipped; gates pass." };
          },
        },
      }),
      resolveSeniorReviewer: async () => ({
        role: "senior-reviewer",
        provider: {
          name: "fake-reviewer",
          execute: async () => {
            calls.reviewer += 1;
            return { status: "succeeded", text: "Reviewer notes: solid." };
          },
        },
      }),
    },
    technicalLead: {
      role: "technical-lead",
      provider: {
        name: "fake-tl",
        execute: async () => {
          calls.technicalLead += 1;
          return { status: "succeeded", text: "TL report: coherent, and also approved on paper." };
        },
      },
    },
    projectManager: {
      role: "project-manager",
      provider: {
        name: "fake-pm",
        execute: async () => {
          calls.pm += 1;
          return { status: "succeeded", text: "PM report: matches, approved on paper." };
        },
      },
    },
    coordinatorApproval: { role: "coordinator" },
    issues: {
      name: "fake-issues",
      create: async (request) => {
        calls.issues.push(request);
        return { id: "C-1" };
      },
    },
    project_root: "/proj",
    timeout_ms: 5000,
    decideReview: async () => ({ decision: "approved" }),
    decideTechnicalLead: async () => ({ decision: "approved" }),
    decidePmUserTesting: async () => ({ decision: "approved" }),
    decideFinalApproval: async () => ({ decision: "approved" }),
    ...overrides,
  };
}

function freshCalls(): StageCalls {
  return { implementer: 0, reviewer: 0, technicalLead: 0, pm: 0, issues: [] };
}

describe("sprint workflow", () => {
  it("complete happy path traverses every stage exactly once", async () => {
    const calls = freshCalls();
    const tickets = [ticket("T-001")];
    const before = JSON.stringify(tickets.map(({ state, ...rest }) => rest));
    const result = await runSprintWorkflow(baseInput(tickets, calls));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.finalApproval.outcome === "approved");
    assert.deepEqual(result.outcome === "completed" ? [...result.ticket_ids] : [], ["T-001"]);
    assert.deepEqual(calls.implementer, 1, "one Implementer invocation");
    assert.deepEqual(calls.reviewer, 1, "one Reviewer invocation");
    assert.deepEqual(calls.technicalLead, 1, "one TL invocation");
    assert.deepEqual(calls.pm, 1, "one PM invocation");
    assert.deepEqual(calls.issues.length, 0, "no correction ticket on the happy path");
    assert.equal(JSON.stringify(tickets.map(({ state, ...rest }) => rest)), before, "only the Coordinator-selected state advanced");
    assert.equal(tickets[0].state, "technical_approval", "Coordinator semantics preserved, nothing closed");
    assert.deepEqual(Object.isFrozen(result), true, "frozen result");
  });

  it("Coordinator work stops when work remains, before later stages", async () => {
    const calls = freshCalls();
    const tickets = [ticket("T-001"), ticket("T-002")];
    const result = await runSprintWorkflow(baseInput(tickets, calls));
    assert.equal(result.outcome, "work-remaining");
    assert.ok(result.outcome === "work-remaining" && result.evaluation.readyForTechnicalLeadReview === false);
    assert.deepEqual(result.outcome === "work-remaining" ? [...result.evaluation.workRemaining] : [], ["T-002"], "second ticket left for an explicit later call");
    assert.deepEqual(calls.implementer, 1, "one ticket per traversal, no drain loop");
    assert.deepEqual(calls.technicalLead, 0, "TL never invoked");
    assert.deepEqual(calls.pm, 0, "PM never invoked");
    assert.equal(tickets[1].state, "ready", "non-selected ticket untouched, order preserved");
  });

  it("Coordinator failure stops before evaluation with counts intact", async () => {
    const calls = freshCalls();
    const tickets = [ticket("T-001")];
    const failing = baseInput(tickets, calls, {
      roles: {
        resolveImplementer: async () => ({
          role: "implementer",
          specialty: "backend",
          provider: {
            name: "fake-implementer",
            execute: async (): Promise<ExecutionResult> => {
              calls.implementer += 1;
              throw new Error("opencode provider: process error");
            },
          },
        }),
        resolveSeniorReviewer: async () => ({
          role: "senior-reviewer",
          provider: {
            name: "fake-reviewer",
            execute: async () => {
              calls.reviewer += 1;
              return { status: "succeeded", text: "unreached" };
            },
          },
        }),
      },
    });
    const result = await runSprintWorkflow(failing);
    assert.equal(result.outcome, "failed");
    assert.ok(result.outcome === "failed" && result.coordinator.outcome === "implementer-failed");
    assert.deepEqual(calls.reviewer, 0, "no reviewer after Implementer failure");
    assert.deepEqual(calls.technicalLead, 0, "no TL after failure");
    assert.equal(tickets[0].state, "failed");
  });

  it("TL corrections-required creates one ticket and stops before PM", async () => {
    const calls = freshCalls();
    const tickets = [ticket("T-001")];
    const result = await runSprintWorkflow(baseInput(tickets, calls, {
      decideTechnicalLead: async (request) => {
        assert.ok(request.report.includes("approved on paper"), "report delivered, verdict separate");
        return { decision: "corrections-required", notes: "Split auth out." };
      },
    }));
    assert.equal(result.outcome, "technical-lead-corrections-required");
    assert.ok(result.outcome === "technical-lead-corrections-required" && result.correction.outcome === "created");
    assert.equal(calls.issues.length, 1, "exactly one R-018 creation, never one per ticket");
    assert.ok(calls.issues[0].title.includes("T-001"), "affected ids preserved");
    assert.ok(calls.issues[0].description.includes("Split auth out."), "notes verbatim");
    assert.deepEqual(calls.pm, 0, "PM never invoked after corrections");
  });

  it("correction creation failure stops with diagnostics and no PM", async () => {
    const calls = freshCalls();
    const tickets = [ticket("T-001")];
    const result = await runSprintWorkflow(baseInput(tickets, calls, {
      decideTechnicalLead: async () => ({ decision: "corrections-required", notes: "Fix it." }),
      issues: {
        name: "fake-issues",
        create: async (request) => {
          calls.issues.push(request);
          throw new Error("tracker offline");
        },
      },
    }));
    assert.equal(result.outcome, "correction-creation-failed");
    assert.ok(result.outcome === "correction-creation-failed" && result.correction.outcome === "creation-failed");
    assert.equal(calls.issues.length, 1, "no retry");
    assert.deepEqual(calls.pm, 0, "no PM after creation failure");
  });

  it("PM changes-required stops before final approval without side effects", async () => {
    const calls = freshCalls();
    const tickets = [ticket("T-001")];
    let finals = 0;
    const result = await runSprintWorkflow(baseInput(tickets, calls, {
      decidePmUserTesting: async (request) => {
        assert.ok(request.report.includes("approved on paper"), "PM report delivered, verdict separate");
        return { decision: "changes-required", notes: "Copy drifts." };
      },
      decideFinalApproval: async () => {
        finals += 1;
        return { decision: "approved" };
      },
    }));
    assert.equal(result.outcome, "pm-changes-required");
    assert.ok(result.outcome === "pm-changes-required" && result.pmReview.outcome === "changes-required");
    assert.equal(finals, 0, "final approval never invoked");
    assert.equal(calls.issues.length, 0, "no tickets created for PM changes");
    assert.equal(tickets[0].state, "technical_approval", "no mutation, no recursion");
  });

  it("final approval decides the sprint without synchronizing states", async () => {
    const calls = freshCalls();
    const tickets = [ticket("T-001")];
    const rejected = await runSprintWorkflow(baseInput(tickets, calls, {
      decideFinalApproval: async (request) => {
        assert.equal(request.pmReport, "PM report: matches, approved on paper.", "PM report unchanged into final context");
        return { decision: "changes-required", notes: "Hold release." };
      },
    }));
    assert.equal(rejected.outcome, "final-approval-rejected");
    assert.ok(rejected.outcome === "final-approval-rejected" && rejected.finalApproval.outcome === "changes-required");
    assert.equal(tickets[0].state, "technical_approval", "rejection creates no work and retries nothing");
    assert.deepEqual(calls.issues.length, 0, "no correction tickets from final rejection");
  });

  it("invalid input fails before any stage", async () => {
    const calls = freshCalls();
    await assert.rejects(runSprintWorkflow("nope" as never), /expected a workflow input object/);
    await assert.rejects(
      runSprintWorkflow(baseInput([ticket("T-001")], calls, { timeout_ms: 0 })),
      /timeout_ms must be a positive finite number/,
    );
    await assert.rejects(
      runSprintWorkflow(baseInput([ticket("T-001")], calls, { coordinatorApproval: { role: "technical-lead" } as never })),
      /must be the role "coordinator"/,
    );
    assert.deepEqual([calls.implementer, calls.reviewer, calls.technicalLead, calls.pm], [0, 0, 0, 0], "zero invocations");
    assert.deepEqual(calls.issues, [], "zero creations");
  });

  it("repeated traversal is deterministic with caller-owned dependencies", async () => {
    const firstCalls = freshCalls();
    const secondCalls = freshCalls();
    const first = await runSprintWorkflow(baseInput([ticket("T-001")], firstCalls));
    const second = await runSprintWorkflow(baseInput([ticket("T-001")], secondCalls));
    assert.deepEqual(first, second);
    assert.deepEqual(firstCalls, secondCalls, "identical stage counts");
  });

  it("orchestration coordinates explicit results only", () => {
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "sprint-workflow.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(
      importedModules.sort(),
      [
        "../providers/issue",
        "./coordinator",
        "./corrections",
        "./final-approval",
        "./pm-testing",
        "./review-decision",
        "./roles",
        "./sprint",
        "./technical-lead",
      ],
      "M18 boundaries plus contracts only",
    );
    assert.ok(!/\.report\.includes\(|\.includes\(["']approve|indexOf\(["']approve|LGTM/i.test(code), "no report-text inference");
    assert.ok(!/TicketSink|updateTicket|TicketSource|listTickets/i.test(code), "no sink or source calls");
    assert.ok(!/\.create\(/.test(code.replace(/createTechnicalLeadCorrectionTicket/g, "")), "creation only through R-018");
    for (const call of ["await runCoordinatorTicket(", "await runTechnicalLeadReview(", "await createTechnicalLeadCorrectionTicket(", "await runPmUserTestingReview(", "await runFinalApproval("]) {
      assert.equal(code.split(call).length - 1, 1, `${call} appears exactly once: no loops, retries, or schedulers`);
    }
    assert.ok(!/\.state\s*=(?![=>])/i.test(code), "no direct state mutation");
    assert.ok(!/child_process|\bspawn\b|execFile|execSync|fetch\(|http/i.test(code), "no processes or network");
    assert.ok(!/readFile|writeFile|mkdir|database|persist|cache|store/i.test(code), "no persistence");
    assert.ok(!/loadConfig|validateConfig|FrameworkConfig|process\.env/i.test(code), "no configuration");
    assert.ok(!/octokit|graphql|\bgh\b|openCode|delegate|skill|fleet|lane|model|session|relay/i.test(code), "no provider specifics");
    assert.ok(!/closed|cancelled|sprint_|approved_state/i.test(code.replace(/Final Approval|final approval|finalApproval|approval authority|approval input/gi, "")), "no state transitions or new states");
    assert.ok(!/stdin|stdout|TTY|readline|argv/i.test(code), "no CLI surface");
  });
});
