import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExistingProject, ExistingProjectInput } from "../src/runtime/existing-project-workflow";
import { runNewProject } from "../src/runtime/new-project-workflow";
import { getWorkModeDescriptor } from "../src/runtime/work-mode";

// Existing project workflow tests (M29 T-038): validated
// existing context plus read-only analysis, then the proven
// T-037 planning sequence bound to the analyzed root.
// Planning only: no execution, no scaffolding, no invention.
// Hermetic: temp roots, counting provider, real detectors.

const WORKFLOW_SOURCE = join(__dirname, "..", "..", "src", "runtime", "existing-project-workflow.ts");

function codeLines(): string {
  return readFileSync(WORKFLOW_SOURCE, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/**") && !trimmed.startsWith("*/");
    })
    .join("\n");
}

interface CallRecord {
  prompt: string;
  project_root: string;
  role?: string;
}

function existingProjectInput(overrides: Partial<ExistingProjectInput> = {}, calls: CallRecord[] = [], root?: string): { input: ExistingProjectInput; calls: CallRecord[]; root: string } {
  const projectRoot = root ?? mkdtempSync(join(tmpdir(), "existing-"));
  return {
    calls,
    root: projectRoot,
    input: {
      project: { root: projectRoot, name: "reading-list", kind: "existing" as const },
      request: "Evolve the reading-list service with archived-article filtering.",
      pm: {
        requirements: ["Archived articles are excluded by default"],
        scope: { in_scope: ["Archive filter"], out_of_scope: ["Offline sync"] },
        acceptance_criteria: ["Archived articles are hidden by default."],
        business_rules: ["Only the owning reader sees their list."],
        business_constraints: ["Launch behind the existing reader flag."],
      },
      tl: {
        architecture: ["Filter over the existing article store."],
        decomposition_strategy: ["Split filter logic from page render."],
        technical_constraints: ["Reuse the article store client."],
        dependencies: ["Article store availability."],
      },
      pmApproval: { identity: { role: "project-manager" }, decision: "approved" },
      tlApproval: { identity: { role: "technical-lead" }, decision: "approved" },
      sprint: { id: "sprint-archive-filter", goal: "Ship the archive filter." },
      tasks: [
        { id: "T-201", title: "Exclude archived articles", description: "Filter archived rows newest first.", requirements: "Archived articles are excluded by default", acceptance_criteria: ["Archived articles are hidden by default."], specialty: "backend" },
      ],
      provider: {
        name: "stub",
        execute: async (request: { prompt: string; project_root: string; role?: string }) => {
          calls.push({ prompt: request.prompt, project_root: request.project_root, role: request.role });
          return { status: "succeeded" as const, text: `${request.role ?? "unknown"} output` };
        },
      },
      timeout_ms: 1000,
      ...overrides,
    },
  };
}

