import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTlImplementerReworkHandoff, TlReworkHandoffInput } from "../src/runtime/tl-implementer-rework-handoff";
import { validateAgentHandoff, renderAgentHandoff } from "../src/roles/handoff-validation";
import { parseAgentHandoffText } from "../src/roles/handoff-parser";

// TL → Implementer rework handoff tests (M28 T-033): a valid
// Technical Lead correction reference becomes a canonical
// handoff. Creation only: no dispatch, execution, or re-entry.
// Hermetic and provider-free throughout.

const REWORK_SOURCE = join(__dirname, "..", "..", "src", "runtime", "tl-implementer-rework-handoff.ts");

function codeLines(): string {
  return readFileSync(REWORK_SOURCE, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/**") && !trimmed.startsWith("*/");
    })
    .join("\n");
}

function tlCorrection(overrides: Record<string, unknown> = {}): TlReworkHandoffInput {
  return {
    correction: {
      origin: "technical-lead",
      ticketIds: ["T-101"],
      feedback: "Harden the render path: rows must sort newest first.",
      action: { description: "Revise the T-101 implementation per the TL correction.", ticketId: "T-101" },
      ...overrides,
    },
  };
}

describe("TL to Implementer rework handoff (M28 T-033)", () => {
  describe("construction", () => {
    it("creates a canonical technical-lead to implementer handoff", () => {
      const handoff = createTlImplementerReworkHandoff(tlCorrection());
      assert.equal(handoff.from, "technical-lead");
      assert.equal(handoff.to, "implementer");
      assert.equal(handoff.objective, "Revise the T-101 implementation per the TL correction.");
    });

    it("passes the existing handoff validator, including direction approval", () => {
      const handoff = createTlImplementerReworkHandoff(tlCorrection());
      assert.deepEqual(validateAgentHandoff(handoff), handoff);
    });

    it("rejects every non-TL origin without reinterpretation", () => {
      for (const origin of ["reviewer", "project-manager", "final-approval", "planning-approval"]) {
        assert.throws(() => createTlImplementerReworkHandoff(tlCorrection({ origin })), /requires a technical-lead correction/);
      }
    });

    it("rejects malformed corrections before reading fields", () => {
      assert.throws(() => createTlImplementerReworkHandoff(null as unknown as TlReworkHandoffInput), /input object/);
      assert.throws(() => createTlImplementerReworkHandoff(tlCorrection({ origin: "implementer" })), /origin must be one of/);
      assert.throws(() => createTlImplementerReworkHandoff(tlCorrection({ feedback: "" })), /feedback/);
      assert.throws(() => createTlImplementerReworkHandoff(tlCorrection({ ticketIds: [] })), /ticketIds/);
    });
  });

  describe("preservation without invention", () => {
    it("keeps feedback byte-identical in notes", () => {
      const feedback = "  Sort rows newest-first.\n\nUnicode ✓ “quoted” (100%)  \n\tIndented.";
      const handoff = createTlImplementerReworkHandoff(tlCorrection({ feedback }));
      assert.equal(handoff.notes, feedback);
    });

    it("preserves every ticket id without selection or truncation", () => {
      const handoff = createTlImplementerReworkHandoff(
        tlCorrection({ ticketIds: ["T-3", "T-1", "T-2"], action: { description: "Rework all three." } }),
      );
      assert.deepEqual(handoff.artifacts, ["T-3", "T-1", "T-2"]);
    });

    it("carries an action ticket outside the correction set without duplicating shared ones", () => {
      const shared = createTlImplementerReworkHandoff(
        tlCorrection({ ticketIds: ["T-1"], action: { description: "Rework T-1.", ticketId: "T-1" } }),
      );
      assert.deepEqual(shared.artifacts, ["T-1"]);
      const external = createTlImplementerReworkHandoff(
        tlCorrection({ ticketIds: ["T-1"], action: { description: "Apply the fix in T-9.", ticketId: "T-9" } }),
      );
      assert.deepEqual(external.artifacts, ["T-1", "T-9"]);
    });

    it("invents no requirements, criteria, constraints, context, or next action", () => {
      const handoff = createTlImplementerReworkHandoff(
        tlCorrection({ feedback: "Requirement: sort rows.\nAcceptance criteria:\n1. Sorted.\nConstraint: no new tables." }),
      );
      assert.equal(handoff.requirements, undefined);
      assert.equal(handoff.acceptance_criteria, undefined);
      assert.equal(handoff.constraints, undefined);
      assert.equal(handoff.context, undefined);
      assert.equal(handoff.next_action, undefined);
      assert.ok(handoff.notes !== undefined && handoff.notes.includes("Requirement: sort rows."));
    });

    it("never paraphrases feedback or identifiers", () => {
      const handoff = createTlImplementerReworkHandoff(tlCorrection());
      assert.ok(handoff.notes !== undefined && !handoff.notes.includes("Delegated"));
      assert.deepEqual(handoff.artifacts, ["T-101"]);
    });
  });

  describe("manual compatibility, purity, stability", () => {
    it("renders with the existing renderer and resumes through the existing parser", () => {
      const handoff = createTlImplementerReworkHandoff(tlCorrection());
      const resumed = validateAgentHandoff(parseAgentHandoffText(renderAgentHandoff(handoff)));
      assert.deepEqual(resumed, handoff);
    });

    it("never mutates caller inputs", () => {
      const input = tlCorrection();
      const snapshot = JSON.stringify(input);
      createTlImplementerReworkHandoff(input);
      assert.equal(JSON.stringify(input), snapshot);
    });

    it("equivalent inputs produce equivalent frozen handoffs", () => {
      const first = createTlImplementerReworkHandoff(tlCorrection());
      const second = createTlImplementerReworkHandoff(tlCorrection());
      assert.deepEqual(first, second);
      assert.ok(Object.isFrozen(first) && Object.isFrozen(first.artifacts));
    });
  });

  describe("boundaries", () => {
    it("performs no execution, dispatch, persistence, retry, re-entry, or orchestration", async () => {
      const root = mkdtempSync(join(tmpdir(), "t033-"));
      const before = readdirSync(root);
      createTlImplementerReworkHandoff(tlCorrection());
      assert.deepEqual(readdirSync(root), before);
      const code = codeLines();
      for (const forbidden of ["node:", "Provider", "provider", "dispatch", "delegate", "execute", "Execute", "persist", "writeFile", "readFile", "configure", "spawn", "fetch(", "independent-execution", "status", "State", "transition", "Transition", "retry", "fallback", "reentry", "re-enter", "orchestrat", "Reentry", "rework loop", "handoff-dispatcher", "T-034", "T-035", "T-036", "M29", "pm-tl", "PmTl", "final-approval", "FinalApproval", "CLI", "cli"]) {
        assert.ok(!code.includes(forbidden), `rework code never mentions ${forbidden}`);
      }
      const imports = readFileSync(REWORK_SOURCE, "utf8")
        .split("\n")
        .filter((line) => line.trim().startsWith("import "));
      assert.deepEqual(imports, [
        'import { AgentHandoff } from "../roles/handoff";',
        'import { validateAgentHandoff } from "../roles/handoff-validation";',
        'import { validateCorrectionReference, CorrectionReference } from "./correction-reference";',
      ]);
    });

    it("leaves CorrectionReference and AgentHandoff contracts unchanged", () => {
      for (const file of ["src/runtime/correction-reference.ts", "src/roles/handoff.ts", "src/roles/handoff-validation.ts", "src/roles/operating-model.ts"]) {
        const code = readFileSync(join(__dirname, "..", "..", file), "utf8");
        assert.ok(!code.includes("tl-implementer-rework") && !code.includes("ReworkHandoff"), `${file} unchanged by T-033`);
      }
      assert.throws(() => validateAgentHandoff({ from: "implementer", to: "project-manager", objective: "Skip" }), /unsupported handoff direction/);
    });
  });
});
