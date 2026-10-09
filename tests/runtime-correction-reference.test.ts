import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CORRECTION_ORIGINS,
  createCorrectionReference,
  isCorrectionOrigin,
  validateCorrectionReference,
  CorrectionReferenceInput,
} from "../src/runtime/correction-reference";

// Correction reference tests (M28 T-032): traceability from
// an existing correction outcome to explicit actionable work.
// Records only: no routing, execution, or re-entry. Pure and
// hermetic throughout.

const CORRECTION_SOURCE = join(__dirname, "..", "..", "src", "runtime", "correction-reference.ts");

function codeLines(): string {
  return readFileSync(CORRECTION_SOURCE, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/**") && !trimmed.startsWith("*/");
    })
    .join("\n");
}

function validInput(overrides: Partial<CorrectionReferenceInput> = {}): CorrectionReferenceInput {
  return {
    origin: "reviewer",
    ticketIds: ["T-101"],
    feedback: "Rework the render path: rows must sort newest first.",
    action: { description: "Revise the T-101 implementation per the reviewer feedback.", ticketId: "T-101" },
    ...overrides,
  };
}

describe("correction reference (M28 T-032)", () => {
  describe("representation", () => {
    it("represents a valid correction with source and actionable target", () => {
      const reference = createCorrectionReference(validInput());
      assert.equal(reference.origin, "reviewer");
      assert.deepEqual(reference.ticketIds, ["T-101"]);
      assert.equal(reference.feedback, "Rework the render path: rows must sort newest first.");
      assert.equal(reference.action.description, "Revise the T-101 implementation per the reviewer feedback.");
      assert.equal(reference.action.ticketId, "T-101");
    });

    it("accepts every canonical origin", () => {
      for (const origin of CORRECTION_ORIGINS) {
        assert.ok(isCorrectionOrigin(origin));
        const reference = createCorrectionReference(validInput({ origin }));
        assert.equal(reference.origin, origin);
      }
      assert.deepEqual([...CORRECTION_ORIGINS], ["reviewer", "technical-lead", "project-manager", "final-approval", "planning-approval"]);
    });

    it("preserves feedback verbatim, including whitespace and punctuation", () => {
      const feedback = "  Line one.\n\nLine two — “quoted” ✓ (100%)  \n\tIndented.";
      const reference = createCorrectionReference(validInput({ feedback }));
      assert.equal(reference.feedback, feedback);
    });

    it("keeps existing identifiers stable across origins", () => {
      const reference = createCorrectionReference(validInput({ origin: "technical-lead", ticketIds: ["T-1", "T-2"], action: { description: "Rework both.", ticketId: "T-1" } }));
      assert.deepEqual(reference.ticketIds, ["T-1", "T-2"]);
      assert.equal(reference.action.ticketId, "T-1");
    });

    it("action ticketId is genuinely optional", () => {
      const reference = createCorrectionReference(validInput({ action: { description: "Replan the sprint." } }));
      assert.ok(!("ticketId" in reference.action));
      assert.equal(reference.action.description, "Replan the sprint.");
    });

    it("validate accepts well-formed raw data with a defensive copy", () => {
      const raw = { origin: "final-approval", ticketIds: ["T-7"], feedback: "Hold for launch.", action: { description: "Await launch window.", ticketId: "T-7" } };
      const reference = validateCorrectionReference(raw);
      assert.deepEqual(reference.ticketIds, ["T-7"]);
      assert.notEqual(reference.ticketIds, raw.ticketIds);
      assert.notEqual(reference.action, raw.action);
    });
  });

  describe("rejection", () => {
    it("rejects unknown origins without guessing", () => {
      for (const origin of ["implementer", "coordinator", "REVIEWER", "", null, 42]) {
        assert.ok(!isCorrectionOrigin(origin));
        assert.throws(() => createCorrectionReference(validInput({ origin })), /origin must be one of/);
      }
    });

    it("rejects missing and malformed ticket ids", () => {
      for (const ticketIds of [undefined, null, [], ["T-1", ""], ["T-1", 42], "T-1", {}]) {
        assert.throws(() => createCorrectionReference(validInput({ ticketIds })), /ticketIds/);
      }
    });

    it("rejects missing and empty feedback rather than inventing it", () => {
      for (const feedback of [undefined, null, "", 42, {}]) {
        assert.throws(() => createCorrectionReference(validInput({ feedback })), /feedback/);
      }
    });

    it("rejects missing and malformed actions", () => {
      for (const action of [undefined, null, "fix it", [], {}, { description: "" }, { description: "x", ticketId: "" }]) {
        assert.throws(() => createCorrectionReference(validInput({ action })), /action/);
      }
    });

    it("rejects non-object envelopes", () => {
      assert.throws(() => createCorrectionReference(null as unknown as CorrectionReferenceInput), /input object/);
      assert.throws(() => validateCorrectionReference("correction"), /correction reference object/);
      assert.throws(() => validateCorrectionReference([]), /correction reference object/);
    });
  });

  describe("no invention", () => {
    it("opaque feedback is never parsed into structured requirements", () => {
      const feedback = "Requirement: rows must sort newest first.\nAcceptance criteria:\n1. Sorted.\n{\"id\": \"T-9\"}";
      const reference = createCorrectionReference(validInput({ feedback }));
      assert.equal(reference.feedback, feedback);
      assert.deepEqual(Object.keys(reference).sort(), ["action", "feedback", "origin", "ticketIds"]);
      assert.ok(!("requirements" in reference) && !("acceptance_criteria" in reference));
    });

    it("source and action stay distinct with no summary merging", () => {
      const reference = createCorrectionReference(validInput());
      assert.ok(reference.feedback !== reference.action.description);
      assert.equal(typeof reference.feedback, "string");
      assert.equal(typeof reference.action.description, "string");
    });

    it("claims no status, severity, priority, or identifiers of its own", () => {
      const reference = createCorrectionReference(validInput());
      const keys = JSON.stringify(reference);
      for (const invented of ["status", "severity", "priority", "deadline", "estimate", "resolved", "approved"]) {
        assert.ok(!keys.includes(`"${invented}"`), `no invented ${invented}`);
      }
    });
  });

  describe("purity and stability", () => {
    it("never mutates caller inputs", () => {
      const input = validInput();
      const snapshot = JSON.stringify(input);
      createCorrectionReference(input);
      validateCorrectionReference(JSON.parse(snapshot));
      assert.equal(JSON.stringify(input), snapshot);
    });

    it("returns frozen results throughout", () => {
      const reference = createCorrectionReference(validInput());
      assert.ok(Object.isFrozen(reference) && Object.isFrozen(reference.ticketIds) && Object.isFrozen(reference.action));
    });

    it("equivalent inputs produce equivalent references", () => {
      assert.deepEqual(createCorrectionReference(validInput()), createCorrectionReference(validInput()));
    });
  });

  describe("boundaries", () => {
    it("performs no I/O, execution, persistence, or re-entry", async () => {
      const root = mkdtempSync(join(tmpdir(), "t032-"));
      const before = readdirSync(root);
      createCorrectionReference(validInput());
      assert.deepEqual(readdirSync(root), before);
      const code = codeLines();
      for (const forbidden of ["node:", "Provider", "provider", "dispatch", "delegate", "execute", "Execute", "runFast", "runStandard", "runFull", "persist", "writeFile", "readFile", "configure", "spawn", "fetch(", "handoff", "Handoff", "Ticket(", "Sprint", "Task(", "approve", "Approve", "retry", "fallback", "reentry", "re-enter", "orchestrat", "Reentry", "rework", "Rework", "handoff-dispatcher", "independent-execution", "T-033", "T-034", "T-035", "T-036", "M29"]) {
        assert.ok(!code.includes(forbidden), `correction code never mentions ${forbidden}`);
      }
      const imports = readFileSync(CORRECTION_SOURCE, "utf8")
        .split("\n")
        .filter((line) => line.trim().startsWith("import "));
      assert.deepEqual(imports, [], "zero imports: the contract stands alone");
    });

    it("existing review, approval, task, ticket, and handoff contracts are untouched", () => {
      for (const file of ["src/runtime/review-decision.ts", "src/runtime/technical-lead.ts", "src/runtime/pm-testing.ts", "src/runtime/final-approval.ts", "src/runtime/planning-approval.ts", "src/runtime/task-model.ts", "src/runtime/coordinator.ts", "src/roles/handoff.ts"]) {
        const code = readFileSync(join(__dirname, "..", "..", file), "utf8");
        assert.ok(!code.includes("correction-reference") && !code.includes("CorrectionReference"), `${file} unchanged by T-032`);
      }
    });
  });
});
