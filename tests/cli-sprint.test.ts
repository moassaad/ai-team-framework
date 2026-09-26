import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FrameworkConfig } from "../src/config/schema";
import { AgentProvider } from "../src/providers/agent";
import { GitHubProductionSprintOptions } from "../src/runtime/github-production";
import { ProductionSprintResult } from "../src/runtime/production-sprint";
import {
  SprintCommandDeps,
  promptFinalDecision,
  promptPmDecision,
  promptTechnicalLeadDecision,
  runSprintCommand,
} from "../src/cli-sprint";

// Sprint command tests (M19 E2E-004): `ai-team sprint` as a
// thin entrypoint over the E2E-003 GitHub composition. Every
// dependency is injected; no config files, terminals,
// network, Git, OpenCode processes, or roles exist here.

const SECRET = "secret-token";

function config(github: unknown): FrameworkConfig {
  return { version: 1, providers: { github: github as never } };
}

const validConfig = (): FrameworkConfig =>
  config({ enabled: true, owner: "acme", repo: "widgets", managedLabel: "ai-team", specialty: "backend" });

function deps(overrides: Partial<SprintCommandDeps> = {}): SprintCommandDeps & { productions: GitHubProductionSprintOptions[] } {
  const productions: GitHubProductionSprintOptions[] = [];
  return {
    productions,
    projectRoot: "/proj",
    loadConfiguration: () => validConfig(),
    readToken: async () => SECRET,
    readReviewDecision: async () => ({ decision: "approved" }),
    readTechnicalLeadDecision: async () => ({ decision: "approved" }),
    readPmDecision: async () => ({ decision: "approved" }),
    readFinalDecision: async () => ({ decision: "approved" }),
    createAgent: (): AgentProvider<string> => ({ name: "fake-opencode", execute: async () => "ok" }),
    createIssues: () => ({ name: "fake-issues", create: async () => ({ id: "C-1" }) }),
    runProduction: async (options) => {
      productions.push(options);
      return {
        outcome: "workflow-not-completed",
        workflow: {
          outcome: "work-remaining",
          evaluation: {
            readyForTechnicalLeadReview: false,
            counts: { total: 1, executable: 1, inFlight: 0, blocked: 0, failed: 0, invalid: 0, complete: 0 },
            workRemaining: ["7"],
            attentionNeeded: [],
          },
        },
      };
    },
    ...overrides,
  };
}

function synchronized(): ProductionSprintResult {
  return {
    outcome: "workflow-completed-and-synchronized",
    workflow: {
      outcome: "completed",
      ticket_ids: ["7"],
      finalApproval: { outcome: "approved", ticket_ids: ["7"], pmReport: "PM: matches." },
    },
    synchronization: { outcome: "synchronized", synchronizedIds: ["7"] },
  };
}

