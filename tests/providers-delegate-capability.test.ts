import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkDelegateCapability,
  DELEGATE_SUPPORTED_DESTINATIONS,
} from "../src/providers/delegate-capability";
import { createDelegateSkillIntegration } from "../src/providers/delegate-detection";
import { formatIntegrationStatus } from "../src/providers/integration-status";
import { Integration } from "../src/providers/integration";

// Delegation capability detection tests (M26 T-024): the existing
// M14/M17 semantics (enabled/detected/ready) applied to one
// explicitly configured delegate integration. Hermetic: skill
// detection runs through injected readFile/runCommand fakes; no
// skills installed, no processes spawned, no dispatch, no writes.

const CAPABILITY_SOURCE = join(__dirname, "..", "..", "src", "providers", "delegate-capability.ts");

function codeLines(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/**") && !trimmed.startsWith("*/");
    })
    .join("\n");
}

function missingError(): NodeJS.ErrnoException {
  return Object.assign(new Error("ENOENT"), { code: "ENOENT" });
}

/** Fake skill tree: present files map to content; everything else is missing. */
function fakeReader(files: Record<string, string>, seen: string[] = []) {
  return async (path: string): Promise<string> => {
    seen.push(path);
    if (path in files) {
      return files[path];
    }
    throw missingError();
  };
}

function fakeRunner(exits: Record<string, number>, calls: string[] = []) {
  return async (command: string, args: readonly string[]) => {
    calls.push(`${command} ${args.join(" ")}`);
    const code = exits[command] ?? 1;
    if (code !== 0) {
      const error = missingError();
      throw error;
    }
    return { exitCode: 0, stdout: "v0-test" };
  };
}

const SKILL_FILES = {
  "/roots/opencode-delegate/SKILL.md": "# Opencode Delegate",
  "/roots/opencode-delegate/scripts/relay.mjs": "// relay",
};

function skillIntegration(
  overrides: Partial<Parameters<typeof createDelegateSkillIntegration>[0]> = {},
): Integration {
  return createDelegateSkillIntegration({
    skillName: "opencode-delegate",
    implementerCommand: "opencode",
    skillRoots: ["/roots"],
    readFile: fakeReader({ ...SKILL_FILES }),
    runCommand: fakeRunner({ opencode: 0, git: 0 }),
    ...overrides,
  });
}

const enabled = () => true;
const disabled = () => false;

