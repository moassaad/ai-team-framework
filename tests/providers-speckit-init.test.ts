import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  initSpecKitProject,
  preflightSpecKitInit,
} from "../src/providers/speckit-init";

// Spec Kit existing-project initialization tests (S-004): injected
// fakes only. No real `specify`, Git, or project mutation ever runs.
// Calling `initSpecKitProject()` in a test IS the confirmed step: the
// provider contract assumes Framework-level confirmation happened,
// so `--force` on this path is confirmed force, never auto-force.

interface RecordedCall {
  command: string;
  args: readonly string[];
  cwd: string;
}

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

const HELP_WITH_NON_INTERACTIVE =
  "Usage: specify init\n\n--here --force --non-interactive --integration <key>";

interface Script {
  entries?: readonly string[];
  dirError?: Error;
  files?: Record<string, string>;
  run?: (command: string, args: readonly string[]) => { exitCode: number | null; stdout: string };
  initialized?: () => boolean;
}

function fakes(options: {
  script: Script;
  projectRoot?: string;
  integrationKey?: string;
}): {
  calls: RecordedCall[];
  readCalls: string[];
  preflight: (extra?: object) => ReturnType<typeof preflightSpecKitInit>;
  init: (extra?: object) => Promise<void>;
} {
  const calls: RecordedCall[] = [];
  const readCalls: string[] = [];
  const projectRoot = options.projectRoot ?? "/target";
  const run = async (command: string, args: readonly string[], runOptions: { cwd: string }) => {
    calls.push({ command, args: [...args], cwd: runOptions.cwd });
    if (options.script.run !== undefined) {
      return options.script.run(command, args);
    }
    if (command === "specify" && args[0] === "version") {
      return versionJson("0.8.5");
    }
    throw enoent(`unexpected ${command} ${args.join(" ")}`);
  };
  const readFile = async (path: string): Promise<string> => {
    readCalls.push(path);
    const dynamic = options.script.initialized?.() ?? false;
    if (dynamic && path === join(projectRoot, ".specify", "integration.json")) {
      return JSON.stringify(OPENCODE_STATE);
    }
    const content = options.script.files?.[path];
    if (content !== undefined) {
      return content;
    }
    throw enoent(`missing ${path}`);
  };
  const readDir = async (path: string): Promise<readonly string[]> => {
    if (options.script.dirError !== undefined) {
      throw options.script.dirError;
    }
    void path;
    return options.script.entries ?? [];
  };
  const seams = {
    projectRoot,
    integrationKey: options.integrationKey,
    runCommand: run,
    readFile,
    readDir,
  };
  return {
    calls,
    readCalls,
    preflight: (extra = {}) => preflightSpecKitInit({ ...seams, ...extra }),
    init: (extra = {}) => initSpecKitProject({ ...seams, ...extra }),
  };
}

function isRealInit(call: RecordedCall): boolean {
  return call.command === "specify" && call.args[0] === "init" && call.args.includes("--here");
}

function assertExactInit(calls: RecordedCall[], key: string): void {
  const inits = calls.filter(isRealInit);
  assert.equal(inits.length, 1, "exactly one init invocation");
  assert.deepEqual(inits[0]?.args, [
    "init",
    "--here",
    "--force",
    "--non-interactive",
    "--integration",
    key,
  ]);
  assert.equal(inits[0]?.cwd, "/target");
}

function assertNoShell(calls: RecordedCall[]): void {
  for (const call of calls) {
    assert.ok(
      call.command === "specify" || call.command === "git",
      `allowlisted command ${call.command}`,
    );
    assert.equal(call.cwd, "/target");
    assert.ok(!call.args.includes("--force") || call.args[0] === "init", "force only on init");
    assert.ok(!call.args.includes("switch"), "never switches");
    assert.ok(!call.args.includes("uninstall"), "never uninstalls");
  }
}