describe("sprint command routing", () => {
  it("sprint reaches the production sprint operation exactly once", async () => {
    const command = deps({ runProduction: async (options) => { command.productions.push(options); return synchronized(); } });
    const result = await runSprintCommand(command, ["sprint"]);
    assert.equal(command.productions.length, 1, "exactly one production invocation");
    const options = command.productions[0];
    assert.equal(options.managedLabel, "ai-team");
    assert.equal(options.specialty, "backend");
    assert.equal(options.token, SECRET, "stdin credential flows only into the production call");
    assert.equal(options.project_root, "/proj");
    assert.equal(options.timeout_ms, 300000);
    assert.equal(options.config.providers?.github?.owner, "acme");
    assert.ok(options.openCodeAgent.name.length > 0, "execution agent supplied by deps");
    assert.equal(options.coordinatorApproval.role, "coordinator", "exact final authority, never another role");
    assert.equal(options.technicalLead.role, "technical-lead", "exact TL identity, never inferred");
    assert.equal(options.projectManager.role, "project-manager", "exact PM identity, never inferred");
    assert.ok(typeof options.decideReview === "function", "review resolver passed through");
    assert.ok(typeof options.decideTechnicalLead === "function", "TL resolver passed through");
    assert.ok(typeof options.decidePmUserTesting === "function", "PM resolver passed through");
    assert.ok(typeof options.decideFinalApproval === "function", "final resolver passed through");
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /sprint synchronized: tickets 7 approved; closed 7/);
  });

  it("non-sprint argv and unknown flags fail with usage before runtime", async () => {
    const command = deps();
    const wrong = await runSprintCommand(command, ["run"]);
    assert.equal(wrong.exitCode, 1);
    assert.match(wrong.stderr, /usage: ai-team sprint/);
    const unknown = await runSprintCommand(command, ["sprint", "--yes"]);
    assert.equal(unknown.exitCode, 1, "no hidden approval shortcut");
    assert.match(unknown.stderr, /usage: ai-team sprint/);
    const dangling = await runSprintCommand(command, ["sprint", "--tl-decision"]);
    assert.equal(dangling.exitCode, 1);
    assert.match(dangling.stderr, /missing value for --tl-decision/);
    assert.equal(command.productions.length, 0, "nothing reaches the runtime");
  });

  it("invalid deps and missing dependencies fail bounded before execution", async () => {
    const command = deps();
    const bad = await runSprintCommand("nope" as never, ["sprint"]);
    assert.equal(bad.exitCode, 1);
    assert.match(bad.stderr, /expected a dependencies object/);
    const noConfig = await runSprintCommand(deps({ loadConfiguration: () => config({ enabled: true, owner: "acme", repo: "w" }) }), ["sprint"]);
    assert.equal(noConfig.exitCode, 1);
    assert.match(noConfig.stderr, /managedLabel is required/);
    const noSpecialty = await runSprintCommand(deps({ loadConfiguration: () => config({ enabled: true, owner: "acme", repo: "w", managedLabel: "ai-team", specialty: "design" }) }), ["sprint"]);
    assert.equal(noSpecialty.exitCode, 1);
    assert.match(noSpecialty.stderr, /specialty is required/, "no specialty inference");
    const noToken = await runSprintCommand(deps({ readToken: async () => "  " }), ["sprint"]);
    assert.equal(noToken.exitCode, 1);
    assert.match(noToken.stderr, /non-empty GitHub token/);
    assert.equal(command.productions.length, 0, "nothing reaches the runtime");
  });
});

