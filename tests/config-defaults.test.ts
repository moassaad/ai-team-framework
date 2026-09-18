import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { generateDefaultConfig } from "../src/config/defaults";
import { validateConfig } from "../src/config/validator";

// Default-generation tests only: file creation, canonical content,
// existing-file preservation, and layout. No loader/workspace unit
// behavior beyond what generation relies on.
const EXPECTED_DEFAULTS = {
  version: 1,
  approval: {
    mode: "manual",
    after: "ticket",
    sensitive_changes: "always",
    sensitive_rules: [],
  },
  workflow: { execution: "sequential", default_state: "ready" },
  providers: {
    opencode: { enabled: true },
    speckit: { enabled: false },
    github: { enabled: false },
    delegate: { enabled: false },
  },
};

function usingEmptyProject(fn: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-team-defaults-test-"));
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("default configuration generation", () => {
  it("creates the workspace and generates config.yaml in a fresh project", () => {
    usingEmptyProject((root) => {
      const configPath = generateDefaultConfig(root);
      assert.equal(configPath, path.join(root, ".ai-team", "config.yaml"));
      const raw = fs.readFileSync(configPath, "utf8");
      assert.match(raw, /^version: 1\n/);
      const parsed: unknown = parseYaml(raw);
      assert.deepEqual(parsed, EXPECTED_DEFAULTS);
      assert.deepEqual(validateConfig(parsed), EXPECTED_DEFAULTS);
    });
  });

  it("generates deterministic output across projects", () => {
    usingEmptyProject((first) => {
      usingEmptyProject((second) => {
        const firstRaw = fs.readFileSync(generateDefaultConfig(first), "utf8");
        const secondRaw = fs.readFileSync(generateDefaultConfig(second), "utf8");
        assert.equal(firstRaw, secondRaw);
      });
    });
  });

  it("preserves an existing config.yaml byte-for-byte without merging", () => {
    usingEmptyProject((root) => {
      const workspace = path.join(root, ".ai-team");
      fs.mkdirSync(workspace, { recursive: true });
      const original = "version: 1\ncustom: true\n";
      fs.writeFileSync(path.join(workspace, "config.yaml"), original, "utf8");
      const configPath = generateDefaultConfig(root);
      assert.equal(configPath, path.join(workspace, "config.yaml"));
      assert.equal(fs.readFileSync(configPath, "utf8"), original);
    });
  });

  it("is a no-op on repeat execution", () => {
    usingEmptyProject((root) => {
      const first = fs.readFileSync(generateDefaultConfig(root), "utf8");
      const second = fs.readFileSync(generateDefaultConfig(root), "utf8");
      assert.equal(first, second);
    });
  });

  it("fails clearly for invalid target roots", () => {
    assert.throws(() => generateDefaultConfig(""), /Invalid target project root/);
    assert.throws(
      () => generateDefaultConfig(path.join(os.tmpdir(), "ai-team-no-such-project-xyz")),
      /Invalid target project root/,
    );
  });

  it("creates no project.yaml and no extra files or directories", () => {
    usingEmptyProject((root) => {
      generateDefaultConfig(root);
      const workspace = path.join(root, ".ai-team");
      assert.equal(fs.existsSync(path.join(workspace, "project.yaml")), false);
      const entries = fs.readdirSync(workspace).sort();
      assert.deepEqual(entries, [
        "config.yaml",
        "logs",
        "plans",
        "reports",
        "reviews",
        "roles",
        "specs",
        "state",
        "workflows",
      ]);
      for (const entry of entries) {
        if (entry !== "config.yaml") {
          assert.equal(fs.statSync(path.join(workspace, entry)).isDirectory(), true);
        }
      }
    });
  });
});
