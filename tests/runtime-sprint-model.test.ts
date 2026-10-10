import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_IDS } from "../src/roles/contract";
import { SprintInput, createSprint, isSprint, validateSprint } from "../src/runtime/sprint-model";

// Sprint model tests (M24 T-011): the planned execution
// container. Pure data: construction and validation never invoke
// anything.
describe("sprint construction", () => {
  it("builds a minimal valid sprint", () => {
    const sprint = createSprint({ id: "sprint-1", goal: "Deliver authentication." });
    assert.deepEqual(sprint, { id: "sprint-1", goal: "Deliver authentication." });
    assert.ok(Object.isFrozen(sprint));
    assert.ok(isSprint(sprint));
  });

  it("builds a fully populated sprint", () => {
    const sprint = createSprint({
      id: "sprint-1",
      goal: "Deliver authentication.",
      scope: { in_scope: ["Sign-in form"], out_of_scope: ["Social login"] },
      tasks: ["T-001", "T-002"],
      dependencies: ["sprint-0"],
      acceptance_criteria: ["Invalid credentials are rejected."],
    });
    assert.equal(sprint.id, "sprint-1");
    assert.equal(sprint.goal, "Deliver authentication.");
    assert.deepEqual(sprint.scope, { in_scope: ["Sign-in form"], out_of_scope: ["Social login"] });
    assert.deepEqual(sprint.tasks, ["T-001", "T-002"], "task identifiers carried as ordered references");
    assert.deepEqual(sprint.dependencies, ["sprint-0"]);
    assert.deepEqual(sprint.acceptance_criteria, ["Invalid credentials are rejected."]);
  });

  it("accepts partial scope and empty collections without placeholders", () => {
    const sprint = createSprint({ id: "sprint-1", goal: "Goal.", scope: { in_scope: ["A"] }, tasks: [] });
    assert.deepEqual(sprint.scope, { in_scope: ["A"], out_of_scope: [] });
    assert.deepEqual(sprint.tasks, []);
    assert.equal(sprint.dependencies, undefined);
    assert.ok(!JSON.stringify(sprint).match(/unknown|pending|TODO/i));
  });
});

describe("sprint validation", () => {
  it("rejects malformed roots, missing fields, and empty text", () => {
    assert.throws(() => createSprint(null as unknown as SprintInput));
    assert.throws(() => createSprint([] as unknown as SprintInput));
    assert.throws(() => createSprint("sprint-1" as unknown as SprintInput));
    assert.throws(() => createSprint({ goal: "Goal." }));
    assert.throws(() => createSprint({ id: "sprint-1" }));
    assert.throws(() => createSprint({ id: "", goal: "Goal." }));
    assert.throws(() => createSprint({ id: "sprint-1", goal: "" }));
    assert.throws(() => createSprint({ id: 7, goal: "Goal." }));
    assert.equal(isSprint(null), false);
    assert.equal(isSprint({ id: "sprint-1" }), false);
  });

  it("rejects wrong collection types, malformed nesting, and unknown fields", () => {
    assert.throws(() => createSprint({ id: "s1", goal: "G", tasks: "T-001" }));
    assert.throws(() => createSprint({ id: "s1", goal: "G", tasks: [""] }));
    assert.throws(() => createSprint({ id: "s1", goal: "G", tasks: [7] }));
    assert.throws(() => createSprint({ id: "s1", goal: "G", dependencies: [null] }));
    assert.throws(() => createSprint({ id: "s1", goal: "G", acceptance_criteria: {} }));
    assert.throws(() => createSprint({ id: "s1", goal: "G", scope: "wide" }));
    assert.throws(() => createSprint({ id: "s1", goal: "G", scope: null }));
    assert.throws(() => createSprint({ id: "s1", goal: "G", scope: { in_scope: "A", out_of_scope: [] } }));
    assert.throws(() => createSprint({ id: "s1", goal: "G", status: "planned" } as unknown as SprintInput), "no status values");
    assert.throws(() => createSprint({ id: "s1", goal: "G", approved: true } as unknown as SprintInput), "no approval fields");
    assert.throws(() => createSprint({ id: "s1", goal: "G", started_at: "2026-01-01" } as unknown as SprintInput), "no timebox fields");
    assert.equal(isSprint({ id: "s1", goal: "G", workflow_state: "ready" }), false);
  });

  it("validates copies without coercion or mutation", () => {
    const input = { id: "s1", goal: "G", tasks: ["T-002", "T-001"] };
    const before = JSON.stringify(input);
    const sprint = validateSprint(input);
    assert.deepEqual(sprint.tasks, ["T-002", "T-001"]);
    assert.equal(JSON.stringify(input), before);
    (input.tasks as string[]).push("T-003");
    assert.deepEqual(sprint.tasks, ["T-002", "T-001"], "post-construction caller edits never leak in");
    assert.throws(() => validateSprint({ id: "s1", goal: 7 }));
  });
});

