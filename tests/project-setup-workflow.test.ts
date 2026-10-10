import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { runProjectSetup, ProjectSetupInput } from "../src/config/setup";
import { WORKSPACE_SUBDIRECTORIES } from "../src/config/workspace";
import { validateConfig } from "../src/config/validator";
import { loadConfig } from "../src/config/loader";
import { ROLE_IDS } from "../src/roles/contract";
import { recommendMode } from "../src/runtime/mode-recommendation";
import { runSetupCommand } from "../src/cli-setup";

function freshRoot(): string {
  return mkdtempSync(join(tmpdir(), "ai-team-setup-"));
}

function workspaceEntries(root: string): string[] {
  return readdirSync(join(root, ".ai-team")).sort();
}

function validCustomConfig(): string {
  return [
    "version: 1",
    "approval:",
    "  mode: automatic",
    "  after: ticket",
    "  sensitive_changes: always",
    "  sensitive_rules: []",
    "workflow:",
    "  execution: sequential",
    "  default_state: ready",
    "providers:",
    "  opencode: { enabled: true }",
    "  speckit: { enabled: false }",
    "  github: { enabled: false }",
    "  delegate: { enabled: true }",
    "",
  ].join("\n");
}

describe("project setup workflow (M30 T-044)", () => {
  describe("canonical setup behavior", () => {
    it("sets up a valid project root with workspace, defaults, and validated config", () => {
      const root = freshRoot();
      const result = runProjectSetup({ project_root: root });
      assert.equal(result.status, "completed");
      assert.equal(result.projectRoot, root);
      assert.deepEqual(workspaceEntries(root), [...WORKSPACE_SUBDIRECTORIES, "config.yaml"].sort());
      assert.deepEqual(result.files.map((file) => file.action), ["created", "created"]);
      if (result.status !== "completed" && result.status !== "already-configured") {
        throw new Error("expected a successful setup result");
      }
      assert.equal(result.config.version, 1);
      assert.deepEqual(validateConfig(loadConfig(root)), result.config);
      assert.ok(Object.isFrozen(result));
      assert.ok(Object.isFrozen(result.files));
    });

    it("missing or invalid roots fail explicitly", () => {
      assert.throws(() => runProjectSetup({ project_root: "" }), "non-empty string");
      assert.throws(
        () => runProjectSetup({ project_root: join(tmpdir(), "ai-team-no-such-project-xyz") }),
        "Invalid target project root",
      );
      const root = freshRoot();
      const file = join(root, "not-a-directory");
      writeFileSync(file, "content", "utf8");
      assert.throws(() => runProjectSetup({ project_root: file }), "not a directory");
      assert.throws(() => runProjectSetup({} as unknown as ProjectSetupInput), "expected a project setup input object");
    });

    it("repeated setup over a configured project is a safe no-op", () => {
      const root = freshRoot();
      const first = runProjectSetup({ project_root: root });
      assert.equal(first.status, "completed");
      const before = readFileSync(join(root, ".ai-team", "config.yaml"), "utf8");
      const second = runProjectSetup({ project_root: root });
      assert.equal(second.status, "already-configured");
      assert.deepEqual(second.files.map((file) => file.action), ["existing", "existing"]);
      assert.equal(readFileSync(join(root, ".ai-team", "config.yaml"), "utf8"), before);
      assert.deepEqual(workspaceEntries(root), [...WORKSPACE_SUBDIRECTORIES, "config.yaml"].sort());
    });

    it("an existing valid configuration is preserved byte-for-byte", () => {
      const root = freshRoot();
      mkdirSync(join(root, ".ai-team"), { recursive: true });
      const custom = validCustomConfig();
      writeFileSync(join(root, ".ai-team", "config.yaml"), custom, "utf8");
      const result = runProjectSetup({ project_root: root });
      assert.equal(result.status, "completed");
      assert.equal(readFileSync(join(root, ".ai-team", "config.yaml"), "utf8"), custom);
      assert.deepEqual(result.files.map((file) => file.action), ["created", "existing"]);
      if (result.status !== "completed" && result.status !== "already-configured") {
        throw new Error("expected a successful setup result");
      }
      assert.equal(result.config.approval?.mode, "automatic");
      assert.equal(result.config.providers?.delegate?.enabled, true);
    });

    it("an existing invalid configuration is reported, kept, and never repaired", () => {
      const root = freshRoot();
      mkdirSync(join(root, ".ai-team"), { recursive: true });
      const invalid = "version: 99\nunknown_key: true\n";
      writeFileSync(join(root, ".ai-team", "config.yaml"), invalid, "utf8");
      const result = runProjectSetup({ project_root: root });
      assert.equal(result.status, "invalid-configuration");
      assert.equal(readFileSync(join(root, ".ai-team", "config.yaml"), "utf8"), invalid);
      assert.deepEqual(result.files.map((file) => file.action), ["created", "invalid"]);
      if (result.status !== "invalid-configuration") {
        throw new Error("expected an invalid-configuration result");
      }
      assert.ok(result.issues.length > 0);
      assert.ok(Object.isFrozen(result));
      assert.ok(Object.isFrozen(result.issues));
      const again = runProjectSetup({ project_root: root });
      assert.equal(again.status, "invalid-configuration");
      assert.equal(readFileSync(join(root, ".ai-team", "config.yaml"), "utf8"), invalid);
    });
  });

  describe("preservation and safety", () => {
    it("existing user-owned files, guidance, and project source are never touched", () => {
      const root = freshRoot();
      writeFileSync(join(root, "AGENTS.md"), "# Team guidance, hand-written.\n", "utf8");
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "app.js"), "console.log(1);\n", "utf8");
      mkdirSync(join(root, ".ai-team", "state"), { recursive: true });
      writeFileSync(join(root, ".ai-team", "state", "notes.txt"), "operator notes\n", "utf8");
      const result = runProjectSetup({ project_root: root });
      assert.equal(result.status, "completed");
      assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), "# Team guidance, hand-written.\n");
      assert.equal(readFileSync(join(root, "src", "app.js"), "utf8"), "console.log(1);\n");
      assert.equal(readFileSync(join(root, ".ai-team", "state", "notes.txt"), "utf8"), "operator notes\n");
    });

    it("setup creates only the canonical artifacts and scaffolds no application", () => {
      const root = freshRoot();
      runProjectSetup({ project_root: root });
      assert.deepEqual(workspaceEntries(root), [...WORKSPACE_SUBDIRECTORIES, "config.yaml"].sort());
      assert.deepEqual(readdirSync(root).sort(), [".ai-team"]);
      assert.deepEqual(readdirSync(join(root, ".ai-team", "plans")), [], "no lifecycle output is produced");
    });

    it("a workspace path collision with a file fails safely without deletion", () => {
      const root = freshRoot();
      writeFileSync(join(root, ".ai-team"), "collision\n", "utf8");
      assert.throws(() => runProjectSetup({ project_root: root }), "expected a directory");
      assert.equal(readFileSync(join(root, ".ai-team"), "utf8"), "collision\n");
    });

    it("configuration write failures report partial outcomes without false success", () => {
      const root = freshRoot();
      const primed = runProjectSetup({ project_root: root });
      assert.equal(primed.status, "completed");
      unlinkSync(join(root, ".ai-team", "config.yaml"));
      chmodSync(join(root, ".ai-team"), 0o555);
      try {
        const result = runProjectSetup({ project_root: root });
        assert.equal(result.status, "failed");
        if (result.status !== "failed") {
          throw new Error("expected a failed result");
        }
        assert.equal(result.stage, "write-configuration");
        assert.ok(result.message.length > 0);
        assert.match(result.message, /must not be treated as configured/);
      } finally {
        chmodSync(join(root, ".ai-team"), 0o755);
      }
    });

    it("every reported path stays inside the project root", () => {
      const root = freshRoot();
      const result = runProjectSetup({ project_root: root });
      assert.ok(result.workspacePath.startsWith(`${root}/`));
      assert.ok(result.configPath.startsWith(`${root}/`));
      for (const file of result.files) {
        assert.ok(file.path.startsWith(`${root}/`), `${file.path} stays inside the project root`);
      }
      assert.ok(statSync(result.workspacePath).isDirectory());
    });

    it("caller-owned input is not mutated", () => {
      const root = freshRoot();
      const input: ProjectSetupInput = { project_root: root };
      const before = JSON.parse(JSON.stringify(input)) as unknown;
      runProjectSetup(input);
      assert.deepEqual(input, before);
    });
  });

  describe("contracts and boundaries", () => {
    it("configuration values come from the existing schema and defaults", () => {
      const root = freshRoot();
      const result = runProjectSetup({ project_root: root });
      if (result.status !== "completed" && result.status !== "already-configured") {
        throw new Error("expected a successful setup result");
      }
      assert.equal(result.config.version, 1);
      assert.equal(result.config.approval?.mode, "manual");
      assert.equal(result.config.workflow?.execution, "sequential");
      assert.equal(result.config.providers?.opencode?.enabled, true);
      assert.equal(result.config.providers?.delegate?.enabled, false);
    });

    it("an enabled-but-unavailable Delegate integration is never reported as ready", () => {
      const root = freshRoot();
      mkdirSync(join(root, ".ai-team"), { recursive: true });
      writeFileSync(join(root, ".ai-team", "config.yaml"), validCustomConfig(), "utf8");
      const result = runProjectSetup({ project_root: root });
      if (result.status !== "completed" && result.status !== "already-configured") {
        throw new Error("expected a successful setup result");
      }
      const delegate = result.integrations.find((entry) => entry.name === "delegate");
      assert.deepEqual(delegate, { name: "delegate", enabled: true, detected: "not-checked" });
      assert.ok(result.integrations.every((entry) => entry.detected === "not-checked"));
      assert.ok(result.notes.some((note) => note.includes("ai-team status")));
    });

    it("the existing per-integration setup command behavior is unchanged", async () => {
      const usage = await runSetupCommand(
        {
          projectRoot: freshRoot(),
          loadConfiguration: () => { throw new Error("must not be called for usage errors"); },
          buildRegistry: () => { throw new Error("must not be called for usage errors"); },
          askConfirmation: async () => true,
        },
        ["setup"],
      );
      assert.equal(usage.exitCode, 1);
      assert.match(usage.stderr, /usage: ai-team setup <integration> \[--yes\]/);
    });

    it("existing role, mode, and handoff contracts remain unchanged", () => {
      assert.deepEqual([...ROLE_IDS], ["coordinator", "project-manager", "technical-lead", "implementer", "senior-reviewer"]);
      const recommendation = recommendMode({
        signals: {
          needsBusinessPlanning: false,
          needsSprintDecomposition: false,
          needsApprovals: false,
          needsTechnicalPlanning: false,
        },
      });
      assert.equal(recommendation.recommended, "fast");
      const root = freshRoot();
      const result = runProjectSetup({ project_root: root });
      assert.ok(!("mode" in result), "setup selects no work mode");
      assert.ok(!("checkpoint" in result), "setup performs no checkpoint resume");
    });

    it("no T-045 through T-050 quick-start, scaffolding, or onboarding surface is added", () => {
      const srcRoot = join(__dirname, "..", "..", "src");
      const runtimeFiles = readdirSync(join(srcRoot, "runtime"));
      const configFiles = readdirSync(join(srcRoot, "config"));
      const cliFiles = readdirSync(srcRoot).filter((file) => file.startsWith("cli-"));
      for (const file of [...runtimeFiles, ...configFiles, ...cliFiles]) {
        assert.ok(!/quick-start|onboard|scaffold|wizard/i.test(file), `no T-045+ surface in ${file}`);
      }
      assert.deepEqual(configFiles.sort(), ["defaults.ts", "loader.ts", "schema.ts", "setup.ts", "validator.ts", "workspace.ts", "yaml.d.ts"]);
      assert.deepEqual(cliFiles.sort(), ["cli-role.ts", "cli-run.ts", "cli-setup.ts", "cli-sprint.ts", "cli-status.ts"]);
    });
  });
});
