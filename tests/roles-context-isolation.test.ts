import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_IDS } from "../src/roles/contract";
import { executeImplementerTicket } from "../src/execution/implementer";
import { executeReviewerTicket } from "../src/execution/reviewer";
import { executeTechnicalLeadReview } from "../src/execution/technical-lead";
import { executePmUserTesting } from "../src/execution/pm-testing";
import { runCoordinatorPlanning } from "../src/runtime/coordinator-planning";
import { runPmPlanning } from "../src/runtime/pm-planning";
import { executeIndependentImplementer } from "../src/roles/independent-execution";
import { RoleCommandDeps, runRoleCommand } from "../src/cli-role";

// Role-specific context isolation tests (M25 T-019): every role
// receives sufficient explicit context and nothing else. Each
// suite captures the actual provider-bound prompt through a stub
// and asserts allowlisted content present verbatim with
// unrelated, internal, secret, and report content absent.
// Sentinel values are fake by construction; no real secret or
// credential exists anywhere in this file.
const TEST_PROVIDER_SECRET = "TEST_PROVIDER_SECRET";
const TEST_API_TOKEN = "TEST_API_TOKEN";

interface Captured {
  prompt: string;
  project_root: string;
  role?: string;
}

function capturingProvider(calls: Captured[], text = "done") {
  void TEST_PROVIDER_SECRET;
  void TEST_API_TOKEN;
  return {
    name: "TEST_PROVIDER_NAME",
    execute: async (request: { prompt: string; project_root: string; role?: string }) => {
      calls.push({ prompt: request.prompt, project_root: request.project_root, role: request.role });
      return { status: "succeeded" as const, text };
    },
  };
}

const ticketBase = {
  id: "T-001",
  title: "Ticket title.",
  description: "Ticket description text.",
  requirements: "Ticket requirements text.",
};

describe("implementer context isolation", () => {
  it("receives ticket, specialty, and identity with nothing unrelated", async () => {
    const calls: Captured[] = [];
    const outcome = await executeImplementerTicket({
      ticket: { ...ticketBase },
      specialty: "backend",
      role: "implementer",
      project_root: "/proj",
      provider: capturingProvider(calls),
      timeout_ms: 1000,
      discovery_summary: "Relevant discovery text.",
      reviewerPrivateNotes: "REVIEWER_PRIVATE_SENTINEL",
      pmPlanHistory: "PM_HISTORY_SENTINEL",
    } as never);
    assert.equal(outcome.outcome, "completed");
    const prompt = calls[0].prompt;
    assert.ok(prompt.includes("Ticket description text.") && prompt.includes("Ticket requirements text."));
    assert.ok(prompt.includes("Implementer (implementer)"), "own role contract present");
    assert.ok(prompt.includes("backend"), "assigned specialty present");
    assert.ok(prompt.includes("Relevant discovery text."), "explicit caller context preserved");
    for (const forbidden of ["REVIEWER_PRIVATE_SENTINEL", "PM_HISTORY_SENTINEL", "TEST_PROVIDER_NAME", TEST_PROVIDER_SECRET, TEST_API_TOKEN, "technical_approval", "ARCHITECTURE_NOT_FOR_IMPLEMENTER"]) {
      assert.ok(!prompt.includes(forbidden), `implementer prompt excludes ${forbidden}`);
    }
    assert.deepEqual(Object.keys(calls[0]).sort(), ["project_root", "prompt", "role"]);
    assert.equal(calls[0].role, "implementer");
  });
});

