import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runNewProject, NewProjectInput } from "../src/runtime/new-project-workflow";
import { getWorkModeDescriptor } from "../src/runtime/work-mode";
import { recommendMode } from "../src/runtime/mode-recommendation";

// New project workflow tests (M29 T-037): brief to approved,
// persisted Sprint/Task plan. Planning only: no feature
// execution, no acceptance, no scaffolding. Hermetic.

const WORKFLOW_SOURCE = join(__dirname, "..", "..", "src", "runtime", "new-project-workflow.ts");

function codeLines(): string {
  return readFileSync(WORKFLOW_SOURCE, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/**") && !trimmed.startsWith("*/");
    })
    .join("\n");
}

interface CallRecord {
  prompt: string;
  project_root: string;
  role?: string;
}

function newProjectInput(overrides: Partial<NewProjectInput> = {}, calls: CallRecord[] = [], rejectRole?: string, rejectMarker?: string): { input: NewProjectInput; calls: CallRecord[]; root: string } {
  const root = mkdtempSync(join(tmpdir(), "newproj-"));
  return {
    calls,
    root,
    input: {
      request: "Build a reading-list service for saved articles.",
      pm: {
        requirements: ["Saved articles appear in reverse-chronological order"],
        scope: { in_scope: ["Reading-list page"], out_of_scope: ["Offline sync"] },
        acceptance_criteria: ["Saved articles render newest first."],
        business_rules: ["Only the owning reader sees their list."],
        business_constraints: ["Launch behind the existing reader flag."],
      },
      tl: {
        architecture: ["Server-rendered page over the article store."],
        decomposition_strategy: ["Split page render from read-state update."],
        technical_constraints: ["Reuse the article store client."],
        dependencies: ["Article store availability."],
      },
      pmApproval: { identity: { role: "project-manager" }, decision: "approved" },
      tlApproval: { identity: { role: "technical-lead" }, decision: "approved" },
      sprint: { id: "sprint-reading-list", goal: "Ship the reading-list page." },
      tasks: [
        { id: "T-101", title: "Render the reading-list page", description: "Server-render saved articles newest first.", requirements: "Saved articles appear in reverse-chronological order", acceptance_criteria: ["Saved articles render newest first."], specialty: "backend" },
        { id: "T-102", title: "Mark article read on open", description: "Record read state when an article opens.", requirements: "Opening an article marks it read", acceptance_criteria: ["Opening an article marks it read."], dependencies: ["T-101"], specialty: "backend" },
      ],
      project_root: root,
      provider: {
        name: "stub",
        execute: async (request: { prompt: string; project_root: string; role?: string }) => {
          calls.push({ prompt: request.prompt, project_root: request.project_root, role: request.role });
          if (request.role === rejectRole && (rejectMarker === undefined || request.prompt.includes(rejectMarker))) {
            throw new Error("provider boom");
          }
          return { status: "succeeded" as const, text: `${request.role ?? "unknown"} output` };
        },
      },
      timeout_ms: 1000,
      ...overrides,
    },
  };
}

