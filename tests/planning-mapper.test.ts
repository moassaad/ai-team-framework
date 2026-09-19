import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mapRequirementsToPlan, validatePlanInput } from "../src/planning/mapper";

// Plan-mapping tests: public behavior only, no providers involved.
describe("requirements to plan mapping", () => {
  it("maps valid input to the required plan representation", () => {
    const plan = mapRequirementsToPlan({
      requirements: "Build a shop.",
      artifact: { artifact: "specification", content: "# Spec" },
    });
    assert.deepEqual(plan, {
      requirements: "Build a shop.",
      basis: "specification",
      specification: "# Spec",
    });
    assert.equal(Object.isFrozen(plan), true);
    assert.deepEqual(mapRequirementsToPlan({
      requirements: "Build a shop.",
      artifact: { artifact: "plan", content: "# Plan" },
    }).basis, "plan");
  });

  it("preserves requirements and artifact content verbatim", () => {
    const requirements = 'Build a "quoted" $shop with\nmultiple lines.';
    const content = "# Spec\n\n- item one\n- item two\n";
    const plan = mapRequirementsToPlan({ requirements, artifact: { artifact: "specification", content } });
    assert.equal(plan.requirements, requirements);
    assert.equal(plan.specification, content);
  });

  it("is deterministic and never mutates inputs", () => {
    const input = {
      requirements: "Build a shop.",
      artifact: { artifact: "plan" as const, content: "# Plan" },
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    const first = mapRequirementsToPlan(input);
    assert.deepEqual(mapRequirementsToPlan(input), first);
    assert.deepEqual(input, snapshot);
  });

  it("rejects invalid input deterministically", () => {
    for (const data of [null, "x", [], {}, { requirements: "", artifact: { artifact: "plan", content: "# P" } }] as unknown[]) {
      assert.throws(() => mapRequirementsToPlan(data as Parameters<typeof mapRequirementsToPlan>[0]), /plan mapping: invalid input/);
    }
    // Artifact validation delegates to the shared P-001 validator.
    for (const data of [
      { requirements: "Build." },
      { requirements: "Build.", artifact: null },
      { requirements: "Build.", artifact: { artifact: "tasks", content: "# T" } },
      { requirements: "Build.", artifact: { artifact: "plan", content: "" } },
    ] as unknown[]) {
      assert.throws(() => mapRequirementsToPlan(data as Parameters<typeof mapRequirementsToPlan>[0]), /invalid input/);
    }
    assert.deepEqual(Object.keys(validatePlanInput({
      requirements: "Build.",
      artifact: { artifact: "plan", content: "# P" },
    })).sort(), ["artifact", "requirements"]);
  });

  it("invents no decomposition fields", () => {
    const plan = mapRequirementsToPlan({
      requirements: "Build a shop.",
      artifact: { artifact: "specification", content: "# Spec" },
    });
    assert.deepEqual(Object.keys(plan).sort(), ["basis", "requirements", "specification"]);
  });

  it("accepts artifacts regardless of provider origin", async () => {
    const fromAdapter = mapRequirementsToPlan({
      requirements: "Build.",
      artifact: { artifact: "plan", content: "# From adapter" },
    });
    const fromFallback = mapRequirementsToPlan({
      requirements: "Build.",
      artifact: { artifact: "plan", content: "# From fallback" },
    });
    assert.equal(fromAdapter.specification, "# From adapter");
    assert.equal(fromFallback.specification, "# From fallback");
    assert.deepEqual(Object.keys(fromAdapter), Object.keys(fromFallback));
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/planning/mapper");
    assert.deepEqual(Object.keys(module).sort(), ["mapRequirementsToPlan", "validatePlanInput"]);
  });

  it("touches no providers, execution, workflow, or external systems", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "planning", "mapper.ts"), "utf8");
    assert.ok(!/speckit|AgentProvider|opencode/i.test(code), "no provider coupling");
    assert.ok(!/child_process|execSync|spawn|fetch\(|http|node:/i.test(code), "no execution");
    assert.ok(!/workflow|approval|cli|github|issue/i.test(code), "no surrounding systems");
    assert.ok(!/setTimeout|timeout|retry/i.test(code), "no execution policy");
  });
});