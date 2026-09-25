import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentProvider } from "../src/providers/agent";
import { ExecutionResult } from "../src/providers/result";
import { WorkflowState } from "../src/workflow/states";
import {
  CoordinatorTicket,
  runCoordinatorTicket,
} from "../src/runtime/coordinator";
import {
  RoleResolver,
  isRoleResolver,
  validateImplementerReference,
  validateSeniorReviewerReference,
} from "../src/runtime/roles";

// Explicit role resolution tests (M18 R-003): the Coordinator
// consumes a caller-supplied resolver and nothing else. Resolver
// calls are counted to prove exact-once deterministic resolution;
// reference validation is proven with malformed resolvers that
// must fail before any provider runs.

interface ProviderCounts {
  implementer: number;
  reviewer: number;
  resolvedImplementer: number;
  resolvedReviewer: number;
}

function freshCounts(): ProviderCounts {
  return { implementer: 0, reviewer: 0, resolvedImplementer: 0, resolvedReviewer: 0 };
}

function succeedWith(text: string) {
  return async (): Promise<ExecutionResult> => ({ status: "succeeded", text });
}

function fakeProvider(counts: ProviderCounts, side: "implementer" | "reviewer"): AgentProvider<ExecutionResult> {
  return {
    name: `fake-${side}`,
    execute: async () => {
      counts[side] += 1;
      return { status: "succeeded", text: `${side} done.` };
    },
  };
}

function ticket(id: string, state: WorkflowState, extra: Partial<CoordinatorTicket> = {}): CoordinatorTicket {
  return {
    id,
    title: `Work ${id}`,
    description: `Description for ${id}.`,
    requirements: `Requirements for ${id}.`,
    state,
    ...extra,
  };
}

function resolver(
  counts: ProviderCounts,
  overrides: {
    specialty?: unknown;
    implementerProvider?: unknown;
    reviewerProvider?: unknown;
    implementerRole?: unknown;
    reviewerRole?: unknown;
  } = {},
): RoleResolver {
  const implementerProvider =
    (overrides.implementerProvider as AgentProvider<ExecutionResult> | undefined) ??
    fakeProvider(counts, "implementer");
  const reviewerProvider =
    (overrides.reviewerProvider as AgentProvider<ExecutionResult> | undefined) ??
    fakeProvider(counts, "reviewer");
  return {
    resolveImplementer: () => {
      counts.resolvedImplementer += 1;
      return {
        role: overrides.implementerRole ?? "implementer",
        specialty: overrides.specialty ?? "backend",
        provider: implementerProvider,
      } as never;
    },
    resolveSeniorReviewer: () => {
      counts.resolvedReviewer += 1;
      return {
        role: overrides.reviewerRole ?? "senior-reviewer",
        provider: reviewerProvider,
      } as never;
    },
  };
}

function baseInput(
  counts: ProviderCounts,
  overrides: {
    tickets?: CoordinatorTicket[];
    roles?: RoleResolver;
    reviewDecision?: "approved" | "changes_requested";
    reviewFeedback?: string;
  } = {},
): Parameters<typeof runCoordinatorTicket>[0] {
  return {
    tickets: overrides.tickets ?? [ticket("T-001", "ready")],
    roles: overrides.roles ?? resolver(counts),
    project_root: "/proj",
    timeout_ms: 5000,
    reviewDecision: overrides.reviewDecision ?? "approved",
    ...(overrides.reviewFeedback !== undefined ? { reviewFeedback: overrides.reviewFeedback } : {}),
  };
}

