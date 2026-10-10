import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_IDS, RoleContract, isRoleId } from "../src/roles/contract";import { COORDINATOR_ROLE } from "../src/roles/coordinator";
import { PROJECT_MANAGER_ROLE } from "../src/roles/project-manager";
import { TECHNICAL_LEAD_ROLE } from "../src/roles/technical-lead";
import { IMPLEMENTER_ROLE } from "../src/roles/implementer";
import { SENIOR_REVIEWER_ROLE } from "../src/roles/senior-reviewer";
import {
  APPROVED_HANDOFFS,
  INDEPENDENT_ENTRY_POINTS,
  OPERATING_MODEL_ROLES,
  PROHIBITED_ASSUMPTIONS,
  ROLE_AUTHORITY,
  ROLE_OUTPUT,
  isApprovedHandoff,
} from "../src/roles/operating-model";
import {
  validateCoordinatorApprovalReference,
  validateImplementerReference,
  validateProjectManagerReference,
  validateSeniorReviewerReference,
  validateTechnicalLeadReference,
} from "../src/runtime/roles";

// Operating-model contract tests (M22 T-001): they assert the five
// existing role contracts jointly satisfy the approved baseline plus
// the small additive declarations in `operating-model.ts`. No
// execution, no workflow, no providers, no handoff mechanics.
const CONTRACTS: Readonly<Record<string, RoleContract>> = {
  coordinator: COORDINATOR_ROLE,
  "project-manager": PROJECT_MANAGER_ROLE,
  "technical-lead": TECHNICAL_LEAD_ROLE,
  implementer: IMPLEMENTER_ROLE,
  "senior-reviewer": SENIOR_REVIEWER_ROLE,
};

function joined(contract: RoleContract): string {
  return [...contract.responsibilities, ...contract.non_responsibilities].join(" | ");
}

function authorityText(contract: RoleContract): string {
  return [
    ...contract.decision_authority.can_decide,
    ...contract.decision_authority.must_escalate,
  ].join(" | ");
}

