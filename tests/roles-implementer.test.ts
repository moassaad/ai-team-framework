import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { IMPLEMENTER_ROLE } from "../src/roles/implementer";
import {
  IMPLEMENTER_SPECIALTIES,
  ROLE_IDS,
  isImplementerSpecialty,
  isRoleId,
} from "../src/roles/contract";

// Implementer-contract tests only: they pin the R-005 definition.
// No execution engines, routing, selection, workflow, or providers.
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

describe("implementer contract", () => {
  it("uses the canonical implementer identity", () => {
    assert.equal(IMPLEMENTER_ROLE.id, "implementer");
    assert.equal(IMPLEMENTER_ROLE.name, "Implementer");
    assert.equal(isRoleId(IMPLEMENTER_ROLE.id), true);
  });

  it("owns ticket execution without planning or architecture authority", () => {
    const duties = IMPLEMENTER_ROLE.responsibilities.join("\n");
    assert.match(duties, /work on one ticket at a time/);
    assert.match(duties, /implement the ticket within its scope/);
    assert.match(duties, /tests/);
    assert.match(duties, /validation/);
    assert.match(duties, /report implementation status/);
    assert.equal(/technical planning|architecture decision|requirements decision/i.test(duties), false);

    const boundaries = IMPLEMENTER_ROLE.non_responsibilities.join("\n");
    assert.match(boundaries, /requirements and scope/);
    assert.match(boundaries, /technical planning/);
    assert.match(boundaries, /architecture decisions/);
    assert.match(boundaries, /technical acceptance/);
  });

  it("grants only local implementation decisions", () => {
    const granted = IMPLEMENTER_ROLE.decision_authority.can_decide.join("\n");
    assert.match(granted, /implementation details/);
    assert.match(granted, /fixes required to satisfy acceptance criteria/);
    assert.equal(
      /requirements|architecture|scope change|technical acceptance|business acceptance|user approval|workflow state/i.test(
        granted,
      ),
      false,
    );
    assert.ok(Array.isArray(IMPLEMENTER_ROLE.decision_authority.requires_user_approval));
    assert.equal(IMPLEMENTER_ROLE.decision_authority.requires_user_approval.length, 0);
  });

  it("uses only valid contract artifacts for inputs and outputs", () => {
    assert.ok(IMPLEMENTER_ROLE.inputs.length > 0);
    assert.ok(IMPLEMENTER_ROLE.outputs.length > 0);
    for (const artifact of [...IMPLEMENTER_ROLE.inputs, ...IMPLEMENTER_ROLE.outputs]) {
      assert.ok(
        (KNOWN_ARTIFACTS as readonly string[]).includes(artifact),
        `unknown artifact: ${artifact}`,
      );
    }
    assert.ok(IMPLEMENTER_ROLE.inputs.includes("ticket"));
    assert.ok(IMPLEMENTER_ROLE.outputs.includes("implementation_result"));
  });

  it("restricts specialties to Implementer using valid specialty values", () => {
    assert.ok(IMPLEMENTER_ROLE.specialties !== undefined);
    assert.deepEqual([...IMPLEMENTER_ROLE.specialties].sort(), [...IMPLEMENTER_SPECIALTIES].sort());
    for (const specialty of IMPLEMENTER_ROLE.specialties) {
      assert.equal(isImplementerSpecialty(specialty), true);
      assert.equal(isRoleId(specialty), false);
    }
    for (const id of ROLE_IDS) {
      assert.equal(isImplementerSpecialty(id), false);
    }
  });

  it("collaborates with all four other roles for assignment and review", () => {
    const partners = IMPLEMENTER_ROLE.collaboration.map((link) => link.role).sort();
    assert.deepEqual(partners, [
      "coordinator",
      "project-manager",
      "senior-reviewer",
      "senior-reviewer",
      "technical-lead",
      "technical-lead",
    ]);
    const assignment = IMPLEMENTER_ROLE.collaboration.some(
      (link) => link.role === "technical-lead" && link.direction === "receives_from",
    );
    const review = IMPLEMENTER_ROLE.collaboration.some(
      (link) => link.role === "senior-reviewer" && link.direction === "sends_to",
    );
    assert.equal(assignment, true);
    assert.equal(review, true);
  });
});
