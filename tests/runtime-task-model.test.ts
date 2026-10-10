import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_IDS } from "../src/roles/contract";
import { TaskInput, createTask, isTask, validateTask } from "../src/runtime/task-model";

// Task model tests (M24 T-012): the actionable work unit. Pure
// data: construction and validation never invoke anything.
const minimal = {
  id: "T-001",
  title: "Add sign-in form",
  description: "Render the sign-in form on the login page.",
  requirements: "Users can sign in",
};

describe("task construction", () => {
  it("builds a minimal valid task", () => {
    const task = createTask({ ...minimal });
    assert.deepEqual(task, { ...minimal });
    assert.ok(Object.isFrozen(task));
    assert.ok(isTask(task));
  });

  it("builds a fully populated task", () => {
    const task = createTask({
      ...minimal,
      acceptance_criteria: ["Invalid credentials are rejected.", "Valid credentials sign in."],
      dependencies: ["T-000"],
      specialty: "frontend",
      sprint: "sprint-1",
    });
    assert.deepEqual(task.acceptance_criteria, ["Invalid credentials are rejected.", "Valid credentials sign in."]);
    assert.deepEqual(task.dependencies, ["T-000"]);
    assert.equal(task.specialty, "frontend");
    assert.equal(task.sprint, "sprint-1");
  });

  it("accepts every canonical specialty and omits it cleanly when generic", () => {
    for (const specialty of ["backend", "frontend", "integration", "database", "testing", "documentation"] as const) {
      assert.equal(createTask({ ...minimal, specialty }).specialty, specialty);
    }
    const generic = createTask({ ...minimal });
    assert.ok(!("specialty" in generic), "no specialty invented for generic implementers");
    assert.ok(!("sprint" in generic) && !("acceptance_criteria" in generic) && !("dependencies" in generic));
  });
});

describe("task validation", () => {
  it("rejects malformed roots and missing or empty required fields", () => {
    assert.throws(() => createTask(null as unknown as TaskInput));
    assert.throws(() => createTask([] as unknown as TaskInput));
    assert.throws(() => createTask({ title: "T", description: "D", requirements: "R" }));
    assert.throws(() => createTask({ id: "T-001", description: "D", requirements: "R" }));
    assert.throws(() => createTask({ id: "T-001", title: "T", requirements: "R" }));
    assert.throws(() => createTask({ id: "T-001", title: "T", description: "D" }));
    assert.throws(() => createTask({ id: "", title: "T", description: "D", requirements: "R" }));
    assert.throws(() => createTask({ id: "T-001", title: "", description: "D", requirements: "R" }));
    assert.throws(() => createTask({ id: 7, title: "T", description: "D", requirements: "R" }));
    assert.equal(isTask(null), false);
    assert.equal(isTask({ id: "T-001" }), false);
  });

  it("rejects wrong collection types, bad specialties, bad sprint refs, and unknown fields", () => {
    assert.throws(() => createTask({ ...minimal, acceptance_criteria: "criterion" }));
    assert.throws(() => createTask({ ...minimal, acceptance_criteria: [""] }));
    assert.throws(() => createTask({ ...minimal, dependencies: [7] }));
    assert.throws(() => createTask({ ...minimal, specialty: "devops" }), "aliases and unknown specialties rejected");
    assert.throws(() => createTask({ ...minimal, specialty: "implementer" }), "role ids are not specialties");
    assert.throws(() => createTask({ ...minimal, sprint: "" }));
    assert.throws(() => createTask({ ...minimal, sprint: 7 }));
    assert.throws(() => createTask({ ...minimal, status: "ready" } as unknown as TaskInput), "no lifecycle state");
    assert.throws(() => createTask({ ...minimal, priority: "high" } as unknown as TaskInput), "no priority");
    assert.throws(() => createTask({ ...minimal, assignee: "tl" } as unknown as TaskInput), "no role assignment");
    assert.throws(() => createTask({ ...minimal, github_issue: 12 } as unknown as TaskInput), "no issue fields");
    assert.throws(() => createTask({ ...minimal, owner_role: "implementer" } as unknown as TaskInput), "no owner roles");
    assert.equal(isTask({ ...minimal, estimate: 3 }), false);
  });

  it("validates copies with caller identity preserved and no generation", () => {
    const input = { ...minimal, id: "T-042", dependencies: ["T-002", "T-001"] };
    const before = JSON.stringify(input);
    const task = validateTask(input);
    assert.equal(task.id, "T-042", "caller-supplied identity preserved exactly");
    assert.deepEqual(task.dependencies, ["T-002", "T-001"], "order preserved, no dedup");
    assert.equal(JSON.stringify(input), before);
    (input.dependencies as string[]).push("T-003");
    assert.deepEqual(task.dependencies, ["T-002", "T-001"], "post-construction caller edits never leak in");
    assert.ok(!("id" in task) || task.id === "T-042", "no generated identifier replaces the caller's");
  });
});

