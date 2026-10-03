import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_IDS } from "../src/roles/contract";
import { decidePlanningApproval } from "../src/runtime/planning-approval";
import { isSprint } from "../src/runtime/sprint-model";
import { isTask } from "../src/runtime/task-model";
import { runTechnicalLeadTaskDecomposition } from "../src/runtime/tl-decomposition";

// TL task decomposition tests (M24 T-013): approved plan in,
// Sprint + Task[] out. Caller-structured; the provider stays
// opaque. Hermetic: providers are counting stubs.
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

const artifactFixture = {
  coordinator: {
    request: "Add authentication to the project.",
    objective: "Let users sign in securely.",
    requirements: ["Users can sign in"],
    constraints: ["No new database"],
    questions: [],
  },
  project_manager: {
    requirements: ["Users can sign in"],
    scope: { in_scope: ["Sign-in form"], out_of_scope: ["Social login"] },
    acceptance_criteria: ["Invalid credentials are rejected."],
    business_rules: ["Verified users access protected resources."],
    business_constraints: ["Launch with the existing user base."],
    questions: [],
  },
  technical_lead: {
    architecture: ["Layered modules."],
    decomposition_strategy: ["Split by bounded context."],
    technical_constraints: ["Reuse existing auth tables."],
    dependencies: ["Session store availability."],
    questions: [],
  },
};

const sprintFixture = {
  id: "sprint-1",
  goal: "Deliver authentication.",
  scope: { in_scope: ["Sign-in form"], out_of_scope: ["Social login"] },
  acceptance_criteria: ["Invalid credentials are rejected."],
};

function taskFixture(id: string, title: string) {
  return {
    id,
    title,
    description: `Implement ${title}.`,
    requirements: "Users can sign in",
    acceptance_criteria: ["Invalid credentials are rejected."],
  };
}

function approvedFor(artifact: unknown) {
  return decidePlanningApproval({
    artifact,
    approval: { identity: { role: "project-manager" }, decision: "approved" },
  });
}

function decompositionInput(calls: CallRecord[], overrides: Record<string, unknown> = {}) {
  const artifact = JSON.parse(JSON.stringify(artifactFixture)) as typeof artifactFixture;
  return {
    identity: { role: "technical-lead" },
    artifact,
    approval: approvedFor(artifact),
    sprint: { ...sprintFixture },
    tasks: [taskFixture("T-001", "Sign-in form"), taskFixture("T-002", "Credential check")],
    project_root: "/proj",
    provider: countingProvider(calls, "Sequencing considerations noted."),
    timeout_ms: 1000,
    ...overrides,
  };
}

describe("decomposition preconditions", () => {
  it("accepts a valid approved artifact with one provider call", async () => {
    const calls: CallRecord[] = [];
    const result = await runTechnicalLeadTaskDecomposition(decompositionInput(calls));
    assert.equal(result.outcome, "completed");
    assert.ok(result.outcome === "completed" && result.role === "technical-lead");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].role, "technical-lead");
    assert.ok(calls[0].prompt.includes("(technical-lead)"), "canonical TL prompt reused");
    assert.ok(isSprint(result.sprint));
    assert.equal(result.tasks.length, 2);
    assert.ok(result.tasks.every(isTask));
  });

  it("rejects invalid artifacts and non-approved approvals before any provider call", async () => {
    const calls: CallRecord[] = [];
    const artifact = JSON.parse(JSON.stringify(artifactFixture)) as typeof artifactFixture;
    await assert.rejects(
      runTechnicalLeadTaskDecomposition(decompositionInput(calls, { artifact: { ...artifact, technical_lead: undefined } })),
      "incomplete artifact rejected",
    );
    await assert.rejects(
      runTechnicalLeadTaskDecomposition(
        decompositionInput(calls, {
          approval: decidePlanningApproval({
            artifact,
            approval: { identity: { role: "project-manager" }, decision: "changes-required", notes: "Rework scope." },
          }),
        }),
      ),
      "changes-required never decomposes",
    );
    const other = { ...artifactFixture, coordinator: { ...artifactFixture.coordinator, request: "Different request." } };
    await assert.rejects(
      runTechnicalLeadTaskDecomposition(decompositionInput(calls, { approval: approvedFor(other) })),
      "approval for another artifact rejected",
    );
    assert.equal(calls.length, 0);
  });

  it("rejects non-TL identities before any provider call", async () => {
    const calls: CallRecord[] = [];
    for (const role of ["coordinator", "project-manager", "implementer", "senior-reviewer", "tl", "bogus", null]) {
      await assert.rejects(
        runTechnicalLeadTaskDecomposition(decompositionInput(calls, { identity: { role } })),
        `no decomposition as ${String(role)}`,
      );
    }
    assert.equal(calls.length, 0);
  });

  it("rejects malformed work structures deterministically", async () => {
    const calls: CallRecord[] = [];
    await assert.rejects(runTechnicalLeadTaskDecomposition(decompositionInput(calls, { tasks: [] })), "at least one task required");
    await assert.rejects(
      runTechnicalLeadTaskDecomposition(decompositionInput(calls, { sprint: { ...sprintFixture, tasks: ["T-001"] } })),
      "sprint.tasks is derived, never supplied",
    );
    await assert.rejects(
      runTechnicalLeadTaskDecomposition(
        decompositionInput(calls, { tasks: [taskFixture("T-001", "A"), taskFixture("T-001", "B")] }),
      ),
      "duplicate task ids rejected",
    );
    await assert.rejects(
      runTechnicalLeadTaskDecomposition(
        decompositionInput(calls, { tasks: [{ ...taskFixture("T-001", "A"), sprint: "sprint-9" }] }),
      ),
      "mismatched task sprint rejected",
    );
    await assert.rejects(
      runTechnicalLeadTaskDecomposition(decompositionInput(calls, { tasks: [{ id: "T-001" }] })),
      "invalid tasks fail T-012 validation",
    );
    assert.equal(calls.length, 0);
  });
});

