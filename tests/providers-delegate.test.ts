import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  DelegateProvider,
  DelegationRequest,
  DelegationResult,
  isDelegateProvider,
  validateDelegationRequest,
  validateDelegationResult,
} from "../src/providers/delegate";

// Provider-contract tests only: shape, validation, and boundary.
// No implementation, delegation, or external access.
describe("delegate provider contract", () => {
  it("validates and freezes requests and results", () => {
    assert.deepEqual(validateDelegationRequest({ task: "migrate data", context: "shop repo" }), {
      task: "migrate data",
      context: "shop repo",
    });
    assert.deepEqual(validateDelegationRequest({ task: "migrate data" }), { task: "migrate data" });
    assert.equal(Object.isFrozen(validateDelegationRequest({ task: "migrate data" })), true);
    assert.deepEqual(validateDelegationResult({ outcome: "done" }), { outcome: "done" });
    assert.equal(Object.isFrozen(validateDelegationResult({ outcome: "done" })), true);
    for (const data of [
      null,
      "x",
      [],
      {},
      { task: "", context: "c" },
      { task: "t", context: "" },
      { task: 7 },
      { task: "t", context: 7 },
      { context: "c" },
    ]) {
      assert.throws(() => validateDelegationRequest(data), /delegate provider: invalid input/);
    }
    for (const data of [null, {}, { outcome: "" }, { outcome: 7 }]) {
      assert.throws(() => validateDelegationResult(data), /delegate provider: invalid input/);
    }
  });

  it("accepts a minimal fake provider and supports async delegation", async () => {
    const seen: DelegationRequest[] = [];
    const fake: DelegateProvider = {
      name: "fake",
      delegate: async (request) => {
        seen.push(request);
        const result: DelegationResult = { outcome: `handled: ${request.task}` };
        return validateDelegationResult(result);
      },
    };
    assert.equal(isDelegateProvider(fake), true);
    const request = validateDelegationRequest({ task: "migrate data" });
    assert.deepEqual(await fake.delegate(request), { outcome: "handled: migrate data" });
    assert.deepEqual(seen, [request]);
    assert.equal(isDelegateProvider(null), false);
    assert.equal(isDelegateProvider({}), false);
    assert.equal(isDelegateProvider({ name: "", delegate: async () => ({ outcome: "x" }) }), false);
    assert.equal(isDelegateProvider({ name: "x" }), false);
  });

  it("round-trips plain serializable data", () => {
    const request = validateDelegationRequest({ task: "t", context: "c" });
    assert.deepEqual(JSON.parse(JSON.stringify(request)), { task: "t", context: "c" });
    assert.deepEqual(JSON.parse(JSON.stringify(validateDelegationResult({ outcome: "o" }))), {
      outcome: "o",
    });
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/delegate");
    assert.deepEqual(Object.keys(module).sort(), [
      "isDelegateProvider",
      "validateDelegationRequest",
      "validateDelegationResult",
    ]);
  });

  it("names no delegation tool, transport, shell, config, or workflow concept", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "providers", "delegate.ts"), "utf8");
    assert.ok(!/skill/i.test(code), "no delegation-tool naming");
    assert.ok(!/child_process|execSync|spawn|shell/i.test(code), "no shell");
    assert.ok(!/fetch\(|http:|https:|node:/i.test(code), "no transport");
    assert.ok(!/process\.env|argv|\bcli\b|readFile|writeFile/i.test(code), "no environment, CLI, or files");
    assert.ok(!/token|api[_-]?key|password|credential|oauth/i.test(code), "no auth");
    assert.ok(!/workflow|transition|approval|sensitive/i.test(code), "no workflow coupling");
  });

  it("embeds no detection, selection, retry, persistence, or confirmation", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "providers", "delegate.ts"), "utf8");
    assert.ok(!/detect|install|enabl/i.test(code), "later-ticket concerns stay out");
    assert.ok(!/regist|singleton|select|rout/i.test(code), "no registry, selection, or routing");
    assert.ok(!/retry|backoff|setTimeout|setInterval/i.test(code), "no retry or timing");
    assert.ok(!/sqlite|database|mkdir|fallback|confirm/i.test(code), "no persistence, fallback, or confirmation");
    assert.ok(!/render|exit_code|stdout|stderr/i.test(code), "no result expansion");
  });
});
