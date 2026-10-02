import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isWorkflowState } from "../src/workflow/states";
import { isTicket } from "../src/runtime/coordinator";
import { isTicketSource } from "../src/runtime/ticket-source";
import {
  GitHubIssue,
  GitHubIssuesHttpRequest,
  GitHubIssuesHttpResponse,
  GitHubIssuesSourceOptions,
  createGitHubIssuesTicketSource,
} from "../src/providers/github-issues";

// GitHub Issues TicketSource tests (M18 R-009): read-only
// repository bridge behind an injected transport. No network,
// no token file, no configuration, no Git, no delegate, no
// sink, no runtime wiring anywhere.

interface Script {
  pages: unknown[];
  statuses?: number[];
  failAt?: number;
}

function issue(number: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number,
    title: `Work ${String(number)}`,
    body: `Description for ${String(number)}.\n\n## Requirements\n\nRequirements for ${String(number)}.`,
    state: "open",
    labels: [{ name: "ai-team" }],
    ...overrides,
  };
}

function fakeTransport(script: Script, seen: GitHubIssuesHttpRequest[]): (request: GitHubIssuesHttpRequest) => Promise<GitHubIssuesHttpResponse> {
  let calls = 0;
  return async (request) => {
    seen.push(request);
    calls += 1;
    if (script.failAt !== undefined && calls >= script.failAt) {
      throw new Error("socket hang up");
    }
    const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
    const status = script.statuses?.[page - 1] ?? 200;
    return { status, body: script.pages[page - 1] ?? [] };
  };
}

const readyState = (): "ready" => "ready";

function baseOptions(
  script: Script,
  seen: GitHubIssuesHttpRequest[],
  overrides: Partial<GitHubIssuesSourceOptions> = {},
): GitHubIssuesSourceOptions {
  return {
    owner: "acme",
    repo: "widgets",
    token: "secret-token",
    managedLabel: "ai-team",
    parseState: readyState,
    transport: fakeTransport(script, seen),
    ...overrides,
  };
}

