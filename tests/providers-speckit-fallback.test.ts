import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DetectionResult, validateDetectionResult } from "../src/providers/integration";
import {
  SpecificationArtifact,
  SpecificationProvider,
  validateSpecificationArtifact,
} from "../src/providers/specification";
import { createFallbackProvider } from "../src/providers/fallback";
import { generateSpecKitArtifact } from "../src/providers/speckit-fallback";
import { createIntegrationRegistry } from "../src/providers/integration-registry";
import { mapRequirementsToPlan } from "../src/planning/mapper";
import { generateTicketsFromPlan } from "../src/planning/tickets";
import { mapSpecKitFeatureToTickets } from "../src/providers/speckit-artifacts";

// Spec Kit failure/fallback tests (S-006): injected fakes only. The
// composition under test has no process, filesystem, network, install,
// init, retry, or config seams at all, so isolation is structural.

interface Counts {
  detect: number;
  primary: number;
  fallback: number;
}

function fakePrimary(
  counts: Counts,
  behavior: (request: {
    requirements: string;
    project_root: string;
    artifact: string;
  }) => Promise<SpecificationArtifact>,
): SpecificationProvider {
  return {
    name: "fake-spec-kit",
    generate: async (request) => {
      counts.primary += 1;
      return behavior(request);
    },
  };
}

function fakeFallback(counts: Counts): SpecificationProvider {
  return {
    name: "fake-fallback",
    generate: async (request) => {
      counts.fallback += 1;
      return validateSpecificationArtifact({
        artifact: request.artifact,
        content: `fallback for ${request.requirements}`,
      });
    },
  };
}

function succeed(text: string) {
  return async (request: { artifact: string }): Promise<SpecificationArtifact> =>
    validateSpecificationArtifact({ artifact: request.artifact, content: text });
}

function detectedAbsence(detail: string): () => Promise<DetectionResult> {
  return async () => validateDetectionResult({ available: false, detail });
}

function detectedPresent(): () => Promise<DetectionResult> {
  return async () => validateDetectionResult({ available: true });
}

function detectionFailure(message: string): () => Promise<DetectionResult> {
  return async () => {
    throw new Error(message);
  };
}

interface Scenario {
  specKitEnabled: boolean;
  requireSpecKit: boolean;
  detectSpecKit: () => Promise<DetectionResult>;
  primaryBehavior?: (request: {
    requirements: string;
    project_root: string;
    artifact: string;
  }) => Promise<SpecificationArtifact>;
  useRealFallback?: boolean;
}

async function runScenario(scenario: Scenario): Promise<{
  counts: Counts;
  outcome: { ok: true; artifact: SpecificationArtifact } | { ok: false; error: unknown };
}> {
  const counts: Counts = { detect: 0, primary: 0, fallback: 0 };
  const detectSpecKit = async (): Promise<DetectionResult> => {
    counts.detect += 1;
    return scenario.detectSpecKit();
  };
  const primary = fakePrimary(counts, scenario.primaryBehavior ?? succeed("# Spec Kit"));
  const fallback = scenario.useRealFallback === true ? undefined : fakeFallback(counts);
  if (scenario.useRealFallback === true) {
    const realFallback = createFallbackProvider();
    const wrapped: SpecificationProvider = {
      name: realFallback.name,
      generate: async (request) => {
        counts.fallback += 1;
        return realFallback.generate(request);
      },
    };
    try {
      const artifact = await generateSpecKitArtifact({
        requirements: "Build a shop.",
        project_root: "/proj",
        artifact: "plan",
        specKitEnabled: scenario.specKitEnabled,
        requireSpecKit: scenario.requireSpecKit,
        detectSpecKit,
        primary,
        fallback: wrapped,
      });
      return { counts, outcome: { ok: true, artifact } };
    } catch (error: unknown) {
      return { counts, outcome: { ok: false, error } };
    }
  }
  try {
    const artifact = await generateSpecKitArtifact({
      requirements: "Build a shop.",
      project_root: "/proj",
      artifact: "plan",
      specKitEnabled: scenario.specKitEnabled,
      requireSpecKit: scenario.requireSpecKit,
      detectSpecKit,
      primary,
      fallback,
    });
    return { counts, outcome: { ok: true, artifact } };
  } catch (error: unknown) {
    return { counts, outcome: { ok: false, error } };
  }
}

