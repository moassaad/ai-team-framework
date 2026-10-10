import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProjectSetup } from "../src/config/setup";
import { validateProjectContext } from "../src/discovery/contract";
import { generateProjectAnalysis } from "../src/discovery/report";
import { runNewProject } from "../src/runtime/new-project-workflow";
import { runExistingProject } from "../src/runtime/existing-project-workflow";
import { runFastBugLifecycle } from "../src/runtime/fast-bug-lifecycle";
import { runStandardFeatureLifecycle } from "../src/runtime/standard-feature-lifecycle";
import { runFullFeatureLifecycle } from "../src/runtime/full-feature-lifecycle";
import { runRoleCommand, RoleCommandDeps } from "../src/cli-role";
import { validateAgentHandoff, renderAgentHandoff } from "../src/roles/handoff-validation";
import { parseAgentHandoffText } from "../src/roles/handoff-parser";
import { dispatchHandoff } from "../src/runtime/handoff-dispatcher";
import { createDelegateSkillsHandoffTransport } from "../src/providers/delegate-handoff-transport";
import { createManualFallback } from "../src/runtime/delegate-fallback";
import { createCorrectionReference } from "../src/runtime/correction-reference";
import { createUserCheckpoint, resolveUserCheckpoint } from "../src/runtime/user-checkpoint";

const REPO_ROOT = join(__dirname, "..", "..");
const CLI = join(REPO_ROOT, "dist", "index.js");

// Final product E2E verification (M30 T-049): one executable pass
// over the assembled product — setup, both planning journeys, the
// three lifecycle modes crossed with manual/delegate continuation
// on new and existing projects, roles plus manual handoff, the
// correction/checkpoint contracts, and the real packaged CLI.
// Providers and transports are controlled test doubles (stubs),
// stated as such: they prove contract behavior, never model
// quality or a real external integration. No production source is
// touched by these tests.
function stubProvider(calls: string[] = []) {
  return {
    name: "stub",
    execute: async (request: { prompt?: string; project_root?: string; role?: string }) => {
      calls.push(request.role ?? "unknown");
      return { status: "succeeded" as const, text: `${request.role ?? "unknown"} output` };
    },
  };
}

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "final-e2e-"));
  assert.equal(runProjectSetup({ project_root: root }).status, "completed");
  return root;
}