describe("existing project workflow (M29 T-038)", () => {
  describe("context validation", () => {
    it("accepts valid existing-project context with a real analysis report", async () => {
      const { input } = existingProjectInput();
      const result = await runExistingProject(input);
      assert.equal(result.outcome, "completed");
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.equal(result.workflow, "existing-project");
      assert.equal(result.discovery.project.root, input.project !== undefined ? (input.project as { root: string }).root : "");
      assert.ok(Array.isArray(result.discovery.findings));
      assert.ok(result.discovery.coverage.totalSpecCategories > 0);
      assert.ok(Object.isFrozen(result.discovery));
    });

    it("rejects missing, malformed, and non-existing project kinds", async () => {
      for (const project of [undefined, null, {}, { root: "" }, { root: "/x", kind: "new" }, { root: "/x", kind: "greenfield" }, "root"]) {
        const { input, calls } = existingProjectInput({ project });
        await assert.rejects(runExistingProject(input), /project context|project kind "existing"/);
        assert.equal(calls.length, 0, "no planning call without trusted context");
      }
    });

    it("a root alone never proves discovery: kind is mandatory", async () => {
      const root = mkdtempSync(join(tmpdir(), "existing-"));
      const { input, calls } = existingProjectInput({ project: { root } });
      await assert.rejects(runExistingProject(input), /kind "existing"/);
      assert.equal(calls.length, 0);
    });

    it("unreadable roots fail discovery before any planning call", async () => {
      const { input, calls } = existingProjectInput({ project: { root: "/no-such-project-root-038", kind: "existing" as const } });
      const result = await runExistingProject(input);
      assert.equal(result.outcome, "failed");
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.stage, "discovery");
      assert.equal(result.error.kind, "discovery-error");
      assert.ok(!("discovery" in result), "no report exists when analysis never ran");
      assert.equal(calls.length, 0);
    });

    it("detectors read the actual root instead of inventing facts", async () => {
      const root = mkdtempSync(join(tmpdir(), "existing-"));
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "archived-app", dependencies: { express: "^4.0.0" } }));
      const { input } = existingProjectInput({ project: { root, kind: "existing" as const } });
      const result = await runExistingProject(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      const values = JSON.stringify(result.discovery.findings);
      assert.ok(values.includes("express"), "real dependency detected from the actual root");
      assert.ok(!values.includes("invented-framework-xyz"));
    });
  });

  describe("planning sequence", () => {
    it("runs coordinator, PM, TL planning, then decomposition in order", async () => {
      const { input, calls } = existingProjectInput();
      const result = await runExistingProject(input);
      assert.equal(result.outcome, "completed");
      assert.deepEqual(calls.map((call) => call.role), ["coordinator", "project-manager", "technical-lead", "technical-lead"]);
    });

    it("handoffs flow through validated seams with request content intact", async () => {
      const { input, calls } = existingProjectInput();
      await runExistingProject(input);
      const pmCall = calls.find((call) => call.role === "project-manager");
      assert.ok(pmCall !== undefined && pmCall.prompt.includes("Evolve the reading-list service"));
      const tlCall = calls.filter((call) => call.role === "technical-lead")[0];
      assert.ok(tlCall.prompt.includes("Archived articles are excluded by default"));
    });

    it("composes the complete artifact and persists the read-back plan under the analyzed root", async () => {
      const { input, root } = existingProjectInput();
      const result = await runExistingProject(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.ok(result.artifact.coordinator !== undefined && result.artifact.project_manager !== undefined && result.artifact.technical_lead !== undefined);
      assert.equal(result.pmApproval.authority, "project-manager");
      assert.equal(result.tlApproval.authority, "technical-lead");
      assert.deepEqual(result.sprint.tasks, ["T-201"]);
      assert.equal(result.tasks[0].sprint, "sprint-archive-filter");
      const stored = JSON.parse(readFileSync(join(root, ".ai-team", "plans", "sprint-archive-filter.json"), "utf8"));
      assert.equal(stored.tasks.length, 1);
    });

    it("reports stay opaque and out of structured data", async () => {
      const { input } = existingProjectInput();
      const result = await runExistingProject(input);
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.ok(!JSON.stringify({ artifact: result.artifact, sprint: result.sprint }).includes(" output"));
    });

    it("stop guarantees hold per stage with exact call counts", async () => {
      const pmReject = existingProjectInput({ pmApproval: { identity: { role: "project-manager" }, decision: "changes-required", notes: "Narrow it." } });
      const pmResult = await runExistingProject(pmReject.input);
      assert.equal(pmResult.outcome, "changes-required");
      if (pmResult.outcome !== "changes-required") throw new Error("unreachable");
      assert.equal(pmResult.stage, "planning-approval");
      assert.equal(pmResult.feedback, "Narrow it.");
      assert.equal(pmReject.calls.length, 3);
      assert.ok("discovery" in pmResult, "report attached even when planning stops");

      const badTasks = existingProjectInput({ tasks: [{ id: "T-1", title: "t", description: "d", requirements: "r" }, { id: "T-1", title: "dup", description: "d", requirements: "r" }] });
      await assert.rejects(runExistingProject(badTasks.input), /duplicate task id/);
      assert.equal(badTasks.calls.length, 3, "planning only; malformed decomposition input fails loud");
    });

    it("is deterministic across runs apart from the root path", async () => {
      const first = await runExistingProject(existingProjectInput().input);
      const second = await runExistingProject(existingProjectInput().input);
      assert.equal(first.outcome, "completed");
      assert.deepEqual({ ...first, planPath: "x", discovery: "x" }, { ...second, planPath: "x", discovery: "x" });
    });
  });

  describe("boundaries", () => {
    it("creates no project source files and mutates no caller inputs", async () => {
      const root = mkdtempSync(join(tmpdir(), "existing-"));
      writeFileSync(join(root, "app.js"), "// existing source");
      const { input } = existingProjectInput({ project: { root, kind: "existing" as const } });
      const tasksBefore = JSON.stringify(input.tasks);
      await runExistingProject(input);
      assert.equal(readFileSync(join(root, "app.js"), "utf8"), "// existing source");
      assert.deepEqual(readdirSync(root).sort(), [".ai-team", "app.js"]);
      assert.equal(JSON.stringify(input.tasks), tasksBefore);
      assert.deepEqual(input.project, { root, kind: "existing" });
    });

    it("executes no Implementer, Reviewer, acceptance, validation, or approval role", async () => {
      const { input, calls } = existingProjectInput();
      await runExistingProject(input);
      assert.ok(calls.every((call) => call.role === "coordinator" || call.role === "project-manager" || call.role === "technical-lead"));
      const code = codeLines();
      for (const forbidden of ["executeIndependent", "independent-execution", "runPmUserTestingReview", "runFinalApproval", "runTechnicalLeadReview", "IssueProvider", "dispatch", "Delegate", "scaffold", "Scaffold", "mkdir", "writeFile", "runFast", "runStandard", "runFull", "recommend", "guardrail", "reentry", "FAST", "STANDARD", "FULL", "cli", "CLI", "spawn", "node:"]) {
        assert.ok(!code.includes(forbidden), `workflow code never mentions ${forbidden}`);
      }
    });

    it("reuses runNewProject instead of duplicating stage logic", () => {
      const code = codeLines();
      assert.ok(code.includes("runNewProject"));
      assert.ok(!code.includes("runCoordinatorPlanning") && !code.includes("runPmPlanning") && !code.includes("runTechnicalLeadPlanning"));
      assert.ok(!code.includes("decidePlanningApproval") && !code.includes("persistSprintPlan"));
    });

    it("imports only discovery, workflow, model, and full-path types", () => {
      const imports = readFileSync(WORKFLOW_SOURCE, "utf8")
        .split("\n")
        .filter((line) => line.trim().startsWith("import "));
      assert.deepEqual(imports, [
        'import { AgentProvider } from "../providers/agent";',
        'import { ExecutionResult } from "../providers/result";',
        'import { validateProjectContext, ProjectContext } from "../discovery/contract";',
        'import { generateProjectAnalysis, ProjectAnalysisReport } from "../discovery/report";',
        "import {",
        'import { PlanningArtifact } from "./planning-artifact";',
        'import { PlanningApprovalResult } from "./planning-approval";',
        'import { Sprint } from "./sprint-model";',
        'import { Task } from "./task-model";',
        'import { FullPmSection, FullTlSection, FullApprovalDecision } from "./full-path";',
      ]);
    });

    it("leaves T-037, discovery, and T-026 through T-036 contracts unchanged", async () => {
      const { input } = existingProjectInput();
      const result = await runExistingProject(input);
      assert.equal(result.outcome, "completed");
      assert.deepEqual(getWorkModeDescriptor("full").lifecycle.length, 7);
      for (const file of ["src/runtime/new-project-workflow.ts", "src/discovery/contract.ts", "src/discovery/report.ts", "src/runtime/full-path.ts", "src/runtime/reentry-request.ts"]) {
        const code = readFileSync(join(__dirname, "..", "..", file), "utf8");
        assert.ok(!code.includes("existing-project-workflow") && !code.includes("ExistingProject"), `${file} unchanged by T-038`);
      }
      const direct = await runNewProject({ request: "x", pm: {}, tl: {}, pmApproval: { identity: { role: "project-manager" }, decision: "approved" }, tlApproval: { identity: { role: "technical-lead" }, decision: "approved" }, sprint: { id: "s", goal: "g" }, tasks: [{ id: "T-1", title: "t", description: "d", requirements: "r" }], project_root: mkdtempSync(join(tmpdir(), "direct-")), provider: input.provider, timeout_ms: 1000 });
      assert.equal(direct.outcome, "completed");
      if (direct.outcome !== "completed") throw new Error("unreachable");
      assert.equal(direct.workflow, "new-project", "T-037 tag intact beside the new workflow");
    });
  });
});
