import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PROVIDER_DEFAULTS } from "../src/config/schema";
import { validateConfig } from "../src/config/validator";
import { loadConfig } from "../src/config/loader";

// D-004 enablement tests: the `providers.delegate.enabled` setting.
// Availability (D-002) and execution (D-003) are separate concerns;
// these tests pin the configuration layer only. No provider is
// constructed, no PATH is probed, and delegate-skills is never run.
function usingProject(
  files: Record<string, string>,
  fn: (root: string) => void,
): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-team-delegate-enablement-test-"));
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

const CONFIG_DIR = path.join(__dirname, "..", "src", "config");

function readConfigSources(): string[] {
  return fs
    .readdirSync(CONFIG_DIR)
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => fs.readFileSync(path.join(CONFIG_DIR, entry), "utf8"));
}

describe("delegate enablement setting", () => {
  it("defaults to disabled and requires no other fields", () => {
    assert.equal(PROVIDER_DEFAULTS.delegate.enabled, false);
    const validated = validateConfig({ version: 1 });
    assert.deepEqual(validated.providers?.delegate, { enabled: false });
  });

  it("accepts explicit true", () => {
    const validated = validateConfig({
      version: 1,
      providers: { delegate: { enabled: true } },
    });
    assert.deepEqual(validated.providers?.delegate, { enabled: true });
  });

  it("accepts explicit false", () => {
    const validated = validateConfig({
      version: 1,
      providers: { delegate: { enabled: false } },
    });
    assert.deepEqual(validated.providers?.delegate, { enabled: false });
  });

  it("rejects non-boolean values with the config error convention", () => {
    for (const enabled of ["yes", "true", "false", 1, 0, null]) {
      assert.throws(
        () => validateConfig({ version: 1, providers: { delegate: { enabled } } }),
        /config\.providers\.delegate\.enabled: expected a boolean/,
      );
    }
  });

  it("loads an enabled setting from config.yaml without probing the environment", () => {
    usingProject(
      {
        ".ai-team/config.yaml": [
          "version: 1",
          "providers:",
          "  delegate:",
          "    enabled: true",
          "",
        ].join("\n"),
      },
      (root) => {
        const validated = validateConfig(loadConfig(root));
        assert.deepEqual(validated.providers?.delegate, { enabled: true });
      },
    );
  });

  it("stays disabled when omitted, regardless of the machine environment", () => {
    usingProject({ ".ai-team/config.yaml": "version: 1\n" }, (root) => {
      const validated = validateConfig(loadConfig(root));
      assert.deepEqual(validated.providers?.delegate, { enabled: false });
    });
  });

  it("never probes availability, launches processes, or touches providers", () => {
    for (const code of readConfigSources()) {
      assert.ok(
        !/delegate-skills|delegate-availability|defaultDelegateSkillsProbe|createDelegateAvailabilityDetector/i.test(
          code,
        ),
        "no availability coupling",
      );
      assert.ok(
        !/createDelegateSkillsProvider|DelegateProvider|isDelegateProvider|child_process|spawn|accessSync/i.test(
          code,
        ),
        "no provider construction or execution",
      );
    }
  });
});
