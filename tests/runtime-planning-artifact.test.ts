import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_IDS } from "../src/roles/contract";
import { runPmPlanning } from "../src/runtime/pm-planning";
import { runTechnicalLeadPlanning } from "../src/runtime/tl-planning";
import {
  PlanningArtifactInput,
  createPlanningArtifact,
  isPlanningArtifact,
  validatePlanningArtifact,
  withCoordinatorPlanning,
  withPmPlanning,
  withTechnicalLeadPlanning,
} from "../src/runtime/planning-artifact";

// Planning artifact tests (M23 T-009): the shared canonical
// planning data model. Pure data: construction and composition
// never invoke anything.
const coordinatorSection = {
  request: "Add authentication to the project.",
  objective: "Let users sign in securely.",
  context: "Existing API with no auth.",
  requirements: ["Users can sign in"],
  constraints: ["No new database"],
  questions: ["Which provider?"],
};

const pmSection = {
  requirements: ["Users can sign in"],
  scope: { in_scope: ["Sign-in form"], out_of_scope: ["Social login"] },
  acceptance_criteria: ["Invalid credentials are rejected."],
  business_rules: ["Verified users access protected resources."],
  business_constraints: ["Launch with the existing user base."],
  questions: ["Is password reset in scope?"],
};

const tlSection = {
  architecture: ["Layered modules."],
  decomposition_strategy: ["Split by bounded context."],
  technical_constraints: ["Reuse existing auth tables."],
  dependencies: ["Session store availability."],
  questions: ["Which session store survives deploy?"],
};

describe("planning artifact construction", () => {
  it("builds a minimal valid artifact", () => {
    const artifact = createPlanningArtifact({});
    assert.deepEqual(artifact, {});
    assert.ok(Object.isFrozen(artifact));
    assert.ok(isPlanningArtifact(artifact));
  });

  it("builds a fully populated artifact", () => {
    const artifact = createPlanningArtifact({
      coordinator: coordinatorSection,
      project_manager: pmSection,
      technical_lead: tlSection,
    });
    assert.equal(artifact.coordinator?.request, "Add authentication to the project.");
    assert.equal(artifact.coordinator?.objective, "Let users sign in securely.");
    assert.deepEqual(artifact.project_manager?.scope, { in_scope: ["Sign-in form"], out_of_scope: ["Social login"] });
    assert.deepEqual(artifact.project_manager?.business_rules, ["Verified users access protected resources."]);
    assert.deepEqual(artifact.technical_lead?.architecture, ["Layered modules."]);
    assert.deepEqual(artifact.technical_lead?.technical_constraints, ["Reuse existing auth tables."]);
  });

  it("represents partial planning without placeholders", () => {
    const coordinatorOnly = createPlanningArtifact({ coordinator: { request: "Add auth." } });
    assert.equal(coordinatorOnly.coordinator?.request, "Add auth.");
    assert.equal(coordinatorOnly.project_manager, undefined);
    assert.equal(coordinatorOnly.technical_lead, undefined);
    assert.ok(!JSON.stringify(coordinatorOnly).match(/unknown|not provided|pending|TODO/i), "absence, never placeholder text");
    const withPm = createPlanningArtifact({ coordinator: { request: "Add auth." }, project_manager: pmSection });
    assert.ok(withPm.coordinator !== undefined && withPm.project_manager !== undefined);
    assert.equal(withPm.technical_lead, undefined);
  });

  it("rejects malformed input without coercion", () => {
    assert.throws(() => createPlanningArtifact(null as unknown as PlanningArtifactInput));
    assert.throws(() => createPlanningArtifact([] as unknown as PlanningArtifactInput));
    assert.throws(() => createPlanningArtifact({ sprint: {} } as unknown as PlanningArtifactInput), "unknown sections rejected");
    assert.throws(() => createPlanningArtifact({ coordinator: { request: "" } }), "empty request rejected");
    assert.throws(() => createPlanningArtifact({ coordinator: { request: "Add auth.", requirements: "not-an-array" } }));
    assert.throws(() => createPlanningArtifact({ coordinator: { request: "Add auth.", requirements: [""] } }));
    assert.throws(() => createPlanningArtifact({ project_manager: { ...pmSection, scope: null } }), "explicit null scope rejected");
    assert.throws(() => createPlanningArtifact({ project_manager: { ...pmSection, scope: { in_scope: "x", out_of_scope: [] } } }));
    assert.throws(() => createPlanningArtifact({ technical_lead: { ...tlSection, dependencies: [7] } }));
    assert.equal(isPlanningArtifact({ coordinator: { request: "" } }), false);
    assert.equal(isPlanningArtifact({ task: {} }), false);
    assert.equal(isPlanningArtifact(null), false);
  });

  it("validates and copies without mutating caller data", () => {
    const input = { coordinator: { ...coordinatorSection, requirements: ["Users can sign in"] } };
    const before = JSON.stringify(input);
    const artifact = validatePlanningArtifact(input);
    assert.deepEqual(artifact.coordinator?.requirements, ["Users can sign in"]);
    assert.equal(JSON.stringify(input), before);
    (input.coordinator.requirements as string[]).push("late addition");
    assert.deepEqual(artifact.coordinator?.requirements, ["Users can sign in"], "post-construction caller edits never leak in");
  });
});

