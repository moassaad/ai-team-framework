import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateConfig } from "../src/config/validator";
import { Integration } from "../src/providers/integration";
import { isIntegrationEnabled } from "../src/providers/integration-config";
import { createIntegrationRegistry } from "../src/providers/integration-registry";
import { detectIntegration } from "../src/providers/integration-detection";
import {
  SPECKIT_COMMAND,
  SPECKIT_EXPECTED_INTEGRATION_KEY,
  SPECKIT_INTEGRATION_NAME,
  SpecKitCommandResult,
  SpecKitCommandRunner,
  createSpecKitIntegration,
} from "../src/providers/speckit-detection";

// Spec Kit detection tests (S-002): injected fakes only, never a real
// `specify` executable, network, installation, or project mutation.
interface RecordedCall {
  command: string;
  args: readonly string[];
  cwd: string;
}

function fakeRunner(
  calls: RecordedCall[],
  behavior: (args: readonly string[]) => SpecKitCommandResult,
): SpecKitCommandRunner {
  return async (command, args, options) => {
    calls.push({ command, args: [...args], cwd: options.cwd });
    return behavior(args);
  };
}

function versionJson(version: string): SpecKitCommandResult {
  return { exitCode: 0, stdout: JSON.stringify({ version, features: {} }) };
}

function plainVersionOk(): SpecKitCommandResult {
  return { exitCode: 0, stdout: "Specify CLI Information\nCLI Version unknown" };
}

function stateText(value: unknown): string {
  return JSON.stringify(value);
}

function enoent(message: string): Error {
  return Object.assign(new Error(message), { code: "ENOENT" });
}

function stateful(options: {
  calls: RecordedCall[];
  versionBehavior: (args: readonly string[]) => SpecKitCommandResult;
  files: Record<string, string>;
  readErrors?: Record<string, Error>;
  projectRoot?: string;
}) {
  const projectRoot = options.projectRoot ?? "/target";
  const expectedPath = join(projectRoot, ".specify", "integration.json");
  const readCalls: string[] = [];
  return {
    expectedPath,
    readCalls,
    integration: createSpecKitIntegration({
      projectRoot,
      runCommand: fakeRunner(options.calls, options.versionBehavior),
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
    }),
  };
}

const OPENCODE_STATE = {
  version: "1.0.0",
  integration_state_schema: 1,
  installed_integrations: ["opencode"],
  integration: "opencode",
  default_integration: "opencode",
};

function registered(name: string, integration: Integration) {
  const registry = createIntegrationRegistry();
  registry.register({
    name,
    capabilities: ["detect"],
    detect: integration.detect,
  } as unknown as Integration);
  return registry;
}

