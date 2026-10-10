import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_IDS } from "../src/roles/contract";
import { renderAgentHandoff } from "../src/roles/handoff-validation";
import { COORDINATOR_PLANNING_NEXT_ACTION, runCoordinatorPlanning } from "../src/runtime/coordinator-planning";

// Coordinator planning tests (M23 T-006): one planning
// invocation producing a Coordinator → PM handoff. Hermetic:
// providers are caller-supplied counting stubs.
interface CallRecord {
  prompt: string;
  project_root: string;
  role?: string;
}

function countingProvider(calls: CallRecord[], text: string, reject = false) {
  return {
    name: "stub",
    execute: async (request: { prompt: string; project_root: string; role?: string }) => {
      calls.push({ prompt: request.prompt, project_root: request.project_root, role: request.role });
      if (reject) {
        throw new Error("provider boom");
      }
      return { status: "succeeded" as const, text };
    },
  };
}

function planningInput(calls: CallRecord[], overrides: Record<string, unknown> = {}) {
  return {
    identity: { role: "coordinator" },
    request: "Add authentication to the project.",
    project_root: "/proj",
    provider: countingProvider(calls, "Planning considerations noted."),
    timeout_ms: 1000,
    ...overrides,
  };
}

describe("coordinator planning identity and invocation", () => {
  it("accepts the explicit Coordinator identity with one provider call", async () => {
    const calls: CallRecord[] = [];
    const result = await runCoordinatorPlanning(planningInput(calls));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.role === "coordinator");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].role, "coordinator");
    assert.ok(calls[0].prompt.includes("(coordinator)"), "canonical Coordinator prompt reused");
  });

  it("rejects every non-Coordinator identity before any provider call", async () => {
    const calls: CallRecord[] = [];
    for (const role of ["project-manager", "technical-lead", "implementer", "senior-reviewer", "pm", "bogus", null]) {
      await assert.rejects(runCoordinatorPlanning(planningInput(calls, { identity: { role } })), `no planning as ${String(role)}`);
    }
    await assert.rejects(runCoordinatorPlanning(planningInput(calls, { identity: null })));
    assert.equal(calls.length, 0, "identity validated before provider invocation");
  });

  it("bounds provider failure to one failed outcome with no retry", async () => {
    const calls: CallRecord[] = [];
    const input = planningInput(calls);
    const failing = { ...input, provider: countingProvider(calls, "ignored", true) };
    const result = await runCoordinatorPlanning(failing);
    assert.equal(calls.length, 1);
    assert.equal(result.outcome, "failed");
    assert.ok(result.outcome === "failed" && result.error.kind === "provider_error");
  });
});

describe("coordinator planning user request", () => {
  it("preserves objective, request, context, and constraints verbatim", async () => {
    const calls: CallRecord[] = [];
    const result = await runCoordinatorPlanning(
      planningInput(calls, {
        objective: "Let users sign in securely.",
        context: "Existing API with no auth.",
        requirements: ["Users can sign in"],
        constraints: ["No new database"],
      }),
    );
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed");
    assert.equal(result.handoff.objective, "Let users sign in securely.");
    assert.ok(result.handoff.context?.includes("Add authentication to the project."));
    assert.ok(result.handoff.context?.includes("Existing API with no auth."));
    assert.deepEqual(result.handoff.requirements, ["Users can sign in"]);
    assert.deepEqual(result.handoff.constraints, ["No new database"]);
  });

  it("carries unresolved questions as handoff notes without answering them", async () => {
    const calls: CallRecord[] = [];
    const result = await runCoordinatorPlanning(
      planningInput(calls, {
        objective: "Add authentication.",
        questions: ["Which authentication provider should be supported?", "Is social login required?"],
      }),
    );
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed");
    assert.equal(
      result.handoff.notes,
      "Which authentication provider should be supported?\nIs social login required?",
      "questions ride verbatim in notes, order preserved",
    );
    assert.equal(result.handoff.requirements, undefined, "questions never become requirements");
    assert.equal(result.handoff.acceptance_criteria, undefined, "planning never authors PM acceptance criteria");
  });

  it("invents no requirements, technology, acceptance criteria, or task structure", async () => {
    const calls: CallRecord[] = [];
    const result = await runCoordinatorPlanning(planningInput(calls, { objective: "Add authentication." }));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed");
    assert.equal(result.handoff.requirements, undefined);
    assert.equal(result.handoff.constraints, undefined);
    assert.equal(result.handoff.artifacts, undefined);
    assert.ok(!JSON.stringify(result.handoff).match(/react|postgres|api key|jwt|sprint|task|estimate|deadline/i), "no invented content anywhere");
    assert.ok(calls[0].prompt.includes("Do not invent requirements"), "prompt states the no-invention boundary");
  });

  it("rejects empty requests without invoking the provider", async () => {
    const calls: CallRecord[] = [];
    await assert.rejects(runCoordinatorPlanning(planningInput(calls, { request: "" })));
    assert.equal(calls.length, 0);
  });
});

