import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { isIssueProvider } from "../src/providers/issue";
import { LOCAL_ISSUE_PROVIDER_NAME, createLocalIssueProvider } from "../src/providers/local-issue";

// Local fallback tests: in-memory only, never the network.
describe("local fallback issue provider", () => {
  it("satisfies the generic contract with the local identity", () => {
    assert.equal(LOCAL_ISSUE_PROVIDER_NAME, "local");
    const provider = createLocalIssueProvider();
    assert.equal(isIssueProvider(provider), true);
    assert.equal(provider.name, "local");
    assert.equal(typeof provider.create, "function");
    assert.equal(typeof provider.update, "function");
    assert.equal(typeof provider.complete, "function");
  });

  it("creates entries with deterministic runtime-local identifiers", async () => {
    const provider = createLocalIssueProvider();
    const first = await provider.create({ title: "A", description: "Da" });
    const second = await provider.create({ title: "B", description: "Db", requirements: "R" });
    assert.deepEqual(first, { id: "local-1" });
    assert.deepEqual(second, { id: "local-2" });
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(second), true);
  });

  it("rejects invalid creation input without storing", async () => {
    const provider = createLocalIssueProvider();
    await assert.rejects(provider.create({ title: "", description: "D" }), /invalid input/);
    await assert.rejects(provider.create({ title: "T", description: "D", requirements: "" }), /invalid input/);
    const reference = await provider.create({ title: "T", description: "D" });
    assert.deepEqual(reference, { id: "local-1" });
  });

  it("merges partial updates while preserving the rest", async () => {
    const provider = createLocalIssueProvider();
    const update = provider.update ?? assert.fail("update missing");
    const reference = await provider.create({ title: "A", description: "Da", requirements: "Ra" });
    assert.deepEqual(await update(reference, { title: "B" }), reference);
    assert.deepEqual(await update(reference, { requirements: "Rb" }), reference);
    assert.deepEqual(await update(reference, { description: "Db" }), reference);
    await assert.rejects(update(reference, {}), /invalid input/);
    await assert.rejects(update(reference, { title: "" }), /invalid input/);
  });

  it("completes entries idempotently by reference", async () => {
    const provider = createLocalIssueProvider();
    const complete = provider.complete ?? assert.fail("complete missing");
    const reference = await provider.create({ title: "A", description: "Da" });
    assert.deepEqual(await complete(reference), reference);
    assert.deepEqual(await complete(reference), reference);
  });

  it("rejects unknown references without side effects", async () => {
    const provider = createLocalIssueProvider();
    const update = provider.update ?? assert.fail("update missing");
    const complete = provider.complete ?? assert.fail("complete missing");
    await assert.rejects(update({ id: "local-9" }, { title: "T" }), /unknown issue/);
    await assert.rejects(complete({ id: "local-9" }), /unknown issue/);
    await assert.rejects(complete({ id: "" }), /invalid input/);
    const reference = await provider.create({ title: "T", description: "D" });
    assert.deepEqual(reference, { id: "local-1" });
  });

  it("keeps provider instances independent", async () => {
    const first = createLocalIssueProvider();
    const second = createLocalIssueProvider();
    assert.deepEqual(await first.create({ title: "A", description: "Da" }), { id: "local-1" });
    assert.deepEqual(await second.create({ title: "B", description: "Db" }), { id: "local-1" });
    const completeSecond = second.complete ?? assert.fail("complete missing");
    assert.deepEqual(await completeSecond({ id: "local-1" }), { id: "local-1" });
    const updateFirst = first.update ?? assert.fail("update missing");
    assert.deepEqual(await updateFirst({ id: "local-1" }, { title: "A2" }), { id: "local-1" });
  });

  it("never mutates caller inputs and freezes outputs", async () => {
    const provider = createLocalIssueProvider();
    const request = Object.freeze({ title: "A", description: "Da" });
    const before = JSON.stringify(request);
    const reference = await provider.create(request);
    assert.equal(JSON.stringify(request), before);
    assert.equal(Object.isFrozen(reference), true);
    const update = provider.update ?? assert.fail("update missing");
    const change = Object.freeze({ title: "B" });
    await update(reference, change);
    assert.equal(JSON.stringify(change), JSON.stringify({ title: "B" }));
    assert.throws(() => {
      (reference as { id?: string }).id = "changed";
    });
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/local-issue");
    assert.deepEqual(Object.keys(module).sort(), ["LOCAL_ISSUE_PROVIDER_NAME", "createLocalIssueProvider"]);
  });

  it("touches no tracker, transport, selection, or foreign domain", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "providers", "local-issue.ts"), "utf8");
    assert.ok(!/github|octokit|gitlab|jira/i.test(code), "no tracker");
    assert.ok(!/fetch\(|http|node:/i.test(code), "no transport");
    assert.ok(!/token|credential|oauth|api[_-]?key|password/i.test(code), "no secrets");
    assert.ok(!/synchroniz|poll|webhook/i.test(code), "no synchronization");
    assert.ok(!/comment|delete|reopen|\bclose\b/i.test(code), "no lifecycle extras");
    assert.ok(!/retry|backoff/i.test(code), "no retry");
    assert.ok(!/workflow\/|planning\/|state-map|specification/i.test(code), "no foreign domain");
  });
});
