import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAgentHandoff } from "../src/roles/handoff";
import { renderAgentHandoff } from "../src/roles/handoff-validation";
import { parseAgentHandoffText } from "../src/roles/handoff-parser";
import { RoleCommandDeps, runRoleCommand } from "../src/cli-role";
import { executeIndependentProjectManager } from "../src/roles/independent-execution";
import { withTempProjectAsync } from "./helpers/temp-project";

// Manual handoff resume tests (M25 T-018): canonical text in,
// validated handoff out, destination executor invoked. Parser
// unit coverage plus CLI resume coverage; spies stand in for
// the T-005 runtime boundary.
const handoffFull = createAgentHandoff({
  from: "project-manager",
  to: "technical-lead",
  objective: "Define the technical architecture for authentication.",
  context: "Existing API.",
  requirements: ["Users can sign in", "Sign-in form exists"],
  acceptance_criteria: ["Invalid credentials are rejected."],
  constraints: ["No new database"],
  artifacts: ["plan"],
  notes: "Open question: social login?",
  next_action: "Draft the technical plan.",
});

const handoffMinimal = createAgentHandoff({
  from: "implementer",
  to: "senior-reviewer",
  objective: "Review this implementation.",
});

const handoffMultiline = createAgentHandoff({
  from: "project-manager",
  to: "technical-lead",
  objective: "Line one.\nLine two.",
  context: "Para one.\n\nPara two.",
  requirements: ["First.", "Second line one.\nSecond line two."],
  notes: "Note one.\nNote two.",
  next_action: "Do A.\nThen B.",
});

