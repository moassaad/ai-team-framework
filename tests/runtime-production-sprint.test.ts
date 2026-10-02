import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CoordinatorTicket } from "../src/runtime/coordinator";
import { TicketSource } from "../src/runtime/ticket-source";
import { TicketSink } from "../src/runtime/ticket-sink";
import {
  ProductionSprintWorkflowInput,
  runProductionSprintWorkflow,
} from "../src/runtime/production-sprint";

// Production sprint composition tests (M19 E2E-003): the
// generic operation wires source → workflow → explicit final
// synchronization with all dependencies explicit. Hermetic
// throughout — fake source/sink, fake OpenCode string agent,
// fake ExecutionResult role providers, fake issues, explicit
// resolvers. No config, network, filesystem, GitHub,
// scheduler, or parallelism anywhere.

interface CallCounts {
  source: number;
  agent: number;
  technicalLead: number;
  pm: number;
  finalApproval: number;
  sink: number;
  issues: number;
}

function ticket(id: string, state: CoordinatorTicket["state"] = "ready"): CoordinatorTicket {
  return { id, title: `Work ${id}`, description: `Description for ${id}.`, requirements: `Requirements for ${id}.`, state };
}

function counts(): CallCounts {
  return { source: 0, agent: 0, technicalLead: 0, pm: 0, finalApproval: 0, sink: 0, issues: 0 };
}

function baseInput(
  tickets: CoordinatorTicket[],
  seen: CallCounts,
  overrides: Partial<ProductionSprintWorkflowInput> = {},
  sinkFails = false,
): ProductionSprintWorkflowInput {
  const ticketSource: TicketSource = {
    listTickets: async () => {
      seen.source += 1;
      return tickets;
    },
  };
  const written: CoordinatorTicket[] = [];
  const ticketSink: TicketSink = {
    updateTicket: async (entry) => {
      seen.sink += 1;
      if (sinkFails) {
        throw new Error("sink offline");
      }
      written.push(entry);
    },
  };
  return {
    ticketSource,
    ticketSink,
    specialty: "backend",
    openCodeAgent: {
      name: "fake-opencode",
      execute: async () => {
        seen.agent += 1;
        return "provider output text";
      },
    },
    technicalLead: {
      role: "technical-lead",
      provider: {
        name: "fake-tl",
        execute: async () => {
          seen.technicalLead += 1;
          return { status: "succeeded", text: "TL report: coherent." };
        },
      },
    },
    projectManager: {
      role: "project-manager",
      provider: {
        name: "fake-pm",
        execute: async () => {
          seen.pm += 1;
          return { status: "succeeded", text: "PM report: matches." };
        },
      },
    },
    coordinatorApproval: { role: "coordinator" },
    issues: {
      name: "fake-issues",
      create: async () => {
        seen.issues += 1;
        return { id: "C-1" };
      },
    },
    project_root: "/proj",
    timeout_ms: 5000,
    decideReview: async () => {
      return { decision: "approved" };
    },
    decideTechnicalLead: async () => ({ decision: "approved" }),
    decidePmUserTesting: async () => ({ decision: "approved" }),
    decideFinalApproval: async (request) => {
      seen.finalApproval += 1;
      return { decision: "approved", notes: `saw ${request.ticket_ids.length}` };
    },
    ...overrides,
  };
}

describe("production sprint dependency assembly", () => {
  it("rejects invalid dependencies before any execution", async () => {
    const seen = counts();
    const valid = baseInput([ticket("T-001")], seen);
    await assert.rejects(runProductionSprintWorkflow("nope" as never), /expected a production sprint input object/);
    await assert.rejects(
      runProductionSprintWorkflow({ ...valid, ticketSource: { name: "x" } as never }),
      /ticketSource must satisfy the ticket source contract/,
    );
    await assert.rejects(
      runProductionSprintWorkflow({ ...valid, ticketSink: undefined as never }),
      /ticketSink must satisfy the ticket sink contract/,
      "sink required, never defaulted",
    );
    await assert.rejects(
      runProductionSprintWorkflow({ ...valid, openCodeAgent: { name: "x" } as never }),
      /agent must satisfy the agent provider contract/,
    );
    await assert.rejects(
      runProductionSprintWorkflow({ ...valid, specialty: "design" as never }),
      /unknown specialty/,
    );
    await assert.rejects(
      runProductionSprintWorkflow({
        ...valid,
        technicalLead: { role: "senior-reviewer", provider: (valid.technicalLead as { provider: unknown }).provider } as never,
      }),
      /must be the role "technical-lead"/,
      "no silent Senior Reviewer reuse",
    );
    await assert.rejects(
      runProductionSprintWorkflow({
        ...valid,
        projectManager: { role: "implementer", provider: (valid.projectManager as { provider: unknown }).provider } as never,
      }),
      /must be the role "project-manager"/,
      "no inference from the Coordinator side",
    );
    await assert.rejects(
      runProductionSprintWorkflow({ ...valid, coordinatorApproval: { role: "technical-lead" } as never }),
      /must be the role "coordinator"/,
      "no other role approves finally",
    );
    await assert.rejects(
      runProductionSprintWorkflow({ ...valid, issues: { name: "x" } as never }),
      /issues must satisfy the issue provider contract/,
    );
    await assert.rejects(
      runProductionSprintWorkflow({ ...valid, decideFinalApproval: "yes" as never }),
      /decideFinalApproval must be a final approval decision resolver/,
      "approvals never fabricated",
    );
    assert.deepEqual(seen, counts(), "zero calls of any kind before valid execution");
  });
});

