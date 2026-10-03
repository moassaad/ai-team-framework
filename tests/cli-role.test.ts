import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_IDS } from "../src/roles/contract";
import { run } from "../src/cli";
import { RoleCommandDeps, runRoleCommand } from "../src/cli-role";

// Direct role execution CLI tests (M25 T-016): thin adapter
// over T-005 with injected spies. No providers run here.
function spy<T>(calls: unknown[], value: T): (call: unknown) => Promise<T> {
  return async (call: unknown) => {
    calls.push(call);
    return value;
  };
}

function completedImplementer(ticket_id = "T-001") {
  return {
    role: "implementer" as const,
    execution: {
      outcome: "completed" as const,
      ticket_id,
      result: { status: "succeeded" as const, text: "done" },
      next_state: "implementation_review" as const,
    },
  };
}

function completedReviewer(ticket_id = "T-001") {
  return {
    role: "senior-reviewer" as const,
    execution: { outcome: "completed" as const, ticket_id, report: "Clean report.", next_state: null },
  };
}

function completedLead(role: "technical-lead" | "project-manager") {
  return { role, execution: { outcome: "completed" as const, report: "Considerations noted." } };
}

function completedCoordinator(ticket_id = "T-001") {
  return {
    role: "coordinator" as const,
    execution: {
      outcome: "completed" as const,
      ticket_id,
      final_state: "technical_approval" as const,
      transitions: [],
      implementation: { status: "succeeded" as const, text: "done" },
      report: "Reviewed clean.",
    },
  };
}

function fakeDeps(calls: Record<string, unknown[]>, overrides: Partial<RoleCommandDeps> = {}): RoleCommandDeps {
  const provider = { name: "stub", execute: async () => ({ status: "succeeded" as const, text: "done" }) };
  return {
    projectRoot: "/proj",
    loadConfiguration: () => ({} as never),
    createAgent: () => provider,
    readReviewDecision: async () => ({ decision: "approved" as const }),
    executeImplementer: spy(calls.implementer ??= [], completedImplementer()),
    executeSeniorReviewer: spy(calls.reviewer ??= [], completedReviewer()),
    executeTechnicalLead: spy(calls.lead ??= [], completedLead("technical-lead")),
    executeProjectManager: spy(calls.manager ??= [], completedLead("project-manager")),
    executeCoordinator: spy(calls.coordinator ??= [], completedCoordinator()),
    ...overrides,
  };
}

const implementerArgs = ["role", "implementer", "--id", "T-001", "--title", "Title", "--description", "Desc.", "--requirements", "Reqs", "--specialty", "backend"];

describe("role command discovery", () => {
  it("advertises the role command with all five roles in help", () => {
    const help = run(["--help"], "0.0.0-test");
    assert.equal(help.exitCode, 0);
    assert.ok(help.stdout.includes("ai-team role <role> [role inputs]"));
    for (const role of ["coordinator", "project-manager", "technical-lead", "implementer", "senior-reviewer"]) {
      assert.ok(help.stdout.includes(role), `help names ${role}`);
    }
  });

  it("rejects bare, unknown, and malformed role invocations without executing", async () => {
    const calls: Record<string, unknown[]> = {};
    for (const argv of [["role"], ["role", "bogus"], ["role", "implementer"], ["role", "pm", "--id", "T-001"], []]) {
      const result = await runRoleCommand(fakeDeps(calls), argv);
      assert.equal(result.exitCode, 1, `${JSON.stringify(argv)} is a usage error`);
      assert.ok(result.stdout === "" && result.stderr.length > 0);
    }
    assert.deepEqual(Object.values(calls).flat(), [], "no executor runs on invalid invocation");
  });

  it("leaves run --role presentation semantics untouched", () => {
    const presented = run(["run", "--role", "implementer"], "0.0.0-test");
    assert.equal(presented.exitCode, 0);
    assert.ok(presented.stdout.includes("Role execution is not implemented yet."), "run --role still presents, never executes");
    const presentedCoordinator = run(["run"], "0.0.0-test");
    assert.ok(presentedCoordinator.stdout.includes("Coordinator (coordinator)"));
  });
});