describe("handoff parser basics", () => {
  it("round-trips full, minimal, and multiline handoffs exactly", () => {
    for (const original of [handoffFull, handoffMinimal, handoffMultiline]) {
      const parsed = parseAgentHandoffText(renderAgentHandoff(original));
      assert.deepEqual(parsed, original, "semantic equality without object identity");
      assert.ok(Object.isFrozen(parsed));
    }
  });

  it("preserves multiline content verbatim with order intact", () => {
    const parsed = parseAgentHandoffText(renderAgentHandoff(handoffMultiline));
    assert.equal(parsed.objective, "Line one.\nLine two.");
    assert.equal(parsed.context, "Para one.\n\nPara two.");
    assert.deepEqual(parsed.requirements, ["First.", "Second line one.\nSecond line two."]);
    assert.equal(parsed.notes, "Note one.\nNote two.");
  });

  it("tolerates CRLF and document-edge blank lines deterministically", () => {
    const crlf = renderAgentHandoff(handoffMinimal).replace(/\n/g, "\r\n");
    assert.deepEqual(parseAgentHandoffText(crlf), handoffMinimal);
    assert.deepEqual(parseAgentHandoffText(`\n\n${renderAgentHandoff(handoffMinimal)}\n\n`), handoffMinimal);
    assert.deepEqual(parseAgentHandoffText(renderAgentHandoff(handoffMinimal).slice(0, -1)), handoffMinimal, "missing final newline tolerated");
    assert.equal(renderAgentHandoff(parseAgentHandoffText(renderAgentHandoff(handoffFull))), renderAgentHandoff(handoffFull));
  });

  it("rejects malformed structure without guessing", () => {
    assert.throws(() => parseAgentHandoffText(""), "empty input rejected");
    assert.throws(() => parseAgentHandoffText(null), "non-string rejected");
    assert.throws(() => parseAgentHandoffText("hello world"), "missing marker rejected");
    assert.throws(() => parseAgentHandoffText("=== HANDOFF ===\nFrom: a\nTo: b\n\nObjective:\nx\n"), "wrong marker rejected");
    assert.throws(() => parseAgentHandoffText("=== AI TEAM HANDOFF ===\nTo: technical-lead\n\nObjective:\nx\n"), "missing From rejected");
    assert.throws(() => parseAgentHandoffText("=== AI TEAM HANDOFF ===\nFrom: coordinator\n\nObjective:\nx\n"), "missing To rejected");
    assert.throws(() => parseAgentHandoffText("=== AI TEAM HANDOFF ===\nFrom: coordinator\nTo: project-manager\n\nContext:\nx\n"), "missing Objective rejected");
    assert.throws(() => parseAgentHandoffText("=== AI TEAM HANDOFF ===\nFrom: coordinator\nFrom: coordinator\nTo: project-manager\n\nObjective:\nx\n"), "duplicate From rejected");
    assert.throws(() => parseAgentHandoffText("=== AI TEAM HANDOFF ===\nFrom: coordinator\nTo: project-manager\n\nObjective:\nx\n\nNotes:\na\n\nNotes:\nb\n"), "duplicate section rejected");
    assert.throws(() => parseAgentHandoffText("=== AI TEAM HANDOFF ===\nFrom: coordinator\nTo: project-manager\n\nObjective:\nx\n\nNotes:\na\n\nRequirements:\n1. b\n"), "out-of-order section rejected");
  });

  it("rejects malformed lists strictly", () => {
    const bad = (requirements: string) =>
      `=== AI TEAM HANDOFF ===\nFrom: coordinator\nTo: project-manager\n\nObjective:\nx\n\nRequirements:\n${requirements}`;
    assert.throws(() => parseAgentHandoffText(bad("1. First\n3. Third\n")), "gaps rejected, never tolerated");
    assert.throws(() => parseAgentHandoffText(bad("01. First\n")), "leading zeros rejected");
    assert.throws(() => parseAgentHandoffText(bad("1.First\n")), "missing space rejected");
    assert.throws(() => parseAgentHandoffText(bad("First\n")), "unnumbered content rejected");
    assert.throws(() => parseAgentHandoffText(bad("2. Second\n")), " numbering must start at one");
  });

  it("validates roles, directions, and endpoints through the canonical contract", () => {
    assert.throws(() => parseAgentHandoffText("=== AI TEAM HANDOFF ===\nFrom: pm\nTo: technical-lead\n\nObjective:\nx\n"), "aliases rejected");
    assert.throws(() => parseAgentHandoffText("=== AI TEAM HANDOFF ===\nFrom: coordinator\nTo: implementer\n\nObjective:\nx\n"), "unapproved direction rejected");
    assert.throws(() => parseAgentHandoffText("=== AI TEAM HANDOFF ===\nFrom: coordinator\nTo: coordinator\n\nObjective:\nx\n"), "identical endpoints rejected");
    assert.throws(() => parseAgentHandoffText("=== AI TEAM HANDOFF ===\nFrom: user\nTo: technical-lead\n\nObjective:\nx\n"), "human endpoints rejected");
  });

  it("keeps heading-like prose as content without corrupting semantics", () => {
    const tricky = createAgentHandoff({
      from: "coordinator",
      to: "project-manager",
      objective: "Fix it.\nDecision: approved",
    });
    const parsed = parseAgentHandoffText(renderAgentHandoff(tricky));
    assert.equal(parsed.objective, "Fix it.\nDecision: approved", "unknown headings stay content, never sections");
  });
});

function spy<T>(calls: unknown[], value: T): (call: unknown) => Promise<T> {
  return async (call: unknown) => {
    calls.push(call);
    return value;
  };
}

