import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { AgentProvider, isAgentProvider } from "../src/providers/agent";
import {
  EXECUTION_STATUSES,
  ExecutionResult,
  executionResultFromText,
  isExecutionStatus,
  validateExecutionResult,
} from "../src/providers/result";

// Execution-result tests: contract shape only, no provider execution.
describe("execution result contract", () => {
  it("constructs and validates a minimal successful result", () => {
    assert.deepEqual(EXECUTION_STATUSES, ["succeeded"]);
    assert.equal(isExecutionStatus("succeeded"), true);
    assert.equal(isExecutionStatus("failed"), false);
    const result = validateExecutionResult({ status: "succeeded", text: "done" });
    assert.deepEqual(result, { status: "succeeded", text: "done" });
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(executionResultFromText("hello"), { status: "succeeded", text: "hello" });
  });

  it("rejects malformed results and ignores unknown extras", () => {
    for (const data of [
      null,
      "done",
      [],
      {},
      { status: "failed", text: "done" },
      { status: "closed", text: "done" },
      { status: "succeeded", text: "" },
      { status: "succeeded" },
      { text: "done" },
      { status: "succeeded", text: 7 },
    ]) {
      assert.throws(() => validateExecutionResult(data), /execution result: invalid result/);
    }
    assert.deepEqual(
      validateExecutionResult({ status: "succeeded", text: "done", exit_code: 0, model: "x" }),
      { status: "succeeded", text: "done" },
    );
    assert.throws(() => executionResultFromText(""), /invalid result/);
  });

  it("is plain serializable data with no host metadata", () => {
    const result = executionResultFromText("done");
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: "succeeded", text: "done" });
    assert.ok(!/created_at|duration|execution_id|uuid|hostname|process_id|cwd/i.test(JSON.stringify(result)));
  });

  it("fits the generic provider contract and O-002's string output", async () => {
    const provider: AgentProvider<ExecutionResult> = {
      name: "fake",
      execute: async (request) => executionResultFromText(`done: ${request.prompt}`),
    };
    assert.equal(isAgentProvider(provider), true);
    const result = await provider.execute({ prompt: "do it", project_root: "/proj" });
    assert.deepEqual(result, { status: "succeeded", text: "done: do it" });
    // O-002 migration path: raw string output normalizes without re-running
    assert.deepEqual(executionResultFromText("raw provider text"), {
      status: "succeeded",
      text: "raw provider text",
    });
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/result");
    assert.deepEqual(Object.keys(module).sort(), [
      "EXECUTION_STATUSES",
      "executionResultFromText",
      "isExecutionStatus",
      "validateExecutionResult",
    ]);
  });

  it("contains no provider specifics, policy, or workflow coupling", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "providers", "result.ts"), "utf8");
    assert.ok(!/opencode/i.test(code), "no provider coupling");
    assert.ok(!/stdout|stderr|exit_code|signal|token|cost|session/i.test(code), "no provider fields");
    assert.ok(!/setTimeout|AbortController|timeout|retry|backoff|kill/i.test(code), "no policy (O-005)");
    assert.ok(!/"failed"|"blocked"|"closed"|"needs_user_input"/.test(code), "no workflow states");
    assert.ok(!/child_process|spawn|fetch\(|http|node:/i.test(code), "no execution");
  });
});