import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_IDS, isRoleId } from "../src/roles/contract";
import { COORDINATOR_ROLE } from "../src/roles/coordinator";
import { PROJECT_MANAGER_ROLE } from "../src/roles/project-manager";
import { TECHNICAL_LEAD_ROLE } from "../src/roles/technical-lead";
import { IMPLEMENTER_ROLE } from "../src/roles/implementer";
import { SENIOR_REVIEWER_ROLE } from "../src/roles/senior-reviewer";
import {
  AgentIdentity,
  getRoleContract,
  identityMatchesRole,
  isAgentIdentity,
  validateAgentIdentity,
} from "../src/roles/identity";
import { resolveRole } from "../src/roles/selection";
import {
  validateCoordinatorApprovalReference,
  validateImplementerReference,
  validateProjectManagerReference,
  validateSeniorReviewerReference,
  validateTechnicalLeadReference,
} from "../src/runtime/roles";

// Identity contract tests (M22 T-002): WHO an invocation performs
// as. No execution, no workflow, no providers, no transports.
const EXPECTED = {
  coordinator: COORDINATOR_ROLE,
  "project-manager": PROJECT_MANAGER_ROLE,
  "technical-lead": TECHNICAL_LEAD_ROLE,
  implementer: IMPLEMENTER_ROLE,
  "senior-reviewer": SENIOR_REVIEWER_ROLE,
} as const;

const stubProvider = { name: "stub", execute: async () => ({ status: "succeeded" as const }) };

