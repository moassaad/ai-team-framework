import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDefaultConfig } from "../src/config/defaults";
import { validateConfig } from "../src/config/validator";
import { FrameworkConfig } from "../src/config/schema";
import { createIntegrationRegistry } from "../src/providers/integration-registry";
import {
  createProductionStatusDeps,
  runStatusCommand,
  StatusCommandDeps,
} from "../src/cli-status";

// `ai-team status` tests (M17 U-002-B): injected fakes only, except
// the real load-then-validate configuration path (read-only) which
// is the behavior under test. Status never writes: every fake that
// could observe a mutation counts it.

interface Counts {
  detect: Record<string, number>;
  install: number;
  configure: number;
  loadConfiguration: number;
  buildRegistry: number;
}

function fakeIntegration(
  counts: Counts,
  name: string,
  behavior: () => unknown,
  withOptional = false,
): Parameters<ReturnType<typeof createIntegrationRegistry>["register"]>[0] {
  return {
    name,
    capabilities: (withOptional
      ? ["detect", "install", "configure"]
      : ["detect"]) as readonly ("detect" | "install" | "configure")[],
    detect: async () => {
      counts.detect[name] = (counts.detect[name] ?? 0) + 1;
      return behavior() as import("../src/providers/integration").DetectionResult;
    },
    ...(withOptional
      ? {
          install: async (): Promise<void> => {
            counts.install += 1;
          },
          configure: async (): Promise<void> => {
            counts.configure += 1;
          },
        }
      : {}),
  };
}

function configWith(enabled: Record<string, boolean>): FrameworkConfig {
  const base = buildDefaultConfig();
  const providers = { ...base.providers };
  for (const [name, value] of Object.entries(enabled)) {
    providers[name as keyof typeof providers] = { enabled: value } as never;
  }
  return validateConfig({ ...base, providers });
}

function testDeps(
  counts: Counts,
  overrides: {
    config?: FrameworkConfig;
    entries?: { name: string; behavior: () => unknown; withOptional?: boolean }[];
  } = {},
): StatusCommandDeps {
  const frozenConfig = Object.freeze(overrides.config ?? configWith({}));
  return {
    projectRoot: "/proj",
    loadConfiguration: (root) => {
      counts.loadConfiguration += 1;
      assert.equal(root, "/proj");
      return frozenConfig;
    },
    buildRegistry: (root) => {
      counts.buildRegistry += 1;
      assert.equal(root, "/proj");
      const registry = createIntegrationRegistry();
      for (const entry of overrides.entries ?? []) {
        registry.register(fakeIntegration(counts, entry.name, entry.behavior, entry.withOptional));
      }
      return registry;
    },
  };
}

const present = (detail = "there") => ({ available: true, detail });
const absent = (detail: string) => ({ available: false, detail });

