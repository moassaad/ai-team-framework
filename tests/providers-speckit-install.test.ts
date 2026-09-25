import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Integration, supportsCapability } from "../src/providers/integration";
import { createIntegrationRegistry } from "../src/providers/integration-registry";
import { detectIntegration } from "../src/providers/integration-detection";
import {
  SPECKIT_CLI_INSTALLERS,
  createSpecKitIntegrationWithInstall,
} from "../src/providers/speckit-install";
import { SPECKIT_INTEGRATION_NAME } from "../src/providers/speckit-detection";

// Spec Kit installation tests (S-003): injected fakes only. No real
// package manager, registry, network, or project mutation ever runs;
// construction itself performs zero calls.
interface RecordedCall {
  command: string;
  args: readonly string[];
  cwd: string;
  timeoutMs?: number;
}

type RunBehavior = (
  command: string,
  args: readonly string[],
) => { exitCode: number | null; stdout: string };

function enoent(message: string): Error {
  return Object.assign(new Error(message), { code: "ENOENT" });
}

function versionJson(version: string): { exitCode: number | null; stdout: string } {
  return { exitCode: 0, stdout: JSON.stringify({ version, features: {} }) };
}

const OPENCODE_STATE = {
  version: "1.0.0",
  integration_state_schema: 1,
  installed_integrations: ["opencode"],
  integration: "opencode",
  default_integration: "opencode",
};

const CLAUDE_STATE = {
  default_integration: "claude",
  installed_integrations: ["claude"],
};

interface Harness {
  calls: RecordedCall[];
  readCalls: string[];
  integration: Integration;
}

