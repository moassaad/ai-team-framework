import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ROLE_ALIASES,
  resolveImplementerSpecialty,
  resolveRole,
} from "../src/roles/selection";
import {
  IMPLEMENTER_SPECIALTIES,
  ROLE_IDS,
  RoleId,
} from "../src/roles/contract";

// Selection-rule tests only: deterministic mapping behavior.
// No CLI, routing, invocation, inference, or orchestration.
describe("role selection", () => {
  it("resolves every canonical ID to itself", () => {
    for (const id of ROLE_IDS) {
      assert.deepEqual(resolveRole(id), { role: id, source: "canonical" });
    }
  });

  it("normalizes whitespace and case deterministically", () => {
    assert.deepEqual(resolveRole("  Technical-Lead "), {
      role: "technical-lead",
      source: "canonical",
    });
    assert.deepEqual(resolveRole("PM"), { role: "project-manager", source: "alias" });
    assert.deepEqual(resolveRole("pm"), resolveRole("  PM "));
  });

  it("resolves each alias to exactly one canonical role", () => {
    assert.deepEqual(resolveRole("pm"), { role: "project-manager", source: "alias" });
    assert.deepEqual(resolveRole("tl"), { role: "technical-lead", source: "alias" });
    assert.deepEqual(resolveRole("reviewer"), {
      role: "senior-reviewer",
      source: "alias",
    });
    assert.deepEqual(resolveRole("sr"), { role: "senior-reviewer", source: "alias" });
  });

  it("keeps aliases collision-free", () => {
    const canonical = new Set<string>(ROLE_IDS);
    const specialties = new Set<string>(IMPLEMENTER_SPECIALTIES);
    for (const [alias, role] of Object.entries(ROLE_ALIASES)) {
      assert.equal(canonical.has(alias), false, `alias collides with role id: ${alias}`);
      assert.equal(specialties.has(alias), false, `alias collides with specialty: ${alias}`);
      assert.ok(
        (ROLE_IDS as readonly string[]).includes(role),
        `alias maps to unknown role: ${alias}`,
      );
    }
    // Many-to-one aliasing is intentional and deterministic.
    assert.deepEqual(resolveRole("reviewer"), resolveRole("sr"));
  });

  it("fails unknown input without a fallback role", () => {
    for (const input of [
      "unknown",
      "review",
      "developer",
      "pm-manager",
      "technical",
      "backend",
      "",
      "   ",
    ]) {
      assert.equal(resolveRole(input), undefined, `should not resolve: ${JSON.stringify(input)}`);
    }
  });

  it("does not resolve free-form natural language", () => {
    for (const input of [
      "technical lead",
      "the backend person",
      "handle the backend task",
      "please review my code",
      "I need someone for architecture",
    ]) {
      assert.equal(resolveRole(input), undefined, `should not resolve: ${input}`);
    }
  });

  it("keeps specialty resolution separate from role resolution", () => {
    for (const specialty of IMPLEMENTER_SPECIALTIES) {
      assert.equal(resolveRole(specialty), undefined);
      assert.equal(resolveImplementerSpecialty(specialty), specialty);
    }
    const backend = resolveImplementerSpecialty(" Backend ") as string | undefined;
    assert.equal(backend, "backend");
    assert.equal(resolveImplementerSpecialty("devops"), undefined);
    assert.equal(resolveImplementerSpecialty("coordinator"), undefined);
    const role: RoleId | undefined = resolveRole("backend")?.role;
    assert.equal(role, undefined);
  });
});
