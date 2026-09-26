import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentProvider } from "../src/providers/agent";
import { ImplementerSpecialty } from "../src/roles/contract";
import {
  OutputStream,
  SpawnedProcess,
  createOpenCodeProvider,
} from "../src/providers/opencode";
import { runProductionCoordinator } from "../src/runtime/application";
import { CoordinatorTicket } from "../src/runtime/coordinator";

// Production application boundary tests (M18 R-006): one composed
// operation from an explicit OpenCode string agent to a
// Coordinator result. Agents are hermetic fakes, except one test
// wiring the real OpenCode provider (fake launcher, never a
// process). No CLI, store, scheduler, or persistence anywhere.

interface StringCounts {
  calls: string[];
}

function fakeStringAgent(calls: StringCounts, behavior: () => Promise<string>): AgentProvider<string> {
  return {
    name: "fake-opencode",
    execute: async (invocation) => {
      calls.calls.push(invocation.prompt);
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

function baseInput(
  calls: StringCounts,
  overrides: {
    tickets?: CoordinatorTicket[];
    specialty?: ImplementerSpecialty;
    behavior?: () => Promise<string>;
    agent?: AgentProvider<string>;
    reviewDecision?: "approved" | "changes_requested";
    reviewFeedback?: string;
  } = {},
): Parameters<typeof runProductionCoordinator>[0] {
  return {
    tickets: overrides.tickets ?? [ticket("T-001", "ready")],
    specialty: overrides.specialty ?? "backend",
    openCodeAgent: overrides.agent ?? fakeStringAgent(calls, overrides.behavior ?? (async () => "Shipped; gates pass.")),
    project_root: "/proj",
    timeout_ms: 5000,
    reviewDecision: overrides.reviewDecision ?? "approved",
    ...(overrides.reviewFeedback !== undefined ? { reviewFeedback: overrides.reviewFeedback } : {}),
  };
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

  run(chunks: (Buffer | string)[], code: number | null): void {
    queueMicrotask(() => {
      for (const chunk of chunks) {
        for (const listener of this.dataListeners) {
          listener(chunk);
        }
      }
      for (const listener of this.closeListeners) {
        listener(code);
      }
    });
  }
}

describe("production application boundary", () => {
  it("constructs valid production dependencies and reaches technical approval", async () => {
    const calls: StringCounts = { calls: [] };
    const tickets = [ticket("T-001", "ready")];
    const result = await runProductionCoordinator(baseInput(calls, { tickets }));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.final_state === "technical_approval");
    assert.equal(tickets[0].state, "technical_approval");
    assert.deepEqual(calls.calls.length, 2, "one implementer + one reviewer call");
  });

  it("wraps the real OpenCode provider through the R-005 adapter", async () => {
    const seen: string[] = [];
    const agent = createOpenCodeProvider((command, args, options) => {
      seen.push(`${command} ${args.join(" ")}`);
      void options;
      const child = new FakeChild();
      child.run(["real opencode output"], 0);
      return child;
    });
    const calls: StringCounts = { calls: [] };
    const result = await runProductionCoordinator(baseInput(calls, { agent }));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.implementation.text === "real opencode output");
    assert.equal(seen.length, 2);
    assert.ok(seen.every((call) => call.startsWith("opencode run ")), "provider owns CLI invocation");
  });

  it("adapted provider reaches both role references with the explicit specialty", async () => {
    const calls: StringCounts = { calls: [] };
    const result = await runProductionCoordinator(
      baseInput(calls, { specialty: "testing", behavior: async () => "Done." }),
    );
    assert.equal(result.outcome, "completed");
    assert.deepEqual(calls.calls.length, 2);
    assert.ok(result.outcome === "completed" && result.implementation.text === "Done.");
    assert.ok(result.outcome === "completed" && result.report === "Done.", "shared provider serves reviewer too");
  });

  it("rework still reaches technical approval through the composed boundary", async () => {
    const calls: StringCounts = { calls: [] };
    const tickets = [ticket("T-001", "changes_requested", "Tighten it.")];
    const result = await runProductionCoordinator(baseInput(calls, { tickets }));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.final_state === "technical_approval");
    assert.equal(tickets[0].state, "technical_approval");
    assert.deepEqual(calls.calls.length, 2);
  });

  it("one-ticket guarantee holds with non-selected tickets untouched", async () => {
    const calls: StringCounts = { calls: [] };
    const tickets = [ticket("T-001", "ready"), ticket("T-002", "ready")];
    const result = await runProductionCoordinator(baseInput(calls, { tickets }));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.ticket_id === "T-001");
    assert.equal(tickets[1].state, "ready");
    assert.deepEqual(calls.calls.length, 2, "single ticket, single cycle");
  });

  it("provider failure reaches the Coordinator unchanged, never as success", async () => {
    const calls: StringCounts = { calls: [] };
    const tickets = [ticket("T-001", "ready")];
    const result = await runProductionCoordinator(
      baseInput(calls, {
        tickets,
        behavior: () => Promise.reject<string>(new Error("opencode provider: process error")),
      }),
    );
    assert.equal(result.outcome, "implementer-failed");
    assert.ok(result.outcome === "implementer-failed" && result.final_state === "failed");
    assert.equal(tickets[0].state, "failed");
    assert.deepEqual(calls.calls.length, 1, "no retry");
  });

  it("composition failure happens before any ticket execution", async () => {
    const calls: StringCounts = { calls: [] };
    const tickets = [ticket("T-001", "ready")];
    await assert.rejects(
      runProductionCoordinator(baseInput(calls, { tickets, agent: { name: "broken" } as never })),
      /agent must satisfy the agent provider contract/,
    );
    await assert.rejects(
      runProductionCoordinator(baseInput(calls, { tickets, specialty: "wizard" as never })),
      /unknown specialty/,
    );
    await assert.rejects(runProductionCoordinator("nope" as never), /expected an application input object/);
    assert.deepEqual(calls.calls, [], "nothing executed");
    assert.equal(tickets[0].state, "ready");
  });

  it("creates no store: caller collection is the only ticket state", async () => {
    const calls: StringCounts = { calls: [] };
    const tickets = [ticket("T-001", "ready")];
    const before = JSON.stringify(tickets.map(({ state, ...rest }) => rest));
    await runProductionCoordinator(baseInput(calls, { tickets }));
    assert.equal(JSON.stringify(tickets.map(({ state, ...rest }) => rest)), before, "only state advanced");
    assert.equal(tickets.length, 1, "no tickets created");
  });

  it("repeated construction is independent and stateless", async () => {
    const firstCalls: StringCounts = { calls: [] };
    const secondCalls: StringCounts = { calls: [] };
    const first = await runProductionCoordinator(baseInput(firstCalls, {}));
    const second = await runProductionCoordinator(
      baseInput(secondCalls, { tickets: [ticket("T-002", "ready")] }),
    );
    assert.deepEqual(first.outcome, second.outcome);
    assert.deepEqual(firstCalls.calls.length, 2);
    assert.deepEqual(secondCalls.calls.length, 2);
  });

  it("composition imports only the assembly seams", () => {
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "application.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(
      importedModules.sort(),
      [
        "../providers/agent",
        "../providers/opencode-execution",
        "../roles/contract",
        "./coordinator",
        "./production",
        "./ticket-sink",
        "./ticket-source",
      ],
      "OpenCode adapter + R-004 factory + Coordinator + source/sink boundaries + contracts only",
    );
    assert.ok(!/child_process|spawn|exec\(|shell|opencode run/i.test(code), "no process execution");
    assert.ok(!/delegate|skill|fleet|lane|model|session|relay/i.test(code), "no delegate discovery");
    assert.ok(!/loadConfig|validateConfig|FrameworkConfig|enabled/i.test(code), "no configuration");
    assert.ok(!/\bgit\b|commit|merge|branch/i.test(code), "no git");
    assert.ok(!/setTimeout|setInterval|retry|backoff|poll|while|schedule/i.test(code), "no scheduler or retries");
    assert.ok(!/TicketStore|TicketRepository|writeFile|mkdir|persist/i.test(code), "no ticket store");
    assert.ok(!/cli|run\(|status|setup/i.test(code.replace(/runCoordinatorTicket|runProductionCoordinator/g, "")), "no CLI");
    for (const file of ["runtime/coordinator.ts", "runtime/production.ts"]) {
      const runtime = readFileSync(join(__dirname, "..", "..", "src", file), "utf8");
      const runtimeCode = runtime.replace(/\/\*[\s\S]*?\*\//g, "");
      assert.ok(!/application|opencode/i.test(runtimeCode), `${file} stays composition-blind`);
    }
  });
});