describe("planning artifact ownership", () => {
  it("keeps business and technical fields distinct per role", () => {
    const artifact = createPlanningArtifact({
      coordinator: coordinatorSection,
      project_manager: pmSection,
      technical_lead: tlSection,
    });
    assert.deepEqual(artifact.project_manager?.business_constraints, ["Launch with the existing user base."]);
    assert.deepEqual(artifact.technical_lead?.technical_constraints, ["Reuse existing auth tables."]);
    assert.notDeepEqual(artifact.project_manager?.business_constraints, artifact.technical_lead?.technical_constraints);
    assert.equal((artifact.coordinator as unknown as Record<string, unknown>).business_rules, undefined, "coordinator never owns business rules");
    assert.equal((artifact.coordinator as unknown as Record<string, unknown>).architecture, undefined, "coordinator never owns architecture");
    assert.equal((artifact.project_manager as unknown as Record<string, unknown>).architecture, undefined, "PM never owns architecture");
    assert.equal((artifact.project_manager as unknown as Record<string, unknown>).dependencies, undefined, "PM never owns technical dependencies");
    assert.equal((artifact.technical_lead as unknown as Record<string, unknown>).business_rules, undefined, "TL never owns business rules");
    assert.equal((artifact.technical_lead as unknown as Record<string, unknown>).scope, undefined, "TL never owns business scope");
  });

  it("preserves strings verbatim with order intact", () => {
    const artifact = createPlanningArtifact({
      coordinator: { ...coordinatorSection, requirements: ["  spaced  ", "second", "first"] },
      project_manager: { ...pmSection, acceptance_criteria: ["Zebra outcome.", "Apple outcome."] },
    });
    assert.deepEqual(artifact.coordinator?.requirements, ["  spaced  ", "second", "first"], "no trimming, no sorting, no dedup");
    assert.deepEqual(artifact.project_manager?.acceptance_criteria, ["Zebra outcome.", "Apple outcome."]);
  });
});

describe("planning artifact immutability", () => {
  it("freezes the artifact at every level", () => {
    const artifact = createPlanningArtifact({
      coordinator: coordinatorSection,
      project_manager: pmSection,
      technical_lead: tlSection,
    });
    assert.ok(Object.isFrozen(artifact));
    assert.ok(Object.isFrozen(artifact.coordinator) && Object.isFrozen(artifact.coordinator?.requirements));
    assert.ok(Object.isFrozen(artifact.project_manager) && Object.isFrozen(artifact.project_manager?.scope));
    assert.ok(Object.isFrozen(artifact.technical_lead) && Object.isFrozen(artifact.technical_lead?.dependencies));
    assert.throws(() => {
      (artifact as { coordinator?: unknown }).coordinator = undefined;
    });
    assert.throws(() => {
      (artifact.project_manager?.requirements as string[]).push("injected");
    });
  });
});

describe("planning artifact questions", () => {
  it("keeps every role's questions explicit and unanswered", () => {
    const artifact = createPlanningArtifact({
      coordinator: coordinatorSection,
      project_manager: pmSection,
      technical_lead: tlSection,
    });
    assert.deepEqual(artifact.coordinator?.questions, ["Which provider?"]);
    assert.deepEqual(artifact.project_manager?.questions, ["Is password reset in scope?"]);
    assert.deepEqual(artifact.technical_lead?.questions, ["Which session store survives deploy?"]);
    assert.ok(!JSON.stringify(artifact).match(/answer|assum|resolved|approved/i), "questions stay questions");
  });
});

