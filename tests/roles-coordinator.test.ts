import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { COORDINATOR_ROLE } from "../src/roles/coordinator";
import { isRoleId } from "../src/roles/contract";

// Coordinator-contract tests only: they pin the R-002 definition.
// No runtime, routing, selection, workflow, or provider behavior.
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

describe("coordinator contract", () => {
  it("uses the canonical coordinator identity", () => {
    assert.equal(COORDINATOR_ROLE.id, "coordinator");
    assert.equal(COORDINATOR_ROLE.name, "Coordinator");
    assert.equal(isRoleId(COORDINATOR_ROLE.id), true);
  });

  it("owns coordination without claiming specialized work", () => {
    const duties = COORDINATOR_ROLE.responsibilities.join("\n");
    assert.match(duties, /receive user requests/);
    assert.match(duties, /appropriate role/);
    assert.match(duties, /progress and results/);
    assert.equal(/implement/i.test(duties), false);
    assert.equal(/technical planning/i.test(duties), false);

    const boundaries = COORDINATOR_ROLE.non_responsibilities.join("\n");
    assert.match(boundaries, /replace the Technical Lead/);
    assert.match(boundaries, /implement tickets owned by the Implementer/);
    assert.match(boundaries, /technical planning decisions/);
    assert.match(boundaries, /review implementation/);
  });

  it("grants coordination decisions while escalating specialized ones", () => {
    const granted = COORDINATOR_ROLE.decision_authority.can_decide.join("\n");
    assert.match(granted, /which role handles a given request/);
    assert.equal(/technical decision/i.test(granted), false);
    assert.equal(/requirements.*decision|scope decision/i.test(granted), false);

    const escalated = COORDINATOR_ROLE.decision_authority.must_escalate.join("\n");
    assert.match(escalated, /Technical Lead/);
    assert.match(escalated, /Project Manager/);
    assert.match(escalated, /Implementer/);
    assert.match(escalated, /Senior Reviewer/);
    assert.ok(Array.isArray(COORDINATOR_ROLE.decision_authority.requires_user_approval));
  });

  it("uses only valid contract artifacts for inputs and outputs", () => {
    assert.ok(COORDINATOR_ROLE.inputs.length > 0);
    assert.ok(COORDINATOR_ROLE.outputs.length > 0);
    for (const artifact of [...COORDINATOR_ROLE.inputs, ...COORDINATOR_ROLE.outputs]) {
      assert.ok(
        (KNOWN_ARTIFACTS as readonly string[]).includes(artifact),
        `unknown artifact: ${artifact}`,
      );
    }
    assert.ok(COORDINATOR_ROLE.inputs.includes("user_request"));
  });

  it("collaborates with all four specialized roles", () => {
    const partners = COORDINATOR_ROLE.collaboration.map((link) => link.role).sort();
    assert.deepEqual(partners, [
      "implementer",
      "project-manager",
      "senior-reviewer",
      "technical-lead",
    ]);
  });

  it("sets no Implementer specialties", () => {
    assert.equal(COORDINATOR_ROLE.specialties, undefined);
  });
});