describe("sprint preservation and immutability", () => {
  it("preserves text verbatim with order intact at every level", () => {
    const sprint = createSprint({
      id: "sprint-1",
      goal: "  Deliver authentication.  ",
      scope: { in_scope: ["Zebra.", "Apple."], out_of_scope: [] },
      tasks: ["T-002", "T-001", "T-002"],
      dependencies: ["sprint-0"],
      acceptance_criteria: ["Second.", "First."],
    });
    assert.equal(sprint.goal, "  Deliver authentication.  ", "no trimming");
    assert.deepEqual(sprint.scope?.in_scope, ["Zebra.", "Apple."], "no sorting");
    assert.deepEqual(sprint.tasks, ["T-002", "T-001", "T-002"], "no deduplication");
    assert.deepEqual(sprint.acceptance_criteria, ["Second.", "First."]);
  });

  it("freezes root, nested objects, and nested arrays", () => {
    const sprint = createSprint({
      id: "s1",
      goal: "G",
      scope: { in_scope: ["A"], out_of_scope: ["B"] },
      tasks: ["T-001"],
      dependencies: ["sprint-0"],
      acceptance_criteria: ["Done."],
    });
    assert.ok(Object.isFrozen(sprint));
    assert.ok(Object.isFrozen(sprint.scope) && Object.isFrozen(sprint.scope?.in_scope));
    assert.ok(Object.isFrozen(sprint.tasks) && Object.isFrozen(sprint.dependencies) && Object.isFrozen(sprint.acceptance_criteria));
    assert.throws(() => {
      (sprint as { goal: string }).goal = "Changed.";
    });
    assert.throws(() => {
      (sprint.tasks as string[]).push("T-009");
    });
  });

  it("constructs deterministically with no side effects", () => {
    const input = { id: "s1", goal: "G", tasks: ["T-001"] };
    assert.deepEqual(createSprint(input), createSprint(input));
    assert.notEqual(createSprint(input), createSprint(input), "each construction returns its own frozen value");
  });
});

describe("sprint boundaries", () => {
  it("defines no task schema, task status, or execution behavior", () => {
    const sprint = createSprint({ id: "s1", goal: "G", tasks: ["T-001"] });
    assert.deepEqual(Object.keys(sprint).sort(), ["goal", "id", "tasks"]);
    assert.ok(!JSON.stringify(sprint).match(/status|review|assignee|estimate|priority/i));
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "sprint-model.ts"), "utf8");
    assert.ok(!/interface Task|type Task|TaskModel|TaskStatus|task validation/i.test(source));
  });

  it("touches no planning, provider, workflow, persistence, or orchestration concept", () => {
    assert.equal(ROLE_IDS.length, 5);
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "sprint-model.ts"), "utf8");
    assert.ok(!/RoleManager|TeamManager|AgentManager|SprintManager|SprintRegistry|SprintRepository|SprintService|SprintResolver|SprintProvider|AgentProvider|isAgentProvider|Discovery|Finder|Chooser/i.test(source));
    for (const token of [
      "AgentProvider",
      "executeWithTimeout",
      "runPmPlanning",
      "runCoordinatorPlanning",
      "runTechnicalLeadPlanning",
      "decidePlanningApproval",
      "PlanningArtifact",
      "createPlanningArtifact",
      "AgentHandoff",
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
      assert.ok(!source.includes(token), `sprint model never touches ${token}`);
    }
    assert.ok(!/from "\.\.\/(execution|providers|roles|config|cli)/.test(source));
    assert.ok(!/from "\.\.\/workflow\//.test(source));
    assert.ok(!/from "\.\//.test(source), "no sibling runtime imports: fully standalone data contract");
  });
});
