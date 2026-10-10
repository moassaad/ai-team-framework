import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProjectSetup } from "../src/config/setup";
import { runNewProject } from "../src/runtime/new-project-workflow";

const GUIDE = join(__dirname, "..", "..", "docs", "quick-start-new-project.md");
const REPO_ROOT = join(__dirname, "..", "..");

// Documented-path verification for docs/quick-start-new-project.md
// (M30 T-045): the guide's exact setup + planning sequence executes
// against temporary project roots, every documentation link resolves,
// and every referenced module path exists. No new product behavior.
function guideText(): string {
  return readFileSync(GUIDE, "utf8");
}

describe("new project quick start (M30 T-045)", () => {
  it("the documented setup step completes against a fresh project root", () => {
    const root = mkdtempSync(join(tmpdir(), "qs-guide-"));
    const setup = runProjectSetup({ project_root: root });
    assert.equal(setup.status, "completed");
    assert.deepEqual(setup.files.map((file) => file.action), ["created", "created"]);
    assert.ok(existsSync(join(root, ".ai-team", "config.yaml")));
    const again = runProjectSetup({ project_root: root });
    assert.equal(again.status, "already-configured");
  });

  it("the documented planning example completes and persists the plan", async () => {
    const root = mkdtempSync(join(tmpdir(), "qs-guide-"));
    assert.equal(runProjectSetup({ project_root: root }).status, "completed");
    const provider = {
      name: "stub",
      execute: async (request: { role?: string }) => ({ status: "succeeded" as const, text: `${request.role} output` }),
    };
    const result = await runNewProject({
      request: "Build a reading-list service for saved articles.",
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
      project_root: root,
      provider,
      timeout_ms: 10000,
    });
    assert.equal(result.outcome, "completed");
    if (result.outcome !== "completed") {
      throw new Error("the documented planning example must complete");
    }
    assert.ok(existsSync(result.planPath), "the plan file exists where the guide says it does");
    const plan = JSON.parse(readFileSync(result.planPath, "utf8")) as { sprint?: { id?: string }; tasks?: { id?: string }[] };
    assert.equal(plan.sprint?.id, "sprint-reading-list");
    assert.deepEqual((plan.tasks ?? []).map((task) => task.id), ["T-101"]);
  });

  it("every documentation link in the guide resolves to an existing file", () => {
    const text = guideText();
    const links = [...text.matchAll(/`?(docs\/[a-z0-9-]+\.md)`?/g)].map((match) => match[1]);
    assert.ok(links.length > 0, "the guide links to existing documentation");
    for (const link of new Set(links)) {
      assert.ok(existsSync(join(REPO_ROOT, link)), `guide link resolves: ${link}`);
    }
  });

  it("every referenced module path in the guide exists in source", () => {
    const text = guideText();
    for (const module of ["src/config/setup.ts", "src/runtime/new-project-workflow.ts"]) {
      assert.ok(text.includes(module.replace("src/", "dist/").replace(/\.ts$/, ".js")), `the guide references ${module}`);
      assert.ok(existsSync(join(REPO_ROOT, module)), `referenced module exists: ${module}`);
    }
    assert.ok(existsSync(join(REPO_ROOT, "docs", "installation.md")), "the install prerequisite guide exists");
  });

  it("the guide stays within T-045 scope", () => {
    const text = guideText();
    assert.ok(!/runExistingProject\s*\(/.test(text), "no existing-project workflow walkthrough (T-046 owns it)");
    assert.ok(!/ai-team setup <project-root>|ai-team init/.test(text), "no invented project-setup CLI syntax");
    assert.ok(/forthcoming|not yet written/i.test(text), "the T-046 gap is stated, not silently filled");
    assert.ok(/never.*scaffold|scaffolds no application/i.test(text), "no scaffolding is promised");
  });
});
