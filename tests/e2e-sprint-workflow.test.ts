import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FrameworkConfig } from "../src/config/schema";
import { AgentProvider } from "../src/providers/agent";
import { IssueRequest } from "../src/providers/issue";
import { createLocalIssueProvider } from "../src/providers/local-issue";
import {
  GitHubIssuesHttpRequest,
  GitHubIssuesHttpResponse,
} from "../src/providers/github-issues";
import { CoordinatorTicket } from "../src/runtime/coordinator";
import { TicketSink } from "../src/runtime/ticket-sink";
import {
  ProductionSprintResult,
  runProductionSprintWorkflow,
} from "../src/runtime/production-sprint";
import { runGitHubProductionSprintWorkflow } from "../src/runtime/github-production";
import {
  SprintCommandDeps,
  promptFinalDecision,
  promptPmDecision,
  promptTechnicalLeadDecision,
  runSprintCommand,
} from "../src/cli-sprint";
import { promptReviewDecision } from "../src/cli-run";

// End-to-end sprint verification (M19 E2E-005): the real
// stack — CLI parsing/assembly, production composition,
// orchestration, M18 boundaries — with only the edges
// faked (in-memory source, string agent, ExecutionResult
// role providers, issues, sink, explicit resolvers). No
// network, credentials, filesystem, scheduler, or
// parallelism anywhere.
//
// Live external smoke tests are intentionally absent: the
// repository has no safe live-test credential mechanism,
// and this ticket forbids inventing one (see the skipped
// placeholder at the end of this file).

const SECRET = "secret-token";
const TL_REPORT = "TL-REPORT-marker-approved-on-paper";
const PM_REPORT = "PM-REPORT-marker-changes-required-on-paper";
const IMPL_TEXT = "IMPL-text-marker";
const REVIEW_TEXT = "REVIEW-text-marker";

function ticket(id: string, state: CoordinatorTicket["state"] = "ready"): CoordinatorTicket {
  return { id, title: `Work ${id}`, description: `Description for ${id}.`, requirements: `Requirements for ${id}.`, state };
}

interface Harness {
  readonly events: string[];
  readonly sinkWrites: CoordinatorTicket[];
  readonly issueRequests: IssueRequest[];
  readonly tickets: CoordinatorTicket[];
  sourceCalls: number;
  sinkFailAt?: number;
  issuesFail?: boolean;
  reviewVerdict: "approved" | "changes_requested";
  tlVerdict: "approved" | "corrections-required";
  pmVerdict: "approved" | "changes-required";
  finalVerdict: "approved" | "changes-required";
}

function harness(tickets: CoordinatorTicket[]): Harness {
  const events: string[] = [];
  const sinkWrites: CoordinatorTicket[] = [];
  const issueRequests: IssueRequest[] = [];
  const state: Harness = {
    events,
    sinkWrites,
    issueRequests,
    tickets,
    sourceCalls: 0,
    reviewVerdict: "approved",
    tlVerdict: "approved",
    pmVerdict: "approved",
    finalVerdict: "approved",
  };
  return state;
}

function sprintInput(h: Harness) {
  return {
    ticketSource: {
      listTickets: async () => {
        h.sourceCalls += 1;
        h.events.push("source");
        return h.tickets;
      },
    },
    ticketSink: {
      updateTicket: async (entry: CoordinatorTicket) => {
        h.events.push("sink");
        if (h.sinkFailAt !== undefined && h.sinkWrites.length + 1 >= h.sinkFailAt) {
          throw new Error("sink offline");
        }
        h.sinkWrites.push(entry);
      },
    } as TicketSink,
    specialty: "backend" as const,
    openCodeAgent: {
      name: "fake-opencode",
      execute: async () => {
        h.events.push("agent");
        return h.events.filter((event) => event === "agent").length === 1 ? IMPL_TEXT : REVIEW_TEXT;
      },
    } as AgentProvider<string>,
    technicalLead: {
      role: "technical-lead" as const,
      provider: {
        name: "fake-tl",
        execute: async () => {
          h.events.push("technical-lead");
          return { status: "succeeded" as const, text: TL_REPORT };
        },
      },
    },
    projectManager: {
      role: "project-manager" as const,
      provider: {
        name: "fake-pm",
        execute: async () => {
          h.events.push("pm");
          return { status: "succeeded" as const, text: PM_REPORT };
        },
      },
    },
    coordinatorApproval: { role: "coordinator" as const },
    issues: {
      name: "fake-issues",
      create: async (request: IssueRequest) => {
        h.events.push("issues.create");
        if (h.issuesFail === true) {
          throw new Error("tracker down");
        }
        h.issueRequests.push(request);
        return { id: "C-7" };
      },
    },
    project_root: "/proj",
    timeout_ms: 5000,
    decideReview: async () => {
      h.events.push("decide-review");
      return h.reviewVerdict === "approved"
        ? { decision: "approved" as const }
        : { decision: "changes_requested" as const, feedback: "Rework wording." };
    },
    decideTechnicalLead: async () => {
      h.events.push("decide-tl");
      return h.tlVerdict === "approved"
        ? { decision: "approved" as const }
        : { decision: "corrections-required" as const, notes: "Split T-1 please." };
    },
    decidePmUserTesting: async () => {
      h.events.push("decide-pm");
      return h.pmVerdict === "approved"
        ? { decision: "approved" as const }
        : { decision: "changes-required" as const, notes: "Copy off please." };
    },
    decideFinalApproval: async () => {
      h.events.push("decide-final");
      return h.finalVerdict === "approved"
        ? { decision: "approved" as const }
        : { decision: "changes-required" as const, notes: "Hold please." };
    },
  };
}

