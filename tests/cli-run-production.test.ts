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
import { RunCommandDeps, runRunCommand } from "../src/cli-run";

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
    assert.ok(code.includes("decideReview: deps.readReviewDecision"), "injected reader passed through, never assumed");
    assert.ok(!/opencode run|spawn|shell/.test(code), "never launches OpenCode");
    assert.ok(!/\bgit\b|commit|push|branch/.test(code), "never calls Git");
    assert.ok(!/resolveRole|resolveImplementerSpecialty|RoleContract/.test(code), "never selects roles");
    assert.ok(!/backend|frontend/.test(code), "never infers or defaults specialty");
    assert.ok(!/delegate|skill|fleet|lane|model|session/.test(code), "never selects delegate skills");
    assert.ok(!/while|for ?\(|poll|schedule|daemon|loop/i.test(code.replace(/runProductionCoordinator|runGitHubProductionCoordinator/g, "")), "never loops tickets");
    assert.ok(!/runCoordinatorTicket|executeImplementer|executeReviewer/.test(code), "never bypasses the production seam");
    const indexCode = readFileSync(join(__dirname, "..", "..", "src", "index.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(indexCode.includes('"run"'), "bare run routes to the async command");
    assert.ok(/runRunCommand/.test(indexCode), "routing uses the run command");
  });
});
