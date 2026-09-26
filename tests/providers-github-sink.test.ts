import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentProvider } from "../src/providers/agent";
import { runProductionCoordinatorFromSource } from "../src/runtime/application";
import { CoordinatorTicket } from "../src/runtime/coordinator";
import { isTicketSink } from "../src/runtime/ticket-sink";
import {
  GitHubIssuesHttpRequest,
  GitHubIssuesHttpResponse,
  GitHubIssuesTransport,
} from "../src/providers/github-issues";
import {
  GitHubIssuesSinkOptions,
  createGitHubIssuesTicketSink,
} from "../src/providers/github-sink";

// GitHub Issues TicketSink tests (M18 R-010): concrete write
// boundary behind an injected transport. No network, no token
// file, no configuration, no Git, no delegate, no registry,
// no runtime changes anywhere.

function ticket(id: string, state: CoordinatorTicket["state"]): CoordinatorTicket {
  return {
    id,
    title: `Work ${id}`,
    description: `Description for ${id}.`,
    requirements: `Requirements for ${id}.`,
    state,
  };
}

function storedIssue(number: number, labels: unknown = ["ai-team", "priority:high"]): Record<string, unknown> {
  return { number, title: `Work ${String(number)}`, body: "User body.\n\n## Requirements\n\nUser requirements.", state: "open", labels };
}

interface Script {
  getBody?: unknown;
  getStatus?: number;
  patchBody?: unknown;
  patchStatus?: number;
  failGet?: boolean;
  failPatch?: boolean;
}

function fakeTransport(script: Script, seen: GitHubIssuesHttpRequest[]): GitHubIssuesTransport {
  return async (request) => {
    seen.push(request);
    if (request.method === "GET") {
      if (script.failGet === true) {
        throw new Error("socket hang up");
      }
      const response: GitHubIssuesHttpResponse = { status: script.getStatus ?? 200, body: script.getBody ?? storedIssue(7) };
      return response;
    }
    if (script.failPatch === true) {
      throw new Error("socket hang up");
    }
    const response: GitHubIssuesHttpResponse = {
      status: script.patchStatus ?? 200,
      body: script.patchBody ?? storedIssue(7),
    };
    return response;
  };
}

function baseOptions(script: Script, seen: GitHubIssuesHttpRequest[]): GitHubIssuesSinkOptions {
  return {
    owner: "acme",
    repo: "widgets",
    token: "secret-token",
    managedLabel: "ai-team",
    transport: fakeTransport(script, seen),
  };
}

function patchPayload(seen: GitHubIssuesHttpRequest[]): Record<string, unknown> {
  const patch = seen.find((request) => request.method === "PATCH");
  assert.ok(patch !== undefined, "a PATCH request was sent");
  assert.equal(patch.body === undefined, false, "PATCH carries a body");
  return JSON.parse(patch.body as string) as Record<string, unknown>;
}

