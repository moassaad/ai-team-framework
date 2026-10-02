import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  composeSpecKitPlanContent,
  loadSpecKitFeatureFiles,
  mapSpecKitFeatureToTickets,
  parseSpecKitTasks,
} from "../src/providers/speckit-artifacts";

// Spec Kit artifact mapping tests (S-005): representative fixtures
// modeled on the verified upstream templates (tasks-template.md:
// `- [ ] T001` entries, `[P]`/`[USn]` markers, inline dependencies,
// `## Phase` headings). No Spec Kit installation, commands, or skills;
// the only seam is the file reader, and nothing is ever written.

const SPEC_MD = [
  "# Feature: CSV export",
  "",
  "## User Story 1 (Priority: P1)",
  "",
  "As a shop owner I can download orders as CSV.",
  "",
  "## Success Criteria",
  "",
  "- SC-001 Export completes for 10k rows",
].join("\n");

const PLAN_MD = [
  "# Technical Plan",
  "",
  "## Decisions",
  "",
  "- Use streaming CSV writer",
  "",
  "## Constraints",
  "",
  "- Memory budget 512MB for export jobs",
].join("\n");

const TASKS_MD = [
  "# Tasks: CSV export",
  "",
  "<!--",
  "Scaffolding comment mentioning T999 must never become work.",
  "-->",
  "",
  "## Phase 1: Setup (Shared Infrastructure)",
  "",
  "- [ ] T001 Create project structure per implementation plan",
  "- [ ] T002 [P] Configure linting in backend/src/",
  "",
  "---",
  "",
  "## Phase 2: Foundational (Blocking Prerequisites)",
  "",
  "- [ ] T003 Setup database schema in src/models/ (depends on T001)",
  "",
  "**Checkpoint**: Foundation ready",
  "",
  "## Phase 3: User Story 1 - CSV download (Priority: P1)",
  "",
  "- [ ] T004 [P] [US1] Contract test in tests/contract/test_export.py",
  "- [ ] T005 [US1] Implement export endpoint in src/routes/export.py (depends on T003, T004)",
  "  Follow the streaming decision from the plan.",
  "- [x] T006 [US1] Already finished task",
  "",
  "## Phase N: Polish & Cross-Cutting Concerns",
  "",
  "- [ ] TXXX Documentation updates in docs/",
].join("\n");

function enoent(message: string): Error {
  return Object.assign(new Error(message), { code: "ENOENT" });
}

function readerFor(files: Record<string, string>, calls: string[] = []) {
  return async (path: string): Promise<string> => {
    calls.push(path);
    const content = files[path];
    if (content === undefined) {
      throw enoent(`missing ${path}`);
    }
    return content;
  };
}

function featureDir(): string {
  return join("/proj", "specs", "001-export");
}

function fullFiles(): Record<string, string> {
  const dir = featureDir();
  return {
    [join(dir, "spec.md")]: SPEC_MD,
    [join(dir, "plan.md")]: PLAN_MD,
    [join(dir, "tasks.md")]: TASKS_MD,
  };
}

function taskTickets(): { id: string; title: string; description: string }[] {
  const { tickets } = mapSpecKitFeatureToTickets({
    requirements: "Shop owners can export orders.",
    specMd: SPEC_MD,
    planMd: PLAN_MD,
    tasksMd: TASKS_MD,
  });
  return tickets
    .filter((ticket) => ticket.title.startsWith("Task "))
    .map((ticket) => ({ id: ticket.id, title: ticket.title, description: ticket.description }));
}

