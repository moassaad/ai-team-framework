import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_IDS } from "../src/roles/contract";
import { runTechnicalLeadPlanning } from "../src/runtime/tl-planning";

// TL planning tests (M23 T-008): PM handoff in, technical plan
// out — never tasks, sprints, or reviews. Hermetic: providers are
// caller-supplied counting stubs.
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

function pmHandoff() {
  return {
    from: "project-manager",
    to: "technical-lead",
    objective: "Define technical architecture and decomposition for: Add authentication.",
    requirements: ["Users can sign in"],
    acceptance_criteria: ["Invalid credentials are rejected."],
  };
}

function planningInput(calls: CallRecord[], overrides: Record<string, unknown> = {}) {
  return {
    identity: { role: "technical-lead" },
    pm_handoff: pmHandoff(),
    project_root: "/proj",
    provider: countingProvider(calls, "Technical considerations noted."),
    timeout_ms: 1000,
    ...overrides,
  };
}

describe("tl planning identity and handoff", () => {
  it("accepts the explicit TL identity", async () => {
    const calls: CallRecord[] = [];
    const result = await runTechnicalLeadPlanning(
      planningInput(calls, { architecture: ["Layered modules."], dependencies: ["Existing auth tables."] }),
    );
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.role === "technical-lead");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].role, "technical-lead");
    assert.ok(calls[0].prompt.includes("(technical-lead)"), "canonical TL prompt reused");
  });

  it("rejects every other identity before any provider call", async () => {
    const calls: CallRecord[] = [];
    for (const role of ["coordinator", "project-manager", "implementer", "senior-reviewer", "tl", "bogus", null]) {
      await assert.rejects(runTechnicalLeadPlanning(planningInput(calls, { identity: { role } })), `no planning as ${String(role)}`);
    }
    await assert.rejects(runTechnicalLeadPlanning(planningInput(calls, { identity: null })));
    assert.equal(calls.length, 0);
  });

  it("consumes only PM → TL handoffs without retargeting", async () => {
    const calls: CallRecord[] = [];
    await assert.rejects(
      runTechnicalLeadPlanning(planningInput(calls, { pm_handoff: { from: "coordinator", to: "technical-lead", objective: "work" } })),
      "Coordinator → TL never becomes a PM handoff",
    );
    await assert.rejects(
      runTechnicalLeadPlanning(planningInput(calls, { pm_handoff: { from: "technical-lead", to: "technical-lead", objective: "work" } })),
      "no self-handoff",
    );
    await assert.rejects(
      runTechnicalLeadPlanning(planningInput(calls, { pm_handoff: { from: "technical-lead", to: "implementer", objective: "work" } })),
      "execution handoffs are not planning input",
    );
    await assert.rejects(
      runTechnicalLeadPlanning(planningInput(calls, { pm_handoff: { from: "pm", to: "technical-lead", objective: "work" } })),
      "aliases never validate",
    );
    assert.equal(calls.length, 0);
  });

  it("leaves the caller handoff unchanged", async () => {
    const calls: CallRecord[] = [];
    const handoff = pmHandoff();
    const before = JSON.stringify(handoff);
    const result = await runTechnicalLeadPlanning(planningInput(calls, { pm_handoff: handoff, architecture: ["Layered modules."] }));
    assert.equal(JSON.stringify(handoff), before);
    assert.equal(result.outcome, "completed");
  });
});

describe("tl structured planning content", () => {
  const technical = {
    architecture: ["Second architecture line.", "First architecture line."],
    decomposition_strategy: ["Split by bounded context; no task objects."],
    technical_constraints: ["Must reuse existing auth tables."],
    dependencies: ["Session store availability."],
  };

  it("preserves caller technical content verbatim with order intact", async () => {
    const calls: CallRecord[] = [];
    const result = await runTechnicalLeadPlanning(planningInput(calls, technical));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed");
    assert.deepEqual(result.plan.architecture, ["Second architecture line.", "First architecture line."]);
    assert.deepEqual(result.plan.decomposition_strategy, ["Split by bounded context; no task objects."]);
    assert.deepEqual(result.plan.technical_constraints, ["Must reuse existing auth tables."]);
    assert.deepEqual(result.plan.dependencies, ["Session store availability."]);
    assert.ok(Object.isFrozen(result.plan) && Object.isFrozen(result.plan.architecture) && Object.isFrozen(result.plan.dependencies));
  });

  it("handles empty collections consistently with nothing invented", async () => {
    const calls: CallRecord[] = [];
    const result = await runTechnicalLeadPlanning(planningInput(calls));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed");
    assert.deepEqual(result.plan.architecture, []);
    assert.deepEqual(result.plan.decomposition_strategy, []);
    assert.deepEqual(result.plan.technical_constraints, []);
    assert.deepEqual(result.plan.dependencies, []);
    assert.deepEqual(result.plan.questions, []);
    assert.ok(!JSON.stringify(result).match(/jwt|redis|postgres|kubernetes|microservice|task-[0-9]|sprint-[0-9]/i), "no technical content invented");
  });

  it("keeps decomposition strategy free of task objects", async () => {
    const calls: CallRecord[] = [];
    const result = await runTechnicalLeadPlanning(
      planningInput(calls, { decomposition_strategy: ["Phase one: boundaries.", "Phase two: sequencing."] }),
    );
    assert.ok(result.outcome === "completed" && result.role === "technical-lead");
    assert.ok(!("tasks" in result) && !("sprints" in result) && !("handoff" in result), "no task, sprint, or handoff artifact emitted");
  });
});

