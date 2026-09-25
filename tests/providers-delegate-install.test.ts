import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Integration } from "../src/providers/integration";
import { createIntegrationRegistry } from "../src/providers/integration-registry";
import { detectIntegration } from "../src/providers/integration-detection";
import {
  DELEGATE_SKILLS_SOURCE,
  describeDelegateSkillInstall,
  createDelegateSkillIntegrationWithInstall,
} from "../src/providers/delegate-install";

// Delegate-skill installation tests (D-103): injected fakes only. No
// real Skills CLI, network, skill directories, or environment changes
// ever happen. Calling `install()` in a test IS the confirmed step:
// the provider contract assumes Framework-level confirmation already
// happened, so `-y` here is post-confirmation non-interactivity, never
// a bypass.

interface RecordedCall {
  command: string;
  args: readonly string[];
  cwd: string;
  timeoutMs?: number;
}

function enoent(message: string): Error {
  return Object.assign(new Error(message), { code: "ENOENT" });
}

const SKILL = "opencode-delegate";
const IMPLEMENTER = "opencode";
const ROOTS = ["/skills-a"];
const NODE_OK = "v22.20.0";

function skillFiles(root: string): Record<string, string> {
  const dir = join(root, SKILL);
  return {
    [join(dir, "SKILL.md")]: "# OpenCode Delegate",
    [join(dir, "scripts", "relay.mjs")]: "// relay",
  };
}

interface Harness {
  calls: RecordedCall[];
  integration: Integration;
}

function harness(options: {
  files: Record<string, string>;
  run?: (command: string, args: readonly string[]) => { exitCode: number | null; stdout: string };
  skillName?: string;
  targetAgent?: string;
  installScope?: "project" | "global";
  projectRoot?: string;
  nodeVersion?: string;
}): Harness {
  const calls: RecordedCall[] = [];
  const integration = createDelegateSkillIntegrationWithInstall({
    skillName: options.skillName ?? SKILL,
    implementerCommand: IMPLEMENTER,
    skillRoots: ROOTS,
    targetAgent: options.targetAgent,
    installScope: options.installScope,
    projectRoot: options.projectRoot ?? "/proj",
    nodeVersion: options.nodeVersion ?? NODE_OK,
    runCommand: async (command, args, runOptions) => {
      calls.push({
        command,
        args: [...args],
        cwd: runOptions.cwd,
        timeoutMs: runOptions.timeoutMs,
      });
      if (options.run !== undefined) {
        return options.run(command, args);
      }
      return { exitCode: 0, stdout: "ok" };
    },
    readFile: async (path) => {
      const content = options.files[path];
      if (content === undefined) {
        throw enoent(`missing ${path}`);
      }
      return content;
    },
  });
  assert.equal(calls.length, 0, "construction performs no calls");
  return { calls, integration };
}

async function installNow(integration: Integration): Promise<void> {
  if (integration.install === undefined) {
    throw new Error("install capability missing");
  }
  await integration.install();
}

async function rejectsInstall(integration: Integration, pattern: RegExp): Promise<void> {
  await assert.rejects(async () => installNow(integration), pattern);
}