function harness(options: {
  run: RunBehavior;
  files: Record<string, string>;
  readErrors?: Record<string, Error>;
  projectRoot?: string;
  cliInstaller?: "auto" | "uv" | "pipx" | "pip";
}): Harness {
  const calls: RecordedCall[] = [];
  const readCalls: string[] = [];
  const projectRoot = options.projectRoot ?? "/target";
  const integration = createSpecKitIntegrationWithInstall({
    projectRoot,
    cliInstaller: options.cliInstaller,
    runCommand: async (command, args, runOptions) => {
      calls.push({
        command,
        args: [...args],
        cwd: runOptions.cwd,
        timeoutMs: runOptions.timeoutMs,
      });
      return options.run(command, args);
    },
    readFile: async (path) => {
      readCalls.push(path);
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
  assert.equal(calls.length, 0, "construction performs no calls");
  return { calls, readCalls, integration };
}

function statePath(root = "/target"): string {
  return join(root, ".specify", "integration.json");
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

/** CLI present; anything else is absent. */
function alwaysPresent(): RunBehavior {
  return (command) => {
    if (command === "specify") {
      return versionJson("0.8.5");
    }
    throw enoent(`unexpected ${command}`);
  };
}

function assertNoForce(calls: RecordedCall[]): void {
  for (const call of calls) {
    assert.ok(!call.args.includes("--force"), `no --force in ${call.command} ${call.args}`);
    assert.ok(!call.args.includes("init"), `no init in ${call.command} ${call.args}`);
  }
}

function assertNoShellStrings(calls: RecordedCall[]): void {
  const allowed = new Set(["specify", "uv", "pipx", "pip"]);
  for (const call of calls) {
    assert.ok(allowed.has(call.command), `allowlisted command ${call.command}`);
    assert.equal(call.cwd, "/target", "bounded to the target project");
  }
}

describe("spec kit installation", () => {
  it("exposes install alongside detect and version", async () => {
    const { integration } = harness({ run: alwaysPresent(), files: {} });
    assert.equal(integration.name, SPECKIT_INTEGRATION_NAME);
    assert.deepEqual(integration.capabilities, ["detect", "version", "install"]);
    assert.equal(supportsCapability(integration, "install"), true);
    assert.equal(supportsCapability(integration, "configure"), false);
    assert.equal(await integration.version?.(), "0.8.5");
  });

  it("is a no-op when detection already proves availability", async () => {
    const { calls, integration } = harness({
      run: alwaysPresent(),
      files: { [statePath()]: JSON.stringify(OPENCODE_STATE) },
    });
    await installNow(integration);
    for (const call of calls) {
      assert.equal(call.command, "specify");
      assert.equal(call.args[0], "version");
    }
    assert.ok(calls.length >= 1, "fresh detection ran");
    assertNoForce(calls);
  });

  it("installs a missing CLI through uv, then verifies", async () => {
    const present = { cli: false };
    const { calls, integration } = harness({
      run: (command, args) => {
        if (command === "specify") {
          if (!present.cli) {
            throw enoent("spawn specify ENOENT");
          }
          return versionJson("0.8.5");
        }
        if (command === "uv" && args[0] === "--version") {
          return { exitCode: 0, stdout: "uv 0.5.0" };
        }
        if (command === "uv") {
          present.cli = true;
          return { exitCode: 0, stdout: "installed" };
        }
        throw enoent(`unexpected ${command}`);
      },
      files: { [statePath()]: JSON.stringify(OPENCODE_STATE) },
    });
    await installNow(integration);
    const sequence = calls.map((call) => `${call.command} ${call.args.join(" ")}`);
    assert.deepEqual(sequence, [
      "specify version --features --json",
      "specify version",
      "uv --version",
      "uv tool install specify-cli",
      "specify version --features --json",
    ]);
    const cliInstall = calls.find((call) => call.args.includes("specify-cli"));
    assert.equal(typeof cliInstall?.timeoutMs, "number", "network installs carry a timeout");
    assertNoForce(calls);
    assertNoShellStrings(calls);
  });

  it("falls back to pipx and then pip when earlier tools are missing", async () => {
    for (const [missing, expected] of [["uv", "pipx"], ["uv pipx", "pip"]] as const) {
      const absent = new Set(missing.split(" "));
      const { calls, integration } = harness({
        run: (command, args) => {
          if (command === "specify") {
            throw enoent("spawn specify ENOENT");
          }
          if (absent.has(command)) {
            throw enoent(`no ${command}`);
          }
          if (args[0] === "--version") {
            return { exitCode: 0, stdout: `${command} present` };
          }
          return { exitCode: 0, stdout: "installed" };
        },
        files: {},
      });
      await rejectsInstall(integration, /not initialized/);
      const installs = calls.filter((call) => call.args.includes("specify-cli"));
      assert.equal(installs.length, 1, "exactly one CLI installation");
      assert.equal(installs[0]?.command, expected);
      assert.deepEqual(installs[0]?.args, ["install", "specify-cli"]);
    }
  });

  it("honors an explicit installer choice", async () => {
    const { calls, integration } = harness({
      run: (command, args) => {
        if (command === "specify") {
          throw enoent("spawn specify ENOENT");
        }
        if (command === "pipx") {
          return { exitCode: 0, stdout: "ok" };
        }
        throw enoent(`unexpected ${command}`);
      },
      files: {},
      cliInstaller: "pipx",
    });
    await rejectsInstall(integration, /not initialized/);
    assert.ok(!calls.some((call) => call.command === "uv"), "uv never probed");
    assert.deepEqual(
      calls.find((call) => call.args.includes("specify-cli"))?.args,
      ["install", "specify-cli"],
    );
  });

  it("rejects an unknown installer choice at construction", () => {
    assert.throws(
      () =>
        createSpecKitIntegrationWithInstall({
          projectRoot: "/target",
          cliInstaller: "conda" as unknown as "uv",
        }),
      /unknown CLI installer/,
    );
  });

  it("reports clearly when no installer exists", async () => {
    const { calls, integration } = harness({
      run: () => {
        throw enoent("nothing here");
      },
      files: {},
    });
    await rejectsInstall(integration, /no supported CLI installer available/);
    assert.ok(!calls.some((call) => call.args.includes("specify-cli")), "nothing installed");
  });

  it("installs a missing project integration without touching the CLI", async () => {
    const installed = { key: false };
    const { calls, integration } = harness({
      run: (command, args) => {
        if (command === "specify" && args[0] === "integration") {
          assert.deepEqual(args, ["integration", "install", "opencode"]);
          installed.key = true;
          return { exitCode: 0, stdout: "installed" };
        }
        if (command === "specify") {
          return versionJson("0.8.5");
        }
        throw enoent(`unexpected ${command}`);
      },
      files: { [statePath()]: JSON.stringify(CLAUDE_STATE) },
    });
    await rejectsInstall(integration, /verification failed/);
    assert.equal(installed.key, true);
    assert.ok(!calls.some((call) => ["uv", "pipx", "pip"].includes(call.command)), "CLI untouched");
    assertNoForce(calls);
  });

  it("verifies a successful integration installation", async () => {
    let installed = false;
    const evolving = createSpecKitIntegrationWithInstall({
      projectRoot: "/target",
      runCommand: async (command, args) => {
        if (command === "specify" && args[0] === "integration") {
          installed = true;
          return { exitCode: 0, stdout: "installed" };
        }
        return versionJson("0.8.5");
      },
      readFile: async () => JSON.stringify(installed ? OPENCODE_STATE : CLAUDE_STATE),
    });
    await installNow(evolving);
    assert.equal(installed, true);
  });

  it("refuses to initialize a non-initialized project", async () => {
    const { calls, integration } = harness({
      run: alwaysPresent(),
      files: {},
    });
    await rejectsInstall(integration, /not initialized as a Spec Kit project/);
    assert.ok(!calls.some((call) => call.args[0] === "integration"), "no integration command");
    assertNoForce(calls);
  });

  it("surfaces CLI installation failure", async () => {
    const { calls, integration } = harness({
      run: (command, args) => {
        if (command === "specify") {
          throw enoent("spawn specify ENOENT");
        }
        if (command === "uv" && args[0] === "--version") {
          return { exitCode: 0, stdout: "uv" };
        }
        return { exitCode: 1, stdout: "network down" };
      },
      files: { [statePath()]: JSON.stringify(OPENCODE_STATE) },
    });
    await rejectsInstall(integration, /uv tool install specify-cli failed \(exit 1\)/);
    assert.ok(!calls.some((call) => call.args[0] === "integration"), "no integration attempt");
  });

  it("surfaces integration installation failure without forcing", async () => {
    const { calls, integration } = harness({
      run: (command, args) => {
        if (command === "specify" && args[0] === "integration") {
          return { exitCode: 1, stdout: "needs --force" };
        }
        return versionJson("0.8.5");
      },
      files: { [statePath()]: JSON.stringify(CLAUDE_STATE) },
    });
    await assert.rejects(
      async () => installNow(integration),
      /specify integration install opencode failed \(exit 1\); --force was not used/,
    );
    assertNoForce(calls);
  });

  it("surfaces verification failure after a seemingly successful install", async () => {
    const { integration } = harness({
      run: (command) => {
        if (command === "specify") {
          return versionJson("0.8.5");
        }
        return { exitCode: 0, stdout: "ok" };
      },
      files: { [statePath()]: JSON.stringify(CLAUDE_STATE) },
    });
    await rejectsInstall(integration, /verification failed/);
  });

  it("refuses to modify anything when fresh detection fails", async () => {
    const { calls, integration } = harness({
      run: () => {
        throw new Error("probe exploded");
      },
      files: { [statePath()]: JSON.stringify(OPENCODE_STATE) },
    });
    await rejectsInstall(integration, /fresh detection failed/);
    assert.equal(calls.length, 1, "only the failed probe ran");
  });

  it("repeats install idempotently once state is satisfied", async () => {
    let installed = false;
    const calls: RecordedCall[] = [];
    const integration = createSpecKitIntegrationWithInstall({
      projectRoot: "/target",
      runCommand: async (command, args, runOptions) => {
        calls.push({ command, args: [...args], cwd: runOptions.cwd });
        if (command === "specify" && args[0] === "integration") {
          installed = true;
          return { exitCode: 0, stdout: "installed" };
        }
        return versionJson("0.8.5");
      },
      readFile: async () =>
        JSON.stringify(installed ? OPENCODE_STATE : CLAUDE_STATE),
    });
    await installNow(integration);
    const mutating = (): number =>
      calls.filter((call) => call.args[0] === "integration").length;
    assert.equal(mutating(), 1);
    await installNow(integration);
    assert.equal(mutating(), 1, "second run adds no integration command");
  });

  it("detects the installed integration through the generic contract", async () => {
    const { integration } = harness({
      run: alwaysPresent(),
      files: { [statePath()]: JSON.stringify(OPENCODE_STATE) },
    });
    const registry = createIntegrationRegistry();
    registry.register(integration);
    assert.deepEqual(await detectIntegration(registry, SPECKIT_INTEGRATION_NAME), {
      status: "detected",
      result: {
        available: true,
        detail: "specify 0.8.5; project uses the opencode integration",
      },
    });
  });

  it("keeps provider-specific installation inside the Spec Kit integration", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "providers", "speckit-install.ts"),
      "utf8",
    );
    const importedModules = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(
      importedModules.sort(),
      ["./integration", "./speckit-detection"],
      "no new framework coupling",
    );
    assert.ok(!/shell\s*:|execFile|execSync|fetch\(|XMLHttpRequest/.test(source), "no shell or network");
    assert.ok(!/FrameworkConfig|isIntegrationEnabled|providers\.\w+\s*=/.test(source), "no config coupling");
    assert.ok(!/workflow|coordinator|reviewer|delegate|github/i.test(source), "no adjacent owners");
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
      assert.ok(!/specify|uv |pipx|specify-cli/i.test(foundation), `${file} stays generic`);
    }
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/speckit-install");
    assert.deepEqual(Object.keys(module).sort(), [
      "SPECKIT_CLI_INSTALLERS",
      "SPECKIT_CLI_PACKAGE",
      "createSpecKitIntegrationWithInstall",
    ]);
  });
});