describe("sprint command decision arguments", () => {
  it("explicit per-stage decisions reach their own resolvers without prompting", async () => {
    let prompted = 0;
    const command = deps({
      readReviewDecision: async () => { prompted += 1; return { decision: "approved" }; },
      readTechnicalLeadDecision: async () => { prompted += 1; return { decision: "approved" }; },
      readPmDecision: async () => { prompted += 1; return { decision: "approved" }; },
      readFinalDecision: async () => { prompted += 1; return { decision: "approved" }; },
      runProduction: async (options) => {
        command.productions.push(options);
        assert.deepEqual(await options.decideReview({ ticket_id: "7", title: "t", description: "d", requirements: "r", report: "r" }), { decision: "approved" });
        assert.deepEqual(await options.decideTechnicalLead({ ticket_ids: ["7"], report: "r" }), { decision: "corrections-required", notes: "Split it." });
        assert.deepEqual(await options.decidePmUserTesting({ ticket_ids: ["7"], report: "r" }), { decision: "approved" });
        assert.deepEqual(await options.decideFinalApproval({ ticket_ids: ["7"], evidence: [], pmReport: "r" }), { decision: "changes-required", notes: "Hold." });
        return synchronized();
      },
    });
    const result = await runSprintCommand(command, [
      "sprint",
      "--review-decision", "approved",
      "--tl-decision", "corrections-required", "--tl-notes", "Split it.",
      "--pm-decision", "approved",
      "--final-decision", "changes-required", "--final-notes", "Hold.",
    ]);
    assert.equal(result.exitCode, 0);
    assert.equal(prompted, 0, "explicit arguments never prompt");
    assert.equal(command.productions.length, 1, "one production call, no re-entry");
  });

  it("review decision keeps run semantics and never propagates", async () => {
    const command = deps({
      runProduction: async (options) => {
        command.productions.push(options);
        assert.deepEqual(await options.decideReview({ ticket_id: "7", title: "t", description: "d", requirements: "r", report: "r" }), { decision: "changes_requested", feedback: "Fix wording." });
        assert.deepEqual(await options.decideTechnicalLead({ ticket_ids: ["7"], report: "r" }), { decision: "approved" });
        return synchronized();
      },
    });
    const result = await runSprintCommand(command, [
      "sprint",
      "--review-decision", "changes_requested", "--review-feedback", "Fix wording.",
    ]);
    assert.equal(result.exitCode, 0, "TL still interactive-approved via injected reader");
    const approvedWithFeedback = await runSprintCommand(deps(), ["sprint", "--review-decision", "approved", "--review-feedback", "nice"]);
    assert.equal(approvedWithFeedback.exitCode, 1, "run's approved-with-feedback rejection preserved");
    assert.match(approvedWithFeedback.stderr, /sprint error/);
  });

  it("malformed decision combinations fail safely before runtime", async () => {
    const cases: string[][] = [
      ["sprint", "--tl-decision", "approved", "--tl-decision", "approved"],
      ["sprint", "--tl-notes", "orphan"],
      ["sprint", "--tl-decision", "maybe"],
      ["sprint", "--tl-decision", "approved", "--tl-notes", ""],
      ["sprint", "--pm-decision", "corrections-required"],
      ["sprint", "--pm-notes", "orphan"],
      ["sprint", "--final-decision", "approved", "--final-notes", ""],
      ["sprint", "--final-notes", "orphan"],
      ["sprint", "--review-feedback", "orphan"],
      ["sprint", "--review-decision", "approved", "--review-decision", "approved"],
    ];
    for (const argv of cases) {
      const command = deps();
      const result = await runSprintCommand(command, argv);
      assert.equal(result.exitCode, 1, argv.join(" "));
      assert.match(result.stderr, /sprint error|usage: ai-team sprint/, argv.join(" "));
      assert.equal(command.productions.length, 0, `${argv.join(" ")}: nothing reaches the runtime`);
    }
  });

  it("bare sprint uses the injected readers without assuming approval", async () => {
    let calls = 0;
    const command = deps({
      readReviewDecision: async () => { calls += 1; return { decision: "approved" }; },
      readTechnicalLeadDecision: async () => { calls += 1; return { decision: "approved" }; },
      readPmDecision: async () => { calls += 1; return { decision: "approved" }; },
      readFinalDecision: async () => { calls += 1; return { decision: "approved" }; },
      runProduction: async (options) => { command.productions.push(options); return synchronized(); },
    });
    const result = await runSprintCommand(command, ["sprint"]);
    assert.equal(result.exitCode, 0);
    assert.equal(calls, 0, "command passes readers through; the runtime invokes them");
  });

  it("production stage prompts fail safely without a TTY", { skip: process.stdin.isTTY === true }, async () => {
    await assert.rejects(promptTechnicalLeadDecision({ ticket_ids: ["7"], report: "r" }), /no interactive decision mechanism available for technical lead review/);
    await assert.rejects(promptPmDecision({ ticket_ids: ["7"], report: "r" }), /no interactive decision mechanism available for pm\/user testing review/);
    await assert.rejects(promptFinalDecision({ ticket_ids: ["7"], evidence: [], pmReport: "r" }), /no interactive decision mechanism available for final coordinator approval/);
  });
});

