import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Integration } from "../src/providers/integration";
import { createIntegrationRegistry } from "../src/providers/integration-registry";
import { detectIntegration } from "../src/providers/integration-detection";
import {
  DELEGATE_SKILLS_INTEGRATION_NAME,
  createDelegateSkillIntegration,
} from "../src/providers/delegate-detection";

// Delegate-skill detection tests (D-102): injected fakes only. No real
// skills, CLIs, relays, installs, or filesystem walks ever happen. The
// representative fixture mirrors the upstream skill shape:
//
//   <skill>/
//   ├── SKILL.md
//   ├── scripts/
//   │   └── relay.mjs
//   └── references/

interface RecordedCall {
  command: string;
  args: readonly string[];
  cwd: string;
}

function enoent(message: string): Error {
  return Object.assign(new Error(message), { code: "ENOENT" });
}

const SKILL = "opencode-delegate";
const IMPLEMENTER = "opencode";
const ROOTS = ["/skills-a", "/skills-b"];

function skillFiles(root: string, skill = SKILL): Record<string, string> {
  const dir = join(root, skill);
  return {
    [join(dir, "SKILL.md")]: "# OpenCode Delegate",
    [join(dir, "scripts", "relay.mjs")]: "// relay",
  };
}

interface Harness {
  calls: RecordedCall[];
  reads: string[];
  integration: Integration;
}

function harness(options: {
  files: Record<string, string>;
  readErrors?: Record<string, Error>;
  run?: (command: string, args: readonly string[]) => { exitCode: number | null; stdout: string };
  skillName?: string;
  implementerCommand?: string;
  skillRoots?: readonly string[];
}): Harness {
  const calls: RecordedCall[] = [];
  const reads: string[] = [];
  const integration = createDelegateSkillIntegration({
    skillName: options.skillName ?? SKILL,
    implementerCommand: options.implementerCommand ?? IMPLEMENTER,
    skillRoots: options.skillRoots ?? ROOTS,
    runCommand: async (command, args, runOptions) => {
      calls.push({ command, args: [...args], cwd: runOptions.cwd });
      if (options.run !== undefined) {
        return options.run(command, args);
      }
      return { exitCode: 0, stdout: `${command} ok` };
    },
    readFile: async (path) => {
      reads.push(path);
      const failure = options.readErrors?.[path];
      if (failure !== undefined) {
        throw failure;
      }
      const content = options.files[path];
      if (content === undefined) {
        throw enoent(`missing ${path}`);
      }
      return content;
    },
  });
  return { calls, reads, integration };
}

function registered(integration: Integration) {
  const registry = createIntegrationRegistry();
  registry.register(integration);
  return registry;
}

