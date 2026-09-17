import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  WORKSPACE_SUBDIRECTORIES,
  initializeWorkspace,
  resolveWorkspacePath,
} from "../src/config/workspace";

// Workspace tests only: directory creation, idempotency, preservation,
// and conflict reporting. No config files, no loading, no validation.
function usingEmptyProject(fn: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-team-workspace-test-"));
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function assertWorkspaceComplete(workspace: string): void {
  assert.equal(fs.statSync(workspace).isDirectory(), true);
  assert.deepEqual([...WORKSPACE_SUBDIRECTORIES].sort(), [
    "logs",
    "plans",
    "reports",
    "reviews",
    "roles",
    "specs",
    "state",
    "workflows",
  ]);
  for (const subdir of WORKSPACE_SUBDIRECTORIES) {
    assert.equal(
      fs.statSync(path.join(workspace, subdir)).isDirectory(),
      true,
      `missing subdirectory: ${subdir}`,
    );
  }
}

describe("workspace initializer", () => {
  it("resolves .ai-team under the given project root", () => {
    assert.equal(
      resolveWorkspacePath("/some/project"),
      path.join("/some/project", ".ai-team"),
    );
  });

  it("initializes the full workspace in an empty project directory", () => {
    usingEmptyProject((root) => {
      const workspace = initializeWorkspace(root);
      assert.equal(workspace, path.join(root, ".ai-team"));
      assertWorkspaceComplete(workspace);
    });
  });

  it("creates no configuration files", () => {
    usingEmptyProject((root) => {
      const workspace = initializeWorkspace(root);
      assert.equal(fs.existsSync(path.join(workspace, "config.yaml")), false);
      assert.equal(fs.existsSync(path.join(workspace, "project.yaml")), false);
    });
  });

  it("is idempotent and preserves existing workspace content", () => {
    usingEmptyProject((root) => {
      initializeWorkspace(root);
      const workspace = path.join(root, ".ai-team");
      fs.writeFileSync(path.join(workspace, "config.yaml"), "version: 1\n", "utf8");
      fs.writeFileSync(path.join(workspace, "state", "note.txt"), "keep me\n", "utf8");
      fs.writeFileSync(path.join(root, "app.txt"), "project source\n", "utf8");

      const second = initializeWorkspace(root);
      assert.equal(second, workspace);
      assertWorkspaceComplete(workspace);
      assert.equal(
        fs.readFileSync(path.join(workspace, "config.yaml"), "utf8"),
        "version: 1\n",
      );
      assert.equal(
        fs.readFileSync(path.join(workspace, "state", "note.txt"), "utf8"),
        "keep me\n",
      );
      assert.equal(fs.readFileSync(path.join(root, "app.txt"), "utf8"), "project source\n");
    });
  });

  it("reports a conflict when a required directory exists as a file", () => {
    usingEmptyProject((root) => {
      const workspace = path.join(root, ".ai-team");
      fs.mkdirSync(workspace, { recursive: true });
      fs.writeFileSync(path.join(workspace, "state"), "not a directory\n", "utf8");
      assert.throws(
        () => initializeWorkspace(root),
        /exists as a file, expected a directory/,
      );
      // The conflicting file is left alone, not deleted or replaced.
      assert.equal(
        fs.readFileSync(path.join(workspace, "state"), "utf8"),
        "not a directory\n",
      );
    });
  });

  it("rejects an invalid target project root", () => {
    assert.throws(() => initializeWorkspace(""), /Invalid target project root/);
    assert.throws(
      () => initializeWorkspace(path.join(os.tmpdir(), "ai-team-no-such-project-xyz")),
      /Invalid target project root/,
    );
    usingEmptyProject((root) => {
      const file = path.join(root, "file.txt");
      fs.writeFileSync(file, "x", "utf8");
      assert.throws(() => initializeWorkspace(file), /not a directory/);
    });
  });
});