function cliDeps(h: Harness, overrides: Partial<SprintCommandDeps> = {}): SprintCommandDeps & { productions: number } {
  const command = {
    productions: 0,
    projectRoot: "/proj",
    loadConfiguration: (): FrameworkConfig => ({
      version: 1,
      providers: { github: { enabled: true, owner: "acme", repo: "widgets", managedLabel: "ai-team", specialty: "backend" } as never },
    }),
    readToken: async () => SECRET,
    readReviewDecision: async () => ({ decision: "approved" as const }),
    readTechnicalLeadDecision: async () => ({ decision: "approved" as const }),
    readPmDecision: async () => ({ decision: "approved" as const }),
    readFinalDecision: async () => ({ decision: "approved" as const }),
    createAgent: (): AgentProvider<string> => ({
      name: "fake-opencode",
      execute: async (invocation) => {
        // The shared execution substrate stamps every stage
        // with its logical role (R-015), so one counter
        // proves exact stage order through real CLI assembly.
        h.events.push(`agent:${invocation.role ?? "unknown"}`);
        return "provider output";
      },
    }),
    createIssues: () => ({
      name: "fake-issues",
      create: async (request: IssueRequest) => {
        h.events.push("issues.create");
        if (h.issuesFail === true) {
          throw new Error("tracker down");
        }
        h.issueRequests.push(request);
        return { id: "C-7" };
      },
    }),
    runProduction: async (options: Parameters<SprintCommandDeps["runProduction"]>[0]): Promise<ProductionSprintResult> => {
      command.productions += 1;
      // The real generic production operation over the real
      // orchestration; only the source, sink, and issues are
      // test edges. Everything the CLI assembled (adapted
      // agent, stamped TL/PM references, resolvers) flows
      // through untouched.
      return runProductionSprintWorkflow({
        ticketSource: {
          listTickets: async () => {
            h.sourceCalls += 1;
            h.events.push("source");
            return h.tickets;
          },
        },
        ticketSink: {
          updateTicket: async (entry: CoordinatorTicket) => {
            h.events.push("sink");
            if (h.sinkFailAt !== undefined && h.sinkWrites.length + 1 >= h.sinkFailAt) {
              throw new Error("sink offline");
            }
            h.sinkWrites.push(entry);
          },
        } as TicketSink,
        specialty: options.specialty,
        openCodeAgent: options.openCodeAgent,
        technicalLead: options.technicalLead,
        projectManager: options.projectManager,
        coordinatorApproval: options.coordinatorApproval,
        issues: {
          name: "fake-issues",
          create: async (request: IssueRequest) => {
            h.events.push("issues.create");
            if (h.issuesFail === true) {
              throw new Error("tracker down");
            }
            h.issueRequests.push(request);
            return { id: "C-7" };
          },
        },
        project_root: options.project_root,
        timeout_ms: options.timeout_ms,
        decideReview: options.decideReview,
        decideTechnicalLead: options.decideTechnicalLead,
        decidePmUserTesting: options.decidePmUserTesting,
        decideFinalApproval: options.decideFinalApproval,
      });
    },
    ...overrides,
  };
  return command;
}

