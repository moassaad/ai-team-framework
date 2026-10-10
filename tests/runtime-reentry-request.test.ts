import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReentryRequest, validateReentryRequest, REENTRY_FORMS, ReentryRequestInput } from "../src/runtime/reentry-request";
import { validateAgentHandoff, renderAgentHandoff } from "../src/roles/handoff-validation";
import { parseAgentHandoffText } from "../src/roles/handoff-parser";
import { createTlImplementerReworkHandoff } from "../src/runtime/tl-implementer-rework-handoff";
import { createPmTlReentryHandoff } from "../src/runtime/pm-tl-reentry-handoff";
import { createFinalApprovalReentryHandoff } from "../src/runtime/final-approval-reentry-handoff";

// Re-entry request tests (M28 T-036): the unified contract
// over the T-033/T-034/T-035 routes. Validation describes
// intent; it never executes, dispatches, or authorizes.
// Hermetic and provider-free throughout.

const REENTRY_SOURCE = join(__dirname, "..", "..", "src", "runtime", "reentry-request.ts");

function tlPair() {
  const correction = { origin: "technical-lead", ticketIds: ["T-101"], feedback: "Harden the render path.", action: { description: "Revise T-101 per the TL correction.", ticketId: "T-101" } };
  return { correction, handoff: createTlImplementerReworkHandoff({ correction }) };
}

function pmPair() {
  const correction = { origin: "project-manager", ticketIds: ["T-201"], feedback: "Narrow the scope.", action: { description: "Return T-201 to technical planning.", ticketId: "T-201" } };
  return { correction, handoff: createPmTlReentryHandoff({ correction }) };
}

function finalPair(to: string = "project-manager") {
  const correction = { origin: "final-approval", ticketIds: ["T-301"], feedback: "Hold for launch.", action: { description: "Return T-301 for rework.", ticketId: "T-301" } };
  return { correction, handoff: createFinalApprovalReentryHandoff({ correction, to }) };
}

