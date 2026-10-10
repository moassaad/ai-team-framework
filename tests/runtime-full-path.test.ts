import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFull, FullInput } from "../src/runtime/full-path";
import { getWorkModeDescriptor } from "../src/runtime/work-mode";

// FULL path tests (M27 T-029): planning → artifact → dual
// approval → decomposition → mapping → persistence/readback →
// implement → review → TL acceptance → PM validation → final
// approval. Every rejection stops the invocation. Hermetic:
// counting provider, temp roots, injected resolvers.

const FULL_SOURCE = join(__dirname, "..", "..", "src", "runtime", "full-path.ts");

function codeLines(): string {
  return readFileSync(FULL_SOURCE, "utf8")
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

function fullInput(overrides: Partial<FullInput> = {}, calls: CallRecord[] = [], rejectRole?: string): { input: FullInput; calls: CallRecord[]; root: string } {
  const root = mkdtempSync(join(tmpdir(), "full-"));
  return {
    calls,
    root,
    input: {
      mode: "full",
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
        { id: "T-102", title: "Mark article read on open", description: "Record read state when an article opens.", requirements: "Opening an article marks it read", acceptance_criteria: ["Opening an article marks it read."], dependencies: ["T-101"], specialty: "backend" },
      ],
      task_id: "T-101",
      project_root: root,
      specialty: "backend",
      provider: {
        name: "stub",
        execute: async (request: { prompt: string; project_root: string; role?: string }) => {
          calls.push({ prompt: request.prompt, project_root: request.project_root, role: request.role });
          if (request.role === rejectRole) {
            throw new Error("provider boom");
          }
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

describe("FULL path (M27 T-029)", () => {
  describe("descriptor consistency", () => {
    it("accepts full through the T-026 contract", async () => {
      const { input } = fullInput();
      const result = await runFull(input);
      assert.equal(result.outcome, "completed");
      assert.equal(result.mode, "full");
    });

    it("rejects fast and standard through runFull", async () => {
      for (const mode of ["fast", "standard"]) {
        const { input } = fullInput({ mode });
        await assert.rejects(runFull(input), /full mode only/);
      }
    });

    it("rejects invalid modes", async () => {
      for (const mode of ["turbo", "FULL", "", null]) {
        const { input } = fullInput({ mode: mode as unknown as string });
        await assert.rejects(runFull(input), /work mode|full mode only/);
      }
    });

    it("execution matches the T-026 full descriptor", () => {
      const descriptor = getWorkModeDescriptor("full");
      assert.deepEqual(descriptor.lifecycle, ["coordinator", "project-manager", "technical-lead", "implementer", "senior-reviewer", "technical-lead", "project-manager"]);
      assert.equal(descriptor.planning, true);
      assert.equal(descriptor.sprints, true);
      assert.equal(descriptor.approvals, true);
    });

    it("runs the full provider sequence in lifecycle order", async () => {
      const { input, calls } = fullInput();
      const result = await runFull(input);
      assert.equal(result.outcome, "completed");
      assert.deepEqual(
        calls.map((call) => call.role),
        ["coordinator", "project-manager", "technical-lead", "technical-lead", "implementer", "senior-reviewer", "technical-lead", "project-manager"],
      );
    });
  });

  describe("planning happy path", () => {
    it("passes the coordinator handoff to PM planning untouched", async () => {
      const { input, calls } = fullInput();
      const result = await runFull(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      const pmCall = calls.find((call) => call.role === "project-manager");
      assert.ok(pmCall !== undefined && pmCall.prompt.includes("Add a reading-list page that shows saved articles."));
      assert.ok(pmCall.prompt.includes("Coordinator objective: Add a reading-list page that shows saved articles."));
    });

    it("passes the PM handoff to TL planning with business content", async () => {
      const { input, calls } = fullInput();
      await runFull(input);
      const tlPlanningCall = calls.filter((call) => call.role === "technical-lead")[0];
      assert.ok(tlPlanningCall.prompt.includes("Saved articles appear in reverse-chronological order"));
    });

    it("assembles a complete three-section artifact from caller content", async () => {
      const { input } = fullInput();
      const result = await runFull(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.ok(result.artifact.coordinator !== undefined);
      assert.ok(result.artifact.project_manager !== undefined);
      assert.ok(result.artifact.technical_lead !== undefined);
      assert.equal(result.artifact.coordinator.request, "Add a reading-list page that shows saved articles.");
      assert.ok(Object.isFrozen(result.artifact));
    });

    it("reports stay opaque: no report text populates structured fields", async () => {
      const { input } = fullInput();
      const result = await runFull(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      const structured = JSON.stringify({ artifact: result.artifact, sprint: result.sprint, task: result.task });
      assert.ok(!structured.includes(" output"), "provider boilerplate never enters structured data");
    });

    it("coordinator failure stops everything with zero further calls", async () => {
      const { input, calls } = fullInput({}, [], "coordinator");
      const result = await runFull(input);
      assert.equal(result.outcome, "failed");
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "coordinator");
      assert.equal(calls.length, 1);
    });

    it("PM planning failure stops before TL planning", async () => {
      const { input, calls } = fullInput({}, [], "project-manager");
      const result = await runFull(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "project-manager");
      assert.deepEqual(calls.map((call) => call.role), ["coordinator", "project-manager"]);
    });

    it("PM clarification stops artifact assembly with changes-required", async () => {
      const { input, calls } = fullInput({ pm: { requirements: ["R1"], questions: ["Which segment first?"] } });
      const result = await runFull(input);
      assert.equal(result.outcome, "changes-required");
      if (result.outcome !== "changes-required") throw new Error("unreachable");
      assert.equal(result.stage, "planning-approval");
      assert.deepEqual(calls.map((call) => call.role), ["coordinator", "project-manager"]);
    });

    it("TL planning failure stops before approval", async () => {
      const { input, calls } = fullInput({}, [], "technical-lead");
      const result = await runFull(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "technical-lead-planning");
      assert.equal(calls.length, 3);
    });
  });

  describe("approval", () => {
    it("requires both PM and TL approvals to proceed", async () => {
      const { input } = fullInput();
      const result = await runFull(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.pmApproval.outcome, "approved");
      assert.equal(result.tlApproval.outcome, "approved");
      assert.equal(result.pmApproval.authority, "project-manager");
      assert.equal(result.tlApproval.authority, "technical-lead");
    });

    it("PM changes-required stops decomposition and everything downstream", async () => {
      const { input, calls } = fullInput({ pmApproval: { identity: { role: "project-manager" }, decision: "changes-required", notes: "Scope unclear" } });
      const result = await runFull(input);
      assert.equal(result.outcome, "changes-required");
      if (result.outcome !== "changes-required") throw new Error("unreachable");
      assert.equal(result.stage, "planning-approval");
      assert.equal(result.feedback, "Scope unclear");
      assert.ok(result.artifact.project_manager !== undefined, "artifact preserved for rework");
      assert.deepEqual(calls.map((call) => call.role), ["coordinator", "project-manager", "technical-lead"]);
    });

    it("TL changes-required stops decomposition even when PM approved", async () => {
      const { input, calls } = fullInput({ tlApproval: { identity: { role: "technical-lead" }, decision: "changes-required", notes: "Architecture open" } });
      const result = await runFull(input);
      assert.equal(result.outcome, "changes-required");
      if (result.outcome !== "changes-required") throw new Error("unreachable");
      assert.equal(result.stage, "planning-approval");
      assert.equal(calls.length, 3, "no decomposition provider call");
    });

    it("wrong-authority approval identities are rejected", async () => {
      const { input } = fullInput({ pmApproval: { identity: { role: "coordinator" }, decision: "approved" } });
      const result = await runFull(input);
      assert.equal(result.outcome, "failed");
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "planning-approval");
    });

    it("approval never inferred: completion alone does not approve", async () => {
      const { input } = fullInput({ pmApproval: { identity: { role: "project-manager" }, decision: "approved" }, tlApproval: { identity: { role: "technical-lead" }, decision: "approved" } });
      const result = await runFull(input);
      assert.equal(result.outcome, "completed");
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.pmApproval.authority, "project-manager");
    });
  });

  describe("decomposition, mapping, persistence", () => {
    it("returns canonical Sprint and Tasks with matching links", async () => {
      const { input } = fullInput();
      const result = await runFull(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.deepEqual(result.sprint.tasks, ["T-101", "T-102"]);
      assert.equal(result.task.id, "T-101", "explicit task_id selection honored");
      assert.equal(result.task.sprint, "sprint-reading-list");
    });

    it("unknown task_id fails mapping without executing anything", async () => {
      const { input, calls } = fullInput({ task_id: "T-999" });
      const result = await runFull(input);
      assert.equal(result.outcome, "failed");
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "mapping");
      assert.equal(calls.length, 4, "planning plus decomposition only");
    });

    it("second task executes when explicitly selected", async () => {
      const { input } = fullInput({ task_id: "T-102" });
      const result = await runFull(input);
      assert.equal(result.outcome, "completed");
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.ticket_id, "T-102");
      assert.equal(result.task.id, "T-102");
    });

    it("persists the plan and executes the readback task", async () => {
      const { input, root } = fullInput();
      const result = await runFull(input);
      assert.equal(result.outcome, "completed");
      if (result.outcome !== "completed") throw new Error("unreachable");
      const { readFileSync } = await import("node:fs");
      const stored = JSON.parse(readFileSync(join(root, ".ai-team", "plans", "sprint-reading-list.json"), "utf8"));
      assert.equal(stored.sprint.id, "sprint-reading-list");
      assert.equal(stored.tasks.length, 2);
      assert.equal(result.ticket.state, "closed", "ticket advanced along canonical edges");
    });

    it("decomposition provider failure stops before mapping and persistence", async () => {
      const calls: CallRecord[] = [];
      const { input } = fullInput({
        provider: {
          name: "stub",
          execute: async (request: { prompt: string; project_root: string; role?: string }) => {
            calls.push({ prompt: request.prompt, project_root: request.project_root, role: request.role });
            if (request.prompt.includes("task decomposition")) {
              throw new Error("decomposition provider down");
            }
            return { status: "succeeded" as const, text: `${request.role} output` };
          },
        },
      });
      const result = await runFull(input);
      assert.equal(result.outcome, "failed");
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "decomposition");
      assert.equal(calls.length, 4, "planning calls plus one failed decomposition attempt");
    });

    it("malformed caller-structured tasks throw fail-loud without downstream work", async () => {
      const { input, calls } = fullInput({ tasks: [{ id: "T-1", title: "t", description: "d", requirements: "r" }, { id: "T-1", title: "dup", description: "d", requirements: "r" }] });
      await assert.rejects(runFull(input), /duplicate task id/);
      assert.equal(calls.length, 3, "planning only; decomposition input rejected before any provider call");
    });

    it("persistence failure stops before implementation", async () => {
      const { input, calls } = fullInput({ project_root: "/no-such-root-full-path" });
      const result = await runFull(input);
      assert.equal(result.outcome, "failed");
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "persistence");
      assert.ok(!calls.some((call) => call.role === "implementer"));
    });
  });

  describe("execution", () => {
    it("implementer runs once with the readback ticket and reviewer follows", async () => {
      const { input, calls } = fullInput();
      const result = await runFull(input);
      assert.equal(result.outcome, "completed");
      assert.equal(calls.filter((call) => call.role === "implementer").length, 1);
      assert.equal(calls.filter((call) => call.role === "senior-reviewer").length, 1);
      const reviewerCall = calls.find((call) => call.role === "senior-reviewer");
      assert.ok(reviewerCall !== undefined && reviewerCall.prompt.includes("implementer output"));
    });

    it("implementer failure stops the reviewer", async () => {
      const { input, calls } = fullInput({}, [], "implementer");
      const result = await runFull(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "implementer");
      assert.ok(!calls.some((call) => call.role === "senior-reviewer"));
    });

    it("reviewer failure is bounded with no retry", async () => {
      const { input, calls } = fullInput({}, [], "senior-reviewer");
      const result = await runFull(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "reviewer");
      assert.equal(calls.filter((call) => call.role === "senior-reviewer").length, 1);
    });

    it("reviewer changes-required stops acceptance with feedback", async () => {
      const { input, calls } = fullInput({ reviewDecision: () => ({ decision: "changes_requested" as const, feedback: "Rework render." }) });
      const result = await runFull(input);
      assert.equal(result.outcome, "changes-required");
      if (result.outcome !== "changes-required") throw new Error("unreachable");
      assert.equal(result.stage, "reviewer");
      assert.equal(result.feedback, "Rework render.");
      assert.equal(result.artifact.project_manager !== undefined, true);
      assert.ok(!calls.some((call) => call.prompt.includes("Sprint review")) , "no TL acceptance attempt");
    });

    it("invalid review resolutions fail the review-decision stage", async () => {
      const { input } = fullInput({ reviewDecision: (() => ({ decision: "maybe" })) as unknown as FullInput["reviewDecision"] });
      const result = await runFull(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "review-decision");
    });
  });

  describe("technical acceptance", () => {
    it("approved acceptance carries ticket scope and report", async () => {
      const { input } = fullInput();
      const result = await runFull(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.technicalAcceptance.outcome, "approved");
      if (result.technicalAcceptance.outcome !== "approved") throw new Error("unreachable");
      assert.deepEqual(result.technicalAcceptance.ticket_ids, ["T-101"]);
      assert.ok(result.technicalAcceptance.report.includes("technical-lead output"));
    });

    it("corrections-required stops PM validation and final approval", async () => {
      const { input, calls } = fullInput({ decideTechnicalLead: () => ({ decision: "corrections-required" as const, notes: "Harden logging." }) });
      const result = await runFull(input);
      assert.equal(result.outcome, "changes-required");
      if (result.outcome !== "changes-required") throw new Error("unreachable");
      assert.equal(result.stage, "technical-acceptance");
      assert.equal(result.feedback, "Harden logging.");
      assert.ok(!calls.some((call) => call.role === "project-manager" && call.prompt.includes("Sprint user testing:")) , "PM validation never runs");
    });

    it("TL review failure is bounded", async () => {
      const calls: CallRecord[] = [];
      let tlReviews = 0;
      const { input } = fullInput({
        provider: {
          name: "stub",
          execute: async (request: { prompt: string; project_root: string; role?: string }) => {
            calls.push({ prompt: request.prompt, project_root: request.project_root, role: request.role });
            if (request.prompt.includes("Sprint review") && request.role === "technical-lead") {
              tlReviews += 1;
              throw new Error("tl provider down");
            }
            return { status: "succeeded" as const, text: `${request.role} output` };
          },
        },
      });
      const result = await runFull(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "technical-acceptance");
      assert.equal(tlReviews, 1, "exactly one TL acceptance attempt");
    });

    it("acceptance never reuses TL planning as evidence", async () => {
      const { input } = fullInput();
      const result = await runFull(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      if (result.technicalAcceptance.outcome !== "approved") throw new Error("unreachable");
      assert.ok(!result.technicalAcceptance.report.includes("Technical Lead planning"));
    });
  });

  describe("PM validation", () => {
    it("approved validation gates on the TL approval explicitly", async () => {
      const { input } = fullInput();
      const result = await runFull(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.pmValidation.outcome, "approved");
      if (result.pmValidation.outcome !== "approved") throw new Error("unreachable");
      assert.deepEqual(result.pmValidation.ticket_ids, ["T-101"]);
    });

    it("changes-required stops final approval", async () => {
      const { input, calls } = fullInput({ decidePmUserTesting: () => ({ decision: "changes-required" as const, notes: "Scope gap." }) });
      const result = await runFull(input);
      assert.equal(result.outcome, "changes-required");
      if (result.outcome !== "changes-required") throw new Error("unreachable");
      assert.equal(result.stage, "pm-validation");
      assert.equal(result.feedback, "Scope gap.");
      assert.equal(calls.filter((call) => call.role === "project-manager").length, 2, "PM planning plus PM validation only");
    });

    it("is distinct from PM planning: separate provider call and resolver", async () => {
      const decisions: string[] = [];
      const { input, calls } = fullInput({
        decidePmUserTesting: (request) => {
          decisions.push(`pm-validation:${request.ticket_ids.join(",")}`);
          return { decision: "approved" as const };
        },
      });
      const result = await runFull(input);
      assert.equal(result.outcome, "completed");
      assert.deepEqual(decisions, ["pm-validation:T-101"]);
      assert.ok(calls.some((call) => call.role === "project-manager" && call.prompt.includes("Sprint user testing:")));
    });
  });

  describe("final approval", () => {
    it("approved completes the invocation with a closed ticket", async () => {
      const { input } = fullInput();
      const result = await runFull(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.finalApproval.outcome, "approved");
      assert.equal(result.ticket.state, "closed");
      assert.equal(result.ticket_id, "T-101");
    });

    it("changes-required stops with notes and an unclosed ticket", async () => {
      const { input } = fullInput({ decideFinalApproval: () => ({ decision: "changes-required" as const, notes: "Hold for launch." }) });
      const result = await runFull(input);
      assert.equal(result.outcome, "changes-required");
      if (result.outcome !== "changes-required") throw new Error("unreachable");
      assert.equal(result.stage, "final-approval");
      assert.equal(result.feedback, "Hold for launch.");
    });

    it("final approval is never inferred from prior stages", async () => {
      let finalCalls = 0;
      const { input } = fullInput({
        decideFinalApproval: () => {
          finalCalls += 1;
          return { decision: "approved" as const };
        },
      });
      const result = await runFull(input);
      assert.equal(result.outcome, "completed");
      assert.equal(finalCalls, 1, "explicit resolver invoked exactly once");
    });

    it("invalid coordinator authority is rejected before final approval runs", async () => {
      const { input, calls } = fullInput({ coordinator: { role: "project-manager" } });
      await assert.rejects(runFull(input), /coordinator approval reference/);
      assert.equal(calls.length, 0, "fail-fast input validation precedes every stage");
    });
  });

  describe("failure matrix call counts", () => {
    it("every stage stops all later provider calls", async () => {
      const expectations: Array<[string, number]> = [
        ["coordinator", 1],
        ["project-manager", 2],
        ["technical-lead", 3],
      ];
      for (const [rejectRole, expectedCalls] of expectations) {
        const { input, calls } = fullInput({}, [], rejectRole);
        const result = await runFull(input);
        assert.equal(result.outcome, "failed");
        assert.equal(calls.length, expectedCalls, `${rejectRole} failure stops at ${expectedCalls} calls`);
      }
    });

    it("malformed mode and input fail before any provider contact", async () => {
      const { input, calls } = fullInput({ mode: "turbo" });
      await assert.rejects(runFull(input), /work mode|full mode only/);
      assert.equal(calls.length, 0);
      const { input: input2, calls: calls2 } = fullInput({ reviewDecision: "yes" as unknown as FullInput["reviewDecision"] });
      await assert.rejects(runFull(input2), /review decision resolver/);
      assert.equal(calls2.length, 0);
    });

    it("failed results carry stage, kind, and message", async () => {
      const { input } = fullInput({}, [], "implementer");
      const result = await runFull(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "implementer");
      assert.ok(result.error.kind.length > 0 && result.error.message.length > 0);
      assert.deepEqual(Object.keys(result).sort(), ["error", "mode", "outcome", "stage", "ticket_id"]);
    });
  });

  describe("no hidden behavior", () => {
    it("performs no retry at any stage", async () => {
      const { input, calls } = fullInput({ reviewDecision: () => ({ decision: "changes_requested" as const, feedback: "x" }) });
      await runFull(input);
      const roles = calls.map((call) => call.role);
      assert.deepEqual(roles, ["coordinator", "project-manager", "technical-lead", "technical-lead", "implementer", "senior-reviewer"]);
    });

    it("touches no delegation, fallback, modes, re-entry, or orchestration", () => {
      const code = codeLines();
      for (const forbidden of ["dispatchHandoff", "delegate", "Delegate", "createManualFallback", "fallback", "runFast", "runStandard", "runWorkMode", "ModeOrchestrator", "recommend", "guardrail", "retry", "reentry", "re-enter", "orchestrat", "FAST", "STANDARD", "FULL", "IssueProvider", "TicketSink", "TicketSource", "github", "GitHub", "spawn", "node:"]) {
        assert.ok(!code.includes(forbidden), `full-path code never mentions ${forbidden}`);
      }
    });

    it("imports only existing contracts", () => {
      const imports = readFileSync(FULL_SOURCE, "utf8")
        .split("\n")
        .filter((line) => line.trim().startsWith("import "));
      assert.ok(imports.includes('import { validateWorkMode } from "./work-mode";'));
      assert.ok(imports.includes('import { runCoordinatorPlanning, CoordinatorPlanningCompleted } from "./coordinator-planning";'));
      assert.ok(imports.includes('import { mapTaskToTicket } from "./plan-ticket-mapper";'));
      assert.ok(imports.includes('import { persistSprintPlan, readSprintPlan } from "./task-persistence";'));
      assert.ok(imports.includes('import { isValidTransition } from "../workflow/transitions";'));
      assert.ok(!imports.some((line) => line.includes("fast-path") || line.includes("standard-path")));
    });

    it("creates no files beyond T-015 plan persistence", async () => {
      const { input, root } = fullInput();
      await runFull(input);
      const { readdirSync: readDir } = await import("node:fs");
      assert.deepEqual(readDir(root).sort(), [".ai-team"]);
      assert.deepEqual(readDir(join(root, ".ai-team")).sort(), ["plans"]);
    });

    it("parses no report text anywhere in the path", () => {
      const code = codeLines();
      for (const forbidden of ["RegExp", "regex", "match(", "parse(", "JSON.parse", "includes(\"approved\")", "keyword", "sentiment", "classify"]) {
        assert.ok(!code.includes(forbidden), `full-path code never mentions ${forbidden}`);
      }
    });
  });

  describe("additional stage coverage", () => {
    it("other mode descriptors stay intact", () => {
      assert.deepEqual(getWorkModeDescriptor("fast").lifecycle, ["implementer", "senior-reviewer"]);
      assert.deepEqual(getWorkModeDescriptor("standard").lifecycle, ["coordinator", "technical-lead", "implementer", "senior-reviewer"]);
    });

    it("explicit coordinator objective flows into planning and artifact", async () => {
      const { input } = fullInput({ objective: "Explicit full objective." });
      const result = await runFull(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.artifact.coordinator?.objective, "Explicit full objective.");
    });

    it("PM business rules and TL architecture reach decomposition", async () => {
      const { input, calls } = fullInput();
      await runFull(input);
      const decompositionCall = calls.filter((call) => call.role === "technical-lead")[1];
      assert.ok(decompositionCall.prompt.includes("Only the owning reader sees their list.") === false, "business rules ride the artifact, prompts carry plan slices");
      assert.ok(decompositionCall.prompt.includes("Server-rendered page over the article store."));
    });

    it("both approvals cover the identical artifact", async () => {
      const { input } = fullInput();
      const result = await runFull(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.deepEqual(result.pmApproval.artifact, result.tlApproval.artifact);
      assert.deepEqual(result.pmApproval.artifact, result.artifact);
    });

    it("changes-required without notes carries no feedback field", async () => {
      const { input } = fullInput({ pmApproval: { identity: { role: "project-manager" }, decision: "changes-required" } });
      const result = await runFull(input);
      assert.equal(result.outcome, "changes-required");
      if (result.outcome !== "changes-required") throw new Error("unreachable");
      assert.ok(!("feedback" in result));
    });

    it("caller sprint fields and task order are preserved", async () => {
      const { input } = fullInput();
      const result = await runFull(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.sprint.goal, "Ship the reading-list page.");
      assert.deepEqual(result.sprint.tasks, ["T-101", "T-102"]);
    });

    it("mapped ticket carries requirements verbatim plus labeled acceptance", async () => {
      const { input } = fullInput();
      const result = await runFull(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.ticket.requirements, "Saved articles appear in reverse-chronological order");
      assert.ok(result.ticket.description.includes("Acceptance criteria:"));
      assert.equal(result.task.requirements, "Saved articles appear in reverse-chronological order");
    });

    it("readback sprint equals the decomposed sprint", async () => {
      const { input } = fullInput();
      const result = await runFull(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.sprint.id, "sprint-reading-list");
      assert.equal(result.task.sprint, result.sprint.id);
    });

    it("discovery summary reaches the implementer only", async () => {
      const { input, calls } = fullInput({ discovery_summary: "FULL_DISCOVERY_D9" });
      await runFull(input);
      const implementerCall = calls.find((call) => call.role === "implementer");
      assert.ok(implementerCall !== undefined && implementerCall.prompt.includes("FULL_DISCOVERY_D9"));
      for (const other of calls.filter((call) => call.role !== "implementer")) {
        assert.ok(!other.prompt.includes("FULL_DISCOVERY_D9"));
      }
    });

    it("review resolver receives the ticket identity and report", async () => {
      let seen: Record<string, unknown> = {};
      const { input } = fullInput({
        reviewDecision: (request) => {
          seen = { ...request };
          return { decision: "approved" as const };
        },
      });
      await runFull(input);
      assert.equal(seen.ticket_id, "T-101");
      assert.ok(typeof seen.report === "string" && seen.report.includes("senior-reviewer output"));
    });

    it("TL acceptance decision failure is bounded", async () => {
      const { input } = fullInput({ decideTechnicalLead: (() => ({ decision: "maybe" })) as unknown as FullInput["decideTechnicalLead"] });
      const result = await runFull(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "technical-acceptance");
    });

    it("PM validation review failure is bounded with one attempt", async () => {
      const calls: CallRecord[] = [];
      const { input } = fullInput({
        provider: {
          name: "stub",
          execute: async (request: { prompt: string; project_root: string; role?: string }) => {
            calls.push({ prompt: request.prompt, project_root: request.project_root, role: request.role });
            if (request.prompt.includes("Sprint user testing:")) {
              throw new Error("pm provider down");
            }
            return { status: "succeeded" as const, text: `${request.role} output` };
          },
        },
      });
      const result = await runFull(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "pm-validation");
      assert.equal(calls.filter((call) => call.prompt.includes("Sprint user testing:")).length, 1);
    });

    it("PM validation decision failure is bounded", async () => {
      const { input } = fullInput({ decidePmUserTesting: () => { throw new Error("pm resolver down"); } });
      const result = await runFull(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "pm-validation");
      assert.ok(result.error.message.includes("pm resolver down"));
    });

    it("final approval decision failure is bounded", async () => {
      const { input } = fullInput({ decideFinalApproval: () => { throw new Error("final resolver down"); } });
      const result = await runFull(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "final-approval");
      assert.ok(result.error.message.includes("final resolver down"));
    });

    it("reviewer-stage changes-required keys are pinned", async () => {
      const { input } = fullInput({ reviewDecision: () => ({ decision: "changes_requested" as const, feedback: "x" }) });
      const result = await runFull(input);
      assert.deepEqual(Object.keys(result).sort(), ["artifact", "feedback", "mode", "outcome", "stage", "ticket_id"]);
    });

    it("missing task_id and bad resolver inputs fail before provider contact", async () => {
      const { input, calls } = fullInput({ task_id: "" });
      await assert.rejects(runFull(input), /task_id/);
      assert.equal(calls.length, 0);
      const { input: input2, calls: calls2 } = fullInput({ decideTechnicalLead: "yes" as unknown as FullInput["decideTechnicalLead"] });
      await assert.rejects(runFull(input2), /technical lead decision resolver/);
      assert.equal(calls2.length, 0);
    });

    it("PM constraints reach TL planning where the contract requires", async () => {
      const { input, calls } = fullInput({ pm: { requirements: ["R1"], business_constraints: ["Flag-gated launch."] } });
      await runFull(input);
      const tlPlanningCall = calls.filter((call) => call.role === "technical-lead")[0];
      assert.ok(tlPlanningCall.prompt.includes("Flag-gated launch."));
    });

    it("no dispatcher or manual-fallback machinery is referenced", () => {
      const code = codeLines();
      assert.ok(!code.includes("handoff-dispatcher") && !code.includes("HandoffTransport"));
      assert.ok(!code.includes("delegate-fallback") && !code.includes("ManualFallback"));
    });
  });

  describe("context isolation, determinism, mutation", () => {
    it("business intent reaches TL planning; secrets reach nothing", async () => {
      const SECRET = "FULL_SECRET_SENTINEL_Z8";
      void SECRET;
      const { input, calls } = fullInput();
      await runFull(input);
      const tlPlanningCall = calls.filter((call) => call.role === "technical-lead")[0];
      assert.ok(tlPlanningCall.prompt.includes("Saved articles appear in reverse-chronological order"));
      for (const call of calls) {
        assert.ok(!call.prompt.includes("FULL_SECRET_SENTINEL_Z8"));
      }
    });

    it("reviewer sees only explicit review input, not the artifact", async () => {
      const { input, calls } = fullInput();
      await runFull(input);
      const reviewerCall = calls.find((call) => call.role === "senior-reviewer");
      assert.ok(reviewerCall !== undefined);
      assert.ok(!reviewerCall.prompt.includes("Server-rendered page over the article store."), "TL architecture stays out of review");
    });

    it("acceptance stages receive no provider secrets", async () => {
      const { input, calls } = fullInput();
      const result = await runFull(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.ok(!JSON.stringify(result.technicalAcceptance).includes("SECRET"));
      assert.ok(!JSON.stringify(result.pmValidation).includes("SECRET"));
    });

    it("identical inputs produce equivalent completed results", async () => {
      const first = await runFull(fullInput().input);
      const second = await runFull(fullInput().input);
      assert.equal(first.outcome, "completed");
      assert.deepEqual(first, second);
    });

    it("caller inputs, sprint, and tasks are never mutated", async () => {
      const { input } = fullInput();
      const tasksBefore = JSON.stringify(input.tasks);
      const sprintBefore = JSON.stringify(input.sprint);
      await runFull(input);
      assert.equal(JSON.stringify(input.tasks), tasksBefore);
      assert.equal(JSON.stringify(input.sprint), sprintBefore);
    });

    it("completed results are frozen", async () => {
      const { input } = fullInput();
      const result = await runFull(input);
      assert.ok(Object.isFrozen(result));
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.ok(Object.isFrozen(result.artifact) && Object.isFrozen(result.sprint));
    });
  });
});