describe("delegate-skill detection", () => {
  it("uses the delegate identity without hard-coding one skill", () => {
    assert.equal(DELEGATE_SKILLS_INTEGRATION_NAME, "delegate");
    const { integration } = harness({ files: {} });
    assert.equal(integration.name, "delegate");
    assert.deepEqual(integration.capabilities, ["detect"]);
  });

  it("reports a missing skill directory as unavailable", async () => {
    const { calls, integration } = harness({ files: {} });
    const outcome = await detectIntegration(registered(integration), "delegate");
    assert.deepEqual(outcome, {
      status: "detected",
      result: {
        available: false,
        detail: 'delegate skill "opencode-delegate" not installed (searched 2 locations)',
      },
    });
    assert.ok(!calls.some((call) => call.command === "opencode"), "no implementer probe");
  });

  it("detects a present skill and probes its implementer", async () => {
    const { calls, integration } = harness({ files: skillFiles("/skills-a") });
    const outcome = await detectIntegration(registered(integration), "delegate");
    assert.deepEqual(outcome, {
      status: "detected",
      result: {
        available: true,
        detail:
          'delegate skill "opencode-delegate" installed with relay; ' +
          'implementer "opencode" available; authentication not verified',
      },
    });
    const versionProbes = calls.filter(
      (call) => call.command === "opencode" && call.args[0] === "--version",
    );
    assert.equal(versionProbes.length, 1);
  });

  it("treats a missing SKILL.md as not installed", async () => {
    const dir = join("/skills-a", SKILL);
    const { calls, integration } = harness({
      files: { [join(dir, "scripts", "relay.mjs")]: "// relay" },
    });
    const outcome = await detectIntegration(registered(integration), "delegate");
    assert.deepEqual(outcome.status, "detected");
    assert.equal(
      outcome.status === "detected" ? outcome.result.available : undefined,
      false,
    );
    assert.ok(!calls.some((call) => call.command === "opencode"), "no implementer probe");
  });

  it("distinguishes installed-but-relay-missing from absent", async () => {
    const dir = join("/skills-a", SKILL);
    const { calls, integration } = harness({
      files: { [join(dir, "SKILL.md")]: "# OpenCode Delegate" },
    });
    const outcome = await detectIntegration(registered(integration), "delegate");
    assert.deepEqual(outcome, {
      status: "detected",
      result: {
        available: false,
        detail: 'delegate skill "opencode-delegate" installed but relay missing',
      },
    });
    assert.ok(!calls.some((call) => call.command === "opencode"), "no implementer probe");
  });

  it("falls through to a complete copy in a later root", async () => {
    const partial = join("/skills-a", SKILL);
    const { integration } = harness({
      files: {
        [join(partial, "SKILL.md")]: "# OpenCode Delegate",
        ...skillFiles("/skills-b"),
      },
    });
    const outcome = await detectIntegration(registered(integration), "delegate");
    assert.deepEqual(outcome.status, "detected");
    assert.equal(
      outcome.status === "detected" ? outcome.result.available : undefined,
      true,
    );
  });

  it("reports a missing implementer CLI as unavailable", async () => {
    const { integration } = harness({
      files: skillFiles("/skills-a"),
      run: (command) => {
        if (command === "opencode") {
          throw enoent("spawn opencode ENOENT");
        }
        return { exitCode: 0, stdout: "git ok" };
      },
    });
    const outcome = await detectIntegration(registered(integration), "delegate");
    assert.deepEqual(outcome, {
      status: "detected",
      result: { available: false, detail: 'implementer "opencode" not installed' },
    });
  });

  it("fails when the version probe errors unexpectedly", async () => {
    const { integration } = harness({
      files: skillFiles("/skills-a"),
      run: (command) => {
        if (command === "opencode") {
          return { exitCode: 1, stdout: "" };
        }
        return { exitCode: 0, stdout: "git ok" };
      },
    });
    const outcome = await detectIntegration(registered(integration), "delegate");
    assert.deepEqual(outcome.status, "failed");
    assert.ok(!("result" in outcome), "no fabricated availability");
  });

  it("keeps absence distinct from detector failure", async () => {
    const absent = harness({ files: {} });
    const absence = await detectIntegration(registered(absent.integration), "delegate");
    const broken = harness({
      files: skillFiles("/skills-a"),
      run: () => {
        throw new Error("probe exploded");
      },
    });
    const failure = await detectIntegration(registered(broken.integration), "delegate");
    assert.deepEqual(absence.status, "detected");
    assert.deepEqual(failure.status, "failed");
    assert.notDeepEqual(absence, failure);
  });

  it("fails closed on unreadable skill material", async () => {
    const dir = join("/skills-a", SKILL);
    for (const target of ["SKILL.md", join("scripts", "relay.mjs")]) {
      const { integration } = harness({
        files: skillFiles("/skills-a"),
        readErrors: { [join(dir, target)]: Object.assign(new Error("denied"), { code: "EACCES" }) },
      });
      const outcome = await detectIntegration(registered(integration), "delegate");
      assert.equal(outcome.status, "failed", target);
    }
  });

  it("fails closed without discovery locations", async () => {
    const { calls, integration } = harness({ files: {}, skillRoots: [] });
    const outcome = await detectIntegration(registered(integration), "delegate");
    assert.deepEqual(outcome, {
      status: "failed",
      error: "delegate detection: no skill discovery locations configured",
    });
    assert.equal(calls.length, 0);
  });

  it("treats a missing git prerequisite as unavailable, never fatal", async () => {
    const { integration } = harness({
      files: skillFiles("/skills-a"),
      run: (command) => {
        if (command === "git") {
          throw enoent("spawn git ENOENT");
        }
        return { exitCode: 0, stdout: "opencode ok" };
      },
    });
    const outcome = await detectIntegration(registered(integration), "delegate");
    assert.deepEqual(outcome, {
      status: "detected",
      result: { available: false, detail: "git prerequisite not installed" },
    });
  });

  it("never executes relays, skills installers, setup, or login flows", async () => {
    const { calls, integration } = harness({ files: skillFiles("/skills-a") });
    await detectIntegration(registered(integration), "delegate");
    for (const call of calls) {
      assert.ok(
        (call.command === "opencode" || call.command === "git") && call.args[0] === "--version",
        `read-only probe only, got ${call.command} ${call.args.join(" ")}`,
      );
      assert.ok(!call.args.includes("relay.mjs"), "relay never runs");
    }
    assert.ok(!calls.some((call) => call.command === "npx"), "no Skills CLI");
    assert.ok(!calls.some((call) => call.command === "node"), "no relay process");
    assert.ok(!calls.some((call) => call.args.includes("delegate-setup")), "no setup");
  });

  it("detects any requested skill generically", async () => {
    const { integration } = harness({
      files: skillFiles("/skills-a", "codex-delegate"),
      skillName: "codex-delegate",
      implementerCommand: "codex",
      run: (command) => {
        assert.ok(command === "codex" || command === "git");
        return { exitCode: 0, stdout: "ok" };
      },
    });
    const outcome = await detectIntegration(registered(integration), "delegate");
    assert.deepEqual(outcome.status, "detected");
    assert.equal(
      outcome.status === "detected" ? outcome.result.available : undefined,
      true,
    );
  });

  it("re-probes freshly on every call without touching the registry", async () => {
    let present = false;
    const calls: RecordedCall[] = [];
    const registry = createIntegrationRegistry();
    const integration = createDelegateSkillIntegration({
      skillName: SKILL,
      implementerCommand: IMPLEMENTER,
      skillRoots: ROOTS,
      runCommand: async (command, args, runOptions) => {
        calls.push({ command, args: [...args], cwd: runOptions.cwd });
        return { exitCode: 0, stdout: "ok" };
      },
      readFile: async (path) => {
        if (!present) {
          throw enoent(`missing ${path}`);
        }
        const content = skillFiles("/skills-a")[path];
        if (content === undefined) {
          throw enoent(`missing ${path}`);
        }
        return content;
      },
    });
    registry.register(integration);
    const before = JSON.stringify(registry.list().map((entry) => entry.name));
    assert.deepEqual(await detectIntegration(registry, "delegate"), {
      status: "detected",
      result: {
        available: false,
        detail: 'delegate skill "opencode-delegate" not installed (searched 2 locations)',
      },
    });
    const firstPassCalls = calls.length;
    assert.equal(firstPassCalls, 0, "absence short-circuits before any probe");
    present = true;
    const outcome = await detectIntegration(registry, "delegate");
    assert.deepEqual(outcome.status, "detected");
    assert.equal(
      outcome.status === "detected" ? outcome.result.available : undefined,
      true,
    );
    assert.ok(calls.length > firstPassCalls, "second call re-probes");
    assert.equal(JSON.stringify(registry.list().map((entry) => entry.name)), before);
  });

  it("reads only bounded skill paths, never walks", async () => {
    const { reads, integration } = harness({
      files: { ...skillFiles("/skills-a"), ...skillFiles("/skills-b") },
    });
    await detectIntegration(registered(integration), "delegate");
    assert.ok(reads.length > 0);
    for (const path of reads) {
      assert.ok(
        path.startsWith(join("/skills-a", SKILL)) || path.startsWith(join("/skills-b", SKILL)),
        `bounded read ${path}`,
      );
    }
    assert.ok(!reads.some((path) => path.includes("~") || path.includes("*")));
  });

  it("rejects invalid construction input", () => {
    const valid = { skillName: SKILL, implementerCommand: IMPLEMENTER, skillRoots: ROOTS };
    assert.throws(() => createDelegateSkillIntegration({ ...valid, skillName: "" }), /skillName/);
    assert.throws(
      () => createDelegateSkillIntegration({ ...valid, implementerCommand: "" }),
      /implementerCommand/,
    );
    assert.throws(
      () => createDelegateSkillIntegration({ ...valid, skillRoots: ["ok", ""] }),
      /skillRoots/,
    );
  });

  it("abandons the historical executable assumption", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "providers", "delegate-detection.ts"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...code.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(
      importedModules.sort(),
      ["./integration", "node:child_process", "node:fs", "node:path"],
      "no provider coupling",
    );
    assert.ok(!/delegate-skills/.test(code), "no executable name");
    assert.ok(!/accessSync|X_OK|PATH/.test(code), "no PATH probe");
    assert.ok(!/readdir|recursive|glob|homedir/.test(code), "no search machinery");
    assert.ok(!/from ".*config"|FrameworkConfig|\.enabled/.test(code), "no config coupling");
    assert.ok(!/from "\.\/opencode"/.test(code), "direct provider untouched");
    assert.ok(!/fleet|lane|model|session|resume/.test(code), "no later-ticket state");
    assert.ok(!/delegate-setup/.test(code), "no setup path");
  });

  it("keeps the generic foundation free from delegate specifics", () => {
    for (const file of [
      "integration.ts",
      "integration-registry.ts",
      "integration-detection.ts",
      "integration-config.ts",
    ]) {
      const source = readFileSync(join(__dirname, "..", "..", "src", "providers", file), "utf8");
      assert.ok(!/delegate|relay|skill/i.test(source), `${file} stays generic`);
    }
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/delegate-detection");
    assert.deepEqual(Object.keys(module).sort(), [
      "DELEGATE_SKILLS_INTEGRATION_NAME",
      "createDelegateSkillIntegration",
    ]);
    const { integration } = harness({ files: {} });
    assert.deepEqual(Object.keys(integration).sort(), ["capabilities", "detect", "name"]);
  });
});
