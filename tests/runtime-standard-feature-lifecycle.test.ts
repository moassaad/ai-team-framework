import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStandardFeatureLifecycle, StandardFeatureLifecycleInput } from "../src/runtime/standard-feature-lifecycle";
import { runStandard } from "../src/runtime/standard-path";
import { getWorkModeDescriptor } from "../src/runtime/work-mode";
import { recommendMode } from "../src/runtime/mode-recommendation";

// STANDARD feature lifecycle tests (M29 T-040): a thin
// dedicated entry point delegating to the canonical
// runStandard engine. No second pipeline, no FULL stages.
// Hermetic.

const LIFECYCLE_SOURCE = join(__dirname, "..", "..", "src", "runtime", "standard-feature-lifecycle.ts");

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

function lifecycleInput(overrides: Partial<StandardFeatureLifecycleInput> = {}, calls: CallRecord[] = []): { input: StandardFeatureLifecycleInput; calls: CallRecord[] } {
  return {
    calls,
    input: {
      request: "Add request logging to the service.",
      ticket: { id: "T-201", title: "Add request logging", description: "Log each request path.", requirements: "Every path is logged" },
      tlEvidence: [{ id: "T-201", title: "Add request logging", description: "Log each request path.", requirements: "Every path is logged", state: "ready" as const }],
      specialty: "backend",
      project_root: "/proj",
      provider: {
        name: "stub",
        execute: async (request: { prompt: string; project_root: string; role?: string }) => {
          calls.push({ prompt: request.prompt, project_root: request.project_root, role: request.role });
          return { status: "succeeded" as const, text: `${request.role ?? "unknown"} output` };
        },
      },
      reviewDecision: () => ({ decision: "approved" as const }),
      timeout_ms: 1000,
      ...overrides,
    },
  };
}

