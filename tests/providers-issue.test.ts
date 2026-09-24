import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  IssueProvider,
  IssueReference,
  IssueRequest,
  isIssueProvider,
  validateIssueReference,
  validateIssueRequest,
  validateIssueUpdate,
} from "../src/providers/issue";

// Issue-provider tests: contract shape only, no tracker.
describe("issue provider contract", () => {
  it("validates and freezes requests and references", () => {
    const request = validateIssueRequest({
      title: "Catalog",
      description: "List products.",
      requirements: "Build a shop.",
    });
    assert.deepEqual(request, {
      title: "Catalog",
      description: "List products.",
      requirements: "Build a shop.",
    });
    assert.equal(Object.isFrozen(request), true);
    assert.deepEqual(validateIssueRequest({ title: "T", description: "D" }), {
      title: "T",
      description: "D",
    });
    const reference = validateIssueReference({ id: "abc-123" });
    assert.deepEqual(reference, { id: "abc-123" });
    assert.equal(Object.isFrozen(reference), true);
    for (const data of [
      null,
      "x",
      [],
      {},
      { title: "", description: "D" },
      { title: "T", description: "" },
      { title: "T" },
      { description: "D" },
      { title: "T", description: "D", requirements: "" },
      { title: "T", description: "D", requirements: 7 },
    ]) {
      assert.throws(() => validateIssueRequest(data), /issue provider: invalid input/);
    }
    for (const data of [null, {}, { id: "" }, { id: 7 }]) {
      assert.throws(() => validateIssueReference(data), /issue provider: invalid input/);
    }
  });

  it("accepts a fake provider and supports async creation", async () => {
    const seen: IssueRequest[] = [];
    const fake: IssueProvider = {
      name: "fake",
      create: async (request) => {
        seen.push(request);
        const reference: IssueReference = { id: `issue-for-${request.title}` };
        return validateIssueReference(reference);
      },
    };
    assert.equal(isIssueProvider(fake), true);
    const request = validateIssueRequest({ title: "Catalog", description: "List products." });
    assert.deepEqual(await fake.create(request), { id: "issue-for-Catalog" });
    assert.deepEqual(seen, [request]);
    assert.equal(isIssueProvider(null), false);
    assert.equal(isIssueProvider({}), false);
    assert.equal(isIssueProvider({ name: "", create: async () => ({ id: "x" }) }), false);
    assert.equal(isIssueProvider({ name: "x" }), false);
  });

  it("round-trips plain serializable data", () => {
    const request = validateIssueRequest({ title: "T", description: "D", requirements: "R" });
    assert.deepEqual(JSON.parse(JSON.stringify(request)), { title: "T", description: "D", requirements: "R" });
    assert.deepEqual(JSON.parse(JSON.stringify(validateIssueReference({ id: "x" }))), { id: "x" });
  });

  it("validates partial updates and freezes them", () => {
    assert.deepEqual(validateIssueUpdate({ title: "T", description: "D", requirements: "R" }), {
      title: "T",
      description: "D",
      requirements: "R",
    });
    assert.deepEqual(validateIssueUpdate({ title: "T" }), { title: "T" });
    assert.deepEqual(validateIssueUpdate({ requirements: "R" }), { requirements: "R" });
    assert.equal(Object.isFrozen(validateIssueUpdate({ title: "T" })), true);
    assert.deepEqual(JSON.parse(JSON.stringify(validateIssueUpdate({ title: "T" }))), { title: "T" });
    for (const data of [
      null,
      "x",
      [],
      {},
      { title: "" },
      { description: "" },
      { requirements: "" },
      { title: 7 },
      { description: "D", requirements: 7 },
      { state: "open" },
    ]) {
      assert.throws(() => validateIssueUpdate(data), /issue provider: invalid input/);
    }
  });

  it("supports an optional update operation without breaking creation", async () => {
    const seen: Array<{ reference: IssueReference; update: unknown }> = [];
    const fake: IssueProvider = {
      name: "fake",
      create: async (request) => validateIssueReference({ id: `issue-for-${request.title}` }),
      update: async (reference, update) => {
        seen.push({ reference, update });
        return validateIssueReference(reference);
      },
    };
    assert.equal(isIssueProvider(fake), true);
    assert.deepEqual(await fake.update?.({ id: "7" }, { title: "T2" }), { id: "7" });
    assert.deepEqual(seen, [{ reference: { id: "7" }, update: { title: "T2" } }]);
    const createOnly: IssueProvider = {
      name: "create-only",
      create: async () => validateIssueReference({ id: "x" }),
    };
    assert.equal(isIssueProvider(createOnly), true);
    assert.equal(createOnly.update, undefined);
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/issue");
    assert.deepEqual(Object.keys(module).sort(), [
      "isIssueProvider",
      "validateIssueReference",
      "validateIssueRequest",
      "validateIssueUpdate",
    ]);
  });

  it("names no tracker, transport, auth, or workflow concept", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "providers", "issue.ts"), "utf8");
    assert.ok(!/github|octokit|gitlab|jira/i.test(code), "no tracker naming");
    assert.ok(!/child_process|execSync|spawn|fetch\(|http:|https:|node:/.test(code), "no transport");
    assert.ok(!/token|api[_-]?key|password|credential|oauth|auth/i.test(code), "no auth");
    assert.ok(!/ready|in_progress|closed|blocked|workflow/i.test(code), "no workflow coupling");
  });

  it("exposes no URL, number, state, label, or timestamp fields", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "providers", "issue.ts"), "utf8");
    assert.ok(!/url|number|state|label|milestone|timestamp|uuid/i.test(code), "no tracker fields");
  });

  it("adds no sync, comment, close, retry, or lifecycle vocabulary", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "providers", "issue.ts"), "utf8");
    assert.ok(!/sync|poll|webhook/i.test(code), "no synchronization");
    assert.ok(!/comment|close|reopen|delete/i.test(code), "no lifecycle operations");
    assert.ok(!/retry|backoff/i.test(code), "no retry");
  });
});