describe("re-entry request contract (M28 T-036)", () => {
  describe("supported forms", () => {
    it("represents a valid TL to Implementer pair with its form", () => {
      const request = createReentryRequest(tlPair());
      assert.equal(request.form, "tl-implementer");
      assert.deepEqual(request.correction.origin, "technical-lead");
      assert.deepEqual([request.handoff.from, request.handoff.to], ["technical-lead", "implementer"]);
      assert.deepEqual(REENTRY_FORMS, ["tl-implementer", "pm-technical-lead", "final-approval"]);
    });

    it("represents a valid PM to TL pair with its form", () => {
      const request = createReentryRequest(pmPair());
      assert.equal(request.form, "pm-technical-lead");
      assert.deepEqual([request.handoff.from, request.handoff.to], ["project-manager", "technical-lead"]);
    });

    it("represents valid final-approval pairs for each supported destination", () => {
      for (const to of ["project-manager", "technical-lead"] as const) {
        const request = createReentryRequest(finalPair(to));
        assert.equal(request.form, "final-approval");
        assert.deepEqual([request.handoff.from, request.handoff.to], ["coordinator", to]);
      }
    });

    it("preserves the original correction object on the request", () => {
      const pair = tlPair();
      const request = createReentryRequest(pair);
      assert.deepEqual(request.correction, validateReentryRequest(pair).correction);
      assert.equal(request.correction.feedback, "Harden the render path.");
    });

    it("the handoff passes canonical validation on the request", () => {
      const request = createReentryRequest(pmPair());
      assert.deepEqual(validateAgentHandoff(request.handoff), request.handoff);
    });
  });

  describe("pair consistency", () => {
    it("rejects a valid correction paired with an unrelated valid handoff", () => {
      const tl = tlPair();
      const pm = pmPair();
      assert.throws(() => createReentryRequest({ correction: tl.correction, handoff: pm.handoff }), /does not correspond/);
      assert.throws(() => createReentryRequest({ correction: pm.correction, handoff: tl.handoff }), /does not correspond/);
      assert.throws(() => createReentryRequest({ correction: tl.correction, handoff: finalPair().handoff }), /does not correspond/);
    });

    it("rejects altered objective, notes, and artifacts even when the pair shape matches", () => {
      const pair = tlPair();
      assert.throws(
        () => createReentryRequest({ correction: pair.correction, handoff: { ...pair.handoff, objective: "Something else" } }),
        /does not correspond/,
      );
      assert.throws(
        () => createReentryRequest({ correction: pair.correction, handoff: { ...pair.handoff, notes: "Rewritten feedback" } }),
        /does not correspond/,
      );
      assert.throws(
        () => createReentryRequest({ correction: pair.correction, handoff: { ...pair.handoff, artifacts: ["T-999"] } }),
        /does not correspond/,
      );
    });

    it("rejects final-approval handoffs built from a different correction", () => {
      const pair = finalPair("project-manager");
      const foreign = createFinalApprovalReentryHandoff({
        correction: { ...pair.correction, feedback: "Different feedback for the same ticket." },
        to: "project-manager",
      });
      assert.throws(() => createReentryRequest({ correction: pair.correction, handoff: foreign }), /does not correspond/);
      const otherCorrection = { ...pair.correction, feedback: "Another hold reason." };
      assert.throws(() => createReentryRequest({ correction: otherCorrection, handoff: pair.handoff }), /does not correspond/);
    });

    it("rejects unsupported origins with no re-entry form", () => {
      for (const origin of ["reviewer", "planning-approval"]) {
        const correction = { origin, ticketIds: ["T-1"], feedback: "Fix it.", action: { description: "Fix T-1.", ticketId: "T-1" } };
        const handoff = { from: "technical-lead", to: "implementer", objective: "Fix T-1.", notes: "Fix it.", artifacts: ["T-1"] };
        assert.throws(() => createReentryRequest({ correction, handoff }), /no supported re-entry form/);
      }
    });

    it("rejects unsupported source and destination combinations", () => {
      const pair = tlPair();
      assert.throws(
        () => createReentryRequest({ correction: pair.correction, handoff: { ...pair.handoff, to: "project-manager" } }),
        /./,
        "rebuilt expectation cannot match a misdirected handoff",
      );
    });

    it("rejects missing and malformed references", () => {
      const pair = tlPair();
      assert.throws(() => createReentryRequest(null as unknown as ReentryRequestInput), /input object/);
      assert.throws(() => validateReentryRequest("request"), /request object/);
      assert.throws(() => createReentryRequest({ correction: null, handoff: pair.handoff }), /correction reference object/);
      assert.throws(() => createReentryRequest({ correction: pair.correction, handoff: null }), /agent handoff/);
      assert.throws(() => createReentryRequest({ correction: pair.correction } as unknown as ReentryRequestInput), /agent handoff/);
    });
  });

  describe("preservation without invention", () => {
    it("keeps action description and feedback separate and unmodified", () => {
      const request = createReentryRequest(finalPair());
      assert.equal(request.handoff.objective, "Return T-301 for rework.");
      assert.equal(request.handoff.notes, "Hold for launch.");
      assert.equal(request.correction.action.description, "Return T-301 for rework.");
      assert.equal(request.correction.feedback, "Hold for launch.");
    });

    it("keeps feedback byte-identical, including whitespace and Unicode", () => {
      const feedback = "  Hold it.\n\nUnicode ✓ “quoted” (100%)  \n\tIndented.";
      const correction = { origin: "project-manager", ticketIds: ["T-5"], feedback, action: { description: "Replan T-5.", ticketId: "T-5" } };
      const request = createReentryRequest({ correction, handoff: createPmTlReentryHandoff({ correction }) });
      assert.equal(request.handoff.notes, feedback);
      assert.equal(request.correction.feedback, feedback);
    });

    it("preserves every ticket reference in order with established ticketId behavior", () => {
      const correction = { origin: "technical-lead", ticketIds: ["T-3", "T-1"], feedback: "Rework both.", action: { description: "Rework both.", ticketId: "T-9" } };
      const request = createReentryRequest({ correction, handoff: createTlImplementerReworkHandoff({ correction }) });
      assert.deepEqual(request.handoff.artifacts, ["T-3", "T-1", "T-9"]);
    });

    it("parses no feedback into structured fields", () => {
      const request = createReentryRequest(tlPair());
      assert.equal(request.handoff.requirements, undefined);
      assert.equal(request.handoff.acceptance_criteria, undefined);
      assert.deepEqual(Object.keys(request).sort(), ["correction", "form", "handoff"]);
    });

    it("claims no resolution, execution, or provenance beyond the contracts", () => {
      const request = createReentryRequest(finalPair());
      const serialized = JSON.stringify(request);
      for (const invented of ["resolved", "completed", "executed", "approved", "changes-required", "event", "verified"]) {
        assert.ok(!serialized.includes(`"${invented}"`), `no invented ${invented}`);
      }
    });
  });

  describe("purity, stability, manual compatibility", () => {
    it("returns frozen results with frozen nested objects", () => {
      const request = createReentryRequest(pmPair());
      assert.ok(Object.isFrozen(request) && Object.isFrozen(request.correction) && Object.isFrozen(request.handoff));
    });

    it("never mutates caller inputs", () => {
      const pair = tlPair();
      const snapshot = JSON.stringify(pair);
      createReentryRequest(pair);
      assert.equal(JSON.stringify(pair), snapshot);
    });

    it("equivalent inputs produce equivalent requests", () => {
      assert.deepEqual(createReentryRequest(tlPair()), createReentryRequest(tlPair()));
      assert.deepEqual(validateReentryRequest(pmPair()), createReentryRequest(pmPair()));
    });

    it("each supported handoff survives the manual render, parse, validate loop", () => {
      const pairs = [tlPair(), pmPair(), finalPair("project-manager"), finalPair("technical-lead")];
      for (const pair of pairs) {
        const request = createReentryRequest(pair);
        const resumed = validateAgentHandoff(parseAgentHandoffText(renderAgentHandoff(request.handoff)));
        assert.deepEqual(resumed, request.handoff);
      }
    });
  });

  describe("boundaries", () => {
    it("performs no execution, dispatch, persistence, retry, looping, or orchestration", async () => {
      const root = mkdtempSync(join(tmpdir(), "t036-"));
      const before = readdirSync(root);
      createReentryRequest(tlPair());
      assert.deepEqual(readdirSync(root), before);
      const code = readFileSync(REENTRY_SOURCE, "utf8")
        .split("\n")
        .filter((line) => {
          const trimmed = line.trim();
          return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/**") && !trimmed.startsWith("*/");
        })
        .join("\n");
      for (const forbidden of ["node:", "Provider", "provider", "dispatch", "delegate", "execute", "Execute", "persist", "writeFile", "readFile", "configure", "spawn", "fetch(", "independent-execution", "status", "State", "transition", "Transition", "retry", "loop", "Loop", "fallback", "re-enter", "orchestrat", "handoff-dispatcher", "runFast", "runStandard", "runFull", "M29", "T-037", "onboard", "release"]) {
        assert.ok(!code.includes(forbidden), `request code never mentions ${forbidden}`);
      }
      assert.ok(code.includes("pm-tl-reentry-handoff") && code.includes("final-approval-reentry-handoff"), "route constructors are imported, not reimplemented");
      const imports = readFileSync(REENTRY_SOURCE, "utf8")
        .split("\n")
        .filter((line) => line.trim().startsWith("import "));
      assert.deepEqual(imports, [
        'import { AgentHandoff } from "../roles/handoff";',
        'import { validateAgentHandoff } from "../roles/handoff-validation";',
        'import { validateCorrectionReference, CorrectionReference } from "./correction-reference";',
        'import { createTlImplementerReworkHandoff } from "./tl-implementer-rework-handoff";',
        'import { createPmTlReentryHandoff } from "./pm-tl-reentry-handoff";',
        'import { createFinalApprovalReentryHandoff } from "./final-approval-reentry-handoff";',
      ]);
    });

    it("leaves all earlier contracts unchanged", () => {
      for (const file of [
        "src/runtime/correction-reference.ts",
        "src/runtime/tl-implementer-rework-handoff.ts",
        "src/runtime/pm-tl-reentry-handoff.ts",
        "src/runtime/final-approval-reentry-handoff.ts",
        "src/roles/handoff.ts",
        "src/roles/handoff-validation.ts",
        "src/roles/operating-model.ts",
      ]) {
        const code = readFileSync(join(__dirname, "..", "..", file), "utf8");
        assert.ok(!code.includes("reentry-request") && !code.includes("ReentryRequest") && !code.includes("ReentryForm"), `${file} unchanged by T-036`);
      }
      const tl = tlPair();
      assert.deepEqual(createTlImplementerReworkHandoff({ correction: tl.correction }), tl.handoff);
    });
  });
});
