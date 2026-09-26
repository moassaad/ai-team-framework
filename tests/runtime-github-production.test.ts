import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FrameworkConfig } from "../src/config/schema";
import { AgentProvider } from "../src/providers/agent";
import {
  GitHubIssuesHttpRequest,
  GitHubIssuesTransport,
} from "../src/providers/github-issues";
import {
  GitHubProductionOptions,
  decodeManagedLabelState,
  runGitHubProductionCoordinator,
} from "../src/runtime/github-production";

// Production GitHub composition tests (M18 R-011): config plus
// explicit secrets into the proven adapters and the existing
// application operation. All HTTP is faked; no network, token
// file, configuration writes, Git, delegate, scheduler, or CLI
// anywhere.

function config(github: unknown): FrameworkConfig {
  return { version: 1, providers: { github: github as never } };
}

const enabledConfig = (): FrameworkConfig =>
  config({ enabled: true, owner: "acme", repo: "widgets" });

function agent(log: string[]): AgentProvider<string> {
  return {
    name: "fake-opencode",
    execute: async (invocation) => {
      log.push(invocation.prompt);
      return "Shipped; gates pass.";
    },
  };
}

function issue(number: number, labels: unknown[] = ["ai-team"]): Record<string, unknown> {
  return {
    number,
    title: `Work ${String(number)}`,
    body: `Description for ${String(number)}.\n\n## Requirements\n\nRequirements for ${String(number)}.`,
    state: "open",
    labels,
  };
}

function fakeGitHub(
  seen: GitHubIssuesHttpRequest[],
  behavior: (request: GitHubIssuesHttpRequest, calls: number) => { status: number; body: unknown } | never = () => ({
    status: 200,
    body: [],
  }),
): GitHubIssuesTransport {
  let calls = 0;
  return async (request) => {
    seen.push(request);
    calls += 1;
    const outcome = behavior(request, calls);
    if (outcome === undefined) {
      throw new Error("socket hang up");
    }
    return outcome;
  };
}

function storedIssue(number: number): Record<string, unknown> {
  return { ...issue(number), labels: ["ai-team", "priority:high"] };
}

/** Default fake: list returns one managed issue, GET returns it, PATCH echoes it. */
function standardFake(seen: GitHubIssuesHttpRequest[]): GitHubIssuesTransport {
  return fakeGitHub(seen, (request) => {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.endsWith("/issues")) {
      return { status: 200, body: [issue(7)] };
    }
    if (request.method === "GET") {
      return { status: 200, body: storedIssue(7) };
    }
    return { status: 200, body: storedIssue(7) };
  });
}

function baseOptions(overrides: Partial<GitHubProductionOptions> = {}): GitHubProductionOptions {
  const prompts: string[] = [];
  return {
    config: enabledConfig(),
    token: "secret-token",
    managedLabel: "ai-team",
    specialty: "backend",
    openCodeAgent: agent(prompts),
    project_root: "/proj",
    timeout_ms: 5000,
    reviewDecision: "approved",
    ...overrides,
  };
}