function fakeDeps(calls: Record<string, unknown[]>, stdinText: string, overrides: Partial<RoleCommandDeps> = {}): RoleCommandDeps {
  const provider = { name: "stub", execute: async () => ({ status: "succeeded" as const, text: "done" }) };
  return {
    projectRoot: "/proj",
    loadConfiguration: () => ({} as never),
    createAgent: () => provider,
    readReviewDecision: async () => ({ decision: "approved" as const }),
    readStdinText: async () => stdinText,
    executeImplementer: spy(calls.implementer ??= [], {
      role: "implementer" as const,
      execution: { outcome: "completed" as const, ticket_id: "T-001", result: { status: "succeeded" as const, text: "done" }, next_state: "implementation_review" as const },
    }),
    executeSeniorReviewer: spy(calls.reviewer ??= [], {
      role: "senior-reviewer" as const,
      execution: { outcome: "completed" as const, ticket_id: "T-001", report: "Clean.", next_state: null },
    }),
    executeTechnicalLead: spy(calls.lead ??= [], {
      role: "technical-lead" as const,
      execution: { outcome: "completed" as const, report: "Done." },
    }),
    executeProjectManager: spy(calls.manager ??= [], {
      role: "project-manager" as const,
      execution: { outcome: "completed" as const, report: "Done." },
    }),
    executeCoordinator: spy(calls.coordinator ??= [], {
      role: "coordinator" as const,
      execution: {
        outcome: "completed" as const,
        ticket_id: "T-001",
        final_state: "technical_approval" as const,
        transitions: [],
        implementation: { status: "succeeded" as const, text: "done" },
        report: "Reviewed clean.",
      },
    }),
    ...overrides,
  };
}

const tlArgs = ["role", "technical-lead", "--id", "T-001", "--title", "Title", "--description", "Desc.", "--requirements", "Flag reqs", "--state", "technical_approval"];

describe("cli manual resume", () => {
  it("resumes a pasted handoff into its destination role", async () => {
    const calls: Record<string, unknown[]> = {};
    const result = await runRoleCommand(fakeDeps(calls, renderAgentHandoff(handoffFull)), [...tlArgs, "--handoff-stdin"]);
    assert.equal(result.exitCode, 0);
    assert.equal(calls.lead.length, 1, "exactly the destination executor runs");
    const call = calls.lead[0] as { identity: unknown; handoff: unknown; input: { ticket: unknown } };
    assert.deepEqual(call.identity, { role: "technical-lead" });
    assert.deepEqual(call.handoff, handoffFull, "From preserved, validated handoff passed through");
    assert.ok(result.stdout.includes("role technical-lead completed."), "normal T-016 output preserved");
    for (const other of ["implementer", "reviewer", "manager", "coordinator"] as const) {
      assert.equal((calls[other] ?? []).length, 0, `${other} never invoked`);
    }
  });

  it("rejects destination mismatch without retargeting or executing", async () => {
    const providerCalls: unknown[] = [];
    const provider = {
      name: "stub",
      execute: async (request: unknown) => {
        providerCalls.push(request);
        return { status: "succeeded" as const, text: "done" };
      },
    };
    const calls: Record<string, unknown[]> = {};
    const deps = fakeDeps(calls, renderAgentHandoff(handoffFull), { executeProjectManager: executeIndependentProjectManager, createAgent: () => provider });
    const pmArgs = ["role", "project-manager", "--id", "T-001", "--title", "T", "--description", "D", "--requirements", "R", "--state", "technical_approval", "--handoff-stdin"];
    const result = await runRoleCommand(deps, pmArgs);
    assert.equal(result.exitCode, 1, "TL-addressed handoff never runs as PM");
    assert.equal(providerCalls.length, 0, "real T-005 gate rejects before any provider call");
    assert.ok(result.stderr.length > 0);
  });

  it("rejects empty, malformed, and unreadable handoff input", async () => {
    for (const stdinText of ["", "   \n  ", "hello world", "=== AI TEAM HANDOFF ===\nFrom: pm\nTo: x\n\nObjective:\ny\n"]) {
      const calls: Record<string, unknown[]> = {};
      const result = await runRoleCommand(fakeDeps(calls, stdinText), [...tlArgs, "--handoff-stdin"]);
      assert.equal(result.exitCode, 1, `${JSON.stringify(stdinText.slice(0, 20))} fails clearly`);
      assert.equal(result.stdout, "");
      assert.deepEqual(Object.values(calls).flat(), [], "no executor runs on rejected handoff");
    }
    const calls: Record<string, unknown[]> = {};
    const failing = fakeDeps(calls, renderAgentHandoff(handoffFull), {
      readStdinText: async () => {
        throw new Error("stdin exploded");
      },
    });
    const result = await runRoleCommand(failing, [...tlArgs, "--handoff-stdin"]);
    assert.equal(result.exitCode, 1);
  });

  it("keeps handoff provenance separate from flag-supplied role input", async () => {
    const calls: Record<string, unknown[]> = {};
    const result = await runRoleCommand(fakeDeps(calls, renderAgentHandoff(handoffFull)), [...tlArgs, "--handoff-stdin"]);
    assert.equal(result.exitCode, 0);
    const call = calls.lead[0] as { handoff: typeof handoffFull; input: { evidence: Array<{ requirements: string }> } };
    assert.equal(call.input.evidence[0].requirements, "Flag reqs", "execution input comes from flags only");
    assert.deepEqual(call.handoff.requirements, ["Users can sign in", "Sign-in form exists"], "handoff content never merged into inputs");
  });

  it("combines resume with copy-ready output for the manual loop", async () => {
    const calls: Record<string, unknown[]> = {};
    const deps = fakeDeps(calls, renderAgentHandoff(handoffFull), {
      executeTechnicalLead: spy(calls.lead ??= [], {
        role: "technical-lead" as const,
        handoff: handoffFull,
        execution: { outcome: "completed" as const, report: "Done." },
      }),
    });
    const result = await runRoleCommand(deps, [...tlArgs, "--handoff-stdin", "--show-handoff"]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, renderAgentHandoff(handoffFull), "resumed handoff redisplays byte-identically");
  });

  it("writes nothing and chains nothing on resume", async () => {
    await withTempProjectAsync({}, async (root) => {
      const calls: Record<string, unknown[]> = {};
      const deps = fakeDeps(calls, renderAgentHandoff(handoffFull));
      const result = await runRoleCommand({ ...deps, projectRoot: root }, [...tlArgs, "--handoff-stdin"]);
      assert.equal(result.exitCode, 0);
      assert.deepEqual(fs.readdirSync(root), [], "no handoff storage created");
    });
  });
});