describe("coordinator planning handoff", () => {
  it("produces a frozen Coordinator → PM handoff rendering through T-004", async () => {
    const calls: CallRecord[] = [];
    const result = await runCoordinatorPlanning(
      planningInput(calls, { objective: "Add authentication.", questions: ["Existing mechanism?"] }),
    );
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed");
    assert.equal(result.handoff.from, "coordinator");
    assert.equal(result.handoff.to, "project-manager");
    assert.equal(result.handoff.next_action, COORDINATOR_PLANNING_NEXT_ACTION);
    assert.ok(Object.isFrozen(result.handoff) && Object.isFrozen(result.handoff.notes));
    const rendered = renderAgentHandoff(result.handoff);
    assert.ok(rendered.includes("From: coordinator") && rendered.includes("To: project-manager"));
    assert.ok(rendered.includes("Existing mechanism?"));
  });

  it("keeps caller input unchanged and endpoints unretargetable", async () => {
    const calls: CallRecord[] = [];
    const input = planningInput(calls, { requirements: ["Users can sign in"], questions: ["Which provider?"] });
    const snapshot = JSON.stringify({ ...input, provider: "stub", identity: input.identity });
    const result = await runCoordinatorPlanning(input);
    assert.equal(result.outcome, "completed");
    assert.equal(JSON.stringify({ ...input, provider: "stub", identity: input.identity }), snapshot);
    assert.ok(result.outcome === "completed" && result.handoff.from === "coordinator" && result.handoff.to === "project-manager");
  });

  it("uses canonical RoleIds with no provider or model metadata", async () => {
    const calls: CallRecord[] = [];
    const result = await runCoordinatorPlanning(planningInput(calls));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed");
    assert.deepEqual([result.handoff.from, result.handoff.to], ["coordinator", "project-manager"]);
    assert.ok(!JSON.stringify(result.handoff).match(/opencode|delegate|model|session|token/i));
  });
});

describe("coordinator planning boundaries", () => {
  it("invokes no other role and infers no approval", async () => {
    const calls: CallRecord[] = [];
    const result = await runCoordinatorPlanning(planningInput(calls));
    assert.equal(calls.length, 1, "exactly the Coordinator planning call — no PM, TL, Implementer, or Reviewer");
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && !("approved" in result.handoff), "planning completion never implies approval");
  });

  it("keeps the provider report opaque with no parsing", async () => {
    const calls: CallRecord[] = [];
    const result = await runCoordinatorPlanning(planningInput(calls));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.report === "Planning considerations noted.");
    assert.ok(!JSON.stringify(result.handoff).includes("Planning considerations noted."), "report text never leaks into structured fields");
  });
});

describe("coordinator planning architecture", () => {
  it("leaves ticket execution, workflow, and providers untouched", async () => {
    const calls: CallRecord[] = [];
    const result = await runCoordinatorPlanning(planningInput(calls));
    assert.equal(result.outcome, "completed");
    assert.equal(ROLE_IDS.length, 5);
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "coordinator-planning.ts"), "utf8");
    assert.ok(!/Manager|Registry|Resolver|Discovery|Finder|Chooser/i.test(source.replace(/Project\s?Manager|project-manager/gi, "")));
    assert.ok(!/runCoordinatorTicket\s*\(/.test(source), "ticket runtime referenced only as a separation boundary, never nested");
    for (const token of [
      "executeIndependentProjectManager",
      "runSprintWorkflow",
      "runProductionSprintWorkflow",
      "runTechnicalLeadReview",
      "TicketSource",
      "TicketSink",
      "IssueProvider",
      "WorkflowState",
      "delegate-skills",
      "DelegateProvider",
      "relay",
      "github",
      "GitHub",
      "opencode",
      "OpenCode",
      "spec-kit",
      "loadConfig",
      "readConfig",
      "process.env",
      "node:fs",
      "child_process",
      "setTimeout",
      "setInterval",
      "parseReport",
      "sprint",
      "reenter",
      "Router",
      "FAST",
    ]) {
      assert.ok(!source.includes(token), `planning never touches ${token}`);
    }
    assert.ok(!/from "\.\.\/(execution|config|cli)/.test(source));
    assert.ok(!/from "\.\.\/workflow\//.test(source), "no workflow coupling");
    assert.ok(source.includes("validateAgentHandoff") && source.includes("renderRolePrompt"), "reuses handoff validation and role prompts");
  });
});
