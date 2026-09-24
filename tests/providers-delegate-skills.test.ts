import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { isDelegateProvider } from "../src/providers/delegate";
import {
  DELEGATE_PROVIDER_NAME,
  DELEGATE_SKILLS_COMMAND,
  DelegateSpawnFunction,
  DelegateSpawnedProcess,
  DelegateOutputStream,
  createDelegateSkillsProvider,
} from "../src/providers/delegate-skills";

// Delegate-skills adapter tests: fake launcher only, never a real process.
interface Call {
  command: string;
  args: readonly string[];
  options: { shell: false };
}

class FakeChild implements DelegateSpawnedProcess {
  readonly stdout: DelegateOutputStream = {
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

function fakeLauncher(calls: Call[], behavior: (child: FakeChild) => void): DelegateSpawnFunction {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const child = new FakeChild();
    behavior(child);
    return child;
  };
}

function succeed(child: FakeChild): void {
  queueMicrotask(() => {
    child.emitData(Buffer.from("handled "));
    child.emitData("done");
    child.finish(0);
  });
}

describe("delegate-skills adapter", () => {
  it("exposes the stable provider name and satisfies the generic contract", () => {
    assert.equal(DELEGATE_PROVIDER_NAME, "delegate");
    assert.equal(DELEGATE_SKILLS_COMMAND, "delegate-skills");
    assert.equal(isDelegateProvider(createDelegateSkillsProvider()), true);
  });

  it("invokes the capability command with the task as an argument", async () => {
    const calls: Call[] = [];
    const provider = createDelegateSkillsProvider(fakeLauncher(calls, succeed));
    assert.deepEqual(await provider.delegate({ task: "migrate data" }), { outcome: "handled done" });
    assert.deepEqual(calls, [{ command: "delegate-skills", args: ["migrate data"], options: { shell: false } }]);
  });

  it("passes task and context positionally with no invented flags", async () => {
    const calls: Call[] = [];
    const provider = createDelegateSkillsProvider(fakeLauncher(calls, succeed));
    await provider.delegate({ task: "migrate data", context: "shop repo" });
    assert.deepEqual(calls[0]?.args, ["migrate data", "shop repo"]);
    assert.ok(!(calls[0]?.args.some((arg) => arg.startsWith("-")) ?? false), "no flags");
  });

  it("passes texts through unmodified and maps output to the generic result", async () => {
    const calls: Call[] = [];
    const provider = createDelegateSkillsProvider(fakeLauncher(calls, succeed));
    const task = "  spaced  \"quoted\" $task  ";
    assert.deepEqual(await provider.delegate({ task }), { outcome: "handled done" });
    assert.equal(calls[0]?.args[0], task);
  });

  it("rejects invalid requests without launching", async () => {
    const calls: Call[] = [];
    const provider = createDelegateSkillsProvider(fakeLauncher(calls, succeed));
    await assert.rejects(provider.delegate({ task: "" }), /delegate provider: invalid input/);
    assert.equal(calls.length, 0);
  });

  it("rejects on non-zero exit with exactly one attempt", async () => {
    const calls: Call[] = [];
    const provider = createDelegateSkillsProvider(
      fakeLauncher(calls, (child) => {
        queueMicrotask(() => child.finish(1));
      }),
    );
    await assert.rejects(provider.delegate({ task: "migrate data" }), /exited with code 1/);
    assert.equal(calls.length, 1);
  });

  it("rejects on spawn errors and on launch throws", async () => {
    const calls: Call[] = [];
    const erroring = createDelegateSkillsProvider(
      fakeLauncher(calls, (child) => {
        queueMicrotask(() => child.fail(new Error("boom")));
      }),
    );
    await assert.rejects(erroring.delegate({ task: "migrate data" }), /process error/);
    const throwing = createDelegateSkillsProvider(() => {
      throw new Error("boom");
    });
    await assert.rejects(throwing.delegate({ task: "migrate data" }), /failed to start process/);
    assert.equal(calls.length, 1);
  });

  it("rejects empty output instead of inventing an outcome", async () => {
    const calls: Call[] = [];
    const provider = createDelegateSkillsProvider(
      fakeLauncher(calls, (child) => {
        queueMicrotask(() => child.finish(0));
      }),
    );
    await assert.rejects(provider.delegate({ task: "migrate data" }), /unexpected result/);
    assert.equal(calls.length, 1);
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/delegate-skills");
    assert.deepEqual(Object.keys(module).sort(), [
      "DELEGATE_PROVIDER_NAME",
      "DELEGATE_SKILLS_COMMAND",
      "createDelegateSkillsProvider",
    ]);
  });

  it("adds no selection, routing, config, workflow, or foreign coupling", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(
      join(__dirname, "..", "..", "src", "providers", "delegate-skills.ts"),
      "utf8",
    );
    assert.ok(!/opencode|github|gitlab|jira|octokit|speckit/i.test(code), "no foreign provider");
    assert.ok(!/regist|singleton|select|rout|fallback|confirm|enabl|config|argv/i.test(code), "no selection or config");
    assert.ok(!/workflow|transition|approval/i.test(code), "no workflow coupling");
    assert.ok(!/fetch\(|http:|socket/i.test(code), "no network");
    assert.ok(!/retry|backoff|setTimeout|setInterval/i.test(code), "no retry or timing");
    assert.ok(!/comment|delete|reopen|poll|webhook/i.test(code), "no lifecycle or sync extras");
  });
});
