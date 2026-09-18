import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  IMPLEMENTER_SPECIALTIES,
  ROLE_IDS,
  RoleContract,
  isImplementerSpecialty,
  isRoleId,
} from "../src/roles/contract";

// Contract-representation tests only: they verify what the R-001 format
// can express, not any concrete role (R-002 through R-006) or runtime.
describe("role contract format", () => {
  it("represents the five stable role identifiers and rejects the rest", () => {
    assert.deepEqual([...ROLE_IDS], [
      "coordinator",
      "project-manager",
      "technical-lead",
      "implementer",
      "senior-reviewer",
    ]);
    for (const id of ROLE_IDS) {
      assert.equal(isRoleId(id), true);
    }
    for (const notId of ["pm", "technical_lead", "reviewer", "", 7, null]) {
      assert.equal(isRoleId(notId), false);
    }
  });

  it("represents a complete contract with distinct responsibilities", () => {
    const contract: RoleContract = {
      id: "technical-lead",
      name: "Technical Lead",
      purpose: "Own technical planning and ticket breakdown.",
      responsibilities: ["split work into implementation tickets"],
      non_responsibilities: ["business acceptance"],
      inputs: ["requirements", "project_context"],
      outputs: ["ticket", "technical_context"],
      decision_authority: {
        can_decide: ["ticket breakdown"],
        must_escalate: ["requirements gaps to the Project Manager"],
        requires_user_approval: ["architecture changes"],
      },
      escalation_rules: ["stop on ambiguous technical decisions"],
      constraints: ["one ticket at a time"],
      collaboration: [
        { role: "project-manager", direction: "receives_from", description: "receives plans" },
        { role: "implementer", direction: "sends_to", description: "assigns tickets" },
        { role: "senior-reviewer", direction: "bidirectional", description: "reviews review outcomes" },
      ],
    };
    assert.equal(contract.non_responsibilities[0], "business acceptance");
    assert.notDeepEqual(contract.responsibilities, contract.non_responsibilities);
    assert.equal(contract.decision_authority.requires_user_approval[0], "architecture changes");
  });

  it("requires non-empty responsibilities and non-responsibilities", () => {
    const base = {
      id: "coordinator" as const,
      name: "Coordinator",
      purpose: "Route requests.",
      inputs: [],
      outputs: [],
      decision_authority: { can_decide: [], must_escalate: [], requires_user_approval: [] },
      escalation_rules: [],
      constraints: [],
      collaboration: [],
    };
    // @ts-expect-error responsibilities must be non-empty
    const noDuties: RoleContract = { ...base, responsibilities: [], non_responsibilities: ["x"] };
    // @ts-expect-error non-responsibilities must be non-empty
    const noBoundaries: RoleContract = { ...base, responsibilities: ["x"], non_responsibilities: [] };
    assert.ok(noDuties && noBoundaries);
  });

  it("keeps Implementer specialties separate from role identifiers", () => {
    assert.deepEqual([...IMPLEMENTER_SPECIALTIES], [
      "backend",
      "frontend",
      "integration",
      "database",
      "testing",
      "documentation",
    ]);
    for (const specialty of IMPLEMENTER_SPECIALTIES) {
      assert.equal(isImplementerSpecialty(specialty), true);
      assert.equal(isRoleId(specialty), false);
    }
    assert.equal(isImplementerSpecialty("devops"), false);
    assert.equal(isImplementerSpecialty("coordinator"), false);
  });

  it("can express the Senior Reviewer code-modification ban", () => {
    const reviewer: Pick<RoleContract, "id" | "non_responsibilities" | "decision_authority"> = {
      id: "senior-reviewer",
      non_responsibilities: ["modify implementation code"],
      decision_authority: {
        can_decide: ["findings and verdict"],
        must_escalate: ["rework decisions to the Technical Lead"],
        requires_user_approval: [],
      },
    };
    assert.match(reviewer.non_responsibilities[0], /modify implementation code/);
    assert.equal(
      reviewer.decision_authority.can_decide.some((entry) => /modif/.test(entry)),
      false,
    );
  });
});