describe("production github composition", () => {
  it("valid configuration constructs source and sink with zero HTTP", async () => {
    const seen: GitHubIssuesHttpRequest[] = [];
    const prompts: string[] = [];
    const result = await runGitHubProductionCoordinator(
      baseOptions({ transport: standardFake(seen), openCodeAgent: agent(prompts) }),
    );
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.final_state === "technical_approval");
    assert.ok(result.outcome === "completed" && result.ticket_id === "7");
    const reads = seen.filter((request) => request.method === "GET" && new URL(request.url).pathname.endsWith("/issues"));
    const gets = seen.filter((request) => request.method === "GET");
    const patches = seen.filter((request) => request.method === "PATCH");
    assert.equal(reads.length, 1, "source reads once");
    assert.equal(gets.length, 2, "source read plus sink pre-read");
    assert.equal(patches.length, 1, "sink writes once");
    assert.deepEqual(prompts.length, 2, "Coordinator called exactly once (implementer + reviewer)");
    const patch = patches[0];
    assert.deepEqual(JSON.parse(patch.body as string), {
      labels: ["ai-team", "priority:high", "ai-team:technical_approval"],
    });
    for (const request of seen) {
      assert.equal(request.headers["Authorization"], "Bearer secret-token");
      assert.ok(new URL(request.url).pathname.startsWith("/repos/acme/widgets/issues"));
    }
  });

  it("missing production inputs fail before any HTTP", async () => {
    const cases: Array<[string, Partial<GitHubProductionOptions>]> = [
      ["missing owner", { config: config({ enabled: true, repo: "widgets" }) }],
      ["empty owner", { config: config({ enabled: true, owner: "", repo: "widgets" }) }],
      ["missing repo", { config: config({ enabled: true, owner: "acme" }) }],
      ["missing token", { token: "" }],
      ["missing label", { managedLabel: "" }],
      ["bad decoder", { parseState: "ready" as never }],
      ["disabled github", { config: config({ enabled: false, owner: "acme", repo: "widgets" }) }],
      ["absent github", { config: { version: 1 } }],
    ];
    for (const [name, override] of cases) {
      const seen: GitHubIssuesHttpRequest[] = [];
      await assert.rejects(
        runGitHubProductionCoordinator(baseOptions({ ...override, transport: standardFake(seen) })),
        /github production: /,
        name,
      );
      assert.deepEqual(seen, [], `${name}: zero HTTP, Coordinator never runs`);
    }
    const seen: GitHubIssuesHttpRequest[] = [];
    await assert.rejects(
      runGitHubProductionCoordinator("nope" as never),
      /expected an options object/,
    );
    assert.deepEqual(seen, [], "no input object, no side effects");
  });

  it("production state decoder follows the documented label round-trip", () => {
    const decode = decodeManagedLabelState("ai-team");
    const entry = (labels: string[]) => ({ number: 7, title: "t", body: null, state: "open", labels, pull_request: false });
    assert.equal(decode(entry([])), "ready", "managed without state label is new work");
    assert.equal(decode(entry(["ai-team", "ai-team:failed"])), "failed");
    assert.equal(decode(entry(["ai-team:changes_requested"])), "changes_requested");
    assert.throws(() => decode(entry(["ai-team:failed", "ai-team:ready"])), /ambiguous state labels/);
    assert.throws(() => decode(entry(["ai-team:someday"])), /unknown state label/);
    assert.throws(() => decodeManagedLabelState(""), /managedLabel must be a non-empty string/);
  });

  it("rework path through production composition reaches the sink", async () => {
    const seen: GitHubIssuesHttpRequest[] = [];
    const prompts: string[] = [];
    const result = await runGitHubProductionCoordinator(
      baseOptions({
        openCodeAgent: agent(prompts),
        transport: fakeGitHub(seen, (request) => {
          const url = new URL(request.url);
          if (request.method === "GET" && url.pathname.endsWith("/issues")) {
            return { status: 200, body: [issue(7, ["ai-team", "ai-team:changes_requested"])] };
          }
          if (request.method === "GET") {
            return { status: 200, body: storedIssue(7) };
          }
          return { status: 200, body: storedIssue(7) };
        }),
        parseState: (() => "changes_requested") as never,
        parseFeedback: () => "Tighten it.",
      }),
    );
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.final_state === "technical_approval");
    assert.ok(result.outcome === "completed" && result.ticket_id === "7", "only the selected ticket synchronized");
    assert.equal(seen.filter((request) => request.method === "PATCH").length, 1);
    assert.deepEqual(prompts.length, 2);
  });

  it("no-work and conflict never reach the sink", async () => {
    const emptySeen: GitHubIssuesHttpRequest[] = [];
    const empty = await runGitHubProductionCoordinator(
      baseOptions({ transport: fakeGitHub(emptySeen, () => ({ status: 200, body: [] })) }),
    );
    assert.equal(empty.outcome, "no-work");
    assert.deepEqual(emptySeen.filter((request) => request.method === "PATCH"), [], "no-work writes nothing");
    const conflictSeen: GitHubIssuesHttpRequest[] = [];
    const conflict = await runGitHubProductionCoordinator(
      baseOptions({
        transport: fakeGitHub(conflictSeen, (request) => {
          if (request.method === "GET" && new URL(request.url).pathname.endsWith("/issues")) {
            return {
              status: 200,
              body: [{ ...issue(7), body: "x\n\n## Requirements\n\nx", state: "open", labels: ["ai-team"] }],
            };
          }
          return { status: 200, body: storedIssue(7) };
        }),
        parseState: (() => "in_progress") as never,
      }),
    );
    assert.equal(conflict.outcome, "conflict");
    assert.deepEqual(conflictSeen.filter((request) => request.method === "PATCH"), [], "conflict writes nothing");
  });

  it("sink failure produces sync-failed without rerunning the Coordinator", async () => {
    const seen: GitHubIssuesHttpRequest[] = [];
    const prompts: string[] = [];
    const result = await runGitHubProductionCoordinator(
      baseOptions({
        openCodeAgent: agent(prompts),
        transport: fakeGitHub(seen, (request) => {
          const url = new URL(request.url);
          if (request.method === "GET" && url.pathname.endsWith("/issues")) {
            return { status: 200, body: [issue(7)] };
          }
          if (request.method === "GET") {
            return { status: 200, body: storedIssue(7) };
          }
          return { status: 503, body: { message: "unavailable" } };
        }),
      }),
    );
    assert.equal(result.outcome, "sync-failed");
    assert.ok(result.outcome === "sync-failed" && result.ticket_id === "7");
    assert.ok(result.outcome === "sync-failed" && result.coordinatorResult.outcome === "completed");
    assert.deepEqual(prompts.length, 2, "Coordinator not rerun");
    assert.equal(seen.filter((request) => request.method === "PATCH").length, 1, "sink not retried");
  });

  it("configuration is never mutated and token never exposed", async () => {
    const frozen = Object.freeze({
      version: 1,
      providers: Object.freeze({ github: Object.freeze({ enabled: true, owner: "acme", repo: "widgets" }) }),
    }) as unknown as FrameworkConfig;
    const before = JSON.stringify(frozen);
    const seen: GitHubIssuesHttpRequest[] = [];
    await runGitHubProductionCoordinator(baseOptions({ config: frozen, transport: standardFake(seen) }));
    assert.equal(JSON.stringify(frozen), before, "configuration untouched");
    await assert.rejects(
      runGitHubProductionCoordinator(baseOptions({ token: "", transport: standardFake([]) })),
      /github production: token must be a non-empty string/,
    );
    const failingSeen: GitHubIssuesHttpRequest[] = [];
    await assert.rejects(
      runGitHubProductionCoordinator(
        baseOptions({ transport: fakeGitHub(failingSeen, () => ({ status: 403, body: {} })) }),
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes("secret-token"), "token absent from message");
        assert.ok(!JSON.stringify(error).includes("secret-token"), "token absent from serialized error");
        return true;
      },
    );
  });

  it("composition owns wiring only", () => {
    const compositionCode = readFileSync(join(__dirname, "..", "..", "src", "runtime", "github-production.ts"), "utf8");
    const code = compositionCode.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(
      importedModules.sort(),
      [
        "../config/schema",
        "../providers/agent",
        "../providers/github-issues",
        "../providers/github-sink",
        "../roles/contract",
        "../workflow/states",
        "./application",
        "./coordinator",
      ],
      "config types + adapters + application boundary only",
    );
    assert.ok(!/cli|status|setup|run\(|argv/i.test(code.replace(/runGitHubProductionCoordinator|runProductionCoordinatorFromSource/g, "")), "no CLI");
    assert.ok(!/poll|schedule|webhook|queue|retry|rollback|while/i.test(code), "no scheduler, queue, or retry");
    assert.ok(!/createLabel|provision|register|owner\/repo settings/i.test(code), "no provisioning or registry");
    assert.ok(!/console\.|process\.stdout|process\.env/i.test(code), "no logging, no environment reads");
    assert.ok(!/delegate|skill|fleet|lane|model|session|opencode run|specify/i.test(code), "no delegate or execution specifics");
    assert.ok(!/child_process|\bspawn\b|execFile|execSync|\bgh\b/i.test(code.replace(/github/gi, "")), "no subprocess or gh CLI");
    assert.ok(!/\.enabled\s*=|\.owner\s*=|\.repo\s*=/i.test(code), "configuration never mutated");
    const appCode = readFileSync(join(__dirname, "..", "..", "src", "runtime", "application.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/github/i.test(appCode), "application operation unchanged");
    const coordinatorCode = readFileSync(join(__dirname, "..", "..", "src", "runtime", "coordinator.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/github/i.test(coordinatorCode), "Coordinator stays GitHub-blind");
  });
});