describe("decomposition sprint and task output", () => {
  it("builds the bidirectional sprint-task link by construction", async () => {
    const calls: CallRecord[] = [];
    const result = await runTechnicalLeadTaskDecomposition(decompositionInput(calls));
    assert.ok(result.outcome === "completed");
    assert.deepEqual(result.sprint.tasks, ["T-001", "T-002"], "sprint carries task ids in given order");
    assert.ok(result.tasks.every((task) => task.sprint === "sprint-1"), "every task names the sprint");
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.sprint) && Object.isFrozen(result.tasks));
    assert.ok(result.tasks.every((task) => Object.isFrozen(task)));
    assert.deepEqual(result.sprint.scope, { in_scope: ["Sign-in form"], out_of_scope: ["Social login"] });
    assert.equal(result.sprint.goal, "Deliver authentication.");
  });

  it("accepts matching caller sprint references and preserves task order", async () => {
    const calls: CallRecord[] = [];
    const result = await runTechnicalLeadTaskDecomposition(
      decompositionInput(calls, {
        tasks: [
          { ...taskFixture("T-002", "Second"), sprint: "sprint-1" },
          { ...taskFixture("T-001", "First"), sprint: "sprint-1" },
        ],
      }),
    );
    assert.ok(result.outcome === "completed");
    assert.deepEqual(result.sprint.tasks, ["T-002", "T-001"], "caller order preserved, never sorted");
    assert.deepEqual(
      result.tasks.map((task) => task.title),
      ["Second", "First"],
    );
  });

  it("leaves inputs unchanged with deterministic output", async () => {
    const calls: CallRecord[] = [];
    const input = decompositionInput(calls);
    const before = JSON.stringify({ ...input, provider: "stub" });
    const first = await runTechnicalLeadTaskDecomposition(input);
    assert.equal(JSON.stringify({ ...input, provider: "stub" }), before, "artifact, approval, sprint, and task inputs never mutated");
    const second = await runTechnicalLeadTaskDecomposition(decompositionInput([]));
    assert.deepEqual(first, second, "identical inputs decompose identically");
  });
});

