import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { COORDINATOR_ROLE } from "../src/roles/coordinator";
import { PROJECT_MANAGER_ROLE } from "../src/roles/project-manager";
import { TECHNICAL_LEAD_ROLE } from "../src/roles/technical-lead";
import { IMPLEMENTER_ROLE } from "../src/roles/implementer";
import { SENIOR_REVIEWER_ROLE } from "../src/roles/senior-reviewer";
import { RoleContract } from "../src/roles/contract";
import { renderRolePrompt, validateRolePromptInput } from "../src/providers/prompt";

// Prompt-renderer tests: public behavior only, no provider execution.
describe("role prompt renderer", () => {
  const roles: Array<[id: string, contract: RoleContract]> = [
    ["coordinator", COORDINATOR_ROLE],
    ["project-manager", PROJECT_MANAGER_ROLE],
    ["technical-lead", TECHNICAL_LEAD_ROLE],
    ["implementer", IMPLEMENTER_ROLE],
    ["senior-reviewer", SENIOR_REVIEWER_ROLE],
  ];

  it("renders every canonical role with identity, responsibilities, and boundaries", () => {
    for (const [id, role] of roles) {
      const prompt = renderRolePrompt({ role, task: "Do the thing." });
      assert.equal(typeof prompt, "string");
      assert.ok(prompt.includes(`(${id})`), id);
      assert.ok(prompt.includes(role.name), id);
      assert.ok(prompt.includes(role.purpose), id);
      for (const item of role.responsibilities) {
        assert.ok(prompt.includes(item), `${id}: ${item}`);
      }
      for (const item of role.non_responsibilities) {
        assert.ok(prompt.includes(item), `${id}: ${item}`);
      }
      assert.ok(prompt.includes("Do the thing."), id);
    }
  });

  it("keeps role responsibilities separate", () => {
    const coordinator = renderRolePrompt({ role: COORDINATOR_ROLE, task: "Route this." });
    assert.ok(!coordinator.includes("receive an assigned ticket"));
    assert.ok(!coordinator.includes("review implementation against the assigned ticket"));
    const reviewer = renderRolePrompt({ role: SENIOR_REVIEWER_ROLE, task: "Review this." });
    assert.ok(reviewer.includes("modify implementation code"));
    assert.ok(!reviewer.includes("receive an assigned ticket"));
    const implementer = renderRolePrompt({ role: IMPLEMENTER_ROLE, task: "Build this." });
    assert.ok(implementer.includes("receive an assigned ticket"));
    assert.ok(!implementer.includes("review implementation against the assigned ticket"));
    const lead = renderRolePrompt({ role: TECHNICAL_LEAD_ROLE, task: "Plan this." });
    assert.ok(lead.includes("decompose work into small implementation tickets"));
    assert.ok(!lead.includes("receive an assigned ticket"));
  });

  it("includes an already-resolved implementer specialty and rejects the rest", () => {
    const prompt = renderRolePrompt({ role: IMPLEMENTER_ROLE, specialty: "backend", task: "Build it." });
    assert.ok(prompt.includes("Specialty: backend."));
    assert.throws(
      () => renderRolePrompt({ role: COORDINATOR_ROLE, specialty: "backend", task: "Route it." }),
      /implementer role only/,
    );
    assert.throws(
      () => renderRolePrompt({ role: IMPLEMENTER_ROLE, specialty: "wizard" as unknown as "backend", task: "Build it." }),
      /unknown specialty/,
    );
  });

  it("rejects aliases and fuzzy names instead of resolving them", () => {
    for (const id of ["pm", "tl", "reviewer", "Coordinator", "implementer backend", ""]) {
      assert.throws(
        () =>
          renderRolePrompt({
            role: { ...COORDINATOR_ROLE, id } as unknown as RoleContract,
            task: "Go.",
          }),
        /unknown role/,
        id || "(empty)",
      );
    }
    assert.throws(() => validateRolePromptInput({ task: "Go." }), /role must be/);
    assert.throws(() => validateRolePromptInput({ role: COORDINATOR_ROLE, task: "" }), /task must be/);
  });

  it("incorporates project, discovery, and task context verbatim", () => {
    const prompt = renderRolePrompt({
      role: TECHNICAL_LEAD_ROLE,
      task: "Plan the \"quoted\" $thing.",
      project: { root: "/proj", name: "shop", kind: "existing" },
      discovery_summary: "languages: typescript. database: unknown.",
    });
    assert.ok(prompt.includes("Project root: /proj (shop)"));
    assert.ok(prompt.includes("languages: typescript. database: unknown."));
    assert.ok(prompt.includes('Plan the "quoted" $thing.'));
  });

  it("renders valid prompts for unknown-stack projects", () => {
    const prompt = renderRolePrompt({ role: COORDINATOR_ROLE, task: "Help." });
    assert.ok(prompt.includes("# Coordinator (coordinator)"));
    assert.ok(!prompt.includes("Project root:"));
    assert.ok(!prompt.includes("Discovery summary:"));
  });

  it("is deterministic and free of host metadata", () => {
    const input = {
      role: IMPLEMENTER_ROLE,
      specialty: "backend" as const,
      task: "Build it.",
      project: { root: "/proj" },
      discovery_summary: "backend_framework: express 4.18.2.",
    };
    assert.equal(renderRolePrompt(input), renderRolePrompt(input));
    const prompt = renderRolePrompt(input);
    assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(prompt));
    assert.ok(!/uuid|hostname|process\.env|OPENCODE/i.test(prompt));
    assert.ok(!prompt.includes(process.cwd()));
  });

  it("returns a string, never an execution-result object", () => {
    const prompt = renderRolePrompt({ role: COORDINATOR_ROLE, task: "Go." });
    assert.equal(typeof prompt, "string");
    assert.ok(!/exit_code|stdout|stderr|token_usage/i.test(prompt));
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/prompt");
    assert.deepEqual(Object.keys(module).sort(), ["renderRolePrompt", "validateRolePromptInput"]);
  });

  it("touches no filesystem, provider, network, or failure machinery", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "providers", "prompt.ts"), "utf8");
    assert.ok(!/readFileSync|writeFileSync|statSync|readdirSync|node:fs/i.test(code), "no filesystem");
    assert.ok(!/detectProject|discovery detector/i.test(code), "no detector calls");
    assert.ok(!/opencode|spawn|child_process|fetch\(|http/i.test(code), "no provider execution");
    assert.ok(!/setTimeout|AbortController|timeout|retry/i.test(code), "no failure machinery");
  });
});