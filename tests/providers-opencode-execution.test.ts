import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentProvider, isAgentProvider } from "../src/providers/agent";
import { ExecutionResult, validateExecutionResult } from "../src/providers/result";
import {
  OutputStream,
  SpawnFunction,
  SpawnedProcess,
  createOpenCodeProvider,
} from "../src/providers/opencode";
import { createOpenCodeExecutionProvider } from "../src/providers/opencode-execution";
import { createProductionCoordinatorDeps } from "../src/runtime/production";
import { runCoordinatorTicket } from "../src/runtime/coordinator";
import { CoordinatorTicket } from "../src/runtime/coordinator";

// OpenCode ExecutionResult boundary tests (M18 R-005): the adapter
// wraps string-yielding providers without reimplementing them. The
// real OpenCode provider (fake launcher only, never a process)
// proves consumption; counting fakes prove single-call,
// failure, and determinism semantics.

class FakeChild implements SpawnedProcess {
  readonly stdout: OutputStream = {
    on: (event: "data", listener: (chunk: Buffer | string) => void): void => {
      void event;
      this.dataListeners.push(listener);
    },
  };
  private dataListeners: Array<(chunk: Buffer | string) => void> = [];
  private closeListeners: Array<(code: number | null) => void> = [];
  private errorListeners: Array<(error: Error) => void> = [];

  on(event: "close", listener: (code: number | null) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: string, listener: (...args: never[]) => void): void {
    if (event === "close") {
      this.closeListeners.push(listener as unknown as (code: number | null) => void);
    } else {
      this.errorListeners.push(listener as unknown as (error: Error) => void);
    }
  }

  emitData(chunk: Buffer | string): void {
    for (const listener of this.dataListeners) {
      listener(chunk);
    }
  }

  finish(code: number | null): void {
    for (const listener of this.closeListeners) {
      listener(code);
    }
  }

  fail(error: Error): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }
}

interface SpawnCall {
  command: string;
  args: readonly string[];
}

function realOpenCode(calls: SpawnCall[], chunks: (Buffer | string)[], code: number | null): AgentProvider<string> {
  const launcher: SpawnFunction = (command, args, options) => {
    calls.push({ command, args });
    void options;
    const child = new FakeChild();
    queueMicrotask(() => {
      for (const chunk of chunks) {
        child.emitData(chunk);
      }
      child.finish(code);
    });
    return child;
  };
  return createOpenCodeProvider(launcher);
}

function countingString(calls: string[], behavior: () => Promise<string>): AgentProvider<string> {
  return {
    name: "counting-string",
    execute: async (invocation) => {
      calls.push(invocation.prompt);
      return behavior();
    },
  };
}

function ticket(id: string, state: "ready" | "changes_requested", feedback?: string): CoordinatorTicket {
  return {
    id,
    title: `Work ${id}`,
    description: `Description for ${id}.`,
    requirements: `Requirements for ${id}.`,
    state,
    ...(feedback !== undefined ? { feedback } : {}),
  };
}

