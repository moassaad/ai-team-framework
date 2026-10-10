import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPmTlReentryHandoff, PmReentryHandoffInput } from "../src/runtime/pm-tl-reentry-handoff";
import { validateAgentHandoff, renderAgentHandoff } from "../src/roles/handoff-validation";
import { parseAgentHandoffText } from "../src/roles/handoff-parser";
import { runPmPlanning } from "../src/runtime/pm-planning";

// PM → TL re-entry handoff tests (M28 T-034): a valid
// PM-origin correction reference becomes a canonical
// re-entry handoff. Creation only: no TL execution, no
// looping, no general re-entry. Hermetic and provider-free.

const REENTRY_SOURCE = join(__dirname, "..", "..", "src", "runtime", "pm-tl-reentry-handoff.ts");

function codeLines(): string {
  return readFileSync(REENTRY_SOURCE, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/**") && !trimmed.startsWith("*/");
    })
    .join("\n");
}

function pmCorrection(overrides: Record<string, unknown> = {}): PmReentryHandoffInput {
  return {
    correction: {
      origin: "project-manager",
      ticketIds: ["T-101"],
      feedback: "Scope gap: the list must exclude archived articles.",
      action: { description: "Return T-101 to technical planning with the narrowed scope.", ticketId: "T-101" },
      ...overrides,
    },
  };
}