describe("reviewer context isolation", () => {
  it("receives review target and requirements with nothing unrelated", async () => {
    const calls: Captured[] = [];
    const outcome = await executeReviewerTicket({
      ticket: { ...ticketBase },
      implementation_result: "IMPLEMENTATION_EVIDENCE_SENTINEL",
      role: "senior-reviewer",
      project_root: "/proj",
      provider: capturingProvider(calls),
      timeout_ms: 1000,
      pmPrivatePlan: "PM_PRIVATE_SENTINEL",
      tlArchitecture: "ARCHITECTURE_NOT_FOR_IMPLEMENTER",
    } as never);
    assert.equal(outcome.outcome, "completed");
    const prompt = calls[0].prompt;
    assert.ok(prompt.includes("IMPLEMENTATION_EVIDENCE_SENTINEL"), "review target present verbatim");
    assert.ok(prompt.includes("Ticket requirements text."));
    assert.ok(prompt.includes("Senior Reviewer (senior-reviewer)"));
    for (const forbidden of ["PM_PRIVATE_SENTINEL", "ARCHITECTURE_NOT_FOR_IMPLEMENTER", "TEST_PROVIDER_NAME", TEST_PROVIDER_SECRET, "technical_approval"]) {
      assert.ok(!prompt.includes(forbidden), `reviewer prompt excludes ${forbidden}`);
    }
    assert.equal(calls[0].role, "senior-reviewer");
  });
});

describe("technical lead context isolation", () => {
  it("receives evidence with contracted state and feedback, never execution internals", async () => {
    const calls: Captured[] = [];
    const outcome = await executeTechnicalLeadReview({
      evidence: [{
        ...ticketBase,
        state: "blocked" as const,
        feedback: "CONTRACTED_REVIEWER_FEEDBACK",
      }],
      role: "technical-lead",
      project_root: "/proj",
      provider: capturingProvider(calls),
      timeout_ms: 1000,
      implementerInternals: "IMPLEMENTER_INTERNALS_SENTINEL",
    } as never);
    assert.equal(outcome.outcome, "completed");
    const prompt = calls[0].prompt;
    assert.ok(prompt.includes("Ticket requirements text."), "PM requirements reach TL");
    assert.ok(prompt.includes("[blocked]"), "evidence state present where contracted");
    assert.ok(prompt.includes("CONTRACTED_REVIEWER_FEEDBACK"), "reviewer feedback present where contracted");
    assert.ok(prompt.includes("Technical Lead (technical-lead)"));
    for (const forbidden of ["IMPLEMENTER_INTERNALS_SENTINEL", "TEST_PROVIDER_NAME", TEST_PROVIDER_SECRET, "InternalExecState=SENTINEL"]) {
      assert.ok(!prompt.includes(forbidden), `TL prompt excludes ${forbidden}`);
    }
    assert.equal(calls[0].role, "technical-lead");
  });
});

describe("project manager context isolation", () => {
  it("receives business evidence with contracted state, never technical internals", async () => {
    const calls: Captured[] = [];
    const outcome = await executePmUserTesting({
      evidence: [{
        ...ticketBase,
        state: "technical_approval" as const,
        feedback: "CONTRACTED_REVIEWER_FEEDBACK",
      }],
      role: "project-manager",
      project_root: "/proj",
      provider: capturingProvider(calls),
      timeout_ms: 1000,
      tlDeliberation: "TL_DELIBERATION_SENTINEL",
    } as never);
    assert.equal(outcome.outcome, "completed");
    const prompt = calls[0].prompt;
    assert.ok(prompt.includes("Ticket requirements text."));
    assert.ok(prompt.includes("[technical_approval]"));
    assert.ok(prompt.includes("Project Manager (project-manager)"));
    for (const forbidden of ["TL_DELIBERATION_SENTINEL", "TEST_PROVIDER_NAME", TEST_PROVIDER_SECRET, "ARCHITECTURE_NOT_FOR_IMPLEMENTER"]) {
      assert.ok(!prompt.includes(forbidden), `PM prompt excludes ${forbidden}`);
    }
    assert.equal(calls[0].role, "project-manager");
  });
});

