import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SENIOR_REVIEWER_ROLE } from "../src/roles/senior-reviewer";
import { isRoleId } from "../src/roles/contract";

// Senior-Reviewer-contract tests only: they pin the R-006 definition.
// No review execution, diff analysis, scoring, workflow, or providers.
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

describe("senior reviewer contract", () => {
  it("uses the canonical senior reviewer identity", () => {
    assert.equal(SENIOR_REVIEWER_ROLE.id, "senior-reviewer");
    assert.equal(SENIOR_REVIEWER_ROLE.name, "Senior Reviewer");
    assert.equal(isRoleId(SENIOR_REVIEWER_ROLE.id), true);
  });

  it("covers review duties including the no-changes-required outcome", () => {
    const duties = SENIOR_REVIEWER_ROLE.responsibilities.join("\n");
    assert.match(duties, /review implementation/);
    assert.match(duties, /review relevant tests/);
    assert.match(duties, /agreed requirements/);
    assert.match(duties, /regressions/);
    assert.match(duties, /conventions/);
    assert.match(duties, /request changes/);
    assert.match(duties, /no changes are required/);
  });

  it("explicitly bans code modification in boundaries and constraints", () => {
    const boundaries = SENIOR_REVIEWER_ROLE.non_responsibilities.join("\n");
    assert.match(boundaries, /modify implementation code/);
    assert.match(boundaries, /directly fix the implementation/);
    assert.match(boundaries, /take over the Implementer's ticket/);

    const constraints = SENIOR_REVIEWER_ROLE.constraints.join("\n");
    assert.match(constraints, /never modify implementation code/);
    assert.match(constraints, /remain independent from implementation execution/);
  });

  it("grants advisory review authority without execution or approval power", () => {
    const granted = SENIOR_REVIEWER_ROLE.decision_authority.can_decide.join("\n");
    assert.match(granted, /defined review criteria/);
    assert.match(granted, /changes should be requested/);
    assert.match(granted, /clean with no changes required/);
    assert.equal(
      /implement(ation| tickets)?\b.*\b(execut|ownership)|modify .*code|approve the implementation|business acceptance|workflow approval|state mutation|requirements ownership/i.test(
        granted,
      ),
      false,
    );
    assert.ok(Array.isArray(SENIOR_REVIEWER_ROLE.decision_authority.requires_user_approval));
    assert.equal(SENIOR_REVIEWER_ROLE.decision_authority.requires_user_approval.length, 0);
  });

  it("uses only valid contract artifacts with review_result as output", () => {
    assert.ok(SENIOR_REVIEWER_ROLE.inputs.length > 0);
    for (const artifact of [...SENIOR_REVIEWER_ROLE.inputs, ...SENIOR_REVIEWER_ROLE.outputs]) {
      assert.ok(
        (KNOWN_ARTIFACTS as readonly string[]).includes(artifact),
        `unknown artifact: ${artifact}`,
      );
    }
    assert.ok(SENIOR_REVIEWER_ROLE.inputs.includes("implementation_result"));
    assert.deepEqual(SENIOR_REVIEWER_ROLE.outputs, ["review_result"]);
  });

  it("collaborates with Implementer and Technical Lead in both directions", () => {
    const partners = SENIOR_REVIEWER_ROLE.collaboration.map((link) => link.role).sort();
    assert.deepEqual(partners, [
      "coordinator",
      "implementer",
      "implementer",
      "project-manager",
      "technical-lead",
      "technical-lead",
    ]);
    const submission = SENIOR_REVIEWER_ROLE.collaboration.some(
      (link) => link.role === "implementer" && link.direction === "receives_from",
    );
    const requestedChanges = SENIOR_REVIEWER_ROLE.collaboration.some(
      (link) => link.role === "implementer" && link.direction === "sends_to",
    );
    const clarification = SENIOR_REVIEWER_ROLE.collaboration.some(
      (link) => link.role === "technical-lead" && link.direction === "sends_to",
    );
    assert.equal(submission, true);
    assert.equal(requestedChanges, true);
    assert.equal(clarification, true);
  });

  it("sets no Implementer specialties", () => {
    assert.equal(SENIOR_REVIEWER_ROLE.specialties, undefined);
  });
});