describe("github issues ticket sink", () => {
  it("constructs a valid TicketSink with explicit inputs", async () => {
    const seen: GitHubIssuesHttpRequest[] = [];
    const sink = createGitHubIssuesTicketSink(baseOptions({}, seen));
    assert.ok(isTicketSink(sink), "satisfies the generic TicketSink contract");
    await sink.updateTicket(ticket("7", "technical_approval"));
    assert.deepEqual(seen.map((request) => request.method), ["GET", "PATCH"]);
  });

  it("invalid factory inputs fail before any HTTP", async () => {
    const seen: GitHubIssuesHttpRequest[] = [];
    const transport = fakeTransport({}, seen);
    const valid: GitHubIssuesSinkOptions = {
      owner: "acme",
      repo: "widgets",
      token: "secret-token",
      managedLabel: "ai-team",
      transport,
    };
    const bad: Array<[string, Partial<GitHubIssuesSinkOptions>]> = [
      ["empty owner", { owner: "" }],
      ["slash repo", { repo: "a/b" }],
      ["empty token", { token: "" }],
      ["empty label", { managedLabel: "" }],
      ["bad transport", { transport: "x" as never }],
    ];
    for (const [name, override] of bad) {
      assert.throws(() => createGitHubIssuesTicketSink({ ...valid, ...override }), /github issues sink: invalid options/, name);
    }
    assert.throws(() => createGitHubIssuesTicketSink("nope" as never), /expected an options object/);
    assert.deepEqual(seen, [], "no HTTP before valid construction");
  });

  it("PATCH targets the exact issue endpoint with auth and API headers", async () => {
    const seen: GitHubIssuesHttpRequest[] = [];
    const sink = createGitHubIssuesTicketSink(baseOptions({}, seen));
    await sink.updateTicket(ticket("7", "technical_approval"));
    const [get, patch] = seen;
    for (const request of [get, patch]) {
      assert.equal(new URL(request.url).origin + new URL(request.url).pathname, "https://api.github.com/repos/acme/widgets/issues/7");
      assert.equal(request.headers["Authorization"], "Bearer secret-token");
      assert.equal(request.headers["Accept"], "application/vnd.github+json");
      assert.equal(request.headers["X-GitHub-Api-Version"], "2022-11-28");
    }
    assert.equal(get.method, "GET");
    assert.equal(get.body, undefined, "pre-read carries no body");
    assert.equal(patch.method, "PATCH");
    assert.equal(patch.headers["Content-Type"], "application/json");
  });

  it("reachable workflow states map to state labels with user content preserved", async () => {
    const cases: Array<[CoordinatorTicket["state"], string[]]> = [
      ["technical_approval", ["ai-team", "priority:high", "ai-team:technical_approval"]],
      ["changes_requested", ["ai-team", "priority:high", "ai-team:changes_requested"]],
      ["failed", ["ai-team", "priority:high", "ai-team:failed"]],
      ["implementation_review", ["ai-team", "priority:high", "ai-team:implementation_review"]],
    ];
    for (const [state, labels] of cases) {
      const seen: GitHubIssuesHttpRequest[] = [];
      const sink = createGitHubIssuesTicketSink(baseOptions({}, seen));
      await sink.updateTicket(ticket("7", state));
      const payload = patchPayload(seen);
      assert.deepEqual(payload, { labels }, `state ${state}: labels only, nothing else`);
    }
    const closedSeen: GitHubIssuesHttpRequest[] = [];
    const sink = createGitHubIssuesTicketSink(baseOptions({}, closedSeen));
    await sink.updateTicket(ticket("7", "closed"));
    assert.deepEqual(
      patchPayload(closedSeen),
      { labels: ["ai-team", "priority:high", "ai-team:closed"], state: "closed" },
      "established native-close convention only for closed",
    );
    const cancelledSeen: GitHubIssuesHttpRequest[] = [];
    const cancelledSink = createGitHubIssuesTicketSink(baseOptions({}, cancelledSeen));
    await cancelledSink.updateTicket(ticket("7", "cancelled"));
    assert.deepEqual(
      patchPayload(cancelledSeen),
      { labels: ["ai-team", "priority:high", "ai-team:cancelled"], state: "closed" },
      "established native-close convention only for cancelled",
    );
  });

  it("unsupported states fail safely before any HTTP", async () => {
    for (const state of ["ready", "in_progress", "pm_review", "blocked", "needs_user_input"] as CoordinatorTicket["state"][]) {
      const seen: GitHubIssuesHttpRequest[] = [];
      const sink = createGitHubIssuesTicketSink(baseOptions({}, seen));
      await assert.rejects(sink.updateTicket(ticket("7", state)), /has no GitHub representation/, `state ${state}`);
      assert.deepEqual(seen, [], `state ${state}: zero requests`);
    }
  });

  it("existing state labels are replaced idempotently, never duplicated", async () => {
    const seen: GitHubIssuesHttpRequest[] = [];
    const sink = createGitHubIssuesTicketSink(
      baseOptions({ getBody: storedIssue(7, ["ai-team", "ai-team:failed", "priority:high"]) }, seen),
    );
    await sink.updateTicket(ticket("7", "technical_approval"));
    assert.deepEqual(patchPayload(seen), { labels: ["ai-team", "priority:high", "ai-team:technical_approval"] });
    const repeatSeen: GitHubIssuesHttpRequest[] = [];
    const repeat = createGitHubIssuesTicketSink(
      baseOptions({ getBody: storedIssue(7, ["ai-team", "priority:high", "ai-team:technical_approval"]) }, repeatSeen),
    );
    await repeat.updateTicket(ticket("7", "technical_approval"));
    assert.deepEqual(
      patchPayload(repeatSeen),
      { labels: ["ai-team", "priority:high", "ai-team:technical_approval"] },
      "repeat produces the same logical representation",
    );
  });

  it("unmanaged targets, pull requests, and bad identities fail with zero mutations", async () => {
    const unmanagedSeen: GitHubIssuesHttpRequest[] = [];
    const unmanaged = createGitHubIssuesTicketSink(
      baseOptions({ getBody: storedIssue(7, ["priority:high"]) }, unmanagedSeen),
    );
    await assert.rejects(unmanaged.updateTicket(ticket("7", "technical_approval")), /not managed \(missing label "ai-team"\)/);
    assert.deepEqual(unmanagedSeen.map((request) => request.method), ["GET"], "read-only proof, no PATCH");

    const prSeen: GitHubIssuesHttpRequest[] = [];
    const pr = createGitHubIssuesTicketSink(
      baseOptions({ getBody: { ...storedIssue(7), pull_request: { url: "https://api.github.com/pr/7" } } }, prSeen),
    );
    await assert.rejects(pr.updateTicket(ticket("7", "technical_approval")), /is a pull request/);
    assert.deepEqual(prSeen.map((request) => request.method), ["GET"]);

    for (const id of ["abc", "7a", "", " 7 "] as never[]) {
      const seen: GitHubIssuesHttpRequest[] = [];
      const sink = createGitHubIssuesTicketSink(baseOptions({}, seen));
      await assert.rejects(sink.updateTicket(ticket(id, "technical_approval")), /invalid ticket/, `id ${JSON.stringify(id)}`);
      assert.deepEqual(seen, [], "identity rejected before HTTP");
    }
    const malformedSeen: GitHubIssuesHttpRequest[] = [];
    const malformed = createGitHubIssuesTicketSink(baseOptions({}, malformedSeen));
    await assert.rejects(
      malformed.updateTicket({ id: "7", title: "", description: "d", requirements: "r", state: "technical_approval" }),
      /invalid ticket/,
    );
    assert.deepEqual(malformedSeen, [], "malformed ticket rejected before HTTP");
  });

  it("HTTP failures are bounded with exactly one attempt each", async () => {
    const getCases: Array<[number, RegExp]> = [
      [401, /authentication failed \(status 401\)/],
      [403, /authentication failed \(status 403\)/],
      [404, /issue not found/],
      [410, /issue gone/],
      [422, /request rejected \(status 422\)/],
      [500, /server failure \(status 500\)/],
    ];
    for (const [status, pattern] of getCases) {
      const seen: GitHubIssuesHttpRequest[] = [];
      const sink = createGitHubIssuesTicketSink(baseOptions({ getStatus: status }, seen));
      await assert.rejects(sink.updateTicket(ticket("7", "failed")), pattern, `GET status ${String(status)}`);
      assert.deepEqual(seen.map((request) => request.method), ["GET"], "no mutation after failed read, no retry");
    }
    const patchSeen: GitHubIssuesHttpRequest[] = [];
    const patchFail = createGitHubIssuesTicketSink(baseOptions({ patchStatus: 503 }, patchSeen));
    await assert.rejects(patchFail.updateTicket(ticket("7", "failed")), /server failure \(status 503\)/);
    assert.deepEqual(patchSeen.map((request) => request.method), ["GET", "PATCH"], "no retry, no compensating mutation");
    const offlineSeen: GitHubIssuesHttpRequest[] = [];
    const offline = createGitHubIssuesTicketSink(baseOptions({ failPatch: true }, offlineSeen));
    await assert.rejects(offline.updateTicket(ticket("7", "failed")), /github issues sink: request failed/);
    const wrongIssueSeen: GitHubIssuesHttpRequest[] = [];
    const wrongIssue = createGitHubIssuesTicketSink(baseOptions({ patchBody: storedIssue(8) }, wrongIssueSeen));
    await assert.rejects(wrongIssue.updateTicket(ticket("7", "failed")), /updated wrong issue/);
    const malformedSeen: GitHubIssuesHttpRequest[] = [];
    const malformed = createGitHubIssuesTicketSink(baseOptions({ getBody: [storedIssue(7)] }, malformedSeen));
    await assert.rejects(malformed.updateTicket(ticket("7", "failed")), /must be an object/);
  });

  it("errors never expose the credential", async () => {
    const seen: GitHubIssuesHttpRequest[] = [];
    const sink = createGitHubIssuesTicketSink(baseOptions({ getStatus: 403 }, seen));
    await assert.rejects(sink.updateTicket(ticket("7", "failed")), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes("secret-token"));
      assert.ok(!JSON.stringify(error).includes("secret-token"));
      assert.ok(!error.message.includes("User body"), "no response body in errors");
      return true;
    });
  });

  it("R-008 composition drives the concrete sink on normal and rework paths", async () => {
    const agent: AgentProvider<string> = {
      name: "fake-opencode",
      execute: async () => "Shipped; gates pass.",
    };
    for (const ticketState of ["ready", "changes_requested"] as const) {
      const seen: GitHubIssuesHttpRequest[] = [];
      const tickets: CoordinatorTicket[] = [{
        id: "7",
        title: "Work 7",
        description: "Description for 7.",
        requirements: "Requirements for 7.",
        state: ticketState,
        ...(ticketState === "changes_requested" ? { feedback: "Tighten it." } : {}),
      }];
      const result = await runProductionCoordinatorFromSource({
        ticketSource: { listTickets: async () => tickets },
        ticketSink: createGitHubIssuesTicketSink(baseOptions({ getBody: storedIssue(7) }, seen)),
        specialty: "backend",
        openCodeAgent: agent,
        project_root: "/proj",
        timeout_ms: 5000,
        reviewDecision: "approved",
      });
      assert.equal(result.outcome, "completed", `path from ${ticketState}`);
      assert.ok(result.outcome === "completed" && result.final_state === "technical_approval");
      assert.deepEqual(seen.map((request) => request.method), ["GET", "PATCH"], "one read, one mutation");
      assert.deepEqual(patchPayload(seen), { labels: ["ai-team", "priority:high", "ai-team:technical_approval"] });
      assert.equal(tickets[0].state, "technical_approval");
    }
  });

  it("sink owns GitHub details only", () => {
    const sinkCode = readFileSync(join(__dirname, "..", "..", "src", "providers", "github-sink.ts"), "utf8");
    const code = sinkCode.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(
      importedModules.sort(),
      ["../runtime/coordinator", "../runtime/ticket-sink", "../workflow/states", "./github-issues"],
      "ticket types/guards plus R-009 transport only",
    );
    assert.ok(!/"POST"|"PUT"|"DELETE"/.test(code), "single PATCH mutation only");
    assert.ok(!/comments\//.test(code), "no comment endpoint");
    assert.ok(!/\/pulls/.test(code), "no pull-request API");
    assert.ok(!/TicketSource|listTickets|poll|webhook|queue|outbox/i.test(code), "no read engine or queue");
    assert.ok(!/runCoordinator|resolveImplementer|resolveSeniorReviewer|isValidTransition/i.test(code), "no orchestration");
    assert.ok(!/loadConfig|validateConfig|FrameworkConfig|process\.env/i.test(code), "no configuration access");
    assert.ok(!/delegate|skill|fleet|lane|model|session|relay|opencode|spec-kit|specify/i.test(code), "no delegate or provider logic");
    assert.ok(!/setTimeout|setInterval|retry|backoff|schedule|rollback|transaction/i.test(code), "no retry or rollback machinery");
    assert.ok(!/console\.|process\.stdout/i.test(code), "nothing logged");
    assert.ok(!/gh\b|child_process|\bspawn\b|execFile|execSync/i.test(code.replace(/github/gi, "")), "no CLI or subprocess");
    const appCode = readFileSync(join(__dirname, "..", "..", "src", "runtime", "application.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/github/i.test(appCode), "application runtime unchanged by the concrete sink");
    const coordinatorCode = readFileSync(join(__dirname, "..", "..", "src", "runtime", "coordinator.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/sink|updateTicket|github/i.test(coordinatorCode), "Coordinator stays sink-blind");
    const sourceCode = readFileSync(join(__dirname, "..", "..", "src", "providers", "github-issues.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/sink|PATCH/i.test(sourceCode), "TicketSource unchanged by the sink");
  });
});