describe("role selection and delegation", () => {
  const cases = [
    { argv: ["role", "coordinator", "--id", "T-001", "--title", "T", "--description", "D", "--requirements", "R", "--specialty", "backend", "--review-decision", "approved"], key: "coordinator", identity: "coordinator" },
    { argv: ["role", "project-manager", "--id", "T-001", "--title", "T", "--description", "D", "--requirements", "R", "--state", "technical_approval"], key: "manager", identity: "project-manager" },
    { argv: ["role", "technical-lead", "--id", "T-001", "--title", "T", "--description", "D", "--requirements", "R", "--state", "technical_approval"], key: "lead", identity: "technical-lead" },
    { argv: ["role", "implementer", "--id", "T-001", "--title", "T", "--description", "D", "--requirements", "R", "--specialty", "testing"], key: "implementer", identity: "implementer" },
    { argv: ["role", "senior-reviewer", "--id", "T-001", "--title", "T", "--description", "D", "--requirements", "R", "--result", "Output."], key: "reviewer", identity: "senior-reviewer" },
  ] as const;

  it("invokes exactly the selected executor with its canonical identity", async () => {
    for (const { argv, key, identity } of cases) {
      const calls: Record<string, unknown[]> = {};
      const result = await runRoleCommand(fakeDeps(calls), [...argv]);
      assert.equal(result.exitCode, 0, `${argv[1]} succeeds`);
      assert.equal(calls[key].length, 1, `exactly one ${argv[1]} execution`);
      for (const other of Object.keys(calls)) {
        if (other !== key) {
          assert.equal(calls[other].length, 0, `${other} never runs for ${argv[1]}`);
        }
      }
      assert.deepEqual((calls[key][0] as { identity: unknown }).identity, { role: identity }, "canonical identity, never inferred");
    }
  });

  it("resolves existing aliases to canonical identities before execution", async () => {
    const calls: Record<string, unknown[]> = {};
    const aliased: Array<[string[], string, string]> = [
      [["role", "pm", "--id", "T-001", "--title", "T", "--description", "D", "--requirements", "R", "--state", "technical_approval"], "manager", "project-manager"],
      [["role", "tl", "--id", "T-001", "--title", "T", "--description", "D", "--requirements", "R", "--state", "technical_approval"], "lead", "technical-lead"],
      [["role", "reviewer", "--id", "T-001", "--title", "T", "--description", "D", "--requirements", "R", "--result", "O."], "reviewer", "senior-reviewer"],
    ];
    for (const [argv, key, identity] of aliased) {
      const result = await runRoleCommand(fakeDeps(calls), argv);
      assert.equal(result.exitCode, 0);
      assert.deepEqual(((calls[key] as unknown[]).pop() as { identity: unknown }).identity, { role: identity });
    }
  });

  it("passes provider, project root, and the fixed execution bound through", async () => {
    const calls: Record<string, unknown[]> = {};
    const deps = fakeDeps(calls);
    await runRoleCommand(deps, implementerArgs);
    const call = calls.implementer[0] as { input: { provider: unknown; project_root: unknown; timeout_ms: unknown; ticket: unknown; specialty: unknown } };
    assert.ok(call.input.provider !== undefined && (call.input.provider as { name: string }).name === "stub");
    assert.equal(call.input.project_root, "/proj");
    assert.equal(call.input.timeout_ms, 300000);
    assert.deepEqual(call.input.ticket, { id: "T-001", title: "Title", description: "Desc.", requirements: "Reqs" });
    assert.equal(call.input.specialty, "backend");
  });
});

describe("role command input handling", () => {
  it("rejects missing, duplicate, unknown, and malformed inputs pre-execution", async () => {
    const calls: Record<string, unknown[]> = {};
    const bad = [
      ["role", "implementer", "--id", "T-001", "--title", "T", "--description", "D", "--requirements", "R"],
      ["role", "implementer", "--id", "T-001", "--id", "T-002", "--title", "T", "--description", "D", "--requirements", "R", "--specialty", "backend"],
      ["role", "implementer", "--id", "T-001", "--title", "T", "--description", "D", "--requirements", "R", "--specialty", "backend", "--handoff", "x"],
      ["role", "implementer", "--id", "T-001", "--title", "T", "--description", "D", "--requirements", "R", "--specialty", "devops"],
      ["role", "technical-lead", "--id", "T-001", "--title", "T", "--description", "D", "--requirements", "R", "--state", "bogus"],
      ["role", "senior-reviewer", "--id", "T-001", "--title", "T", "--description", "D", "--requirements", "R"],
      ["role", "coordinator", "--id", "T-001", "--title", "T", "--description", "D", "--requirements", "R", "--specialty", "backend", "--review-feedback", "x"],
    ];
    for (const argv of bad) {
      const result = await runRoleCommand(fakeDeps(calls), argv);
      assert.equal(result.exitCode, 1, `${JSON.stringify(argv.slice(1, 4))} fails cleanly`);
    }
    assert.deepEqual(Object.values(calls).flat(), [], "invalid input never reaches an executor");
  });

  it("fails safely when configuration is invalid", async () => {
    const calls: Record<string, unknown[]> = {};
    const deps = fakeDeps(calls, {
      loadConfiguration: () => {
        throw new Error("bad config");
      },
    });
    const result = await runRoleCommand(deps, implementerArgs);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("bad config"));
    assert.deepEqual(Object.values(calls).flat(), []);
  });
});

