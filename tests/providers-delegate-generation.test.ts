import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DetectionResult, validateDetectionResult } from "../src/providers/integration";
import {
  DelegateProvider,
  DelegationRequest,
  DelegationResult,
  validateDelegationResult,
} from "../src/providers/delegate";
import { generateDelegateResult } from "../src/providers/delegate-generation";

// Delegate failure/fallback tests (D-106): injected fakes only. The
// composition under test has no process, filesystem, network, install,
// init, retry, config, or git seams at all, so isolation is structural.

interface Counts {
  detect: number;
  primary: number;
  fallback: number;
}

interface Seen {
  primary: DelegationRequest[];
  fallback: DelegationRequest[];
}

function fakePrimary(
  counts: Counts,
  seen: Seen,
  behavior: (request: DelegationRequest) => Promise<DelegationResult>,
): DelegateProvider {
  return {
    name: "fake-delegate",
    delegate: async (request) => {
      counts.primary += 1;
      seen.primary.push(request);
      return behavior(request);
    },
  };
}

function fakeFallback(counts: Counts, seen: Seen): DelegateProvider {
  return {
    name: "fake-fallback",
    delegate: async (request) => {
      counts.fallback += 1;
      seen.fallback.push(request);
      return validateDelegationResult({ outcome: `fallback for ${request.task}` });
    },
  };
}

function succeed(outcome: string) {
  return async (): Promise<DelegationResult> =>
    validateDelegationResult({ outcome });
}

function failWith(message: string) {
  return async (): Promise<DelegationResult> => {
    throw new Error(message);
  };
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
  delegateEnabled: boolean;
  requireDelegate: boolean;
  detectDelegate: () => Promise<DetectionResult>;
  primaryBehavior?: (request: DelegationRequest) => Promise<DelegationResult>;
  fallbackBehavior?: (request: DelegationRequest) => Promise<DelegationResult>;
  task?: string;
  context?: string;
}

