import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { AgentInvocation, AgentProvider } from "../src/providers/agent";
import { ExecutionResult, executionResultFromText } from "../src/providers/result";
import { isSpecificationProvider } from "../src/providers/specification";
import { SPECKIT_PROVIDER_NAME, createSpecKitProvider } from "../src/providers/speckit";

// Spec Kit adapter tests: fake agent only, never an external setup.
function fakeAgent(
  calls: AgentInvocation[],
  behavior: (request: AgentInvocation) => Promise<ExecutionResult>,
): AgentProvider<ExecutionResult> {
  return {
    name: "fake-agent",
    execute: async (request) => {
      calls.push(request);
      return behavior(request);
    },
  };
}

function succeed(text: string): (request: AgentInvocation) => Promise<ExecutionResult> {
  return async () => executionResultFromText(text);
}

describe("spec kit adapter", () => {
  it("satisfies the generic contract with the adapter identity", () => {
    assert.equal(SPECKIT_PROVIDER_NAME, "spec-kit");
    const adapter = createSpecKitProvider(fakeAgent([], succeed("# S")));
    assert.equal(isSpecificationProvider(adapter), true);
    assert.equal(adapter.name, "spec-kit");
  });

  it("maps specification and plan requests to distinct operations", async () => {
    for (const artifact of ["specification", "plan"] as const) {
      const calls: AgentInvocation[] = [];
      const adapter = createSpecKitProvider(fakeAgent(calls, succeed(`# ${artifact}`)));
      const result = await adapter.generate({
        requirements: "Build a shop.",
        project_root: "/proj",
        artifact,
      });
      assert.equal(result.artifact, artifact);
      assert.equal(result.content, `# ${artifact}`);
      assert.equal(calls.length, 1);
      assert.ok(calls[0]?.prompt.includes(`Spec Kit ${artifact}`), artifact);
      assert.ok(
        calls[0]?.prompt.includes(artifact === "plan" ? "plan operation" : "specify operation"),
        artifact,
      );
    }
  });

  it("preserves requirements verbatim and passes the project root through", async () => {
    const calls: AgentInvocation[] = [];
    const adapter = createSpecKitProvider(fakeAgent(calls, succeed("# S")));
    const requirements = 'Build a "quoted" $shop with\nmultiple lines.';
    await adapter.generate({ requirements, project_root: "/proj", artifact: "specification" });
    assert.ok(calls[0]?.prompt.includes(requirements));
    assert.equal(calls[0]?.project_root, "/proj");
  });

  it("propagates provider rejections unchanged with one attempt", async () => {
    const calls: AgentInvocation[] = [];
    const failure = new Error("agent unavailable");
    const adapter = createSpecKitProvider(
      fakeAgent(calls, async () => {
        throw failure;
      }),
    );
    await assert.rejects(
      adapter.generate({ requirements: "Build.", project_root: "/proj", artifact: "plan" }),
      (error: unknown) => error === failure,
    );
    assert.equal(calls.length, 1);
  });

  it("rejects invalid requests and empty agent output without extra calls", async () => {
    const calls: AgentInvocation[] = [];
    const adapter = createSpecKitProvider(fakeAgent(calls, succeed("")));
    await assert.rejects(
      adapter.generate({ requirements: "", project_root: "/proj", artifact: "plan" }),
      /invalid input/,
    );
    await assert.rejects(
      adapter.generate({
        requirements: "Build.",
        project_root: "/proj",
        artifact: "tasks" as unknown as "plan",
      }),
      /invalid input/,
    );
    assert.equal(calls.length, 0);
  });

  it("leaks no transport fields into the artifact", async () => {
    const calls: AgentInvocation[] = [];
    const adapter = createSpecKitProvider(fakeAgent(calls, succeed("content")));
    const result = await adapter.generate({
      requirements: "Build.",
      project_root: "/proj",
      artifact: "specification",
    });
    assert.deepEqual(Object.keys(result).sort(), ["artifact", "content"]);
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/speckit");
    assert.deepEqual(Object.keys(module).sort(), ["SPECKIT_PROVIDER_NAME", "createSpecKitProvider"]);
  });

  it("adds no execution, installation, fallback, or external integration", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "providers", "speckit.ts"), "utf8");
    assert.ok(!/child_process|execSync|spawn|fetch\(|http|node:/i.test(code), "no direct execution");
    assert.ok(!/install|uvx|bootstrap|init|detect/i.test(code), "no setup behavior");
    assert.ok(!/github|issue/i.test(code), "no issue tracking");
    assert.ok(!/checklist|tasks|analyze|implement|constitution|clarify/i.test(code), "no extra lifecycle");
    assert.ok(!/cli|workflow|config|regist/i.test(code), "no surrounding integration");
  });
});