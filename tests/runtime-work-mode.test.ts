import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  WORK_MODES,
  WORK_MODE_DESCRIPTORS,
  getWorkModeDescriptor,
  isWorkMode,
  validateWorkMode,
  WorkMode,
} from "../src/runtime/work-mode";

// Work mode contract tests (M27 T-026): identity plus
// declarative composition policy, data only. No execution,
// recommendation, guardrails, providers, persistence, or
// state anywhere in this module.

const WORK_MODE_SOURCE = join(__dirname, "..", "..", "src", "runtime", "work-mode.ts");

function codeLines(): string {
  return readFileSync(WORK_MODE_SOURCE, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/**") && !trimmed.startsWith("*/");
    })
    .join("\n");
}

describe("work mode contract (M27 T-026)", () => {
  describe("canonical modes", () => {
    it("accepts exactly fast, standard, and full", () => {
      assert.deepEqual([...WORK_MODES], ["fast", "standard", "full"]);
      for (const mode of ["fast", "standard", "full"] as const) {
        assert.ok(isWorkMode(mode));
        assert.equal(validateWorkMode(mode), mode);
      }
    });

    it("all three modes are distinct", () => {
      assert.equal(new Set(WORK_MODES).size, 3);
    });

    it("descriptors exist for every mode and nothing else", () => {
      assert.deepEqual(Object.keys(WORK_MODE_DESCRIPTORS).sort(), ["fast", "full", "standard"]);
      for (const mode of WORK_MODES) {
        assert.equal(getWorkModeDescriptor(mode).id, mode);
      }
    });
  });

  describe("validation", () => {
    it("rejects unknown modes", () => {
      for (const unknown of ["quick", "normal", "complete", "turbo", ""]) {
        assert.ok(!isWorkMode(unknown));
        assert.throws(() => validateWorkMode(unknown), /canonical work mode/);
      }
    });

    it("rejects case variants without coercion", () => {
      for (const variant of ["FAST", "Fast", "STANDARD", "Full", "FULL"]) {
        assert.ok(!isWorkMode(variant), `${variant} is not canonical`);
        assert.throws(() => validateWorkMode(variant), /canonical work mode/);
      }
    });

    it("rejects wrong types and arbitrary objects", () => {
      for (const malformed of [null, undefined, 42, true, ["fast"], { id: "fast" }, {}, " fast", "fast "]) {
        assert.ok(!isWorkMode(malformed));
        assert.throws(() => validateWorkMode(malformed), /canonical work mode/);
      }
    });

    it("creates no aliases", () => {
      for (const alias of ["quick", "normal", "complete", "fast-path", "std", "f", "s"]) {
        assert.ok(!isWorkMode(alias));
      }
    });

    it("descriptor lookup validates its input", () => {
      assert.throws(() => getWorkModeDescriptor("turbo"), /canonical work mode/);
      assert.throws(() => getWorkModeDescriptor(null), /canonical work mode/);
    });
  });

  describe("semantic definitions", () => {
    it("fast is the minimal implementation/review lifecycle", () => {
      const fast = getWorkModeDescriptor("fast");
      assert.deepEqual(fast.lifecycle, ["implementer", "senior-reviewer"]);
      assert.equal(fast.planning, false);
      assert.equal(fast.sprints, false);
      assert.equal(fast.approvals, false);
    });

    it("standard composes coordinator and technical planning around implementation/review", () => {
      const standard = getWorkModeDescriptor("standard");
      assert.deepEqual(standard.lifecycle, ["coordinator", "technical-lead", "implementer", "senior-reviewer"]);
      assert.equal(standard.planning, true);
      assert.equal(standard.sprints, false);
      assert.equal(standard.approvals, false);
    });

    it("full composes planning, sprints, execution, and acceptance", () => {
      const full = getWorkModeDescriptor("full");
      assert.deepEqual(full.lifecycle, [
        "coordinator",
        "project-manager",
        "technical-lead",
        "implementer",
        "senior-reviewer",
        "technical-lead",
        "project-manager",
      ]);
      assert.equal(full.planning, true);
      assert.equal(full.sprints, true);
      assert.equal(full.approvals, true);
    });

    it("lifecycles use only canonical roles and add no new ones", () => {
      const seen = new Set<string>();
      for (const mode of WORK_MODES) {
        for (const role of getWorkModeDescriptor(mode).lifecycle) {
          assert.ok(["coordinator", "project-manager", "technical-lead", "implementer", "senior-reviewer"].includes(role));
          seen.add(role);
        }
      }
      assert.equal(seen.size, 5, "every canonical role appears somewhere, none invented");
    });

    it("composition depth grows monotonically from fast to full", () => {
      const fast = getWorkModeDescriptor("fast");
      const standard = getWorkModeDescriptor("standard");
      const full = getWorkModeDescriptor("full");
      assert.ok(standard.lifecycle.length > fast.lifecycle.length);
      assert.ok(full.lifecycle.length > standard.lifecycle.length);
      assert.ok(Number(full.planning) + Number(full.sprints) + Number(full.approvals) >= Number(standard.planning) + Number(standard.sprints) + Number(standard.approvals));
    });

    it("descriptors are frozen, shared, and input-independent", () => {
      const first = getWorkModeDescriptor("full");
      const second = getWorkModeDescriptor("full");
      assert.equal(first, second, "canonical object shared, not rebuilt");
      assert.ok(Object.isFrozen(first) && Object.isFrozen(first.lifecycle));
      const mode: WorkMode = "standard";
      assert.equal(getWorkModeDescriptor(mode).id, "standard");
    });
  });

  describe("stability and determinism", () => {
    it("validation is synchronous, pure, and environment-free", () => {
      assert.equal(validateWorkMode("fast"), validateWorkMode("fast"));
      assert.equal(JSON.stringify(getWorkModeDescriptor("standard")), JSON.stringify(getWorkModeDescriptor("standard")));
      assert.ok(!JSON.stringify(WORK_MODE_DESCRIPTORS).match(/20\d\d|tmp|random|uuid|session/i));
    });

    it("no default mode is defined", () => {
      const code = codeLines();
      assert.ok(!/default/i.test(code.replace(/\*.*$/gm, "")), "no default mode in code");
      const source = readFileSync(WORK_MODE_SOURCE, "utf8");
      assert.ok(!source.includes("DEFAULT_MODE") && !source.includes("defaultMode"));
    });
  });

  describe("no execution, dependencies, state, or future work", () => {
    it("imports only the role identity type", () => {
      const imports = readFileSync(WORK_MODE_SOURCE, "utf8")
        .split("\n")
        .filter((line) => line.trim().startsWith("import "));
      assert.deepEqual(imports, ['import { RoleId } from "../roles/contract";']);
    });

    it("references no executors, providers, transports, or dispatch", () => {
      const code = codeLines();
      for (const forbidden of [
        "execute",
        "Coordinator",
        "Implementer",
        "Reviewer",
        "Provider",
        "provider",
        "dispatch",
        "delegate",
        "Delegate",
        "transport",
        "opencode",
        "github",
        "spawn",
        "node:",
      ]) {
        assert.ok(!code.includes(forbidden), `mode code never mentions ${forbidden}`);
      }
    });

    it("creates no runners, recommendations, guardrails, persistence, or state", () => {
      const code = codeLines();
      for (const forbidden of [
        "runFast",
        "runStandard",
        "runFull",
        "runWorkMode",
        "recommend",
        "guardrail",
        "validateModeForTask",
        "persist",
        "writeFile",
        ".ai-team",
        "configure",
        "state",
        "orchestrat",
        "reentry",
        "re-enter",
        "retry",
        "fallback",
        "FAST",
        "STANDARD",
        "FULL",
      ]) {
        assert.ok(!code.includes(forbidden), `mode code never mentions ${forbidden}`);
      }
    });

    it("carries no approval-state, priority, cost, or quality semantics", () => {
      const code = codeLines();
      for (const forbidden of [
        "approved",
        "changes-required",
        "Approval",
        "priority",
        "timeout",
        "budget",
        "tier",
        "quality",
        "cost",
        "ranking",
        "better",
        "best",
      ]) {
        assert.ok(!code.includes(forbidden), `mode code never mentions ${forbidden}`);
      }
      assert.ok(code.includes("approvals"), "composition flag approvals is the documented declarative policy");
    });

    it("mode and role namespaces stay separate", () => {
      assert.ok(!isWorkMode("coordinator") && !isWorkMode("implementer"));
      const code = codeLines();
      assert.ok(!code.includes("RoleId =") && !code.includes("ROLE_IDS"));
    });
  });
});
