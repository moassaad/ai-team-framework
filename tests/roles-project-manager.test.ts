import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PROJECT_MANAGER_ROLE } from "../src/roles/project-manager";
import { isRoleId } from "../src/roles/contract";

// Project-Manager-contract tests only: they pin the R-003 definition.
// No runtime, planning engines, approval handling, or provider behavior.
const KNOWN_ARTIFACTS: readonly string[] = [
  "user_request",
  "requirements",
  "project_context",
  "technical_context",
  "ticket",
  "implementation_result",
  "review_result",
  "approval_decision",
];

describe("project manager contract", () => {
  it("uses the canonical project manager identity", () => {
    assert.equal(PROJECT_MANAGER_ROLE.id, "project-manager");
    assert.equal(PROJECT_MANAGER_ROLE.name, "Project Manager");
    assert.equal(isRoleId(PROJECT_MANAGER_ROLE.id), true);
  });

  it("owns requirements without claiming technical planning", () => {
    const duties = PROJECT_MANAGER_ROLE.responsibilities.join("\n");
    assert.match(duties, /collect requirements/);
    assert.match(duties, /project plans/);
    assert.match(duties, /missing requirements/);
    assert.match(duties, /implementation matches agreed requirements/);
    assert.equal(/technical planning/i.test(duties), false);
    assert.equal(/implement tickets|write code|modify.*code/i.test(duties), false);

    const boundaries = PROJECT_MANAGER_ROLE.non_responsibilities.join("\n");
    assert.match(boundaries, /low-level technical planning/);
    assert.match(boundaries, /architecture decisions/);
    assert.match(boundaries, /implementing tickets/);
    assert.match(boundaries, /reviewing implementation code/);
  });

  it("decides requirements matters without technical or workflow control", () => {
    const granted = PROJECT_MANAGER_ROLE.decision_authority.can_decide.join("\n");
    assert.match(granted, /requirements organization/);
    assert.match(granted, /sufficiently clear to proceed/);
    assert.match(granted, /requirements acceptance/);
    assert.equal(/business acceptance/i.test(granted), false);
    assert.equal(/technical planning|architecture decision|close ticket|state transition/i.test(granted), false);

    const escalated = PROJECT_MANAGER_ROLE.decision_authority.must_escalate.join("\n");
    assert.match(escalated, /Technical Lead/);
    assert.match(escalated, /Implementer/);
    assert.ok(Array.isArray(PROJECT_MANAGER_ROLE.decision_authority.requires_user_approval));
  });

  it("uses only valid contract artifacts for inputs and outputs", () => {
    assert.ok(PROJECT_MANAGER_ROLE.inputs.length > 0);
    assert.ok(PROJECT_MANAGER_ROLE.outputs.length > 0);
    for (const artifact of [...PROJECT_MANAGER_ROLE.inputs, ...PROJECT_MANAGER_ROLE.outputs]) {
      assert.ok(
        (KNOWN_ARTIFACTS as readonly string[]).includes(artifact),
        `unknown artifact: ${artifact}`,
      );
    }
    assert.ok(PROJECT_MANAGER_ROLE.inputs.includes("user_request"));
    assert.ok(PROJECT_MANAGER_ROLE.outputs.includes("requirements"));
  });

  it("collaborates with all four other roles", () => {
    const partners = PROJECT_MANAGER_ROLE.collaboration.map((link) => link.role).sort();
    assert.deepEqual(partners, [
      "coordinator",
      "implementer",
      "senior-reviewer",
      "technical-lead",
    ]);
  });

  it("sets no Implementer specialties", () => {
    assert.equal(PROJECT_MANAGER_ROLE.specialties, undefined);
  });
});
