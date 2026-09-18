import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TECHNICAL_LEAD_ROLE } from "../src/roles/technical-lead";
import { isRoleId } from "../src/roles/contract";

// Technical-Lead-contract tests only: they pin the R-004 definition.
// No runtime, discovery engines, ticket generation, or provider behavior.
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

describe("technical lead contract", () => {
  it("uses the canonical technical lead identity", () => {
    assert.equal(TECHNICAL_LEAD_ROLE.id, "technical-lead");
    assert.equal(TECHNICAL_LEAD_ROLE.name, "Technical Lead");
    assert.equal(isRoleId(TECHNICAL_LEAD_ROLE.id), true);
  });

  it("owns technical planning while disclaiming business acceptance", () => {
    const duties = TECHNICAL_LEAD_ROLE.responsibilities.join("\n");
    assert.match(duties, /analyze the project technically/);
    assert.match(duties, /small implementation tickets/);
    assert.match(duties, /dependencies/);
    assert.match(duties, /technical acceptance criteria/);
    assert.match(duties, /non-sensitive technical decisions/);
    assert.equal(/business acceptance|product ownership|direct implementation/i.test(duties), false);

    const boundaries = TECHNICAL_LEAD_ROLE.non_responsibilities.join("\n");
    assert.match(boundaries, /business acceptance/);
    assert.match(boundaries, /requirements/);
    assert.match(boundaries, /direct implementation/);
    assert.match(boundaries, /workflow state-machine enforcement/);
  });

  it("bounds technical acceptance to defined technical criteria", () => {
    const granted = TECHNICAL_LEAD_ROLE.decision_authority.can_decide.join("\n");
    assert.match(granted, /technical approach selection/);
    assert.match(
      granted,
      /whether implementation satisfies defined technical criteria or requires technical rework/,
    );
    assert.match(granted, /specialization assignment/);
    assert.equal(/business acceptance|product acceptance|requirements ownership|final user approval/i.test(granted), false);
    assert.ok(Array.isArray(TECHNICAL_LEAD_ROLE.decision_authority.requires_user_approval));
    assert.equal(TECHNICAL_LEAD_ROLE.decision_authority.requires_user_approval.length, 0);
  });

  it("uses only valid contract artifacts for inputs and outputs", () => {
    assert.ok(TECHNICAL_LEAD_ROLE.inputs.length > 0);
    assert.ok(TECHNICAL_LEAD_ROLE.outputs.length > 0);
    for (const artifact of [...TECHNICAL_LEAD_ROLE.inputs, ...TECHNICAL_LEAD_ROLE.outputs]) {
      assert.ok(
        (KNOWN_ARTIFACTS as readonly string[]).includes(artifact),
        `unknown artifact: ${artifact}`,
      );
    }
    assert.ok(TECHNICAL_LEAD_ROLE.outputs.includes("ticket"));
  });

  it("collaborates with all four other roles in both directions", () => {
    const partners = TECHNICAL_LEAD_ROLE.collaboration.map((link) => link.role).sort();
    assert.deepEqual(partners, [
      "coordinator",
      "implementer",
      "implementer",
      "project-manager",
      "senior-reviewer",
    ]);
    const directions = new Set(TECHNICAL_LEAD_ROLE.collaboration.map((link) => link.direction));
    assert.ok(directions.has("sends_to"));
    assert.ok(directions.has("receives_from"));
    assert.ok(directions.has("bidirectional"));
  });

  it("sets no Implementer specialties", () => {
    assert.equal(TECHNICAL_LEAD_ROLE.specialties, undefined);
  });
});
