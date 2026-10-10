import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFinalApprovalReentryHandoff, FinalApprovalReentryHandoffInput } from "../src/runtime/final-approval-reentry-handoff";
import { validateAgentHandoff, renderAgentHandoff } from "../src/roles/handoff-validation";
import { parseAgentHandoffText } from "../src/roles/handoff-parser";

// Final approval re-entry handoff tests (M28 T-035): a valid
// final-approval correction plus an explicit destination
// becomes a canonical handoff. Creation only: no execution,
// no re-entry workflow, no general re-entry contract.
// Hermetic and provider-free throughout.

const REENTRY_SOURCE = join(__dirname, "..", "..", "src", "runtime", "final-approval-reentry-handoff.ts");

function codeLines(): string {
  return readFileSync(REENTRY_SOURCE, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/**") && !trimmed.startsWith("*/");
    })
    .join("\n");
}

function finalCorrection(overrides: Record<string, unknown> = {}): FinalApprovalReentryHandoffInput {
  return {
    correction: {
      origin: "final-approval",
      ticketIds: ["T-101"],
      feedback: "Hold for launch: the list must hide archived articles first.",
      action: { description: "Return T-101 for rework before launch.", ticketId: "T-101" },
      ...overrides,
    },
    to: "project-manager",
  };
}