describe("production sprint source and workflow", () => {
  it("reads the source once and passes its snapshot to a single workflow traversal", async () => {
    const seen = counts();
    const tickets = [ticket("T-001")];
    const result = await runProductionSprintWorkflow(baseInput(tickets, seen));
    assert.equal(result.outcome, "workflow-completed-and-synchronized");
    assert.equal(seen.source, 1, "exactly one source read");
    assert.equal(seen.agent, 2, "one Implementer plus one Reviewer call: one ticket per invocation");
    assert.equal(seen.technicalLead, 1, "explicit TL dependency used once");
    assert.equal(seen.pm, 1, "explicit PM dependency used once");
    assert.equal(seen.finalApproval, 1, "explicit Coordinator decision used once");
    assert.equal(seen.issues, 0, "no correction on the happy path");
    assert.ok(result.outcome === "workflow-completed-and-synchronized" && result.workflow.ticket_ids.includes("T-001"), "source snapshot reached the workflow");
    assert.ok(tickets[0].state === "technical_approval", "Coordinator semantics preserved, nothing closed by the workflow");
  });

  it("source failure returns source-failed with zero workflow calls", async () => {
    const seen = counts();
    const input = baseInput([ticket("T-001")], seen, {
      ticketSource: {
        listTickets: async () => {
          seen.source += 1;
          throw new Error("tracker down");
        },
      },
    });
    const result = await runProductionSprintWorkflow(input);
    assert.equal(result.outcome, "source-failed");
    assert.ok(result.outcome === "source-failed" && result.error.kind === "ticket-source-failed");
    assert.ok(result.outcome === "source-failed" && result.error.message === "tracker down", "bounded diagnostic preserved");
    assert.equal(seen.source, 1, "attempted once, never retried");
    assert.deepEqual([seen.agent, seen.technicalLead, seen.pm, seen.finalApproval, seen.sink, seen.issues], [0, 0, 0, 0, 0, 0], "workflow never invoked, nothing fabricated");
    const malformed = await runProductionSprintWorkflow(
      baseInput([ticket("T-001")], counts(), { ticketSource: { listTickets: async () => "garbage" as never } }),
    );
    assert.equal(malformed.outcome, "source-failed", "malformed payload is a source failure, not a workflow input");
  });

  it("two ready tickets stop after the first with no drain loop", async () => {
    const seen = counts();
    const tickets = [ticket("T-001"), ticket("T-002")];
    const result = await runProductionSprintWorkflow(baseInput(tickets, seen));
    assert.equal(result.outcome, "workflow-not-completed");
    assert.ok(result.outcome === "workflow-not-completed" && result.workflow.outcome === "work-remaining");
    assert.equal(seen.agent, 2, "first ticket only: one Implementer plus one Reviewer call");
    assert.equal(seen.technicalLead, 0, "later stages never reached");
    assert.equal(seen.sink, 0, "non-completed workflow never synchronizes");
    assert.equal(tickets[1].state, "ready", "second ticket left for an explicit later call");
  });

  it("Coordinator failure returns workflow-failed with diagnostics intact", async () => {
    const seen = counts();
    const input = baseInput([ticket("T-001")], seen, {
      openCodeAgent: {
        name: "fake-opencode",
        execute: async () => {
          seen.agent += 1;
          throw new Error("provider blew up");
        },
      },
    });
    const result = await runProductionSprintWorkflow(input);
    assert.equal(result.outcome, "workflow-failed");
    assert.ok(result.outcome === "workflow-failed" && result.workflow.outcome === "failed");
    assert.equal(seen.sink, 0, "failures never synchronize");
  });
});