describe("coordinator planning context isolation", () => {
  it("receives user request content with no role internals or secrets", async () => {
    const calls: Captured[] = [];
    const result = await runCoordinatorPlanning({
      identity: { role: "coordinator" },
      request: "USER_REQUEST_SENTINEL",
      objective: "USER_OBJECTIVE_SENTINEL",
      context: "USER_CONTEXT_SENTINEL",
      requirements: ["EXPLICIT_REQUIREMENT_SENTINEL"],
      project_root: "/proj",
      provider: capturingProvider(calls),
      timeout_ms: 1000,
    });
    assert.equal(result.outcome, "completed");
    const prompt = calls[0].prompt;
    for (const required of ["USER_REQUEST_SENTINEL", "USER_OBJECTIVE_SENTINEL", "USER_CONTEXT_SENTINEL", "EXPLICIT_REQUIREMENT_SENTINEL"]) {
      assert.ok(prompt.includes(required), `coordinator prompt preserves ${required}`);
    }
    assert.ok(prompt.includes("Coordinator (coordinator)"));
    for (const forbidden of ["IMPLEMENTER_INTERNALS_SENTINEL", "REVIEWER_PRIVATE_SENTINEL", "TL_DELIBERATION_SENTINEL", "TEST_PROVIDER_NAME", TEST_PROVIDER_SECRET, TEST_API_TOKEN, "ready", "technical_approval"]) {
      assert.ok(!prompt.includes(forbidden), `coordinator prompt excludes ${forbidden}`);
    }
    assert.equal(calls[0].role, "coordinator");
  });
});

describe("handoff and artifact isolation", () => {
  it("passes handoffs through T-005 without merging them into prompts", async () => {
    const calls: Captured[] = [];
    const outcome = await executeIndependentImplementer({
      identity: { role: "implementer" },
      handoff: {
        from: "technical-lead",
        to: "implementer",
        objective: "HANDOFF_ONLY_OBJECTIVE_SENTINEL",
        requirements: ["HANDOFF_ONLY_REQUIREMENT_SENTINEL"],
      },
      input: {
        ticket: { ...ticketBase },
        specialty: "backend",
        role: "implementer",
        project_root: "/proj",
        provider: capturingProvider(calls),
        timeout_ms: 1000,
      },
    });
    assert.equal(outcome.execution.outcome, "completed");
    assert.deepEqual(outcome.handoff?.objective, "HANDOFF_ONLY_OBJECTIVE_SENTINEL", "handoff travels as provenance");
    const prompt = calls[0].prompt;
    assert.ok(!prompt.includes("HANDOFF_ONLY_OBJECTIVE_SENTINEL") && !prompt.includes("HANDOFF_ONLY_REQUIREMENT_SENTINEL"), "handoff content never merged into execution prompt");
    assert.ok(prompt.includes("Ticket requirements text."), "flag/ticket input still reaches the prompt");
  });

  it("keeps planning artifact sections out of execution prompts", async () => {
    const calls: Captured[] = [];
    await runPmPlanning({
      identity: { role: "project-manager" },
      coordinator_handoff: { from: "coordinator", to: "project-manager", objective: "PM planning objective." },
      requirements: ["PM_REQUIREMENT_SENTINEL"],
      business_rules: ["BUSINESS_RULE_SENTINEL"],
      project_root: "/proj",
      provider: capturingProvider(calls),
      timeout_ms: 1000,
    });
    const prompt = calls[0].prompt;
    assert.ok(prompt.includes("PM planning objective."), "prompt carries its contracted handoff slice");
    assert.ok(!prompt.includes("BUSINESS_RULE_SENTINEL"), "plan content travels via the result artifact, never the provider prompt");
    assert.ok(!prompt.includes("ARCHITECTURE_NOT_FOR_IMPLEMENTER"));
  });
});

