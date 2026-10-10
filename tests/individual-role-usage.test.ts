import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runRoleCommand, RoleCommandDeps } from "../src/cli-role";
import { executeIndependentImplementer } from "../src/roles/independent-execution";
import { renderAgentHandoff } from "../src/roles/handoff-validation";
import { ROLE_IDS } from "../src/roles/contract";
import { APPROVED_HANDOFFS, isApprovedHandoff } from "../src/roles/operating-model";

const GUIDE = join(__dirname, "..", "..", "docs", "individual-role-usage.md");
const REPO_ROOT = join(__dirname, "..", "..");

// Documented-path verification for docs/individual-role-usage.md
// (M30 T-047): every documented role command executes through the
// real parser with controlled executors, outputs and failures match
// the guide verbatim, the handoff round trip behaves as described,
// links resolve, and scope stays within T-047. No new product
// behavior.
function guideText(): string {
  return readFileSync(GUIDE, "utf8");
}

function stubProvider() {
  return { name: "stub", execute: async () => ({ status: "succeeded" as const, text: "stub output" }) };
}

function stubDeps(overrides: Partial<RoleCommandDeps> = {}): RoleCommandDeps {
  return {
    projectRoot: "/proj",
    loadConfiguration: () => ({ version: 1 as const }),
    createAgent: () => stubProvider(),
    readReviewDecision: async () => { throw new Error("must not prompt"); },
    readStdinText: async () => "",
    executeImplementer: async () => ({
      role: "implementer",
      execution: { outcome: "completed", ticket_id: "T-001", next_state: "implementation_review" },
    }),
    executeSeniorReviewer: async () => ({
      role: "senior-reviewer",
      execution: { outcome: "completed", ticket_id: "T-001", report: "Looks good." },
    }),
    executeTechnicalLead: async () => ({
      role: "technical-lead",
      execution: { outcome: "completed", report: "TL report." },
    }),
    executeProjectManager: async () => ({
      role: "project-manager",
      execution: { outcome: "completed", report: "PM report." },
    }),
    executeCoordinator: async () => ({
      role: "coordinator",
      execution: { outcome: "completed", ticket_id: "T-001", final_state: "closed" },
    }),
    ...overrides,
  } as unknown as RoleCommandDeps;
}

const TICKET = ["--id", "T-001", "--title", "Render the list", "--description", "D", "--requirements", "R"];

