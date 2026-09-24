import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli";
import { IMPLEMENTER_SPECIALTIES, ROLE_IDS } from "../src/roles/contract";
import { resolvePromptRole } from "../src/roles/prompt";
import {
  resolveImplementerSpecialty,
  resolveRole,
} from "../src/roles/selection";
import { resolveSlashCommand } from "../src/roles/slash";

// Role-selection contract tests (T-004): gaps beyond the per-module
// suites (roles-selection, roles-slash, roles-prompt, cli-run) —
// non-string input, extended near-miss rejection, full specialty
// normalization, role/specialty separation in both directions, and
// cross-interface consistency. No new matching semantics.
describe("role selection contract", () => {
  it("rejects non-string input without throwing", () => {
    for (const input of [42, 0, true, null, undefined, {}, ["pm"]]) {
      assert.equal(
        resolveRole(input as unknown as string),
        undefined,
        `role: ${String(input)}`,
      );
      assert.equal(
        resolveImplementerSpecialty(input as unknown as string),
        undefined,
        `specialty: ${String(input)}`,
      );
      assert.equal(
        resolvePromptRole(input as unknown as string),
        undefined,
        `prompt: ${String(input)}`,
      );
      assert.equal(
        resolveSlashCommand(input as unknown as string),
        undefined,
        `slash: ${String(input)}`,
      );
    }
  });

  it("rejects near misses without fuzzy matching", () => {
    for (const input of [
      "technicalleader",
      "tech-lead-ish",
      "techlead",
      "project managerr",
      "projectmanager",
      "implementers",
      "coordinatorr",
      "senior_reviewer",
      "seniorreviewer",
      "t-l",
      "p m",
      "s r",
      "reviewers",
      "-pm-",
      "lead",
      "manager",
    ]) {
      assert.equal(resolveRole(input), undefined, `should not resolve: ${input}`);
    }
  });

  it("normalizes every specialty through case and whitespace", () => {
    for (const specialty of IMPLEMENTER_SPECIALTIES) {
      assert.equal(resolveImplementerSpecialty(specialty), specialty);
      assert.equal(
        resolveImplementerSpecialty(`  ${specialty.toUpperCase()}  `),
        specialty,
        specialty,
      );
      assert.equal(resolveRole(specialty), undefined, `${specialty} is not a role`);
    }
  });

  it("rejects every role id as a specialty", () => {
    for (const role of ROLE_IDS) {
      assert.equal(
        resolveImplementerSpecialty(role),
        undefined,
        `${role} is not a specialty`,
      );
    }
    assert.equal(resolveImplementerSpecialty("implementer"), undefined);
  });

  it("resolves aliases only for their documented role", () => {
    assert.deepEqual(resolveRole("coordinator"), {
      role: "coordinator",
      source: "canonical",
    });
    assert.deepEqual(resolveRole("implementer"), {
      role: "implementer",
      source: "canonical",
    });
    // No alias exists for coordinator or implementer.
    for (const input of ["coord", "impl", "dev", "coder"]) {
      assert.equal(resolveRole(input), undefined, `should not resolve: ${input}`);
    }
  });

  it("applies the same normalization through the CLI role flag", () => {
    const upper = run(["run", "--role", "TL"], "0.1.0");
    assert.equal(upper.exitCode, 0);
    assert.ok(upper.stdout.includes("Technical Lead (technical-lead)"));
    const spaced = run(["run", "--role", "  Project-Manager "], "0.1.0");
    assert.equal(spaced.exitCode, 0);
    assert.ok(spaced.stdout.includes("Project Manager (project-manager)"));
    const aliasUpper = run(["run", "--role", "SR"], "0.1.0");
    assert.equal(aliasUpper.exitCode, 0);
    assert.ok(aliasUpper.stdout.includes("Senior Reviewer (senior-reviewer)"));
  });

  it("rejects roles as CLI specialties and specialties as CLI roles", () => {
    for (const argv of [
      ["run", "--role", "implementer", "--specialty", "technical-lead"],
      ["run", "--role", "implementer", "--specialty", "coordinator"],
      ["run", "--role", "backend"],
      ["run", "--role", "Backend"],
    ]) {
      const result = run(argv, "0.1.0");
      assert.equal(result.exitCode, 1, `must reject ${JSON.stringify(argv)}`);
      assert.equal(result.stdout, "");
    }
  });

  it("lands every interface on the same role contract", () => {
    const viaFlag = run(["run", "--role", "tl"], "0.1.0");
    const viaPrompt = run(["run", "talk to the tech lead"], "0.1.0");
    const viaSlash = run(["run", "/technical-lead"], "0.1.0");
    for (const result of [viaFlag, viaPrompt, viaSlash]) {
      assert.equal(result.exitCode, 0);
    }
    const firstLine = (stdout: string): string => stdout.split("\n")[0];
    assert.equal(firstLine(viaFlag.stdout), "Technical Lead (technical-lead)");
    assert.equal(firstLine(viaPrompt.stdout), firstLine(viaFlag.stdout));
    assert.equal(firstLine(viaSlash.stdout), firstLine(viaFlag.stdout));
  });

  it("matches prompt keywords inside mixed-language text by the English keyword", () => {
    assert.equal(resolvePromptRole("تصرف كـ Project Manager."), "project-manager");
    assert.equal(resolvePromptRole("Act as the Technical Lead."), "technical-lead");
  });

  it("resolves deterministically across repeated mixed inputs", () => {
    const inputs = ["TL", "  pm  ", "reviewer", "backend", "talk to the tech lead", "/sr"];
    const first = inputs.map((input) => ({
      role: resolveRole(input),
      prompt: resolvePromptRole(input),
      slash: resolveSlashCommand(input),
    }));
    const second = inputs.map((input) => ({
      role: resolveRole(input),
      prompt: resolvePromptRole(input),
      slash: resolveSlashCommand(input),
    }));
    assert.deepEqual(first, second);
  });
});