describe("workflow, secret, and report isolation", () => {
  it("shows workflow states only where the contract requires them", async () => {
    const states = ["ready", "changes_requested", "in_progress", "implementation_review", "blocked", "failed", "closed"] as const;
    for (const state of states) {
      const implCalls: Captured[] = [];
      await executeImplementerTicket({
        ticket: { ...ticketBase },
        specialty: "backend",
        role: "implementer",
        project_root: "/proj",
        provider: capturingProvider(implCalls),
        timeout_ms: 1000,
        workflowStateLeak: `STATE_${state}_SENTINEL`,
      } as never);
      assert.ok(!implCalls[0].prompt.includes(`STATE_${state}_SENTINEL`), `implementer prompt has no ${state} internals`);
      const reviewCalls: Captured[] = [];
      await executeReviewerTicket({
        ticket: { ...ticketBase },
        implementation_result: "result",
        role: "senior-reviewer",
        project_root: "/proj",
        provider: capturingProvider(reviewCalls),
        timeout_ms: 1000,
        workflowStateLeak: `STATE_${state}_SENTINEL`,
      } as never);
      assert.ok(!reviewCalls[0].prompt.includes(`STATE_${state}_SENTINEL`), `reviewer prompt has no ${state} internals`);
    }
    const tlCalls: Captured[] = [];
    await executeTechnicalLeadReview({
      evidence: [{ ...ticketBase, state: "blocked" as const }],
      role: "technical-lead",
      project_root: "/proj",
      provider: capturingProvider(tlCalls),
      timeout_ms: 1000,
    });
    assert.ok(tlCalls[0].prompt.includes("[blocked]"), "evidence state present exactly where contracted");
  });

  it("never exposes provider secrets or internals in any role prompt", async () => {
    const prompts: string[] = [];
    const collector = {
      name: "TEST_PROVIDER_NAME",
      execute: async (request: { prompt: string }) => {
        prompts.push(request.prompt);
        return { status: "succeeded" as const, text: "done" };
      },
    };
    await executeImplementerTicket({ ticket: { ...ticketBase }, specialty: "backend", role: "implementer", project_root: "/proj", provider: collector, timeout_ms: 1000 });
    await executeReviewerTicket({ ticket: { ...ticketBase }, implementation_result: "r", role: "senior-reviewer", project_root: "/proj", provider: collector, timeout_ms: 1000 });
    for (const prompt of prompts) {
      for (const forbidden of ["TEST_PROVIDER_NAME", TEST_PROVIDER_SECRET, TEST_API_TOKEN, "Bearer ", "api_key"]) {
        assert.ok(!prompt.includes(forbidden), `provider boundary holds for ${forbidden}`);
      }
    }
  });

  it("keeps prior reviewer reports out of later implementer prompts", async () => {
    const reviewCalls: Captured[] = [];
    const reviewed = await executeReviewerTicket({
      ticket: { ...ticketBase },
      implementation_result: "result",
      role: "senior-reviewer",
      project_root: "/proj",
      provider: capturingProvider(reviewCalls, "PRIVATE_REVIEW_NOTE"),
      timeout_ms: 1000,
    });
    assert.ok(reviewed.outcome === "completed" && reviewed.report === "PRIVATE_REVIEW_NOTE");
    const implCalls: Captured[] = [];
    await executeImplementerTicket({
      ticket: { ...ticketBase },
      specialty: "backend",
      role: "implementer",
      project_root: "/proj",
      provider: capturingProvider(implCalls),
      timeout_ms: 1000,
    });
    assert.ok(!implCalls[0].prompt.includes("PRIVATE_REVIEW_NOTE"), "reports never flow into unrelated prompts without an explicit contracted field");
  });
});

describe("context completeness and determinism", () => {
  it("preserves legitimately required upstream context end to end", async () => {
    const tlCalls: Captured[] = [];
    await executeTechnicalLeadReview({
      evidence: [{ id: "T-001", title: "T", description: "D", requirements: "UPSTREAM_REQUIREMENT_SENTINEL", state: "technical_approval" as const }],
      role: "technical-lead",
      project_root: "/proj",
      provider: capturingProvider(tlCalls),
      timeout_ms: 1000,
    });
    assert.ok(tlCalls[0].prompt.includes("UPSTREAM_REQUIREMENT_SENTINEL"), "PM requirements reach TL");
    const implCalls: Captured[] = [];
    await executeImplementerTicket({
      ticket: { id: "T-001", title: "T", description: "Mapped description.\n\nAcceptance criteria:\nMAPPED_ACCEPTANCE_SENTINEL", requirements: "R" },
      specialty: "backend",
      role: "implementer",
      project_root: "/proj",
      provider: capturingProvider(implCalls),
      timeout_ms: 1000,
    });
    assert.ok(implCalls[0].prompt.includes("MAPPED_ACCEPTANCE_SENTINEL"), "mapped acceptance reaches Implementer through ticket description");
  });

  it("builds identical prompts for identical inputs without mutating them", async () => {
    const first: Captured[] = [];
    const second: Captured[] = [];
    const input = () => ({
      ticket: { ...ticketBase },
      specialty: "backend" as const,
      role: "implementer" as const,
      project_root: "/proj",
      timeout_ms: 1000,
    });
    const before = JSON.stringify(input());
    await executeImplementerTicket({ ...input(), provider: capturingProvider(first) });
    await executeImplementerTicket({ ...input(), provider: capturingProvider(second) });
    assert.equal(first[0].prompt, second[0].prompt, "deterministic prompt construction");
    assert.equal(JSON.stringify(input()), before, "caller input never mutated");
  });
});