describe("github issues ticket source", () => {
  it("constructs a valid TicketSource with explicit inputs", async () => {
    const seen: GitHubIssuesHttpRequest[] = [];
    const source = createGitHubIssuesTicketSource(baseOptions({ pages: [[]] }, seen));
    assert.ok(isTicketSource(source), "satisfies the generic TicketSource contract");
    assert.deepEqual(await source.listTickets(), []);
    assert.equal(seen.length, 1, "one repository request for one-page result");
  });

  it("invalid factory inputs fail before any HTTP", async () => {
    const seen: GitHubIssuesHttpRequest[] = [];
    const transport = fakeTransport({ pages: [[]] }, seen);
    const valid: GitHubIssuesSourceOptions = {
      owner: "acme",
      repo: "widgets",
      token: "secret-token",
      managedLabel: "ai-team",
      parseState: readyState,
      transport,
    };
    const bad: Array<[string, Partial<GitHubIssuesSourceOptions>]> = [
      ["empty owner", { owner: "" }],
      ["slash owner", { owner: "a/b" }],
      ["empty repo", { repo: "" }],
      ["empty token", { token: "" }],
      ["empty label", { managedLabel: "" }],
      ["bad lifecycle", { issueState: "half" as never }],
      ["missing decoder", { parseState: undefined as never }],
      ["bad feedback decoder", { parseFeedback: "x" as never }],
      ["bad transport", { transport: "x" as never }],
    ];
    for (const [name, override] of bad) {
      assert.throws(() => createGitHubIssuesTicketSource({ ...valid, ...override }), /github issues source: invalid options/, name);
    }
    assert.throws(() => createGitHubIssuesTicketSource("nope" as never), /expected an options object/);
    assert.deepEqual(seen, [], "no HTTP before valid construction");
  });

  it("pages sequentially until a short page", async () => {
    const seen: GitHubIssuesHttpRequest[] = [];
    const full = Array.from({ length: 100 }, (_, index) => issue(index + 1));
    const source = createGitHubIssuesTicketSource(
      baseOptions({ pages: [full, [issue(101), issue(102)]] }, seen),
    );
    const tickets = await source.listTickets();
    assert.deepEqual(tickets.map((ticket) => ticket.id).slice(0, 3), ["1", "2", "3"]);
    assert.equal(tickets.length, 102);
    assert.equal(seen.length, 2, "two GET requests, one source operation");
    const urls = seen.map((request) => new URL(request.url));
    assert.deepEqual(urls.map((url) => url.searchParams.get("page")), ["1", "2"]);
    for (const params of urls.map((url) => url.searchParams)) {
      assert.equal(params.get("per_page"), "100", "full pages minimize requests");
    }
  });

  it("exact page-size boundary terminates on the following empty page", async () => {
    const seen: GitHubIssuesHttpRequest[] = [];
    const full = Array.from({ length: 100 }, (_, index) => issue(index + 1));
    const source = createGitHubIssuesTicketSource(baseOptions({ pages: [full, []] }, seen));
    const tickets = await source.listTickets();
    assert.equal(tickets.length, 100);
    assert.equal(seen.length, 2, "full page continues, empty page stops");
    assert.equal(tickets[99].id, "100");
  });

  it("empty repository result is an empty source", async () => {
    const seen: GitHubIssuesHttpRequest[] = [];
    const source = createGitHubIssuesTicketSource(baseOptions({ pages: [[]] }, seen));
    assert.deepEqual(await source.listTickets(), []);
    assert.equal(seen.length, 1);
  });

  it("pull requests are excluded without a PR API call", async () => {
    const seen: GitHubIssuesHttpRequest[] = [];
    const source = createGitHubIssuesTicketSource(
      baseOptions({ pages: [[issue(1, { pull_request: { url: "https://api.github.com/pr/1" } }), issue(2)]] }, seen),
    );
    const tickets = await source.listTickets();
    assert.deepEqual(tickets.map((ticket) => ticket.id), ["2"]);
    assert.ok(seen.every((request) => !request.url.includes("/pulls")), "no pull-request API queried");
  });

  it("request shape is read-only with server-side managed-label filtering", async () => {
    const seen: GitHubIssuesHttpRequest[] = [];
    const source = createGitHubIssuesTicketSource(
      baseOptions({ pages: [[issue(1)]] }, seen, { managedLabel: "team: backend" }),
    );
    await source.listTickets();
    assert.equal(seen.length, 1);
    const request = seen[0];
    const url = new URL(request.url);
    assert.equal(url.origin + url.pathname, "https://api.github.com/repos/acme/widgets/issues");
    assert.equal(request.method, "GET");
    assert.equal(request.body, undefined, "no body on reads");
    assert.equal(url.searchParams.get("labels"), "team: backend", "endpoint filters, not memory");
    assert.equal(url.searchParams.get("state"), "open", "lifecycle default is explicit");
    assert.equal(request.headers["Accept"], "application/vnd.github+json");
    assert.equal(request.headers["X-GitHub-Api-Version"], "2022-11-28");
    assert.equal(request.headers["Authorization"], "Bearer secret-token", "credential sent");
  });

  it("issue fields map through the adapter boundary exactly", async () => {
    const seen: GitHubIssuesHttpRequest[] = [];
    const raw = issue(7, {
      title: "  Spaced title stays  ",
      body: "Line one.\n  Line two with trailing spaces.   \n\n## Requirements\n\nStep 1.\n\nStep 2.",
    });
    const source = createGitHubIssuesTicketSource(baseOptions({ pages: [[raw]] }, seen));
    const [ticket] = await source.listTickets();
    assert.equal(ticket.id, "7", "number becomes identity");
    assert.equal(ticket.title, "  Spaced title stays  ", "title preserved exactly");
    assert.equal(ticket.description, "Line one.\n  Line two with trailing spaces.", "description text preserved");
    assert.equal(ticket.requirements, "Step 1.\n\nStep 2.", "requirements section recovered");
    assert.equal(ticket.state, "ready");
    assert.ok(!("pull_request" in ticket), "no GitHub residue leaks into the ticket");
    assert.ok(isTicket(ticket), "result satisfies existing Coordinator validation");
  });

  it("state decoding is explicit and malformed mappings fail safely", async () => {
    const seen: GitHubIssuesHttpRequest[] = [];
    const decodes = new Map<number, string>([
      [1, "in_progress"],
      [2, "changes_requested"],
    ]);
    const source = createGitHubIssuesTicketSource(
      baseOptions({ pages: [[issue(1), issue(2)]] }, seen, {
        parseState: (entry: GitHubIssue) => decodes.get(entry.number) as never,
        parseFeedback: () => "Reviewer notes.",
      }),
    );
    const tickets = await source.listTickets();
    assert.deepEqual(tickets.map((ticket) => [ticket.id, ticket.state]), [["1", "in_progress"], ["2", "changes_requested"]]);
    assert.equal(tickets[1].feedback, "Reviewer notes.");
    assert.deepEqual(seen.length, 1, "order preserved, no resorting or prioritization");

    const badState = createGitHubIssuesTicketSource(
      baseOptions({ pages: [[issue(9)]] }, [], { parseState: (() => "eventually") as never }),
    );
    await assert.rejects(badState.listTickets(), /state mapping failed for issue #9/);
    const throwing = createGitHubIssuesTicketSource(
      baseOptions({ pages: [[issue(9)]] }, [], {
        parseState: () => {
          throw new Error("no marker");
        },
      }),
    );
    await assert.rejects(throwing.listTickets(), /state mapping failed for issue #9 \(no marker\)/);
    const silentRework = createGitHubIssuesTicketSource(
      baseOptions({ pages: [[issue(9)]] }, [], { parseState: (() => "changes_requested") as () => never }),
    );
    await assert.rejects(silentRework.listTickets(), /#9.*without feedback/, "no executable rework without feedback");
    const noRequirements = createGitHubIssuesTicketSource(
      baseOptions({ pages: [[issue(9, { body: "Just prose, no section." })]] }, seen),
    );
    await assert.rejects(noRequirements.listTickets(), /no explicit requirements section/, "requirements never fabricated");
  });

  it("malformed issue shapes fail safely", async () => {
    const cases: Array<[string, unknown, RegExp]> = [
      ["non-array list", { tickets: [] }, /must be an array/],
      ["non-object entry", [42], /must be an object/],
      ["bad number", [issue(0)], /valid numeric issue number/],
      ["missing title", [issue(1, { title: "" })], /without a title/],
      ["non-string state", [issue(1, { state: 7 })], /state must be a string/],
      ["non-text body", [issue(1, { body: 7 })], /must be text/],
      ["malformed labels", [issue(1, { labels: "ai-team" })], /labels must be an array/],
      ["malformed label entry", [issue(1, { labels: [42] })], /malformed issue label/],
      ["empty description", [issue(1, { body: "\n\n## Requirements\n\nDo it." })], /has no description/],
    ];
    for (const [name, body, pattern] of cases) {
      const source = createGitHubIssuesTicketSource(baseOptions({ pages: [body] }, []));
      await assert.rejects(source.listTickets(), pattern, name);
    }
  });

  it("HTTP failures are bounded and never become empty sources", async () => {
    const cases: Array<[number, RegExp]> = [
      [401, /authentication failed \(status 401\)/],
      [403, /authentication failed \(status 403\)/],
      [404, /repository not found/],
      [422, /request rejected \(status 422\)/],
      [500, /server failure \(status 500\)/],
      [301, /request failed with status 301/],
    ];
    for (const [status, pattern] of cases) {
      const seen: GitHubIssuesHttpRequest[] = [];
      const source = createGitHubIssuesTicketSource(
        baseOptions({ pages: [[]], statuses: [status] }, seen),
      );
      await assert.rejects(source.listTickets(), pattern, `status ${String(status)}`);
      assert.equal(seen.length, 1, `status ${String(status)}: no retry`);
    }
    const seen: GitHubIssuesHttpRequest[] = [];
    const offline = createGitHubIssuesTicketSource(baseOptions({ pages: [[]], failAt: 1 }, seen));
    await assert.rejects(offline.listTickets(), /github issues source: request failed/, "transport rejection is bounded");
    assert.equal(seen.length, 1, "no retry after transport failure");
  });

  it("errors never expose the credential", async () => {
    const seen: GitHubIssuesHttpRequest[] = [];
    const source = createGitHubIssuesTicketSource(
      baseOptions({ pages: [[]], statuses: [403] }, seen),
    );
    await assert.rejects(source.listTickets(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes("secret-token"), "token absent from message");
      assert.ok(!JSON.stringify(error).includes("secret-token"), "token absent from serialized error");
      return true;
    });
  });

  it("repeated calls are stateless and transport-injectable", async () => {
    const seen: GitHubIssuesHttpRequest[] = [];
    const source = createGitHubIssuesTicketSource(baseOptions({ pages: [[issue(1)]] }, seen));
    const first = await source.listTickets();
    const second = await source.listTickets();
    assert.deepEqual(first.map((ticket) => ticket.id), ["1"]);
    assert.deepEqual(second.map((ticket) => ticket.id), ["1"]);
    assert.ok(first[0] !== second[0], "fresh objects per call, no cache");
    assert.equal(seen.length, 2, "each call re-reads");
  });

  it("adapter owns GitHub details only", () => {
    const sourceCode = readFileSync(join(__dirname, "..", "..", "src", "providers", "github-issues.ts"), "utf8");
    const code = sourceCode.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(
      importedModules.sort(),
      ["../runtime/coordinator", "../runtime/ticket-source", "../workflow/states"],
      "TicketSource + ticket type/validation only",
    );
    assert.ok(!/child_process|\bspawn\b|execFile|execSync|\bgh\b/i.test(code), "no CLI or subprocess");
    assert.ok(!/TicketSink|updateTicket/i.test(code), "no sink interaction");
    assert.ok(!/runCoordinator|resolveImplementer|resolveSeniorReviewer|isValidTransition/i.test(code), "no orchestration");
    assert.ok(!/loadConfig|validateConfig|FrameworkConfig|process\.env/i.test(code), "no configuration access");
    assert.ok(!/delegate|skill|fleet|lane|model|session|relay|opencode|spec-kit|specify/i.test(code), "no delegate or provider logic");
    assert.ok(!/setTimeout|setInterval|retry|backoff|poll|schedule|while|cache/i.test(code), "no retry, scheduler, or cache");
    assert.ok(!/sdk|octokit|graphql/i.test(code), "no third-party GitHub SDK");
    assert.ok(!/console\.|process\.stdout/i.test(code), "nothing logged, token never printed");
    const dependencies = (JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    }).dependencies ?? {};
    assert.ok(
      !Object.keys(dependencies).some((name) => /octokit|github|rest|graphql|sdk/i.test(name)),
      "no GitHub SDK dependency introduced",
    );
    assert.ok(code.includes('"GET"'), "read method present");
    assert.ok(!/"POST"|"PATCH"|"PUT"|"DELETE"/.test(code), "no write HTTP methods exist");
  });
});