describe("role operating model", () => {
  it("represents all five required role identities, unchanged and unextended", () => {
    assert.deepEqual([...ROLE_IDS], [
      "coordinator",
      "project-manager",
      "technical-lead",
      "implementer",
      "senior-reviewer",
    ]);
    assert.equal(ROLE_IDS.length, 5);
    assert.deepEqual(
      Object.values(CONTRACTS).map((contract) => contract.id),
      [...ROLE_IDS],
    );
    assert.deepEqual([...OPERATING_MODEL_ROLES], [...ROLE_IDS]);
    assert.deepEqual([...INDEPENDENT_ENTRY_POINTS], [...ROLE_IDS]);
  });

  it("gives each role an explicit responsibility definition", () => {
    for (const id of ROLE_IDS) {
      const contract = CONTRACTS[id];
      assert.ok(contract.responsibilities.length >= 1, `${id} states what it owns`);
      assert.ok(contract.purpose.length > 0, `${id} states its purpose`);
      assert.ok(contract.inputs.length >= 1, `${id} declares inputs`);
      assert.ok(contract.outputs.length >= 1, `${id} declares outputs`);
    }
  });

  it("gives each role explicit prohibited responsibilities", () => {
    for (const id of ROLE_IDS) {
      assert.ok(CONTRACTS[id].non_responsibilities.length >= 1, `${id} states what it must not touch`);
    }
  });

  it("preserves Coordinator boundaries: routes, never implements or reviews", () => {
    const text = joined(COORDINATOR_ROLE);
    assert.match(text, /route|orchestration|coordination/i);
    assert.match(COORDINATOR_ROLE.non_responsibilities.join(" | "), /Technical Lead/);
    assert.match(COORDINATOR_ROLE.non_responsibilities.join(" | "), /Implementer/);
    assert.match(COORDINATOR_ROLE.non_responsibilities.join(" | "), /Senior Reviewer/);
    assert.ok(
      COORDINATOR_ROLE.decision_authority.can_decide.every((entry) => !/implement tickets|review implementation/i.test(entry)),
      "Coordinator decides routing, never implementation or review outcomes",
    );
  });

  it("preserves Project Manager boundaries: requirements authority, no implementation or architecture", () => {
    assert.match(joined(PROJECT_MANAGER_ROLE), /requirements|scope/i);
    assert.match(PROJECT_MANAGER_ROLE.non_responsibilities.join(" | "), /Technical Lead/);
    assert.match(PROJECT_MANAGER_ROLE.non_responsibilities.join(" | "), /Implementer/);
    assert.match(authorityText(PROJECT_MANAGER_ROLE), /requirements/);
  });

  it("preserves Technical Lead boundaries: technical authority, no business scope or direct implementation", () => {
    assert.match(joined(TECHNICAL_LEAD_ROLE), /ticket|technical/i);
    assert.match(TECHNICAL_LEAD_ROLE.non_responsibilities.join(" | "), /Project Manager/);
    assert.match(TECHNICAL_LEAD_ROLE.non_responsibilities.join(" | "), /Implementer/);
    assert.match(authorityText(TECHNICAL_LEAD_ROLE), /technical/);
  });

  it("preserves Implementer boundaries: executes the ticket, owns nothing outside it", () => {
    assert.match(IMPLEMENTER_ROLE.outputs.join(" | "), /implementation_result/);
    assert.match(IMPLEMENTER_ROLE.non_responsibilities.join(" | "), /Project Manager|requirements/i);
    assert.match(IMPLEMENTER_ROLE.non_responsibilities.join(" | "), /architecture/);
    assert.match(IMPLEMENTER_ROLE.non_responsibilities.join(" | "), /Senior Reviewer|review/i);
  });

  it("preserves Senior Reviewer boundaries: reviews, never modifies implementation", () => {
    assert.match(SENIOR_REVIEWER_ROLE.non_responsibilities.join(" | "), /modify implementation code/);
    assert.match(SENIOR_REVIEWER_ROLE.constraints.join(" | "), /never modify implementation code/);
    assert.match(SENIOR_REVIEWER_ROLE.outputs.join(" | "), /review_result/);
  });

  it("keeps PM business authority distinct from TL technical authority", () => {
    assert.notEqual(ROLE_AUTHORITY["project-manager"], ROLE_AUTHORITY["technical-lead"]);
    assert.match(ROLE_AUTHORITY["project-manager"], /requirements|business/);
    assert.match(ROLE_AUTHORITY["technical-lead"], /technical/);
    assert.match(ROLE_AUTHORITY["project-manager"], /^(?!.*technical architecture).*$/s);
    assert.ok(
      PROJECT_MANAGER_ROLE.decision_authority.can_decide.every((entry) => !/architecture decisions/i.test(entry)),
      "PM never claims architecture decisions",
    );
    assert.ok(
      TECHNICAL_LEAD_ROLE.decision_authority.can_decide.some((entry) => /architecture|technical/i.test(entry)),
      "TL claims technical decisions",
    );
  });

  it("keeps TL technical authority distinct from Implementer execution", () => {
    assert.notEqual(ROLE_AUTHORITY["technical-lead"], ROLE_AUTHORITY.implementer);
    assert.match(ROLE_AUTHORITY.implementer, /within approved scope/);
    assert.ok(TECHNICAL_LEAD_ROLE.outputs.includes("ticket"), "TL produces tickets");
    assert.deepEqual(IMPLEMENTER_ROLE.outputs, ["implementation_result"]);
    assert.match(IMPLEMENTER_ROLE.non_responsibilities.join(" | "), /technical acceptance/);
  });

  it("never lets the Senior Reviewer become the Technical Lead", () => {
    assert.equal(SENIOR_REVIEWER_ROLE.id, "senior-reviewer");
    assert.match(SENIOR_REVIEWER_ROLE.non_responsibilities.join(" | "), /Technical Lead/);
    assert.match(
      SENIOR_REVIEWER_ROLE.decision_authority.must_escalate.join(" | "),
      /Technical Lead/,
    );
    assert.ok(
      SENIOR_REVIEWER_ROLE.decision_authority.can_decide.every(
        (entry) => !/architect|rework decision|ticket/i.test(entry),
      ),
      "review verdicts stay advisory; rework and ticket decisions stay with TL",
    );
  });

  it("never lets the Implementer become the requirements authority", () => {
    assert.match(
      IMPLEMENTER_ROLE.decision_authority.must_escalate.join(" | "),
      /Project Manager/,
    );
    assert.match(
      IMPLEMENTER_ROLE.escalation_rules.join(" | "),
      /stop and escalate/,
    );
    assert.ok(
      IMPLEMENTER_ROLE.decision_authority.can_decide.every(
        (entry) => !/requirement|scope/i.test(entry),
      ),
      "Implementer decides details inside the ticket, never requirements or scope",
    );
  });

  it("keeps every role independently representable", () => {
    for (const id of ROLE_IDS) {
      const contract = CONTRACTS[id];
      assert.equal(contract.id, id);
      assert.ok(isRoleId(contract.id));
      assert.ok(contract.specialties === undefined || id === "implementer");
    }
    const sources = ROLE_IDS.map((id) =>
      readFileSync(join(__dirname, "..", "..", "src", "roles", `${id}.ts`), "utf8"),
    );
    for (const source of sources) {
      assert.ok(!/from "\.\.\/(execution|runtime|providers|workflow|config)/.test(source));
    }
  });

  it("represents the approved handoff directions", () => {
    const expected: Array<readonly [string, string]> = [
      ["coordinator", "project-manager"],
      ["coordinator", "technical-lead"],
      ["project-manager", "technical-lead"],
      ["project-manager", "coordinator"],
      ["technical-lead", "implementer"],
      ["technical-lead", "project-manager"],
      ["technical-lead", "coordinator"],
      ["implementer", "senior-reviewer"],
      ["implementer", "technical-lead"],
      ["senior-reviewer", "implementer"],
      ["senior-reviewer", "technical-lead"],
    ];
    assert.deepEqual(
      APPROVED_HANDOFFS.map(([from, to]) => [from, to]),
      expected,
    );
    for (const [from, to] of expected) {
      assert.equal(isApprovedHandoff(from, to), true, `${from} → ${to} is approved`);
    }
    assert.equal(isApprovedHandoff("coordinator", "coordinator"), false);
    for (const bad of ["pm", "tl", "reviewer", "", null, 7, undefined]) {
      assert.equal(isApprovedHandoff(bad, "implementer"), false);
      assert.equal(isApprovedHandoff("implementer", bad), false);
    }
  });

  it("rejects invalid role identity through existing validation", () => {
    for (const bad of ["pm", "tl", "reviewer", "sr", "technical_lead", "", null, 7]) {
      assert.equal(isRoleId(bad), false);
    }
    assert.throws(() => validateImplementerReference({ role: "pm", specialty: "backend", provider: { name: "x", execute: async () => ({}) } }));
  });

  it("keeps existing role references valid", () => {
    const provider = { name: "stub", execute: async () => ({ status: "succeeded" as const }) };
    assert.equal(validateImplementerReference({ role: "implementer", specialty: "backend", provider }).role, "implementer");
    assert.equal(validateSeniorReviewerReference({ role: "senior-reviewer", provider }).role, "senior-reviewer");
    assert.equal(validateTechnicalLeadReference({ role: "technical-lead", provider }).role, "technical-lead");
    assert.equal(validateProjectManagerReference({ role: "project-manager", provider }).role, "project-manager");
    assert.equal(validateCoordinatorApprovalReference({ role: "coordinator" }).role, "coordinator");
  });

  it("declares scoped authority and output responsibility per role, with no generic hierarchy", () => {
    assert.deepEqual(Object.keys(ROLE_AUTHORITY).sort(), [...ROLE_IDS].sort());
    assert.deepEqual(Object.keys(ROLE_OUTPUT).sort(), [...ROLE_IDS].sort());
    for (const label of Object.values(ROLE_AUTHORITY)) {
      assert.ok(!/higher|superior|rank|boss|supervise/i.test(label), "authority is scoped, never ranked");
    }
    assert.match(ROLE_OUTPUT.coordinator, /direction/);
    assert.match(ROLE_OUTPUT["project-manager"], /requirements/);
    assert.match(ROLE_OUTPUT["technical-lead"], /technical plan/);
    assert.match(ROLE_OUTPUT.implementer, /implementation result/);
    assert.match(ROLE_OUTPUT["senior-reviewer"], /review result/);
    assert.ok(PROHIBITED_ASSUMPTIONS.length >= 1);
    assert.ok(PROHIBITED_ASSUMPTIONS.some((entry) => /never automatically invokes/i.test(entry)));
  });

  it("introduces no managers, providers, workflow, config, or persistence", () => {
    const source = readFileSync(join(__dirname, "..", "..", "src", "roles", "operating-model.ts"), "utf8");
    assert.ok(
      !/RoleManager|TeamManager|AgentManager|WorkflowManager|HierarchyEngine|RoutingEngine/i.test(source),
      "no manager or engine abstraction",
    );
    for (const token of [
      "WorkflowState",
      "TicketSource",
      "TicketSink",
      "IssueProvider",
      "AgentProvider",
      "delegate-skills",
      "DelegateProvider",
      "relay",
      "loadConfig",
      "readConfig",
      "process.env",
      ".yaml",
      "writeFile",
      "readFileSync",
      "setTimeout",
      "setInterval",
    ]) {
      assert.ok(!source.includes(token), `operating model never touches ${token}`);
    }
    assert.ok(!/from "\.\.\/(execution|runtime|providers|workflow|config)/.test(source));
    assert.equal(typeof isApprovedHandoff, "function");
    for (const value of [OPERATING_MODEL_ROLES, APPROVED_HANDOFFS, INDEPENDENT_ENTRY_POINTS, PROHIBITED_ASSUMPTIONS]) {
      assert.equal(typeof value, "object", "operating-model declarations are data, not behavior");
    }
  });
});
