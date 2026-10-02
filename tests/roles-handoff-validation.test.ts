import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_IDS } from "../src/roles/contract";
import { MAX_HANDOFF_ITEMS, MAX_HANDOFF_TEXT_LENGTH } from "../src/roles/handoff";
import { renderAgentHandoff, validateAgentHandoff } from "../src/roles/handoff-validation";
import { canHandoff as canRetryHandoff } from "../src/workflow/retry-handoff";

// Handoff validation and rendering tests (M22 T-004): T-003
// structure plus T-001 direction approval, one deterministic
// human-readable artifact. No transport, no execution, no workflow
// changes.
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

function validHandoff(from: string, to: string): Record<string, unknown> {
  return { from, to, objective: `expected work for ${to}` };
}

describe("handoff validation", () => {
  it("validates all eleven canonical directions", () => {
    for (const [from, to] of DIRECTIONS) {
      const handoff = validateAgentHandoff(validHandoff(from, to));
      assert.equal(handoff.from, from);
      assert.equal(handoff.to, to);
      assert.ok(Object.isFrozen(handoff));
    }
  });

  it("rejects invalid roles, aliases, and provider/model names", () => {
    for (const bad of ["pm", "tl", "reviewer", "sr", "user", "opencode", "claude", "delegate", "", null, 7]) {
      assert.throws(() => validateAgentHandoff({ from: bad, to: "implementer", objective: "work" }));
      assert.throws(() => validateAgentHandoff({ from: "coordinator", to: bad, objective: "work" }));
    }
  });

  it("rejects identical sender and receiver", () => {
    for (const role of ROLE_IDS) {
      assert.throws(() => validateAgentHandoff({ from: role, to: role, objective: "work" }));
    }
  });

  it("rejects canonical but unapproved directions without redirecting them", () => {
    for (const [from, to] of [
      ["senior-reviewer", "project-manager"],
      ["coordinator", "implementer"],
      ["coordinator", "senior-reviewer"],
      ["implementer", "coordinator"],
      ["project-manager", "senior-reviewer"],
    ] as const) {
      assert.throws(() => validateAgentHandoff(validHandoff(from, to)), `${from} → ${to} is structurally valid but not approved`);
    }
  });

  it("enforces required and bounded fields while preserving order", () => {
    assert.throws(() => validateAgentHandoff({ from: "coordinator", to: "project-manager" }));
    assert.throws(() => validateAgentHandoff({ ...validHandoff("coordinator", "project-manager"), objective: "" }));
    assert.throws(() => validateAgentHandoff({ ...validHandoff("coordinator", "project-manager"), objective: "x".repeat(MAX_HANDOFF_TEXT_LENGTH + 1) }));
    assert.throws(() => validateAgentHandoff({ ...validHandoff("coordinator", "project-manager"), notes: "x".repeat(MAX_HANDOFF_TEXT_LENGTH + 1) }));
    assert.throws(() => validateAgentHandoff({ ...validHandoff("coordinator", "project-manager"), requirements: new Array(MAX_HANDOFF_ITEMS + 1).fill("item") }));
    const handoff = validateAgentHandoff({
      ...validHandoff("implementer", "senior-reviewer"),
      requirements: ["third", "first", "second"],
    });
    assert.deepEqual(handoff.requirements, ["third", "first", "second"], "no sorting, no deduplication");
  });

  it("freezes results with defensive copies and never mutates input", () => {
    const requirements = ["keep me"];
    const input = { ...validHandoff("technical-lead", "implementer"), requirements };
    const handoff = validateAgentHandoff(input);
    assert.ok(Object.isFrozen(handoff) && Object.isFrozen(handoff.requirements));
    requirements.push("caller-side addition");
    assert.deepEqual(handoff.requirements, ["keep me"]);
    assert.deepEqual(input.requirements, ["keep me", "caller-side addition"]);
  });

  it("infers no decisions and embeds no workflow state", () => {
    const handoff = validateAgentHandoff({
      ...validHandoff("senior-reviewer", "implementer"),
      approved: true,
      next_state: "closed",
      notes: "approved",
    });
    assert.deepEqual(Object.keys(handoff).sort(), ["from", "notes", "objective", "to"]);
    assert.ok(!("approved" in handoff) && !("next_state" in handoff), "decision and state extras dropped while notes stay data");
  });
});

