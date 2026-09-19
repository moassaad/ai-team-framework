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

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/issue");
    assert.deepEqual(Object.keys(module).sort(), [
      "isIssueProvider",
      "validateIssueReference",
      "validateIssueRequest",
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
});