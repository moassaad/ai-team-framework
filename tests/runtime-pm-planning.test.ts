import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_IDS } from "../src/roles/contract";
import { renderAgentHandoff } from "../src/roles/handoff-validation";
import { PM_PLANNING_NEXT_ACTION, runPmPlanning } from "../src/runtime/pm-planning";

// PM planning tests (M23 T-007): Coordinator handoff in,
// business plan plus PM → TL handoff out. Hermetic: providers
// are caller-supplied counting stubs.
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

function coordinatorHandoff() {
  return {
    from: "coordinator",
    to: "project-manager",
    objective: "Add authentication.",
    context: "Add authentication to the project.",
  };
}

function planningInput(calls: CallRecord[], overrides: Record<string, unknown> = {}) {
  return {
    identity: { role: "project-manager" },
    coordinator_handoff: coordinatorHandoff(),
    project_root: "/proj",
    provider: countingProvider(calls, "Business considerations noted."),
    timeout_ms: 1000,
    ...overrides,
  };
}

describe("pm planning identity and input", () => {
  it("accepts the explicit PM identity", async () => {
    const calls: CallRecord[] = [];
    const result = await runPmPlanning(planningInput(calls, { requirements: ["Users can sign in"] }));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.role === "project-manager");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].role, "project-manager");
    assert.ok(calls[0].prompt.includes("(project-manager)"), "canonical PM prompt reused");
  });

  it("rejects every other identity before any provider call", async () => {
    const calls: CallRecord[] = [];
    for (const role of ["coordinator", "technical-lead", "implementer", "senior-reviewer", "pm", "bogus", null]) {
      await assert.rejects(runPmPlanning(planningInput(calls, { identity: { role } })), `no planning as ${String(role)}`);
    }
    await assert.rejects(runPmPlanning(planningInput(calls, { identity: null })));
    assert.equal(calls.length, 0);
  });

  it("rejects invalid or retargeted handoffs before any provider call", async () => {
    const calls: CallRecord[] = [];
    await assert.rejects(runPmPlanning(planningInput(calls, { coordinator_handoff: { from: "coordinator", to: "project-manager" } })), "objective required");
    await assert.rejects(
      runPmPlanning(planningInput(calls, { coordinator_handoff: { from: "technical-lead", to: "implementer", objective: "work" } })),
      "only Coordinator → PM handoffs consumed",
    );
    await assert.rejects(
      runPmPlanning(planningInput(calls, { coordinator_handoff: { from: "coordinator", to: "technical-lead", objective: "work" } })),
      "no retargeting to another receiver",
    );
    assert.equal(calls.length, 0);
  });
});

describe("pm planning business content", () => {
  const full = {
    requirements: ["Users can sign in"],
    scope: { in_scope: ["Sign-in form"], out_of_scope: ["Social login"] },
    acceptance_criteria: ["User can sign in using the supported authentication method."],
    business_rules: ["Verified users access protected resources."],
    business_constraints: ["Launch with the existing user base."],
  };

  it("preserves requirements, scope, acceptance, rules, and constraints", async () => {
    const calls: CallRecord[] = [];
    const result = await runPmPlanning(planningInput(calls, full));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed");
    assert.deepEqual(result.plan.requirements, ["Users can sign in"]);
    assert.deepEqual(result.plan.scope, { in_scope: ["Sign-in form"], out_of_scope: ["Social login"] });
    assert.deepEqual(result.plan.acceptance_criteria, ["User can sign in using the supported authentication method."]);
    assert.deepEqual(result.plan.business_rules, ["Verified users access protected resources."]);
    assert.deepEqual(result.plan.business_constraints, ["Launch with the existing user base."]);
    assert.ok(Object.isFrozen(result.plan) && Object.isFrozen(result.plan.scope) && Object.isFrozen(result.plan.requirements));
  });

  it("keeps unresolved questions explicit without answering them", async () => {
    const calls: CallRecord[] = [];
    const result = await runPmPlanning(
      planningInput(calls, { requirements: ["Users can sign in"], questions: ["Should social login be supported?", "Is password reset in scope?"] }),
    );
    assert.equal(result.outcome, "clarification-required", "unresolved questions never pretend TL readiness");
    assert.ok(result.outcome === "clarification-required");
    assert.deepEqual(result.plan.questions, ["Should social login be supported?", "Is password reset in scope?"]);
    assert.deepEqual(result.plan.requirements, ["Users can sign in"], "established content preserved alongside questions");
    assert.ok(!("handoff" in result), "no TL handoff while business questions stand");
    assert.equal(calls.length, 1, "planning still runs once; only the handoff is withheld");
  });

  it("invents no requirements, scope, acceptance, rules, or technical content", async () => {
    const calls: CallRecord[] = [];
    const result = await runPmPlanning(planningInput(calls));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed");
    assert.deepEqual(result.plan.requirements, []);
    assert.deepEqual(result.plan.scope, { in_scope: [], out_of_scope: [] });
    assert.deepEqual(result.plan.acceptance_criteria, []);
    assert.deepEqual(result.plan.business_rules, []);
    assert.ok(!JSON.stringify(result).match(/jwt|redis|sanctum|middleware|table|oauth|postgres|sprint|estimate/i), "no technical or planning content invented");
    assert.ok(!("requirements" in result.handoff) && !("acceptance_criteria" in result.handoff), "absent content stays absent, not defaulted");
  });
});

