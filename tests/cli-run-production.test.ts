import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FrameworkConfig } from "../src/config/schema";
import { AgentProvider } from "../src/providers/agent";
import {
  CoordinatorTicketResult,
} from "../src/runtime/coordinator";
import {
  ProductionSynchronizationFailed,
} from "../src/runtime/application";
import { GitHubProductionOptions } from "../src/runtime/github-production";
import { RunCommandDeps, promptReviewDecision, runRunCommand } from "../src/cli-run";

// Production run command tests (M18 R-012): `ai-team run` as a
// thin entrypoint over the R-011 composition. Every dependency
// is injected; no config files, terminals, network, Git,
// OpenCode processes, or roles exist here.

const SECRET = "secret-token";

function config(github: unknown): FrameworkConfig {
  return { version: 1, providers: { github: github as never } };
}

const validConfig = (): FrameworkConfig =>
  config({ enabled: true, owner: "acme", repo: "widgets", managedLabel: "ai-team", specialty: "backend" });

function agent(): AgentProvider<string> {
  return { name: "fake-opencode", execute: async () => "ok" };
}

function deps(overrides: Partial<RunCommandDeps> = {}): RunCommandDeps & { productions: GitHubProductionOptions[] } {
  const productions: GitHubProductionOptions[] = [];
  return {
    productions,
    projectRoot: "/proj",
    loadConfiguration: () => validConfig(),
    readToken: async () => SECRET,
    readReviewDecision: async () => ({ decision: "approved" }),
    createAgent: agent,
    runProduction: async (options) => {
      productions.push(options);
      return { outcome: "no-work", reason: "no ready tickets (0 tickets: 0 ready)" };
    },
    ...overrides,
  };
}

function completed(ticketId: string, finalState: "technical_approval" | "changes_requested"): CoordinatorTicketResult {
  return {
    outcome: "completed",
    ticket_id: ticketId,
    final_state: finalState,
    transitions: [],
    implementation: { status: "succeeded", text: "done" },
    report: "clean",
  };
}