describe("spec kit existing-project initialization", () => {
  it("is a no-op when detection already reports the requested integration", async () => {
    const { calls, init } = fakes({
      script: {
        entries: ["src", ".specify"],
        files: { [join("/target", ".specify", "integration.json")]: JSON.stringify(OPENCODE_STATE) },
      },
    });
    await init();
    assert.ok(!calls.some(isRealInit), "no initialization");
    assert.ok(calls.length >= 1, "fresh detection ran");
  });

  it("initializes an uninitialized existing project with the exact command", async () => {
    let initialized = false;
    const { calls, init } = fakes({
      script: {
        entries: ["src", "package.json"],
        run: (command, args) => {
          if (command === "git") {
            throw enoent("no git");
          }
          if (command === "specify" && args[0] === "version") {
            return versionJson("0.8.5");
          }
          if (command === "specify" && args.join(" ") === "init --help") {
            return { exitCode: 0, stdout: HELP_WITH_NON_INTERACTIVE };
          }
          if (command === "specify" && args[0] === "init") {
            initialized = true;
            return { exitCode: 0, stdout: "initialized" };
          }
          throw enoent(`unexpected ${command} ${args.join(" ")}`);
        },
        initialized: () => initialized,
      },
    });
    await init();
    assertExactInit(calls, "opencode");
    assert.ok(
      !calls.some((call) => call.args[0] === "integration"),
      "no integration install as substitute",
    );
    assertNoShell(calls);
  });

  it("passes a custom integration key through", async () => {
    let initialized = false;
    const { calls, init } = fakes({
      script: {
        entries: ["src"],
        run: (command, args) => {
          if (command === "git") {
            throw enoent("no git");
          }
          if (command === "specify" && args[0] === "version") {
            return versionJson("0.8.5");
          }
          if (command === "specify" && args.join(" ") === "init --help") {
            return { exitCode: 0, stdout: HELP_WITH_NON_INTERACTIVE };
          }
          if (command === "specify" && args[0] === "init") {
            initialized = true;
            return { exitCode: 0, stdout: "initialized" };
          }
          throw enoent(`unexpected ${command} ${args.join(" ")}`);
        },
        initialized: () => initialized,
      },
      integrationKey: "claude",
    });
    await assert.rejects(init(), /verification failed/);
    assertExactInit(calls, "claude");
  });

  it("proves non-interactive support before initializing", async () => {
    const { calls, init } = fakes({
      script: {
        entries: ["src"],
        run: (command, args) => {
          if (command === "git") {
            throw enoent("no git");
          }
          if (command === "specify" && args[0] === "version") {
            return versionJson("0.8.5");
          }
          if (command === "specify" && args.join(" ") === "init --help") {
            return { exitCode: 0, stdout: HELP_WITH_NON_INTERACTIVE };
          }
          if (command === "specify" && args[0] === "init") {
            return { exitCode: 0, stdout: "initialized" };
          }
          throw enoent(`unexpected ${command} ${args.join(" ")}`);
        },
      },
    });
    await assert.rejects(init(), /verification failed/);
    const order = calls.map((call) => `${call.command} ${call.args.join(" ")}`);
    assert.ok(order.indexOf("specify init --help") < order.indexOf(
      "specify init --here --force --non-interactive --integration opencode",
    ));
  });

  it("fails clearly when --non-interactive is unsupported", async () => {
    const { calls, init } = fakes({
      script: {
        entries: ["src"],
        run: (command, args) => {
          if (command === "git") {
            throw enoent("no git");
          }
          if (command === "specify" && args[0] === "version") {
            return versionJson("0.8.5");
          }
          if (command === "specify" && args.join(" ") === "init --help") {
            return { exitCode: 0, stdout: "Usage: specify init\n\n--here --force" };
          }
          throw enoent(`unexpected ${command} ${args.join(" ")}`);
        },
      },
    });
    await assert.rejects(init(), /does not support --non-interactive; upgrade specify-cli/);
    assert.ok(!calls.some((call) => call.args.includes("--here")), "init never ran");
  });

  it("converges readable state through the S-003 path without switching", async () => {
    const { calls, init } = fakes({
      script: {
        entries: ["src", ".specify"],
        files: { [join("/target", ".specify", "integration.json")]: JSON.stringify(CLAUDE_STATE) },
        run: (command, args) => {
          if (command === "git") {
            throw enoent("no git");
          }
          if (command === "specify" && args[0] === "version") {
            return versionJson("0.8.5");
          }
          if (command === "specify" && args[0] === "integration") {
            assert.deepEqual(args, ["integration", "install", "opencode"]);
            return { exitCode: 0, stdout: "installed" };
          }
          throw enoent(`unexpected ${command} ${args.join(" ")}`);
        },
      },
    });
    await assert.rejects(init(), /verification failed/);
    assert.ok(!calls.some(isRealInit), "no re-initialization");
    assertNoShell(calls);
  });

  it("refuses when the CLI is missing", async () => {
    const { calls, init } = fakes({
      script: {
        entries: ["src"],
        run: (command) => {
          if (command === "git") {
            throw enoent("no git");
          }
          throw enoent("spawn specify ENOENT");
        },
      },
    });
    await assert.rejects(init(), /specify CLI is not installed; install it first/);
    assert.ok(!calls.some(isRealInit), "no initialization attempted");
  });

  it("refuses to create a missing project root", async () => {
    const { calls, init } = fakes({
      script: { dirError: enoent("missing dir") },
    });
    await assert.rejects(init(), /target project root does not exist; refusing to create it/);
    assert.equal(calls.length, 0, "no process ran");
  });

  it("refuses to proceed on malformed Spec Kit state", async () => {
    const { calls, init } = fakes({
      script: {
        entries: ["src", ".specify"],
        files: { [join("/target", ".specify", "integration.json")]: "{broken" },
      },
    });
    await assert.rejects(init(), /fresh detection failed/);
    assert.ok(!calls.some(isRealInit), "no repair attempted");
  });

  it("surfaces init failure without rollback", async () => {
    const { calls, init } = fakes({
      script: {
        entries: ["src"],
        run: (command, args) => {
          if (command === "git") {
            throw enoent("no git");
          }
          if (command === "specify" && args[0] === "version") {
            return versionJson("0.8.5");
          }
          if (command === "specify" && args.join(" ") === "init --help") {
            return { exitCode: 0, stdout: HELP_WITH_NON_INTERACTIVE };
          }
          return { exitCode: 1, stdout: "conflict" };
        },
      },
    });
    await assert.rejects(
      init(),
      /specify init failed \(exit 1\); project files were left as Spec Kit left them; no rollback was performed/,
    );
    assertExactInit(calls, "opencode");
  });

  it("verifies after init and fails when state does not converge", async () => {
    const { calls, init } = fakes({
      script: {
        entries: ["src"],
        run: (command, args) => {
          if (command === "git") {
            throw enoent("no git");
          }
          if (command === "specify" && args[0] === "version") {
            return versionJson("0.8.5");
          }
          if (command === "specify" && args.join(" ") === "init --help") {
            return { exitCode: 0, stdout: HELP_WITH_NON_INTERACTIVE };
          }
          return { exitCode: 0, stdout: "initialized" };
        },
      },
    });
    await assert.rejects(init(), /verification failed/);
    const versionCalls = calls.filter(
      (call) => call.command === "specify" && call.args[0] === "version",
    );
    assert.ok(versionCalls.length >= 2, "verification re-probes after init");
  });

  it("exposes preflight facts for the confirmation layer", async () => {
    const { preflight } = fakes({
      script: {
        entries: ["src", "package.json"],
        run: (command) => {
          if (command === "specify") {
            return versionJson("0.8.5");
          }
          throw enoent("no git");
        },
      },
    });
    const report = await preflight();
    assert.equal(report.projectRoot, "/target");
    assert.equal(report.integrationKey, "opencode");
    assert.equal(report.directoryExists, true);
    assert.equal(report.entryCount, 2);
    assert.equal(report.hasSpecKitDir, false);
    assert.equal(report.git, "absent");
    assert.equal(report.detection.available, false);
  });

  it("observes Git state read-only when available", async () => {
    for (const [porcelain, expected] of [
      ["", "clean"],
      [" M src/index.ts\n?? new.ts\n", "dirty"],
    ] as const) {
      const { preflight } = fakes({
        script: {
          entries: ["src"],
          run: (command, args) => {
            if (command === "specify") {
              return versionJson("0.8.5");
            }
            if (command === "git" && args[0] === "rev-parse") {
              return { exitCode: 0, stdout: "true" };
            }
            return { exitCode: 0, stdout: porcelain };
          },
        },
      });
      assert.equal((await preflight()).git, expected, JSON.stringify(porcelain));
    }
  });

  it("treats unexpected git status failure as unknown, never fatal", async () => {
    const { preflight } = fakes({
      script: {
        entries: ["src"],
        run: (command, args) => {
          if (command === "specify") {
            return versionJson("0.8.5");
          }
          if (command === "git" && args[0] === "rev-parse") {
            return { exitCode: 0, stdout: "true" };
          }
          return { exitCode: 128, stdout: "" };
        },
      },
    });
    assert.equal((await preflight()).git, "unknown");
  });

  it("never modifies configuration or writes Spec Kit files by hand", async () => {
    const { readCalls, init } = fakes({
      script: {
        entries: ["src"],
        run: (command, args) => {
          if (command === "git") {
            throw enoent("no git");
          }
          if (command === "specify" && args[0] === "version") {
            return versionJson("0.8.5");
          }
          if (command === "specify" && args.join(" ") === "init --help") {
            return { exitCode: 0, stdout: HELP_WITH_NON_INTERACTIVE };
          }
          return { exitCode: 0, stdout: "initialized" };
        },
      },
    });
    await assert.rejects(init(), /verification failed/);
    for (const path of readCalls) {
      assert.ok(path.endsWith(join(".specify", "integration.json")), `read-only ${path}`);
    }
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "providers", "speckit-init.ts"),
      "utf8",
    );
    const importedModules = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(
      importedModules.sort(),
      ["./integration", "./speckit-detection", "./speckit-install", "node:fs"],
      "no new framework coupling",
    );
    assert.ok(!/FrameworkConfig|isIntegrationEnabled|providers\.\w+\s*=/.test(source), "no config coupling");
    assert.ok(!/writeFile|mkdir|unlink|rmdir/.test(source), "no file mutation primitives");
    assert.ok(!/shell\s*:|execFile|execSync|fetch\(|XMLHttpRequest/.test(source), "no shell or network");
    const factories = [...source.matchAll(/create[A-Z][A-Za-z]*\(/g)].map((match) => match[0]);
    assert.deepEqual(
      [...new Set(factories)].sort(),
      ["createSpecKitIntegration(", "createSpecKitIntegrationWithInstall("],
      "no adjacent-owner construction",
    );
  });

  it("keeps the generic foundation free from Spec Kit logic", () => {
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
      assert.ok(!/specify|spec-kit|speckit/i.test(foundation), `${file} stays generic`);
    }
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/speckit-init");
    assert.deepEqual(Object.keys(module).sort(), [
      "SPECKIT_GIT_STATES",
      "defaultSpecKitReadDir",
      "initSpecKitProject",
      "preflightSpecKitInit",
    ]);
  });
});
