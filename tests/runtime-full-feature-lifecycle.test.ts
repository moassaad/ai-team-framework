import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFullFeatureLifecycle, FullFeatureLifecycleInput } from "../src/runtime/full-feature-lifecycle";
import { runFull } from "../src/runtime/full-path";
import { getWorkModeDescriptor } from "../src/runtime/work-mode";
import { recommendMode } from "../src/runtime/mode-recommendation";

// FULL feature lifecycle tests (M29 T-039): a thin dedicated
// entry point delegating to the canonical runFull engine.
// No second lifecycle, no orchestration. Hermetic.

const LIFECYCLE_SOURCE = join(__dirname, "..", "..", "src", "runtime", "full-feature-lifecycle.ts");

function codeLines(): string {
  return readFileSync(LIFECYCLE_SOURCE, "utf8")
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

function lifecycleInput(overrides: Partial<FullFeatureLifecycleInput> = {}, calls: CallRecord[] = []): { input: FullFeatureLifecycleInput; calls: CallRecord[]; root: string } {
  const root = mkdtempSync(join(tmpdir(), "fulllife-"));
  return {
    calls,
    root,
    input: {
      request: "Add a reading-list page that shows saved articles.",
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
      ],
      task_id: "T-101",
      project_root: root,
      specialty: "backend",
      provider: {
        name: "stub",
        execute: async (request: { prompt: string; project_root: string; role?: string }) => {
          calls.push({ prompt: request.prompt, project_root: request.project_root, role: request.role });
          return { status: "succeeded" as const, text: `${request.role ?? "unknown"} output` };
        },
      },
      reviewDecision: () => ({ decision: "approved" as const }),
      decideTechnicalLead: () => ({ decision: "approved" as const }),
      decidePmUserTesting: () => ({ decision: "approved" as const }),
      coordinator: { role: "coordinator" },
      decideFinalApproval: () => ({ decision: "approved" as const }),
      timeout_ms: 1000,
      ...overrides,
    },
  };
}

