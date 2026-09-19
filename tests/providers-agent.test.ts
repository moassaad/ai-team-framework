import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  AgentInvocation,
  AgentProvider,
  isAgentProvider,
  validateAgentInvocation,
} from "../src/providers/agent";

// Provider-contract tests only: shape, validation, and boundary.
// No implementation, execution, or external access.
describe("agent provider contract", () => {
  it("validates and freezes a generic invocation request", () => {
    assert.deepEqual(validateAgentInvocation({ prompt: "do it", project_root: "/proj" }), {
      prompt: "do it",
      project_root: "/proj",
    });
    assert.equal(Object.isFrozen(validateAgentInvocation({ prompt: "do it", project_root: "/proj" })), true);
    for (const data of [
      null,
      "x",
      [],
      {},
      { prompt: "", project_root: "/proj" },
      { prompt: "do it", project_root: "" },
      { prompt: 7, project_root: "/proj" },
      { prompt: "do it" },
      { project_root: "/proj" },
    ]) {
      assert.throws(() => validateAgentInvocation(data), /agent provider: invalid invocation/);
    }
  });

  it("accepts a minimal fake provider and supports async execution", async () => {
    const seen: AgentInvocation[] = [];
    const fake: AgentProvider<string> = {
      name: "fake",
      execute: async (request) => {
        seen.push(request);
        return `done: ${request.prompt}`;
      },
    };
    assert.equal(isAgentProvider(fake), true);
    const request = validateAgentInvocation({ prompt: "do it", project_root: "/proj" });
    assert.equal(await fake.execute(request), "done: do it");
    assert.deepEqual(seen, [request]);
    assert.equal(isAgentProvider(null), false);
    assert.equal(isAgentProvider({}), false);
    assert.equal(isAgentProvider({ name: "", execute: async () => 1 }), false);
    assert.equal(isAgentProvider({ name: "x" }), false);
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/agent");
    assert.deepEqual(Object.keys(module).sort(), [
      "isAgentProvider",
      "validateAgentInvocation",
    ]);
  });

  it("mentions no external tool, transport, offering, or role machinery", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "providers", "agent.ts"), "utf8");
    assert.ok(!/opencode/i.test(code), "no OpenCode coupling");
    assert.ok(!/child_process|execSync|spawn|fetch\(|http:|https:|node:/.test(code), "no transport");
    assert.ok(!/\bmodel\b|\btoken\b|temperature|api[_-]?key/i.test(code), "no offering specifics");
    assert.ok(!/RoleId|responsib|workflow|approval/i.test(code), "no role/workflow embedding");
  });

  it("embeds no prompt rendering, result expansion, timeout, or retry", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "providers", "agent.ts"), "utf8");
    assert.ok(!/render/i.test(code), "prompt rendering belongs to O-003");
    assert.ok(!/exit_code|stdout|stderr|duration/i.test(code), "result shape belongs to O-004");
    assert.ok(!/timeout|retry|abort/i.test(code), "failure handling belongs to O-005");
    assert.ok(!/regist|singleton|inject/i.test(code), "no registry or container");
  });
});