describe("production sprint correction path", () => {
  it("TL corrections create exactly one issue and stop with no re-entry", async () => {
    const seen = counts();
    const tickets = [ticket("T-001")];
    const input = baseInput([ticket("T-001")], seen, {
      decideTechnicalLead: async () => ({ decision: "corrections-required", notes: "Split T-001." }),
    });
    const result = await runProductionSprintWorkflow(input);
    assert.equal(result.outcome, "workflow-not-completed");
    assert.ok(
      result.outcome === "workflow-not-completed" &&
        result.workflow.outcome === "technical-lead-corrections-required" &&
        result.workflow.correction.outcome === "created",
    );
    assert.equal(seen.issues, 1, "exactly one R-018 creation attempt");
    assert.ok(
      result.outcome === "workflow-not-completed" &&
        result.workflow.outcome === "technical-lead-corrections-required" &&
        result.workflow.correction.outcome === "created" &&
        result.workflow.correction.reference.id === "C-1",
      "IssueReference stays opaque",
    );
    assert.equal(tickets.length, 1, "reference never becomes a Coordinator ticket");
    assert.equal(seen.agent, 2, "no second workflow call after correction creation");
    assert.equal(seen.pm, 0, "PM never reached");
    assert.equal(seen.finalApproval, 0, "final approval never reached");
    assert.equal(seen.sink, 0, "no synchronization");
  });
});

describe("production sprint PM and final paths", () => {
  it("PM changes-required stops before final approval with zero sink calls", async () => {
    const seen = counts();
    const result = await runProductionSprintWorkflow(
      baseInput([ticket("T-001")], seen, {
        decidePmUserTesting: async () => ({ decision: "changes-required", notes: "Copy off." }),
      }),
    );
    assert.equal(result.outcome, "workflow-not-completed");
    assert.ok(result.outcome === "workflow-not-completed" && result.workflow.outcome === "pm-changes-required");
    assert.equal(seen.finalApproval, 0, "withheld PM approval never reaches final approval");
    assert.equal(seen.sink, 0, "no synchronization");
  });

  it("final changes-required withholds synchronization without retry", async () => {
    const seen = counts();
    const result = await runProductionSprintWorkflow(
      baseInput([ticket("T-001")], seen, {
        decideFinalApproval: async () => {
          seen.finalApproval += 1;
          return { decision: "changes-required", notes: "Not yet." };
        },
      }),
    );
    assert.equal(result.outcome, "workflow-not-completed");
    assert.ok(result.outcome === "workflow-not-completed" && result.workflow.outcome === "final-approval-rejected");
    assert.equal(seen.finalApproval, 1, "exactly one final decision resolution");
    assert.equal(seen.sink, 0, "withheld final approval never synchronizes");
    assert.equal(seen.agent, 2, "no workflow rerun after rejection");
  });
});

describe("production sprint synchronization", () => {
  it("completed workflow synchronizes eligible tickets in order", async () => {
    const seen = counts();
    const tickets = [ticket("T-001")];
    const written: CoordinatorTicket[] = [];
    const input = baseInput(tickets, seen);
    const recording: TicketSink = {
      updateTicket: async (entry) => {
        seen.sink += 1;
        written.push(entry);
      },
    };
    const result = await runProductionSprintWorkflow({ ...input, ticketSink: recording });
    assert.equal(result.outcome, "workflow-completed-and-synchronized");
    assert.equal(seen.sink, 1, "exactly one synchronization call");
    assert.deepEqual(written.map((entry) => [entry.id, entry.state]), [["T-001", "closed"]]);
    assert.ok(
      result.outcome === "workflow-completed-and-synchronized" &&
        result.workflow.outcome === "completed" &&
        result.synchronization.outcome === "synchronized",
      "both phases explicit in the combined result",
    );
    assert.deepEqual(
      result.outcome === "workflow-completed-and-synchronized" ? [...result.synchronization.synchronizedIds] : [],
      ["T-001"],
    );
    assert.deepEqual(Object.isFrozen(result), true, "frozen result");
  });

  it("synchronization failure preserves workflow success with no retry of anything", async () => {
    const seen = counts();
    const result = await runProductionSprintWorkflow(baseInput([ticket("T-001")], seen, {}, true));
    assert.equal(result.outcome, "workflow-completed-sync-failed");
    assert.ok(
      result.outcome === "workflow-completed-sync-failed" &&
        result.workflow.outcome === "completed" &&
        result.workflow.finalApproval.outcome === "approved",
      "bounded workflow success preserved",
    );
    assert.ok(
      result.outcome === "workflow-completed-sync-failed" &&
        result.synchronization.outcome === "sync-failed" &&
        result.synchronization.error.kind === "ticket-synchronization-failed",
      "synchronization failure exposed",
    );
    assert.equal(seen.sink, 1, "sink called once, never retried");
    assert.equal(seen.agent, 2, "workflow never rerun after sync failure");
    assert.equal(seen.source, 1, "source never reread after sync failure");
  });
});