describe("resume boundaries", () => {
  it("parses through the canonical contracts with no machinery of its own", () => {
    const source = readFileSync(join(__dirname, "..", "..", "src", "roles", "handoff-parser.ts"), "utf8");
    assert.ok(!/Manager|Registry|Resolver|Discovery|Finder|Chooser/i.test(source));
    for (const token of [
      "JSON.parse",
      "markdown",
      "frontmatter",
      "clipboard",
      "xclip",
      "node:fs",
      "child_process",
      "process.env",
      "delegate-skills",
      "FAST",
      "reenter",
      "Router",
      "WorkflowState",
      "TicketSource",
      "AgentProvider",
      "async ",
      "await ",
      "Promise<",
    ]) {
      assert.ok(!source.includes(token), `parser never touches ${token}`);
    }
    assert.ok(!/from "\.\.\/(execution|runtime|providers|workflow|config|cli)/.test(source));
    assert.ok(source.includes("validateAgentHandoff") && source.includes("renderAgentHandoff"), "parse, validate, and round-trip-verify composed");
  });

  it("reads handoff text only through the stdin transport with no storage", () => {
    const source = readFileSync(join(__dirname, "..", "..", "src", "cli-role.ts"), "utf8");
    assert.ok(source.includes("--handoff-stdin") && source.includes("readStdinText"));
    assert.ok(!source.includes("--handoff-file") && !source.includes("--handoff-text"), "single transport, no competing flags");
    assert.ok(!source.includes(".ai-team/handoffs") && !source.includes("handoff.json"), "no handoff storage system");
  });
});