describe("ai-team status", () => {
  it("reports the production registry through the existing formatter", async () => {
    const counts: Counts = { detect: {}, install: 0, configure: 0, loadConfiguration: 0, buildRegistry: 0 };
    const result = await runStatusCommand(
      testDeps(counts, {
        config: configWith({ speckit: true }),
        entries: [{ name: "spec-kit", behavior: () => present("specify 1.0") }],
      }),
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "Integration status:\nspec-kit: ready (specify 1.0)\n");
    assert.deepEqual(
      { load: counts.loadConfiguration, build: counts.buildRegistry, detect: counts.detect },
      { load: 1, build: 1, detect: { "spec-kit": 1 } },
    );
  });

  it("keeps disabled-but-available distinct from ready via the real config path", async () => {
    const counts: Counts = { detect: {}, install: 0, configure: 0, loadConfiguration: 0, buildRegistry: 0 };
    const result = await runStatusCommand(
      testDeps(counts, {
        config: configWith({ speckit: false }),
        entries: [{ name: "spec-kit", behavior: () => present() }],
      }),
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "Integration status:\nspec-kit: disabled\n");
  });

  it("bridges the spec-kit registry name to the speckit config key", async () => {
    const counts: Counts = { detect: {}, install: 0, configure: 0, loadConfiguration: 0, buildRegistry: 0 };
    const enabled = await runStatusCommand(
      testDeps(counts, {
        config: configWith({ speckit: true }),
        entries: [{ name: "spec-kit", behavior: () => present() }],
      }),
    );
    assert.ok(enabled.stdout.includes("spec-kit: ready"), "registry name resolves desired state");
    const disabled = await runStatusCommand(
      testDeps(counts, {
        config: configWith({ speckit: false }),
        entries: [{ name: "spec-kit", behavior: () => present() }],
      }),
    );
    assert.ok(disabled.stdout.includes("spec-kit: disabled"));
  });

  it("keeps unavailable distinct from detection failure", async () => {
    const counts: Counts = { detect: {}, install: 0, configure: 0, loadConfiguration: 0, buildRegistry: 0 };
    const result = await runStatusCommand(
      testDeps(counts, {
        config: configWith({ speckit: true, delegate: true }),
        entries: [
          { name: "spec-kit", behavior: () => absent("not initialized") },
          {
            name: "delegate",
            behavior: () => {
              throw new Error("probe exploded");
            },
          },
        ],
      }),
    );
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout,
      "Integration status:\n" +
        "spec-kit: unavailable (not initialized)\n" +
        "delegate: detection failed (probe exploded)\n",
    );
  });

  it("reports every integration even when one detection fails", async () => {
    const counts: Counts = { detect: {}, install: 0, configure: 0, loadConfiguration: 0, buildRegistry: 0 };
    const result = await runStatusCommand(
      testDeps(counts, {
        config: configWith({ opencode: true, speckit: true, delegate: true }),
        entries: [
          { name: "opencode", behavior: () => present() },
          {
            name: "speckit",
            behavior: () => {
              throw new Error("boom");
            },
          },
          { name: "delegate", behavior: () => absent("gone") },
        ],
      }),
    );
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("opencode: ready (there)"));
    assert.ok(result.stdout.includes("speckit: detection failed (boom)"));
    assert.ok(result.stdout.includes("delegate: unavailable (gone)"));
  });

  it("evaluates fresh detection on every run without retaining state", async () => {
    const counts: Counts = { detect: {}, install: 0, configure: 0, loadConfiguration: 0, buildRegistry: 0 };
    const deps = testDeps(counts, {
      config: configWith({ speckit: true }),
      entries: [{ name: "spec-kit", behavior: () => present() }],
    });
    const first = await runStatusCommand(deps);
    const second = await runStatusCommand(deps);
    assert.equal(first.stdout, second.stdout);
    assert.deepEqual(counts.detect, { "spec-kit": 2 });
    assert.deepEqual({ load: counts.loadConfiguration, build: counts.buildRegistry }, { load: 2, build: 2 });
  });

  it("never installs, configures, or mutates configuration", async () => {
    const counts: Counts = { detect: {}, install: 0, configure: 0, loadConfiguration: 0, buildRegistry: 0 };
    const config = configWith({ speckit: true });
    const before = JSON.stringify(config);
    const result = await runStatusCommand(
      testDeps(counts, {
        config,
        entries: [{ name: "spec-kit", behavior: () => present(), withOptional: true }],
      }),
    );
    assert.equal(result.exitCode, 0);
    assert.equal(counts.install, 0);
    assert.equal(counts.configure, 0);
    assert.equal(JSON.stringify(config), before);
  });

  it("uses the existing empty formatter for an empty registry", async () => {
    const counts: Counts = { detect: {}, install: 0, configure: 0, loadConfiguration: 0, buildRegistry: 0 };
    const result = await runStatusCommand(testDeps(counts, { entries: [] }));
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "No integrations registered.\n");
  });

  it("fails the command (not the report) when configuration cannot load", async () => {
    const counts: Counts = { detect: {}, install: 0, configure: 0, loadConfiguration: 0, buildRegistry: 0 };
    const deps = testDeps(counts);
    const failing: StatusCommandDeps = {
      ...deps,
      loadConfiguration: () => {
        throw new Error("Configuration file not found: /proj/.ai-team/config.yaml");
      },
    };
    const result = await runStatusCommand(failing);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /error: status failed: Configuration file not found/);
    assert.deepEqual(counts.buildRegistry, 0, "registry never built");
    assert.deepEqual(counts.detect, {}, "nothing detected");
  });

  it("fails the command when registry construction fails", async () => {
    const counts: Counts = { detect: {}, install: 0, configure: 0, loadConfiguration: 0, buildRegistry: 0 };
    const deps = testDeps(counts);
    const failing: StatusCommandDeps = {
      ...deps,
      buildRegistry: () => {
        throw new Error("boom");
      },
    };
    const result = await runStatusCommand(failing);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /error: status failed: boom/);
  });

  it("never rejects: invalid deps become exit-1 results", async () => {
    for (const bad of [
      "nope",
      { projectRoot: "", loadConfiguration: () => configWith({}), buildRegistry: () => createIntegrationRegistry() },
      { projectRoot: "/proj", loadConfiguration: "yes", buildRegistry: () => createIntegrationRegistry() },
    ]) {
      const result = await runStatusCommand(bad as never);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /error: status failed: /);
    }
  });

  it("production deps wire the real config path and production registry", () => {
    const deps = createProductionStatusDeps("/proj");
    assert.equal(deps.projectRoot, "/proj");
    const registry = deps.buildRegistry("/proj");
    assert.deepEqual(registry.list().map((entry) => entry.name), ["spec-kit"]);
    assert.throws(
      () => deps.loadConfiguration(join(tmpdir(), "ai-team-status-missing-xyz")),
      /Configuration file not found/,
    );
  });

  it("reaches no install, setup, delegation, git, or mutation seams", () => {
    for (const file of ["cli-status.ts", "integration-production.ts"]) {
      const source = readFileSync(join(__dirname, "..", "..", "src", file === "cli-status.ts" ? file : `providers/${file}`), "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
      assert.ok(!/\.install\(|\.configure\(|\.delegate\(|setup|relay|delegate-skills/i.test(code), `${file}: no install/setup/delegation`);
      assert.ok(!/child_process|spawn|exec\(|\bgit\b|commit|push|merge/i.test(code), `${file}: no processes or git`);
      assert.ok(!/writeFile|mkdir|rmSync|npx|skills add/i.test(code), `${file}: no writes or installs`);
    }
    const statusSource = readFileSync(join(__dirname, "..", "..", "src", "cli-status.ts"), "utf8");
    const statusCode = statusSource.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...statusCode.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(
      importedModules.sort(),
      [
        "./cli",
        "./config/loader",
        "./config/schema",
        "./config/validator",
        "./providers/integration-config",
        "./providers/integration-production",
        "./providers/integration-registry",
        "./providers/integration-status",
      ],
      "existing seams only",
    );
  });
});
