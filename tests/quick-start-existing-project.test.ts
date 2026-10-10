import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProjectSetup } from "../src/config/setup";
import { validateProjectContext } from "../src/discovery/contract";
import { generateProjectAnalysis } from "../src/discovery/report";
import { runExistingProject } from "../src/runtime/existing-project-workflow";

const GUIDE = join(__dirname, "..", "..", "docs", "quick-start-existing-project.md");
const REPO_ROOT = join(__dirname, "..", "..");

// Documented-path verification for docs/quick-start-existing-project.md
// (M30 T-046): the guide's exact context, discovery, and planning
// sequence executes against a real fixture project, existing source
// stays intact, every documentation link resolves, and every
// referenced module path exists. No new product behavior.
function guideText(): string {
  return readFileSync(GUIDE, "utf8");
}

/** A minimal pre-existing project: manifest plus application source. */
function fixtureProject(): { root: string; appSource: string } {
  const root = mkdtempSync(join(tmpdir(), "qs-existing-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "reading-list", version: "1.0.0", scripts: { test: "node --test" } }),
    "utf8",
  );
  mkdirSync(join(root, "src"), { recursive: true });
  const appSource = "console.log(\"reading list\");\n";
  writeFileSync(join(root, "src", "app.js"), appSource, "utf8");
  return { root, appSource };
}

function stubProvider() {
  return {
    name: "stub",
    execute: async (request: { role?: string }) => ({ status: "succeeded" as const, text: `${request.role} output` }),
  };
}

describe("existing project quick start (M30 T-046)", () => {
  it("the documented setup step preserves the existing source tree", () => {
    const { root, appSource } = fixtureProject();
    const setup = runProjectSetup({ project_root: root });
    assert.equal(setup.status, "completed");
    assert.equal(readFileSync(join(root, "src", "app.js"), "utf8"), appSource);
    assert.ok(existsSync(join(root, ".ai-team", "config.yaml")));
    assert.equal(runProjectSetup({ project_root: root }).status, "already-configured");
  });

  it("the documented context and discovery sequence reports honest findings", () => {
    const { root } = fixtureProject();
    const project = validateProjectContext({ root, name: "reading-list", kind: "existing" });
    assert.deepEqual(project, { root, name: "reading-list", kind: "existing" });
    assert.ok(Object.isFrozen(project));
    const report = generateProjectAnalysis(project);
    assert.ok(report.findings.length > 0);
    const languages = report.findings.find((finding) => finding.category === "languages");
    assert.equal(languages?.status, "detected");
    assert.ok(report.coverage.analyzed.length > 0 && report.coverage.uncovered.length > 0);
    assert.ok(report.findings.every((finding) =>
      finding.status === "detected" || finding.status === "not_detected" || finding.status === "unknown"));
  });

  it("the documented planning example completes, persists, and leaves source intact", async () => {
    const { root, appSource } = fixtureProject();
    assert.equal(runProjectSetup({ project_root: root }).status, "completed");
    const project = validateProjectContext({ root, name: "reading-list", kind: "existing" });
    const result = await runExistingProject({
      project,
      request: "Plan the reading-list page for the existing reader app.",
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
      provider: stubProvider(),
      timeout_ms: 10000,
    });
    assert.equal(result.outcome, "completed");
    if (result.outcome !== "completed") {
      throw new Error("the documented planning example must complete");
    }
    assert.equal(result.workflow, "existing-project");
    assert.ok(result.discovery.findings.length > 0, "the discovery report travels on the result");
    assert.ok(existsSync(result.planPath), "the plan file exists where the guide says it does");
    const plan = JSON.parse(readFileSync(result.planPath, "utf8")) as { sprint?: { id?: string }; tasks?: { id?: string }[] };
    assert.equal(plan.sprint?.id, "sprint-reading-list");
    assert.deepEqual((plan.tasks ?? []).map((task) => task.id), ["T-101"]);
    assert.equal(readFileSync(join(root, "src", "app.js"), "utf8"), appSource);
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), JSON.stringify({ name: "reading-list", version: "1.0.0", scripts: { test: "node --test" } }));
  });

  it("the documented failure boundaries hold: wrong kind throws, bad root fails at discovery", async () => {
    const { root } = fixtureProject();
    await assert.rejects(
      runExistingProject({
        project: { root, kind: "new" },
        request: "x",
        pm: {},
        tl: {},
        pmApproval: { identity: { role: "project-manager" }, decision: "approved" },
        tlApproval: { identity: { role: "technical-lead" }, decision: "approved" },
        sprint: { id: "s", goal: "g" },
        tasks: [],
        provider: stubProvider(),
        timeout_ms: 100,
      }),
      /requires project kind "existing"/,
    );
    const bad = await runExistingProject({
      project: { root: join(tmpdir(), "qs-no-such-project-xyz"), kind: "existing" },
      request: "x",
      pm: {},
      tl: {},
      pmApproval: { identity: { role: "project-manager" }, decision: "approved" },
      tlApproval: { identity: { role: "technical-lead" }, decision: "approved" },
      sprint: { id: "s", goal: "g" },
      tasks: [],
      provider: stubProvider(),
      timeout_ms: 100,
    });
    assert.equal(bad.outcome, "failed");
    if (bad.outcome !== "failed") {
      throw new Error("unreachable");
    }
    assert.equal(bad.stage, "discovery");
    assert.equal(bad.discovery, undefined);
  });

  it("every documentation link in the guide resolves to an existing file", () => {
    const text = guideText();
    const links = [...text.matchAll(/`?(docs\/[a-z0-9-]+\.md)`?/g)].map((match) => match[1]);
    assert.ok(links.length > 0, "the guide links to existing documentation");
    assert.ok(links.includes("docs/quick-start-new-project.md"), "the guide points back to the new-project guide");
    for (const link of new Set(links)) {
      assert.ok(existsSync(join(REPO_ROOT, link)), `guide link resolves: ${link}`);
    }
  });

  it("every referenced module path in the guide exists in source", () => {
    const text = guideText();
    for (const module of ["src/config/setup.ts", "src/discovery/contract.ts", "src/discovery/report.ts", "src/runtime/existing-project-workflow.ts"]) {
      assert.ok(text.includes(module.replace("src/", "dist/").replace(/\.ts$/, ".js")), `the guide references ${module}`);
      assert.ok(existsSync(join(REPO_ROOT, module)), `referenced module exists: ${module}`);
    }
  });

  it("the guide stays within T-046 scope", () => {
    const text = guideText();
    assert.ok(!/runNewProject\s*\(/.test(text), "no new-project walkthrough (T-045 owns it)");
    assert.ok(!/ai-team setup <project-root>|ai-team init/.test(text), "no invented project-setup CLI syntax");
    assert.ok(/T-047/.test(text), "individual roles are deferred to T-047, not written here");
    assert.ok(/never.*implement|never implements a feature/i.test(text), "no implementation is promised");
  });
});
