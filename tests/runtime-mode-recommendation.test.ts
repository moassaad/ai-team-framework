import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { recommendMode, ModeRecommendationInput } from "../src/runtime/mode-recommendation";
import { getWorkModeDescriptor } from "../src/runtime/work-mode";

// Mode recommendation tests (M27 T-030): pure advice over
// explicit caller facts. No execution, no override, no
// guardrails. Deterministic at every boundary.

const RECOMMENDATION_SOURCE = join(__dirname, "..", "..", "src", "runtime", "mode-recommendation.ts");

function codeLines(): string {
  return readFileSync(RECOMMENDATION_SOURCE, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/**") && !trimmed.startsWith("*/");
    })
    .join("\n");
}

function signals(overrides: Partial<ModeRecommendationInput["signals"]> = {}): ModeRecommendationInput {
  return {
    signals: {
      needsBusinessPlanning: false,
      needsSprintDecomposition: false,
      needsApprovals: false,
      needsTechnicalPlanning: false,
      ...overrides,
    },
  };
}

describe("mode recommendation (M27 T-030)", () => {
  describe("recommendation rules", () => {
    it("bounded work with no needs recommends fast", () => {
      const result = recommendMode(signals());
      assert.equal(result.recommended, "fast");
      assert.equal(result.rationale, "recommend fast: bounded change with no planning needs");
    });

    it("technical planning need recommends standard", () => {
      const result = recommendMode(signals({ needsTechnicalPlanning: true }));
      assert.equal(result.recommended, "standard");
      assert.equal(result.rationale, "recommend standard: technical planning required; no full-lifecycle needs");
    });

    it("each full-lifecycle need recommends full on its own", () => {
      for (const field of ["needsBusinessPlanning", "needsSprintDecomposition", "needsApprovals"] as const) {
        const result = recommendMode(signals({ [field]: true }));
        assert.equal(result.recommended, "full", `${field} alone requires full`);
      }
    });

    it("full rationale names every triggering need", () => {
      const result = recommendMode(signals({ needsBusinessPlanning: true, needsSprintDecomposition: true, needsApprovals: true }));
      assert.equal(result.recommended, "full");
      assert.equal(result.rationale, "recommend full: business planning required; sprint decomposition required; approvals required");
    });

    it("full-lifecycle needs outrank technical planning", () => {
      const result = recommendMode(signals({ needsTechnicalPlanning: true, needsApprovals: true }));
      assert.equal(result.recommended, "full");
      assert.ok(result.rationale.includes("approvals required"));
    });

    it("every valid mode is reachable", () => {
      assert.equal(recommendMode(signals()).recommended, "fast");
      assert.equal(recommendMode(signals({ needsTechnicalPlanning: true })).recommended, "standard");
      assert.equal(recommendMode(signals({ needsBusinessPlanning: true })).recommended, "full");
    });

    it("all-false and all-true boundaries are deterministic", () => {
      assert.equal(recommendMode(signals()).recommended, "fast");
      const all = recommendMode(signals({ needsBusinessPlanning: true, needsSprintDecomposition: true, needsApprovals: true, needsTechnicalPlanning: true }));
      assert.equal(all.recommended, "full");
      assert.deepEqual(recommendMode(signals()), recommendMode(signals()));
      assert.deepEqual(all, recommendMode(signals({ needsBusinessPlanning: true, needsSprintDecomposition: true, needsApprovals: true, needsTechnicalPlanning: true })));
    });
  });

  describe("explicit selection preserved", () => {
    it("no selection means agreement without confirmation", () => {
      const result = recommendMode(signals({ needsTechnicalPlanning: true }));
      assert.ok(!("selected" in result));
      assert.equal(result.matchesSelection, true);
      assert.equal(result.requiresConfirmation, false);
    });

    it("agreeing selection is preserved with matchesSelection true", () => {
      const result = recommendMode({ ...signals(), selectedMode: "fast" });
      assert.equal(result.recommended, "fast");
      assert.equal(result.selected, "fast");
      assert.equal(result.matchesSelection, true);
      assert.equal(result.requiresConfirmation, false);
      assert.equal(result.rationale, "recommend fast: bounded change with no planning needs");
    });

    it("conflicting selection is preserved with a transparent discrepancy", () => {
      const result = recommendMode({ ...signals({ needsBusinessPlanning: true }), selectedMode: "fast" });
      assert.equal(result.recommended, "full", "recommendation never replaced by the selection");
      assert.equal(result.selected, "fast", "selection never replaced by the recommendation");
      assert.equal(result.matchesSelection, false);
      assert.equal(result.requiresConfirmation, true);
      assert.equal(result.rationale, "recommend full: business planning required; selected mode is fast, which differs from the recommendation");
    });

    it("invalid selected modes are rejected, never defaulted", () => {
      for (const selectedMode of ["turbo", "FAST", "", null, 42]) {
        assert.throws(() => recommendMode({ ...signals(), selectedMode }), /selectedMode must be a canonical work mode/);
      }
    });
  });

  describe("input validation", () => {
    it("rejects missing, malformed, and non-boolean signals", () => {
      assert.throws(() => recommendMode(null as unknown as ModeRecommendationInput), /recommendation input object/);
      assert.throws(() => recommendMode({} as unknown as ModeRecommendationInput), /signals must be an object/);
      assert.throws(() => recommendMode({ signals: null } as unknown as ModeRecommendationInput), /signals must be an object/);
      for (const field of ["needsBusinessPlanning", "needsSprintDecomposition", "needsApprovals", "needsTechnicalPlanning"] as const) {
        const bad = { needsBusinessPlanning: false, needsSprintDecomposition: false, needsApprovals: false, needsTechnicalPlanning: false, [field]: "yes" };
        assert.throws(() => recommendMode({ signals: bad } as unknown as ModeRecommendationInput), new RegExp(`signals\\.${field} must be a boolean`));
      }
    });

    it("signals are defensively copied and frozen", () => {
      const input = signals({ needsTechnicalPlanning: true });
      const result = recommendMode(input);
      assert.deepEqual(result.signals, input.signals);
      assert.ok(Object.isFrozen(result) && Object.isFrozen(result.signals));
      assert.notEqual(result.signals, input.signals);
    });
  });

  describe("rationale honesty", () => {
    it("claims only supplied signals and the applied rule", () => {
      const result = recommendMode(signals({ needsTechnicalPlanning: true }));
      for (const unsupported of ["risk", "scope", "size", "complexity", "safe", "reliable", "best", "prefer"]) {
        assert.ok(!result.rationale.includes(unsupported), `rationale claims no ${unsupported}`);
      }
    });

    it("fast rationale never promises planning coverage", () => {
      const result = recommendMode(signals());
      assert.ok(!result.rationale.includes("planning required"));
    });
  });

  describe("boundaries", () => {
    it("invokes no execution paths, providers, or I/O", () => {
      const code = codeLines();
      for (const forbidden of ["runFast", "runStandard", "runFull", "Provider", "provider", "dispatch", "delegate", "node:", "writeFile", "readFile", "persist", "configure", "spawn", "fetch("]) {
        assert.ok(!code.includes(forbidden), `recommendation code never mentions ${forbidden}`);
      }
      const imports = readFileSync(RECOMMENDATION_SOURCE, "utf8")
        .split("\n")
        .filter((line) => line.trim().startsWith("import "));
      assert.deepEqual(imports, ['import { WorkMode, isWorkMode, validateWorkMode } from "./work-mode";']);
    });

    it("adds no guardrails, orchestration, retry, or re-entry", () => {
      const code = codeLines();
      for (const forbidden of ["guardrail", "Guardrail", "orchestrat", "retry", "fallback", "reentry", "re-enter", "enforce", "permit", "deny", "FAST", "STANDARD", "FULL"]) {
        assert.ok(!code.includes(forbidden), `recommendation code never mentions ${forbidden}`);
      }
    });

    it("mode descriptors and path semantics remain unchanged", () => {
      assert.deepEqual(getWorkModeDescriptor("fast").lifecycle, ["implementer", "senior-reviewer"]);
      assert.deepEqual(getWorkModeDescriptor("standard").lifecycle, ["coordinator", "technical-lead", "implementer", "senior-reviewer"]);
      assert.equal(getWorkModeDescriptor("full").lifecycle.length, 7);
      assert.equal(getWorkModeDescriptor("full").planning, true);
    });

    it("recommendation carries no execution authority fields", () => {
      const result = recommendMode(signals({ needsBusinessPlanning: true }));
      assert.deepEqual(Object.keys(result).sort(), ["matchesSelection", "rationale", "recommended", "requiresConfirmation", "signals"]);
      const withSelection = recommendMode({ ...signals(), selectedMode: "standard" });
      assert.deepEqual(Object.keys(withSelection).sort(), ["matchesSelection", "rationale", "recommended", "requiresConfirmation", "selected", "signals"]);
    });
  });
});