describe("delegation capability detection (M26 T-024)", () => {
  describe("existing integration semantics", () => {
    it("enabled plus detected is ready", async () => {
      const capability = await checkDelegateCapability({ integration: skillIntegration(), isEnabled: enabled });
      assert.deepEqual(
        { name: capability.name, enabled: capability.enabled, detected: capability.detected, ready: capability.ready },
        { name: "delegate", enabled: true, detected: true, ready: true },
      );
    });

    it("enabled plus undetected is not ready", async () => {
      const capability = await checkDelegateCapability({
        integration: skillIntegration({ readFile: fakeReader({}) }),
        isEnabled: enabled,
      });
      assert.equal(capability.enabled, true);
      assert.equal(capability.detected, false);
      assert.equal(capability.ready, false);
    });

    it("disabled plus detected is not ready with disabled detail", async () => {
      const capability = await checkDelegateCapability({ integration: skillIntegration(), isEnabled: disabled });
      assert.equal(capability.enabled, false);
      assert.equal(capability.detected, true);
      assert.equal(capability.ready, false);
      assert.equal(capability.detail, "disabled");
    });

    it("disabled plus undetected is not ready", async () => {
      const capability = await checkDelegateCapability({
        integration: skillIntegration({ readFile: fakeReader({}) }),
        isEnabled: disabled,
      });
      assert.equal(capability.ready, false);
      assert.equal(capability.detail, "disabled");
    });

    it("ready requires both sides: truth table over the four combinations", async () => {
      const cases: Array<[boolean, Record<string, string>, boolean]> = [
        [true, { ...SKILL_FILES }, true],
        [true, {}, false],
        [false, { ...SKILL_FILES }, false],
        [false, {}, false],
      ];
      for (const [wantEnabled, files, wantReady] of cases) {
        const capability = await checkDelegateCapability({
          integration: skillIntegration({ readFile: fakeReader(files) }),
          isEnabled: () => wantEnabled,
        });
        assert.equal(capability.ready, wantReady, `enabled=${String(wantEnabled)} files=${String(Object.keys(files).length)}`);
      }
    });

    it("detail carries the detector evidence when enabled and available", async () => {
      const capability = await checkDelegateCapability({ integration: skillIntegration(), isEnabled: enabled });
      assert.ok(capability.detail !== undefined && capability.detail.includes("opencode-delegate"));
      assert.ok(capability.detail.includes("authentication not verified"), "auth limitation stays explicit");
    });
  });

  describe("supported capability", () => {
    it("delegate integration carries the stable delegate identity", async () => {
      const capability = await checkDelegateCapability({ integration: skillIntegration(), isEnabled: enabled });
      assert.equal(capability.name, "delegate");
    });

    it("implementer-only destinations are represented", async () => {
      assert.deepEqual(DELEGATE_SUPPORTED_DESTINATIONS, ["implementer"]);
      const capability = await checkDelegateCapability({ integration: skillIntegration(), isEnabled: enabled });
      assert.deepEqual(capability.supportedDestinations, ["implementer"]);
    });

    it("rejects an integration with the wrong identity", async () => {
      const other: Integration = { name: "speckit", capabilities: ["detect"], detect: () => ({ available: true }) };
      await assert.rejects(checkDelegateCapability({ integration: other, isEnabled: enabled }), /delegate identity/);
    });

    it("rejects non-integration input and malformed envelopes", async () => {
      await assert.rejects(checkDelegateCapability({ integration: { name: "delegate" }, isEnabled: enabled }), /integration contract/);
      await assert.rejects(
        checkDelegateCapability(null as unknown as Parameters<typeof checkDelegateCapability>[0]),
        /capability input object/,
      );
      await assert.rejects(
        checkDelegateCapability({ integration: skillIntegration(), isEnabled: "yes" as unknown as (name: string) => boolean }),
        /isEnabled must be a function/,
      );
    });

    it("results are frozen", async () => {
      const capability = await checkDelegateCapability({ integration: skillIntegration(), isEnabled: enabled });
      assert.ok(Object.isFrozen(capability));
      assert.ok(Object.isFrozen(capability.supportedDestinations));
    });
  });

  describe("availability signals", () => {
    it("missing skill reads as unavailable with a searched-locations detail", async () => {
      const capability = await checkDelegateCapability({
        integration: skillIntegration({ readFile: fakeReader({}) }),
        isEnabled: enabled,
      });
      assert.equal(capability.detected, false);
      assert.ok(capability.detail !== undefined && capability.detail.includes("not installed"));
    });

    it("descriptor without relay reads as installed-but-relay-missing", async () => {
      const capability = await checkDelegateCapability({
        integration: skillIntegration({ readFile: fakeReader({ "/roots/opencode-delegate/SKILL.md": "#" }) }),
        isEnabled: enabled,
      });
      assert.equal(capability.detected, false);
      assert.ok(capability.detail !== undefined && capability.detail.includes("relay missing"));
    });

    it("missing implementer reads as unavailable", async () => {
      const capability = await checkDelegateCapability({
        integration: skillIntegration({ runCommand: fakeRunner({ git: 0 }) }),
        isEnabled: enabled,
      });
      assert.equal(capability.detected, false);
      assert.ok(capability.detail !== undefined && capability.detail.includes('"opencode" not installed'));
    });

    it("missing git prerequisite reads as unavailable", async () => {
      const capability = await checkDelegateCapability({
        integration: skillIntegration({ runCommand: fakeRunner({ opencode: 0 }) }),
        isEnabled: enabled,
      });
      assert.equal(capability.detected, false);
      assert.ok(capability.detail !== undefined && capability.detail.includes("git prerequisite"));
    });

    it("falls through to later roots when the first root lacks the skill", async () => {
      const seen: string[] = [];
      const capability = await checkDelegateCapability({
        integration: skillIntegration({
          skillRoots: ["/empty", "/roots"],
          readFile: fakeReader({ ...SKILL_FILES }, seen),
        }),
        isEnabled: enabled,
      });
      assert.equal(capability.detected, true);
      assert.ok(seen.some((path) => path.startsWith("/empty/")));
      assert.ok(seen.some((path) => path.startsWith("/roots/")));
    });

    it("empty skill roots fail detection without throwing capability", async () => {
      const capability = await checkDelegateCapability({
        integration: skillIntegration({ skillRoots: [] }),
        isEnabled: enabled,
      });
      assert.equal(capability.detected, false);
      assert.ok(capability.detail !== undefined && capability.detail.startsWith("detection failed:"));
    });

    it("unreadable files fail detection with a diagnostic, not an exception", async () => {
      const capability = await checkDelegateCapability({
        integration: skillIntegration({
          readFile: async () => {
            throw new Error("EACCES permission denied");
          },
        }),
        isEnabled: enabled,
      });
      assert.equal(capability.detected, false);
      assert.ok(capability.detail !== undefined && capability.detail.startsWith("detection failed:"));
      assert.equal(capability.enabled, true, "desired state survives detection failure");
    });

    it("contract-breaking detectors fail detection instead of corrupting state", async () => {
      const broken: Integration = {
        name: "delegate",
        capabilities: ["detect"],
        detect: () => ({ available: "yes" }) as unknown as { available: boolean },
      };
      const capability = await checkDelegateCapability({ integration: broken, isEnabled: enabled });
      assert.equal(capability.detected, false);
      assert.ok(capability.detail !== undefined && capability.detail.startsWith("detection failed:"));
    });
  });

    it("unavailable detail passes through verbatim when enabled", async () => {
      const capability = await checkDelegateCapability({
        integration: skillIntegration({ runCommand: fakeRunner({ git: 0 }) }),
        isEnabled: enabled,
      });
      assert.equal(capability.ready, false);
      assert.ok(capability.detail !== undefined && capability.detail.includes('implementer "opencode" not installed'));
    });

    it("config-shaped desired state honors providers.delegate.enabled", async () => {
      const config = { providers: { delegate: { enabled: true } } };
      const fromConfig = await checkDelegateCapability({
        integration: skillIntegration(),
        isEnabled: (name: string) => (config.providers as Record<string, { enabled?: boolean }>)[name]?.enabled === true,
      });
      assert.equal(fromConfig.ready, true);
      const offConfig = { providers: { delegate: { enabled: false } } };
      const fromOffConfig = await checkDelegateCapability({
        integration: skillIntegration(),
        isEnabled: (name: string) => (offConfig.providers as Record<string, { enabled?: boolean }>)[name]?.enabled === true,
      });
      assert.equal(fromOffConfig.ready, false);
    });

    it("non-missing probe errors fail detection instead of reading unavailable", async () => {
      const capability = await checkDelegateCapability({
        integration: skillIntegration({
          runCommand: async () => {
            throw new Error("spawn EACCES");
          },
        }),
        isEnabled: enabled,
      });
      assert.equal(capability.detected, false);
      assert.ok(capability.detail !== undefined && capability.detail.startsWith("detection failed:"));
    });

    it("absence of detector detail yields no detail field", async () => {
      const integration: Integration = { name: "delegate", capabilities: ["detect"], detect: () => ({ available: true }) };
      const capability = await checkDelegateCapability({ integration, isEnabled: enabled });
      assert.equal(capability.ready, true);
      assert.equal(capability.detail, undefined);
      assert.deepEqual(Object.keys(capability).sort(), ["detected", "enabled", "name", "ready", "supportedDestinations"]);
    });

  describe("enablement and readiness", () => {
    it("configuration-only enablement without the skill is not ready", async () => {
      const capability = await checkDelegateCapability({
        integration: skillIntegration({ readFile: fakeReader({}) }),
        isEnabled: enabled,
      });
      assert.equal(capability.enabled, true);
      assert.equal(capability.ready, false);
      assert.ok(capability.detail !== undefined && !capability.detail.startsWith("detection failed:"));
    });

    it("detection without enablement is not ready", async () => {
      const capability = await checkDelegateCapability({ integration: skillIntegration(), isEnabled: disabled });
      assert.equal(capability.detected, true);
      assert.equal(capability.ready, false);
    });

    it("non-boolean desired state is a caller error", async () => {
      await assert.rejects(
        checkDelegateCapability({
          integration: skillIntegration(),
          isEnabled: (() => "yes") as unknown as (name: string) => boolean,
        }),
        /boolean/,
      );
    });
  });

  describe("scope", () => {
    it("desired state is consulted under the delegate identity", async () => {
      const seen: string[] = [];
      await checkDelegateCapability({
        integration: skillIntegration(),
        isEnabled: (name: string) => {
          seen.push(name);
          return true;
        },
      });
      assert.deepEqual(seen, ["delegate"]);
    });

    it("global vs project scope lives in the caller isEnabled function", async () => {
      const projectScoped = await checkDelegateCapability({
        integration: skillIntegration(),
        isEnabled: (name: string) => name === "delegate",
      });
      const globallyOff = await checkDelegateCapability({
        integration: skillIntegration(),
        isEnabled: () => false,
      });
      assert.equal(projectScoped.ready, true);
      assert.equal(globallyOff.ready, false);
    });
  });

  describe("read-only behavior", () => {
    it("never touches install or configure capabilities", async () => {
      const touched: string[] = [];
      const integration: Integration = {
        name: "delegate",
        capabilities: ["detect", "install", "configure"],
        detect: () => ({ available: true, detail: "fake present" }),
        install: async () => {
          touched.push("install");
        },
        configure: async () => {
          touched.push("configure");
        },
      };
      const capability = await checkDelegateCapability({ integration, isEnabled: enabled });
      assert.equal(capability.ready, true);
      assert.deepEqual(touched, []);
    });

    it("performs exactly one detection per call", async () => {
      let detections = 0;
      const integration: Integration = {
        name: "delegate",
        capabilities: ["detect"],
        detect: () => {
          detections += 1;
          return { available: true };
        },
      };
      await checkDelegateCapability({ integration, isEnabled: enabled });
      assert.equal(detections, 1);
    });

    it("writes no files and installs nothing", async () => {
      const root = mkdtempSync(join(tmpdir(), "t024-"));
      const before = readdirSync(root);
      await checkDelegateCapability({ integration: skillIntegration(), isEnabled: enabled });
      assert.deepEqual(readdirSync(root), before);
      const code = codeLines(CAPABILITY_SOURCE);
      for (const forbidden of ["install", "configure(", "writeFile", "delegate-setup", "skills add", "npx"]) {
        assert.ok(!code.includes(forbidden), `capability code never mentions ${forbidden}`);
      }
    });

    it("imports no dispatch, transport, or provider execution", () => {
      const code = codeLines(CAPABILITY_SOURCE);
      for (const forbidden of ["dispatchHandoff", "createDelegateSkillsHandoffTransport", ".delegate(", "DelegateProvider", "execute"]) {
        assert.ok(!code.includes(forbidden), `capability code never mentions ${forbidden}`);
      }
      const imports = readFileSync(CAPABILITY_SOURCE, "utf8")
        .split("\n")
        .filter((line) => line.trim().startsWith("import "));
      assert.deepEqual(imports, [
        'import { isIntegration } from "./integration";',
        'import { createIntegrationRegistry } from "./integration-registry";',
        'import { getIntegrationStatus } from "./integration-status";',
        'import { DELEGATE_SKILLS_INTEGRATION_NAME } from "./delegate-detection";',
      ]);
    });
  });

  describe("no dispatch, relay, fallback, or orchestration", () => {
    it("detection never invokes manual transport or local executors", () => {
      const code = codeLines(CAPABILITY_SOURCE);
      for (const forbidden of ["renderAgentHandoff", "parseAgentHandoffText", "executeIndependent", "independent-execution", "manual"]) {
        assert.ok(!code.includes(forbidden), `capability code never mentions ${forbidden}`);
      }
    });

    it("unavailable capability performs no follow-up action", async () => {
      let detections = 0;
      const integration: Integration = {
        name: "delegate",
        capabilities: ["detect"],
        detect: () => {
          detections += 1;
          return { available: false, detail: "nothing installed" };
        },
      };
      const capability = await checkDelegateCapability({ integration, isEnabled: enabled });
      assert.equal(capability.ready, false);
      assert.equal(detections, 1, "no retry, no fallback probe");
      assert.deepEqual(Object.keys(capability).sort(), ["detail", "detected", "enabled", "name", "ready", "supportedDestinations"]);
    });

    it("adds no fallback, mode, retry, re-entry, or orchestration vocabulary", () => {
      const code = codeLines(CAPABILITY_SOURCE);
      for (const forbidden of ["fallback", "FAST", "STANDARD", "retry", "reentry", "re-enter", "orchestrat", "next-role", "mode"]) {
        assert.ok(!code.includes(forbidden), `capability code never mentions ${forbidden}`);
      }
    });
  });

  describe("security", () => {
    it("caller-held secrets never enter the capability result", async () => {
      const SECRET_TOKEN_SENTINEL = "SECRET_TOKEN_SENTINEL_9q2";
      const readFile = async (path: string): Promise<string> => {
        void SECRET_TOKEN_SENTINEL;
        if (path in SKILL_FILES) {
          return SKILL_FILES[path as keyof typeof SKILL_FILES];
        }
        throw missingError();
      };
      const capability = await checkDelegateCapability({
        integration: skillIntegration({ readFile }),
        isEnabled: enabled,
      });
      assert.equal(capability.ready, true);
      assert.ok(!JSON.stringify(capability).includes("SECRET_TOKEN_SENTINEL_9q2"));
    });

    it("result keys are pinned: no credential-shaped fields", async () => {
      const capability = await checkDelegateCapability({ integration: skillIntegration(), isEnabled: enabled });
      assert.deepEqual(Object.keys(capability).sort(), ["detail", "detected", "enabled", "name", "ready", "supportedDestinations"]);
    });

    it("detection errors carry diagnostics without caller secrets", async () => {
      const SECRET_TOKEN_SENTINEL = "SECRET_TOKEN_SENTINEL_9q2";
      void SECRET_TOKEN_SENTINEL;
      const capability = await checkDelegateCapability({
        integration: skillIntegration({
          readFile: async () => {
            throw new Error("EACCES on skill descriptor");
          },
        }),
        isEnabled: enabled,
      });
      assert.ok(capability.detail !== undefined && capability.detail.startsWith("detection failed:"));
      assert.ok(!JSON.stringify(capability).includes("SECRET_TOKEN_SENTINEL_9q2"));
    });
  });

  describe("determinism", () => {
    it("repeated checks with the same fakes produce equivalent results", async () => {
      const runOnce = () => checkDelegateCapability({ integration: skillIntegration(), isEnabled: enabled });
      assert.deepEqual(await runOnce(), await runOnce());
    });

    it("results carry no timestamps, paths, or execution metadata", async () => {
      const capability = await checkDelegateCapability({ integration: skillIntegration(), isEnabled: enabled });
      assert.ok(!JSON.stringify(capability).match(/20\d\d-\d\d-\d\d|tmp|random|uuid|session|receipt/i), "no hidden environment data");
    });
  });

  describe("multiple providers and status compatibility", () => {
    it("each configured skill is evaluated independently with no shared state", async () => {
      const first = await checkDelegateCapability({
        integration: skillIntegration({ skillName: "opencode-delegate" }),
        isEnabled: enabled,
      });
      const second = await checkDelegateCapability({
        integration: skillIntegration({ skillName: "other-delegate", readFile: fakeReader({}) }),
        isEnabled: enabled,
      });
      assert.equal(first.ready, true);
      assert.equal(second.ready, false);
      const again = await checkDelegateCapability({
        integration: skillIntegration({ skillName: "opencode-delegate" }),
        isEnabled: enabled,
      });
      assert.deepEqual(again, first, "no registry state leaks between calls");
    });

    it("capability states render through the existing status formatter", async () => {
      const capability = await checkDelegateCapability({ integration: skillIntegration(), isEnabled: enabled });
      const lines = formatIntegrationStatus([
        { name: capability.name, enabled: capability.enabled, detected: capability.detected, ready: capability.ready, detail: capability.detail },
      ]);
      assert.ok(lines.includes("delegate") && lines.includes("ready"));
      const off = await checkDelegateCapability({ integration: skillIntegration(), isEnabled: disabled });
      assert.ok(formatIntegrationStatus([{ name: off.name, enabled: off.enabled, detected: off.detected, ready: off.ready }]).includes("disabled"));
    });

    it("duplicate registration is impossible: one integration per fresh registry", async () => {
      const capability = await checkDelegateCapability({ integration: skillIntegration(), isEnabled: enabled });
      assert.equal(capability.name, "delegate");
    });
  });

  describe("core isolation", () => {
    it("dispatcher and adapter sources take no capability dependency", () => {
      for (const file of ["src/runtime/handoff-dispatcher.ts", "src/providers/delegate-handoff-transport.ts"]) {
        const code = codeLines(join(__dirname, "..", "..", file));
        assert.ok(!code.includes("delegate-capability") && !code.includes("checkDelegateCapability"), `${file} stays capability-free`);
      }
    });

    it("capability reuses the registry, detection, and status seams without duplicating them", () => {
      const code = codeLines(CAPABILITY_SOURCE);
      assert.ok(code.includes("createIntegrationRegistry"));
      assert.ok(code.includes("getIntegrationStatus"));
      assert.ok(!code.includes("new Map") && !code.includes("available: false"), "no parallel registry or status model");
    });

    it("no T-025 or later-milestone work is present", () => {
      const code = codeLines(CAPABILITY_SOURCE);
      for (const forbidden of ["fallback", "switch", "mode", "reentry", "orchestrat", "lifecycle", "chain"]) {
        assert.ok(!code.includes(forbidden), `capability code never mentions ${forbidden}`);
      }
    });
  });
});