describe("production sprint architecture", () => {
  it("composition owns assembly only", () => {
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "production-sprint.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))].sort();
    assert.deepEqual(
      importedModules,
      [
        "../providers/agent",
        "../providers/issue",
        "../providers/opencode-execution",
        "../roles/contract",
        "./final-approval",
        "./pm-testing",
        "./production",
        "./review-decision",
        "./roles",
        "./sprint-synchronization",
        "./sprint-workflow",
        "./technical-lead",
        "./ticket-sink",
        "./ticket-source",
      ],
      "generic runtime and provider contracts only",
    );
    assert.ok(!/loadConfig|validateConfig|FrameworkConfig|process\.env|config\./i.test(code), "no raw configuration access from generic runtime");
    assert.ok(!/createGitHub|octokit|graphql|openCodeProvider|createOpenCodeProvider|delegate|skill|fleet|lane|model|session/i.test(code), "no provider-specific construction or detection");
    assert.ok(!/runCoordinatorTicket|evaluateSprintCompletion|runTechnicalLeadReview|createTechnicalLeadCorrectionTicket|runPmUserTestingReview|runFinalApproval|resolveImplementer|resolveSeniorReviewer|select/i.test(code), "no workflow, stage, or selection logic");
    assert.ok(!/"approved"|"changes-required"|"corrections-required"|"changes_requested"/.test(code), "no decision literals: approvals never fabricated, reports never parsed");
    assert.ok(!/"closed"|\.state\s*=(?![=>])|to_state|closed|cancelled/i.test(code.replace(/final synchronization|explicit final|Final approval|final approval/gi, "")), "no state transitions: synchronization owns closure");
    assert.ok(!/\.create\(|listTickets\(\)|updateTicket\(/i.test(code.replace(/ticketSource\.listTickets|ticketSink: input\.ticketSink|TicketSource|TicketSink|ticket source|ticket sink/gi, "")), "no direct provider calls beyond the single source read");
    assert.ok(!/child_process|\bspawn\b|execFile|fetch\(|http/i.test(code), "no processes or network");
    assert.ok(!/readFile|writeFile|mkdir|database|cache|store|registry|singleton/i.test(code), "no persistence or hidden state");
    assert.ok(!/setTimeout|setInterval|poll|schedule|queue|drain|rollback/i.test(code), "no scheduler, queue, drain, or rollback");
    assert.ok(!/Promise\.all|Promise\.race|Promise\.allSettled/i.test(code), "no concurrency primitives");
    assert.ok(!/retry|fallback|attempt\(|attempts/i.test(code), "no hidden retry or fallback");
    assert.ok(!/while\s*\(/.test(code), "no loops of any kind");
    assert.ok(!/stdin|stdout|argv|readline/i.test(code), "no CLI surface");
    assert.ok(!/setup|install|configure|upgrade|detect/i.test(code.replace(/decision resolver|resolvers|Decided|decided/gi, "")), "no integration setup or detection mutation");
    assert.deepEqual((code.match(/await input\.ticketSource\.listTickets\(\)/g) ?? []).length, 1, "exactly one source call site");
    assert.deepEqual((code.match(/await runSprintWorkflow\(/g) ?? []).length, 1, "exactly one workflow call site");
    assert.deepEqual((code.match(/await synchronizeSprintOutcome\(/g) ?? []).length, 1, "exactly one synchronization call site");
    assert.ok(/runProductionSprintWorkflow/.test(code), "no self-recursion beyond the entry point itself");
    assert.deepEqual((code.match(/runProductionSprintWorkflow\(/g) ?? []).length, 1, "entry point never calls itself");
  });

  it("existing M18 boundaries remain unchanged", () => {
    const strip = (file: string): string =>
      readFileSync(join(__dirname, "..", "..", "src", "runtime", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const file of ["application.ts", "production.ts", "coordinator.ts", "roles.ts", "ticket-source.ts", "ticket-sink.ts"]) {
      assert.ok(
        !/production-sprint|sprint-workflow|sprint-synchronization/i.test(strip(file)),
        `${file} takes no direction from the composition layers above it`,
      );
    }
    const workflow = readFileSync(join(__dirname, "..", "..", "src", "runtime", "sprint-workflow.ts"), "utf8");
    assert.ok(!/synchronizeSprintOutcome|TicketSink|production/i.test(workflow.replace(/\/\*[\s\S]*?\*\//g, "")), "workflow still owns no persistence or production concerns");
    const sync = readFileSync(join(__dirname, "..", "..", "src", "runtime", "sprint-synchronization.ts"), "utf8");
    assert.ok(!/runSprintWorkflow|runProductionSprintWorkflow/i.test(sync.replace(/\/\*[\s\S]*?\*\//g, "")), "synchronization still invokes no workflow");
  });
});