describe("task preservation and immutability", () => {
  it("preserves text verbatim with order intact", () => {
    const task = createTask({
      id: "T-001",
      title: "  Padded title  ",
      description: "Multi\nline\ndescription.",
      requirements: "Requirements text",
      acceptance_criteria: ["Zebra.", "Apple.", "Zebra."],
    });
    assert.equal(task.title, "  Padded title  ", "no trimming");
    assert.equal(task.description, "Multi\nline\ndescription.", "no rewriting");
    assert.deepEqual(task.acceptance_criteria, ["Zebra.", "Apple.", "Zebra."], "no sorting, no dedup");
  });

  it("freezes root and nested arrays", () => {
    const task = createTask({ ...minimal, acceptance_criteria: ["Done."], dependencies: ["T-000"] });
    assert.ok(Object.isFrozen(task));
    assert.ok(Object.isFrozen(task.acceptance_criteria) && Object.isFrozen(task.dependencies));
    assert.throws(() => {
      (task as { title: string }).title = "Changed.";
    });
    assert.throws(() => {
      (task.dependencies as string[]).push("T-009");
    });
  });

  it("constructs deterministically with no side effects", () => {
    const input = { ...minimal, dependencies: ["T-001"] };
    assert.deepEqual(createTask(input), createTask(input));
    assert.notEqual(createTask(input), createTask(input), "each construction returns its own frozen value");
  });
});

describe("task sprint relationship", () => {
  it("references sprints by identifier without touching sprint data", () => {
    const task = createTask({ ...minimal, sprint: "sprint-1", dependencies: ["T-000"] });
    assert.equal(task.sprint, "sprint-1");
    assert.ok(typeof task.sprint === "string", "reference only — no embedded sprint object");
    const standalone = createTask({ ...minimal });
    assert.equal(standalone.sprint, undefined, "tasks stay independently constructible without a sprint");
  });
});

describe("task boundaries", () => {
  it("defines no sprint duplication, task status, or execution behavior", () => {
    const task = createTask({ ...minimal, acceptance_criteria: ["Done."], sprint: "sprint-1" });
    assert.deepEqual(Object.keys(task).sort(), ["acceptance_criteria", "description", "id", "requirements", "sprint", "title"]);
    assert.ok(!JSON.stringify(task).match(/goal|in_scope|approved|review|estimate|priority/i), "no sprint, workflow, or tracker content");
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "task-model.ts"), "utf8");
    assert.ok(!/interface Sprint|type Sprint|TaskStatus|task state machine/i.test(source));
  });

  it("touches no planning, provider, workflow, persistence, ticket, or orchestration concept", () => {
    assert.equal(ROLE_IDS.length, 5);
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "task-model.ts"), "utf8");
    assert.ok(!/RoleManager|TeamManager|AgentManager|TaskManager|TaskRegistry|TaskRepository|TaskService|TaskResolver|TaskProvider|AgentProvider|isAgentProvider/i.test(source));
    for (const token of [
      "executeWithTimeout",
      "runPmPlanning",
      "runCoordinatorPlanning",
      "runTechnicalLeadPlanning",
      "decidePlanningApproval",
      "PlanningArtifact",
      "createPlanningArtifact",
      "AgentHandoff",
      "createSprint",
      "SprintModel",
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
      "issue_url",
      "ticket_source",
      "async ",
      "await ",
      "Promise<",
    ]) {
      assert.ok(!source.includes(token), `task model never touches ${token}`);
    }
    assert.ok(source.includes("isImplementerSpecialty"), "specialty validated by the existing role contract");
    assert.ok(!/from "\.\.\/(execution|providers|config|cli)/.test(source));
    assert.ok(!/from "\.\.\/workflow\//.test(source));
  });
});