function existingFixture(): { root: string; appSource: string } {
  const root = mkdtempSync(join(tmpdir(), "final-e2e-existing-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "reader", version: "1.0.0" }), "utf8");
  mkdirSync(join(root, "src"), { recursive: true });
  const appSource = "console.log(\"reader\");\n";
  writeFileSync(join(root, "src", "app.js"), appSource, "utf8");
  assert.equal(runProjectSetup({ project_root: root }).status, "completed");
  return { root, appSource };
}

function planningFields() {
  return {
    pm: {
      requirements: ["Saved articles appear in reverse-chronological order"],
      scope: { in_scope: ["Reading-list page"], out_of_scope: ["Offline sync"] },
      acceptance_criteria: ["Saved articles render newest first."],
      business_rules: ["Only the owning reader sees their list."],
      business_constraints: ["Launch behind the existing reader flag."],
    },
    tl: {
      architecture: ["Server-rendered page over the article store."],
      decomposition_strategy: ["Split page render from read-state update."],
      technical_constraints: ["Reuse the article store client."],
      dependencies: ["Article store availability."],
    },
    pmApproval: { identity: { role: "project-manager" }, decision: "approved" },
    tlApproval: { identity: { role: "technical-lead" }, decision: "approved" },
    sprint: { id: "sprint-reading-list", goal: "Ship the reading-list page." },
    tasks: [
      {
        id: "T-101",
        title: "Render the reading-list page",
        description: "Server-render saved articles newest first.",
        requirements: "Saved articles appear in reverse-chronological order",
        acceptance_criteria: ["Saved articles render newest first."],
        specialty: "backend",
      },
    ],
  };
}

function stubRoleDeps(overrides: Partial<RoleCommandDeps> = {}): RoleCommandDeps {
  return {
    projectRoot: "/proj",
    loadConfiguration: () => ({ version: 1 as const }),
    createAgent: () => stubProvider(),
    readReviewDecision: async () => { throw new Error("must not prompt"); },
    readStdinText: async () => "",
    executeImplementer: async () => ({
      role: "implementer",
      execution: { outcome: "completed", ticket_id: "T-001", next_state: "implementation_review" },
      handoff: { from: "implementer", to: "senior-reviewer", objective: "Review T-001.", artifacts: ["T-001"] },
    } as never),
    executeSeniorReviewer: async () => ({
      role: "senior-reviewer",
      execution: { outcome: "completed", ticket_id: "T-001", report: "Looks good." },
    } as never),
    executeTechnicalLead: async () => ({ role: "technical-lead", execution: { outcome: "completed", report: "TL ok." } } as never),
    executeProjectManager: async () => ({ role: "project-manager", execution: { outcome: "completed", report: "PM ok." } } as never),
    executeCoordinator: async () => ({
      role: "coordinator",
      execution: { outcome: "completed", ticket_id: "T-001", final_state: "closed" },
    } as never),
    ...overrides,
  } as unknown as RoleCommandDeps;
}

function delegateTransport(outcome = "stubbed delegate outcome") {
  return createDelegateSkillsHandoffTransport({
    provider: { name: "stub-relay", delegate: async () => ({ outcome }) },
  });
}

describe("final product E2E verification (M30 T-049)", () => {
  describe("setup and planning journeys", () => {
    it("project setup completes, repeats as a no-op, and reports invalid configuration", () => {
      const root = mkdtempSync(join(tmpdir(), "final-e2e-"));
      assert.equal(runProjectSetup({ project_root: root }).status, "completed");
      assert.equal(runProjectSetup({ project_root: root }).status, "already-configured");
      const badRoot = mkdtempSync(join(tmpdir(), "final-e2e-"));
      mkdirSync(join(badRoot, ".ai-team"), { recursive: true });
      writeFileSync(join(badRoot, ".ai-team", "config.yaml"), "version: 99\n", "utf8");
      const bad = runProjectSetup({ project_root: badRoot });
      assert.equal(bad.status, "invalid-configuration");
      assert.equal(readFileSync(join(badRoot, ".ai-team", "config.yaml"), "utf8"), "version: 99\n");
    });

    it("new-project planning completes with persistence and readback", async () => {
      const root = freshRoot();
      const result = await runNewProject({
        request: "Build a reading-list service for saved articles.",
        ...planningFields(),
        project_root: root,
        provider: stubProvider(),
        timeout_ms: 10000,
      });
      assert.equal(result.outcome, "completed");
      if (result.outcome !== "completed") {
        throw new Error("unreachable");
      }
      assert.equal(result.workflow, "new-project");
      assert.ok(existsSync(result.planPath));
    });

    it("existing-project planning discovers, plans, persists, and preserves source", async () => {
      const { root, appSource } = existingFixture();
      const project = validateProjectContext({ root, name: "reader", kind: "existing" });
      const analysis = generateProjectAnalysis(project);
      assert.ok(analysis.findings.length > 0);
      assert.ok(analysis.coverage.analyzed.length > 0);
      const result = await runExistingProject({
        project,
        request: "Plan the reading-list page for the existing reader app.",
        ...planningFields(),
        provider: stubProvider(),
        timeout_ms: 10000,
      });
      assert.equal(result.outcome, "completed");
      if (result.outcome !== "completed") {
        throw new Error("unreachable");
      }
      assert.equal(result.workflow, "existing-project");
      assert.ok(result.discovery.findings.length > 0);
      assert.ok(existsSync(result.planPath));
      assert.ok(result.planPath.startsWith(`${root}/`), "the plan persists under the analyzed root");
      assert.equal(readFileSync(join(root, "src", "app.js"), "utf8"), appSource);
    });
  });

  describe("roadmap matrix: mode x delegate x project", () => {
    async function runMode(mode: "fast" | "standard" | "full", project_root: string) {
      const provider = stubProvider();
      if (mode === "fast") {
        return runFastBugLifecycle({
          ticket: { id: "B-101", title: "Fix loop", description: "Login loops.", requirements: "Login lands once" },
          specialty: "backend",
          project_root,
          provider,
          reviewDecision: () => ({ decision: "approved" as const }),
          timeout_ms: 10000,
        });
      }
      if (mode === "standard") {
        return runStandardFeatureLifecycle({
          request: "Add request logging.",
          ticket: { id: "T-201", title: "Log requests", description: "Log each path.", requirements: "Every path logged" },
          tlEvidence: [{ id: "T-201", title: "Log requests", description: "Log each path.", requirements: "Every path logged", state: "ready" as const }],
          specialty: "backend",
          project_root,
          provider,
          reviewDecision: () => ({ decision: "approved" as const }),
          timeout_ms: 10000,
        });
      }
      return runFullFeatureLifecycle({
        request: "Add a reading-list page.",
        ...planningFields(),
        task_id: "T-101",
        project_root,
        specialty: "backend",
        provider,
        reviewDecision: () => ({ decision: "approved" as const }),
        decideTechnicalLead: () => ({ decision: "approved" as const }),
        decidePmUserTesting: () => ({ decision: "approved" as const }),
        coordinator: { role: "coordinator" },
        decideFinalApproval: () => ({ decision: "approved" as const }),
        timeout_ms: 10000,
      });
    }

    const handoffFor = () => validateAgentHandoff({
      from: "technical-lead",
      to: "implementer",
      objective: "Implement the planned ticket.",
      artifacts: ["T-101"],
    });

    for (const mode of ["fast", "standard", "full"] as const) {
      for (const project of ["new", "existing"] as const) {
        it(`${mode} x manual x ${project}: lifecycle completes and the handoff round-trips manually`, async () => {
          const root = project === "new" ? freshRoot() : existingFixture().root;
          const result = await runMode(mode, root);
          assert.equal(result.outcome, "completed", `${mode}/${project} completes`);
          assert.equal((result as { mode?: string }).mode, mode);
          const manual = validateAgentHandoff(parseAgentHandoffText(renderAgentHandoff(handoffFor())));
          assert.deepEqual(manual, handoffFor());
        });

        it(`${mode} x delegate x ${project}: lifecycle completes and the stub transport dispatches`, async () => {
          const root = project === "new" ? freshRoot() : existingFixture().root;
          const result = await runMode(mode, root);
          assert.equal(result.outcome, "completed", `${mode}/${project} completes`);
          const dispatched = await dispatchHandoff({ handoff: handoffFor(), transport: delegateTransport() });
          assert.equal(dispatched.outcome, "dispatched");
          if (dispatched.outcome !== "dispatched") {
            throw new Error("unreachable");
          }
          assert.equal(dispatched.destination, "implementer");
          assert.deepEqual(dispatched.receipt, { outcome: "stubbed delegate outcome" });
        });
      }
    }

    it("delegate failure continues explicitly through manual fallback, never silently", async () => {
      const failed = await dispatchHandoff({
        handoff: handoffFor(),
        transport: { name: "broken", dispatch: async () => { throw new Error("relay down"); } },
      });
      assert.equal(failed.outcome, "failed");
      if (failed.outcome !== "failed") {
        throw new Error("unreachable");
      }
      const fallback = createManualFallback({ failure: failed });
      assert.equal(fallback.transport, "manual");
      assert.match(fallback.renderedHandoff, /^=== AI TEAM HANDOFF ===/);
    });
  });

  describe("roles, handoff, correction, and checkpoints", () => {
    it("all five roles execute through the real parser and the handoff resumes", async () => {
      const ticket = ["--id", "T-001", "--title", "T", "--description", "D", "--requirements", "R"];
      const cases: string[][] = [
        ["role", "implementer", ...ticket, "--specialty", "backend"],
        ["role", "senior-reviewer", ...ticket, "--result", "Done."],
        ["role", "technical-lead", ...ticket, "--state", "technical_approval"],
        ["role", "project-manager", ...ticket, "--state", "pm_review"],
        ["role", "coordinator", ...ticket, "--specialty", "backend", "--review-decision", "approved"],
      ];
      for (const argv of cases) {
        const result = await runRoleCommand(stubRoleDeps(), argv);
        assert.equal(result.exitCode, 0, `${argv[1]} executes: ${result.stderr}`);
      }
      const shown = await runRoleCommand(stubRoleDeps(), ["role", "implementer", ...ticket, "--specialty", "backend", "--show-handoff"]);
      assert.equal(shown.exitCode, 0);
      const resumed = await runRoleCommand(
        stubRoleDeps({ readStdinText: async () => shown.stdout }),
        ["role", "senior-reviewer", ...ticket, "--result", "Done.", "--handoff-stdin"],
      );
      assert.equal(resumed.exitCode, 0, `handoff resumes: ${resumed.stderr}`);
    });

    it("correction and checkpoint contracts compose without executing roles", () => {
      const reference = createCorrectionReference({
        origin: "reviewer",
        ticketIds: ["T-101"],
        feedback: "Sort newest first.",
        action: { description: "Revise T-101 per feedback.", ticketId: "T-101" },
      });
      assert.equal(reference.feedback, "Sort newest first.");
      const checkpoint = createUserCheckpoint({
        id: "final-plan-001",
        boundary: "plan-approval",
        workflow: "new-project",
        stage: "planning-approval",
        purpose: "Approve the plan before decomposition.",
      });
      const resolution = resolveUserCheckpoint({
        checkpoint,
        response: { checkpointId: "final-plan-001", stage: "planning-approval", decision: "proceed" },
      });
      assert.equal(resolution.status, "proceed");
      assert.ok(!("authority" in resolution), "no impersonated approval");
    });
  });

  describe("packaged CLI surface", () => {
    function runCli(args: readonly string[], cwd: string): { exit: number; stdout: string; stderr: string } {
      try {
        const stdout = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
        return { exit: 0, stdout, stderr: "" };
      } catch (error: unknown) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };
        return { exit: failure.status ?? 1, stdout: String(failure.stdout ?? ""), stderr: String(failure.stderr ?? "") };
      }
    }

    it("--help and --version behave on the packaged binary", () => {
      const help = runCli(["--help"], REPO_ROOT);
      assert.equal(help.exit, 0);
      assert.match(help.stdout, /ai-team run/);
      const version = runCli(["--version"], REPO_ROOT);
      assert.equal(version.exit, 0);
      assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
    });

    it("status distinguishes configured from unconfigured locations", () => {
      const configured = runCli(["status"], freshRoot());
      assert.equal(configured.exit, 0);
      assert.match(configured.stdout, /Integration status:/);
      const unconfigured = runCli(["status"], mkdtempSync(join(tmpdir(), "final-e2e-")));
      assert.equal(unconfigured.exit, 1);
      assert.match(unconfigured.stderr, /Configuration file not found/);
    });

    it("role and setup usage errors exit non-zero with bounded messages", () => {
      const role = runCli(["role"], REPO_ROOT);
      assert.equal(role.exit, 1);
      assert.match(role.stderr, /usage: ai-team role <role>/);
      const setup = runCli(["setup"], REPO_ROOT);
      assert.equal(setup.exit, 1);
      assert.match(setup.stderr, /usage: ai-team setup <integration>/);
    });
  });

  describe("verification guides exist", () => {
    it("all five M30 usage guides are present", () => {
      for (const guide of [
        "docs/quick-start-new-project.md",
        "docs/quick-start-existing-project.md",
        "docs/individual-role-usage.md",
        "docs/delegate-mode.md",
        "docs/configuration.md",
      ]) {
        assert.ok(existsSync(join(REPO_ROOT, guide)), guide);
      }
    });
  });
});
