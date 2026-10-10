import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { ROLE_IDS } from "../src/roles/contract";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withTempProject } from "./helpers/temp-project";
import { persistSprintPlan, readSprintPlan } from "../src/runtime/task-persistence";

// Task persistence tests (M24 T-015): local JSON plans under
// `.ai-team/plans/`, validated both ways. Real filesystem I/O
// confined to isolated temp project roots, removed afterwards.
const sprintFixture = {
  id: "sprint-1",
  goal: "Deliver authentication.",
  scope: { in_scope: ["Sign-in form"], out_of_scope: ["Social login"] },
  tasks: ["T-001", "T-002"],
  dependencies: ["sprint-0"],
  acceptance_criteria: ["Invalid credentials are rejected."],
};

function taskFixture(id: string) {
  return {
    id,
    title: `Title ${id}`,
    description: `Description ${id}.`,
    requirements: "Users can sign in",
    acceptance_criteria: ["Invalid credentials are rejected."],
    dependencies: id === "T-002" ? ["T-001"] : [],
    specialty: "backend" as const,
    sprint: "sprint-1",
  };
}

describe("persistence storage location", () => {
  it("writes inside the existing plans workspace, never inventing directories", () => {
    withTempProject({}, (root) => {
      const result = persistSprintPlan({ project_root: root, sprint: sprintFixture, tasks: [taskFixture("T-001"), taskFixture("T-002")] });
      assert.equal(result.path, path.join(root, ".ai-team", "plans", "sprint-1.json"));
      assert.ok(fs.existsSync(result.path));
      assert.ok(!fs.existsSync(path.join(root, ".ai-team", "tasks")), "no new workspace subdirectory created");
      assert.ok(!fs.existsSync(path.join(root, "tasks.json")), "no stray root files created");
      assert.ok(Object.isFrozen(result));
    });
  });

  it("rejects unsafe identifiers and missing roots without touching disk", () => {
    withTempProject({}, (root) => {
      for (const id of ["../escape", "a/b", "/abs", "..", ".", "has space", "semi;colon"]) {
        assert.throws(() => persistSprintPlan({
          project_root: root,
          sprint: { ...sprintFixture, id, tasks: [] },
          tasks: [],
        }), `path-unsafe sprint id rejected: ${id}`);
      }
      assert.ok(!fs.existsSync(path.join(root, ".ai-team")), "no workspace created for rejected input");
      assert.throws(() => persistSprintPlan({ project_root: path.join(root, "no-such-dir"), sprint: sprintFixture, tasks: [] }), "missing project root rejected");
      assert.throws(() => persistSprintPlan({ project_root: "", sprint: sprintFixture, tasks: [] }));
    });
  });

  it("isolates separate project roots completely", () => {
    withTempProject({}, (first) => {
      withTempProject({}, (second) => {
        persistSprintPlan({ project_root: first, sprint: sprintFixture, tasks: [taskFixture("T-001"), taskFixture("T-002")] });
        assert.throws(() => readSprintPlan({ project_root: second, sprint_id: "sprint-1" }), "second project sees nothing of the first");
      });
    });
  });
});