describe("pm to tl handoff", () => {
  const full = {
    requirements: ["Users can sign in"],
    scope: { in_scope: ["Sign-in form"], out_of_scope: ["Social login"] },
    acceptance_criteria: ["Invalid credentials are rejected."],
    business_rules: ["Verified users access protected resources."],
    business_constraints: ["Launch with the existing user base."],
  };

  it("emits a frozen canonical PM → TL handoff with correct field mapping", async () => {
    const calls: CallRecord[] = [];
    const result = await runPmPlanning(planningInput(calls, full));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed");
    assert.equal(result.handoff.from, "project-manager");
    assert.equal(result.handoff.to, "technical-lead");
    assert.deepEqual(result.handoff.requirements, ["Users can sign in"]);
    assert.deepEqual(result.handoff.acceptance_criteria, ["Invalid credentials are rejected."]);
    assert.ok(result.handoff.context?.includes("In scope: Sign-in form"));
    assert.ok(result.handoff.context?.includes("Out of scope: Social login"));
    assert.ok(result.handoff.context?.includes("Business rule: Verified users access protected resources."));
    assert.deepEqual(result.handoff.constraints, ["Launch with the existing user base."]);
    assert.equal(result.handoff.next_action, PM_PLANNING_NEXT_ACTION);
    assert.ok(Object.isFrozen(result.handoff));
    const rendered = renderAgentHandoff(result.handoff);
    assert.ok(rendered.includes("From: project-manager") && rendered.includes("To: technical-lead"));
  });

  it("keeps business meaning out of technical-constraint semantics", async () => {
    const calls: CallRecord[] = [];
    const result = await runPmPlanning(planningInput(calls, full));
    assert.ok(result.outcome === "completed" && result.handoff.from === "project-manager");
    assert.ok(
      result.outcome !== "completed" || !(result.handoff.constraints ?? []).some((entry) => /Business rule/i.test(entry)),
      "business rules never labeled as constraints",
    );
    assert.ok(!JSON.stringify(result.handoff).match(/JWT|Redis|middleware|table|Sanctum/i), "no technical prescription leaks in");
  });

  it("leaves caller content unchanged with nothing silently dropped", async () => {
    const calls: CallRecord[] = [];
    const handoff = coordinatorHandoff();
    const before = JSON.stringify(handoff);
    const result = await runPmPlanning(planningInput(calls, { coordinator_handoff: handoff, ...full }));
    assert.equal(JSON.stringify(handoff), before);
    assert.ok(result.outcome === "completed" && result.handoff.objective.includes("Add authentication."));
  });
});

describe("pm planning provider and boundaries", () => {
  it("invokes the provider exactly once and keeps its report opaque", async () => {
    const calls: CallRecord[] = [];
    const result = await runPmPlanning(planningInput(calls, { requirements: ["Users can sign in"] }));
    assert.equal(calls.length, 1, "no TL, Implementer, Reviewer, or Coordinator invocation");
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.report === "Business considerations noted.");
    assert.ok(!JSON.stringify(result.plan).includes("Business considerations noted."), "report never generates plan content");
    assert.ok(!JSON.stringify(result.handoff).includes("Business considerations noted."));
  });

  it("bounds provider failure with no retry", async () => {
    const calls: CallRecord[] = [];
    const input = planningInput(calls);
    const result = await runPmPlanning({ ...input, provider: countingProvider(calls, "ignored", true) });
    assert.equal(calls.length, 1);
    assert.equal(result.outcome, "failed");
    assert.ok(result.outcome === "failed" && result.error.kind === "provider_error");
  });
});

describe("pm planning architecture", () => {
  it("stays separate from testing, workflow, providers, and orchestration", async () => {
    const calls: CallRecord[] = [];
    const result = await runPmPlanning(planningInput(calls, { requirements: ["Users can sign in"] }));
    assert.equal(result.outcome, "completed");
    assert.equal(ROLE_IDS.length, 5);
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "pm-planning.ts"), "utf8");
    assert.ok(!/Manager|Registry|Resolver|Discovery|Finder|Chooser/i.test(source.replace(/projects?[\s_-]?manager/gi, "")));
    assert.ok(!/runPmUserTesting\w*\s*\(/.test(source), "PM/User Testing referenced only as a separation boundary, never invoked");
    for (const token of [
      "PmUserTestingExecution",
      "runCoordinatorTicket",
      "runSprintWorkflow",
      "executeIndependent",
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
    assert.ok(!/from "\.\.\/workflow\//.test(source));
    assert.ok(source.includes("validateAgentHandoff") && source.includes("renderRolePrompt"));
  });
});