function sprintArgv(decisions: { review?: string; tl?: string; pm?: string; final?: string } = {}): string[] {
  const argv = ["sprint"];
  if (decisions.review !== undefined) {
    argv.push("--review-decision", decisions.review);
    if (decisions.review === "changes_requested") {
      argv.push("--review-feedback", "Rework wording.");
    }
  }
  if (decisions.tl !== undefined) {
    argv.push("--tl-decision", decisions.tl);
    if (decisions.tl !== "approved") {
      argv.push("--tl-notes", "Split T-1 please.");
    }
  }
  if (decisions.pm !== undefined) {
    argv.push("--pm-decision", decisions.pm);
    if (decisions.pm !== "approved") {
      argv.push("--pm-notes", "Copy off please.");
    }
  }
  if (decisions.final !== undefined) {
    argv.push("--final-decision", decisions.final);
    if (decisions.final !== "approved") {
      argv.push("--final-notes", "Hold please.");
    }
  }
  return argv;
}

function cleanOutput(result: { stdout: string; stderr: string }): string {
  return `${result.stdout}\n${result.stderr}`;
}

describe("e2e scenario 1 — full successful sprint through the CLI", () => {
  it("traverses every stage in order and synchronizes once", async () => {
    const h = harness([ticket("T-1")]);
    const command = cliDeps(h);
    const result = await runSprintCommand(command, sprintArgv({ review: "approved", tl: "approved", pm: "approved", final: "approved" }));
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "sprint synchronized: tickets T-1 approved; closed T-1.\n");
    assert.deepEqual(h.events, [
      "source",
      "agent:implementer",
      "agent:senior-reviewer",
      "agent:technical-lead",
      "agent:project-manager",
      "sink",
    ], "source → Coordinator (Implementer, Reviewer) → TL → PM → final decision → sink");
    assert.equal(h.sourceCalls, 1, "one source read");
    assert.equal(command.productions, 1, "one production traversal, no re-entry");
    assert.equal(h.sinkWrites.length, 1, "one synchronization operation");
    assert.deepEqual([h.sinkWrites[0].id, h.sinkWrites[0].state], ["T-1", "closed"], "eligible ticket closed through the sink");
    assert.ok(Object.isFrozen(h.sinkWrites[0]), "defensive frozen copy at the sink");
    assert.deepEqual(
      h.tickets.map(({ state, ...rest }) => rest),
      [ticket("T-1")].map(({ state, ...rest }) => rest),
      "only the Coordinator-selected state advanced",
    );
    assert.equal(h.tickets[0].state, "technical_approval", "original never closed by any stage");
    const output = cleanOutput(result);
    assert.ok(!output.includes(TL_REPORT) && !output.includes(PM_REPORT), "no agent report dumped");
    assert.ok(!output.includes(IMPL_TEXT) && !output.includes(REVIEW_TEXT), "no provider text dumped");
    assert.ok(!output.includes(SECRET), "no credential in output");
  });
});

describe("e2e scenario 2 — Coordinator controlled rework", () => {
  it("stops after changes_requested and leaves re-entry to the caller", async () => {
    const h = harness([ticket("T-1"), ticket("T-2")]);
    h.reviewVerdict = "changes_requested";
    const result = await runProductionSprintWorkflow(sprintInput(h));
    assert.equal(result.outcome, "workflow-not-completed");
    assert.ok(result.outcome === "workflow-not-completed" && result.workflow.outcome === "work-remaining");
    assert.deepEqual(h.events, ["source", "agent", "agent", "decide-review"], "traversal stops at the sprint gate");
    assert.equal(h.tickets[1].state, "ready", "second ticket untouched");
    assert.equal(h.sinkWrites.length, 0, "no synchronization");
    // Explicit caller re-entry: the caller persists the
    // result's feedback onto the ticket (the runtime never
    // writes it — Coordinator contract), then invokes again.
    // R-002 rework priority must now choose T-1 over ready
    // T-2, still exactly one ticket.
    h.tickets[0].feedback = "Rework wording.";
    h.reviewVerdict = "approved";
    const again = await runProductionSprintWorkflow(sprintInput(h));
    assert.equal(again.outcome, "workflow-not-completed", "T-2 still ready: still work remaining");
    assert.equal(h.events.filter((event) => event === "agent").length, 4, "exactly one more Coordinator ticket, no drain");
    assert.equal(h.tickets[0].state, "technical_approval", "R-002 rework priority: T-1 selected over ready T-2");
    assert.equal(h.tickets[1].state, "ready", "second ticket never processed implicitly");
  });
});