describe("tl provider, clarification, and boundaries", () => {
  it("invokes the provider once and keeps its report opaque", async () => {
    const calls: CallRecord[] = [];
    const result = await runTechnicalLeadPlanning(planningInput(calls, { architecture: ["Layered modules."] }));
    assert.equal(calls.length, 1);
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.report === "Technical considerations noted.");
    assert.ok(!JSON.stringify(result.plan).includes("Technical considerations noted."), "report never populates structured fields");
    assert.ok(calls[0].prompt.includes("Users can sign in"), "PM business source reaches provider context verbatim");
  });

  it("bounds provider failure with no retry", async () => {
    const calls: CallRecord[] = [];
    const input = planningInput(calls);
    const result = await runTechnicalLeadPlanning({ ...input, provider: countingProvider(calls, "ignored", true) });
    assert.equal(calls.length, 1);
    assert.equal(result.outcome, "failed");
    assert.ok(result.outcome === "failed" && result.error.kind === "provider_error");
  });

  it("returns clarification-required for caller-declared technical questions", async () => {
    const calls: CallRecord[] = [];
    const result = await runTechnicalLeadPlanning(
      planningInput(calls, { architecture: ["Layered modules."], questions: ["Which session store survives deploy?"] }),
    );
    assert.equal(result.outcome, "clarification-required", "T-007 convention preserved");
    assert.ok(result.outcome === "clarification-required");
    assert.deepEqual(result.plan.questions, ["Which session store survives deploy?"]);
    assert.deepEqual(result.plan.architecture, ["Layered modules."], "established content preserved alongside questions");
    assert.equal(calls.length, 1, "planning still runs once; nothing else is invoked");
  });

  it("never reviews, corrects, implements, or orchestrates", async () => {
    const calls: CallRecord[] = [];
    const result = await runTechnicalLeadPlanning(planningInput(calls, { architecture: ["Layered modules."] }));
    assert.equal(calls.length, 1, "exactly the TL planning call");
    assert.equal(result.outcome, "completed");
  });
});

describe("tl planning architecture", () => {
  it("stays separate from review, planning siblings, workflow, and providers", async () => {
    const calls: CallRecord[] = [];
    const result = await runTechnicalLeadPlanning(planningInput(calls, { architecture: ["Layered modules."] }));
    assert.equal(result.outcome, "completed");
    assert.equal(ROLE_IDS.length, 5);
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "tl-planning.ts"), "utf8");
    assert.ok(!/Manager|Registry|Resolver|Discovery|Finder|Chooser/i.test(source.replace(/projects?[\s_-]?manager|Technical[\s_-]?Lead|technical-lead/gi, "")));
    assert.ok(!/executeTechnicalLeadReview\s*\(/.test(source), "sprint review referenced only as a separation boundary, never invoked");
    for (const token of [
      "TechnicalLeadExecution",
      "createTechnicalLeadCorrectionTicket",
      "runPmPlanning",
      "runCoordinatorPlanning",
      "runPmUserTesting",
      "executeIndependent",
      "runSprintWorkflow",
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
      "reenter",
      "Router",
      "FAST",
    ]) {
      assert.ok(!source.includes(token), `planning never touches ${token}`);
    }
    assert.ok(!/SprintModel|createSprint|new Sprint|sprint_id|TaskModel|createTask|IssueModel|createIssue/.test(source), "no task, sprint, or issue model created");
    assert.ok(!/from "\.\.\/(execution|config|cli)/.test(source));
    assert.ok(!/from "\.\.\/workflow\//.test(source));
    assert.ok(source.includes("validateAgentHandoff") && source.includes("renderRolePrompt"));
  });
});
