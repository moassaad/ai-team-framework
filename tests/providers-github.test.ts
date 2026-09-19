import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { isIssueProvider } from "../src/providers/issue";
import {
  GITHUB_PROVIDER_NAME,
  HttpRequest,
  HttpResponse,
  createGitHubIssueProvider,
} from "../src/providers/github";

// GitHub adapter tests: fake transport only, never the network.
function fakeTransport(
  calls: HttpRequest[],
  behavior: (request: HttpRequest) => Promise<HttpResponse>,
): (request: HttpRequest) => Promise<HttpResponse> {
  return async (request) => {
    calls.push(request);
    return behavior(request);
  };
}

function created(number: number): (request: HttpRequest) => Promise<HttpResponse> {
  return async () => ({ status: 201, body: { number } });
}

describe("github issues adapter", () => {
  it("satisfies the generic contract with the adapter identity", () => {
    assert.equal(GITHUB_PROVIDER_NAME, "github");
    const provider = createGitHubIssueProvider({ owner: "o", repo: "r", token: "t" });
    assert.equal(isIssueProvider(provider), true);
    assert.equal(provider.name, "github");
  });

  it("maps title, description, and requirements into the creation payload", async () => {
    const calls: HttpRequest[] = [];
    const provider = createGitHubIssueProvider({
      owner: "example",
      repo: "shop",
      token: "secret-token",
      transport: fakeTransport(calls, created(7)),
    });
    const reference = await provider.create({
      title: "Catalog",
      description: "List products.",
      requirements: "Build a shop.",
    });
    assert.deepEqual(reference, { id: "7" });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      url: "https://api.github.com/repos/example/shop/issues",
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: "Bearer secret-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Catalog",
        body: "List products.\n\n## Requirements\n\nBuild a shop.",
      }),
    });
  });

  it("omits the requirements section when absent", async () => {
    const calls: HttpRequest[] = [];
    const provider = createGitHubIssueProvider({
      owner: "o",
      repo: "r",
      token: "t",
      transport: fakeTransport(calls, created(1)),
    });
    await provider.create({ title: "T", description: "D" });
    assert.deepEqual(JSON.parse(calls[0]?.body ?? "{}"), { title: "T", body: "D" });
  });

  it("rejects ambiguous targets and bad options without calling", async () => {
    let launched = 0;
    const countingTransport = async (request: HttpRequest): Promise<HttpResponse> => {
      launched += 1;
      return created(1)(request);
    };
    for (const options of [
      null,
      {},
      { owner: "", repo: "r", token: "t" },
      { owner: "a/b", repo: "r", token: "t" },
      { owner: "o", repo: "", token: "t" },
      { owner: "o", repo: "r", token: "" },
      { owner: "o", repo: "r" },
    ]) {
      assert.throws(
        () => createGitHubIssueProvider(options as Parameters<typeof createGitHubIssueProvider>[0]),
        /github provider: invalid options/,
      );
    }
    assert.equal(launched, 0);
  });

  it("rejects invalid requests, failures, and malformed responses safely", async () => {
    const calls: HttpRequest[] = [];
    const provider = createGitHubIssueProvider({
      owner: "o",
      repo: "r",
      token: "secret-token",
      transport: fakeTransport(calls, async () => ({ status: 401, body: { message: "Bad credentials" } })),
    });
    await assert.rejects(provider.create({ title: "", description: "D" }), /invalid input/);
    const unauthorized = await provider.create({ title: "T", description: "D" }).then(
      () => assert.fail("must reject"),
      (error: unknown) => error as Error,
    );
    assert.equal(unauthorized.message, "github provider: request failed with status 401");
    assert.ok(!unauthorized.message.includes("secret-token"));
    assert.ok(!unauthorized.message.includes("Bad credentials"));

    const offline = createGitHubIssueProvider({
      owner: "o",
      repo: "r",
      token: "t",
      transport: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const offlineError = await offline.create({ title: "T", description: "D" }).then(
      () => assert.fail("must reject"),
      (error: unknown) => error as Error,
    );
    assert.equal(offlineError.message, "github provider: request failed");

    const broken = createGitHubIssueProvider({
      owner: "o",
      repo: "r",
      token: "t",
      transport: fakeTransport([], async () => ({ status: 201, body: { url: "x" } })),
    });
    await assert.rejects(broken.create({ title: "T", description: "D" }), /unexpected response/);
  });

  it("performs exactly one creation per call", async () => {
    const calls: HttpRequest[] = [];
    const provider = createGitHubIssueProvider({
      owner: "o",
      repo: "r",
      token: "t",
      transport: fakeTransport(calls, created(3)),
    });
    await provider.create({ title: "A", description: "B" });
    await provider.create({ title: "C", description: "D" });
    assert.equal(calls.length, 2);
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/github");
    assert.deepEqual(Object.keys(module).sort(), ["GITHUB_PROVIDER_NAME", "createGitHubIssueProvider"]);
  });

  it("adds no update, state, retry, or surrounding integration", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "providers", "github.ts"), "utf8");
    assert.ok(!/patch|put|delete|comment/i.test(code), "no modification behavior");
    assert.ok(!/setTimeout|retry|backoff/i.test(code), "no retry");
    assert.ok(!/label|milestone|assignee|project/i.test(code), "no tracker extras");
    assert.ok(!/workflow|approval|cli|regist/i.test(code), "no surrounding integration");
  });
});