describe("persistence round trip", () => {
  it("persists one sprint plan and reads back equivalent canonical data", () => {
    withTempProject({}, (root) => {
      const tasks = [taskFixture("T-001"), taskFixture("T-002")];
      persistSprintPlan({ project_root: root, sprint: sprintFixture, tasks });
      const read = readSprintPlan({ project_root: root, sprint_id: "sprint-1" });
      assert.equal(read.sprint.id, "sprint-1");
      assert.equal(read.sprint.goal, "Deliver authentication.");
      assert.deepEqual(read.sprint.scope, { in_scope: ["Sign-in form"], out_of_scope: ["Social login"] });
      assert.deepEqual(read.sprint.tasks, ["T-001", "T-002"]);
      assert.deepEqual(read.sprint.dependencies, ["sprint-0"]);
      assert.equal(read.tasks.length, 2);
      assert.equal(read.tasks[0].id, "T-001");
      assert.equal(read.tasks[0].title, "Title T-001");
      assert.equal(read.tasks[0].description, "Description T-001.");
      assert.equal(read.tasks[0].requirements, "Users can sign in");
      assert.deepEqual(read.tasks[0].acceptance_criteria, ["Invalid credentials are rejected."]);
      assert.deepEqual(read.tasks[1].dependencies, ["T-001"], "dependencies preserved");
      assert.equal(read.tasks[0].specialty, "backend", "specialty preserved");
      assert.equal(read.tasks[1].sprint, "sprint-1", "sprint references preserved");
      assert.ok(Object.isFrozen(read) && Object.isFrozen(read.sprint) && Object.isFrozen(read.tasks));
      assert.ok(read.tasks.every((task) => Object.isFrozen(task)));
    });
  });

  it("stores deterministic JSON with canonical fields only", () => {
    withTempProject({}, (root) => {
      const input = { project_root: root, sprint: sprintFixture, tasks: [taskFixture("T-001"), taskFixture("T-002")] };
      const first = persistSprintPlan(input);
      const firstBytes = fs.readFileSync(first.path, "utf8");
      const second = persistSprintPlan(input);
      assert.equal(fs.readFileSync(second.path, "utf8"), firstBytes, "same input writes byte-identical files");
      const document = JSON.parse(firstBytes) as Record<string, unknown>;
      assert.deepEqual(Object.keys(document).sort(), ["sprint", "tasks"], "envelope holds exactly sprint and tasks");
      assert.ok(!firstBytes.match(/created_at|persisted_at|storage_id|checksum|github|revision/i), "no storage metadata leaks into the document");
    });
  });

  it("replaces a sprint file wholesale with no merging", () => {
    withTempProject({}, (root) => {
      persistSprintPlan({ project_root: root, sprint: sprintFixture, tasks: [taskFixture("T-001"), taskFixture("T-002")] });
      const revised = { ...sprintFixture, goal: "Deliver authentication, revised.", tasks: ["T-001"] };
      persistSprintPlan({ project_root: root, sprint: revised, tasks: [{ ...taskFixture("T-001") }] });
      const read = readSprintPlan({ project_root: root, sprint_id: "sprint-1" });
      assert.equal(read.sprint.goal, "Deliver authentication, revised.");
      assert.equal(read.tasks.length, 1, "old tasks gone: replace, never merge");
    });
  });
});

describe("persistence validation", () => {
  it("rejects malformed input before any write", () => {
    withTempProject({}, (root) => {
      assert.throws(() => persistSprintPlan({ project_root: root, sprint: { id: "sprint-1" }, tasks: [] }), "sprint validated first");
      assert.throws(() => persistSprintPlan({ project_root: root, sprint: sprintFixture, tasks: [{ id: "T-001" }] }), "tasks validated first");
      assert.throws(() => persistSprintPlan({
        project_root: root,
        sprint: sprintFixture,
        tasks: [taskFixture("T-001"), { ...taskFixture("T-002"), id: "T-001" }],
      }), "duplicate task ids rejected, never overwritten");
      assert.throws(() => persistSprintPlan({
        project_root: root,
        sprint: sprintFixture,
        tasks: [{ ...taskFixture("T-001"), sprint: "sprint-9" }],
      }), "mismatched task sprint rejected");
      assert.throws(() => persistSprintPlan({
        project_root: root,
        sprint: { ...sprintFixture, tasks: ["T-001", "T-002", "T-003"] },
        tasks: [taskFixture("T-001"), taskFixture("T-002")],
      }), "sprint task list diverging from stored ids rejected");
      assert.ok(!fs.existsSync(path.join(root, ".ai-team", "plans", "sprint-1.json")), "no file written for rejected input");
    });
  });

  it("rejects missing, corrupt, and tampered data on read", () => {
    withTempProject({}, (root) => {
      assert.throws(() => readSprintPlan({ project_root: root, sprint_id: "sprint-1" }), "missing file throws, never silent empty");
      assert.throws(() => readSprintPlan({ project_root: root, sprint_id: "../escape" }), "unsafe ids rejected on read too");
      persistSprintPlan({ project_root: root, sprint: sprintFixture, tasks: [taskFixture("T-001"), taskFixture("T-002")] });
      const file = path.join(root, ".ai-team", "plans", "sprint-1.json");
      fs.writeFileSync(file, "{not json", "utf8");
      assert.throws(() => readSprintPlan({ project_root: root, sprint_id: "sprint-1" }), "corrupt JSON rejected");
      fs.writeFileSync(file, JSON.stringify({ sprint: { id: "sprint-1" }, tasks: [] }), "utf8");
      assert.throws(() => readSprintPlan({ project_root: root, sprint_id: "sprint-1" }), "missing required fields rejected");
      fs.writeFileSync(file, JSON.stringify({ sprint: { ...sprintFixture, goal: 7 }, tasks: [] }), "utf8");
      assert.throws(() => readSprintPlan({ project_root: root, sprint_id: "sprint-1" }), "wrong primitive types rejected");
      fs.writeFileSync(file, JSON.stringify({ sprint: sprintFixture, tasks: [{ ...taskFixture("T-001"), dependencies: [7] }] }), "utf8");
      assert.throws(() => readSprintPlan({ project_root: root, sprint_id: "sprint-1" }), "malformed nested data rejected");
      fs.writeFileSync(file, JSON.stringify({ sprint: sprintFixture, tasks: [{ ...taskFixture("T-001"), id: "" }] }), "utf8");
      assert.throws(() => readSprintPlan({ project_root: root, sprint_id: "sprint-1" }), "invalid ids rejected");
      fs.writeFileSync(file, JSON.stringify({ sprint: sprintFixture, tasks: [taskFixture("T-001"), taskFixture("T-001")] }), "utf8");
      assert.throws(() => readSprintPlan({ project_root: root, sprint_id: "sprint-1" }), "persisted duplicates rejected");
      fs.writeFileSync(file, JSON.stringify({ sprint: sprintFixture, tasks: [taskFixture("T-001")], version: 2 }), "utf8");
      assert.throws(() => readSprintPlan({ project_root: root, sprint_id: "sprint-1" }), "unsupported envelope fields rejected");
      fs.writeFileSync(file, JSON.stringify({ sprint: { ...sprintFixture, id: "sprint-9" }, tasks: [] }), "utf8");
      assert.throws(() => readSprintPlan({ project_root: root, sprint_id: "sprint-1" }), "sprint id mismatch rejected");
    });
  });
});