describe("run command", () => {
  it("bare run invokes the production runtime once", async () => {
    const command = deps();
    const result = await runRunCommand(command, ["run"]);
    assert.equal(command.productions.length, 1, "exactly one production invocation");
    const options = command.productions[0];
    assert.equal(options.managedLabel, "ai-team");
    assert.equal(options.specialty, "backend");
    assert.equal(options.token, SECRET, "stdin credential flows only into the production call");
    assert.equal(options.project_root, "/proj");
    assert.equal(options.timeout_ms, 300000);
    assert.equal(typeof options.decideReview, "function", "decision dependency passed through, never hard-coded");
    assert.equal(options.config.providers?.github?.owner, "acme");
    assert.ok(options.openCodeAgent.name.length > 0, "execution agent supplied by deps");
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /run no-work/);
  });

  it("unknown run arguments fail with usage error before runtime", async () => {
    for (const argv of [["run", "extra"], ["run", "--specialty", "backend"], ["run", "--token", "x"], ["run", "--help"]]) {
      const command = deps();
      const result = await runRunCommand(command, argv);
      assert.equal(result.exitCode, 1, argv.join(" "));
      assert.match(result.stderr, /usage: ai-team run/, argv.join(" "));
      assert.deepEqual(command.productions, [], `${argv.join(" ")}: runtime never invoked`);
    }
  });

  it("missing configuration fails before runtime", async () => {
    const cases: Array<[string, Partial<RunCommandDeps>]> = [
      ["config load throws", { loadConfiguration: () => { throw new Error("Configuration file not found: /proj/.ai-team/config.yaml"); } }],
      ["github disabled", { loadConfiguration: () => config({ enabled: false }) }],
      ["github absent", { loadConfiguration: () => ({ version: 1 }) }],
      ["missing label", { loadConfiguration: () => config({ enabled: true, owner: "a", repo: "w", specialty: "backend" }) }],
      ["missing specialty", { loadConfiguration: () => config({ enabled: true, owner: "a", repo: "w", managedLabel: "ai-team" }) }],
    ];
    for (const [name, override] of cases) {
      const command = deps(override);
      const result = await runRunCommand(command, ["run"]);
      assert.equal(result.exitCode, 1, name);
      assert.match(result.stderr, /run (error|conflict|implementer-failed|reviewer-failed|sync-failed)/, name);
      assert.deepEqual(command.productions, [], `${name}: runtime never invoked`);
    }
  });

  it("missing credential fails before runtime", async () => {
    for (const [name, readToken] of [
      ["empty token", async () => ""],
      ["whitespace token", async () => "  \n "],
      ["reader throws", async () => { throw new Error("EIO"); }],
    ] as Array<[string, () => Promise<string>]>) {
      const command = deps({ readToken });
      const result = await runRunCommand(command, ["run"]);
      assert.equal(result.exitCode, 1, name);
      assert.match(result.stderr, /non-empty GitHub token/, name);
      assert.deepEqual(command.productions, [], `${name}: runtime never invoked`);
    }
  });

  it("result shapes map to bounded output and exit codes", async () => {
    const cases: Array<[CoordinatorTicketResult | ProductionSynchronizationFailed, number, RegExp, "stdout" | "stderr"]> = [
      [completed("T-7", "technical_approval"), 0, /run completed: ticket T-7 -> technical_approval\./, "stdout"],
      [completed("T-7", "changes_requested"), 0, /run completed: ticket T-7 -> changes_requested\./, "stdout"],
      [{ outcome: "no-work", reason: "no ready tickets (0 tickets: 0 ready)" }, 0, /run no-work: no ready tickets/, "stdout"],
      [
        { outcome: "conflict", ticket_id: "T-7", state: "in_progress", reason: "already active" },
        1, /run conflict: ticket T-7 \(in_progress\): already active\./, "stderr",
      ],
      [
        { outcome: "implementer-failed", ticket_id: "T-7", final_state: "failed", transitions: [], error: { kind: "provider_error", message: "boom" } },
        1, /run implementer-failed: ticket T-7 \(provider_error\): boom\./, "stderr",
      ],
      [
        { outcome: "reviewer-failed", ticket_id: "T-7", final_state: "implementation_review", transitions: [], error: { kind: "timeout", message: "slow" } },
        1, /run reviewer-failed: ticket T-7 \(timeout\): slow\./, "stderr",
      ],
      [
        {
          outcome: "sync-failed", ticket_id: "T-7",
          coordinatorResult: completed("T-7", "technical_approval"),
          error: { kind: "ticket-synchronization-failed", message: "tracker offline" },
        },
        1, /run sync-failed: ticket T-7 advanced to technical_approval but synchronization failed \(ticket-synchronization-failed\): tracker offline\./, "stderr",
      ],
      [
        {
          outcome: "decision-failed", ticket_id: "T-7", final_state: "implementation_review",
          transitions: [], error: { kind: "decision_error", message: "no interactive decision mechanism available" },
        },
        1, /run decision-failed: ticket T-7 preserved at implementation_review \(decision_error\): no interactive decision mechanism available\./, "stderr",
      ],
    ];
    for (const [productionResult, exitCode, pattern, stream] of cases) {
      const command = deps({ runProduction: async () => productionResult });
      const result = await runRunCommand(command, ["run"]);
      assert.equal(result.exitCode, exitCode, pattern.source);
      assert.match(result[stream], pattern, pattern.source);
      assert.equal(result[stream === "stdout" ? "stderr" : "stdout"], "", "single-stream output");
    }
  });

  it("production rejection becomes a bounded failure without rerun", async () => {
    let calls = 0;
    const command = deps({
      runProduction: async () => {
        calls += 1;
        throw new Error("github issues source: authentication failed (status 401)");
      },
    });
    const result = await runRunCommand(command, ["run"]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /run error: github issues source: authentication failed \(status 401\)\./);
    assert.equal(calls, 1, "never rerun");
  });

  it("credential never appears in any output", async () => {
    const failing: Array<[string, Partial<RunCommandDeps>]> = [
      ["config failure", { loadConfiguration: () => { throw new Error("Configuration file not found: /proj/.ai-team/config.yaml"); } }],
      ["production failure", { runProduction: async () => { throw new Error("github issues source: authentication failed (status 401)"); } }],
    ];
    for (const [name, override] of failing) {
      const command = deps(override);
      const result = await runRunCommand(command, ["run"]);
      const serialized = JSON.stringify(result);
      assert.ok(!result.stdout.includes(SECRET), `${name}: stdout clean`);
      assert.ok(!result.stderr.includes(SECRET), `${name}: stderr clean`);
      assert.ok(!serialized.includes(SECRET), `${name}: serialized result clean`);
    }
    const command = deps();
    const okResult = await runRunCommand(command, ["run"]);
    assert.ok(!JSON.stringify(okResult).includes(SECRET), "success path clean");
  });

  it("invalid deps fail bounded without side effects", async () => {
    const result = await runRunCommand("nope" as never, ["run"]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /run error: run command: expected a dependencies object\./);
  });

  it("repeated invocations are stateless", async () => {
    const command = deps();
    const first = await runRunCommand(command, ["run"]);
    const second = await runRunCommand(command, ["run"]);
    assert.equal(first.exitCode, second.exitCode);
    assert.equal(command.productions.length, 2, "one production call per CLI invocation, no loop");
  });

  it("command owns entry only", () => {
    const runCode = readFileSync(join(__dirname, "..", "..", "src", "cli-run.ts"), "utf8");
    const code = runCode.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(
      importedModules.sort(),
      [
        "./cli",
        "./config/loader",
        "./config/schema",
        "./config/validator",
        "./providers/agent",
        "./providers/opencode",
        "./roles/contract",
        "./runtime/application",
        "./runtime/coordinator",
        "./runtime/github-production",
        "./runtime/review-decision",
        "node:readline",
      ],
      "config + agent factory + production seam + decision reader + result types only",
    );
    assert.ok(!/listTickets|updateTicket|PATCH|GET /.test(code), "never touches GitHub HTTP");
    assert.ok(!/reviewDecision/.test(code), "no static verdict field survives anywhere");
    assert.ok(code.includes("decideReview: explicitDecision ?? deps.readReviewDecision"), "explicit args or injected reader, never assumed");
    assert.ok(!/opencode run|spawn|shell/.test(code), "never launches OpenCode");
    assert.ok(!/\bgit\b|commit|push|branch/.test(code), "never calls Git");
    assert.ok(!/resolveRole|resolveImplementerSpecialty|RoleContract/.test(code), "never selects roles");
    assert.ok(!/backend|frontend/.test(code), "never infers or defaults specialty");
    assert.ok(!/delegate|skill|fleet|lane|model|session/.test(code), "never selects delegate skills");
    assert.deepEqual(code.match(/await deps\.runProduction\(/g)?.length ?? 0, 1, "exactly one production call site, never a loop");
    assert.ok(!/decideReview\(/.test(code), "resolver passed through, never invoked or retried by the CLI");
    assert.ok(!/runCoordinatorTicket|executeImplementer|executeReviewer/.test(code), "never bypasses the production seam");
    const indexCode = readFileSync(join(__dirname, "..", "..", "src", "index.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(indexCode.includes('"run"'), "bare run routes to the async command");
    assert.ok(/runRunCommand/.test(indexCode), "routing uses the run command");
  });
});

describe("run command review decision arguments", () => {
  const request = {
    ticket_id: "T-7",
    title: "Work T-7",
    description: "Description.",
    requirements: "Requirements.",
    report: "Reviewer notes: solid.",
  };

  it("explicit approved decision reaches the resolver without prompting", async () => {
    let prompts = 0;
    const command = deps({
      readReviewDecision: async () => {
        prompts += 1;
        return { decision: "approved" };
      },
    });
    const result = await runRunCommand(command, ["run", "--review-decision", "approved"]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /run no-work/);
    assert.equal(command.productions.length, 1);
    assert.equal(prompts, 0, "explicit decision suppresses the TTY prompt");
    const resolution = await command.productions[0].decideReview(request);
    assert.deepEqual(resolution, { decision: "approved" });
    assert.deepEqual(Object.isFrozen(resolution), true, "frozen like other runtime results");
  });

  it("explicit changes-requested decision preserves exact feedback bytes", async () => {
    const feedback = "  Tighten the  edge.\n-- second line --\t";
    const command = deps();
    const result = await runRunCommand(command, [
      "run",
      "--review-decision",
      "changes_requested",
      "--review-feedback",
      feedback,
    ]);
    assert.equal(result.exitCode, 0);
    assert.equal(command.productions.length, 1);
    const resolution = await command.productions[0].decideReview(request);
    assert.deepEqual(resolution, { decision: "changes_requested", feedback });
    assert.equal(resolution.feedback, feedback, "byte-for-byte, no trimming or rewriting");
  });

  it("invalid decision combinations fail before runtime", async () => {
    const cases: Array<[string, string[], RegExp]> = [
      ["missing decision value", ["run", "--review-decision"], /missing value for --review-decision/],
      ["missing feedback value", ["run", "--review-decision", "changes_requested", "--review-feedback"], /missing value for --review-feedback/],
      ["unknown decision", ["run", "--review-decision", "maybe"], /unknown verdict/],
      ["changes without feedback", ["run", "--review-decision", "changes_requested"], /non-empty feedback/],
      ["empty feedback", ["run", "--review-decision", "changes_requested", "--review-feedback", ""], /non-empty feedback/],
      ["approved with feedback", ["run", "--review-decision", "approved", "--review-feedback", "nice"], /no feedback/],
      ["duplicate decision", ["run", "--review-decision", "approved", "--review-decision", "approved"], /duplicate --review-decision/],
      ["duplicate feedback", ["run", "--review-decision", "changes_requested", "--review-feedback", "a", "--review-feedback", "b"], /duplicate --review-feedback/],
      ["feedback without decision", ["run", "--review-feedback", "late"], /requires --review-decision/],
      ["trailing argument", ["run", "--review-decision", "approved", "extra"], /usage: ai-team run/],
    ];
    for (const [name, argv, pattern] of cases) {
      let configs = 0;
      let tokens = 0;
      const command = deps({
        loadConfiguration: () => {
          configs += 1;
          return validConfig();
        },
        readToken: async () => {
          tokens += 1;
          return SECRET;
        },
      });
      const result = await runRunCommand(command, argv);
      assert.equal(result.exitCode, 1, name);
      assert.match(result.stderr, pattern, name);
      assert.deepEqual(command.productions, [], `${name}: runtime never invoked`);
      assert.equal(configs, 0, `${name}: configuration never loaded`);
      assert.equal(tokens, 0, `${name}: credential never read`);
      assert.ok(!result.stderr.includes(SECRET), `${name}: token absent`);
    }
  });

  it("bare run without explicit decision still uses the injected reader", async () => {
    let prompts = 0;
    const reader = async () => {
      prompts += 1;
      return { decision: "changes_requested" as const, feedback: "TTY notes." };
    };
    const command = deps({ readReviewDecision: reader });
    const result = await runRunCommand(command, ["run"]);
    assert.equal(result.exitCode, 0);
    assert.equal(command.productions.length, 1);
    assert.equal(prompts, 0, "reader invoked later by production, not by the CLI");
    assert.ok(command.productions[0].decideReview === reader, "TTY reader passed through for R-013 behavior");
  });

  it("production prompt without a TTY fails safely instead of approving", { skip: process.stdin.isTTY === true }, async () => {
    await assert.rejects(
      promptReviewDecision(request),
      /no interactive decision mechanism available; refusing to auto-approve/,
    );
  });

  it("decision arguments never leak secrets or loop the runtime", async () => {
    const feedback = `notes involving ${SECRET}`;
    const command = deps();
    const result = await runRunCommand(command, [
      "run",
      "--review-decision",
      "changes_requested",
      "--review-feedback",
      feedback,
    ]);
    assert.equal(result.exitCode, 0);
    assert.equal(command.productions.length, 1, "one production call, no additional invocation");
    const resolution = await command.productions[0].decideReview(request);
    assert.equal(resolution.feedback, feedback, "feedback transported, not redacted");
  });
});