describe("STANDARD feature lifecycle (M29 T-040)", () => {
  describe("delegation", () => {
    it("invokes runStandard exactly once with the mode fixed", async () => {
      const { input, calls } = lifecycleInput();
      const result = await runStandardFeatureLifecycle(input);
      assert.equal(result.outcome, "completed");
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.mode, "standard");
      assert.deepEqual(calls.map((call) => call.role), ["coordinator", "technical-lead", "implementer", "senior-reviewer"]);
    });

    it("matches a direct runStandard call on equivalent inputs", async () => {
      const viaWrapper = await runStandardFeatureLifecycle(lifecycleInput().input);
      const direct = await runStandard({ ...lifecycleInput().input, mode: "standard" });
      assert.deepEqual(viaWrapper, direct);
    });

    it("does not reimplement any lifecycle stage", () => {
      const code = codeLines();
      assert.ok(code.includes("runStandard"));
      for (const stage of ["runCoordinatorPlanning", "runPmPlanning", "runTechnicalLeadPlanning", "executeIndependent", "decidePlanningApproval", "persistSprintPlan", "mapTaskToTicket", "validateReviewDecisionResolution"]) {
        assert.ok(!code.includes(stage), `wrapper never mentions ${stage}`);
      }
    });

    it("refuses caller mode fields instead of replacing them", async () => {
      const { input, calls } = lifecycleInput();
      await assert.rejects(runStandardFeatureLifecycle({ ...input, mode: "full" } as unknown as StandardFeatureLifecycleInput), /explicit mode selection is not accepted/);
      await assert.rejects(runStandardFeatureLifecycle({ ...input, mode: "standard" } as unknown as StandardFeatureLifecycleInput), /explicit mode selection is not accepted/);
      assert.equal(calls.length, 0, "rejected before any engine contact");
      await assert.rejects(runStandardFeatureLifecycle(null as unknown as StandardFeatureLifecycleInput), /input object/);
    });
  });

  describe("preserved engine behavior", () => {
    it("forwards request, ticket, evidence, and resolver without omission or mutation", async () => {
      const { input, calls } = lifecycleInput();
      const before = JSON.stringify(input);
      const result = await runStandardFeatureLifecycle(input);
      assert.equal(result.outcome, "completed");
      assert.equal(JSON.stringify(input), before);
      assert.ok(calls.find((call) => call.role === "coordinator")?.prompt.includes("Add request logging to the service."));
      assert.ok(calls.find((call) => call.role === "technical-lead")?.prompt.includes("T-201"));
    });

    it("forwards optional discovery summary per StandardInput semantics", async () => {
      const { input, calls } = lifecycleInput({ discovery_summary: "STD_DISCOVERY_S4" });
      await runStandardFeatureLifecycle(input);
      const implementerCall = calls.find((call) => call.role === "implementer");
      assert.ok(implementerCall !== undefined && implementerCall.prompt.includes("STD_DISCOVERY_S4"));
    });

    it("preserves coordinator handoff provenance without inventing a direct handoff", async () => {
      const { input } = lifecycleInput();
      const result = await runStandardFeatureLifecycle(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.coordination.handoff.from, "coordinator");
      assert.equal(result.coordination.handoff.to, "project-manager", "PM-bound provenance, never retargeted");
      assert.ok(!("directHandoff" in result) && !("coordinatorTlHandoff" in result));
    });

    it("returns completed payloads without loss", async () => {
      const { input } = lifecycleInput();
      const result = await runStandardFeatureLifecycle(input);
      assert.deepEqual(Object.keys(result).sort(), ["coordination", "implementation", "mode", "outcome", "review", "technicalLead", "ticket_id"]);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.ticket_id, "T-201");
    });

    it("returns changes-required verbatim with no re-entry", async () => {
      const { input, calls } = lifecycleInput({ reviewDecision: () => ({ decision: "changes_requested" as const, feedback: "Tighten it." }) });
      const result = await runStandardFeatureLifecycle(input);
      assert.equal(result.outcome, "changes-required");
      if (result.outcome !== "changes-required") throw new Error("unreachable");
      assert.equal(result.feedback, "Tighten it.");
      assert.equal(calls.length, 4);
    });

    it("preserves failed stage and error details", async () => {
      const failProvider = {
        name: "stub",
        execute: async (request: { prompt: string; project_root: string; role?: string }) => {
          if (request.role === "implementer") {
            throw new Error("implementer down");
          }
          return { status: "succeeded" as const, text: `${request.role} output` };
        },
      };
      const { input } = lifecycleInput({ provider: failProvider });
      const result = await runStandardFeatureLifecycle(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "implementer");
      assert.deepEqual(Object.keys(result).sort(), ["error", "mode", "outcome", "stage", "ticket_id"]);
      assert.equal(result.mode, "standard");
    });

    it("stop behavior matches the engine on early failures", async () => {
      const failingCalls: CallRecord[] = [];
      const failingProvider = {
        name: "stub",
        execute: async (request: { prompt: string; project_root: string; role?: string }) => {
          failingCalls.push({ prompt: request.prompt, project_root: request.project_root, role: request.role });
          if (request.role === "coordinator") {
            throw new Error("coordinator down");
          }
          return { status: "succeeded" as const, text: "ok" };
        },
      };
      const { input: input2 } = lifecycleInput({ provider: failingProvider });
      const result = await runStandardFeatureLifecycle(input2);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "coordinator");
      assert.equal(failingCalls.length, 1);
    });
  });

  describe("boundaries", () => {
    it("introduces no FULL-only stages, retry, fallback, dispatch, files, CLI, or orchestration", async () => {
      const root = mkdtempSync(join(tmpdir(), "stdlife-"));
      const before = readdirSync(root);
      const { input } = lifecycleInput();
      await runStandardFeatureLifecycle(input);
      assert.deepEqual(readdirSync(root), before, "wrapper writes no files independently");
      const code = codeLines();
      for (const forbidden of ["runPmPlanning", "decidePlanningApproval", "tl-decomposition", "Decompos", "sprint-model", "task-model", "plan-ticket-mapper", "task-persistence", "runTechnicalLeadReview", "runPmUserTestingReview", "runFinalApproval", "runFull", "runFast", "retry", "fallback", "dispatch", "recommend", "guardrail", "scaffold", "spawn", "node:", "FAST", "STANDARD", "FULL", "T-041", "T-042", "T-043", "M30", "onboard"]) {
        assert.ok(!code.includes(forbidden), `lifecycle code never mentions ${forbidden}`);
      }
      const imports = readFileSync(LIFECYCLE_SOURCE, "utf8")
        .split("\n")
        .filter((line) => line.trim().startsWith("import "));
      assert.deepEqual(imports, ['import { runStandard, StandardInput, StandardResult } from "./standard-path";']);
    });

    it("leaves FAST, STANDARD, FULL, and T-039 contracts unchanged", async () => {
      assert.deepEqual(getWorkModeDescriptor("standard").lifecycle, ["coordinator", "technical-lead", "implementer", "senior-reviewer"]);
      assert.equal(recommendMode({ signals: { needsBusinessPlanning: false, needsSprintDecomposition: false, needsApprovals: false, needsTechnicalPlanning: true } }).recommended, "standard");
      for (const file of ["src/runtime/standard-path.ts", "src/runtime/fast-path.ts", "src/runtime/full-path.ts", "src/runtime/full-feature-lifecycle.ts", "src/runtime/work-mode.ts"]) {
        const code = readFileSync(join(__dirname, "..", "..", file), "utf8");
        assert.ok(!code.includes("standard-feature-lifecycle") && !code.includes("StandardFeatureLifecycle"), `${file} unchanged by T-040`);
      }
      const { input } = lifecycleInput();
      assert.equal((await runStandardFeatureLifecycle(input)).outcome, "completed");
    });
  });
});