describe("delegate-skill installation", () => {
  it("uses the upstream source and exposes install beside detect", () => {
    assert.equal(DELEGATE_SKILLS_SOURCE, "amElnagdy/delegate-skills");
    const { integration } = harness({ files: skillFiles("/skills-a") });
    assert.equal(integration.name, "delegate");
    assert.deepEqual(integration.capabilities, ["detect", "install"]);
  });

  it("is a no-op when fresh detection already proves availability", async () => {
    const { calls, integration } = harness({ files: skillFiles("/skills-a") });
    await installNow(integration);
    assert.ok(!calls.some((call) => call.command === "npx"), "no installation attempted");
    assert.ok(calls.length >= 1, "fresh detection ran");
  });

  it("performs fresh detection before installing", async () => {
    let installed = false;
    const { calls, integration } = harness({
      files: {},
      run: (command, args) => {
        if (command === "npx" && args[0] === "--version") {
          return { exitCode: 0, stdout: "npx ok" };
        }
        if (command === "npx") {
          installed = true;
          return { exitCode: 0, stdout: "installed" };
        }
        if (!installed) {
          throw enoent("spawn opencode ENOENT");
        }
        return { exitCode: 0, stdout: "ok" };
      },
    });
    await assert.rejects(installNow(integration), /verification failed/);
    assert.deepEqual(calls[0], {
      command: "npx",
      args: ["--version"],
      cwd: "/proj",
      timeoutMs: undefined,
    });
    assert.equal(calls[1]?.command, "npx");
    assert.deepEqual(calls[1]?.args.slice(0, 4), ["skills", "add", "amElnagdy/delegate-skills", "--skill"]);
    assert.equal(installed, true);
  });

  it("installs exactly the requested skill from the pinned source", async () => {
    let installed = false;
    const { calls, integration } = harness({
      files: {},
      run: (command, args) => {
        if (command === "npx" && args[0] === "--version") {
          return { exitCode: 0, stdout: "npx ok" };
        }
        if (command === "npx") {
          assert.deepEqual(args, [
            "skills",
            "add",
            "amElnagdy/delegate-skills",
            "--skill",
            "opencode-delegate",
            "-y",
          ]);
          installed = true;
          return { exitCode: 0, stdout: "installed" };
        }
        if (!installed) {
          throw enoent("spawn opencode ENOENT");
        }
        return { exitCode: 0, stdout: "ok" };
      },
    });
    await assert.rejects(installNow(integration), /verification failed/);
    assert.equal(installed, true);
    const installs = calls.filter(
      (call) => call.command === "npx" && call.args[0] === "skills",
    );
    assert.equal(installs.length, 1, "exactly one install command");
    assert.equal(typeof installs[0]?.timeoutMs, "number", "network installs carry a timeout");
  });

  it("passes the target agent only when explicitly known", async () => {
    for (const targetAgent of [undefined, "opencode"] as const) {
      const { calls, integration } = harness({
        files: {},
        targetAgent,
        run: (command, args) => {
          if (command === "npx" && args[0] === "--version") {
            return { exitCode: 0, stdout: "npx ok" };
          }
          if (command === "npx") {
            return { exitCode: 0, stdout: "installed" };
          }
          throw enoent("spawn opencode ENOENT");
        },
      });
      await assert.rejects(installNow(integration), /verification failed/);
      const install = calls.find(
        (call) => call.command === "npx" && call.args[0] === "skills",
      );
      if (targetAgent === undefined) {
        assert.ok(!install?.args.includes("--agent"), "no agent flag without knowledge");
      } else {
        assert.deepEqual(install?.args, [
          "skills",
          "add",
          "amElnagdy/delegate-skills",
          "--skill",
          "opencode-delegate",
          "--agent",
          "opencode",
          "-y",
        ]);
      }
    }
  });

  it("describes the install plan deterministically for the explanation layer", () => {
    assert.deepEqual(
      describeDelegateSkillInstall({
        skillName: SKILL,
        implementerCommand: IMPLEMENTER,
        skillRoots: ROOTS,
      }),
      {
        source: "amElnagdy/delegate-skills",
        skill: "opencode-delegate",
        agent: undefined,
        scope: "project",
        command: ["skills", "add", "amElnagdy/delegate-skills", "--skill", "opencode-delegate", "-y"],
      },
    );
    const global = describeDelegateSkillInstall({
      skillName: SKILL,
      implementerCommand: IMPLEMENTER,
      skillRoots: ROOTS,
      targetAgent: "opencode",
      installScope: "global",
    });
    assert.equal(global.scope, "global");
    assert.ok(global.command.includes("--global"));
    assert.ok(global.command.includes("--agent"));
    assert.ok(!global.command.includes("--all"), "never broad flags");
  });

  it("rejects skill names outside the delegate convention", () => {
    for (const skillName of ["", "opencode", "delegate-setup", "Codex-Delegate", "x", "*"]) {
      assert.throws(
        () =>
          createDelegateSkillIntegrationWithInstall({
            skillName,
            implementerCommand: IMPLEMENTER,
            skillRoots: ROOTS,
          }),
        /unknown delegate skill/,
        skillName,
      );
    }
  });

  it("fails clearly on Node/Skills CLI incompatibility", async () => {
    for (const nodeVersion of ["v18.20.0", "v21.9.9", "v22.19.9", "not-a-version"]) {
      const { calls, integration } = harness({ files: {}, nodeVersion });
      await rejectsInstall(
        integration,
        /Skills CLI requires Node >= 22\.20\.0.*never modifies the runtime/,
      );
      assert.equal(calls.length, 0, "nothing runs on incompatible runtimes");
    }
    const { integration } = harness({ files: skillFiles("/skills-a"), nodeVersion: "v24.1.0" });
    await installNow(integration);
  });

  it("fails clearly when npx is unavailable", async () => {
    const { calls, integration } = harness({
      files: {},
      run: (command) => {
        if (command === "npx") {
          throw enoent("spawn npx ENOENT");
        }
        throw enoent("spawn opencode ENOENT");
      },
    });
    await rejectsInstall(integration, /npx is not available/);
    assert.ok(!calls.some((call) => call.args[0] === "skills"), "no install attempted");
  });

  it("verifies with fresh detection and fails when it cannot confirm", async () => {
    const { integration } = harness({
      files: {},
      run: (command, args) => {
        if (command === "npx") {
          return { exitCode: 0, stdout: "installed" };
        }
        throw enoent("spawn opencode ENOENT");
      },
    });
    await rejectsInstall(integration, /verification failed/);
  });

  it("surfaces installation command failure", async () => {
    const { calls, integration } = harness({
      files: {},
      run: (command, args) => {
        if (command === "npx" && args[0] === "--version") {
          return { exitCode: 0, stdout: "npx ok" };
        }
        if (command === "npx") {
          return { exitCode: 1, stdout: "network down" };
        }
        throw enoent("spawn opencode ENOENT");
      },
    });
    await rejectsInstall(integration, /skills install failed \(exit 1\)/);
    const installs = calls.filter(
      (call) => call.command === "npx" && call.args[0] === "skills",
    );
    assert.equal(installs.length, 1, "no retry");
  });

  it("refuses to modify anything when fresh detection fails", async () => {
    const { calls, integration } = harness({
      files: skillFiles("/skills-a"),
      run: () => {
        throw new Error("probe exploded");
      },
    });
    await rejectsInstall(integration, /fresh detection failed/);
    assert.equal(calls.length, 1, "only the failed probe ran");
  });

  it("never invokes delegate-setup, relays, or authentication", async () => {
    let installed = false;
    const { calls, integration } = harness({
      files: {},
      run: (command, args) => {
        if (command === "npx" && args[0] === "--version") {
          return { exitCode: 0, stdout: "npx ok" };
        }
        if (command === "npx") {
          installed = true;
          return { exitCode: 0, stdout: "installed" };
        }
        if (!installed) {
          throw enoent("spawn opencode ENOENT");
        }
        return { exitCode: 0, stdout: "ok" };
      },
    });
    await assert.rejects(installNow(integration), /verification failed/);
    for (const call of calls) {
      assert.ok(
        call.command === "npx" || call.command === "opencode" || call.command === "git",
        `expected command, got ${call.command}`,
      );
      assert.ok(!call.args.includes("delegate-setup"), "no setup");
      assert.ok(!call.args.includes("relay.mjs"), "no relay");
      assert.ok(!call.args.includes("login"), "no login");
      assert.equal(call.cwd, "/proj");
    }
  });

  it("installs project scope by default and global only explicitly", async () => {
    for (const installScope of ["project", "global"] as const) {
      const { calls, integration } = harness({
        files: {},
        installScope,
        run: (command, args) => {
          if (command === "npx") {
            return { exitCode: 0, stdout: "ok" };
          }
          throw enoent("spawn opencode ENOENT");
        },
      });
      await assert.rejects(installNow(integration), /verification failed/);
      const install = calls.find(
        (call) => call.command === "npx" && call.args[0] === "skills",
      );
      assert.equal(install?.args.includes("--global"), installScope === "global");
    }
  });

  it("detects the delegate integration through the generic contract", async () => {
    const { integration } = harness({ files: skillFiles("/skills-a") });
    const registry = createIntegrationRegistry();
    registry.register(integration);
    assert.deepEqual(await detectIntegration(registry, "delegate"), {
      status: "detected",
      result: {
        available: true,
        detail:
          'delegate skill "opencode-delegate" installed with relay; ' +
          'implementer "opencode" available; authentication not verified',
      },
    });
  });

  it("leaves configuration and registry untouched", async () => {
    const registry = createIntegrationRegistry();
    const { integration } = harness({ files: {} });
    registry.register(integration);
    const before = JSON.stringify(registry.list().map((entry) => entry.name));
    await assert.rejects(installNow(integration), /verification failed/);
    assert.equal(JSON.stringify(registry.list().map((entry) => entry.name)), before);
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "providers", "delegate-install.ts"),
      "utf8",
    );
    assert.ok(!/FrameworkConfig|isIntegrationEnabled|providers\.\w+\s*=/.test(source), "no config");
  });

  it("keeps provider specifics inside the delegate integration", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "providers", "delegate-install.ts"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...code.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(
      importedModules.sort(),
      ["./delegate-detection", "./integration"],
      "composition-only imports",
    );
    assert.ok(!/shell\s*:|execFile|execSync|fetch\(|XMLHttpRequest/.test(code), "no shell/network");
    assert.ok(!/from "\.\/opencode"/.test(code), "direct provider untouched");
    assert.ok(!/fleet|lane[^s]|session|resume/.test(code), "no later-ticket state");
    for (const file of [
      "integration.ts",
      "integration-registry.ts",
      "integration-detection.ts",
      "integration-config.ts",
    ]) {
      const foundation = readFileSync(
        join(__dirname, "..", "..", "src", "providers", file),
        "utf8",
      );
      assert.ok(!/delegate|relay|skill/i.test(foundation), `${file} stays generic`);
    }
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/delegate-install");
    assert.deepEqual(Object.keys(module).sort(), [
      "DELEGATE_INSTALL_SCOPES",
      "DELEGATE_SKILLS_SOURCE",
      "createDelegateSkillIntegrationWithInstall",
      "describeDelegateSkillInstall",
    ]);
  });
});