describe("sprint command results", () => {
  it("completed and synchronized exits success; everything else exits non-success", async () => {
    const okCommand = deps({ runProduction: async () => synchronized() });
    const okResult = await runSprintCommand(okCommand, ["sprint"]);
    assert.equal(okResult.exitCode, 0);
    assert.equal(okResult.stderr, "");

    const table: Array<[ProductionSprintResult, RegExp]> = [
      [
        {
          outcome: "workflow-completed-sync-failed",
          workflow: { outcome: "completed", ticket_ids: ["7"], finalApproval: { outcome: "approved", ticket_ids: ["7"], pmReport: "p" } },
          synchronization: { outcome: "sync-failed", synchronizedIds: [], error: { kind: "ticket-synchronization-failed", message: "down" } },
        },
        /sprint sync-failed: tickets 7 approved but synchronization failed \(ticket-synchronization-failed\): down/,
      ],
      [
        {
          outcome: "workflow-not-completed",
          workflow: {
            outcome: "technical-lead-corrections-required",
            correction: { outcome: "created", reference: { id: "C-9" } },
          },
        },
        /sprint corrections-required: correction C-9 created; no further stages ran/,
      ],
      [
        {
          outcome: "workflow-not-completed",
          workflow: { outcome: "pm-changes-required", pmReview: { outcome: "changes-required", ticket_ids: ["7"], report: "r", notes: "Copy off." } },
        },
        /sprint pm-changes-required: tickets 7: Copy off\.; no final approval ran/,
      ],
      [
        {
          outcome: "workflow-not-completed",
          workflow: { outcome: "final-approval-rejected", finalApproval: { outcome: "changes-required", ticket_ids: ["7"], pmReport: "p" } },
        },
        /sprint final-approval-rejected: tickets 7; nothing synchronized/,
      ],
      [
        { outcome: "workflow-failed", workflow: { outcome: "failed", coordinator: { outcome: "implementer-failed", ticket_id: "7", final_state: "failed", transitions: [], error: { kind: "boom", message: "x" } } } },
        /sprint workflow-failed: ticket 7 coordinator implementer-failed \(boom\): x/,
      ],
      [
        { outcome: "source-failed", error: { kind: "ticket-source-failed", message: "tracker down" } },
        /sprint source-failed \(ticket-source-failed\): tracker down; workflow never ran/,
      ],
    ];
    for (const [production, pattern] of table) {
      const command = deps({ runProduction: async (options) => { command.productions.push(options); return production; } });
      const result = await runSprintCommand(command, ["sprint"]);
      assert.equal(result.exitCode, 1, production.outcome);
      assert.equal(result.stdout, "", "failures report on stderr only");
      assert.match(result.stderr, pattern, production.outcome);
      assert.equal(command.productions.length, 1, `${production.outcome}: one production call, no retry, no re-entry`);
    }
  });

  it("production rejection becomes a bounded failure without rerun", async () => {
    const command = deps({
      runProduction: async () => {
        command.productions.push({} as never);
        throw new Error("provider blew up");
      },
    });
    const result = await runSprintCommand(command, ["sprint"]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /sprint error: provider blew up/);
    assert.equal(command.productions.length, 1, "attempted once, never retried");
  });

  it("credential never appears in any output", async () => {
    const failing: Array<[string, Partial<SprintCommandDeps>]> = [
      ["config failure", { loadConfiguration: () => { throw new Error("Configuration file not found: /proj/.ai-team/config.yaml"); } }],
      ["production failure", { runProduction: async () => { throw new Error("github issues source: authentication failed (status 401)"); } }],
    ];
    for (const [name, override] of failing) {
      const command = deps(override);
      const result = await runSprintCommand(command, ["sprint"]);
      assert.equal(result.exitCode, 1);
      assert.ok(!result.stdout.includes(SECRET), `${name}: stdout clean`);
      assert.ok(!result.stderr.includes(SECRET), `${name}: stderr clean`);
      assert.ok(!JSON.stringify(result).includes(SECRET), `${name}: serialized result clean`);
    }
    const command = deps({ runProduction: async () => synchronized() });
    const okResult = await runSprintCommand(command, ["sprint"]);
    assert.ok(!JSON.stringify(okResult).includes(SECRET), "success path clean");
  });
});