describe("e2e scenarios 3+4 — Technical Lead corrections", () => {
  it("creates exactly one correction and stops with the reference reported", async () => {
    const h = harness([ticket("T-1")]);
    const command = cliDeps(h);
    const result = await runSprintCommand(command, sprintArgv({ review: "approved", tl: "corrections-required" }));
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /sprint corrections-required: correction C-7 created; no further stages ran/);
    assert.deepEqual(h.events, ["source", "agent:implementer", "agent:senior-reviewer", "agent:technical-lead", "issues.create"]);
    assert.equal(h.issueRequests.length, 1, "exactly one R-018 creation attempt");
    assert.ok(JSON.stringify(h.issueRequests[0]).includes("Split T-1 please."), "notes preserved verbatim");
    assert.ok(JSON.stringify(h.issueRequests[0]).includes("T-1"), "affected IDs preserved exactly");
    assert.equal(h.tickets.length, 1, "reference never becomes a Coordinator ticket");
    assert.equal(h.sinkWrites.length, 0, "no synchronization");
    assert.equal(command.productions, 1, "no automatic re-entry");
  });

  it("correction creation failure is bounded with no retry and no fabricated reference", async () => {
    const h = harness([ticket("T-1")]);
    h.tlVerdict = "corrections-required";
    h.issuesFail = true;
    const result = await runProductionSprintWorkflow(sprintInput(h));
    assert.equal(result.outcome, "workflow-not-completed");
    assert.ok(result.outcome === "workflow-not-completed" && result.workflow.outcome === "correction-creation-failed");
    assert.ok(
      result.outcome === "workflow-not-completed" &&
        result.workflow.outcome === "correction-creation-failed" &&
        result.workflow.correction.outcome === "creation-failed" &&
        result.workflow.correction.error.message === "tracker down",
      "bounded diagnostic preserved",
    );
    assert.deepEqual(h.events, ["source", "agent", "agent", "decide-review", "technical-lead", "decide-tl", "issues.create"]);
    assert.equal(h.sinkWrites.length, 0, "no sink on correction failure");
  });
});

describe("e2e scenarios 5+6 — PM and final rejections", () => {
  it("PM changes-required stops before final approval", async () => {
    const h = harness([ticket("T-1")]);
    const command = cliDeps(h);
    const result = await runSprintCommand(command, sprintArgv({ review: "approved", tl: "approved", pm: "changes-required" }));
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /sprint pm-changes-required: tickets T-1: Copy off please\.; no final approval ran/);
    assert.deepEqual(h.events, ["source", "agent:implementer", "agent:senior-reviewer", "agent:technical-lead", "agent:project-manager"]);
    assert.ok(!h.events.includes("decide-final"), "final approval not invoked");
    assert.equal(h.sinkWrites.length, 0, "no synchronization");
    assert.equal(JSON.stringify(h.tickets.map(({ state, ...rest }) => rest)), JSON.stringify([ticket("T-1")].map(({ state, ...rest }) => rest)), "no ticket mutation beyond the Coordinator-selected state");
    assert.ok(!cleanOutput(result).includes(PM_REPORT), "report remains opaque");
  });

  it("final changes-required synchronizes nothing", async () => {
    const h = harness([ticket("T-1")]);
    const command = cliDeps(h);
    const result = await runSprintCommand(command, sprintArgv({ review: "approved", tl: "approved", pm: "approved", final: "changes-required" }));
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /sprint final-approval-rejected: tickets T-1: Hold please\.; nothing synchronized/);
    assert.deepEqual(h.events, ["source", "agent:implementer", "agent:senior-reviewer", "agent:technical-lead", "agent:project-manager"]);
    assert.equal(h.sinkWrites.length, 0, "no TicketSink call");
    assert.equal(command.productions, 1, "no automatic re-entry");
  });
});