describe("cli context compatibility", () => {
  it("passes flag inputs without config, secret, or handoff leakage", async () => {
    const calls: Captured[] = [];
    const provider = capturingProvider(calls);
    const deps: RoleCommandDeps = {
      projectRoot: "/proj",
      loadConfiguration: () => ({ SECRET_CONFIG_MARKER: true }) as never,
      createAgent: () => provider,
      readReviewDecision: async () => ({ decision: "approved" as const }),
      readStdinText: async () => "",
      executeImplementer: executeIndependentImplementer,
      executeSeniorReviewer: async () => {
        throw new Error("never invoked");
      },
      executeTechnicalLead: async () => {
        throw new Error("never invoked");
      },
      executeProjectManager: async () => {
        throw new Error("never invoked");
      },
      executeCoordinator: async () => {
        throw new Error("never invoked");
      },
    };
    const result = await runRoleCommand(deps, [
      "role", "implementer", "--id", "T-001", "--title", "CLI title.",
      "--description", "CLI description.", "--requirements", "CLI requirements.",
      "--specialty", "backend",
    ]);
    assert.equal(result.exitCode, 0);
    assert.ok(calls[0].prompt.includes("CLI requirements."), "flag inputs reach the prompt");
    assert.ok(!calls[0].prompt.includes("SECRET_CONFIG_MARKER"), "configuration never leaks into prompts");
    assert.ok(!calls[0].prompt.includes("TEST_PROVIDER_SECRET"), "provider closure never leaks into prompts");
    assert.equal(calls[0].role, "implementer");
  });
});

describe("context isolation source boundaries", () => {
  it("builds prompts from explicit fields with no whole-object serialization", () => {
    assert.equal(ROLE_IDS.length, 5);
    for (const file of [
      "src/execution/implementer.ts",
      "src/execution/reviewer.ts",
      "src/execution/technical-lead.ts",
      "src/execution/pm-testing.ts",
      "src/runtime/coordinator-planning.ts",
      "src/runtime/pm-planning.ts",
      "src/runtime/tl-planning.ts",
      "src/runtime/tl-decomposition.ts",
      "src/roles/independent-execution.ts",
      "src/cli-role.ts",
    ]) {
      const source = readFileSync(join(__dirname, "..", "..", file), "utf8");
      const nonErrorLines = source.split("\n").filter((line) => !line.includes("fail(") && !/JSON\.stringify\(.*\) !== JSON\.stringify\(/.test(line));
      assert.ok(!/JSON\.stringify\((raw|input|ticket|validated|artifact|result|handoff|evidence)\b/.test(nonErrorLines.join("\n")), `${file} never serializes whole inputs into prompts (fail() diagnostics and canonical-equality checks excluded)`);
      assert.ok(!/\{\s*\.\.\.(artifact|result|everything|input)\b/.test(source), `${file} never spreads whole objects into context`);
    }
    const promptSource = readFileSync(join(__dirname, "..", "..", "src", "providers", "prompt.ts"), "utf8");
    assert.ok(!/process\.env|token|secret|credential/i.test(promptSource), "prompt renderer knows no secrets");
  });
});
