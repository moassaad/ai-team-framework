import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  SPECIFICATION_ARTIFACTS,
  SpecificationArtifact,
  SpecificationProvider,
  SpecificationRequest,
  isSpecificationArtifactKind,
  isSpecificationProvider,
  validateSpecificationArtifact,
  validateSpecificationRequest,
} from "../src/providers/specification";

// Specification-provider tests: contract shape only, no adapter.
describe("specification provider contract", () => {
  it("validates and freezes requests and artifacts", () => {
    assert.deepEqual(SPECIFICATION_ARTIFACTS, ["specification", "plan"]);
    assert.equal(isSpecificationArtifactKind("specification"), true);
    assert.equal(isSpecificationArtifactKind("plan"), true);
    assert.equal(isSpecificationArtifactKind("tasks"), false);
    const request = validateSpecificationRequest({
      requirements: "Build a shop.",
      project_root: "/proj",
      artifact: "plan",
    });
    assert.deepEqual(request, { requirements: "Build a shop.", project_root: "/proj", artifact: "plan" });
    assert.equal(Object.isFrozen(request), true);
    const artifact = validateSpecificationArtifact({ artifact: "plan", content: "# Plan" });
    assert.deepEqual(artifact, { artifact: "plan", content: "# Plan" });
    assert.equal(Object.isFrozen(artifact), true);
    for (const data of [
      null,
      "x",
      [],
      {},
      { requirements: "", project_root: "/proj", artifact: "plan" },
      { requirements: "Build.", project_root: "", artifact: "plan" },
      { requirements: "Build.", project_root: "/proj", artifact: "tasks" },
      { requirements: "Build.", project_root: "/proj" },
      { project_root: "/proj", artifact: "plan" },
    ]) {
      assert.throws(() => validateSpecificationRequest(data), /specification provider: invalid input/);
    }
    for (const data of [null, {}, { artifact: "plan", content: "" }, { artifact: "checklist", content: "# C" }, { content: "# C" }]) {
      assert.throws(() => validateSpecificationArtifact(data), /specification provider: invalid input/);
    }
  });

  it("accepts a fake provider and supports async generation", async () => {
    const seen: SpecificationRequest[] = [];
    const fake: SpecificationProvider = {
      name: "fake",
      generate: async (request) => {
        seen.push(request);
        const artifact: SpecificationArtifact = {
          artifact: request.artifact,
          content: `# ${request.artifact} for ${request.project_root}`,
        };
        return validateSpecificationArtifact(artifact);
      },
    };
    assert.equal(isSpecificationProvider(fake), true);
    const request = validateSpecificationRequest({
      requirements: "Build a shop.",
      project_root: "/proj",
      artifact: "specification",
    });
    assert.deepEqual(await fake.generate(request), {
      artifact: "specification",
      content: "# specification for /proj",
    });
    assert.deepEqual(seen, [request]);
    assert.equal(isSpecificationProvider(null), false);
    assert.equal(isSpecificationProvider({}), false);
    assert.equal(isSpecificationProvider({ name: "", generate: async () => ({}) }), false);
    assert.equal(isSpecificationProvider({ name: "x" }), false);
  });

  it("round-trips plain serializable data", () => {
    const request = validateSpecificationRequest({
      requirements: "Build a shop.",
      project_root: "/proj",
      artifact: "plan",
    });
    assert.deepEqual(JSON.parse(JSON.stringify(request)), {
      requirements: "Build a shop.",
      project_root: "/proj",
      artifact: "plan",
    });
    assert.deepEqual(JSON.parse(JSON.stringify(validateSpecificationArtifact({ artifact: "plan", content: "# P" }))), {
      artifact: "plan",
      content: "# P",
    });
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/specification");
    assert.deepEqual(Object.keys(module).sort(), [
      "SPECIFICATION_ARTIFACTS",
      "isSpecificationArtifactKind",
      "isSpecificationProvider",
      "validateSpecificationArtifact",
      "validateSpecificationRequest",
    ]);
  });

  it("names no external tool, command, path, transport, or role machinery", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "providers", "specification.ts"), "utf8");
    assert.ok(!/spec[\s_-]?kit/i.test(code), "no adapter naming");
    assert.ok(!/specify|slash|github|opencode/i.test(code), "no adapter concepts");
    assert.ok(!/child_process|execSync|spawn|fetch\(|http:|https:|node:/.test(code), "no transport");
    assert.ok(!/RoleId|responsib|workflow|approval|cli/i.test(code), "no role/workflow/cli embedding");
  });

  it("carries no execution policy, result expansion, or secret handling", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "providers", "specification.ts"), "utf8");
    assert.ok(!/setTimeout|timeout|retry|backoff/i.test(code), "no execution policy");
    assert.ok(!/stdout|stderr|exit_code|token|model|session|cost/i.test(code), "no result expansion");
    assert.ok(!/env\b|process\.env|secret|credential/i.test(code), "no secret handling");
  });
});