describe("FULL feature lifecycle (M29 T-039)", () => {
  describe("delegation", () => {
    it("delegates to runFull with the FULL mode fixed", async () => {
      const { input, calls } = lifecycleInput();
      const result = await runFullFeatureLifecycle(input);
      assert.equal(result.outcome, "completed");
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.mode, "full");
      assert.equal(result.ticket.state, "closed");
      assert.deepEqual(calls.map((call) => call.role), ["coordinator", "project-manager", "technical-lead", "technical-lead", "implementer", "senior-reviewer", "technical-lead", "project-manager"]);
    });

    it("matches a direct runFull call on equivalent inputs", async () => {
      const first = lifecycleInput();
      const viaWrapper = await runFullFeatureLifecycle(first.input);
      const second = lifecycleInput();
      const direct = await runFull({ ...second.input, mode: "full" });
      assert.deepEqual({ ...viaWrapper, ticket: "x" }, { ...direct, ticket: "x" });
      assert.equal(viaWrapper.outcome, direct.outcome);
    });

    it("does not reimplement the stage sequence", () => {
      const code = codeLines();
      assert.ok(code.includes("runFull"));
      for (const stage of ["runCoordinatorPlanning", "runPmPlanning", "runTechnicalLeadPlanning", "decidePlanningApproval", "persistSprintPlan", "executeIndependent", "runTechnicalLeadReview", "runPmUserTestingReview", "runFinalApproval"]) {
        assert.ok(!code.includes(stage), `wrapper never mentions ${stage}`);
      }
    });

    it("refuses caller mode fields instead of replacing them", async () => {
      const { input, calls } = lifecycleInput();
      await assert.rejects(runFullFeatureLifecycle({ ...input, mode: "standard" } as unknown as FullFeatureLifecycleInput), /explicit mode selection is not accepted/);
      await assert.rejects(runFullFeatureLifecycle({ ...input, mode: "full" } as unknown as FullFeatureLifecycleInput), /explicit mode selection is not accepted/);
      assert.equal(calls.length, 0, "rejected before any engine contact");
      await assert.rejects(runFullFeatureLifecycle(null as unknown as FullFeatureLifecycleInput), /input object/);
    });
  });

  describe("preserved engine behavior", () => {
    it("forwards planning inputs, approvals, and task selection", async () => {
      const { input } = lifecycleInput();
      const result = await runFullFeatureLifecycle(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.artifact.coordinator?.request, "Add a reading-list page that shows saved articles.");
      assert.equal(result.pmApproval.authority, "project-manager");
      assert.equal(result.ticket_id, "T-101");
    });

    it("unknown task selection fails through the engine mapping stage", async () => {
      const { input } = lifecycleInput({ task_id: "T-999" });
      const result = await runFullFeatureLifecycle(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "mapping");
    });

    it("implementer precedes reviewer; reviewer failure stops acceptance", async () => {
      const calls: CallRecord[] = [];
      const { input } = lifecycleInput({
        provider: {
          name: "stub",
          execute: async (request: { prompt: string; project_root: string; role?: string }) => {
            calls.push({ prompt: request.prompt, project_root: request.project_root, role: request.role });
            if (request.role === "senior-reviewer") {
              throw new Error("reviewer down");
            }
            return { status: "succeeded" as const, text: `${request.role} output` };
          },
        },
      });
      const result = await runFullFeatureLifecycle(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "reviewer");
      const roles = calls.map((call) => call.role);
      assert.ok(roles.indexOf("implementer") < roles.indexOf("senior-reviewer"));
      assert.ok(!roles.slice(roles.indexOf("senior-reviewer") + 1).includes("technical-lead"));
    });

    it("TL acceptance failure prevents PM validation and final approval", async () => {
      const { input, calls } = lifecycleInput({ decideTechnicalLead: () => ({ decision: "corrections-required" as const }) });
      const result = await runFullFeatureLifecycle(input);
      assert.equal(result.outcome, "changes-required");
      if (result.outcome !== "changes-required") throw new Error("unreachable");
      assert.equal(result.stage, "technical-acceptance");
      assert.ok(!calls.some((call) => call.prompt.includes("Sprint user testing:")));
    });

    it("PM validation failure prevents final approval", async () => {
      const { input } = lifecycleInput({ decidePmUserTesting: () => ({ decision: "changes-required" as const }) });
      const result = await runFullFeatureLifecycle(input);
      if (result.outcome !== "changes-required") throw new Error("unreachable");
      assert.equal(result.stage, "pm-validation");
    });

    it("final-approval changes-required is never completion", async () => {
      const { input } = lifecycleInput({ decideFinalApproval: () => ({ decision: "changes-required" as const, notes: "Hold." }) });
      const result = await runFullFeatureLifecycle(input);
      assert.equal(result.outcome, "changes-required");
      if (result.outcome !== "changes-required") throw new Error("unreachable");
      assert.equal(result.stage, "final-approval");
      assert.equal(result.feedback, "Hold.");
    });

    it("preserves every runFull outcome variant for callers", async () => {
      const completed = await runFullFeatureLifecycle(lifecycleInput().input);
      assert.equal(completed.outcome, "completed");
      const changes = await runFullFeatureLifecycle(lifecycleInput({ tlApproval: { identity: { role: "technical-lead" }, decision: "changes-required" } }).input);
      assert.equal(changes.outcome, "changes-required");
      const failed = await runFullFeatureLifecycle(lifecycleInput({ task_id: "T-404" }).input);
      assert.equal(failed.outcome, "failed");
    });

    it("passes discovery context through without inventing project facts", async () => {
      const { input, calls } = lifecycleInput({ discovery_summary: "Existing store client available." });
      const result = await runFullFeatureLifecycle(input);
      assert.equal(result.outcome, "completed");
      const implementerCall = calls.find((call) => call.role === "implementer");
      assert.ok(implementerCall !== undefined && implementerCall.prompt.includes("Existing store client available."));
      for (const other of calls.filter((call) => call.role !== "implementer")) {
        assert.ok(!other.prompt.includes("Existing store client available."));
      }
    });

    it("reports stay opaque through the wrapper", async () => {
      const { input } = lifecycleInput();
      const result = await runFullFeatureLifecycle(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.ok(!JSON.stringify({ artifact: result.artifact, sprint: result.sprint }).includes(" output"));
    });
  });

  describe("boundaries", () => {
    it("creates no project files beyond the engine plan file and mutates no inputs", async () => {
      const { input, root } = lifecycleInput();
      const tasksBefore = JSON.stringify(input.tasks);
      await runFullFeatureLifecycle(input);
      assert.deepEqual(readdirSync(root).sort(), [".ai-team"]);
      assert.equal(JSON.stringify(input.tasks), tasksBefore);
    });

    it("adds no retry, re-entry, fallback, dispatch, checkpoints, CLI, or orchestration", () => {
      const code = codeLines();
      for (const forbidden of ["retry", "reentry", "re-enter", "fallback", "dispatch", "checkpoint", "Checkpoint", "cli", "CLI", "argv", "orchestrat", "ModeOrchestrator", "recommend", "guardrail", "scaffold", "spawn", "node:", "runStandard", "runFast", "T-040", "T-041", "T-042", "T-043", "M30", "quick-start", "QuickStart", "onboard"]) {
        assert.ok(!code.includes(forbidden), `lifecycle code never mentions ${forbidden}`);
      }
      const imports = readFileSync(LIFECYCLE_SOURCE, "utf8")
        .split("\n")
        .filter((line) => line.trim().startsWith("import "));
      assert.deepEqual(imports, ['import { runFull, FullInput, FullResult } from "./full-path";']);
    });

    it("leaves T-026 through T-038 contracts and workflow behavior unchanged", async () => {
      assert.deepEqual(getWorkModeDescriptor("full").lifecycle.length, 7);
      assert.equal(recommendMode({ signals: { needsBusinessPlanning: false, needsSprintDecomposition: false, needsApprovals: false, needsTechnicalPlanning: false } }).recommended, "fast");
      for (const file of ["src/runtime/full-path.ts", "src/runtime/new-project-workflow.ts", "src/runtime/existing-project-workflow.ts", "src/runtime/reentry-request.ts", "src/runtime/work-mode.ts"]) {
        const code = readFileSync(join(__dirname, "..", "..", file), "utf8");
        assert.ok(!code.includes("full-feature-lifecycle") && !code.includes("FullFeatureLifecycle"), `${file} unchanged by T-039`);
      }
      const { input } = lifecycleInput();
      const result = await runFullFeatureLifecycle(input);
      assert.equal(result.outcome, "completed");
    });
  });
});
