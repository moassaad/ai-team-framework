import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SLASH_ALIASES,
  findSlashAlias,
} from "../src/roles/slash";
import {
  IMPLEMENTER_SPECIALTIES,
  isImplementerSpecialty,
} from "../src/roles/contract";

// Slash-alias contract tests only (official CLI-005): the alias table
// itself. No host parsing, CLI dispatch, providers, or execution.
describe("slash alias contract", () => {
  it("defines exactly the five approved role aliases", () => {
    assert.deepEqual(SLASH_ALIASES.map((alias) => alias.command).sort(), [
      "/coordinator",
      "/implementer",
      "/project-manager",
      "/senior-reviewer",
      "/technical-lead",
    ]);
  });

  it("maps each alias to its canonical role id", () => {
    const expected: Array<[string, string]> = [
      ["/coordinator", "coordinator"],
      ["/project-manager", "project-manager"],
      ["/technical-lead", "technical-lead"],
      ["/implementer", "implementer"],
      ["/senior-reviewer", "senior-reviewer"],
    ];
    for (const [command, role] of expected) {
      assert.deepEqual(findSlashAlias(command), {
        command,
        role,
        specialtyAllowed: role === "implementer",
      });
    }
  });

  it("permits specialty selection only for Implementer", () => {
    for (const alias of SLASH_ALIASES) {
      assert.equal(alias.specialtyAllowed, alias.role === "implementer");
    }
  });

  it("recognizes the six approved specialties through the existing union", () => {
    assert.deepEqual([...IMPLEMENTER_SPECIALTIES].sort(), [
      "backend",
      "database",
      "documentation",
      "frontend",
      "integration",
      "testing",
    ]);
    for (const specialty of IMPLEMENTER_SPECIALTIES) {
      assert.equal(isImplementerSpecialty(specialty), true);
    }
  });

  it("introduces no unapproved aliases or duplicate roles", () => {
    for (const command of ["/pm", "/tl", "/sr", "/reviewer", "/tech", "/implementer backend"]) {
      assert.equal(findSlashAlias(command), undefined, `must not exist: ${command}`);
    }
    const roles = SLASH_ALIASES.map((alias) => alias.role);
    assert.equal(new Set(roles).size, roles.length);
  });

  it("is immutable, deterministic, and host-neutral", () => {
    assert.equal(Object.isFrozen(SLASH_ALIASES), true);
    assert.deepEqual(findSlashAlias("/technical-lead"), findSlashAlias("/technical-lead"));
    assert.deepEqual(findSlashAlias("/unknown"), undefined);
  });
});