describe("new project workflow (M29 T-037)", () => {
  describe("happy path", () => {
    it("composes a valid three-section artifact in role order", async () => {
      const { input, calls } = newProjectInput();
      const result = await runNewProject(input);
      assert.equal(result.outcome, "completed");
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.ok(result.artifact.coordinator !== undefined && result.artifact.project_manager !== undefined && result.artifact.technical_lead !== undefined);
      assert.equal(result.artifact.coordinator.request, "Build a reading-list service for saved articles.");
      assert.deepEqual(calls.map((call) => call.role), ["coordinator", "project-manager", "technical-lead", "technical-lead"]);
    });

    it("passes both handoffs through validated seams with business content intact", async () => {
      const { input, calls } = newProjectInput();
      await runNewProject(input);
      const pmCall = calls.find((call) => call.role === "project-manager");
      assert.ok(pmCall !== undefined && pmCall.prompt.includes("Build a reading-list service"));
      const tlCall = calls.filter((call) => call.role === "technical-lead")[0];
      assert.ok(tlCall.prompt.includes("Saved articles appear in reverse-chronological order"));
    });

    it("keeps provider reports opaque and out of structured data", async () => {
      const { input } = newProjectInput();
      const result = await runNewProject(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      const structured = JSON.stringify({ artifact: result.artifact, sprint: result.sprint, tasks: result.tasks });
      assert.ok(!structured.includes(" output"));
    });

    it("requires both approvals with correct authorities before decomposing", async () => {
      const { input } = newProjectInput();
      const result = await runNewProject(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.pmApproval.outcome, "approved");
      assert.equal(result.pmApproval.authority, "project-manager");
      assert.equal(result.tlApproval.outcome, "approved");
      assert.equal(result.tlApproval.authority, "technical-lead");
      assert.deepEqual(result.pmApproval.artifact, result.artifact);
    });

    it("returns canonical Sprint/Tasks with matching links from readback", async () => {
      const { input } = newProjectInput();
      const result = await runNewProject(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.deepEqual(result.sprint.tasks, ["T-101", "T-102"]);
      assert.equal(result.tasks.length, 2);
      for (const task of result.tasks) {
        assert.equal(task.sprint, "sprint-reading-list");
      }
      assert.deepEqual(Object.keys(result).sort(), ["artifact", "outcome", "planPath", "pmApproval", "sprint", "tasks", "tlApproval", "workflow"]);
    });

    it("persists exactly the T-015 plan file and reports its path", async () => {
      const { input, root } = newProjectInput();
      const result = await runNewProject(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.planPath, join(root, ".ai-team", "plans", "sprint-reading-list.json"));
      const stored = JSON.parse(readFileSync(result.planPath, "utf8"));
      assert.equal(stored.sprint.id, "sprint-reading-list");
      assert.equal(stored.tasks.length, 2);
      assert.deepEqual(readdirSync(root).sort(), [".ai-team"]);
    });

    it("is deterministic across runs", async () => {
      const first = await runNewProject(newProjectInput().input);
      const second = await runNewProject(newProjectInput().input);
      assert.equal(first.outcome, "completed");
      assert.deepEqual({ ...first, planPath: "x" }, { ...second, planPath: "x" });
    });
  });

  describe("stop semantics", () => {
    it("empty briefs fail before any provider contact", async () => {
      const { input, calls } = newProjectInput({ request: "" });
      await assert.rejects(runNewProject(input), /non-empty project brief/);
      assert.equal(calls.length, 0);
      const { calls: calls2 } = newProjectInput();
      await assert.rejects(runNewProject(null as unknown as NewProjectInput), /input object/);
      assert.equal(calls2.length, 0);
    });

    it("coordinator failure stops with one call", async () => {
      const { input, calls } = newProjectInput({}, [], "coordinator");
      const result = await runNewProject(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "coordinator");
      assert.equal(calls.length, 1);
    });

    it("PM failure stops before TL planning", async () => {
      const { input, calls } = newProjectInput({}, [], "project-manager");
      const result = await runNewProject(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "project-manager");
      assert.deepEqual(calls.map((call) => call.role), ["coordinator", "project-manager"]);
    });

    it("PM clarification stops artifact assembly with feedback", async () => {
      const { input, calls } = newProjectInput({ pm: { requirements: ["R1"], questions: ["Which segment?"] } });
      const result = await runNewProject(input);
      assert.equal(result.outcome, "changes-required");
      if (result.outcome !== "changes-required") throw new Error("unreachable");
      assert.equal(result.stage, "planning-approval");
      assert.ok(typeof result.feedback === "string" && result.feedback.length > 0);
      assert.equal(calls.length, 2);
    });

    it("TL failure stops before approval", async () => {
      const { input, calls } = newProjectInput({}, [], "technical-lead", "Technical Lead planning:");
      const result = await runNewProject(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "technical-lead-planning");
      assert.equal(calls.length, 3);
    });

    it("PM rejection stops decomposition with preserved artifact and notes", async () => {
      const { input, calls } = newProjectInput({ pmApproval: { identity: { role: "project-manager" }, decision: "changes-required", notes: "Narrow the scope." } });
      const result = await runNewProject(input);
      assert.equal(result.outcome, "changes-required");
      if (result.outcome !== "changes-required") throw new Error("unreachable");
      assert.equal(result.stage, "planning-approval");
      assert.equal(result.feedback, "Narrow the scope.");
      assert.ok(result.artifact.technical_lead !== undefined);
      assert.equal(calls.length, 3, "no decomposition attempt");
    });

    it("TL rejection stops decomposition even after PM approval", async () => {
      const { input, calls } = newProjectInput({ tlApproval: { identity: { role: "technical-lead" }, decision: "changes-required" } });
      const result = await runNewProject(input);
      assert.equal(result.outcome, "changes-required");
      if (result.outcome !== "changes-required") throw new Error("unreachable");
      assert.ok(!("feedback" in result), "notes absent means no feedback field");
      assert.equal(calls.length, 3);
    });

    it("wrong approval authorities fail bounded", async () => {
      const { input } = newProjectInput({ tlApproval: { identity: { role: "implementer" }, decision: "approved" } });
      const result = await runNewProject(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "planning-approval");
    });

    it("malformed Sprint/Task input fails decomposition without persistence", async () => {
      const { input, calls, root } = newProjectInput({ tasks: [{ id: "T-1", title: "t", description: "d", requirements: "r" }, { id: "T-1", title: "dup", description: "d", requirements: "r" }] });
      await assert.rejects(runNewProject(input), /duplicate task id/);
      assert.equal(calls.length, 3, "planning only");
      assert.deepEqual(readdirSync(root), [], "no plan file written");
    });

    it("decomposition provider failure stops before persistence", async () => {
      const { input, calls, root } = newProjectInput({}, [], "technical-lead", "task decomposition");
      const result = await runNewProject(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "decomposition");
      assert.equal(calls.length, 4);
      assert.deepEqual(readdirSync(root), []);
    });

    it("persistence failure stops before completion", async () => {
      const { input, calls } = newProjectInput({ project_root: "/no-such-root-new-project" });
      const result = await runNewProject(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "persistence");
      assert.equal(calls.length, 4, "planning plus decomposition only");
    });

    it("failed results carry stage, kind, and message", async () => {
      const { input } = newProjectInput({ project_root: "/no-such-root-new-project" });
      const result = await runNewProject(input);
      assert.deepEqual(Object.keys(result).sort(), ["error", "outcome", "stage", "workflow"]);
    });
  });

  describe("boundaries", () => {
    it("executes no Implementer, Reviewer, acceptance, validation, or approval role", async () => {
      const { input, calls } = newProjectInput();
      await runNewProject(input);
      assert.ok(calls.every((call) => call.role === "coordinator" || call.role === "project-manager" || call.role === "technical-lead"));
      const code = codeLines();
      for (const forbidden of ["executeIndependent", "independent-execution", "runPmUserTestingReview", "runFinalApproval", "decideFinalApproval", "runTechnicalLeadReview", "TechnicalLeadReview", "PmUserTesting", "FinalApproval", "IssueProvider", "TicketSink", "TicketSource", "GitHub", "dispatch", "Delegate"]) {
        assert.ok(!code.includes(forbidden), `workflow code never mentions ${forbidden}`);
      }
    });

    it("introduces no retry, re-entry, fallback, orchestration, scaffolding, or CLI", () => {
      const code = codeLines();
      for (const forbidden of ["retry", "reentry", "re-enter", "fallback", "orchestrat", "scaffold", "Scaffold", "mkdir", "runFast", "runStandard", "runFull", "ModeOrchestrator", "recommend", "guardrail", "reentry-request", "ReentryRequest", "FAST", "STANDARD", "FULL", "cli", "CLI", "argv", "spawn", "node:"]) {
        assert.ok(!code.includes(forbidden), `workflow code never mentions ${forbidden}`);
      }
      const imports = readFileSync(WORKFLOW_SOURCE, "utf8")
        .split("\n")
        .filter((line) => line.trim().startsWith("import "));
      assert.deepEqual(imports, [
        'import { AgentProvider } from "../providers/agent";',
        'import { ExecutionResult } from "../providers/result";',
        'import { RoleId } from "../roles/contract";',
        'import { runCoordinatorPlanning } from "./coordinator-planning";',
        'import { runPmPlanning } from "./pm-planning";',
        'import { runTechnicalLeadPlanning } from "./tl-planning";',
        "import {",
        'import { decidePlanningApproval, PlanningApprovalResult } from "./planning-approval";',
        'import { runTechnicalLeadTaskDecomposition } from "./tl-decomposition";',
        'import { Sprint } from "./sprint-model";',
        'import { Task } from "./task-model";',
        'import { persistSprintPlan, readSprintPlan } from "./task-persistence";',
        'import { FullPmSection, FullTlSection, FullApprovalDecision } from "./full-path";',
      ]);
    });

    it("mutates no caller inputs and freezes results", async () => {
      const { input } = newProjectInput();
      const tasksBefore = JSON.stringify(input.tasks);
      const result = await runNewProject(input);
      assert.equal(JSON.stringify(input.tasks), tasksBefore);
      assert.ok(Object.isFrozen(result));
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.ok(Object.isFrozen(result.artifact) && Object.isFrozen(result.tasks));
    });

    it("leaves T-026 through T-036 contracts and behavior unchanged", () => {
      assert.deepEqual(getWorkModeDescriptor("full").lifecycle.length, 7);
      assert.equal(recommendMode({ signals: { needsBusinessPlanning: false, needsSprintDecomposition: false, needsApprovals: false, needsTechnicalPlanning: false } }).recommended, "fast");
      for (const file of ["src/runtime/full-path.ts", "src/runtime/reentry-request.ts", "src/runtime/correction-reference.ts"]) {
        const code = readFileSync(join(__dirname, "..", "..", file), "utf8");
        assert.ok(!code.includes("new-project-workflow") && !code.includes("NewProject"), `${file} unchanged by T-037`);
      }
    });
  });
});