describe("individual role usage (M30 T-047)", () => {
  it("the guide references all five canonical role identifiers", () => {
    const text = guideText();
    for (const role of ["coordinator", "project-manager", "technical-lead", "implementer", "senior-reviewer"]) {
      assert.ok(text.includes(`ai-team role ${role}`), `the guide shows ai-team role ${role}`);
      assert.ok((ROLE_IDS as readonly string[]).includes(role), `${role} is canonical`);
    }
  });

  it("every documented role command executes through the real parser", async () => {
    const commands: string[][] = [
      ["role", "implementer", ...TICKET, "--specialty", "backend"],
      ["role", "senior-reviewer", ...TICKET, "--result", "Implemented per description."],
      ["role", "technical-lead", ...TICKET, "--state", "technical_approval"],
      ["role", "project-manager", ...TICKET, "--state", "pm_review"],
      ["role", "coordinator", ...TICKET, "--specialty", "backend", "--review-decision", "approved"],
      ["role", "pm", ...TICKET, "--state", "ready"],
    ];
    for (const argv of commands) {
      const result = await runRoleCommand(stubDeps(), argv);
      assert.equal(result.exitCode, 0, `${argv.slice(0, 2).join(" ")} exits 0: ${result.stderr}`);
    }
  });

  it("documented success and failure outputs match the real rendering", async () => {
    const implemented = await runRoleCommand(stubDeps(), ["role", "implementer", ...TICKET, "--specialty", "backend"]);
    assert.equal(implemented.stdout, "role implementer completed: ticket T-001 -> implementation_review.\n");
    const missing = await runRoleCommand(stubDeps(), ["role", "implementer", "--id", "T-001"]);
    assert.equal(missing.exitCode, 1);
    assert.match(missing.stderr, /missing required --title/);
    const specialty = await runRoleCommand(stubDeps(), ["role", "implementer", ...TICKET, "--specialty", "bogus"]);
    assert.match(specialty.stderr, /unknown specialty/);
    const state = await runRoleCommand(stubDeps(), ["role", "technical-lead", ...TICKET, "--state", "bogus"]);
    assert.match(state.stderr, /unknown workflow state/);
    const unknown = await runRoleCommand(stubDeps(), ["role", "bogus", "--id", "X"]);
    assert.equal(unknown.exitCode, 1);
    assert.match(unknown.stderr, /usage: ai-team role <role>/);
  });

  it("the documented handoff round trip behaves as described", async () => {
    const handoff = { from: "implementer", to: "senior-reviewer", objective: "Review T-001.", artifacts: ["T-001"] };
    const shown = await runRoleCommand(
      stubDeps({
        executeImplementer: async () => ({
          role: "implementer",
          execution: { outcome: "completed", ticket_id: "T-001", next_state: "implementation_review" },
          handoff,
        } as never),
      }),
      ["role", "implementer", ...TICKET, "--specialty", "backend", "--show-handoff"],
    );
    assert.equal(shown.exitCode, 0);
    assert.equal(shown.stdout, renderAgentHandoff(handoff));
    assert.match(shown.stdout, /^=== AI TEAM HANDOFF ===/);
    const resumed = await runRoleCommand(
      stubDeps({ readStdinText: async () => shown.stdout }),
      ["role", "senior-reviewer", ...TICKET, "--result", "Done.", "--handoff-stdin"],
    );
    assert.equal(resumed.exitCode, 0, `valid handoff resumes: ${resumed.stderr}`);
    const empty = await runRoleCommand(
      stubDeps(),
      ["role", "implementer", ...TICKET, "--specialty", "backend", "--show-handoff"],
    );
    assert.equal(empty.exitCode, 1);
    assert.match(empty.stderr, /no handoff available for role "implementer"/);
    const garbage = await runRoleCommand(
      stubDeps({ readStdinText: async () => "not a handoff" }),
      ["role", "senior-reviewer", ...TICKET, "--result", "Done.", "--handoff-stdin"],
    );
    assert.equal(garbage.exitCode, 1);
    assert.match(garbage.stderr, /handoff parser/);
  });

  it("destination mismatch fails through the real executor gate, as documented", async () => {
    const text = renderAgentHandoff({ from: "implementer", to: "senior-reviewer", objective: "Review T-001." });
    const result = await runRoleCommand(
      {
        ...stubDeps({ readStdinText: async () => text }),
        executeImplementer: executeIndependentImplementer,
      },
      ["role", "implementer", ...TICKET, "--specialty", "backend", "--handoff-stdin"],
    );
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /handoff addresses "senior-reviewer" and cannot authorize independent implementer execution/);
  });

  it("the guide never claims a single role command runs a workflow", () => {
    const text = guideText();
    assert.ok(!/runs the (whole|entire) team/i.test(text));
    assert.ok(!/automatically (executes|runs|triggers)/i.test(text));
    assert.ok(/does not run PM or Technical Lead|does not imply/i.test(text));
    assert.ok(/separate\n?operations|separate operations/i.test(text));
  });

  it("planning versus review responsibilities are kept distinct, per source", () => {
    const text = guideText();
    assert.ok(/not technical planning and not/i.test(text), "TL role command is acceptance, not planning");
    assert.ok(/not business planning/i.test(text), "PM role command is validation, not planning");
    assert.ok(/never\s+modifies\s+code/i.test(text), "reviewer is advisory");
    assert.ok(/never invents missing acceptance criteria/i.test(text), "implementer invents nothing");
    assert.ok(/never parses? .* into requirements|never parsed from provider text|never parse/i.test(text), "reports stay opaque");
  });

  it("the documented handoff directions match the operating model exactly", () => {
    const text = guideText();
    const pairs: [string, string][] = [
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
    assert.deepEqual([...APPROVED_HANDOFFS].map((pair) => [...pair]), pairs.map((pair) => [...pair]));
    for (const [from, to] of pairs) {
      assert.ok(isApprovedHandoff(from, to), `${from} -> ${to} is approved`);
      assert.ok(text.includes(`${from} -> ${to}`), `the guide lists ${from} -> ${to}`);
    }
    assert.ok(!isApprovedHandoff("coordinator", "implementer"), "unlisted pairs stay unapproved");
    assert.ok(!isApprovedHandoff("implementer", "coordinator"), "unlisted pairs stay unapproved");
  });

  it("every documentation link resolves and every referenced module exists", () => {
    const text = guideText();
    const links = [...text.matchAll(/`?(docs\/[a-z0-9-]+\.md)`?/g)].map((match) => match[1]);
    assert.ok(links.length > 0);
    for (const link of new Set(links)) {
      assert.ok(existsSync(join(REPO_ROOT, link)), `guide link resolves: ${link}`);
    }
    for (const module of ["src/cli-role.ts", "src/roles/operating-model.ts", "src/roles/independent-execution.ts"]) {
      assert.ok(existsSync(join(REPO_ROOT, module)), `referenced module exists: ${module}`);
    }
  });

  it("no secrets, invented flags, or overstated Delegate role appear", () => {
    const text = guideText();
    assert.ok(!/--token|password|Bearer|_auth/i.test(text), "no credential material");
    assert.ok(!/--plan|--sprint|--mode|--auto\b/i.test(text), "no invented flags");
    assert.ok(/implementer destination only/i.test(text), "Delegate stays implementer-only");
    assert.ok(/T-048/.test(text) && /forthcoming/i.test(text), "the Delegate guide is deferred, not written");
  });

  it("no T-048 through T-050 surface is added", () => {
    assert.ok(!existsSync(join(REPO_ROOT, "docs", "delegate-mode-guide.md")), "no Delegate guide file");
    const srcFiles = ["cli-role.ts", "cli-run.ts", "cli-setup.ts", "cli-sprint.ts", "cli-status.ts"];
    for (const file of srcFiles) {
      assert.ok(existsSync(join(REPO_ROOT, "src", file)), `existing CLI surface unchanged: ${file}`);
    }
  });
});