describe("PM to TL re-entry handoff (M28 T-034)", () => {
  describe("construction", () => {
    it("creates a canonical project-manager to technical-lead handoff", () => {
      const handoff = createPmTlReentryHandoff(pmCorrection());
      assert.equal(handoff.from, "project-manager");
      assert.equal(handoff.to, "technical-lead");
      assert.equal(handoff.objective, "Return T-101 to technical planning with the narrowed scope.");
    });

    it("passes the existing handoff validator, including direction approval", () => {
      const handoff = createPmTlReentryHandoff(pmCorrection());
      assert.deepEqual(validateAgentHandoff(handoff), handoff);
    });

    it("rejects every non-PM origin without reinterpretation", () => {
      for (const origin of ["reviewer", "technical-lead", "final-approval", "planning-approval"]) {
        assert.throws(() => createPmTlReentryHandoff(pmCorrection({ origin })), /requires a project-manager correction/);
      }
    });

    it("rejects malformed corrections before reading fields", () => {
      assert.throws(() => createPmTlReentryHandoff(null as unknown as PmReentryHandoffInput), /input object/);
      assert.throws(() => createPmTlReentryHandoff(pmCorrection({ origin: "implementer" })), /origin must be one of/);
      assert.throws(() => createPmTlReentryHandoff(pmCorrection({ feedback: "" })), /feedback/);
      assert.throws(() => createPmTlReentryHandoff(pmCorrection({ action: {} })), /action/);
    });

    it("differs structurally from the PM to TL planning handoff", async () => {
      const calls: { prompt: string }[] = [];
      const planning = await runPmPlanning({
        identity: { role: "project-manager" },
        coordinator_handoff: { from: "coordinator", to: "project-manager", objective: "Plan the list" },
        requirements: ["R1"],
        acceptance_criteria: ["A1"],
        project_root: "/proj",
        provider: {
          name: "stub",
          execute: async (request: { prompt: string }) => {
            calls.push({ prompt: request.prompt });
            return { status: "succeeded" as const, text: "ok" };
          },
        },
        timeout_ms: 1000,
      });
      if (planning.outcome !== "completed") throw new Error("unreachable");
      const reentry = createPmTlReentryHandoff(pmCorrection());
      assert.ok(planning.handoff.requirements !== undefined && planning.handoff.requirements.length > 0, "planning carries structured business requirements");
      assert.equal(reentry.requirements, undefined, "re-entry carries none: feedback stays in notes");
      assert.ok(reentry.notes !== undefined && planning.handoff.notes === undefined, "notes mark the correction, not the plan");
      assert.ok(calls.length === 1, "planning comparison used one provider call; re-entry uses none");
    });
  });

  describe("preservation without invention", () => {
    it("keeps feedback byte-identical in notes", () => {
      const feedback = "  Archived rows must go.\n\nUnicode ✓ “quoted” (100%)  \n\tIndented.";
      const handoff = createPmTlReentryHandoff(pmCorrection({ feedback }));
      assert.equal(handoff.notes, feedback);
    });

    it("preserves every ticket id without selection or truncation", () => {
      const handoff = createPmTlReentryHandoff(
        pmCorrection({ ticketIds: ["T-3", "T-1"], action: { description: "Replan both." } }),
      );
      assert.deepEqual(handoff.artifacts, ["T-3", "T-1"]);
    });

    it("handles the optional action ticketId per T-032/T-033 semantics", () => {
      const shared = createPmTlReentryHandoff(
        pmCorrection({ ticketIds: ["T-1"], action: { description: "Rework T-1.", ticketId: "T-1" } }),
      );
      assert.deepEqual(shared.artifacts, ["T-1"]);
      const external = createPmTlReentryHandoff(
        pmCorrection({ ticketIds: ["T-1"], action: { description: "Fold the fix into T-9.", ticketId: "T-9" } }),
      );
      assert.deepEqual(external.artifacts, ["T-1", "T-9"]);
      const absent = createPmTlReentryHandoff(
        pmCorrection({ ticketIds: ["T-1"], action: { description: "Replan." } }),
      );
      assert.deepEqual(absent.artifacts, ["T-1"]);
    });

    it("invents no requirements, criteria, constraints, context, or next action", () => {
      const handoff = createPmTlReentryHandoff(
        pmCorrection({ feedback: "Requirement: exclude archived.\nAcceptance criteria:\n1. Excluded." }),
      );
      assert.equal(handoff.requirements, undefined);
      assert.equal(handoff.acceptance_criteria, undefined);
      assert.equal(handoff.constraints, undefined);
      assert.equal(handoff.context, undefined);
      assert.equal(handoff.next_action, undefined);
      assert.ok(handoff.notes !== undefined && handoff.notes.includes("Requirement: exclude archived."));
    });
  });

  describe("manual compatibility, purity, stability", () => {
    it("renders with the existing renderer and resumes through the existing parser", () => {
      const handoff = createPmTlReentryHandoff(pmCorrection());
      const resumed = validateAgentHandoff(parseAgentHandoffText(renderAgentHandoff(handoff)));
      assert.deepEqual(resumed, handoff);
    });

    it("never mutates caller inputs", () => {
      const input = pmCorrection();
      const snapshot = JSON.stringify(input);
      createPmTlReentryHandoff(input);
      assert.equal(JSON.stringify(input), snapshot);
    });

    it("equivalent inputs produce equivalent frozen handoffs", () => {
      const first = createPmTlReentryHandoff(pmCorrection());
      const second = createPmTlReentryHandoff(pmCorrection());
      assert.deepEqual(first, second);
      assert.ok(Object.isFrozen(first) && Object.isFrozen(first.artifacts));
    });
  });

  describe("boundaries", () => {
    it("performs no execution, dispatch, persistence, retry, looping, or orchestration", async () => {
      const root = mkdtempSync(join(tmpdir(), "t034-"));
      const before = readdirSync(root);
      createPmTlReentryHandoff(pmCorrection());
      assert.deepEqual(readdirSync(root), before);
      const code = codeLines();
      for (const forbidden of ["node:", "Provider", "provider", "dispatch", "delegate", "execute", "Execute", "persist", "writeFile", "readFile", "configure", "spawn", "fetch(", "independent-execution", "status", "State", "transition", "Transition", "retry", "loop", "Loop", "fallback", "reentry", "re-enter", "orchestrat", "handoff-dispatcher", "T-035", "T-036", "M29", "final-approval", "FinalApproval", "CLI", "cli"]) {
        assert.ok(!code.includes(forbidden), `re-entry code never mentions ${forbidden}`);
      }
      const imports = readFileSync(REENTRY_SOURCE, "utf8")
        .split("\n")
        .filter((line) => line.trim().startsWith("import "));
      assert.deepEqual(imports, [
        'import { AgentHandoff } from "../roles/handoff";',
        'import { validateAgentHandoff } from "../roles/handoff-validation";',
        'import { validateCorrectionReference, CorrectionReference } from "./correction-reference";',
      ]);
    });

    it("leaves correction, handoff, operating-model, and PM contracts unchanged", () => {
      for (const file of ["src/runtime/correction-reference.ts", "src/roles/handoff.ts", "src/roles/handoff-validation.ts", "src/roles/operating-model.ts", "src/runtime/pm-planning.ts", "src/runtime/tl-implementer-rework-handoff.ts"]) {
        const code = readFileSync(join(__dirname, "..", "..", file), "utf8");
        assert.ok(!code.includes("pm-tl-reentry") && !code.includes("ReentryHandoff"), `${file} unchanged by T-034`);
      }
      assert.throws(() => validateAgentHandoff({ from: "project-manager", to: "implementer", objective: "Skip" }), /unsupported handoff direction/);
    });
  });
});
