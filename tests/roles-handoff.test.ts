import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_IDS, isRoleId } from "../src/roles/contract";
import {
  MAX_HANDOFF_ITEMS,
  MAX_HANDOFF_TEXT_LENGTH,
  createAgentHandoff,
  isAgentHandoff,
} from "../src/roles/handoff";
import { APPROVED_HANDOFFS, isApprovedHandoff } from "../src/roles/operating-model";
import { validateAgentIdentity } from "../src/roles/identity";
import { canHandoff as canRetryHandoff, createHandoff as createRetryHandoff } from "../src/workflow/retry-handoff";
import type { ImplementerExecutionInput } from "../src/execution/implementer";

// Canonical handoff tests (M22 T-003): the inter-role work
// artifact. Data contract only: no rendering, no transport, no
// execution, no workflow changes.
const DIRECTIONS: Array<readonly [string, string]> = [
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

function minimalHandoff(from: string, to: string): Record<string, unknown> {
  return { from, to, objective: `expected work for ${to}` };
}

describe("canonical handoff contract", () => {
  it("represents all eleven canonical directions", () => {
    assert.deepEqual(
      APPROVED_HANDOFFS.map(([from, to]) => [from, to]),
      DIRECTIONS.map(([from, to]) => [from, to]),
    );
    for (const [from, to] of DIRECTIONS) {
      const handoff = createAgentHandoff(minimalHandoff(from, to));
      assert.equal(handoff.from, from);
      assert.equal(handoff.to, to);
      assert.ok(isAgentHandoff(handoff));
      assert.ok(isApprovedHandoff(from, to), `${from} → ${to} stays approved`);
    }
  });

  it("rejects invalid roles and aliases as sender or receiver", () => {
    for (const bad of ["pm", "tl", "reviewer", "sr", "user", "opencode", "", null, 7, undefined]) {
      assert.equal(isAgentHandoff({ from: bad, to: "implementer", objective: "work" }), false);
      assert.equal(isAgentHandoff({ from: "coordinator", to: bad, objective: "work" }), false);
      assert.throws(() => createAgentHandoff({ from: bad, to: "implementer", objective: "work" }));
      assert.throws(() => createAgentHandoff({ from: "coordinator", to: bad, objective: "work" }));
    }
    assert.equal(isRoleId("user"), false, "human endpoints never enter the role matrix");
  });

  it("rejects self-handoff and keeps identities canonical", () => {
    for (const role of ROLE_IDS) {
      assert.throws(() => createAgentHandoff({ from: role, to: role, objective: "work" }));
    }
    const handoff = createAgentHandoff(minimalHandoff("project-manager", "technical-lead"));
    assert.ok(isRoleId(handoff.from) && isRoleId(handoff.to));
    const sender = validateAgentIdentity({ role: handoff.from });
    assert.equal(sender.role, "project-manager", "sender doubles as a valid agent identity");
  });

  it("enforces the required objective and bounded optional fields", () => {
    assert.throws(() => createAgentHandoff({ from: "coordinator", to: "project-manager" }));
    assert.throws(() => createAgentHandoff({ from: "coordinator", to: "project-manager", objective: "" }));
    assert.throws(() => createAgentHandoff({ from: "coordinator", to: "project-manager", objective: "x".repeat(MAX_HANDOFF_TEXT_LENGTH + 1) }));
    const full = createAgentHandoff({
      ...minimalHandoff("technical-lead", "implementer"),
      context: "bounded background",
      requirements: ["first requirement", "second requirement"],
      acceptance_criteria: ["criterion one"],
      constraints: ["technical constraint", "scope constraint"],
      artifacts: ["plan", "review result"],
      notes: "bounded extra information",
      next_action: "implement the ticket",
    });
    assert.equal(full.context, "bounded background");
    assert.deepEqual(full.requirements, ["first requirement", "second requirement"]);
    assert.deepEqual(full.acceptance_criteria, ["criterion one"]);
    assert.deepEqual(full.constraints, ["technical constraint", "scope constraint"]);
    assert.deepEqual(full.artifacts, ["plan", "review result"]);
    assert.equal(full.notes, "bounded extra information");
    assert.equal(full.next_action, "implement the ticket");
    assert.throws(() => createAgentHandoff({ ...minimalHandoff("coordinator", "project-manager"), requirements: "not-an-array" }));
    assert.throws(() => createAgentHandoff({ ...minimalHandoff("coordinator", "project-manager"), requirements: [""] }));
    assert.throws(() => createAgentHandoff({ ...minimalHandoff("coordinator", "project-manager"), constraints: new Array(MAX_HANDOFF_ITEMS + 1).fill("limit") }));
  });

  it("preserves caller-defined collection order", () => {
    const handoff = createAgentHandoff({
      ...minimalHandoff("implementer", "senior-reviewer"),
      requirements: ["third", "first", "second"],
    });
    assert.deepEqual(handoff.requirements, ["third", "first", "second"]);
  });

  it("freezes the handoff including nested collections, without mutating input", () => {
    const requirements = ["keep me"];
    const input = { ...minimalHandoff("senior-reviewer", "implementer"), requirements, notes: "change request" };
    const handoff = createAgentHandoff(input);
    assert.ok(Object.isFrozen(handoff));
    assert.ok(Object.isFrozen(handoff.requirements));
    assert.throws(() => {
      (handoff as { objective: string }).objective = "rewritten";
    });
    assert.throws(() => {
      (handoff.requirements as string[]).push("injected");
    });
    requirements.push("caller-side addition");
    assert.deepEqual(handoff.requirements, ["keep me"], "receiver input is copied, not retained");
    assert.deepEqual(input.requirements, ["keep me", "caller-side addition"], "source input keeps its own history");
  });

  it("carries no decisions, workflow states, reports, providers, timestamps, or IDs", () => {
    const handoff = createAgentHandoff({
      ...minimalHandoff("technical-lead", "project-manager"),
      approved: true,
      next_state: "closed",
      transition: "technical_approval",
      report: "some opaque agent report",
      provider: "opencode",
      transport: "delegate",
      timestamp: "2026-01-01",
      id: "handoff-1",
    });
    assert.deepEqual(Object.keys(handoff).sort(), ["from", "objective", "to"]);
    assert.ok(!("approved" in handoff), "notes never double as an approval decision");
    const source = readFileSync(join(__dirname, "..", "..", "src", "roles", "handoff.ts"), "utf8");
    assert.ok(!/parseReport|reportToHandoff|parse.*Report/i.test(source), "no report parsing exists");
  });

  it("builds deterministically with no generated content", () => {
    const input = {
      ...minimalHandoff("project-manager", "coordinator"),
      requirements: ["scope holds"],
      next_action: "report business validation",
    };
    const first = createAgentHandoff(input);
    const second = createAgentHandoff(input);
    assert.deepEqual(first, second);
    assert.notEqual(first, second, "each construction returns its own frozen value");
    assert.ok(!("id" in first) && !("timestamp" in first) && !("session" in first));
  });

  it("leaves the retry/rework mechanism untouched and semantically distinct", () => {
    assert.equal(canRetryHandoff("coordinator", "implementer"), true, "retry layer keeps its own pair");
    assert.equal(canRetryHandoff("project-manager", "coordinator"), false, "retry layer never gained the canonical pair");
    assert.deepEqual(
      createRetryHandoff("implementer", "senior-reviewer", "needs review"),
      { from: "implementer", to: "senior-reviewer", reason: "needs review" },
      "retry handoff output shape unchanged",
    );
    assert.equal(canRetryHandoff("senior-reviewer", "implementer"), false, "retry layer still lacks the canonical review-feedback pair");
    assert.notEqual(
      isApprovedHandoff("coordinator", "implementer"),
      canRetryHandoff("coordinator", "implementer"),
      "canonical directions and retry directions remain different layers",
    );
  });

  it("coexists with execution inputs without adopting them", () => {
    const handoff = createAgentHandoff({
      ...minimalHandoff("technical-lead", "implementer"),
      requirements: ["ticket requirement"],
    });
    const stubProvider = { name: "stub", execute: async () => ({ status: "succeeded" as const, text: "done" }) };
    const input: ImplementerExecutionInput = {
      ticket: {
        id: "T-1",
        title: "assigned ticket",
        description: "ticket description",
        requirements: (handoff.requirements ?? []).join("\n"),
      },
      specialty: "backend",
      role: handoff.to,
      project_root: "/tmp/project",
      provider: stubProvider,
      timeout_ms: 1000,
    };
    assert.equal(input.role, "implementer");
    assert.equal(input.ticket.requirements, "ticket requirement");
    assert.ok(!("from" in input) && !("objective" in input), "execution inputs never absorb handoff fields");
  });

  it("introduces no new role and no provider, workflow, CLI, planning, or orchestration concept", () => {
    assert.equal(ROLE_IDS.length, 5);
    const source = readFileSync(join(__dirname, "..", "..", "src", "roles", "handoff.ts"), "utf8");
    assert.ok(!/RoleManager|TeamManager|AgentManager|HandoffManager|Registry|Resolver|Discovery/i.test(source));
    for (const token of [
      "WorkflowState",
      "TicketSource",
      "TicketSink",
      "IssueProvider",
      "AgentProvider",
      "delegate-skills",
      "DelegateProvider",
      "relay",
      "github",
      "GitHub",
      "opencode",
      "OpenCode",
      "spec-kit",
      "loadConfig",
      "readConfig",
      "process.env",
      ".yaml",
      "node:fs",
      "child_process",
      "argv",
      "renderHandoff",
      "sprint",
      "reenter",
      "CorrectionTicket",
      "Router",
    ]) {
      assert.ok(!source.includes(token), `handoff never implements ${token}`);
    }
    assert.ok(!/from "\.\.\/(execution|runtime|providers|workflow|config|cli)/.test(source));
    assert.ok(!/responsibilities:|non_responsibilities:|decision_authority:/.test(source), "responsibility semantics stay in the existing contracts");
  });
});