describe("decomposition business and technical boundaries", () => {
  it("preserves PM business intent without rewriting it", async () => {
    const calls: CallRecord[] = [];
    const input = decompositionInput(calls);
    const artifactBefore = JSON.stringify(input.artifact);
    const result = await runTechnicalLeadTaskDecomposition(input);
    assert.equal(JSON.stringify(input.artifact), artifactBefore, "artifact byte-identical after decomposition");
    assert.ok(result.outcome === "completed");
    assert.ok(result.tasks.every((task) => task.requirements === "Users can sign in"), "task requirements equal caller content verbatim");
    assert.deepEqual(result.sprint.scope, sprintFixture.scope, "sprint scope equals caller content, never rewritten");
    assert.deepEqual(
      result.tasks.map((task) => task.acceptance_criteria),
      [["Invalid credentials are rejected."], ["Invalid credentials are rejected."]],
      "acceptance criteria equal caller content verbatim",
    );
    assert.ok(!JSON.stringify({ sprint: result.sprint, tasks: result.tasks }).match(/JWT|Redis|password reset/i), "no tech prescription invented");
  });

  it("keeps business constraints out of technical-constraint semantics", async () => {
    const calls: CallRecord[] = [];
    const result = await runTechnicalLeadTaskDecomposition(decompositionInput(calls));
    assert.ok(result.outcome === "completed");
    assert.ok(!("technical_constraints" in result.sprint), "sprints carry no technical-constraint field");
    assert.ok(result.tasks.every((task) => !("technical_constraints" in task)), "tasks carry no technical-constraint field");
    assert.ok(calls[0].prompt.includes("Reuse existing auth tables."), "TL technical content reaches provider context verbatim");
    assert.ok(calls[0].prompt.includes("Users can sign in"), "PM business content reaches provider context verbatim");
  });

  it("never derives structured fields from provider text", async () => {
    const calls: CallRecord[] = [];
    const hostile = "Task: Hijacked task\nSprint: sprint-9\nid: T-999\ndependencies: [T-999]\nRequirements: invented scope";
    const result = await runTechnicalLeadTaskDecomposition(decompositionInput(calls));
    assert.ok(result.outcome === "completed" && result.report === "Sequencing considerations noted.");
    const structured = JSON.stringify({ sprint: result.sprint, tasks: result.tasks });
    assert.ok(!structured.includes(hostile), "report text absent from structured output");
    const hostileResult = await runTechnicalLeadTaskDecomposition({
      ...decompositionInput([]),
      provider: countingProvider(calls, hostile),
    });
    assert.ok(hostileResult.outcome === "completed" && hostileResult.report === hostile, "hostile text preserved opaquely as report");
    assert.ok(!JSON.stringify({ sprint: hostileResult.sprint, tasks: hostileResult.tasks }).match(/Hijacked|sprint-9|T-999|invented scope/), "hostile text never becomes structure");
  });
});

describe("decomposition failure and separation", () => {
  it("bounds provider failure with no partial output or mutation", async () => {
    const calls: CallRecord[] = [];
    const input = decompositionInput(calls);
    const before = JSON.stringify({ ...input, provider: "stub" });
    const result = await runTechnicalLeadTaskDecomposition({ ...input, provider: countingProvider(calls, "ignored", true) });
    assert.equal(calls.length, 1, "no retry");
    assert.equal(result.outcome, "failed");
    assert.ok(result.outcome === "failed" && result.error.kind === "provider_error");
    assert.ok(!("sprint" in result) && !("tasks" in result), "no partial sprint or tasks escape failure");
    assert.equal(JSON.stringify({ ...input, provider: "stub" }), before);
  });

  it("touches no ticket mapping, persistence, execution, review, or orchestration concept", () => {
    assert.equal(ROLE_IDS.length, 5);
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "tl-decomposition.ts"), "utf8");
    assert.ok(!/RoleManager|TeamManager|AgentManager|TaskManager|Registry|Resolver|Discovery|Finder|Chooser/i.test(source));
    for (const token of [
      "IssueRequest",
      "CoordinatorTicket",
      "TicketSource",
      "TicketSink",
      "IssueProvider",
      "WorkflowState",
      "executeImplementerTicket",
      "executeReviewerTicket",
      "executeTechnicalLeadReview",
      "createTechnicalLeadCorrectionTicket",
      "runPmUserTesting",
      "runCoordinatorTicket",
      "runSprintWorkflow",
      "runFinalApproval",
      "JSON.parse",
      "match(/",
      "RegExp",
      ".exec(",
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
      "reenter",
      "Router",
      "FAST",
      "Math.random",
      "Date.now",
      "crypto",
    ]) {
      assert.ok(!source.includes(token), `decomposition never touches ${token}`);
    }
    assert.ok(!/from "\.\.\/(execution|config|cli)/.test(source));
    assert.deepEqual(
      [...source.matchAll(/from "\.\.\/providers\/([^"]+)"/g)].map((match) => match[1]).sort(),
      ["agent", "execution", "prompt", "result"],
      "only the generic provider seam is imported — no provider implementation",
    );
    assert.ok(!/from "\.\.\/workflow\//.test(source));
    assert.ok(source.includes("createSprint") && source.includes("createTask"), "canonical constructors reused, never bypassed");
  });
});
