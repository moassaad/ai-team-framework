import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDefaultConfig } from "../src/config/defaults";
import { validateConfig } from "../src/config/validator";
import { FrameworkConfig } from "../src/config/schema";
import { createIntegrationRegistry } from "../src/providers/integration-registry";
import { run as runSync } from "../src/cli";
import { runStatusCommand } from "../src/cli-status";
import {
  createProductionSetupDeps,
  runSetupCommand,
  SetupCommandDeps,
} from "../src/cli-setup";

// `ai-team setup` tests (M17 U-004): injected fakes only, except the
// real load-then-validate configuration path. The asker is always
// injected — no test touches a real terminal. Mutation counts prove
// the confirmation boundary: nothing runs before an explicit yes.

interface Counts {
  detect: Record<string, number>;
  install: Record<string, number>;
  configure: Record<string, number>;
  asked: string[];
}

function fakeIntegration(
  counts: Counts,
  name: string,
  detectBehavior: () => unknown,
  options: { installBehavior?: (() => unknown) | null; configureBehavior?: (() => unknown) | null } = {},
): Parameters<ReturnType<typeof createIntegrationRegistry>["register"]>[0] {
  const capabilities: ("detect" | "install" | "configure")[] = ["detect"];
  if (options.installBehavior !== undefined && options.installBehavior !== null) {
    capabilities.push("install");
  }
  if (options.configureBehavior !== undefined && options.configureBehavior !== null) {
    capabilities.push("configure");
  }
  return {
    name,
    capabilities: Object.freeze(capabilities) as readonly ("detect" | "install" | "configure")[],
    detect: async () => {
      counts.detect[name] = (counts.detect[name] ?? 0) + 1;
      return detectBehavior() as import("../src/providers/integration").DetectionResult;
    },
    ...(options.installBehavior === undefined || options.installBehavior === null
      ? {}
      : {
          install: async (): Promise<void> => {
            counts.install[name] = (counts.install[name] ?? 0) + 1;
            await options.installBehavior?.();
          },
        }),
    ...(options.configureBehavior === undefined || options.configureBehavior === null
      ? {}
      : {
          configure: async (): Promise<void> => {
            counts.configure[name] = (counts.configure[name] ?? 0) + 1;
            await (options.configureBehavior as () => unknown)();
          },
        }),
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

const present = (detail = "there") => ({ available: true, detail });
const absent = (detail: string) => ({ available: false, detail });

interface Entry {
  name: string;
  detect: () => unknown;
  install?: (() => unknown) | null;
  configure?: (() => unknown) | null;
}

function testDeps(
  counts: Counts,
  overrides: { config?: FrameworkConfig; entries?: Entry[]; answer?: boolean } = {},
): { deps: SetupCommandDeps; config: FrameworkConfig } {
  const config = overrides.config ?? configWith({});
  const before = JSON.stringify(config);
  const deps: SetupCommandDeps = {
    projectRoot: "/proj",
    loadConfiguration: (root) => {
      assert.equal(root, "/proj");
      assert.equal(JSON.stringify(config), before, "configuration never mutated");
      return config;
    },
    buildRegistry: (root) => {
      assert.equal(root, "/proj");
      const registry = createIntegrationRegistry();
      for (const entry of overrides.entries ?? []) {
        registry.register(
          fakeIntegration(counts, entry.name, entry.detect, {
            installBehavior: entry.install,
            configureBehavior: entry.configure,
          }),
        );
      }
      return registry;
    },
    askConfirmation: async (question) => {
      counts.asked.push(question);
      return overrides.answer ?? false;
    },
  };
  return { deps, config };
}

function freshCounts(): Counts {
  return { detect: {}, install: {}, configure: {}, asked: [] };
}

describe("ai-team setup", () => {
  it("routes a valid setup command and reports the verified result", async () => {
    const counts = freshCounts();
    let available = false;
    const { deps } = testDeps(counts, {
      config: configWith({ speckit: true }),
      entries: [
        {
          name: "spec-kit",
          detect: () => (available ? present("installed just now") : absent("not installed")),
          install: () => {
            available = true;
          },
        },
      ],
      answer: true,
    });
    const result = await runSetupCommand(deps, ["setup", "spec-kit"]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(
      result.stdout,
      "Setup: spec-kit\n" +
        "Enabled: yes\n" +
        "Detected: no\n" +
        "Proposed action: install (proposed-install)\n" +
        "spec-kit is unavailable (not installed); proposes install (a capability the integration declares). Confirmation required before anything changes.\n" +
        "Result: install of spec-kit completed and verified: installed just now.\n",
    );
    assert.deepEqual(counts.install, { "spec-kit": 1 });
    assert.equal(counts.asked.length, 1);
    assert.ok(counts.asked[0].includes("Setup: spec-kit"), "explanation shown before the question");
    assert.ok(counts.asked[0].endsWith("Proceed with install of spec-kit?"));
  });

  it("fails unknown integrations before any detection", async () => {
    const counts = freshCounts();
    const { deps } = testDeps(counts, {
      config: configWith({}),
      entries: [{ name: "spec-kit", detect: () => present() }],
    });
    const result = await runSetupCommand(deps, ["setup", "bogus"]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /error: setup failed: integration setup: unknown integration "bogus"/);
    assert.deepEqual(counts.detect, {}, "no detection ran");
    assert.deepEqual(counts.install, {});
  });

  it("fails a missing integration argument with a usage error", async () => {
    const counts = freshCounts();
    const { deps } = testDeps(counts);
    for (const argv of [["setup"], ["setup", "--yes"], ["setup", "spec-kit", "--yes", "extra"], ["setup", "spec-kit", "--maybe"]]) {
      const result = await runSetupCommand(deps, argv);
      assert.equal(result.exitCode, 1, argv.join(" "));
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /error: usage: ai-team setup <integration> \[--yes\]/);
    }
    assert.deepEqual(counts.detect, {}, "no detection on bad arguments");
  });

  it("a declined confirmation mutates nothing and exits zero", async () => {
    const counts = freshCounts();
    const { deps } = testDeps(counts, {
      config: configWith({ speckit: true }),
      entries: [{ name: "spec-kit", detect: () => absent("not installed"), install: () => undefined }],
      answer: false,
    });
    const result = await runSetupCommand(deps, ["setup", "spec-kit"]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("Result: setup of spec-kit requires explicit confirmation; nothing was changed."));
    assert.deepEqual(counts.install, {});
    assert.deepEqual(counts.configure, {});
    assert.deepEqual(counts.detect, { "spec-kit": 2 }, "CLI plan + U-003 re-plan, no verification");
  });

  it("--yes maps to explicit confirmation without asking", async () => {
    const counts = freshCounts();
    const { deps } = testDeps(counts, {
      config: configWith({ speckit: true }),
      entries: [{ name: "spec-kit", detect: () => absent("not installed"), install: () => undefined }],
    });
    const result = await runSetupCommand(deps, ["setup", "spec-kit", "--yes"]);
    assert.equal(result.exitCode, 1, "install ran but verification still unavailable");
    assert.deepEqual(counts.asked, [], "never asked");
    assert.deepEqual(counts.install, { "spec-kit": 1 });
    assert.ok(result.stdout.includes("Result: install of spec-kit completed but verification still reports unavailable (not installed); not treated as success."));
  });

  it("already-ready setup asks nothing, mutates nothing, exits zero", async () => {
    const counts = freshCounts();
    const { deps } = testDeps(counts, {
      config: configWith({ speckit: true }),
      entries: [{ name: "spec-kit", detect: () => present(), install: () => undefined }],
      answer: true,
    });
    const result = await runSetupCommand(deps, ["setup", "spec-kit"]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("Proposed action: none (already-ready)"));
    assert.ok(result.stdout.includes("is already ready"));
    assert.deepEqual(counts.asked, []);
    assert.deepEqual(counts.install, {});
  });

  it("available-but-disabled reports without touching configuration", async () => {
    const counts = freshCounts();
    const { deps, config } = testDeps(counts, {
      config: configWith({ speckit: false }),
      entries: [{ name: "spec-kit", detect: () => present(), install: () => undefined }],
      answer: true,
    });
    const before = JSON.stringify(config);
    const result = await runSetupCommand(deps, ["setup", "spec-kit"]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("available but disabled; leaving configuration unchanged"));
    assert.deepEqual(counts.install, {});
    assert.equal(JSON.stringify(config), before);
  });

  it("unavailable + install goes through the provider capability and verifies", async () => {
    const counts = freshCounts();
    let available = false;
    const { deps } = testDeps(counts, {
      config: configWith({ speckit: true }),
      entries: [
        {
          name: "spec-kit",
          detect: () => (available ? present("verified") : absent("not installed")),
          install: () => {
            available = true;
          },
        },
      ],
      answer: true,
    });
    const result = await runSetupCommand(deps, ["setup", "spec-kit"]);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(counts.install, { "spec-kit": 1 });
    assert.deepEqual(counts.detect, { "spec-kit": 3 }, "CLI plan + U-003 re-plan + verification");
  });

  it("unavailable + configure-only goes through configure", async () => {
    const counts = freshCounts();
    let available = false;
    const { deps } = testDeps(counts, {
      config: configWith({ delegate: true }),
      entries: [
        {
          name: "delegate",
          detect: () => (available ? present("configured") : absent("needs settings")),
          configure: () => {
            available = true;
          },
        },
      ],
      answer: true,
    });
    const result = await runSetupCommand(deps, ["setup", "delegate"]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("Proposed action: configure (proposed-configure)"));
    assert.deepEqual(counts.configure, { delegate: 1 });
    assert.deepEqual(counts.install, {});
  });

  it("detection failure asks nothing, mutates nothing, exits one", async () => {
    const counts = freshCounts();
    const { deps } = testDeps(counts, {
      config: configWith({ speckit: true }),
      entries: [
        {
          name: "spec-kit",
          detect: () => {
            throw new Error("probe exploded");
          },
          install: () => undefined,
        },
      ],
      answer: true,
    });
    const result = await runSetupCommand(deps, ["setup", "spec-kit"]);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stdout.includes("Detected: detection failed"));
    assert.ok(result.stdout.includes("detection failed (probe exploded); nothing will be changed."));
    assert.deepEqual(counts.asked, []);
    assert.deepEqual(counts.install, {});
  });

  it("verification failure exits one without retrying", async () => {
    const counts = freshCounts();
    const { deps } = testDeps(counts, {
      config: configWith({ speckit: true }),
      entries: [{ name: "spec-kit", detect: () => absent("still missing"), install: () => undefined }],
      answer: true,
    });
    const result = await runSetupCommand(deps, ["setup", "spec-kit"]);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stdout.includes("not treated as success"));
    assert.deepEqual(counts.install, { "spec-kit": 1 }, "exactly one mutation");
    assert.deepEqual(counts.detect, { "spec-kit": 3 }, "CLI plan + U-003 re-plan + verification");
  });

  it("mutation failure exits one without verification", async () => {
    const counts = freshCounts();
    const { deps } = testDeps(counts, {
      config: configWith({ speckit: true }),
      entries: [
        {
          name: "spec-kit",
          detect: () => absent("not installed"),
          install: () => {
            throw new Error("network down");
          },
        },
      ],
      answer: true,
    });
    const result = await runSetupCommand(deps, ["setup", "spec-kit"]);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stdout.includes("Result: install of spec-kit failed: network down; nothing was verified."));
    assert.deepEqual(counts.install, { "spec-kit": 1 });
    assert.deepEqual(counts.detect, { "spec-kit": 2 }, "CLI plan + U-003 re-plan, no verification after failure");
  });

  it("no-mutation-capability exits one without asking", async () => {
    const counts = freshCounts();
    const { deps } = testDeps(counts, {
      config: configWith({ delegate: true }),
      entries: [{ name: "delegate", detect: () => absent("gone") }],
      answer: true,
    });
    const result = await runSetupCommand(deps, ["setup", "delegate"]);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stdout.includes("cannot set up automatically"));
    assert.deepEqual(counts.asked, []);
  });

  it("configuration load failure exits one before detection", async () => {
    const counts = freshCounts();
    const { deps } = testDeps(counts);
    const failing: SetupCommandDeps = {
      ...deps,
      loadConfiguration: () => {
        throw new Error("Configuration file not found: /proj/.ai-team/config.yaml");
      },
    };
    const result = await runSetupCommand(failing, ["setup", "spec-kit"]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /error: setup failed: Configuration file not found/);
    assert.deepEqual(counts.detect, {});
  });

  it("never rejects: invalid deps become exit-1 results", async () => {
    for (const bad of [
      "nope",
      { projectRoot: "", loadConfiguration: () => configWith({}), buildRegistry: () => { throw new Error("x"); }, askConfirmation: async () => true },
    ]) {
      const result = await runSetupCommand(bad as never, ["setup", "spec-kit"]);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /error: setup failed: /);
    }
  });

  it("production deps wire the real config path, registry, and a stdin asker", () => {
    const deps = createProductionSetupDeps("/proj");
    assert.equal(deps.projectRoot, "/proj");
    assert.deepEqual(deps.buildRegistry("/proj").list().map((entry) => entry.name), ["spec-kit"]);
    assert.equal(typeof deps.askConfirmation, "function");
    assert.throws(
      () => deps.loadConfiguration(join(tmpdir(), "ai-team-setup-missing-xyz")),
      /Configuration file not found/,
    );
  });

  it("leaves status and the sync commands unaffected", async () => {
    const counts = freshCounts();
    const { deps } = testDeps(counts, {
      config: configWith({ speckit: true }),
      entries: [{ name: "spec-kit", detect: () => present() }],
    });
    void deps;
    const help = runSync([], "0.1.0");
    assert.equal(help.exitCode, 0);
    assert.match(help.stdout, /ai-team setup <integration> \[--yes\]/);
    assert.match(help.stdout, /ai-team status/);
    assert.equal(runSync(["setup", "spec-kit"], "0.1.0").exitCode, 1, "sync path still rejects async commands");
    assert.match(runSync(["setup", "spec-kit"], "0.1.0").stderr, /unknown command/);
    const statusCounts = freshCounts();
    const statusDeps = {
      projectRoot: "/proj",
      loadConfiguration: () => configWith({ speckit: true }),
      buildRegistry: () => {
        const registry = createIntegrationRegistry();
        registry.register(fakeIntegration(statusCounts, "spec-kit", () => present()));
        return registry;
      },
    };
    const status = await runStatusCommand(statusDeps);
    assert.equal(status.exitCode, 0);
    assert.equal(status.stdout, "Integration status:\nspec-kit: ready (there)\n");
  });

  it("output is bounded single-purpose text, never an object dump", async () => {
    const counts = freshCounts();
    const { deps } = testDeps(counts, {
      config: configWith({ speckit: true }),
      entries: [{ name: "spec-kit", detect: () => absent("not installed"), install: () => undefined }],
      answer: false,
    });
    const result = await runSetupCommand(deps, ["setup", "spec-kit"]);
    assert.ok(!result.stdout.includes("[object Object]"));
    assert.ok(!result.stdout.includes("    at "));
    assert.equal(result.stdout.split("\n").length, 7, "header + explanation + result");
  });

  it("reaches no provider, shell, config-write, or git seams", () => {
    const source = readFileSync(join(__dirname, "..", "..", "src", "cli-setup.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(
      importedModules.sort(),
      [
        "./cli",
        "./cli-status",
        "./config/loader",
        "./config/schema",
        "./config/validator",
        "./providers/integration-config",
        "./providers/integration-production",
        "./providers/integration-registry",
        "./providers/integration-setup",
        "node:readline",
      ],
      "existing seams + readline only",
    );
    assert.ok(!/\.install\(|\.configure\(|specify|relay|delegate-skill|uv |pipx|SKILL\.md/i.test(code), "no provider execution");
    assert.ok(!/child_process|spawn|exec\(|shell/i.test(code), "no process execution");
    assert.ok(!/writeFile|writeConfig|enableIntegration|providers\.\w+ =/i.test(code), "no configuration mutation");
    assert.ok(!/\bgit\b|commit|push|merge|branch/i.test(code), "no git");
    assert.ok(!/skillRoots|skillName|fleet|lane|model|setup all/i.test(code), "no delegate invention or batch setup");
  });
});