describe("e2e scenarios 7+8 — synchronization", () => {
  it("eligible tickets close in order through frozen copies", async () => {
    const h = harness([ticket("T-1"), ticket("T-2", "technical_approval")]);
    const result = await runProductionSprintWorkflow(sprintInput(h));
    assert.equal(result.outcome, "workflow-completed-and-synchronized");
    assert.deepEqual(h.sinkWrites.map((entry) => [entry.id, entry.state]), [["T-1", "closed"], ["T-2", "closed"]], "caller order preserved");
    assert.ok(h.sinkWrites.every((entry) => Object.isFrozen(entry)), "defensive frozen copies");
    assert.deepEqual(
      h.sinkWrites.map(({ state, ...rest }) => rest),
      [ticket("T-1"), ticket("T-2", "technical_approval")].map(({ state, ...rest }) => rest),
      "all other ticket data preserved",
    );
    assert.equal(JSON.stringify(h.tickets.map(({ state }) => state)), JSON.stringify(["technical_approval", "technical_approval"]), "originals untouched by synchronization");
    assert.ok(
      result.outcome === "workflow-completed-and-synchronized" &&
        result.synchronization.outcome === "synchronized" &&
        result.synchronization.synchronizedIds.join(",") === "T-1,T-2",
      "output distinguishes successful synchronization",
    );
  });

  it("partial sink failure exposes the prefix with no retry, rollback, or rerun", async () => {
    const h = harness([ticket("T-1"), ticket("T-2", "technical_approval")]);
    h.sinkFailAt = 2;
    const command = cliDeps(h);
    const result = await runSprintCommand(command, sprintArgv({ review: "approved", tl: "approved", pm: "approved", final: "approved" }));
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /sprint sync-failed: tickets T-1, T-2 approved but synchronization failed \(ticket-synchronization-failed\): sink offline/);
    assert.ok(!result.stderr.includes("synchronized:"), "never mistaken for success");
    assert.deepEqual(h.sinkWrites.map((entry) => [entry.id, entry.state]), [["T-1", "closed"]], "successful prefix observable: first ticket synchronized");
    assert.equal(h.events.filter((event) => event === "sink").length, 2, "first succeeded, second failed, third never attempted");
    assert.equal(h.events.filter((event) => event.startsWith("agent:")).length, 4, "workflow never rerun");
    assert.equal(h.sourceCalls, 1, "source never reread");
    assert.equal(command.productions, 1, "no re-entry after sync failure");
  });
});

describe("e2e scenarios 9+10 — source and dependency failures", () => {
  it("source failure invokes nothing and exits non-success", async () => {
    const h = harness([ticket("T-1")]);
    const input = sprintInput(h);
    const result = await runProductionSprintWorkflow({
      ...input,
      ticketSource: {
        listTickets: async () => {
          h.sourceCalls += 1;
          throw new Error("tracker down");
        },
      },
    });
    assert.equal(result.outcome, "source-failed");
    assert.deepEqual(h.events, [], "zero workflow, stage, sink, or correction calls");
    assert.equal(h.sourceCalls, 1, "attempted once, never retried");
  });

  it("dependency failures occur before external execution with bounded CLI errors", async () => {
    const h = harness([ticket("T-1")]);
    const badSpecialty = await runSprintCommand(
      cliDeps(h, { loadConfiguration: () => ({ version: 1, providers: { github: { enabled: true, owner: "a", repo: "w", managedLabel: "ai-team", specialty: "design" } as never } }) }),
      sprintArgv({ review: "approved" }),
    );
    assert.equal(badSpecialty.exitCode, 1);
    assert.match(badSpecialty.stderr, /specialty is required/);
    const noToken = await runSprintCommand(cliDeps(h, { readToken: async () => "" }), sprintArgv({ review: "approved" }));
    assert.equal(noToken.exitCode, 1);
    assert.match(noToken.stderr, /non-empty GitHub token/);
    const badCombo = await runSprintCommand(cliDeps(h), ["sprint", "--pm-decision", "corrections-required"]);
    assert.equal(badCombo.exitCode, 1);
    assert.match(badCombo.stderr, /unknown verdict/);
    assert.equal(h.sourceCalls, 0, "no source read on any dependency failure");
    assert.equal(h.events.length, 0, "no workflow, sink, or correction calls");
    assert.ok(!cleanOutput(badSpecialty).includes(SECRET) && !cleanOutput(noToken).includes(SECRET), "credentials never printed");
    await assert.rejects(
      runGitHubProductionSprintWorkflow({
        config: { version: 1, providers: { github: { enabled: false, owner: "a", repo: "w" } } },
        token: SECRET,
        managedLabel: "ai-team",
        specialty: "backend",
        openCodeAgent: { name: "x", execute: async () => "x" },
        technicalLead: { role: "technical-lead", provider: { name: "x", execute: async () => ({ status: "succeeded", text: "x" }) } },
        projectManager: { role: "project-manager", provider: { name: "x", execute: async () => ({ status: "succeeded", text: "x" }) } },
        coordinatorApproval: { role: "coordinator" },
        issues: createLocalIssueProvider(),
        project_root: "/proj",
        timeout_ms: 5000,
        decideReview: async () => ({ decision: "approved" }),
        decideTechnicalLead: async () => ({ decision: "approved" }),
        decidePmUserTesting: async () => ({ decision: "approved" }),
        decideFinalApproval: async () => ({ decision: "approved" }),
      }),
      /providers\.github\.enabled must be true/,
      "disabled GitHub path never activates",
    );
  });
});