describe("spec kit failure and fallback", () => {
  it("falls back for generic operations when Spec Kit is unavailable", async () => {
    const { counts, outcome } = await runScenario({
      specKitEnabled: true,
      requireSpecKit: false,
      detectSpecKit: detectedAbsence("specify executable not available"),
    });
    assert.equal(outcome.ok, true);
    assert.equal(counts.detect, 1);
    assert.equal(counts.primary, 0, "unavailable path never invoked");
    assert.equal(counts.fallback, 1);
    assert.ok(
      outcome.ok && outcome.artifact.content.includes("fallback for Build a shop."),
    );
  });

  it("fails boundedly for explicitly required operations when unavailable", async () => {
    const { counts, outcome } = await runScenario({
      specKitEnabled: true,
      requireSpecKit: true,
      detectSpecKit: detectedAbsence("specify executable not available"),
    });
    assert.equal(outcome.ok, false);
    assert.equal(counts.primary, 0);
    assert.equal(counts.fallback, 0, "no silent fallback");
    assert.match(
      String(!outcome.ok && outcome.error),
      /explicitly required for plan generation but unavailable \(specify executable not available\)/,
    );
  });

  it("never invokes Spec Kit when disabled, falling back for generic use", async () => {
    const { counts, outcome } = await runScenario({
      specKitEnabled: false,
      requireSpecKit: false,
      detectSpecKit: () => {
        throw new Error("detection must not run");
      },
    });
    assert.equal(outcome.ok, true);
    assert.deepEqual(counts, { detect: 0, primary: 0, fallback: 1 });
  });

  it("fails disabled-but-required operations without touching Spec Kit", async () => {
    const { counts, outcome } = await runScenario({
      specKitEnabled: false,
      requireSpecKit: true,
      detectSpecKit: () => {
        throw new Error("detection must not run");
      },
    });
    assert.equal(outcome.ok, false);
    assert.deepEqual(counts, { detect: 0, primary: 0, fallback: 0 });
    assert.match(
      String(!outcome.ok && outcome.error),
      /explicitly required for plan generation but disabled/,
    );
  });

  it("falls back on detection failure without fabricating success", async () => {
    const { counts, outcome } = await runScenario({
      specKitEnabled: true,
      requireSpecKit: false,
      detectSpecKit: detectionFailure("project integration state is not valid JSON"),
    });
    assert.equal(outcome.ok, true);
    assert.equal(counts.primary, 0);
    assert.equal(counts.fallback, 1);
    assert.ok(outcome.ok && !outcome.artifact.content.includes("Spec Kit"));
  });

  it("fails required operations on detection failure with the cause preserved", async () => {
    const { outcome } = await runScenario({
      specKitEnabled: true,
      requireSpecKit: true,
      detectSpecKit: detectionFailure("project integration state is not valid JSON"),
    });
    assert.equal(outcome.ok, false);
    assert.match(
      String(!outcome.ok && outcome.error),
      /explicitly required for plan generation but detection failed \(.*not valid JSON\)/,
    );
  });

  it("keeps absence distinct from failure", async () => {
    const absence = await runScenario({
      specKitEnabled: true,
      requireSpecKit: true,
      detectSpecKit: detectedAbsence("project is not initialized as a Spec Kit project"),
    });
    const failure = await runScenario({
      specKitEnabled: true,
      requireSpecKit: true,
      detectSpecKit: detectionFailure("probe exploded"),
    });
    assert.equal(absence.outcome.ok, false);
    assert.equal(failure.outcome.ok, false);
    assert.match(String(!absence.outcome.ok && absence.outcome.error), /but unavailable \(/);
    assert.ok(!/detection failed/.test(String(!absence.outcome.ok && absence.outcome.error)));
    assert.match(String(!failure.outcome.ok && failure.outcome.error), /but detection failed \(/);
    assert.ok(!/but unavailable/.test(String(!failure.outcome.ok && failure.outcome.error)));
  });

  it("falls back once when the available primary fails, without retry", async () => {
    const { counts, outcome } = await runScenario({
      specKitEnabled: true,
      requireSpecKit: false,
      detectSpecKit: detectedPresent(),
      primaryBehavior: async () => {
        throw new Error("agent exploded");
      },
    });
    assert.equal(outcome.ok, true);
    assert.equal(counts.primary, 1, "single attempt, no retry");
    assert.equal(counts.fallback, 1);
  });

  it("propagates the primary rejection identically for required operations", async () => {
    const original = new Error("agent exploded");
    const { counts, outcome } = await runScenario({
      specKitEnabled: true,
      requireSpecKit: true,
      detectSpecKit: detectedPresent(),
      primaryBehavior: async () => {
        throw original;
      },
    });
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.error, original);
    assert.equal(counts.fallback, 0);
  });

  it("uses the primary path untouched when Spec Kit is healthy", async () => {
    const { counts, outcome } = await runScenario({
      specKitEnabled: true,
      requireSpecKit: false,
      detectSpecKit: detectedPresent(),
    });
    assert.equal(outcome.ok, true);
    assert.deepEqual(counts, { detect: 1, primary: 1, fallback: 0 });
    assert.ok(outcome.ok && outcome.artifact.content.includes("# Spec Kit"));
  });

  it("treats contract-breaking detection as detection failure", async () => {
    const { counts, outcome } = await runScenario({
      specKitEnabled: true,
      requireSpecKit: false,
      detectSpecKit: (async () => ({ available: "yes" }) as unknown as DetectionResult),
    });
    assert.equal(outcome.ok, true);
    assert.equal(counts.fallback, 1, "never trusted as available");
  });

  it("leaves mapping failure all-or-nothing with planning still available", () => {
    assert.throws(
      () =>
        mapSpecKitFeatureToTickets({
          requirements: "Build a shop.",
          tasksMd: "# Tasks: empty\n\nNo entries here.\n",
        }),
      /no actionable tasks/,
    );
    const fallbackArtifact = validateSpecificationArtifact({
      artifact: "plan",
      content: "# Plan\n\nFallback plan.",
    });
    const plan = mapRequirementsToPlan({
      requirements: "Build a shop.",
      artifact: fallbackArtifact,
    });
    const tickets = generateTicketsFromPlan(plan);
    assert.ok(tickets.length > 0, "framework planning remains available");
  });

  it("performs no installation, initialization, retry, or persistence", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "providers", "speckit-fallback.ts"),
      "utf8",
    );
    const importedModules = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(
      importedModules.sort(),
      ["./fallback", "./integration", "./specification"],
      "composition-only imports",
    );
    assert.ok(!/child_process|spawn|exec|fetch|http/i.test(source), "no process or network");
    assert.ok(!/writeFile|mkdir\(|mkdirSync|unlink|rmdir|\.store\(|persist\(/.test(source), "no persistence");
    assert.ok(!/install\(\)|initSpecKit|retry|backoff|setTimeout|setInterval/i.test(source), "no recovery machinery");
    assert.ok(!/FrameworkConfig|isIntegrationEnabled|providers\./.test(source), "no config coupling");
    assert.ok(!/specify integration|specify init|uv |pipx/.test(source), "no Spec Kit commands");
  });

  it("leaves configuration, registry, and inputs untouched across failures", async () => {
    const registry = createIntegrationRegistry();
    registry.register({
      name: "spec-kit",
      capabilities: ["detect"],
      detect: () => ({ available: false }),
    } as unknown as Parameters<typeof registry.register>[0]);
    const before = JSON.stringify(registry.list().map((entry) => entry.name));
    for (const requireSpecKit of [false, true]) {
      await runScenario({
        specKitEnabled: true,
        requireSpecKit,
        detectSpecKit: detectionFailure("probe exploded"),
      });
    }
    assert.equal(JSON.stringify(registry.list().map((entry) => entry.name)), before);
    assert.notEqual(registry.get("spec-kit"), undefined);
  });

  it("keeps the fallback provider generic and the foundation Spec Kit-free", () => {
    const fallbackSource = readFileSync(
      join(__dirname, "..", "..", "src", "providers", "fallback.ts"),
      "utf8",
    );
    assert.ok(!/spec-kit|speckit|specify/i.test(fallbackSource), "fallback stays neutral");
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
      assert.ok(!/spec-kit|speckit|specify/i.test(foundation), `${file} stays generic`);
    }
  });

  it("operates without Spec Kit for both artifact kinds", async () => {
    for (const artifact of ["specification", "plan"] as const) {
      const counts: Counts = { detect: 0, primary: 0, fallback: 0 };
      const result = await generateSpecKitArtifact({
        requirements: "Build a shop.",
        project_root: "/proj",
        artifact,
        specKitEnabled: false,
        requireSpecKit: false,
        detectSpecKit: () => {
          throw new Error("must not run");
        },
        primary: fakePrimary(counts, succeed("# S")),
        fallback: fakeFallback(counts),
      });
      assert.equal(result.artifact, artifact);
      assert.deepEqual(counts, { detect: 0, primary: 0, fallback: 1 });
    }
  });

  it("validates its input before invoking anything", async () => {
    const counts: Counts = { detect: 0, primary: 0, fallback: 0 };
    await assert.rejects(
      generateSpecKitArtifact({
        requirements: "",
        project_root: "/proj",
        artifact: "plan",
        specKitEnabled: true,
        requireSpecKit: false,
        detectSpecKit: detectedPresent(),
        primary: fakePrimary(counts, succeed("# S")),
      }),
      /requirements must be a non-empty string/,
    );
    await assert.rejects(
      generateSpecKitArtifact({
        requirements: "Build.",
        project_root: "/proj",
        artifact: "plan",
        specKitEnabled: "yes" as unknown as boolean,
        requireSpecKit: false,
        detectSpecKit: detectedPresent(),
        primary: fakePrimary(counts, succeed("# S")),
      }),
      /specKitEnabled must be a boolean/,
    );
    assert.deepEqual(counts, { detect: 0, primary: 0, fallback: 0 });
  });

  it("uses the real P-005 fallback by default", async () => {
    const { counts, outcome } = await runScenario({
      specKitEnabled: true,
      requireSpecKit: false,
      detectSpecKit: detectedAbsence("specify executable not available"),
      useRealFallback: true,
    });
    assert.equal(outcome.ok, true);
    assert.equal(counts.fallback, 1);
    assert.ok(
      outcome.ok && outcome.artifact.content.includes("framework fallback provider"),
    );
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/speckit-fallback");
    assert.deepEqual(Object.keys(module).sort(), ["generateSpecKitArtifact"]);
  });
});