describe("opencode execution boundary", () => {
  it("consumes the existing OpenCode provider without reimplementing it", async () => {
    const calls: SpawnCall[] = [];
    const adapted = createOpenCodeExecutionProvider(realOpenCode(calls, ["did ", "the thing"], 0));
    const result = await adapted.execute({ prompt: "Do it.", project_root: "/proj" });
    assert.deepEqual(result, { status: "succeeded", text: "did the thing" });
    assert.deepEqual(calls, [{ command: "opencode", args: ["run", "Do it."] }], "provider owns CLI invocation");
    assert.equal(adapted.name, "opencode-execution");
    assert.ok(isAgentProvider(adapted));
  });

  it("maps success to exactly succeeded with byte-identical text", async () => {
    const text = "  done ✓\nlines\tpreserved  ";
    const adapted = createOpenCodeExecutionProvider({ name: "s", execute: async () => text });
    const result = await adapted.execute({ prompt: "p", project_root: "/proj" });
    assert.equal(result.status, "succeeded");
    assert.equal(result.text, text);
    assert.deepEqual(result, validateExecutionResult(result));
    assert.ok(Object.isFrozen(result));
  });

  it("propagates provider rejection identical and never as success", async () => {
    const original = new Error("opencode provider: process error");
    const calls: string[] = [];
    const adapted = createOpenCodeExecutionProvider(
      countingString(calls, () => Promise.reject<string>(original)),
    );
    await assert.rejects(adapted.execute({ prompt: "p", project_root: "/proj" }), (error: unknown) => error === original);
    assert.deepEqual(calls, ["p"], "exactly one underlying call, no retry");
  });

  it("rejects empty and non-string resolutions with the existing bounded error", async () => {
    for (const value of ["", 42, null, undefined]) {
      const adapted = createOpenCodeExecutionProvider({ name: "s", execute: async () => value as never as string });
      await assert.rejects(
        adapted.execute({ prompt: "p", project_root: "/proj" }),
        /execution result: invalid result \(text must be a non-empty string\)/,
        JSON.stringify(value),
      );
    }
  });

  it("validates construction and invocation before running", async () => {
    assert.throws(() => createOpenCodeExecutionProvider({ name: "broken" } as never), /agent must satisfy the agent provider contract/);
    const adapted = createOpenCodeExecutionProvider({ name: "s", execute: async () => "ok" });
    await assert.rejects(adapted.execute({ prompt: "", project_root: "/proj" }), /prompt must be a non-empty string/);
    await assert.rejects(adapted.execute("nope" as never), /expected an object/);
  });

  it("is deterministic and stateless", async () => {
    const calls: string[] = [];
    const adapted = createOpenCodeExecutionProvider(countingString(calls, async () => "same"));
    const first = await adapted.execute({ prompt: "p", project_root: "/proj" });
    const second = await adapted.execute({ prompt: "p", project_root: "/proj" });
    assert.deepEqual(first, second);
    assert.deepEqual(calls, ["p", "p"]);
  });

  it("same adapted provider serves both R-004 role references", async () => {
    const calls: SpawnCall[] = [];
    const adapted = createOpenCodeExecutionProvider(realOpenCode(calls, ["shipped"], 0));
    const deps = createProductionCoordinatorDeps({
      specialty: "backend",
      implementerProvider: adapted,
      reviewerProvider: adapted,
    });
    const tickets = [ticket("T-001", "ready")];
    const result = await runCoordinatorTicket({
      tickets,
      roles: deps.roles,
      project_root: "/proj",
      timeout_ms: 5000,
      decideReview: async () => ({ decision: "approved" }),
    });
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.final_state === "technical_approval");
    assert.deepEqual(calls.length, 2, "one implementer + one reviewer call, no retry");
    assert.equal(tickets[0].state, "technical_approval");
  });

  it("R-001 and R-002 runtimes work end to end through the adapted provider", async () => {
    const makeDeps = () => {
      const adapted = createOpenCodeExecutionProvider({ name: "opencode", execute: async () => "Work complete; gates pass." });
      return createProductionCoordinatorDeps({
        specialty: "testing",
        implementerProvider: adapted,
        reviewerProvider: adapted,
      });
    };
    const fresh = await runCoordinatorTicket({
      tickets: [ticket("T-001", "ready")],
      roles: makeDeps().roles,
      project_root: "/proj",
      timeout_ms: 5000,
      decideReview: async () => ({ decision: "approved" }),
    });
    assert.equal(fresh.outcome, "completed");
    const reworkTickets = [ticket("T-002", "changes_requested", "Tighten the assertion.")];
    const rework = await runCoordinatorTicket({
      tickets: reworkTickets,
      roles: makeDeps().roles,
      project_root: "/proj",
      timeout_ms: 5000,
      decideReview: async () => ({ decision: "approved" }),
    });
    assert.equal(rework.outcome, "completed");
    assert.ok(rework.outcome === "completed" && rework.final_state === "technical_approval");
    assert.equal(reworkTickets[0].state, "technical_approval");
  });

  it("keeps contracts intact and provider specifics out of runtime", () => {
    assert.ok(isAgentProvider(createOpenCodeProvider()));
    assert.deepEqual(validateExecutionResult({ status: "succeeded", text: "t" }), { status: "succeeded", text: "t" });
    const source = readFileSync(join(__dirname, "..", "..", "src", "providers", "opencode-execution.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(importedModules.sort(), ["./agent", "./result"], "contracts only, never the provider");
    assert.ok(!/child_process|spawn|exec\(|shell|opencode run/i.test(code), "no process execution");
    assert.ok(!/interface AgentProvider|interface ExecutionResult/i.test(code), "no contract redefinition");
    assert.ok(!/skill|fleet|lane|model|session|relay/i.test(code), "no delegate specifics");
    assert.ok(!/loadConfig|validateConfig|FrameworkConfig|enabled/i.test(code), "no configuration");
    assert.ok(!/\bgit\b|commit|merge|branch/i.test(code), "no git");
    assert.ok(!/retry|backoff|poll\b|setTimeout|setInterval/i.test(code), "no retries");
    for (const file of ["runtime/coordinator.ts", "runtime/roles.ts", "runtime/production.ts"]) {
      const runtime = readFileSync(join(__dirname, "..", "..", "src", file), "utf8");
      assert.ok(!/opencode-execution|createOpenCodeExecutionProvider/i.test(runtime.replace(/\/\*[\s\S]*?\*\//g, "")), `${file} stays provider-neutral`);
    }
  });
});