describe("e2e scenario 11 — explicit decision plumbing", () => {
  it("each decision reaches only its intended resolver with verbatim notes", async () => {
    const h = harness([ticket("T-1")]);
    const seen: Record<string, unknown[]> = { review: [], tl: [], pm: [], final: [] };
    let productions = 0;
    const command = cliDeps(h, {
      runProduction: async (options: Parameters<SprintCommandDeps["runProduction"]>[0]): Promise<ProductionSprintResult> => {
        productions += 1;
        const input = sprintInput(h);
        return runProductionSprintWorkflow({
          ...input,
          openCodeAgent: options.openCodeAgent,
          technicalLead: options.technicalLead,
          projectManager: options.projectManager,
          coordinatorApproval: options.coordinatorApproval,
          decideReview: async (request) => {
            seen.review.push(request);
            return options.decideReview(request);
          },
          decideTechnicalLead: async (request) => {
            seen.tl.push(request);
            return options.decideTechnicalLead(request);
          },
          decidePmUserTesting: async (request) => {
            seen.pm.push(request);
            return options.decidePmUserTesting(request);
          },
          decideFinalApproval: async (request) => {
            seen.final.push(request);
            return options.decideFinalApproval(request);
          },
        });
      },
    });
    const result = await runSprintCommand(
      command,
      sprintArgv({ review: "approved", tl: "corrections-required", pm: "approved", final: "approved" }),
    );
    assert.equal(result.exitCode, 1, "TL corrections stop the traversal");
    assert.equal(seen.review.length, 1, "review resolved once, from its own flag");
    assert.equal(seen.tl.length, 1, "TL resolved once, from its own flag");
    assert.equal(seen.pm.length, 0, "PM never reached after corrections");
    assert.equal(seen.final.length, 0, "final never reached after corrections");
    assert.match(result.stderr, /correction C-7 created/, "TL verdict took effect where intended");
    assert.equal(productions, 1, "one production traversal, no re-entry");
  });
});

describe("e2e scenario 12 — interactive safety without a TTY", () => {
  it("real prompts fail safely through the real composition", { skip: process.stdin.isTTY === true }, async () => {
    const h = harness([ticket("T-1")]);
    const input = sprintInput(h);
    const result = await runProductionSprintWorkflow({
      ...input,
      decideReview: promptReviewDecision,
      decideTechnicalLead: promptTechnicalLeadDecision,
      decidePmUserTesting: promptPmDecision,
      decideFinalApproval: promptFinalDecision,
    });
    assert.equal(result.outcome, "workflow-failed", "first human gate refuses to auto-approve");
    assert.ok(
      result.outcome === "workflow-failed" &&
        result.workflow.outcome === "failed" &&
        result.workflow.coordinator.outcome === "decision-failed",
      "bounded decision failure, nothing fabricated",
    );
    assert.deepEqual(h.events, ["source", "agent", "agent"], "no TL, PM, final, sink, or correction calls");
    assert.equal(h.sinkWrites.length, 0, "no synchronization");
    assert.equal(h.tickets[0].state, "implementation_review", "Coordinator stopped at its own bounded state; nothing approved or closed");
  });
});