describe("spec kit artifact mapping", () => {
  it("maps a full feature directory through P-003/P-004", () => {
    const { plan, tickets } = mapSpecKitFeatureToTickets({
      requirements: "Shop owners can export orders.",
      specMd: SPEC_MD,
      planMd: PLAN_MD,
      tasksMd: TASKS_MD,
    });
    assert.equal(plan.requirements, "Shop owners can export orders.");
    assert.equal(plan.basis, "plan");
    assert.ok(plan.specification.includes("# Feature: CSV export"));
    assert.ok(plan.specification.includes("# Technical Plan"));
    assert.ok(tickets.length > 0);
    for (const ticket of tickets) {
      assert.equal(ticket.requirements, "Shop owners can export orders.");
      assert.match(ticket.id, /^T-\d{3}$/);
    }
    const ids = tickets.map((ticket) => ticket.id);
    assert.deepEqual(ids, [...new Set(ids)], "framework IDs unique");
    assert.deepEqual(ids, [...ids].sort(), "document order preserved");
  });

  it("produces one ticket per unchecked task in document order", () => {
    const tasks = taskTickets();
    assert.deepEqual(
      tasks.map((task) => task.title),
      [
        "Task T001: Create project structure per implementation plan",
        "Task T002: [P] Configure linting in backend/src/",
        "Task T003: Setup database schema in src/models/ (depends on T001)",
        "Task T004: [P] [US1] Contract test in tests/contract/test_export.py",
        "Task T005: [US1] Implement export endpoint in src/routes/export.py (depends on T003, T004)",
      ],
    );
    assert.ok(!tasks.some((task) => task.title.includes("T006")), "checked work excluded");
    assert.ok(!tasks.some((task) => task.title.includes("TXXX")), "placeholders excluded");
    assert.ok(!tasks.some((task) => task.title.includes("T999")), "comments excluded");
  });

  it("preserves dependencies, phases, and stories as visible text", () => {
    const tasks = taskTickets();
    const byTitle = new Map(tasks.map((task) => [task.title.slice(0, 10), task]));
    assert.ok(byTitle.get("Task T003:")?.description.includes("(depends on T001)"));
    assert.ok(byTitle.get("Task T005:")?.description.includes("(depends on T003, T004)"));
    assert.ok(byTitle.get("Task T005:")?.description.includes("Phase: Phase 3: User Story 1"));
    assert.ok(byTitle.get("Task T004:")?.description.includes("[US1]"));
    assert.ok(
      byTitle.get("Task T005:")?.description.includes("Follow the streaming decision"),
      "continuations stay attached",
    );
    assert.ok(
      byTitle.get("Task T003:")?.description.includes("**Checkpoint**: Foundation ready"),
      "trailing phase context preserved verbatim instead of dropped",
    );
  });

  it("keeps framework ticket identity separate from source IDs", () => {
    const { tickets } = mapSpecKitFeatureToTickets({
      requirements: "Shop owners can export orders.",
      specMd: SPEC_MD,
      planMd: PLAN_MD,
      tasksMd: TASKS_MD,
    });
    for (const ticket of tickets) {
      assert.ok(!/^T\d+$/.test(ticket.id), `no source-ID identity ${ticket.id}`);
      assert.deepEqual(Object.keys(ticket).sort(), [
        "description",
        "id",
        "requirements",
        "title",
      ]);
    }
  });

  it("carries specification and plan context in the mapped plan", () => {
    const { plan } = mapSpecKitFeatureToTickets({
      requirements: "Shop owners can export orders.",
      specMd: SPEC_MD,
      planMd: PLAN_MD,
      tasksMd: TASKS_MD,
    });
    assert.ok(plan.specification.includes("SC-001 Export completes for 10k rows"));
    assert.ok(plan.specification.includes("Memory budget 512MB for export jobs"));
  });

  it("keeps file mentions as prose without creating permissions", () => {
    const tasks = taskTickets();
    const exportTask = tasks.find((task) => task.title.includes("T005"));
    assert.ok(exportTask?.description.includes("src/routes/export.py"));
    const { tickets } = mapSpecKitFeatureToTickets({
      requirements: "Shop owners can export orders.",
      specMd: SPEC_MD,
      planMd: PLAN_MD,
      tasksMd: TASKS_MD,
    });
    for (const ticket of tickets) {
      assert.ok(!("allowedFiles" in ticket || "allowed_files" in ticket), "no permission field");
    }
  });

  it("treats spec.md and plan.md as optional context", () => {
    for (const files of [
      { tasksMd: TASKS_MD },
      { specMd: SPEC_MD, tasksMd: TASKS_MD },
      { planMd: PLAN_MD, tasksMd: TASKS_MD },
    ]) {
      const { tickets } = mapSpecKitFeatureToTickets({
        requirements: "Shop owners can export orders.",
        ...files,
      });
      assert.ok(tickets.some((ticket) => ticket.title.startsWith("Task T001")));
    }
  });

  it("fails when tasks.md is missing or nothing was found", async () => {
    const dir = featureDir();
    await assert.rejects(
      loadSpecKitFeatureFiles(dir, readerFor({ [join(dir, "spec.md")]: SPEC_MD })),
      /tasks\.md is required/,
    );
    await assert.rejects(loadSpecKitFeatureFiles(dir, readerFor({})), /no Spec Kit artifacts/);
  });

  it("rejects empty, unparseable, and mistyped task sources", () => {
    assert.deepEqual(parseSpecKitTasks(""), [], "no entries, no invention");
    assert.throws(
      () =>
        mapSpecKitFeatureToTickets({
          requirements: "Shop owners can export orders.",
          tasksMd: "",
        }),
      /no actionable tasks/,
    );
    assert.throws(
      () =>
        mapSpecKitFeatureToTickets({
          requirements: "Shop owners can export orders.",
          tasksMd: "# Tasks: empty\n\nNo entries here.\n",
        }),
      /no actionable tasks/,
    );
    assert.throws(
      () =>
        mapSpecKitFeatureToTickets({
          requirements: "Shop owners can export orders.",
          tasksMd: 42 as unknown as string,
        }),
      /must be a string/,
    );
    assert.throws(
      () =>
        mapSpecKitFeatureToTickets({
          requirements: "",
          tasksMd: TASKS_MD,
        }),
      /requirements must be a non-empty string/,
    );
  });

  it("never mutates its inputs", () => {
    const input = Object.freeze({
      requirements: "Shop owners can export orders.",
      specMd: SPEC_MD,
      planMd: PLAN_MD,
      tasksMd: TASKS_MD,
    });
    const before = JSON.stringify(input);
    mapSpecKitFeatureToTickets(input);
    assert.equal(JSON.stringify(input), before);
    assert.deepEqual(parseSpecKitTasks(TASKS_MD).map((task) => task.id), [
      "T001",
      "T002",
      "T003",
      "T004",
      "T005",
    ]);
  });

  it("loads feature files read-only through the injected reader", async () => {
    const calls: string[] = [];
    const dir = featureDir();
    const files = await loadSpecKitFeatureFiles(dir, readerFor(fullFiles(), calls));
    assert.equal(files.specMd, SPEC_MD);
    assert.equal(files.planMd, PLAN_MD);
    assert.equal(files.tasksMd, TASKS_MD);
    assert.deepEqual(calls.sort(), [
      join(dir, "plan.md"),
      join(dir, "spec.md"),
      join(dir, "tasks.md"),
    ]);
  });

  it("propagates unreadable-file failures instead of guessing", async () => {
    const dir = featureDir();
    const broken = new Error("denied");
    await assert.rejects(
      loadSpecKitFeatureFiles(dir, async () => {
        throw broken;
      }),
      (error: unknown) => error === broken,
    );
  });

  it("keeps parallel markers as text without parallel execution", () => {
    const tasks = taskTickets();
    const parallel = tasks.filter((task) => task.description.includes("[P]"));
    assert.ok(parallel.length >= 2);
    const { tickets } = mapSpecKitFeatureToTickets({
      requirements: "Shop owners can export orders.",
      specMd: SPEC_MD,
      planMd: PLAN_MD,
      tasksMd: TASKS_MD,
    });
    for (const ticket of tickets) {
      assert.ok(!("parallel" in ticket || "story" in ticket || "phase" in ticket));
    }
    assert.deepEqual(
      tasks.map((task) => task.id),
      [...tasks.map((task) => task.id)].sort(),
      "sequential one-at-a-time order",
    );
  });

  it("composes content without wrapper noise or invention", () => {
    const content = composeSpecKitPlanContent({ specMd: SPEC_MD, planMd: PLAN_MD, tasksMd: TASKS_MD });
    assert.ok(content.startsWith("# Feature: CSV export"), "verbatim first, no wrapper");
    assert.ok(!content.includes("# Specification\n\n#"), "no wrapper headings");
    assert.ok(content.includes("# Task T001: Create project structure per implementation plan"));
    assert.ok(content.includes("Phase: Phase 1: Setup (Shared Infrastructure)"));
  });

  it("uses no commands, skills, or mutation seams", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "providers", "speckit-artifacts.ts"),
      "utf8",
    );
    const importedModules = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(
      importedModules.sort(),
      ["../planning/mapper", "../planning/tickets", "./specification", "./speckit-detection", "node:path"],
      "adapter-only imports",
    );
    assert.ok(!/child_process|spawnSync|execFile|execSync|runCommand\s*\(|\.execute\s*\(/.test(source), "no process execution");
    assert.ok(!/\bimplement\s*\(/.test(source), "no implement invocation");
    assert.ok(!/writeFile|mkdir|unlink|rmdir/.test(source), "no file mutation");
    assert.ok(!/config/i.test(source), "no configuration coupling");
  });

  it("keeps the generic mapper provider-neutral", () => {
    for (const file of ["mapper.ts", "tickets.ts"]) {
      const source = readFileSync(join(__dirname, "..", "..", "src", "planning", file), "utf8");
      assert.ok(!/spec-kit|speckit|opencode|github|delegate/i.test(source), `${file} stays generic`);
    }
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/speckit-artifacts");
    assert.deepEqual(Object.keys(module).sort(), [
      "composeSpecKitPlanContent",
      "loadSpecKitFeatureFiles",
      "mapSpecKitFeatureToTickets",
      "parseSpecKitTasks",
    ]);
  });
});
