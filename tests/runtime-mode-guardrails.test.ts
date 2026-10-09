import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkModeGuardrails, ModeGuardrailInput } from "../src/runtime/mode-guardrails";
import { recommendMode } from "../src/runtime/mode-recommendation";
import { getWorkModeDescriptor } from "../src/runtime/work-mode";

// Mode guardrail tests (M27 T-031): capability compatibility
// plus explicit discrepancy confirmation. No execution, no
// override, no enforcement machinery. Deterministic throughout.

const GUARDRAILS_SOURCE = join(__dirname, "..", "..", "src", "runtime", "mode-guardrails.ts");

function codeLines(): string {
  return readFileSync(GUARDRAILS_SOURCE, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/**") && !trimmed.startsWith("*/");
    })
    .join("\n");
}

function check(selectedMode: unknown, signals: Record<string, boolean>, confirmation?: unknown): ReturnType<typeof checkModeGuardrails> {
  const input: ModeGuardrailInput = { selectedMode, signals, ...(confirmation !== undefined ? { confirmation } : {}) };
  return checkModeGuardrails(input);
}

const NO_NEEDS = { needsBusinessPlanning: false, needsSprintDecomposition: false, needsApprovals: false, needsTechnicalPlanning: false };

describe("mode guardrails (M27 T-031)", () => {
  describe("FULL-required signals", () => {
    it("each FULL-required signal rejects fast and standard", () => {
      for (const field of ["needsBusinessPlanning", "needsSprintDecomposition", "needsApprovals"] as const) {
        for (const selected of ["fast", "standard"] as const) {
          const result = check(selected, { ...NO_NEEDS, [field]: true });
          assert.equal(result.decision, "reject", `${field} rejects ${selected}`);
          if (result.decision !== "reject") throw new Error("unreachable");
          assert.deepEqual(result.unmetCapabilities, [`${field} requires full`]);
          assert.equal(result.selected, selected);
          assert.equal(result.recommended, "full");
        }
      }
    });

    it("each FULL-required signal permits full", () => {
      for (const field of ["needsBusinessPlanning", "needsSprintDecomposition", "needsApprovals"] as const) {
        const result = check("full", { ...NO_NEEDS, [field]: true });
        assert.equal(result.decision, "allow", `${field} permits full`);
        if (result.decision !== "allow") throw new Error("unreachable");
        assert.equal(result.matchesRecommendation, true);
        assert.equal(result.confirmationApplied, false);
      }
    });

    it("multiple unmet capabilities are all reported in signal order", () => {
      const result = check("fast", { needsBusinessPlanning: true, needsSprintDecomposition: true, needsApprovals: true, needsTechnicalPlanning: true });
      assert.equal(result.decision, "reject");
      if (result.decision !== "reject") throw new Error("unreachable");
      assert.deepEqual(result.unmetCapabilities, [
        "needsBusinessPlanning requires full",
        "needsSprintDecomposition requires full",
        "needsApprovals requires full",
        "needsTechnicalPlanning requires standard or full",
      ]);
      assert.equal(result.reasons.length, 4);
    });

    it("confirmation never bypasses missing capabilities", () => {
      for (const confirmation of [{ confirmed: true }, { confirmed: false }]) {
        const result = check("standard", { ...NO_NEEDS, needsApprovals: true }, confirmation);
        assert.equal(result.decision, "reject", "confirmed rejections stay rejected");
      }
      const confirmedFast = check("fast", { ...NO_NEEDS, needsTechnicalPlanning: true }, { confirmed: true });
      assert.equal(confirmedFast.decision, "reject");
    });
  });

  describe("technical planning", () => {
    it("technical planning need rejects fast", () => {
      const result = check("fast", { ...NO_NEEDS, needsTechnicalPlanning: true });
      assert.equal(result.decision, "reject");
      if (result.decision !== "reject") throw new Error("unreachable");
      assert.deepEqual(result.unmetCapabilities, ["needsTechnicalPlanning requires standard or full"]);
      assert.equal(result.recommended, "standard");
    });

    it("technical planning accepts standard and full", () => {
      const standard = check("standard", { ...NO_NEEDS, needsTechnicalPlanning: true });
      assert.equal(standard.decision, "allow");
      const full = check("full", { ...NO_NEEDS, needsTechnicalPlanning: true });
      assert.equal(full.decision, "confirmation-required", "full is compatible but differs from recommended standard");
    });

    it("confirmed compatible full selection is allowed with the discrepancy recorded", () => {
      const result = check("full", { ...NO_NEEDS, needsTechnicalPlanning: true }, { confirmed: true });
      assert.equal(result.decision, "allow");
      if (result.decision !== "allow") throw new Error("unreachable");
      assert.equal(result.selected, "full");
      assert.equal(result.recommended, "standard");
      assert.equal(result.matchesRecommendation, false);
      assert.equal(result.confirmationApplied, true);
    });
  });

  describe("no lifecycle requirements", () => {
    it("all three modes are capability-compatible with no needs", () => {
      for (const selected of ["fast", "standard", "full"] as const) {
        const result = check(selected, NO_NEEDS);
        assert.ok(result.decision === "allow" || result.decision === "confirmation-required", `${selected} compatible`);
        if (result.decision === "confirmation-required") {
          assert.deepEqual(result.unmetCapabilities, []);
        }
      }
    });

    it("matching the recommendation needs no confirmation", () => {
      const result = check("fast", NO_NEEDS);
      assert.equal(result.decision, "allow");
      if (result.decision !== "allow") throw new Error("unreachable");
      assert.equal(result.matchesRecommendation, true);
      assert.equal(result.confirmationApplied, false);
    });

    it("compatible discrepancies require explicit confirmation", () => {
      const pending = check("full", NO_NEEDS);
      assert.equal(pending.decision, "confirmation-required", "full compatible, recommended fast");
      if (pending.decision !== "confirmation-required") throw new Error("unreachable");
      assert.equal(pending.matchesRecommendation, false);
      const confirmed = check("full", NO_NEEDS, { confirmed: true });
      assert.equal(confirmed.decision, "allow");
      const declined = check("full", NO_NEEDS, { confirmed: false });
      assert.equal(declined.decision, "confirmation-required", "explicit false is not approval");
    });

    it("absent confirmation is never approval", () => {
      const result = check("standard", NO_NEEDS);
      assert.equal(result.decision, "confirmation-required");
      assert.equal(result.recommended, "fast");
    });
  });

  describe("selection preserved", () => {
    it("selected and recommended stay separate in every result", () => {
      const rejected = check("fast", { ...NO_NEEDS, needsApprovals: true });
      if (rejected.decision !== "reject") throw new Error("unreachable");
      assert.equal(rejected.selected, "fast");
      assert.equal(rejected.recommended, "full");
      const allowed = check("full", { ...NO_NEEDS, needsApprovals: true });
      if (allowed.decision !== "allow") throw new Error("unreachable");
      assert.equal(allowed.selected, "full");
      assert.equal(allowed.recommended, "full");
    });

    it("reasons identify unmet capabilities or required confirmation", () => {
      const rejected = check("standard", { ...NO_NEEDS, needsSprintDecomposition: true });
      if (rejected.decision !== "reject") throw new Error("unreachable");
      assert.ok(rejected.reasons.some((reason) => reason.includes("needsSprintDecomposition requires full")));
      assert.ok(rejected.reasons.every((reason) => reason.includes("selected standard")));
      const pending = check("full", NO_NEEDS);
      if (pending.decision !== "confirmation-required") throw new Error("unreachable");
      assert.ok(pending.reasons.some((reason) => reason.includes("explicit confirmation required")));
    });
  });

  describe("input validation", () => {
    it("rejects invalid and missing selections without defaulting", () => {
      for (const selectedMode of ["turbo", "FAST", "", null, 42, undefined]) {
        assert.throws(() => check(selectedMode, NO_NEEDS), /selectedMode must be a canonical work mode/);
      }
    });

    it("rejects missing and non-boolean signals", () => {
      assert.throws(() => check("fast", undefined as unknown as Record<string, boolean>), /signals must be an object/);
      assert.throws(() => check("fast", { ...NO_NEEDS, needsApprovals: "yes" } as unknown as Record<string, boolean>), /signals\.needsApprovals must be a boolean/);
      assert.throws(() => checkModeGuardrails(null as unknown as ModeGuardrailInput), /guardrail input object/);
    });

    it("rejects invalid confirmation inputs without treating them as denial", () => {
      for (const confirmation of ["yes", true, 1, { confirmed: "yes" }, { confirmed: 1 }, []] as const) {
        assert.throws(() => check("full", NO_NEEDS, confirmation), /confirmation/);
      }
    });
  });

  describe("determinism and T-030 reuse", () => {
    it("equivalent inputs return equivalent results", () => {
      const first = check("standard", { ...NO_NEEDS, needsTechnicalPlanning: true });
      const second = check("standard", { ...NO_NEEDS, needsTechnicalPlanning: true });
      assert.deepEqual(first, second);
      assert.ok(Object.isFrozen(first));
    });

    it("recommendation matches the standalone T-030 function", () => {
      const standalone = recommendMode({ signals: { ...NO_NEEDS, needsApprovals: true }, selectedMode: "standard" });
      const result = check("standard", { ...NO_NEEDS, needsApprovals: true });
      if (result.decision !== "reject") throw new Error("unreachable");
      assert.equal(result.recommended, standalone.recommended);
      assert.equal(result.matchesRecommendation, standalone.matchesSelection);
    });

    it("existing T-030 behavior is unchanged by guardrails", () => {
      const bare = recommendMode({ signals: NO_NEEDS });
      assert.equal(bare.recommended, "fast");
      assert.ok(!("decision" in bare) && !("unmetCapabilities" in bare));
    });
  });

  describe("boundaries", () => {
    it("touches no runners, providers, I/O, approvals, or state", () => {
      const code = codeLines();
      for (const forbidden of ["runFast", "runStandard", "runFull", "Provider", "provider", "dispatch", "delegate", "node:", "writeFile", "readFile", "persist", "configure", "spawn", "fetch(", "approve(", "Approval(", "ApprovalResult", "approvePlanning", "Ticket", "sprint-model", "createSprint", "task-model", "createTask", "Task("]) {
        assert.ok(!code.includes(forbidden), `guardrail code never mentions ${forbidden}`);
      }
      assert.ok(code.includes("needsSprintDecomposition"), "the sprint signal name itself is the legitimate capability vocabulary");
      const imports = readFileSync(GUARDRAILS_SOURCE, "utf8")
        .split("\n")
        .filter((line) => line.trim().startsWith("import "));
      assert.deepEqual(imports, [
        'import { WorkMode, isWorkMode, validateWorkMode, getWorkModeDescriptor } from "./work-mode";',
        'import { recommendMode, ModeRecommendationSignals } from "./mode-recommendation";',
      ]);
    });

    it("adds no orchestration, retry, re-entry, enforcement, or later-ticket work", () => {
      const code = codeLines();
      for (const forbidden of ["orchestrat", "retry", "fallback", "reentry", "re-enter", "enforce", "Enforce", "permit", "deny", "execute", "Execute", "FAST", "STANDARD", "FULL", "T-032", "M28", "M29", "rework", "Rework", "Correction", "correction"]) {
        assert.ok(!code.includes(forbidden), `guardrail code never mentions ${forbidden}`);
      }
    });

    it("descriptors and path contracts remain untouched", () => {
      assert.deepEqual(getWorkModeDescriptor("fast").lifecycle, ["implementer", "senior-reviewer"]);
      assert.equal(getWorkModeDescriptor("standard").planning, true);
      assert.equal(getWorkModeDescriptor("full").sprints, true);
      assert.equal(getWorkModeDescriptor("full").approvals, true);
    });

    it("result keys are pinned per decision", () => {
      const allowed = check("fast", NO_NEEDS);
      assert.deepEqual(Object.keys(allowed).sort(), ["confirmationApplied", "decision", "matchesRecommendation", "reasons", "recommended", "selected"]);
      const pending = check("full", NO_NEEDS);
      assert.deepEqual(Object.keys(pending).sort(), ["decision", "matchesRecommendation", "reasons", "recommended", "selected", "unmetCapabilities"]);
      const rejected = check("fast", { ...NO_NEEDS, needsApprovals: true });
      assert.deepEqual(Object.keys(rejected).sort(), ["decision", "matchesRecommendation", "reasons", "recommended", "selected", "unmetCapabilities"]);
    });
  });
});