describe("role command output and status", () => {
  it("renders successful outcomes with role identity and ticket context", async () => {
    const calls: Record<string, unknown[]> = {};
    const implementer = await runRoleCommand(fakeDeps(calls), implementerArgs);
    assert.equal(implementer.exitCode, 0);
    assert.ok(implementer.stdout.includes("role implementer completed: ticket T-001"), "role, outcome, and ticket named");
    const reviewer = await runRoleCommand(fakeDeps(calls), ["role", "senior-reviewer", "--id", "T-001", "--title", "T", "--description", "D", "--requirements", "R", "--result", "O."]);
    assert.ok(reviewer.stdout.includes("role senior-reviewer completed: ticket T-001."));
    assert.ok(reviewer.stdout.includes("Clean report."), "exposed report displayed, never interpreted");
    assert.ok(!reviewer.stdout.match(/decision|approved|verdict/i), "no decision language added around the report");
  });

  it("returns non-zero status for runtime failure without swallowing errors", async () => {
    const calls: Record<string, unknown[]> = {};
    const failing = {
      role: "implementer" as const,
      execution: { outcome: "failed" as const, ticket_id: "T-001", error: { kind: "provider_error" as const, message: "boom" }, next_state: null },
    };
    const deps = fakeDeps(calls, { executeImplementer: spy(calls.implementer ??= [], failing) });
    const failed = await runRoleCommand(deps, implementerArgs);
    assert.equal(failed.exitCode, 1);
    assert.ok(failed.stderr.includes("implementer-failed") && failed.stderr.includes("boom"));
    const throwing = fakeDeps(calls, {
      executeImplementer: async () => {
        throw new Error("executor exploded");
      },
    });
    const crashed = await runRoleCommand(throwing, implementerArgs);
    assert.equal(crashed.exitCode, 1, "executor throws become exit-1, never rejections");
    assert.ok(crashed.stderr.includes("executor exploded"));
  });

  it("fails the coordinator safely without a decision mechanism", async () => {
    const calls: Record<string, unknown[]> = {};
    const deps = fakeDeps(calls, {
      readReviewDecision: async () => {
        throw new Error("no interactive decision mechanism available");
      },
      executeCoordinator: async (call: unknown) => {
        calls.coordinator ??= [];
        calls.coordinator.push(call);
        await (call as { input: { decideReview: () => Promise<unknown> } }).input.decideReview();
        throw new Error("decideReview must reject first");
      },
    });
    const result = await runRoleCommand(deps, ["role", "coordinator", "--id", "T-001", "--title", "T", "--description", "D", "--requirements", "R", "--specialty", "backend"]);
    assert.equal(result.exitCode, 1, "no TTY decision means no auto-approval");
    assert.ok(result.stderr.includes("no interactive decision mechanism available"));
  });

  it("passes an explicit coordinator decision through untouched", async () => {
    const calls: Record<string, unknown[]> = {};
    const result = await runRoleCommand(fakeDeps(calls), ["role", "coordinator", "--id", "T-001", "--title", "T", "--description", "D", "--requirements", "R", "--specialty", "backend", "--review-decision", "approved"]);
    assert.equal(result.exitCode, 0);
    const call = calls.coordinator[0] as { input: { decideReview: () => Promise<{ decision: string }> } };
    assert.equal((await call.input.decideReview()).decision, "approved");
  });
});

describe("role command separation", () => {
  it("routes through index wiring without disturbing existing commands", () => {
    const source = readFileSync(join(__dirname, "..", "..", "src", "index.ts"), "utf8");
    assert.ok(source.includes("runRoleCommand") && source.includes("createProductionRoleDeps"));
    assert.ok(source.includes("runSprintCommand") && source.includes("runRunCommand"), "run and sprint routes intact");
    const cli = readFileSync(join(__dirname, "..", "..", "src", "cli.ts"), "utf8");
    assert.ok(!cli.includes("runRoleCommand"), "sync presentation path never executes roles");
  });

  it("touches no delegation, mode, retry, persistence, planning, or orchestration concept", () => {
    assert.equal(ROLE_IDS.length, 5);
    const source = readFileSync(join(__dirname, "..", "..", "src", "cli-role.ts"), "utf8");
    assert.ok(!/RoleManager|TeamManager|AgentManager|Registry|Discovery|Finder|Chooser/i.test(source.replace(/projects?[\s_-]?manager/gi, "")));
    for (const token of [
      "runSprintWorkflow",
      "runProductionCoordinator",
      "decidePlanningApproval",
      "runTechnicalLeadTaskDecomposition",
      "delegate-skills",
      "DelegateProvider",
      "github",
      "GitHub",
      "spec-kit",
      "config.yaml",
      "process.env",
      "node:fs",
      "child_process",
      "setTimeout",
      "setInterval",
      "FAST",
      "STANDARD",
      "FULL",
      "--mode",
      "reenter",
      "Router",
      "retry",
      "handoff file",
      "parseHandoff",
      "HandoffContext",
      "clipboard",
    ]) {
      assert.ok(!source.includes(token), `role command never touches ${token}`);
    }
    assert.ok(source.includes("createOpenCodeExecutionProvider"), "uses the established OpenCode bridge, no parallel provider path");
    for (const executor of ["executeImplementer", "executeSeniorReviewer", "executeTechnicalLead", "executeProjectManager", "executeCoordinator"]) {
      assert.ok(source.includes(executor), `delegates to T-005 ${executor}`);
    }
    assert.ok(!/from "\.\.\/(workflow|config)/.test(source), "no workflow or config-internals imports");
  });
});