describe("agent identity contract", () => {
  it("validates all five canonical identities as frozen values", () => {
    for (const role of ROLE_IDS) {
      const identity = validateAgentIdentity({ role });
      assert.deepEqual(identity, { role });
      assert.ok(Object.isFrozen(identity), `${role} identity is immutable`);
      assert.ok(isAgentIdentity(identity));
    }
  });

  it("rejects unknown roles", () => {
    for (const role of ["user", "admin", "opencode", "delegate", "claude", "coordinator "] as const) {
      assert.equal(isAgentIdentity({ role }), false);
      assert.throws(() => validateAgentIdentity({ role }));
    }
  });

  it("rejects missing identity", () => {
    for (const data of [{}, null, undefined, { role: undefined }, []] as const) {
      assert.equal(isAgentIdentity(data), false);
      assert.throws(() => validateAgentIdentity(data));
    }
  });

  it("rejects malformed identity", () => {
    for (const data of ["coordinator", 7, true, { role: ["implementer"] }, { role: { role: "implementer" } }] as const) {
      assert.equal(isAgentIdentity(data), false);
      assert.throws(() => validateAgentIdentity(data));
    }
  });

  it("maps each identity to exactly one existing role contract", () => {
    const seen = new Set<unknown>();
    for (const role of ROLE_IDS) {
      const contract = getRoleContract(validateAgentIdentity({ role }));
      assert.equal(contract, EXPECTED[role], `${role} selects its own contract object`);
      assert.equal(contract.id, role);
      seen.add(contract);
    }
    assert.equal(seen.size, 5, "no two identities share a contract");
    assert.throws(() => getRoleContract({ role: "pm" } as unknown as AgentIdentity));
    assert.throws(() => getRoleContract(null as unknown as AgentIdentity));
  });

  it("selects Coordinator, PM, TL, Implementer, and Reviewer semantics", () => {
    assert.equal(getRoleContract(validateAgentIdentity({ role: "coordinator" })).purpose, COORDINATOR_ROLE.purpose);
    assert.equal(getRoleContract(validateAgentIdentity({ role: "project-manager" })).purpose, PROJECT_MANAGER_ROLE.purpose);
    assert.equal(getRoleContract(validateAgentIdentity({ role: "technical-lead" })).purpose, TECHNICAL_LEAD_ROLE.purpose);
    assert.equal(getRoleContract(validateAgentIdentity({ role: "implementer" })).purpose, IMPLEMENTER_ROLE.purpose);
    assert.equal(getRoleContract(validateAgentIdentity({ role: "senior-reviewer" })).purpose, SENIOR_REVIEWER_ROLE.purpose);
  });

  it("rejects wrong-role identities through the existing execution references", () => {
    const reviewer = { ...validateAgentIdentity({ role: "senior-reviewer" }), provider: stubProvider };
    assert.throws(() => validateTechnicalLeadReference(reviewer), "Senior Reviewer is never a Technical Lead");
    const lead = { ...validateAgentIdentity({ role: "technical-lead" }), provider: stubProvider };
    assert.throws(() => validateProjectManagerReference(lead), "Technical Lead is never a Project Manager");
    const manager = { ...validateAgentIdentity({ role: "project-manager" }) };
    assert.throws(() => validateCoordinatorApprovalReference(manager), "Project Manager is never final approval");
    const implementer = { ...validateAgentIdentity({ role: "implementer" }), specialty: "backend", provider: stubProvider };
    assert.throws(() => validateSeniorReviewerReference(implementer), "Implementer is never the Reviewer");
    assert.equal(identityMatchesRole(reviewer, "technical-lead"), false);
    assert.equal(identityMatchesRole(lead, "project-manager"), false);
    assert.equal(identityMatchesRole(manager, "coordinator"), false);
    assert.equal(identityMatchesRole(implementer, "senior-reviewer"), false);
  });

  it("matches an identity only against its own required role", () => {
    for (const role of ROLE_IDS) {
      const identity = validateAgentIdentity({ role });
      assert.equal(identityMatchesRole(identity, role), true);
      for (const other of ROLE_IDS.filter((candidate) => candidate !== role)) {
        assert.equal(identityMatchesRole(identity, other), false, `${role} never satisfies ${other}`);
      }
    }
    assert.equal(identityMatchesRole({ role: "pm" }, "project-manager"), false);
    assert.equal(identityMatchesRole(validateAgentIdentity({ role: "implementer" }), "user"), false);
    assert.equal(identityMatchesRole(null, "coordinator"), false);
  });

  it("keeps aliases at the presentation layer, outside canonical validation", () => {
    assert.equal(resolveRole("pm")?.role, "project-manager");
    assert.equal(resolveRole("tl")?.role, "technical-lead");
    for (const alias of ["pm", "tl", "reviewer", "sr"]) {
      assert.equal(isAgentIdentity({ role: alias }), false, `${alias} is not a canonical identity`);
      assert.throws(() => validateAgentIdentity({ role: alias }));
    }
  });

  it("never lets provider, model, session, transport, user, or config metadata become identity", () => {
    const identity = validateAgentIdentity({
      role: "technical-lead",
      provider: "opencode",
      model: "some-model",
      session: "session-1",
      transport: "delegate",
      user: "someone",
      config: { role: "technical-lead" },
    });
    assert.deepEqual(Object.keys(identity), ["role"]);
    assert.deepEqual(identity, { role: "technical-lead" });
    assert.equal(isRoleId("user"), false, "the human user is not a role");
    assert.throws(() => validateAgentIdentity({ role: "user" }));
  });

  it("forbids role switching inside one identity", () => {
    const identity = validateAgentIdentity({ role: "technical-lead" });
    assert.throws(() => {
      (identity as { role: string }).role = "project-manager";
    }, "frozen identities cannot change roles mid-invocation");
    assert.deepEqual(identity, { role: "technical-lead" });
    assert.equal(identityMatchesRole(identity, "project-manager"), false);
  });

  it("stays valid independent of delegate, tracker, and configuration availability", () => {
    for (const role of ROLE_IDS) {
      assert.ok(isAgentIdentity({ role }), `${role} needs no integration to be a valid identity`);
    }
    const source = readFileSync(join(__dirname, "..", "..", "src", "roles", "identity.ts"), "utf8");
    for (const token of ["delegate-skills", "DelegateProvider", "relay", "github", "GitHub", "opencode", "OpenCode", "spec-kit", "SpecKit", "loadConfig", "readConfig", "process.env", ".yaml", "node:fs", "child_process", "fetch("]) {
      assert.ok(!source.includes(token), `identity never touches ${token}`);
    }
  });

  it("introduces no new role, manager, discovery, handoff, mode, or execution concept", () => {
    assert.equal(ROLE_IDS.length, 5);
    const source = readFileSync(join(__dirname, "..", "..", "src", "roles", "identity.ts"), "utf8");
    assert.ok(!/RoleManager|TeamManager|AgentManager|RoleRegistry|IdentityResolver|AgentDiscovery|Hierarchy/i.test(source));
    for (const token of [
      "WorkflowState",
      "TicketSource",
      "TicketSink",
      "IssueProvider",
      "AgentProvider",
      "HandoffContext",
      "canHandoff",
      "validateHandoff",
      "renderHandoff",
      "argv",
      "command:",
      "sprint",
      "rework",
      "re-enter",
      "reenter",
    ]) {
      assert.ok(!source.includes(token), `identity never implements ${token}`);
    }
    assert.ok(!/from "\.\.\/(execution|runtime|providers|workflow|config|cli)/.test(source));
    assert.ok(!/responsibilities:|non_responsibilities:|decision_authority:/.test(source), "responsibility semantics stay in the existing contracts");
  });

  it("validates deterministically without mutating input or runtime", () => {
    const first = validateAgentIdentity({ role: "implementer" });
    const second = validateAgentIdentity({ role: "implementer" });
    assert.deepEqual(first, second);
    assert.notEqual(first, second, "each validation returns its own frozen value");
    const input = { role: "coordinator" };
    validateAgentIdentity(input);
    assert.deepEqual(input, { role: "coordinator" }, "input is never mutated");
    assert.throws(() => validateAgentIdentity({ role: "bogus" }));
    assert.throws(() => validateAgentIdentity({ role: "bogus" }), "same input, same rejection");
  });

  it("composes with existing role references without replacing them", () => {
    const reference = validateImplementerReference({
      ...validateAgentIdentity({ role: "implementer" }),
      specialty: "backend",
      provider: stubProvider,
    });
    assert.equal(reference.role, "implementer");
    assert.equal(reference.specialty, "backend");
  });
});
