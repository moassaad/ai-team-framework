import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_IDS } from "../src/roles/contract";
import { decidePlanningApproval } from "../src/runtime/planning-approval";

// Planning approval tests (M23 T-010): explicit PM/TL decisions
// against complete artifacts. Synchronous and provider-free: no
// stubs exist because no provider can ever be called.
const coordinator = {
  request: "Add authentication to the project.",
  objective: "Let users sign in securely.",
  requirements: ["Users can sign in"],
  constraints: ["No new database"],
  questions: [],
};

const projectManager = {
  requirements: ["Users can sign in"],
  scope: { in_scope: ["Sign-in form"], out_of_scope: ["Social login"] },
  acceptance_criteria: ["Invalid credentials are rejected."],
  business_rules: ["Verified users access protected resources."],
  business_constraints: ["Launch with the existing user base."],
  questions: [],
};

const technicalLead = {
  architecture: ["Layered modules."],
  decomposition_strategy: ["Split by bounded context."],
  technical_constraints: ["Reuse existing auth tables."],
  dependencies: ["Session store availability."],
  questions: [],
};

function completeArtifact() {
  return { coordinator, project_manager: projectManager, technical_lead: technicalLead };
}

function approval(identity: unknown, decision: unknown, notes?: unknown) {
  return { identity, decision, ...(notes !== undefined ? { notes } : {}) };
}

describe("planning approval validation", () => {
  it("accepts a valid complete artifact from either authority", () => {
    for (const role of ["project-manager", "technical-lead"] as const) {
      const result = decidePlanningApproval({
        artifact: completeArtifact(),
        approval: approval({ role }, "approved"),
      });
      assert.equal(result.outcome, "approved");
      assert.equal(result.authority, role);
      assert.ok(Object.isFrozen(result));
      assert.ok(Object.isFrozen(result.artifact));
      assert.deepEqual(result.artifact.project_manager?.scope, { in_scope: ["Sign-in form"], out_of_scope: ["Social login"] });
    }
  });

  it("rejects incomplete artifacts without content heuristics", () => {
    assert.throws(() => decidePlanningApproval({
      artifact: { project_manager: projectManager, technical_lead: technicalLead },
      approval: approval({ role: "project-manager" }, "approved"),
    }), "missing Coordinator section");
    assert.throws(() => decidePlanningApproval({
      artifact: { coordinator, technical_lead: technicalLead },
      approval: approval({ role: "project-manager" }, "approved"),
    }), "missing PM section");
    assert.throws(() => decidePlanningApproval({
      artifact: { coordinator, project_manager: projectManager },
      approval: approval({ role: "technical-lead" }, "approved"),
    }), "missing TL section");
    const emptySections = decidePlanningApproval({
      artifact: { coordinator: { request: "Add auth." }, project_manager: { ...projectManager, requirements: [] }, technical_lead: technicalLead },
      approval: approval({ role: "technical-lead" }, "approved"),
    });
    assert.equal(emptySections.outcome, "approved", "presence gated, empty content accepted");
  });

  it("rejects malformed artifacts without mutating them", () => {
    const artifact = completeArtifact();
    const before = JSON.stringify(artifact);
    assert.throws(() => decidePlanningApproval({ artifact: { ...artifact, sprint: {} }, approval: approval({ role: "project-manager" }, "approved") }));
    assert.throws(() => decidePlanningApproval({ artifact: null, approval: approval({ role: "project-manager" }, "approved") }));
    assert.throws(() => decidePlanningApproval({ artifact: { coordinator: { request: "" } }, approval: approval({ role: "project-manager" }, "approved") }));
    assert.equal(JSON.stringify(artifact), before);
  });

  it("validates decisions strictly with no coercion", () => {
    assert.throws(() => decidePlanningApproval({ artifact: completeArtifact(), approval: approval({ role: "project-manager" }, "approve") }));
    assert.throws(() => decidePlanningApproval({ artifact: completeArtifact(), approval: approval({ role: "project-manager" }, "APPROVED") }));
    assert.throws(() => decidePlanningApproval({ artifact: completeArtifact(), approval: approval({ role: "project-manager" }, true) }));
    assert.throws(() => decidePlanningApproval({ artifact: completeArtifact(), approval: approval({ role: "project-manager" }, "changes-required", "") }), "empty notes rejected");
    assert.throws(() => decidePlanningApproval({ artifact: completeArtifact(), approval: approval({ role: "project-manager" }, "changes-required", 7) }));
    const noted = decidePlanningApproval({
      artifact: completeArtifact(),
      approval: approval({ role: "technical-lead" }, "changes-required", "Dependencies need vendor confirmation."),
    });
    assert.equal(noted.outcome, "changes-required");
    assert.equal(noted.notes, "Dependencies need vendor confirmation.", "notes preserved verbatim");
  });
});