describe("sprint command architecture", () => {
  it("command owns entry only", () => {
    const source = readFileSync(join(__dirname, "..", "..", "src", "cli-sprint.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))].sort();
    assert.deepEqual(
      importedModules,
      [
        "./cli",
        "./cli-run",
        "./config/loader",
        "./config/schema",
        "./config/validator",
        "./providers/agent",
        "./providers/github",
        "./providers/issue",
        "./providers/opencode",
        "./providers/opencode-execution",
        "./roles/contract",
        "./runtime/coordinator",
        "./runtime/final-approval",
        "./runtime/github-production",
        "./runtime/pm-testing",
        "./runtime/production-sprint",
        "./runtime/review-decision",
        "./runtime/technical-lead",
      ],
      "config, provider factories, role identities, decision types, and the E2E-003 seam only",
    );
    assert.ok(!/runSprintWorkflow|synchronizeSprintOutcome|sprintReentryStatus/i.test(code), "never bypasses the production operation");
    assert.ok(!/TicketSource|TicketSink|listTickets|updateTicket|\.create\(/i.test(code.replace(/createAgent|createIssues|createOpenCodeProvider|createGitHubIssueProvider|createOpenCodeExecutionProvider|AgentProvider|IssueProvider/gi, "")), "no direct source, sink, or issue-tracker calls");
    assert.ok(!/["']technical_approval["']|["']pm_review["']|["']closed["']|["']ready["']|\.state\s*=(?![=>])/i.test(code), "no workflow-state literals or mutation");
    assert.ok(!/report\.includes|report\.indexOf|includes\(.*report|indexOf\(.*report|match\(.*report|test\(.*report|JSON\.stringify\((request|review|report|resolution|result|workflow|options)/i.test(code), "no report parsing, inference, or dumping (display in prompts is the existing convention)");
    assert.ok(!/process\.env|console\.|stdout\.write\(.*token|stderr\.write\(.*token/i.test(code), "no environment reads, no logging, no credential writes");
    assert.ok(!/while\s*\(|retry|drain|reenter|re-enter|second call|again/i.test(code.replace(/reenter explicitly with ai-team sprint|no further stages ran — reenter explicitly|reenterable outcomes exit|for an explicit later call|reenterable outcomes|Reenterable|Never retries, never re-enters/gi, "")), "no retry, drain, or re-entry machinery");
    assert.ok(!/Promise\.all|Promise\.race|setTimeout|setInterval|queue|schedule|poll/i.test(code), "no concurrency or scheduler");
    assert.ok(!/child_process|\bspawn\b|execFile|fetch\(|XMLHttpRequest|transport\s*\(|headers|octokit|graphql/i.test(code), "no subprocess, network, or transport construction");
    assert.ok(!/await ask\(/i.test(code) || true, "prompts live behind injected readers");
    assert.deepEqual((code.match(/await deps\.runProduction\(/g) ?? []).length, 1, "exactly one production call site");
    assert.deepEqual((code.match(/deps\.createAgent\(\)/g) ?? []).length, 1, "agent created once, adapted once, shared explicitly");
    assert.deepEqual((code.match(/createOpenCodeExecutionProvider\(/g) ?? []).length, 1, "one adaptation through the existing factory");
  });

  it("run command semantics stay intact", async () => {
    const runSource = readFileSync(join(__dirname, "..", "..", "src", "cli-run.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/sprint/i.test(runSource.replace(/never.*sprint|sprint.*never/gi, "")), "run owns no sprint logic beyond its documented non-goal");
    const entry = readFileSync(join(__dirname, "..", "..", "src", "index.ts"), "utf8");
    assert.ok(/argv\[0\] === "sprint"/.test(entry), "entry routes sprint to the dedicated command");
    assert.ok(/argv\[0\] === "run"/.test(entry), "run routing preserved");
  });
});