describe("explicit role resolution", () => {
  it("resolves the Implementer role explicitly for a ready ticket", async () => {
    const counts = freshCounts();
    const tickets = [ticket("T-001", "ready")];
    const result = await runCoordinatorTicket(baseInput(counts, { tickets }));
    assert.equal(result.outcome, "completed");
    assert.equal(counts.resolvedImplementer, 1);
    assert.equal(counts.implementer, 1);
    assert.equal(tickets[0].state, "technical_approval");
  });

  it("resolves the Senior Reviewer role explicitly after implementation", async () => {
    const counts = freshCounts();
    const result = await runCoordinatorTicket(baseInput(counts, {}));
    assert.equal(result.outcome, "completed");
    assert.equal(counts.resolvedReviewer, 1);
    assert.equal(counts.reviewer, 1);
    assert.ok(result.outcome === "completed" && result.report === "reviewer done.");
  });

  it("resolved references reach the correct execution seams", async () => {
    const counts = freshCounts();
    const implementerProvider = fakeProvider(counts, "implementer");
    const reviewerProvider = fakeProvider(counts, "reviewer");
    assert.notEqual(implementerProvider, reviewerProvider);
    const roles: RoleResolver = {
      resolveImplementer: () => ({ role: "implementer", specialty: "frontend", provider: implementerProvider }),
      resolveSeniorReviewer: () => ({ role: "senior-reviewer", provider: reviewerProvider }),
    };
    const result = await runCoordinatorTicket(baseInput(counts, { roles }));
    assert.equal(result.outcome, "completed");
    assert.equal(counts.implementer, 1);
    assert.equal(counts.reviewer, 1);
  });

  it("uses the resolved specialty without reinterpretation", async () => {
    const counts = freshCounts();
    const seen: string[] = [];
    const roles: RoleResolver = {
      resolveImplementer: () => ({
        role: "implementer",
        specialty: "documentation",
        provider: {
          name: "spy",
          execute: async (invocation) => {
            counts.implementer += 1;
            seen.push(invocation.prompt);
            return { status: "succeeded", text: "done." };
          },
        },
      }),
      resolveSeniorReviewer: () => ({ role: "senior-reviewer", provider: fakeProvider(counts, "reviewer") }),
    };
    const result = await runCoordinatorTicket(baseInput(counts, { roles }));
    assert.equal(result.outcome, "completed");
    assert.equal(seen.length, 1, "resolved provider executed once");
  });

  it("rework path resolves both roles through the same seam", async () => {
    const counts = freshCounts();
    const tickets = [ticket("T-001", "changes_requested", { feedback: "Fix the typo." })];
    const result = await runCoordinatorTicket(baseInput(counts, { tickets }));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.final_state === "technical_approval");
    assert.deepEqual(
      { resolvedImplementer: counts.resolvedImplementer, resolvedReviewer: counts.resolvedReviewer },
      { resolvedImplementer: 1, resolvedReviewer: 1 },
    );
    assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 1, reviewer: 1 });
  });

  it("resolver is called deterministically: once per role per invocation", async () => {
    const counts = freshCounts();
    const first = await runCoordinatorTicket(baseInput(counts, {}));
    const second = await runCoordinatorTicket(
      baseInput(counts, { tickets: [ticket("T-002", "ready")] }),
    );
    assert.deepEqual(first.outcome, second.outcome);
    assert.deepEqual(
      { resolvedImplementer: counts.resolvedImplementer, resolvedReviewer: counts.resolvedReviewer },
      { resolvedImplementer: 2, resolvedReviewer: 2 },
    );
  });

  it("Implementer resolution failure prevents every invocation and transition", async () => {
    const counts = freshCounts();
    const tickets = [ticket("T-001", "ready")];
    const roles = resolver(counts, { specialty: "wizard" });
    await assert.rejects(runCoordinatorTicket(baseInput(counts, { tickets, roles })), /unknown specialty "wizard"/);
    assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 0, reviewer: 0 });
    assert.equal(tickets[0].state, "ready", "no transition recorded");
  });

  it("Reviewer resolution failure preserves implementation_review without auto-approving", async () => {
    const counts = freshCounts();
    const tickets = [ticket("T-001", "ready")];
    const roles = resolver(counts, { reviewerProvider: { name: "broken" } });
    await assert.rejects(runCoordinatorTicket(baseInput(counts, { tickets, roles })), /must satisfy the agent provider contract/);
    assert.equal(tickets[0].state, "implementation_review", "state preserved, nothing approved");
    assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 1, reviewer: 0 });
  });

  it("wrong role identities are rejected without fallback", async () => {
    const counts = freshCounts();
    await assert.rejects(
      runCoordinatorTicket(baseInput(counts, { roles: resolver(counts, { implementerRole: "senior-reviewer" }) })),
      /must be the role "implementer"/,
    );
    assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 0, reviewer: 0 });
    const countsAfterImplementer = freshCounts();
    await assert.rejects(
      runCoordinatorTicket(baseInput(countsAfterImplementer, { roles: resolver(countsAfterImplementer, { reviewerRole: "implementer" }) })),
      /must be the role "senior-reviewer"/,
    );
    assert.deepEqual(
      { implementer: countsAfterImplementer.implementer, reviewer: countsAfterImplementer.reviewer },
      { implementer: 1, reviewer: 0 },
      "implementer already ran; reviewer never invoked, nothing approved",
    );
  });

  it("missing resolver functions reject before selection", async () => {
    const counts = freshCounts();
    const tickets = [ticket("T-001", "ready")];
    await assert.rejects(
      runCoordinatorTicket(baseInput(counts, { tickets, roles: {} as never })),
      /roles must satisfy the role resolver contract/,
    );
    assert.deepEqual({ implementer: counts.implementer, reviewer: counts.reviewer }, { implementer: 0, reviewer: 0 });
    assert.equal(tickets[0].state, "ready");
  });

  it("allows one provider to serve both responsibilities without inventing rules", async () => {
    const counts = freshCounts();
    const shared = fakeProvider(counts, "implementer");
    const roles: RoleResolver = {
      resolveImplementer: () => ({ role: "implementer", specialty: "backend", provider: shared }),
      resolveSeniorReviewer: () => ({ role: "senior-reviewer", provider: shared }),
    };
    const result = await runCoordinatorTicket(baseInput(counts, { roles }));
    assert.equal(result.outcome, "completed", "no distinctness rule imposed");
  });

  it("validates reference shapes directly", () => {
    assert.ok(isRoleResolver(resolver(freshCounts())));
    assert.ok(!isRoleResolver({}));
    assert.deepEqual(validateImplementerReference({ role: "implementer", specialty: "backend", provider: fakeProvider(freshCounts(), "implementer") }).role, "implementer");
    assert.deepEqual(validateSeniorReviewerReference({ role: "senior-reviewer", provider: fakeProvider(freshCounts(), "reviewer") }).role, "senior-reviewer");
    assert.throws(() => validateImplementerReference({ role: "implementer", specialty: "wizard", provider: fakeProvider(freshCounts(), "implementer") }), /unknown specialty/);
    assert.throws(() => validateSeniorReviewerReference({ role: "bogus", provider: fakeProvider(freshCounts(), "reviewer") }), /must be the role "senior-reviewer"/);
    assert.throws(() => validateImplementerReference("nope"), /expected an implementer reference object/);
    assert.throws(() => validateSeniorReviewerReference([]), /expected a senior reviewer reference object/);
  });

  it("keeps the one-ticket guarantee under resolution", async () => {
    const counts = freshCounts();
    const tickets = [ticket("T-001", "ready"), ticket("T-002", "ready")];
    const others = JSON.stringify([tickets[1]]);
    const result = await runCoordinatorTicket(baseInput(counts, { tickets }));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.ticket_id === "T-001");
    assert.equal(JSON.stringify([tickets[1]]), others);
    assert.deepEqual(
      { resolvedImplementer: counts.resolvedImplementer, resolvedReviewer: counts.resolvedReviewer },
      { resolvedImplementer: 1, resolvedReviewer: 1 },
      "resolver runs once per role for the single ticket",
    );
  });

  it("no configuration is read, written, or added", async () => {
    const counts = freshCounts();
    await runCoordinatorTicket(baseInput(counts, {}));
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "roles.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/loadConfig|validateConfig|FrameworkConfig|roles\.\w+|enabled/i.test(code), "no configuration");
  });

  it("no classification, skill mapping, model, fleet, session, or git seams", async () => {
    const counts = freshCounts();
    await runCoordinatorTicket(baseInput(counts, {}));
    for (const file of ["runtime/roles.ts", "runtime/coordinator.ts"]) {
      const source = readFileSync(join(__dirname, "..", "..", "src", file), "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
      assert.ok(!/classif|keyword|label|infer|sentiment|skill|fleet|lane|model|session|relay/i.test(code), `${file}: no inference or delegation specifics`);
      assert.ok(!/\bgit\b|commit|merge|branch/i.test(code), `${file}: no git`);
    }
    const rolesSource = readFileSync(join(__dirname, "..", "..", "src", "runtime", "roles.ts"), "utf8");
    const rolesCode = rolesSource.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...rolesCode.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(
      importedModules.sort(),
      ["../providers/agent", "../providers/result", "../roles/contract"],
      "existing contracts only",
    );
  });

  it("generic provider contracts are consumed unchanged", async () => {
    const counts = freshCounts();
    const result = await runCoordinatorTicket(baseInput(counts, {}));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.implementation.text === "implementer done.");
    assert.ok(result.outcome === "completed" && result.report === "reviewer done.");
  });
});