describe("spec kit detection", () => {
  it("uses the spec-kit identity with the opencode expectation", () => {
    assert.equal(SPECKIT_INTEGRATION_NAME, "spec-kit");
    assert.equal(SPECKIT_COMMAND, "specify");
    assert.equal(SPECKIT_EXPECTED_INTEGRATION_KEY, "opencode");
  });

  it("reports unavailable when specify is missing", async () => {
    const calls: RecordedCall[] = [];
    const { integration } = stateful({
      calls,
      versionBehavior: () => {
        throw enoent("spawn specify ENOENT");
      },
      files: {},
    });
    const outcome = await detectIntegration(
      registered(SPECKIT_INTEGRATION_NAME, integration),
      SPECKIT_INTEGRATION_NAME,
    );
    assert.deepEqual(outcome, {
      status: "detected",
      result: { available: false, detail: "specify executable not available" },
    });
    assert.equal(calls.length, 1, "no fallback probe after reliable absence");
  });

  it("detects an initialized project with the expected integration", async () => {
    const calls: RecordedCall[] = [];
    const { integration } = stateful({
      calls,
      versionBehavior: () => versionJson("0.8.5"),
      files: { ["/target/.specify/integration.json"]: stateText(OPENCODE_STATE) },
    });
    const outcome = await detectIntegration(
      registered(SPECKIT_INTEGRATION_NAME, integration),
      SPECKIT_INTEGRATION_NAME,
    );
    assert.deepEqual(outcome, {
      status: "detected",
      result: {
        available: true,
        detail: "specify 0.8.5; project uses the opencode integration",
      },
    });
    assert.deepEqual(calls[0]?.args, ["version", "--features", "--json"]);
    assert.equal(calls[0]?.command, "specify");
  });

  it("reads legacy state where only the default key is recorded", async () => {
    const calls: RecordedCall[] = [];
    const { integration } = stateful({
      calls,
      versionBehavior: () => versionJson("0.8.5"),
      files: {
        ["/target/.specify/integration.json"]: stateText({
          version: "0.7.0",
          integration: "opencode",
        }),
      },
    });
    const outcome = await detectIntegration(
      registered(SPECKIT_INTEGRATION_NAME, integration),
      SPECKIT_INTEGRATION_NAME,
    );
    assert.deepEqual(outcome.status, "detected");
    assert.equal(
      outcome.status === "detected" ? outcome.result.available : undefined,
      true,
    );
  });

  it("exposes the version from the same read-only boundary", async () => {
    const calls: RecordedCall[] = [];
    const { integration } = stateful({
      calls,
      versionBehavior: () => versionJson("0.8.5"),
      files: { ["/target/.specify/integration.json"]: stateText(OPENCODE_STATE) },
    });
    assert.equal(await integration.version?.(), "0.8.5");
    assert.ok(calls.length >= 1);
    for (const call of calls) {
      assert.equal(call.command, "specify");
      assert.equal(call.args[0], "version");
    }
  });

  it("reports uninitialized projects as unavailable", async () => {
    const calls: RecordedCall[] = [];
    const { integration } = stateful({
      calls,
      versionBehavior: () => versionJson("0.8.5"),
      files: {},
    });
    const outcome = await detectIntegration(
      registered(SPECKIT_INTEGRATION_NAME, integration),
      SPECKIT_INTEGRATION_NAME,
    );
    assert.deepEqual(outcome, {
      status: "detected",
      result: {
        available: false,
        detail: "specify 0.8.5 available; project is not initialized as a Spec Kit project",
      },
    });
  });

  it("distinguishes initialized projects missing the expected integration", async () => {
    const calls: RecordedCall[] = [];
    const { integration } = stateful({
      calls,
      versionBehavior: () => versionJson("0.8.5"),
      files: {
        ["/target/.specify/integration.json"]: stateText({
          default_integration: "claude",
          installed_integrations: ["claude"],
        }),
      },
    });
    const outcome = await detectIntegration(
      registered(SPECKIT_INTEGRATION_NAME, integration),
      SPECKIT_INTEGRATION_NAME,
    );
    assert.deepEqual(outcome, {
      status: "detected",
      result: {
        available: false,
        detail: "specify 0.8.5; project is initialized without the opencode integration",
      },
    });
  });

  it("fails on malformed, non-object, newer-schema, or unreadable state", async () => {
    const cases: Array<{ name: string; files: Record<string, string>; errors?: Record<string, Error> }> = [
      { name: "invalid json", files: { ["/target/.specify/integration.json"]: "{nope" } },
      { name: "non-object", files: { ["/target/.specify/integration.json"]: "[1,2]" } },
      {
        name: "newer schema",
        files: {
          ["/target/.specify/integration.json"]: stateText({
            integration_state_schema: 99,
            installed_integrations: ["opencode"],
          }),
        },
      },
      {
        name: "unreadable file",
        files: { ["/target/.specify/integration.json"]: stateText(OPENCODE_STATE) },
        errors: {
          ["/target/.specify/integration.json"]: Object.assign(new Error("denied"), {
            code: "EACCES",
          }),
        },
      },
    ];
    for (const entry of cases) {
      const calls: RecordedCall[] = [];
      const { integration } = stateful({
        calls,
        versionBehavior: () => versionJson("0.8.5"),
        files: entry.files,
        readErrors: entry.errors,
      });
      const outcome = await detectIntegration(
        registered(SPECKIT_INTEGRATION_NAME, integration),
        SPECKIT_INTEGRATION_NAME,
      );
      assert.equal(outcome.status, "failed", entry.name);
      assert.ok(!("result" in outcome), `${entry.name} fabricates no availability`);
    }
  });

  it("treats version and process failures as detection failures", async () => {
    const failing: Array<{ name: string; behavior: SpecKitCommandRunner }> = [
      {
        name: "version probe rejects presence",
        behavior: async () => ({ exitCode: 1, stdout: "" }),
      },
      {
        name: "runner throws",
        behavior: async () => {
          throw new Error("probe exploded");
        },
      },
    ];
    for (const entry of failing) {
      const integration = createSpecKitIntegration({
        projectRoot: "/target",
        runCommand: entry.behavior,
        readFile: async () => stateText(OPENCODE_STATE),
      });
      const outcome = await detectIntegration(
        registered(SPECKIT_INTEGRATION_NAME, integration),
        SPECKIT_INTEGRATION_NAME,
      );
      assert.equal(outcome.status, "failed", entry.name);
    }
  });

  it("falls back to presence-only evidence for older CLIs", async () => {
    const calls: RecordedCall[] = [];
    const { integration } = stateful({
      calls,
      versionBehavior: (args) =>
        args.length === 1 ? plainVersionOk() : { exitCode: 2, stdout: "usage error" },
      files: {},
    });
    const outcome = await detectIntegration(
      registered(SPECKIT_INTEGRATION_NAME, integration),
      SPECKIT_INTEGRATION_NAME,
    );
    assert.deepEqual(outcome, {
      status: "detected",
      result: {
        available: false,
        detail:
          "specify unknown version available; project is not initialized as a Spec Kit project",
      },
    });
    assert.deepEqual(
      calls.map((call) => call.args),
      [["version", "--features", "--json"], ["version"]],
    );
    await assert.rejects(
      async () => {
        await integration.version?.();
      },
      /version not determinable/,
    );
  });

  it("never installs, initializes, repairs, or writes", async () => {
    const calls: RecordedCall[] = [];
    const { integration, readCalls, expectedPath } = stateful({
      calls,
      versionBehavior: () => versionJson("0.8.5"),
      files: { ["/target/.specify/integration.json"]: stateText(OPENCODE_STATE) },
    });
    await detectIntegration(
      registered(SPECKIT_INTEGRATION_NAME, integration),
      SPECKIT_INTEGRATION_NAME,
    );
    await integration.version?.();
    for (const call of calls) {
      assert.equal(call.command, "specify");
      assert.equal(call.args[0], "version");
      assert.ok(!call.args.includes("init"), "never initializes");
      assert.ok(!call.args.includes("install"), "never installs");
      assert.ok(!call.args.includes("use"), "never changes the default");
      assert.ok(!call.args.includes("switch"), "never switches");
    }
    assert.deepEqual(readCalls, [expectedPath], "reads only the state file");
    assert.deepEqual(Object.keys(integration).sort(), [
      "capabilities",
      "detect",
      "name",
      "version",
    ]);
    assert.deepEqual(integration.capabilities, ["detect", "version"]);
  });

  it("never consults configuration and stays independent from it", async () => {
    for (const enabled of [true, false]) {
      const calls: RecordedCall[] = [];
      const { integration } = stateful({
        calls,
        versionBehavior: () => versionJson("0.8.5"),
        files: { ["/target/.specify/integration.json"]: stateText(OPENCODE_STATE) },
      });
      const config = validateConfig({
        version: 1,
        providers: { speckit: { enabled } },
      });
      assert.equal(isIntegrationEnabled(config, "speckit"), enabled);
      const outcome = await detectIntegration(
        registered(SPECKIT_INTEGRATION_NAME, integration),
        SPECKIT_INTEGRATION_NAME,
      );
      assert.deepEqual(outcome.status, "detected");
      assert.equal(
        outcome.status === "detected" ? outcome.result.available : undefined,
        true,
        `enabled=${String(enabled)} changes nothing`,
      );
    }
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "providers", "speckit-detection.ts"),
      "utf8",
    );
    const importedModules = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(
      importedModules.sort(),
      ["./integration", "node:child_process", "node:fs", "node:path"],
      "imports stay within the contract and platform seams",
    );
    assert.ok(!/FrameworkConfig|isIntegrationEnabled|providers\./.test(source), "no config coupling");
    assert.ok(!/from "\.\/speckit"|operationPrompt/.test(source), "no legacy adapter reuse");
    assert.ok(!/from "\.\/opencode"/.test(source), "opencode provider stays separate");
    assert.ok(!/execFile|execSync|shell:\s*true/.test(source), "no ad-hoc execution");
    assert.equal(
      (source.match(/spawnSync\(/g) ?? []).length,
      1,
      "single spawn site inside the default runner",
    );
  });

  it("performs fresh detection on every call without touching the registry", async () => {
    const calls: RecordedCall[] = [];
    let present = false;
    const registry = createIntegrationRegistry();
    const integration = createSpecKitIntegration({
      projectRoot: "/target",
      runCommand: fakeRunner(calls, () => {
        if (!present) {
          throw enoent("missing");
        }
        return versionJson("0.8.5");
      }),
      readFile: async () => {
        if (!present) {
          throw enoent("missing");
        }
        return stateText(OPENCODE_STATE);
      },
    });
    registry.register({
      name: SPECKIT_INTEGRATION_NAME,
      capabilities: ["detect"],
      detect: integration.detect,
    } as unknown as Integration);
    const before = JSON.stringify(registry.list().map((entry) => entry.name));
    assert.deepEqual(await detectIntegration(registry, SPECKIT_INTEGRATION_NAME), {
      status: "detected",
      result: { available: false, detail: "specify executable not available" },
    });
    present = true;
    assert.deepEqual(await detectIntegration(registry, SPECKIT_INTEGRATION_NAME), {
      status: "detected",
      result: {
        available: true,
        detail: "specify 0.8.5; project uses the opencode integration",
      },
    });
    assert.equal(calls.length, 2, "each call re-probes");
    assert.deepEqual(await detectIntegration(registry, SPECKIT_INTEGRATION_NAME), {
      status: "detected",
      result: {
        available: true,
        detail: "specify 0.8.5; project uses the opencode integration",
      },
    });
    assert.equal(calls.length, 3, "no result is reused");
    assert.equal(JSON.stringify(registry.list().map((entry) => entry.name)), before);
  });

  it("respects a custom expected integration key", async () => {
    const calls: RecordedCall[] = [];
    const integration = createSpecKitIntegration({
      projectRoot: "/target",
      integrationKey: "claude",
      runCommand: fakeRunner(calls, () => versionJson("0.8.5")),
      readFile: async () =>
        stateText({ default_integration: "claude", installed_integrations: ["claude"] }),
    });
    const outcome = await detectIntegration(
      registered(SPECKIT_INTEGRATION_NAME, integration),
      SPECKIT_INTEGRATION_NAME,
    );
    assert.deepEqual(outcome.status, "detected");
    assert.equal(
      outcome.status === "detected" ? outcome.result.available : undefined,
      true,
    );
  });

  it("rejects invalid construction input", () => {
    assert.throws(
      () =>
        createSpecKitIntegration({
          projectRoot: "",
          runCommand: async () => ({ exitCode: 1, stdout: "" }),
          readFile: async () => "",
        }),
      /projectRoot must be a non-empty string/,
    );
    assert.throws(
      () =>
        createSpecKitIntegration({
          projectRoot: "/target",
          integrationKey: "",
          runCommand: async () => ({ exitCode: 1, stdout: "" }),
          readFile: async () => "",
        }),
      /integrationKey must be a non-empty string/,
    );
  });

  it("keeps the generic foundation free from Spec Kit logic", () => {
    const files = [
      "integration.ts",
      "integration-registry.ts",
      "integration-detection.ts",
      "integration-config.ts",
    ];
    for (const file of files) {
      const source = readFileSync(join(__dirname, "..", "..", "src", "providers", file), "utf8");
      assert.ok(!/specify|spec-kit|speckit/i.test(source), `${file} names no Spec Kit tool`);
    }
  });

  it("fails unknown registry identifiers per I-003", async () => {
    const calls: RecordedCall[] = [];
    const { integration } = stateful({
      calls,
      versionBehavior: () => versionJson("0.8.5"),
      files: { ["/target/.specify/integration.json"]: stateText(OPENCODE_STATE) },
    });
    const registry = registered(SPECKIT_INTEGRATION_NAME, integration);
    await assert.rejects(
      detectIntegration(registry, "nope"),
      /integration detection: unknown integration "nope"/,
    );
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/speckit-detection");
    assert.deepEqual(Object.keys(module).sort(), [
      "SPECKIT_COMMAND",
      "SPECKIT_EXPECTED_INTEGRATION_KEY",
      "SPECKIT_INTEGRATION_NAME",
      "createSpecKitIntegration",
      "defaultSpecKitReadFile",
      "defaultSpecKitRunCommand",
      "isSpecKitNotFoundError",
      "specKitStateFilePath",
    ]);
  });
});
