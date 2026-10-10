import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFastBugLifecycle, FastBugLifecycleInput } from "../src/runtime/fast-bug-lifecycle";
import { runFast } from "../src/runtime/fast-path";
import { getWorkModeDescriptor } from "../src/runtime/work-mode";
import { recommendMode } from "../src/runtime/mode-recommendation";

// FAST bug lifecycle tests (M29 T-041): a thin dedicated
// entry point delegating to the canonical runFast engine.
// No second engine, no planning, no re-entry. Hermetic.

const LIFECYCLE_SOURCE = join(__dirname, "..", "..", "src", "runtime", "fast-bug-lifecycle.ts");

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

function lifecycleInput(overrides: Partial<FastBugLifecycleInput> = {}, calls: CallRecord[] = []): { input: FastBugLifecycleInput; calls: CallRecord[] } {
  return {
    calls,
    input: {
      ticket: { id: "B-101", title: "Fix login redirect loop", description: "Users loop between login and home.", requirements: "Login lands on home exactly once" },
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

describe("FAST bug lifecycle (M29 T-041)", () => {
  describe("delegation", () => {
    it("invokes runFast exactly once with the mode fixed", async () => {
      const { input, calls } = lifecycleInput();
      const result = await runFastBugLifecycle(input);
      assert.equal(result.outcome, "completed");
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.mode, "fast");
      assert.equal(result.ticket_id, "B-101");
      assert.deepEqual(calls.map((call) => call.role), ["implementer", "senior-reviewer"]);
    });

    it("matches a direct runFast call on equivalent inputs", async () => {
      const viaWrapper = await runFastBugLifecycle(lifecycleInput().input);
      const direct = await runFast({ ...lifecycleInput().input, mode: "fast" });
      assert.deepEqual(viaWrapper, direct);
    });

    it("does not reimplement the Implementer Reviewer sequence", () => {
      const code = codeLines();
      assert.ok(code.includes("runFast"));
      for (const stage of ["executeIndependent", "runCoordinatorPlanning", "runPmPlanning", "decidePlanningApproval", "persistSprintPlan", "validateReviewDecisionResolution"]) {
        assert.ok(!code.includes(stage), `wrapper never mentions ${stage}`);
      }
    });

    it("refuses caller mode fields instead of replacing them", async () => {
      const { input, calls } = lifecycleInput();
      await assert.rejects(runFastBugLifecycle({ ...input, mode: "full" } as unknown as FastBugLifecycleInput), /explicit mode selection is not accepted/);
      await assert.rejects(runFastBugLifecycle({ ...input, mode: "fast" } as unknown as FastBugLifecycleInput), /explicit mode selection is not accepted/);
      assert.equal(calls.length, 0, "rejected before any engine contact");
      await assert.rejects(runFastBugLifecycle(null as unknown as FastBugLifecycleInput), /input object/);
    });
  });

  describe("preserved engine behavior", () => {
    it("forwards ticket, specialty, discovery, resolver, and timeout without omission or mutation", async () => {
      const { input, calls } = lifecycleInput({ discovery_summary: "FAST_DISCOVERY_F1" });
      const before = JSON.stringify(input);
      const result = await runFastBugLifecycle(input);
      assert.equal(result.outcome, "completed");
      assert.equal(JSON.stringify(input), before);
      const implementerCall = calls.find((call) => call.role === "implementer");
      assert.ok(implementerCall !== undefined && implementerCall.prompt.includes("B-101"));
      assert.ok(implementerCall.prompt.includes("FAST_DISCOVERY_F1"));
    });

    it("preserves the ticket verbatim with identifiers and criteria intact", async () => {
      const { input } = lifecycleInput();
      const result = await runFastBugLifecycle(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.implementation.ticket_id, "B-101");
      assert.equal(result.review.ticket_id, "B-101");
      assert.equal(result.implementation.result.text, "implementer output");
    });

    it("implementer failure prevents review with the original failure preserved", async () => {
      const { input, calls } = lifecycleInput({
        provider: {
          name: "stub",
          execute: async (request: { prompt: string; project_root: string; role?: string }) => {
            calls.push({ prompt: request.prompt, project_root: request.project_root, role: request.role });
            if (request.role === "implementer") {
              throw new Error("implementer down");
            }
            return { status: "succeeded" as const, text: "reviewer output" };
          },
        },
      });
      const result = await runFastBugLifecycle(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "implementer");
      assert.equal(calls.length, 1);
    });

    it("review and decision failures preserve stage and error details", async () => {
      const { input } = lifecycleInput({
        provider: {
          name: "stub",
          execute: async (request: { prompt: string; project_root: string; role?: string }) => {
            if (request.role === "senior-reviewer") {
              throw new Error("reviewer down");
            }
            return { status: "succeeded" as const, text: `${request.role} output` };
          },
        },
      });
      const failed = await runFastBugLifecycle(input);
      if (failed.outcome !== "failed") throw new Error("unreachable");
      assert.equal(failed.stage, "reviewer");
      const { input: input2 } = lifecycleInput({ reviewDecision: (() => ({ decision: "maybe" })) as unknown as FastBugLifecycleInput["reviewDecision"] });
      const decisionFailed = await runFastBugLifecycle(input2);
      if (decisionFailed.outcome !== "failed") throw new Error("unreachable");
      assert.equal(decisionFailed.stage, "decision");
    });

    it("changes-required returns verbatim with no second attempt", async () => {
      const { input, calls } = lifecycleInput({ reviewDecision: () => ({ decision: "changes_requested" as const, feedback: "Reproduce first." }) });
      const result = await runFastBugLifecycle(input);
      assert.equal(result.outcome, "changes-required");
      if (result.outcome !== "changes-required") throw new Error("unreachable");
      assert.equal(result.feedback, "Reproduce first.");
      assert.equal(calls.filter((call) => call.role === "implementer").length, 1);
    });

    it("completed payloads keep their keys without flattening", async () => {
      const { input } = lifecycleInput();
      const result = await runFastBugLifecycle(input);
      assert.deepEqual(Object.keys(result).sort(), ["implementation", "mode", "outcome", "review", "ticket_id"]);
    });
  });

  describe("boundaries", () => {
    it("adds no planning, approvals, persistence, re-entry, dispatch, files, CLI, or orchestration", async () => {
      const root = mkdtempSync(join(tmpdir(), "fastlife-"));
      const before = readdirSync(root);
      const { input } = lifecycleInput();
      await runFastBugLifecycle(input);
      assert.deepEqual(readdirSync(root), before, "wrapper writes no files independently");
      const code = codeLines();
      for (const forbidden of ["runCoordinatorPlanning", "runPmPlanning", "runTechnicalLeadPlanning", "decidePlanningApproval", "tl-decomposition", "Decompos", "sprint-model", "task-model", "plan-ticket-mapper", "task-persistence", "runTechnicalLeadReview", "runPmUserTestingReview", "runFinalApproval", "runStandard", "runFull", "createCorrectionReference", "CorrectionReference", "ReentryRequest", "reentry-request", "retry", "fallback", "dispatch", "recommend", "guardrail", "scaffold", "spawn", "node:", "FAST", "STANDARD", "FULL", "T-042", "T-043", "M30", "onboard"]) {
        assert.ok(!code.includes(forbidden), `lifecycle code never mentions ${forbidden}`);
      }
      const imports = readFileSync(LIFECYCLE_SOURCE, "utf8")
        .split("\n")
        .filter((line) => line.trim().startsWith("import "));
      assert.deepEqual(imports, ['import { runFast, FastInput, FastResult } from "./fast-path";']);
    });

    it("leaves FAST, STANDARD, FULL, and T-039/T-040 contracts unchanged", async () => {
      assert.deepEqual(getWorkModeDescriptor("fast").lifecycle, ["implementer", "senior-reviewer"]);
      assert.equal(recommendMode({ signals: { needsBusinessPlanning: false, needsSprintDecomposition: false, needsApprovals: false, needsTechnicalPlanning: false } }).recommended, "fast");
      for (const file of ["src/runtime/fast-path.ts", "src/runtime/standard-path.ts", "src/runtime/full-path.ts", "src/runtime/full-feature-lifecycle.ts", "src/runtime/standard-feature-lifecycle.ts", "src/runtime/work-mode.ts"]) {
        const code = readFileSync(join(__dirname, "..", "..", file), "utf8");
        assert.ok(!code.includes("fast-bug-lifecycle") && !code.includes("FastBugLifecycle"), `${file} unchanged by T-041`);
      }
      const { input } = lifecycleInput();
      assert.equal((await runFastBugLifecycle(input)).outcome, "completed");
    });
  });
});