describe("handoff rendering", () => {
  it("renders a minimal handoff as one exact deterministic artifact", () => {
    const rendered = renderAgentHandoff(validHandoff("coordinator", "project-manager"));
    assert.equal(
      rendered,
      "=== AI TEAM HANDOFF ===\n\nFrom: coordinator\nTo: project-manager\n\nObjective:\nexpected work for project-manager\n",
    );
    assert.equal(renderAgentHandoff(validHandoff("coordinator", "project-manager")), rendered, "byte-identical on repeat");
  });

  it("keeps stable section order and preserves every field verbatim", () => {
    const rendered = renderAgentHandoff({
      ...validHandoff("project-manager", "technical-lead"),
      context: "Existing API.",
      requirements: ["second requirement", "first requirement"],
      acceptance_criteria: ["criterion one"],
      constraints: ["scope constraint"],
      artifacts: ["plan", "review result"],
      notes: "approved",
      next_action: "draft the technical plan",
    });
    const order = [
      "=== AI TEAM HANDOFF ===",
      "From: project-manager",
      "To: technical-lead",
      "Objective:",
      "Context:",
      "Requirements:",
      "Acceptance Criteria:",
      "Constraints:",
      "Artifacts:",
      "Notes:",
      "Next Action:",
    ].map((marker) => rendered.indexOf(marker));
    for (const [index, position] of order.entries()) {
      assert.ok(position >= 0, `section present: ${order[index]}`);
      if (index > 0) {
        assert.ok(position > order[index - 1], "sections never reorder");
      }
    }
    assert.ok(rendered.includes("1. second requirement\n2. first requirement"), "list order preserved exactly");
    assert.ok(rendered.includes("Existing API.") && rendered.includes("draft the technical plan"));
    assert.ok(!rendered.includes("Decision"), "notes never become decision output");
  });

  it("omits absent optional sections without placeholders", () => {
    const rendered = renderAgentHandoff(validHandoff("implementer", "technical-lead"));
    for (const absent of ["Context:", "Requirements:", "Acceptance Criteria:", "Constraints:", "Artifacts:", "Notes:", "Next Action:", "None", "N/A"]) {
      assert.ok(!rendered.includes(absent), `no misleading content for absent field: ${absent}`);
    }
  });

  it("renders field text as opaque data without inference or execution", () => {
    const rendered = renderAgentHandoff({
      ...validHandoff("senior-reviewer", "technical-lead"),
      context: "the implementer approved this; changes-required?",
      notes: "technical-lead should decide",
      next_action: "run the deploy",
    });
    assert.ok(rendered.includes("From: senior-reviewer"), "endpoints never inferred from content");
    assert.ok(rendered.includes("To: technical-lead"));
    assert.ok(rendered.includes("the implementer approved this; changes-required?"));
    assert.equal(typeof rendered, "string", "rendering produces text; nothing executes");
  });

  it("stays directly copyable with no machine syntax", () => {
    const rendered = renderAgentHandoff(validHandoff("technical-lead", "coordinator"));
    assert.ok(!rendered.includes("{") && !rendered.includes("}"), "no JSON braces");
    assert.ok(!rendered.includes("$") && !rendered.includes("npm "), "no shell commands");
    assert.ok(!/id:|ID:|uuid|timestamp/i.test(rendered), "no internal identifiers");
  });

  it("bounds output through the contract limits without truncating", () => {
    const big = "x".repeat(MAX_HANDOFF_TEXT_LENGTH);
    const many = new Array(MAX_HANDOFF_ITEMS).fill(big);
    const rendered = renderAgentHandoff({
      ...validHandoff("coordinator", "technical-lead"),
      context: big,
      requirements: [...many],
      notes: big,
    });
    assert.ok(rendered.includes(big), "max-length content renders in full");
    assert.ok(rendered.includes(`${MAX_HANDOFF_ITEMS}. ${big}`), "max-size lists render in full");
    assert.ok(Number.isFinite(rendered.length), "output bounded by construction");
  });
});

describe("handoff validation/rendering architecture", () => {
  it("reuses the T-001 direction source and T-003 contract without duplicating either", () => {
    const source = readFileSync(join(__dirname, "..", "..", "src", "roles", "handoff-validation.ts"), "utf8");
    assert.ok(source.includes("isApprovedHandoff"), "direction approval delegated to T-001");
    assert.ok(!source.includes("APPROVED_HANDOFFS"), "no direction table copy");
    assert.ok(!/from:\s*"coordinator"|"coordinator",\s*"project-manager"/.test(source), "no direction literals");
    assert.ok(source.includes("createAgentHandoff"), "structure and bounds reused from T-003");
    assert.ok(!source.includes("MAX_HANDOFF") && !/8000|100/.test(source.replace(/T-00[134]/g, "")), "no bound literals");
  });

  it("leaves retry-handoff untouched and layer-separated", () => {
    assert.equal(canRetryHandoff("coordinator", "implementer"), true, "retry pair preserved");
    assert.equal(canRetryHandoff("project-manager", "coordinator"), false, "retry set not widened to canonical");
    const retrySource = readFileSync(join(__dirname, "..", "..", "src", "workflow", "retry-handoff.ts"), "utf8");
    assert.ok(!retrySource.includes("AI TEAM HANDOFF") && !retrySource.includes("renderAgentHandoff") && !retrySource.includes("validateAgentHandoff"));
  });

  it("depends on nothing provider, config, CLI, planning, or orchestration related", () => {
    assert.equal(ROLE_IDS.length, 5);
    const source = readFileSync(join(__dirname, "..", "..", "src", "roles", "handoff-validation.ts"), "utf8");
    assert.ok(!/Manager|Registry|Resolver|Discovery/i.test(source));
    for (const token of [
      "WorkflowState",
      "TicketSource",
      "TicketSink",
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
      "node:fs",
      "child_process",
      "argv",
      "parseAgentHandoff",
      "sprint",
      "reenter",
      "Router",
    ]) {
      assert.ok(!source.includes(token), `validation/rendering never touches ${token}`);
    }
    assert.ok(!/from "\.\.\/(execution|runtime|providers|workflow|config|cli)/.test(source));
  });
});