describe("e2e scenario 13 — ai-team run compatibility", () => {
  it("run and sprint route to their own commands with no crossover", async () => {
    const h = harness([ticket("T-1")]);
    const notSprint = await runSprintCommand(cliDeps(h), ["run"]);
    assert.equal(notSprint.exitCode, 1);
    assert.match(notSprint.stderr, /usage: ai-team sprint/, "sprint never claims run argv");
    const entry = readFileSync(join(__dirname, "..", "..", "src", "index.ts"), "utf8");
    assert.ok(/argv\[0\] === "run"/.test(entry), "run routing preserved");
    assert.ok(/argv\[0\] === "sprint"/.test(entry), "sprint routing separate");
    const runSource = readFileSync(join(__dirname, "..", "..", "src", "cli-run.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/sprint/i.test(runSource.replace(/never.*sprint|sprint.*never|a sprint/gi, "")), "run owns no sprint stages or semantics");
    const sprintSource = readFileSync(join(__dirname, "..", "..", "src", "cli-sprint.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/runProductionCoordinator|runGitHubProductionCoordinator/i.test(sprintSource), "sprint never enters the ticket-level path");
  });
});

describe("e2e scenario 14 — GitHub production composition over a fake transport", () => {
  it("reads, corrects, and synchronizes through the real adapters", async () => {
    const seen: GitHubIssuesHttpRequest[] = [];
    const bodies: unknown[] = [];
    const issueBody = (number: number): Record<string, unknown> => ({
      number,
      title: `Work ${String(number)}`,
      body: `Description for ${String(number)}.\n\n## Requirements\n\nRequirements for ${String(number)}.`,
      state: "open",
      labels: ["ai-team", "priority:high"],
    });
    const transport = async (request: GitHubIssuesHttpRequest): Promise<GitHubIssuesHttpResponse> => {
      seen.push(request);
      bodies.push(request.body !== undefined ? JSON.parse(String(request.body)) : undefined);
      if (request.method === "GET" && request.url.includes("/issues?")) {
        return { status: 200, body: [issueBody(7)] };
      }
      if (request.method === "GET") {
        return { status: 200, body: { number: 7, labels: ["ai-team", "priority:high"] } };
      }
      return { status: 200, body: { number: 7, labels: ["ai-team", "ai-team:closed", "priority:high"] } };
    };
    const agentCalls: string[] = [];
    const result = await runGitHubProductionSprintWorkflow({
      config: { version: 1, providers: { github: { enabled: true, owner: "acme", repo: "widgets" } } },
      token: SECRET,
      managedLabel: "ai-team",
      transport,
      specialty: "backend",
      openCodeAgent: {
        name: "fake-opencode",
        execute: async () => {
          agentCalls.push("agent");
          return "provider output";
        },
      },
      technicalLead: {
        role: "technical-lead",
        provider: { name: "fake-tl", execute: async () => ({ status: "succeeded", text: "TL: coherent." }) },
      },
      projectManager: {
        role: "project-manager",
        provider: { name: "fake-pm", execute: async () => ({ status: "succeeded", text: "PM: matches." }) },
      },
      coordinatorApproval: { role: "coordinator" },
      issues: createLocalIssueProvider(),
      project_root: "/proj",
      timeout_ms: 5000,
      decideReview: async () => ({ decision: "approved" }),
      decideTechnicalLead: async () => ({ decision: "approved" }),
      decidePmUserTesting: async () => ({ decision: "approved" }),
      decideFinalApproval: async () => ({ decision: "approved" }),
    });
    assert.equal(result.outcome, "workflow-completed-and-synchronized");
    assert.ok(
      result.outcome === "workflow-completed-and-synchronized" &&
        result.workflow.ticket_ids.join(",") === "7" &&
        result.synchronization.synchronizedIds.join(",") === "7",
      "GitHub issue 7 read, traversed, and closed",
    );
    assert.deepEqual(agentCalls, ["agent", "agent"], "one Coordinator ticket through the real runtime");
    const methods = seen.map((request) => request.method);
    assert.deepEqual(methods, ["GET", "GET", "PATCH"], "list once, fetch once, update once");
    const patch = bodies[2] as Record<string, unknown>;
    assert.deepEqual(patch.labels, ["ai-team", "priority:high", "ai-team:closed"], "managed state label added, unrelated labels preserved");
    assert.equal(patch.state, "closed", "terminal state mapped by the existing adapter");
  });
});

describe("e2e report opacity through the production path", () => {
  it("misleading report words never change routing", async () => {
    const h = harness([ticket("T-1")]);
    const input = sprintInput(h);
    h.tlVerdict = "corrections-required";
    const corrected = await runProductionSprintWorkflow({
      ...input,
      technicalLead: {
        role: "technical-lead",
        provider: { name: "fake-tl", execute: async () => ({ status: "succeeded" as const, text: "explicitly approved, no corrections needed" }) },
      },
    });
    assert.equal(corrected.outcome, "workflow-not-completed");
    assert.ok(corrected.outcome === "workflow-not-completed" && corrected.workflow.outcome === "technical-lead-corrections-required", "the word approved in the report approves nothing");

    const h2 = harness([ticket("T-1")]);
    const input2 = sprintInput(h2);
    const approved = await runProductionSprintWorkflow({
      ...input2,
      projectManager: {
        role: "project-manager",
        provider: { name: "fake-pm", execute: async () => ({ status: "succeeded" as const, text: "changes-required everywhere, reject this" }) },
      },
    });
    assert.equal(approved.outcome, "workflow-completed-and-synchronized", "the words changes-required in the report reject nothing");
  });
});

describe("e2e result propagation", () => {
  it("every terminal condition survives the stack with its diagnostics", async () => {
    const table: Array<[() => Harness, string, RegExp]> = [
      [() => { const h = harness([ticket("T-1")]); h.reviewVerdict = "changes_requested"; return h; }, "workflow-not-completed", /work-remaining/],
      [() => { const h = harness([ticket("T-1")]); h.tlVerdict = "corrections-required"; return h; }, "workflow-not-completed", /corrections-required/],
      [() => { const h = harness([ticket("T-1")]); h.pmVerdict = "changes-required"; return h; }, "workflow-not-completed", /pm-changes-required/],
      [() => { const h = harness([ticket("T-1")]); h.finalVerdict = "changes-required"; return h; }, "workflow-not-completed", /final-approval-rejected/],
      [() => { const h = harness([ticket("T-1"), ticket("T-2", "technical_approval")]); h.sinkFailAt = 1; return h; }, "workflow-completed-sync-failed", /sync-failed/],
      [() => harness([ticket("T-1")]), "workflow-completed-and-synchronized", /synchronized/],
    ];
    for (const [make, outcome, pattern] of table) {
      const h = make();
      const result = await runProductionSprintWorkflow(sprintInput(h));
      assert.equal(result.outcome, outcome);
      assert.match(JSON.stringify(result), pattern, `${outcome}: meaning preserved, nothing fabricated`);
    }
    const failing: Harness = harness([ticket("T-1")]);
    const failingInput = sprintInput(failing);
    const sourceFailed = await runProductionSprintWorkflow({
      ...failingInput,
      ticketSource: { listTickets: async () => { throw new Error("tracker down"); } },
    });
    assert.equal(sourceFailed.outcome, "source-failed");
    assert.match(JSON.stringify(sourceFailed), /tracker down/);
  });
});

describe("e2e configuration isolation and architecture", () => {
  it("generic runtime reads no configuration and M19 adds no config namespace", () => {
    const runtimeDir = join(__dirname, "..", "..", "src", "runtime");
    for (const file of readdirSync(runtimeDir)) {
      if (!file.endsWith(".ts")) {
        continue;
      }
      const code = readFileSync(join(runtimeDir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      if (file === "github-production.ts") {
        assert.ok(/FrameworkConfig/.test(code), "only the GitHub composition reads validated configuration");
        continue;
      }
      assert.ok(!/config\/schema|config\/loader|config\/validator|FrameworkConfig|process\.env/i.test(code), `${file}: no configuration access`);
      assert.ok(!/providers\/github|providers\/delegate|providers\/speckit|octokit|graphql/i.test(code), `${file}: no provider-specific imports`);
    }
    const schema = readFileSync(join(__dirname, "..", "..", "src", "config", "schema.ts"), "utf8");
    assert.ok(!/^\s*sprint\??:/m.test(schema), "no M19 config namespace (the pre-existing deferred ApprovalAfter value is untouched)");
  });

  it("ownership stays layered: composition, orchestration, persistence, delegation", () => {
    const read = (file: string): string =>
      readFileSync(join(__dirname, "..", "..", "src", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const composition = read("runtime/production-sprint.ts");
    for (const callee of ["runSprintWorkflow", "synchronizeSprintOutcome"]) {
      assert.equal((composition.match(new RegExp(callee, "g")) ?? []).length, 2, `${callee}: one import plus one call site — called, never reimplemented`);
    }
    assert.ok(!/TicketSink|updateTicket/.test(read("runtime/sprint-workflow.ts")), "orchestration owns no persistence");
    assert.ok(!/runSprintWorkflow|runCoordinatorTicket/.test(read("runtime/sprint-synchronization.ts")), "synchronization invokes no workflow");
    assert.ok(/createTechnicalLeadCorrectionTicket/.test(read("runtime/sprint-workflow.ts")), "correction creation stays delegated to R-018");
    assert.ok(/runPmUserTestingReview/.test(read("runtime/sprint-workflow.ts")), "PM review stays delegated to R-019");
    assert.ok(/runFinalApproval/.test(read("runtime/sprint-workflow.ts")), "final approval stays delegated to R-020");
    assert.ok(!/runCoordinatorTicket|runTechnicalLeadReview|runPmUserTestingReview|runFinalApproval|createTechnicalLeadCorrectionTicket/.test(read("cli-sprint.ts")), "CLI calls no runtime stage directly");
  });
});

describe("e2e live smoke test (opt-in only)", () => {
  it("live external verification is intentionally absent", { skip: true }, async () => {
    // The repository provides no safe live-test credential
    // mechanism (no test vault, no scoped test target, no
    // opt-in harness), and E2E-005 forbids inventing a
    // credential-management system for this ticket. The
    // deterministic fake-transport GitHub test above is the
    // standing integration proof; revisit only when a safe
    // explicit-target mechanism exists.
  });
});