async function runScenario(scenario: Scenario): Promise<{
  counts: Counts;
  seen: Seen;
  outcome: { ok: true; result: DelegationResult } | { ok: false; error: unknown };
}> {
  const counts: Counts = { detect: 0, primary: 0, fallback: 0 };
  const seen: Seen = { primary: [], fallback: [] };
  const detectDelegate = async (): Promise<DetectionResult> => {
    counts.detect += 1;
    return scenario.detectDelegate();
  };
  const primary = fakePrimary(counts, seen, scenario.primaryBehavior ?? succeed("delegated."));
  const fallbackBehavior = scenario.fallbackBehavior;
  const baseFallback = fakeFallback(counts, seen);
  const fallback: DelegateProvider =
    fallbackBehavior === undefined
      ? baseFallback
      : {
          name: "fake-fallback",
          delegate: async (request) => {
            counts.fallback += 1;
            seen.fallback.push(request);
            return fallbackBehavior(request);
          },
        };
  try {
    const result = await generateDelegateResult({
      request:
        scenario.context === undefined
          ? { task: scenario.task ?? "Do the thing." }
          : { task: scenario.task ?? "Do the thing.", context: scenario.context },
      delegateEnabled: scenario.delegateEnabled,
      requireDelegate: scenario.requireDelegate,
      detectDelegate,
      primary,
      fallback,
    });
    return { counts, seen, outcome: { ok: true, result } };
  } catch (error: unknown) {
    return { counts, seen, outcome: { ok: false, error } };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

describe("delegate failure and fallback", () => {
  it("disabled delegation never probes and uses fallback", async () => {
    const { counts, outcome } = await runScenario({
      delegateEnabled: false,
      requireDelegate: false,
      detectDelegate: () => {
        throw new Error("must not run");
      },
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.ok && outcome.result.outcome, "fallback for Do the thing.");
    assert.deepEqual(counts, { detect: 0, primary: 0, fallback: 1 });
  });

  it("disabled delegation with required delegation rejects without probing", async () => {
    const { counts, outcome } = await runScenario({
      delegateEnabled: false,
      requireDelegate: true,
      detectDelegate: () => {
        throw new Error("must not run");
      },
    });
    assert.equal(outcome.ok, false);
    assert.match(
      errorMessage(outcome.ok ? undefined : outcome.error),
      /explicitly required but disabled/,
    );
    assert.deepEqual(counts, { detect: 0, primary: 0, fallback: 0 });
  });

  it("enabled and available delegates successfully", async () => {
    const { counts, outcome } = await runScenario({
      delegateEnabled: true,
      requireDelegate: false,
      detectDelegate: detectedPresent(),
      primaryBehavior: succeed("Export endpoint implemented; gates pass."),
    });
    assert.equal(outcome.ok, true);
    assert.deepEqual(outcome.ok ? outcome.result : undefined, {
      outcome: "Export endpoint implemented; gates pass.",
    });
    assert.deepEqual(counts, { detect: 1, primary: 1, fallback: 0 });
  });

  it("enabled and unavailable with optional delegation uses fallback once", async () => {
    const { counts, outcome } = await runScenario({
      delegateEnabled: true,
      requireDelegate: false,
      detectDelegate: detectedAbsence('delegate skill "x" not installed (searched 2 locations)'),
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.ok && outcome.result.outcome, "fallback for Do the thing.");
    assert.deepEqual(counts, { detect: 1, primary: 0, fallback: 1 });
  });

  it("enabled and unavailable with required delegation rejects with the detail", async () => {
    const { counts, outcome } = await runScenario({
      delegateEnabled: true,
      requireDelegate: true,
      detectDelegate: detectedAbsence('implementer "opencode" not installed'),
    });
    assert.equal(outcome.ok, false);
    assert.match(
      errorMessage(outcome.ok ? undefined : outcome.error),
      /explicitly required but unavailable \(implementer "opencode" not installed\)/,
    );
    assert.deepEqual(counts, { detect: 1, primary: 0, fallback: 0 });
  });

  it("detection failure with optional delegation uses fallback", async () => {
    const { counts, outcome } = await runScenario({
      delegateEnabled: true,
      requireDelegate: false,
      detectDelegate: detectionFailure("probe exploded"),
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.ok && outcome.result.outcome, "fallback for Do the thing.");
    assert.deepEqual(counts, { detect: 1, primary: 0, fallback: 1 });
  });

  it("detection failure with required delegation rejects as detection failure", async () => {
    const { counts, outcome } = await runScenario({
      delegateEnabled: true,
      requireDelegate: true,
      detectDelegate: detectionFailure("probe exploded"),
    });
    assert.equal(outcome.ok, false);
    const message = errorMessage(outcome.ok ? undefined : outcome.error);
    assert.match(message, /explicitly required but detection failed/);
    assert.match(message, /probe exploded/);
    assert.deepEqual(counts, { detect: 1, primary: 0, fallback: 0 });
  });

  it("contract-breaking detection is a detection failure, not availability", async () => {
    for (const requireDelegate of [false, true]) {
      const { counts, outcome } = await runScenario({
        delegateEnabled: true,
        requireDelegate,
        detectDelegate: (async () => ({ available: "yes" })) as unknown as () => Promise<DetectionResult>,
      });
      assert.deepEqual(counts.detect, 1);
      if (!requireDelegate) {
        assert.equal(outcome.ok, true);
      } else {
        assert.equal(outcome.ok, false);
        assert.match(
          errorMessage(outcome.ok ? undefined : outcome.error),
          /detection failed.*result contract/,
        );
      }
    }
  });

  it("delegate failure with optional delegation falls back exactly once", async () => {
    const { counts, outcome } = await runScenario({
      delegateEnabled: true,
      requireDelegate: false,
      detectDelegate: detectedPresent(),
      primaryBehavior: failWith("delegate provider: relay failed to start (oops)"),
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.ok && outcome.result.outcome, "fallback for Do the thing.");
    assert.deepEqual(counts, { detect: 1, primary: 1, fallback: 1 });
  });

  it("delegate failure with required delegation propagates the original rejection", async () => {
    const { counts, outcome } = await runScenario({
      delegateEnabled: true,
      requireDelegate: true,
      detectDelegate: detectedPresent(),
      primaryBehavior: failWith('relay reported "timeout" (exit 124)'),
    });
    assert.equal(outcome.ok, false);
    assert.equal(
      errorMessage(outcome.ok ? undefined : outcome.error),
      'relay reported "timeout" (exit 124)',
    );
    assert.deepEqual(counts, { detect: 1, primary: 1, fallback: 0 });
  });

  it("fallback failure propagates", async () => {
    const { counts, outcome } = await runScenario({
      delegateEnabled: true,
      requireDelegate: false,
      detectDelegate: detectedPresent(),
      primaryBehavior: failWith("delegate down"),
      fallbackBehavior: failWith("fallback down"),
    });
    assert.equal(outcome.ok, false);
    assert.equal(errorMessage(outcome.ok ? undefined : outcome.error), "fallback down");
    assert.deepEqual(counts, { detect: 1, primary: 1, fallback: 1 });
  });

  it("calls detection exactly once and each provider at most once", async () => {
    const scenarios: Scenario[] = [
      { delegateEnabled: true, requireDelegate: false, detectDelegate: detectedPresent() },
      {
        delegateEnabled: true,
        requireDelegate: false,
        detectDelegate: detectedPresent(),
        primaryBehavior: failWith("down"),
      },
      {
        delegateEnabled: true,
        requireDelegate: false,
        detectDelegate: detectedAbsence("gone"),
      },
      {
        delegateEnabled: true,
        requireDelegate: false,
        detectDelegate: detectionFailure("boom"),
      },
    ];
    for (const scenario of scenarios) {
      const { counts } = await runScenario(scenario);
      assert.equal(counts.detect, 1, "detection exactly once");
      assert.ok(counts.primary <= 1, "delegate at most once");
      assert.ok(counts.fallback <= 1, "fallback at most once");
    }
  });

  it("preserves the original task and context for whichever provider runs", async () => {
    for (const primaryFails of [false, true]) {
      const { seen, outcome } = await runScenario({
        delegateEnabled: true,
        requireDelegate: false,
        detectDelegate: detectedPresent(),
        primaryBehavior: primaryFails
          ? failWith("down")
          : succeed("delegated with context."),
        task: "Migrate the export job.",
        context: "Repo root /proj; keep the CSV format.",
      });
      assert.equal(outcome.ok, true);
      const receiver = primaryFails ? seen.fallback : seen.primary;
      assert.equal(receiver.length, 1);
      assert.deepEqual(receiver[0], {
        task: "Migrate the export job.",
        context: "Repo root /proj; keep the CSV format.",
      });
    }
  });

  it("returns the delegate result unchanged and adds no upstream semantics", async () => {
    const delegated = validateDelegationResult({ outcome: "Done." });
    const { outcome } = await runScenario({
      delegateEnabled: true,
      requireDelegate: false,
      detectDelegate: detectedPresent(),
      primaryBehavior: async () => delegated,
    });
    assert.equal(outcome.ok, true);
    // Pass-through identity: D-106 post-processes nothing and adds no
    // session/touched-files/usage fields of its own. Field hygiene of
    // the upstream document itself belongs to D-104/D-105 validation.
    assert.deepEqual(outcome.ok ? outcome.result : undefined, { outcome: "Done." });
    assert.deepEqual(Object.keys(outcome.ok ? outcome.result : {}).sort(), ["outcome"]);
  });

  it("mutates no configuration and holds no state", async () => {
    const input = Object.freeze({
      request: Object.freeze({ task: "Do the thing." }),
      delegateEnabled: true,
      requireDelegate: false,
      detectDelegate: detectedPresent(),
      primary: {
        name: "p",
        delegate: async (request: DelegationRequest) => validateDelegationResult({ outcome: `p:${request.task}` }),
      },
      fallback: {
        name: "f",
        delegate: async (request: DelegationRequest) => validateDelegationResult({ outcome: `f:${request.task}` }),
      },
    });
    const before = JSON.stringify({ ...input, detectDelegate: "fn", primary: "p", fallback: "f" });
    const first = await generateDelegateResult(input);
    const second = await generateDelegateResult(input);
    assert.deepEqual(first, second, "deterministic");
    assert.deepEqual(
      JSON.stringify({ ...input, detectDelegate: "fn", primary: "p", fallback: "f" }),
      before,
      "input untouched",
    );
  });

  it("validates its input before invoking anything", async () => {
    const counts: Counts = { detect: 0, primary: 0, fallback: 0 };
    const seen: Seen = { primary: [], fallback: [] };
    const valid = {
      request: { task: "Do the thing." },
      delegateEnabled: true,
      requireDelegate: false,
      detectDelegate: detectedPresent(),
      primary: fakePrimary(counts, seen, succeed("x")),
      fallback: fakeFallback(counts, seen),
    };
    await assert.rejects(
      generateDelegateResult({ ...valid, request: { task: "" } }),
      /task must be a non-empty string/,
    );
    await assert.rejects(
      generateDelegateResult({ ...valid, delegateEnabled: "yes" as unknown as boolean }),
      /delegateEnabled must be a boolean/,
    );
    await assert.rejects(
      generateDelegateResult({
        ...valid,
        primary: { name: "broken" } as unknown as DelegateProvider,
      }),
      /primary must be a delegation provider/,
    );
    await assert.rejects(
      generateDelegateResult({
        ...valid,
        fallback: { name: "broken" } as unknown as DelegateProvider,
      }),
      /fallback must be a delegation provider/,
    );
    assert.deepEqual(counts, { detect: 0, primary: 0, fallback: 0 });
  });

  it("performs no installation, retry, git, or config work", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "providers", "delegate-generation.ts"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(importedModules.sort(), ["./delegate", "./integration"], "seam-only imports");
    assert.ok(!/npx|skills add|install|delegate-setup|upgrade/i.test(code), "no installation");
    assert.ok(!/retry|backoff|poll|setTimeout|setInterval/i.test(code), "no retry");
    assert.ok(!/child_process|spawn|exec|git|commit|push/i.test(code), "no git or processes");
    assert.ok(!/config|writeFile|readFile|mkdir/i.test(code), "no configuration or I/O");
    assert.ok(!/result\.json|relay\.mjs|touchedFiles|sessionId/i.test(code), "no upstream specifics");
  });

  it("leaves generic modules and upstream seams untouched", () => {
    const generation = readFileSync(
      join(__dirname, "..", "..", "src", "providers", "delegate-generation.ts"),
      "utf8",
    );
    assert.ok(!/createDelegateRelayProvider|mapDelegateRelayResult/.test(generation), "composes, never reimplements");
    for (const file of [
      "delegate.ts",
      "integration.ts",
      "integration-registry.ts",
      "integration-detection.ts",
      "integration-config.ts",
    ]) {
      const foundation = readFileSync(
        join(__dirname, "..", "..", "src", "providers", file),
        "utf8",
      );
      assert.ok(!/delegate-generation|generateDelegateResult/i.test(foundation), `${file} stays untouched`);
    }
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/delegate-generation");
    assert.deepEqual(Object.keys(module).sort(), ["generateDelegateResult"]);
  });
});
