import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig, resolveConfigPath } from "../src/config/loader";

// Loader tests only: file resolution, reading, and YAML parsing.
// No schema validation, no workspace creation, no default files.
function usingProject(
  files: Record<string, string>,
  fn: (root: string) => void,
): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-team-loader-test-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
    }
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("config loader", () => {
  it("resolves .ai-team/config.yaml under the given project root", () => {
    assert.equal(
      resolveConfigPath("/some/project"),
      path.join("/some/project", ".ai-team", "config.yaml"),
    );
  });

  it("loads a valid config.yaml and returns the parsed data as-is", () => {
    usingProject(
      {
        ".ai-team/config.yaml": [
          "version: 1",
          "approval:",
          "  mode: manual",
          "providers:",
          "  opencode:",
          "    enabled: true",
          "",
        ].join("\n"),
      },
      (root) => {
        assert.deepEqual(loadConfig(root), {
          version: 1,
          approval: { mode: "manual" },
          providers: { opencode: { enabled: true } },
        });
      },
    );
  });

  it("does not apply defaults or create anything while loading", () => {
    usingProject({ ".ai-team/config.yaml": "version: 1\n" }, (root) => {
      // Omitted optional sections stay omitted; defaults belong to C-003.
      assert.deepEqual(loadConfig(root), { version: 1 });
    });
  });

  it("reports a missing config.yaml without creating workspace files", () => {
    usingProject({}, (root) => {
      assert.throws(
        () => loadConfig(root),
        (error: unknown) =>
          error instanceof Error &&
          /not found/.test(error.message) &&
          error.message.includes(path.join(".ai-team", "config.yaml")),
      );
      assert.equal(fs.existsSync(path.join(root, ".ai-team")), false);
    });
  });

  it("reports invalid YAML", () => {
    usingProject({ ".ai-team/config.yaml": "config: [unclosed\n" }, (root) => {
      assert.throws(() => loadConfig(root), /Invalid YAML/);
    });
  });

  it("reports an empty config file", () => {
    for (const content of ["", "  \n", "# only a comment\n"]) {
      usingProject({ ".ai-team/config.yaml": content }, (root) => {
        assert.throws(() => loadConfig(root), /empty/);
      });
    }
  });

  it("reports files that cannot be read", () => {
    // A directory at the config path makes the read fail deterministically.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-team-loader-test-"));
    try {
      fs.mkdirSync(path.join(root, ".ai-team", "config.yaml"), {
        recursive: true,
      });
      assert.throws(() => loadConfig(root), /Cannot read/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
