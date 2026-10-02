import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentProvider } from "../src/providers/agent";
import { ExecutionResult } from "../src/providers/result";
import { ImplementerSpecialty } from "../src/roles/contract";
import {
  CoordinatorTicket,
  runCoordinatorTicket,
} from "../src/runtime/coordinator";
import { isRoleResolver } from "../src/runtime/roles";
import {
  createProductionCoordinatorDeps,
} from "../src/runtime/production";

// Production runtime assembly tests (M18 R-004): the factory binds
// explicit caller inputs into a frozen resolver. Providers are
// hermetic fakes — no production AgentProvider<ExecutionResult>
// factory exists to default to, and none is invented here. The
// OpenCode-shaped AgentProvider<string> boundary is proven as a
// failure, not bridged.

interface Counts {
  implementer: number;
  reviewer: number;
}

function freshCounts(): Counts {
  return { implementer: 0, reviewer: 0 };
}

function fakeProvider(counts: Counts, side: "implementer" | "reviewer", text: string): AgentProvider<ExecutionResult> {
  return {
    name: `fake-${side}`,
    execute: async () => {
      counts[side] += 1;
      return { status: "succeeded", text };
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

function depsInput(
  counts: Counts,
  overrides: {
    specialty?: unknown;
    implementerProvider?: unknown;
    reviewerProvider?: unknown;
  } = {},
): Parameters<typeof createProductionCoordinatorDeps>[0] {
  return {
    specialty: (overrides.specialty ?? "backend") as ImplementerSpecialty,
    implementerProvider: (overrides.implementerProvider ?? fakeProvider(counts, "implementer", "Implemented.")) as AgentProvider<ExecutionResult>,
    reviewerProvider: (overrides.reviewerProvider ?? fakeProvider(counts, "reviewer", "Clean.")) as AgentProvider<ExecutionResult>,
  };
}

describe("production runtime assembly", () => {
  it("constructs a valid resolver when all required inputs exist", async () => {
    const counts = freshCounts();
    const deps = createProductionCoordinatorDeps(depsInput(counts));
    assert.ok(isRoleResolver(deps.roles));
    assert.ok(Object.isFrozen(deps));
    const implementer = await deps.roles.resolveImplementer({ id: "T-1", title: "t", description: "d", requirements: "r" });
    const reviewer = await deps.roles.resolveSeniorReviewer({ id: "T-1", title: "t", description: "d", requirements: "r" });
    assert.equal(implementer.role, "implementer");
    assert.equal(reviewer.role, "senior-reviewer");
    assert.ok(Object.isFrozen(implementer));
    assert.ok(Object.isFrozen(reviewer));
  });

  it("passes the specialty through unchanged for every specialty", async () => {
    const counts = freshCounts();
    for (const specialty of ["backend", "frontend", "integration", "database", "testing", "documentation"] as const) {
      const deps = createProductionCoordinatorDeps(depsInput(counts, { specialty }));
      const reference = await deps.roles.resolveImplementer({ id: "T-1", title: "t", description: "d", requirements: "r" });
      assert.equal(reference.specialty, specialty);
    }
  });

  it("Implementer provider reaches the Coordinator execution seam", async () => {
    const counts = freshCounts();
    const deps = createProductionCoordinatorDeps(depsInput(counts));
    const result = await runCoordinatorTicket({
      tickets: [ticket("T-001", "ready")],
      roles: deps.roles,
      project_root: "/proj",
      timeout_ms: 5000,
      decideReview: async () => ({ decision: "approved" }),
    });
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.final_state === "technical_approval");
    assert.equal(counts.implementer, 1);
    assert.ok(result.outcome === "completed" && result.implementation.text === "Implemented.");
  });

  it("Reviewer provider reaches the Coordinator review seam", async () => {
    const counts = freshCounts();
    const deps = createProductionCoordinatorDeps(depsInput(counts));
    const result = await runCoordinatorTicket({
      tickets: [ticket("T-001", "ready")],
      roles: deps.roles,
      project_root: "/proj",
      timeout_ms: 5000,
      decideReview: async () => ({ decision: "approved" }),
    });
    assert.equal(result.outcome, "completed");
    assert.equal(counts.reviewer, 1);
    assert.ok(result.outcome === "completed" && result.report === "Clean.");
  });

  it("same provider for both roles remains legal", async () => {
    const counts = freshCounts();
    const shared = fakeProvider(counts, "implementer", "Shared.");
    const deps = createProductionCoordinatorDeps(depsInput(counts, { implementerProvider: shared, reviewerProvider: shared }));
    const result = await runCoordinatorTicket({
      tickets: [ticket("T-001", "ready")],
      roles: deps.roles,
      project_root: "/proj",
      timeout_ms: 5000,
      decideReview: async () => ({ decision: "approved" }),
    });
    assert.equal(result.outcome, "completed");
  });

  it("missing or invalid inputs fail before any ticket execution", async () => {
    const counts = freshCounts();
    assert.throws(() => createProductionCoordinatorDeps(depsInput(counts, { specialty: "wizard" })), /unknown specialty/);
    assert.throws(
      () => createProductionCoordinatorDeps(depsInput(counts, { implementerProvider: { name: "broken" } })),
      /implementerProvider must satisfy/,
    );
    assert.throws(
      () =>
        createProductionCoordinatorDeps({
          specialty: "backend",
          implementerProvider: fakeProvider(counts, "implementer", "Implemented."),
          reviewerProvider: null as never,
        }),
      /reviewerProvider must satisfy/,
    );
    assert.throws(() => createProductionCoordinatorDeps("nope" as never), /expected a dependencies input object/);
    assert.throws(() => createProductionCoordinatorDeps({} as never), /unknown specialty/);
    assert.deepEqual(counts, { implementer: 0, reviewer: 0 });
  });

  it("result-shape mismatches surface downstream, never as success", async () => {
    const counts = freshCounts();
    // The provider contract is structural (like every seam here):
    // an opencode-shaped string provider passes assembly shape
    // checks — TypeScript callers are stopped at compile time, and
    // a wrong-shaped result fails loudly at the execution seam
    // instead of becoming success.
    const stringish = {
      name: "opencode-shaped",
      execute: async () => "raw text",
    } as never as AgentProvider<ExecutionResult>;
    const deps = createProductionCoordinatorDeps(depsInput(counts, { implementerProvider: stringish }));
    const tickets = [ticket("T-001", "ready")];
    await assert.rejects(
      runCoordinatorTicket({
        tickets,
        roles: deps.roles,
        project_root: "/proj",
        timeout_ms: 5000,
        decideReview: async () => ({ decision: "approved" }),
      }),
      /implementation_result must be a non-empty string/,
    );
    assert.equal(tickets[0].state, "implementation_review", "failed loudly, never as success");
    assert.deepEqual(counts, { implementer: 0, reviewer: 0 }, "counted fakes untouched");
  });

  it("preserves R-001 one-ticket behavior through assembled deps", async () => {
    const counts = freshCounts();
    const deps = createProductionCoordinatorDeps(depsInput(counts));
    const tickets = [ticket("T-001", "ready"), ticket("T-002", "ready")];
    const result = await runCoordinatorTicket({
      tickets,
      roles: deps.roles,
      project_root: "/proj",
      timeout_ms: 5000,
      decideReview: async () => ({ decision: "approved" }),
    });
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.ticket_id === "T-001");
    assert.equal(tickets[1].state, "ready");
    assert.deepEqual(counts, { implementer: 1, reviewer: 1 });
  });

  it("preserves R-002 rework behavior through assembled deps", async () => {
    const counts = freshCounts();
    const deps = createProductionCoordinatorDeps(depsInput(counts));
    const tickets = [ticket("T-001", "changes_requested", "Fix the typo.")];
    const result = await runCoordinatorTicket({
      tickets,
      roles: deps.roles,
      project_root: "/proj",
      timeout_ms: 5000,
      decideReview: async () => ({ decision: "approved" }),
    });
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.final_state === "technical_approval");
    assert.equal(tickets[0].state, "technical_approval");
    assert.deepEqual(counts, { implementer: 1, reviewer: 1 });
  });

  it("assembly is deterministic and factory constructions are independent", async () => {
    const first = createProductionCoordinatorDeps(depsInput(freshCounts()));
    const second = createProductionCoordinatorDeps(depsInput(freshCounts()));
    assert.notEqual(first, second);
    assert.notEqual(first.roles, second.roles);
    const firstImplementer = await first.roles.resolveImplementer({ id: "T-1", title: "t", description: "d", requirements: "r" });
    const secondImplementer = await second.roles.resolveImplementer({ id: "T-1", title: "t", description: "d", requirements: "r" });
    assert.deepEqual(
      { role: firstImplementer.role, specialty: firstImplementer.specialty },
      { role: secondImplementer.role, specialty: secondImplementer.specialty },
    );
    assert.notEqual(firstImplementer.provider, secondImplementer.provider, "no shared provider instances");
    assert.equal(await first.roles.resolveImplementer({ id: "T-1", title: "t", description: "d", requirements: "r" }), firstImplementer, "identical references per factory");
  });

  it("composition stays provider-neutral: contracts and seams pinned", () => {
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "production.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(
      importedModules.sort(),
      ["../providers/agent", "../providers/result", "../roles/contract", "./roles"],
      "contracts and the role seam only",
    );
    assert.ok(!/opencode|delegate|specify|relay|spawn|exec\(|shell/i.test(code), "no concrete providers or processes");
    assert.ok(!/skill|fleet|lane|model|session/i.test(code), "no delegate specifics");
    assert.ok(!/classif|infer|keyword|label/i.test(code), "no classification");
    assert.ok(!/loadConfig|validateConfig|FrameworkConfig|enabled/i.test(code), "no configuration");
    assert.ok(!/\bgit\b|commit|merge|branch/i.test(code), "no git");
    assert.ok(!/interface AgentProvider|interface ExecutionResult/i.test(code), "no contract redefinition");
    const coordinator = readFileSync(join(__dirname, "..", "..", "src", "runtime", "coordinator.ts"), "utf8");
    assert.ok(!/production/i.test(coordinator.replace(/\/\*[\s\S]*?\*\//g, "")), "coordinator stays assembly-blind");
  });
});