describe("final approval re-entry handoff (M28 T-035)", () => {
  describe("construction", () => {
    it("creates a canonical coordinator handoff to the explicit destination", () => {
      const handoff = createFinalApprovalReentryHandoff(finalCorrection());
      assert.equal(handoff.from, "coordinator");
      assert.equal(handoff.to, "project-manager");
      assert.equal(handoff.objective, "Return T-101 for rework before launch.");
    });

    it("preserves a valid technical-lead destination exactly", () => {
      const handoff = createFinalApprovalReentryHandoff({ ...finalCorrection(), to: "technical-lead" });
      assert.equal(handoff.from, "coordinator");
      assert.equal(handoff.to, "technical-lead");
    });

    it("passes the existing handoff validator, including direction approval", () => {
      for (const to of ["project-manager", "technical-lead"] as const) {
        const handoff = createFinalApprovalReentryHandoff({ ...finalCorrection(), to });
        assert.deepEqual(validateAgentHandoff(handoff), handoff);
      }
    });

    it("rejects every non-final-approval origin without reinterpretation", () => {
      for (const origin of ["reviewer", "technical-lead", "project-manager", "planning-approval"]) {
        const input = finalCorrection({ origin });
        assert.throws(() => createFinalApprovalReentryHandoff(input), /requires a final-approval correction/);
      }
    });

    it("rejects malformed corrections before reading fields", () => {
      assert.throws(() => createFinalApprovalReentryHandoff(null as unknown as FinalApprovalReentryHandoffInput), /input object/);
      assert.throws(() => createFinalApprovalReentryHandoff(finalCorrection({ origin: "coordinator" })), /origin must be one of/);
      assert.throws(() => createFinalApprovalReentryHandoff(finalCorrection({ feedback: "" })), /feedback/);
      assert.throws(() => createFinalApprovalReentryHandoff(finalCorrection({ action: {} })), /action/);
    });
  });

  describe("explicit destination", () => {
    it("a missing destination fails instead of guessing", () => {
      const { to, ...withoutDestination } = finalCorrection();
      void to;
      assert.throws(() => createFinalApprovalReentryHandoff(withoutDestination as unknown as FinalApprovalReentryHandoffInput), /destination role is required/);
      assert.throws(() => createFinalApprovalReentryHandoff({ ...finalCorrection(), to: undefined }), /destination role is required/);
    });

    it("unsupported pairs are rejected by the existing validator, never retargeted", () => {
      for (const to of ["implementer", "senior-reviewer", "coordinator", "human", "pm", ""]) {
        assert.throws(() => createFinalApprovalReentryHandoff({ ...finalCorrection(), to }), /./, `destination ${JSON.stringify(to)} rejected`);
      }
    });

    it("never promotes or defaults the destination", () => {
      const pm = createFinalApprovalReentryHandoff({ ...finalCorrection(), to: "project-manager" });
      const tl = createFinalApprovalReentryHandoff({ ...finalCorrection(), to: "technical-lead" });
      assert.equal(pm.to, "project-manager");
      assert.equal(tl.to, "technical-lead");
      assert.ok(pm.objective === tl.objective, "same correction, caller-chosen destination only");
    });
  });

  describe("preservation without invention", () => {
    it("keeps feedback byte-identical in notes", () => {
      const feedback = "  Hold for launch.\n\nUnicode ✓ “quoted” (100%)  \n\tIndented.";
      const handoff = createFinalApprovalReentryHandoff(finalCorrection({ feedback }));
      assert.equal(handoff.notes, feedback);
    });

    it("preserves every ticket id in order", () => {
      const handoff = createFinalApprovalReentryHandoff(
        finalCorrection({ ticketIds: ["T-3", "T-1"], action: { description: "Rework both." } }),
      );
      assert.deepEqual(handoff.artifacts, ["T-3", "T-1"]);
    });

    it("handles the optional action ticketId per T-033/T-034 semantics", () => {
      const shared = createFinalApprovalReentryHandoff(
        finalCorrection({ ticketIds: ["T-1"], action: { description: "Rework T-1.", ticketId: "T-1" } }),
      );
      assert.deepEqual(shared.artifacts, ["T-1"]);
      const external = createFinalApprovalReentryHandoff(
        finalCorrection({ ticketIds: ["T-1"], action: { description: "Fold the fix into T-9.", ticketId: "T-9" } }),
      );
      assert.deepEqual(external.artifacts, ["T-1", "T-9"]);
    });

    it("invents no requirements, criteria, constraints, context, or next action", () => {
      const handoff = createFinalApprovalReentryHandoff(
        finalCorrection({ feedback: "Requirement: hide archived.\nAcceptance criteria:\n1. Hidden." }),
      );
      assert.equal(handoff.requirements, undefined);
      assert.equal(handoff.acceptance_criteria, undefined);
      assert.equal(handoff.constraints, undefined);
      assert.equal(handoff.context, undefined);
      assert.equal(handoff.next_action, undefined);
      assert.ok(handoff.notes !== undefined && handoff.notes.includes("Requirement: hide archived."));
    });
  });

  describe("manual compatibility, purity, stability", () => {
    it("renders, parses, and revalidates through the existing grammar", () => {
      for (const to of ["project-manager", "technical-lead"] as const) {
        const handoff = createFinalApprovalReentryHandoff({ ...finalCorrection(), to });
        const resumed = validateAgentHandoff(parseAgentHandoffText(renderAgentHandoff(handoff)));
        assert.deepEqual(resumed, handoff);
      }
    });

    it("never mutates caller inputs", () => {
      const input = finalCorrection();
      const snapshot = JSON.stringify(input);
      createFinalApprovalReentryHandoff(input);
      assert.equal(JSON.stringify(input), snapshot);
    });

    it("equivalent inputs produce equivalent frozen handoffs", () => {
      const first = createFinalApprovalReentryHandoff(finalCorrection());
      const second = createFinalApprovalReentryHandoff(finalCorrection());
      assert.deepEqual(first, second);
      assert.ok(Object.isFrozen(first) && Object.isFrozen(first.artifacts));
    });
  });

  describe("boundaries", () => {
    it("performs no execution, dispatch, persistence, retry, re-entry, or orchestration", async () => {
      const root = mkdtempSync(join(tmpdir(), "t035-"));
      const before = readdirSync(root);
      createFinalApprovalReentryHandoff(finalCorrection());
      assert.deepEqual(readdirSync(root), before);
      const code = codeLines();
      for (const forbidden of ["node:", "Provider", "provider", "dispatch", "delegate", "execute", "Execute", "persist", "writeFile", "readFile", "configure", "spawn", "fetch(", "independent-execution", "status", "State", "transition", "Transition", "retry", "loop", "Loop", "fallback", "reentry", "re-enter", "orchestrat", "handoff-dispatcher", "T-036", "M29", "final-approval run", "runFinalApproval", "decideFinalApproval", "CLI", "cli"]) {
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

    it("leaves correction, handoff, operating-model, and final-approval contracts unchanged", () => {
      for (const file of ["src/runtime/correction-reference.ts", "src/roles/handoff.ts", "src/roles/handoff-validation.ts", "src/roles/operating-model.ts", "src/runtime/final-approval.ts", "src/runtime/tl-implementer-rework-handoff.ts", "src/runtime/pm-tl-reentry-handoff.ts"]) {
        const code = readFileSync(join(__dirname, "..", "..", file), "utf8");
        assert.ok(!code.includes("final-approval-reentry") && !code.includes("FinalApprovalReentry"), `${file} unchanged by T-035`);
      }
      assert.throws(() => validateAgentHandoff({ from: "coordinator", to: "senior-reviewer", objective: "Skip" }), /unsupported handoff direction/);
    });
  });
});