describe("persistence immutability and isolation", () => {
  it("isolates caller data, stored bytes, and readback objects", () => {
    withTempProject({}, (root) => {
      const sprint = { ...sprintFixture };
      const tasks = [taskFixture("T-001"), taskFixture("T-002")];
      const before = JSON.stringify({ sprint, tasks });
      persistSprintPlan({ project_root: root, sprint, tasks });
      assert.equal(JSON.stringify({ sprint, tasks }), before, "caller data never mutated by persistence");
      (tasks as Array<Record<string, unknown>>).push({ ...(taskFixture("T-003") as unknown as Record<string, unknown>) });
      const read = readSprintPlan({ project_root: root, sprint_id: "sprint-1" });
      assert.equal(read.tasks.length, 2, "post-write caller edits never reach storage");
      assert.throws(() => {
        (read.tasks as unknown as Array<{ id: string }>).push({ id: "T-009" });
      }, "readback collections frozen");
      const reread = readSprintPlan({ project_root: root, sprint_id: "sprint-1" });
      assert.deepEqual(reread, read, "repeated reads equivalent; no cache, every read hits disk");
      assert.notEqual(reread, read, "independent objects per read");
    });
  });
});

describe("persistence separation", () => {
  it("performs filesystem I/O only, with no other capability", () => {
    assert.equal(ROLE_IDS.length, 5);
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "task-persistence.ts"), "utf8");
    assert.ok(!/RoleManager|TeamManager|AgentManager|TaskManager|TaskRepository|PlanningRepository|StorageService|PersistenceManager|Registry|Discovery|Finder|Chooser|AgentProvider|isAgentProvider/i.test(source));
    for (const token of [
      "executeWithTimeout",
      "runTechnicalLeadTaskDecomposition",
      "runPmPlanning",
      "runCoordinatorPlanning",
      "runTechnicalLeadPlanning",
      "decidePlanningApproval",
      "mapTaskToTicket",
      "mapTaskToIssueRequest",
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
      "child_process",
      "setTimeout",
      "setInterval",
      "parseReport",
      "reenter",
      "Router",
      "FAST",
      "issue_url",
      "ticket_source",
      "fetch(",
      "async ",
      "await ",
      "Promise<",
      "Map(",
      "new Map",
      "globalThis",
    ]) {
      assert.ok(!source.includes(token), `persistence never touches ${token}`);
    }
    assert.ok(!/from "\.\.\/(execution|providers|config|cli)/.test(source));
    assert.ok(!/from "\.\.\/workflow\//.test(source));
    assert.ok(source.includes("validateSprint") && source.includes("validateTask"), "canonical constructors reused for both directions");
  });
});
