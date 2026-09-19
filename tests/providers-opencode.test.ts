import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { isAgentProvider } from "../src/providers/agent";
import {
  OPENCODE_COMMAND,
  OPENCODE_PROVIDER_NAME,
  OutputStream,
  SpawnFunction,
  SpawnedProcess,
  createOpenCodeProvider,
} from "../src/providers/opencode";

// OpenCode provider tests: fake launcher only, never a real process.
interface Call {
  command: string;
  args: readonly string[];
  options: { cwd: string; shell: false };
}

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

function fakeLauncher(calls: Call[], behavior: (child: FakeChild) => void): SpawnFunction {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const child = new FakeChild();
    behavior(child);
    return child;
  };
}

function succeed(child: FakeChild): void {
  queueMicrotask(() => {
    child.emitData(Buffer.from("hello "));
    child.emitData("world");
    child.finish(0);
  });
}

describe("opencode provider", () => {
  it("exposes the stable provider name and satisfies the generic contract", () => {
    assert.equal(OPENCODE_PROVIDER_NAME, "opencode");
    assert.equal(OPENCODE_COMMAND, "opencode");
    assert.equal(isAgentProvider(createOpenCodeProvider()), true);
  });

  it("invokes opencode run with the prompt as an argument and root as cwd", async () => {
    const calls: Call[] = [];
    const provider = createOpenCodeProvider(fakeLauncher(calls, succeed));
    await provider.execute({ prompt: "do it", project_root: "/proj" });
    assert.deepEqual(calls, [
      { command: "opencode", args: ["run", "do it"], options: { cwd: "/proj", shell: false } },
    ]);
  });

  it("passes the prompt through unmodified and resolves raw output", async () => {
    const calls: Call[] = [];
    const provider = createOpenCodeProvider(fakeLauncher(calls, succeed));
    const prompt = "  spaced  \"quoted\" $prompt  ";
    assert.equal(await provider.execute({ prompt, project_root: "/proj" }), "hello world");
    assert.equal(calls[0]?.args[1], prompt);
  });

  it("rejects on non-zero exit with exactly one attempt", async () => {
    const calls: Call[] = [];
    const provider = createOpenCodeProvider(
      fakeLauncher(calls, (child) => {
        queueMicrotask(() => child.finish(1));
      }),
    );
    await assert.rejects(provider.execute({ prompt: "do it", project_root: "/proj" }), /exited with code 1/);
    assert.equal(calls.length, 1);
  });

  it("rejects on spawn errors and on launch throws", async () => {
    const calls: Call[] = [];
    const erroring = createOpenCodeProvider(
      fakeLauncher(calls, (child) => {
        queueMicrotask(() => child.fail(new Error("boom")));
      }),
    );
    await assert.rejects(erroring.execute({ prompt: "do it", project_root: "/proj" }), /process error/);
    const throwing = createOpenCodeProvider(() => {
      throw new Error("nope");
    });
    await assert.rejects(throwing.execute({ prompt: "do it", project_root: "/proj" }), /failed to start/);
    assert.equal(calls.length, 1);
  });

  it("rejects invalid invocations without launching", async () => {
    const calls: Call[] = [];
    const provider = createOpenCodeProvider(fakeLauncher(calls, succeed));
    await assert.rejects(provider.execute({ prompt: "", project_root: "/proj" }), /invalid invocation/);
    await assert.rejects(provider.execute({ prompt: "do it", project_root: "" }), /invalid invocation/);
    assert.equal(calls.length, 0);
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/opencode");
    assert.deepEqual(Object.keys(module).sort(), [
      "OPENCODE_COMMAND",
      "OPENCODE_PROVIDER_NAME",
      "createOpenCodeProvider",
    ]);
  });

  it("adds no timeout, second attempts, rendering, result schema, or environment access", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "providers", "opencode.ts"), "utf8");
    assert.ok(!/setTimeout|AbortController|timeout/i.test(code), "no timeout (O-005)");
    assert.ok(!/retry|backoff|attempt/i.test(code.replace(/single attempt per `execute\(\)` call,/i, "")), "no second attempts");
    assert.ok(!/render|template/i.test(code), "no prompt rendering (O-003)");
    assert.ok(!/stdout:\s*string|stderr:\s*string|exit_code|token|model|session/i.test(code), "no result schema (O-004)");
    assert.ok(!/shell:\s*true|sh -c|env\b|process\.env/i.test(code), "no shell or environment access");
    assert.ok(!/readFileSync|writeFileSync|mkdir/i.test(code), "no file creation");
  });
});