describe("planning artifact composition", () => {
  it("grows incrementally from Coordinator to PM to TL", () => {
    const first = createPlanningArtifact({ coordinator: { request: "Add auth." } });
    const second = withPmPlanning(first, pmSection);
    assert.equal(second.coordinator?.request, "Add auth.", "Coordinator data preserved");
    assert.deepEqual(second.project_manager?.requirements, ["Users can sign in"]);
    assert.equal(second.technical_lead, undefined);
    const third = withTechnicalLeadPlanning(second, tlSection);
    assert.equal(third.coordinator?.request, "Add auth.");
    assert.deepEqual(third.project_manager?.scope, { in_scope: ["Sign-in form"], out_of_scope: ["Social login"] });
    assert.deepEqual(third.technical_lead?.dependencies, ["Session store availability."]);
  });

  it("replaces only the supplied section deterministically", () => {
    const base = createPlanningArtifact({ coordinator: coordinatorSection, project_manager: pmSection, technical_lead: tlSection });
    const updated = withPmPlanning(base, { ...pmSection, requirements: ["Revised requirement"] });
    assert.deepEqual(updated.project_manager?.requirements, ["Revised requirement"]);
    assert.equal(updated.coordinator?.request, "Add authentication to the project.", "unrelated sections untouched");
    assert.deepEqual(updated.technical_lead?.architecture, ["Layered modules."]);
    const again = withPmPlanning(base, { ...pmSection, requirements: ["Revised requirement"] });
    assert.deepEqual(updated, again, "repeated composition is deterministic");
    assert.equal(JSON.stringify(base.project_manager?.requirements), JSON.stringify(["Users can sign in"]), "base artifact never mutated");
  });

  it("composes real T-007 and T-008 result plans without loss", async () => {
    const stubProvider = {
      name: "stub",
      execute: async () => ({ status: "succeeded" as const, text: "noted" }),
    };
    const base = { project_root: "/proj", provider: stubProvider, timeout_ms: 1000 };
    const pmResult = await runPmPlanning({
      ...base,
      identity: { role: "project-manager" },
      coordinator_handoff: {
        from: "coordinator",
        to: "project-manager",
        objective: "Add authentication.",
        context: "Add authentication to the project.",
      },
      requirements: ["Users can sign in"],
      scope: { in_scope: ["Sign-in form"], out_of_scope: ["Social login"] },
      acceptance_criteria: ["Invalid credentials are rejected."],
      business_rules: ["Verified users access protected resources."],
      business_constraints: ["Launch with the existing user base."],
    });
    assert.equal(pmResult.outcome, "completed");
    assert.ok(pmResult.outcome === "completed");
    const tlResult = await runTechnicalLeadPlanning({
      ...base,
      identity: { role: "technical-lead" },
      pm_handoff: pmResult.handoff,
      architecture: ["Layered modules."],
      dependencies: ["Session store availability."],
    });
    assert.equal(tlResult.outcome, "completed");
    assert.ok(tlResult.outcome === "completed");
    const artifact = withTechnicalLeadPlanning(
      withPmPlanning(
        createPlanningArtifact({ coordinator: { request: "Add authentication to the project." } }),
        pmResult.plan,
      ),
      tlResult.plan,
    );
    assert.equal(artifact.coordinator?.request, "Add authentication to the project.");
    assert.deepEqual(artifact.project_manager?.business_rules, ["Verified users access protected resources."]);
    assert.deepEqual(artifact.technical_lead?.architecture, ["Layered modules."]);
    assert.deepEqual(artifact.technical_lead?.dependencies, ["Session store availability."]);
  });

  it("rejects invalid composition input", () => {
    const base = createPlanningArtifact({ coordinator: { request: "Add auth." } });
    assert.throws(() => withPmPlanning(base, { requirements: "not-an-array" }));
    assert.throws(() => withTechnicalLeadPlanning(base, null));
    assert.throws(() => withCoordinatorPlanning(base, { request: "" }));
    assert.throws(() => withPmPlanning(null as unknown as ReturnType<typeof createPlanningArtifact>, pmSection));
  });
});

describe("planning artifact opacity and separation", () => {
  it("never sources structured fields from provider report text", () => {
    const report = "Requirements: use JWT with Redis. Tasks: T-1, T-2.";
    const artifact = createPlanningArtifact({
      coordinator: { request: "Add auth." },
      project_manager: pmSection,
      technical_lead: tlSection,
    });
    assert.ok(!JSON.stringify(artifact).includes(report), "report text absent unless explicitly supplied as structured input");
    assert.ok(!JSON.stringify(artifact).match(/JWT|Redis|T-1/i));
  });

  it("introduces no execution, orchestration, persistence, task, or sprint behavior", () => {
    assert.equal(ROLE_IDS.length, 5);
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "planning-artifact.ts"), "utf8");
    assert.ok(!/Manager|Registry|Resolver|Discovery|Finder|Chooser/i.test(source.replace(/projects?[\s_-]?manager/gi, "")));
    for (const token of [
      "AgentProvider",
      "executeWithTimeout",
      "runPmPlanning",
      "runCoordinatorPlanning",
      "runTechnicalLeadPlanning",
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
      "TaskModel",
      "SprintModel",
      "Task ",
      "Sprint ",
      "approval",
      "approve",
    ]) {
      assert.ok(!source.includes(token), `artifact never touches ${token}`);
    }
    assert.ok(!/from "\.\.\/(execution|providers|config|cli)/.test(source));
    assert.ok(!/from "\.\.\/workflow\//.test(source));
    assert.ok(!/async |await |Promise</.test(source), "pure synchronous data layer");
  });
});
