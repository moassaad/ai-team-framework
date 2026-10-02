import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Integration } from "../src/providers/integration";
import { createIntegrationRegistry } from "../src/providers/integration-registry";
import { detectIntegration } from "../src/providers/integration-detection";

// Detection tests only: fresh detect() invocation through registry
// lookup with injected fakes. No configuration, installation,
// version lookup, or external access.
interface Calls {
  detect: number;
  install: number;
  configure: number;
  version: number;
}

function tracking(name: string, calls: Calls, detect: () => unknown): Integration {
  return {
    name,
    capabilities: ["detect", "version", "install", "configure"],
    detect: () => {
      calls.detect += 1;
      return detect() as never;
    },
    version: () => {
      calls.version += 1;
      return "1.0.0";
    },
    install: async () => {
      calls.install += 1;
    },
    configure: async () => {
      calls.configure += 1;
    },
  } as unknown as Integration;
}

function freshCalls(): Calls {
  return { detect: 0, install: 0, configure: 0, version: 0 };
}

function registered(name: string, calls: Calls, detect: () => unknown) {
  const registry = createIntegrationRegistry();
  registry.register(tracking(name, calls, detect));
  return registry;
}

describe("integration detection", () => {
  it("reports successful sync detection with the validated result", async () => {
    const calls = freshCalls();
    const outcome = await detectIntegration(
      registered("example", calls, () => ({ available: true })),
      "example",
    );
    assert.deepEqual(outcome, { status: "detected", result: { available: true } });
    assert.equal(calls.detect, 1);
  });

  it("reports successful async detection including detail", async () => {
    const calls = freshCalls();
    const outcome = await detectIntegration(
      registered("example", calls, async () => ({ available: true, detail: "found" })),
      "example",
    );
    assert.deepEqual(outcome, {
      status: "detected",
      result: { available: true, detail: "found" },
    });
  });

  it("reports unavailability as detection, not failure", async () => {
    const calls = freshCalls();
    const outcome = await detectIntegration(
      registered("example", calls, () => ({ available: false })),
      "example",
    );
    assert.deepEqual(outcome, { status: "detected", result: { available: false } });
  });

  it("reports throwing and rejecting detectors as failures, never success", async () => {
    const throwingCalls = freshCalls();
    const throwing = await detectIntegration(
      registered("example", throwingCalls, () => {
        throw new Error("probe exploded");
      }),
      "example",
    );
    assert.deepEqual(throwing, { status: "failed", error: "probe exploded" });

    const rejectingCalls = freshCalls();
    const rejecting = await detectIntegration(
      registered("example", rejectingCalls, async () => {
        throw new Error("async probe exploded");
      }),
      "example",
    );
    assert.deepEqual(rejecting, { status: "failed", error: "async probe exploded" });
    assert.ok(!("result" in rejecting), "no fabricated result on failure");
  });

  it("reports contract-violating detector output as failure", async () => {
    const calls = freshCalls();
    const outcome = await detectIntegration(
      registered("example", calls, () => ({ available: "yes", enabled: true })),
      "example",
    );
    assert.equal(outcome.status, "failed");
    if (outcome.status === "failed") {
      assert.match(outcome.error, /boolean available/);
    }
  });

  it("invokes only detect, never optional capabilities", async () => {
    const calls = freshCalls();
    const outcome = await detectIntegration(
      registered("example", calls, () => ({ available: true })),
      "example",
    );
    assert.equal(outcome.status, "detected");
    assert.deepEqual(calls, { detect: 1, install: 0, configure: 0, version: 0 });
  });

  it("works without optional capabilities declared", async () => {
    const registry = createIntegrationRegistry();
    let calls = 0;
    registry.register({
      name: "minimal",
      capabilities: ["detect"],
      detect: () => {
        calls += 1;
        return { available: true };
      },
    });
    assert.deepEqual(await detectIntegration(registry, "minimal"), {
      status: "detected",
      result: { available: true },
    });
    assert.equal(calls, 1);
  });

  it("performs fresh detection on every call without persisting results", async () => {
    const calls = freshCalls();
    let present = true;
    const registry = createIntegrationRegistry();
    registry.register(tracking("example", calls, () => ({ available: present })));
    assert.deepEqual(await detectIntegration(registry, "example"), {
      status: "detected",
      result: { available: true },
    });
    present = false;
    assert.deepEqual(await detectIntegration(registry, "example"), {
      status: "detected",
      result: { available: false },
    });
    assert.equal(calls.detect, 2);
  });

  it("leaves registry entries unmutated", async () => {
    const calls = freshCalls();
    const registry = registered("example", calls, () => ({ available: true }));
    const before = JSON.stringify(registry.get("example"));
    await detectIntegration(registry, "example");
    assert.equal(JSON.stringify(registry.get("example")), before);
  });

  it("throws for unknown or invalid identifiers and registries", async () => {
    const calls = freshCalls();
    const registry = registered("example", calls, () => ({ available: true }));
    await assert.rejects(
      detectIntegration(registry, "missing"),
      /integration detection: unknown integration "missing"/,
    );
    await assert.rejects(
      detectIntegration(registry, 7 as unknown as string),
      /integration detection: unknown integration 7/,
    );
    await assert.rejects(
      detectIntegration(null as unknown as Parameters<typeof detectIntegration>[0], "example"),
      /integration detection: expected an integration registry/,
    );
    assert.equal(calls.detect, 0);
  });

  it("stays independent from configuration, storage, and providers", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "providers", "integration-detection.ts"),
      "utf8",
    );
    const imports = [...source.matchAll(/from "(\.[^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(imports.sort(), ["./integration", "./integration-registry"]);
    assert.ok(!/\.install\(|\.configure\(|\.version\(/.test(source), "never touches optional capabilities");
    assert.ok(!/new Map|setTimeout|setInterval|writeFile|readFile/.test(source), "no storage, timers, or I/O");
    assert.ok(!/opencode|github|spec.?kit|delegate/i.test(source), "no provider-specific logic");
    assert.ok(!/enabl|config\.yaml|providers\./i.test(source), "no configuration coupling");
  });
});