describe("planning approval authority", () => {
  it("accepts only PM and TL identities with no inference", () => {
    for (const role of ["coordinator", "implementer", "senior-reviewer", "pm", "tl", "user", "bogus", null]) {
      assert.throws(() => decidePlanningApproval({
        artifact: completeArtifact(),
        approval: approval({ role }, "approved"),
      }), `no approval as ${String(role)}`);
    }
    assert.throws(() => decidePlanningApproval({ artifact: completeArtifact(), approval: approval(null, "approved") }));
    assert.throws(() => decidePlanningApproval({ artifact: completeArtifact(), approval: null as unknown as { readonly identity: unknown; readonly decision: unknown } }));
  });

  it("records each authority's decision independently without sequencing state", () => {
    const artifact = completeArtifact();
    const pm = decidePlanningApproval({ artifact, approval: approval({ role: "project-manager" }, "approved") });
    const tl = decidePlanningApproval({ artifact, approval: approval({ role: "technical-lead" }, "approved") });
    assert.equal(pm.authority, "project-manager");
    assert.equal(tl.authority, "technical-lead");
    assert.deepEqual(pm.artifact, tl.artifact, "same artifact, two independent decisions");
  });
});

describe("planning approval questions and outcomes", () => {
  function withQuestions() {
    return {
      coordinator,
      project_manager: { ...projectManager, questions: ["Is password reset in scope?"] },
      technical_lead: technicalLead,
    };
  }

  it("blocks approval over unresolved questions while allowing changes-required", () => {
    assert.throws(() => decidePlanningApproval({
      artifact: withQuestions(),
      approval: approval({ role: "project-manager" }, "approved"),
    }), "open questions block approval");
    assert.throws(() => decidePlanningApproval({
      artifact: { ...completeArtifact(), technical_lead: { ...technicalLead, questions: ["Which session store?"] } },
      approval: approval({ role: "technical-lead" }, "approved"),
    }), "TL questions block TL approval too");
    const sentBack = decidePlanningApproval({
      artifact: withQuestions(),
      approval: approval({ role: "project-manager" }, "changes-required", "Resolve password reset scope first."),
    });
    assert.equal(sentBack.outcome, "changes-required");
    assert.deepEqual(sentBack.artifact.project_manager?.questions, ["Is password reset in scope?"], "questions preserved, never answered");
    assert.equal(sentBack.notes, "Resolve password reset scope first.");
  });

  it("returns approved artifacts unchanged with nothing downstream triggered", () => {
    const artifact = completeArtifact();
    const before = JSON.stringify(artifact);
    const result = decidePlanningApproval({ artifact, approval: approval({ role: "technical-lead" }, "approved") });
    assert.equal(JSON.stringify(artifact), before, "caller artifact never mutated or marked");
    assert.ok(!("tasks" in result) && !("sprints" in result) && !("report" in result), "no M24, provider, or workflow output");
    assert.ok(!JSON.stringify(result).match(/approved_at|status|transition|reenter/i), "no stamps, states, or re-entry hooks");
  });
});

describe("planning approval separation", () => {
  it("touches no provider, workflow, persistence, task, or final-approval behavior", () => {
    assert.equal(ROLE_IDS.length, 5);
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "planning-approval.ts"), "utf8");
    assert.ok(!/Manager|Registry|Resolver|Discovery|Finder|Chooser/i.test(source.replace(/projects?[\s_-]?manager/gi, "")));
    for (const token of [
      "AgentProvider",
      "executeWithTimeout",
      "runFinalApproval",
      "FinalApproval",
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
      "report",
      "score",
      "async ",
      "await ",
      "Promise<",
    ]) {
      assert.ok(!source.includes(token), `approval never touches ${token}`);
    }
    assert.ok(!/from "\.\.\/(execution|providers|config|cli)/.test(source));
    assert.ok(!/from "\.\.\/workflow\//.test(source));
    assert.ok(source.includes("validatePlanningArtifact") && source.includes("validateAgentIdentity"), "reuses artifact and identity validation");
  });
});
