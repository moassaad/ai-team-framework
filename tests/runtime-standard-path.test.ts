import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStandard, StandardInput } from "../src/runtime/standard-path";
import { getWorkModeDescriptor } from "../src/runtime/work-mode";

// STANDARD path tests (M27 T-028): coordinator planning once,
// TL evidence review once, implementer once, reviewer once,
// explicit decision once — then stop. No PM, sprints,
// approvals, persistence, retry, or re-entry. Hermetic.

const STANDARD_SOURCE = join(__dirname, "..", "..", "src", "runtime", "standard-path.ts");

function codeLines(): string {
  return readFileSync(STANDARD_SOURCE, "utf8")
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

function countingProvider(calls: CallRecord[], rejectRole?: string) {
  return {
    name: "stub",
    execute: async (request: { prompt: string; project_root: string; role?: string }) => {
      calls.push({ prompt: request.prompt, project_root: request.project_root, role: request.role });
      if (request.role === rejectRole) {
        throw new Error("provider boom");
      }
      return { status: "succeeded" as const, text: `${request.role ?? "unknown"} output` };
    },
  };
}

const TICKET = { id: "T-201", title: "Add request logging", description: "Log each request path and duration.", requirements: "Every request path is logged" };
const EVIDENCE = [{ id: "T-201", title: "Add request logging", description: "Log each request path and duration.", requirements: "Every request path is logged", state: "ready" as const }];

function standardInput(overrides: Partial<StandardInput> = {}, calls: CallRecord[] = [], rejectRole?: string): { input: StandardInput; calls: CallRecord[] } {
  return {
    calls,
    input: {
      mode: "standard",
      request: "Add request logging to the service.",
      ticket: { ...TICKET },
      tlEvidence: EVIDENCE.map((entry) => ({ ...entry })),
      specialty: "backend",
      project_root: "/proj",
      provider: countingProvider(calls, rejectRole),
      reviewDecision: () => ({ decision: "approved" as const }),
      timeout_ms: 1000,
      ...overrides,
    },
  };
}

describe("STANDARD path (M27 T-028)", () => {
  describe("mode contract", () => {
    it("accepts standard through the T-026 contract", async () => {
      const { input, calls } = standardInput();
      const result = await runStandard(input);
      assert.equal(result.outcome, "completed");
      assert.equal(result.mode, "standard");
      assert.equal(calls.length, 4);
    });

    it("rejects fast and full through runStandard", async () => {
      for (const mode of ["fast", "full"]) {
        const { input } = standardInput({ mode });
        await assert.rejects(runStandard(input), /standard mode only/);
      }
    });

    it("rejects invalid modes", async () => {
      for (const mode of ["turbo", "STANDARD", "", null]) {
        const { input } = standardInput({ mode: mode as unknown as string });
        await assert.rejects(runStandard(input), /work mode|standard mode only/);
      }
    });

    it("execution matches the T-026 standard descriptor", () => {
      const descriptor = getWorkModeDescriptor("standard");
      assert.deepEqual(descriptor.lifecycle, ["coordinator", "technical-lead", "implementer", "senior-reviewer"]);
      assert.equal(descriptor.planning, true);
      assert.equal(descriptor.sprints, false);
      assert.equal(descriptor.approvals, false);
    });
  });

  describe("role sequence", () => {
    it("runs coordinator, TL, implementer, reviewer in order exactly once each", async () => {
      const { input, calls } = standardInput();
      const result = await runStandard(input);
      assert.equal(result.outcome, "completed");
      assert.deepEqual(calls.map((call) => call.role), ["coordinator", "technical-lead", "implementer", "senior-reviewer"]);
    });

    it("carries all four structured role results", async () => {
      const { input } = standardInput();
      const result = await runStandard(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.ticket_id, "T-201");
      assert.equal(result.coordination.outcome, "completed");
      assert.equal(result.coordination.handoff.from, "coordinator");
      assert.equal(result.technicalLead.outcome, "completed");
      assert.equal(result.implementation.outcome, "completed");
      assert.equal(result.review.outcome, "completed");
      assert.deepEqual(Object.keys(result).sort(), ["coordination", "implementation", "mode", "outcome", "review", "technicalLead", "ticket_id"]);
    });

    it("never invokes a project-manager role", async () => {
      const { input, calls } = standardInput();
      await runStandard(input);
      assert.ok(calls.every((call) => call.role !== "project-manager"));
    });

    it("is deterministic for identical inputs", async () => {
      const first = await runStandard(standardInput().input);
      const second = await runStandard(standardInput().input);
      assert.deepEqual(first, second);
    });
  });

  describe("coordinator step", () => {
    it("interprets the user request through Coordinator Planning", async () => {
      const { input, calls } = standardInput();
      await runStandard(input);
      const coordinatorCall = calls.find((call) => call.role === "coordinator");
      assert.ok(coordinatorCall !== undefined && coordinatorCall.prompt.includes("Add request logging to the service."));
    });

    it("exposes the coordinator handoff as provenance without consuming it", async () => {
      const { input } = standardInput();
      const result = await runStandard(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.coordination.handoff.from, "coordinator");
      assert.equal(result.coordination.handoff.to, "project-manager", "never retargeted to TL");
    });

    it("coordinator failure stops the flow with no further calls", async () => {
      const { input, calls } = standardInput({}, [], "coordinator");
      const result = await runStandard(input);
      assert.equal(result.outcome, "failed");
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "coordinator");
      assert.equal(calls.length, 1);
    });

    it("coordinator report stays opaque and unused structurally", async () => {
      const { input, calls } = standardInput();
      const result = await runStandard(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.ok(result.coordination.report.includes("coordinator output"));
      for (const later of calls.filter((call) => call.role !== "coordinator")) {
        assert.ok(!later.prompt.includes("coordinator output"));
      }
    });
  });

  describe("technical lead step", () => {
    it("reviews caller-supplied evidence with an explicit TL identity", async () => {
      const { input, calls } = standardInput();
      await runStandard(input);
      const tlCall = calls.find((call) => call.role === "technical-lead");
      assert.ok(tlCall !== undefined && tlCall.prompt.includes("Add request logging"));
      assert.ok(tlCall.prompt.includes("[ready]"));
    });

    it("TL failure stops implementer and reviewer", async () => {
      const { input, calls } = standardInput({}, [], "technical-lead");
      const result = await runStandard(input);
      assert.equal(result.outcome, "failed");
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "technical-lead");
      assert.deepEqual(calls.map((call) => call.role), ["coordinator", "technical-lead"]);
    });

    it("malformed evidence is rejected by the TL seam", async () => {
      const { input, calls } = standardInput({ tlEvidence: [{ id: "T-9" }] as unknown as StandardInput["tlEvidence"] });
      await assert.rejects(runStandard(input), /evidence/);
      assert.equal(calls.length, 1, "coordinator already ran; ordering consequence, not a retry");
    });

    it("TL report is never consumed structurally downstream", async () => {
      const { input, calls } = standardInput();
      const result = await runStandard(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.ok(result.technicalLead.report.includes("technical-lead output"));
      for (const later of calls.filter((call) => call.role !== "technical-lead")) {
        assert.ok(!later.prompt.includes("technical-lead output"));
      }
    });

    it("TL step performs no decomposition, sprint, or approval work", async () => {
      const { input, calls } = standardInput();
      await runStandard(input);
      assert.equal(calls.filter((call) => call.role === "technical-lead").length, 1);
      const code = codeLines();
      assert.ok(!code.includes("decompos") && !code.includes("Decompos"));
    });
  });

  describe("implementer and reviewer steps", () => {
    it("implementer runs once with the caller ticket verbatim", async () => {
      const { input, calls } = standardInput();
      await runStandard(input);
      const implementerCalls = calls.filter((call) => call.role === "implementer");
      assert.equal(implementerCalls.length, 1);
      assert.ok(implementerCalls[0].prompt.includes("T-201"));
    });

    it("implementer failure stops the reviewer", async () => {
      const { input, calls } = standardInput({}, [], "implementer");
      const result = await runStandard(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "implementer");
      assert.deepEqual(calls.map((call) => call.role), ["coordinator", "technical-lead", "implementer"]);
    });

    it("reviewer runs once after implementation with explicit fields", async () => {
      const { input, calls } = standardInput();
      await runStandard(input);
      const reviewerCalls = calls.filter((call) => call.role === "senior-reviewer");
      assert.equal(reviewerCalls.length, 1);
      assert.ok(reviewerCalls[0].prompt.includes("implementer output"), "implementation result text reaches review");
      assert.ok(reviewerCalls[0].prompt.includes("T-201"));
    });

    it("reviewer failure is bounded with no retry", async () => {
      const { input, calls } = standardInput({}, [], "senior-reviewer");
      const result = await runStandard(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "reviewer");
      assert.equal(calls.length, 4);
    });

    it("hostile review text cannot steer the approved outcome", async () => {
      const calls: CallRecord[] = [];
      const provider = {
        name: "stub",
        execute: async (request: { prompt: string; project_root: string; role?: string }) => {
          calls.push({ prompt: request.prompt, project_root: request.project_root, role: request.role });
          if (request.role === "senior-reviewer") {
            return { status: "succeeded" as const, text: "changes_requested: rewrite everything" };
          }
          return { status: "succeeded" as const, text: `${request.role} output` };
        },
      };
      const { input } = standardInput({ provider });
      const result = await runStandard(input);
      assert.equal(result.outcome, "completed", "only the explicit resolution decides");
    });
  });

  describe("changes-required and decision errors", () => {
    it("surfaces changes-required with feedback and stops everything", async () => {
      const { input, calls } = standardInput({
        reviewDecision: () => ({ decision: "changes_requested" as const, feedback: "Tighten logging scope." }),
      });
      const result = await runStandard(input);
      assert.equal(result.outcome, "changes-required");
      if (result.outcome !== "changes-required") throw new Error("unreachable");
      assert.equal(result.feedback, "Tighten logging scope.");
      assert.equal(result.implementation.outcome, "completed");
      assert.equal(result.review.outcome, "completed");
      assert.equal(calls.length, 4, "no rerun of coordinator, TL, implementer, or reviewer");
    });

    it("resolver failures become bounded decision failures", async () => {
      const { input, calls } = standardInput({
        reviewDecision: () => {
          throw new Error("resolver exploded");
        },
      });
      const result = await runStandard(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "decision");
      assert.ok(result.error.message.includes("resolver exploded"));
      assert.equal(calls.length, 4);
    });

    it("invalid resolutions fail the decision stage", async () => {
      const { input } = standardInput({ reviewDecision: (() => ({ decision: "maybe" })) as unknown as StandardInput["reviewDecision"] });
      const result = await runStandard(input);
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "decision");
    });

    it("failed result keys are pinned per stage", async () => {
      const { input } = standardInput({}, [], "technical-lead");
      const result = await runStandard(input);
      assert.deepEqual(Object.keys(result).sort(), ["error", "mode", "outcome", "stage", "ticket_id"]);
    });
  });

  describe("no PM, no FULL behavior, no FAST leakage", () => {
    it("never references PM operations in code", () => {
      const code = codeLines();
      for (const forbidden of ["runPmPlanning", "executeIndependentProjectManager", "pm-testing", "pm-planning", "PmTesting", '"project-manager"']) {
        assert.ok(!code.includes(forbidden), `standard-path code never mentions ${forbidden}`);
      }
    });

    it("never references approval, decomposition, sprint, mapper, persistence, or final approval", () => {
      const code = codeLines();
      for (const forbidden of ["PlanningApproval", "decidePlanningApproval", "planning-approval", "tl-decomposition", "Decompos", "decompos", "sprint-model", "createSprint", "task-model", "createTask", "plan-ticket-mapper", "mapTaskToTicket", "task-persistence", "persistSprintPlan", "final-approval", "FinalApproval", "PM validation", "Technical acceptance"]) {
        assert.ok(!code.includes(forbidden), `standard-path code never mentions ${forbidden}`);
      }
    });

    it("creates no files and mutates no caller inputs", async () => {
      const root = mkdtempSync(join(tmpdir(), "t028-"));
      const before = readdirSync(root);
      const ticket = { ...TICKET };
      const evidence = EVIDENCE.map((entry) => ({ ...entry }));
      const { input } = standardInput({ ticket, tlEvidence: evidence });
      await runStandard(input);
      assert.deepEqual(readdirSync(root), before);
      assert.deepEqual(ticket, TICKET);
      assert.deepEqual(evidence, EVIDENCE);
    });

    it("coordinator and TL are genuinely included, never degraded to FAST", async () => {
      const { input, calls } = standardInput();
      await runStandard(input);
      assert.ok(calls.some((call) => call.role === "coordinator"));
      assert.ok(calls.some((call) => call.role === "technical-lead"));
      assert.equal(calls.length, 4);
    });

    it("uses the caller provider as-is with no selection or dispatch", async () => {
      const seen: Array<string | undefined> = [];
      const provider = {
        name: "custom",
        execute: async (request: { prompt: string; project_root: string; role?: string }) => {
          seen.push(request.role);
          return { status: "succeeded" as const, text: `${request.role} output` };
        },
      };
      const { input } = standardInput({ provider });
      const result = await runStandard(input);
      assert.equal(result.outcome, "completed");
      assert.deepEqual(seen, ["coordinator", "technical-lead", "implementer", "senior-reviewer"]);
    });
  });

  describe("handoff and context behavior", () => {
    it("coordinator handoff is provenance only: TL evidence comes from the caller", async () => {
      const { input, calls } = standardInput();
      const result = await runStandard(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      const tlCall = calls.find((call) => call.role === "technical-lead");
      assert.ok(tlCall !== undefined && tlCall.prompt.includes("Add request logging"));
      assert.equal(result.coordination.handoff.to, "project-manager");
    });

    it("no handoff is merged into implementer or reviewer inputs", async () => {
      const { input } = standardInput();
      const result = await runStandard(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.deepEqual(
        { id: result.implementation.ticket_id, title: TICKET.title, description: TICKET.description, requirements: TICKET.requirements },
        { id: "T-201", title: TICKET.title, description: TICKET.description, requirements: TICKET.requirements },
      );
      assert.ok(!("handoff" in result), "standard result carries role results, not handoffs");
    });

    it("required upstream context flows; secrets never enter prompts", async () => {
      const SECRET = "UPSTREAM_SECRET_SENTINEL_W4";
      void SECRET;
      const { input, calls } = standardInput({ context: "Logging context for the team." });
      await runStandard(input);
      const coordinatorCall = calls.find((call) => call.role === "coordinator");
      assert.ok(coordinatorCall !== undefined && coordinatorCall.prompt.includes("Logging context for the team."));
      for (const call of calls) {
        assert.ok(!call.prompt.includes("UPSTREAM_SECRET_SENTINEL_W4"));
      }
    });

    it("discovery summary reaches the implementer only", async () => {
      const { input, calls } = standardInput({ discovery_summary: "DISCOVERY_SENTINEL_D2" });
      await runStandard(input);
      const implementerCall = calls.find((call) => call.role === "implementer");
      assert.ok(implementerCall !== undefined && implementerCall.prompt.includes("DISCOVERY_SENTINEL_D2"));
      for (const other of calls.filter((call) => call.role !== "implementer")) {
        assert.ok(!other.prompt.includes("DISCOVERY_SENTINEL_D2"));
      }
    });

    it("results are frozen", async () => {
      const { input } = standardInput();
      const result = await runStandard(input);
      assert.ok(Object.isFrozen(result));
    });
  });

  describe("additional coverage", () => {
    it("caller requirements and constraints reach coordinator planning", async () => {
      const { input, calls } = standardInput({ requirements: ["Log every path"], constraints: ["No new services"] });
      await runStandard(input);
      const coordinatorCall = calls.find((call) => call.role === "coordinator");
      assert.ok(coordinatorCall !== undefined && coordinatorCall.prompt.includes("Log every path"));
      assert.ok(coordinatorCall.prompt.includes("No new services"));
    });

    it("coordinator handoff objective and requirements are preserved", async () => {
      const { input } = standardInput({ requirements: ["Log every path"] });
      const result = await runStandard(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.ok(result.coordination.handoff.objective.length > 0);
      assert.deepEqual(result.coordination.handoff.requirements, ["Log every path"]);
    });

    it("coordinator failed result keys are pinned", async () => {
      const { input } = standardInput({}, [], "coordinator");
      const result = await runStandard(input);
      assert.deepEqual(Object.keys(result).sort(), ["error", "mode", "outcome", "stage", "ticket_id"]);
    });

    it("multiple evidence entries keep order in the TL prompt", async () => {
      const evidence = [
        { id: "T-1", title: "First piece", description: "d1", requirements: "r1", state: "ready" as const },
        { id: "T-2", title: "Second piece", description: "d2", requirements: "r2", state: "ready" as const },
      ];
      const { input, calls } = standardInput({ tlEvidence: evidence });
      await runStandard(input);
      const tlCall = calls.find((call) => call.role === "technical-lead");
      assert.ok(tlCall !== undefined && tlCall.prompt.indexOf("First piece") < tlCall.prompt.indexOf("Second piece"));
    });

    it("TL failed result keys are pinned", async () => {
      const { input } = standardInput({}, [], "technical-lead");
      const result = await runStandard(input);
      assert.deepEqual(Object.keys(result).sort(), ["error", "mode", "outcome", "stage", "ticket_id"]);
    });

    it("TL completed report is preserved on the result", async () => {
      const { input } = standardInput();
      const result = await runStandard(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.technicalLead.report, "technical-lead output");
    });

    it("implementer input ticket equals the caller ticket", async () => {
      const { input } = standardInput();
      const result = await runStandard(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.implementation.ticket_id, TICKET.id);
      assert.equal(result.implementation.result.text, "implementer output");
    });

    it("resolver receives the review report verbatim", async () => {
      let seenReport = "";
      const { input } = standardInput({
        reviewDecision: (request) => {
          seenReport = request.report;
          return { decision: "approved" as const };
        },
      });
      await runStandard(input);
      assert.equal(seenReport, "senior-reviewer output");
    });

    it("approved and changes-required result keys are pinned", async () => {
      const { input } = standardInput();
      const approved = await runStandard(input);
      assert.deepEqual(Object.keys(approved).sort(), ["coordination", "implementation", "mode", "outcome", "review", "technicalLead", "ticket_id"]);
      const { input: input2 } = standardInput({ reviewDecision: () => ({ decision: "changes_requested" as const, feedback: "x" }) });
      const changes = await runStandard(input2);
      assert.deepEqual(Object.keys(changes).sort(), ["coordination", "feedback", "implementation", "mode", "outcome", "review", "technicalLead", "ticket_id"]);
    });

    it("null and malformed resolutions fail the decision stage", async () => {
      for (const resolution of [null, "approved", { decision: "approved", feedback: "extra" }]) {
        const { input } = standardInput({ reviewDecision: (() => resolution) as unknown as StandardInput["reviewDecision"] });
        const result = await runStandard(input);
        assert.equal(result.outcome, "failed");
        if (result.outcome !== "failed") throw new Error("unreachable");
        assert.equal(result.stage, "decision");
      }
    });

    it("missing and invalid modes fail before any provider contact", async () => {
      for (const mode of [undefined, null, 42]) {
        const { input, calls } = standardInput({ mode: mode as unknown as string });
        await assert.rejects(runStandard(input), /./);
        assert.equal(calls.length, 0);
      }
    });

    it("ticket title reaches coordinator, TL, implementer, and reviewer prompts", async () => {
      const { input, calls } = standardInput();
      await runStandard(input);
      const withTitle = calls.filter((call) => call.prompt.includes("Add request logging"));
      assert.ok(withTitle.length >= 3, "explicit ticket/evidence content, never merged reports");
    });

    it("results are frozen and T-026 descriptors stay intact", async () => {
      const { input } = standardInput();
      const result = await runStandard(input);
      assert.ok(Object.isFrozen(result));
      assert.deepEqual(getWorkModeDescriptor("standard").lifecycle, ["coordinator", "technical-lead", "implementer", "senior-reviewer"]);
      assert.equal(getWorkModeDescriptor("fast").planning, false);
      assert.equal(getWorkModeDescriptor("full").approvals, true);
    });

    it("completed implementation next_state stays reviewer-owned routing only", async () => {
      const { input } = standardInput();
      const result = await runStandard(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.implementation.next_state, "implementation_review");
      assert.equal(result.review.next_state, null);
    });

    it("explicit objective overrides the request as the planning objective", async () => {
      const { input } = standardInput({ objective: "Explicit logging objective." });
      const result = await runStandard(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.coordination.handoff.objective, "Explicit logging objective.");
    });
  });

  describe("scope pins", () => {
    it("is a dedicated runner with no generalized orchestrator", () => {
      const code = codeLines();
      for (const forbidden of ["runWorkMode", "ModeOrchestrator", "ModeEngine", "WorkflowModeManager", "runStandard(", "arbitrary", "dynamic", "graph"]) {
        if (forbidden === "runStandard(") {
          assert.ok(code.includes("export async function runStandard"), "exactly its own dedicated runner");
          continue;
        }
        assert.ok(!code.includes(forbidden), `standard-path code never mentions ${forbidden}`);
      }
    });

    it("adds no retry, fallback, modes, re-entry, persistence, or CLI", () => {
      const code = codeLines();
      for (const forbidden of ["retry", "fallback", "FAST", "STANDARD", "FULL", "reentry", "re-enter", "orchestrat", "persist", "writeFile", ".ai-team", "node:", "dispatch", "delegate", "recommend", "guardrail", "configure", "spawn"]) {
        assert.ok(!code.includes(forbidden), `standard-path code never mentions ${forbidden}`);
      }
    });

    it("imports only mode, planning, execution, decision, provider, and contract types", () => {
      const imports = readFileSync(STANDARD_SOURCE, "utf8")
        .split("\n")
        .filter((line) => line.trim().startsWith("import "));
      assert.deepEqual(imports, [
        'import { AgentProvider } from "../providers/agent";',
        'import { ExecutionResult } from "../providers/result";',
        'import { RoleId, ImplementerSpecialty } from "../roles/contract";',
        'import { validateWorkMode } from "./work-mode";',
        'import { runCoordinatorPlanning, CoordinatorPlanningCompleted } from "./coordinator-planning";',
        "import {",
        'import { TechnicalLeadCompleted, TechnicalLeadTicketEvidence } from "../execution/technical-lead";',
        'import { ImplementerCompleted } from "../execution/implementer";',
        'import { ReviewerCompleted } from "../execution/reviewer";',
        "import {",
      ]);
    });

    it("invalid envelopes fail before any provider contact", async () => {
      const { input, calls } = standardInput();
      await assert.rejects(runStandard(null as unknown as StandardInput), /standard input object/);
      await assert.rejects(runStandard({ ...input, reviewDecision: "yes" as unknown as StandardInput["reviewDecision"] }), /review decision resolver/);
      assert.equal(calls.length, 0);
    });
  });
});
