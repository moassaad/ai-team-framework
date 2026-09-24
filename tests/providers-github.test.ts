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


// Require the optional update member for update-focused tests.
function requireUpdate(
  provider: ReturnType<typeof createGitHubIssueProvider>,
): NonNullable<ReturnType<typeof createGitHubIssueProvider>["update"]> {
  return provider.update ?? assert.fail("update missing");
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
        () =>
          createGitHubIssueProvider({
            ...(typeof options === "object" && options !== null ? options : {}),
            transport: countingTransport,
          } as Parameters<typeof createGitHubIssueProvider>[0]),
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

  it("exposes update on the provider without changing creation", async () => {
    const provider = createGitHubIssueProvider({ owner: "o", repo: "r", token: "t" });
    assert.equal(typeof provider.update, "function");
    assert.equal(isIssueProvider(provider), true);
  });

  it("maps a full update into one PATCH request", async () => {
    const calls: HttpRequest[] = [];
    const provider = createGitHubIssueProvider({
      owner: "example",
      repo: "shop",
      token: "secret-token",
      transport: fakeTransport(calls, async () => ({ status: 200, body: { number: 7 } })),
    });
    const update = requireUpdate(provider);
    const reference = await update(
      { id: "7" },
      { title: "Catalog v2", description: "List products.", requirements: "Build a shop." },
    );
    assert.deepEqual(reference, { id: "7" });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      url: "https://api.github.com/repos/example/shop/issues/7",
      method: "PATCH",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: "Bearer secret-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Catalog v2",
        body: "List products.\n\n## Requirements\n\nBuild a shop.",
      }),
    });
  });

  it("sends only supplied fields on partial updates", async () => {
    const calls: HttpRequest[] = [];
    const provider = createGitHubIssueProvider({
      owner: "o",
      repo: "r",
      token: "t",
      transport: fakeTransport(calls, async () => ({ status: 200, body: { number: 7 } })),
    });
    const update = requireUpdate(provider);
    await update({ id: "7" }, { title: "T2" });
    assert.deepEqual(JSON.parse(calls[0]?.body ?? "{}"), { title: "T2" });
    await update({ id: "7" }, { requirements: "R2" });
    assert.deepEqual(JSON.parse(calls[1]?.body ?? "{}"), { body: "## Requirements\n\nR2" });
    await update({ id: "7" }, { description: "D2" });
    assert.deepEqual(JSON.parse(calls[2]?.body ?? "{}"), { body: "D2" });
    assert.equal(calls.length, 3);
    for (const call of calls) {
      assert.equal(call.method, "PATCH");
      assert.ok(call.url.endsWith("/repos/o/r/issues/7"));
    }
  });

  it("rejects bad references and empty updates without calling", async () => {
    let launched = 0;
    const countingTransport = async (): Promise<HttpResponse> => {
      launched += 1;
      return { status: 200, body: { number: 7 } };
    };
    const provider = createGitHubIssueProvider({
      owner: "o",
      repo: "r",
      token: "t",
      transport: countingTransport,
    });
    const update = requireUpdate(provider);
    await assert.rejects(update({ id: "abc" }, { title: "T" }), /invalid reference/);
    await assert.rejects(update({ id: "7a" }, { title: "T" }), /invalid reference/);
    await assert.rejects(update({ id: "" }, { title: "T" }), /invalid input/);
    await assert.rejects(update({ id: "7" }, {}), /invalid input/);
    await assert.rejects(update({ id: "7" }, { title: "" }), /invalid input/);
    assert.equal(launched, 0);
  });

  it("rejects update failures safely with sanitized errors", async () => {
    const calls: HttpRequest[] = [];
    const provider = createGitHubIssueProvider({
      owner: "o",
      repo: "r",
      token: "secret-token",
      transport: fakeTransport(calls, async () => ({ status: 404, body: { message: "Not Found" } })),
    });
    const update = requireUpdate(provider);
    const missing = await update({ id: "7" }, { title: "T" }).then(
      () => assert.fail("must reject"),
      (error: unknown) => error as Error,
    );
    assert.equal(missing.message, "github provider: request failed with status 404");
    assert.ok(!missing.message.includes("secret-token"));
    assert.ok(!missing.message.includes("Not Found"));

    const offline = createGitHubIssueProvider({
      owner: "o",
      repo: "r",
      token: "t",
      transport: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const offlineUpdate = requireUpdate(offline);
    const offlineError = await offlineUpdate({ id: "7" }, { title: "T" }).then(
      () => assert.fail("must reject"),
      (error: unknown) => error as Error,
    );
    assert.equal(offlineError.message, "github provider: request failed");

    const broken = createGitHubIssueProvider({
      owner: "o",
      repo: "r",
      token: "t",
      transport: fakeTransport([], async () => ({ status: 200, body: { url: "x" } })),
    });
    const brokenUpdate = requireUpdate(broken);
    await assert.rejects(brokenUpdate({ id: "7" }, { title: "T" }), /unexpected response/);
  });

  it("performs exactly one update per call", async () => {
    const calls: HttpRequest[] = [];
    const provider = createGitHubIssueProvider({
      owner: "o",
      repo: "r",
      token: "t",
      transport: fakeTransport(calls, async () => ({ status: 200, body: { number: 9 } })),
    });
    const update = requireUpdate(provider);
    await update({ id: "9" }, { title: "A" });
    await update({ id: "9" }, { title: "B" });
    assert.equal(calls.length, 2);
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/github");
    assert.deepEqual(Object.keys(module).sort(), ["GITHUB_PROVIDER_NAME", "createGitHubIssueProvider"]);
  });

  it("adds no sync, retry, lifecycle, or surrounding integration", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "providers", "github.ts"), "utf8");
    assert.ok(!/put|delete|comment/i.test(code), "no modification behavior beyond PATCH");
    assert.ok(!/setTimeout|retry|backoff/i.test(code), "no retry");
    assert.ok(!/label|milestone|assignee|project/i.test(code), "no tracker extras");
    assert.ok(!/workflow|approval|cli|regist/i.test(code), "no surrounding integration");
    assert.ok(!/synchroniz|poll|webhook/i.test(code), "no synchronization");
    assert.ok(!/close|reopen/i.test(code), "no close/reopen lifecycle");
  });
});