import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DELEGATE_RELAY_RESULT_SCHEMA,
  mapDelegateRelayResult,
} from "../src/providers/delegate-result";

// Relay-result mapping tests (D-105): pure fixtures only. No relay,
// filesystem, network, configuration, or workflow involvement — the
// mapper is a synchronous function of (document text, process exit).

const SCHEMA = "delegate-relay.result.v1";

function doc(fields: Record<string, unknown>): string {
  return JSON.stringify({ schema: SCHEMA, ...fields });
}

const COMPLETED = doc({
  status: "completed",
  exitCode: 0,
  tool: "opencode",
  finalMessage: "Export endpoint implemented; gates pass.",
  touchedFiles: ["src/routes/export.py"],
  sessionId: "ses_abc123",
});

describe("delegate relay result mapping", () => {
  it("maps completed results with full fields to the final report", () => {
    const result = mapDelegateRelayResult(COMPLETED, 0);
    assert.deepEqual(Object.keys(result).sort(), ["outcome"]);
    assert.equal(result.outcome, "Export endpoint implemented; gates pass.");
  });

  it("maps completed results without optional fields", () => {
    const result = mapDelegateRelayResult(doc({ status: "completed" }), 0);
    assert.equal(result.outcome, "completed with no final report (exit 0)");
  });

  it("fails failed results carrying the final message", () => {
    assert.throws(
      () => mapDelegateRelayResult(doc({ status: "failed", exitCode: 1, finalMessage: "auth lapse" }), 1),
      /relay reported "failed" \(exit 1\)/,
    );
  });

  it("fails timeout results with timeout detail", () => {
    assert.throws(
      () => mapDelegateRelayResult(doc({ status: "timeout", exitCode: 124 }), 124),
      /relay reported "timeout" \(exit 124\)/,
    );
  });

  it("fails aborted results with aborted detail", () => {
    assert.throws(
      () => mapDelegateRelayResult(doc({ status: "aborted", exitCode: 143 }), 143),
      /relay reported "aborted" \(exit 143\)/,
    );
  });

  it("fails implementer-unavailable results with unavailable detail", () => {
    assert.throws(
      () =>
        mapDelegateRelayResult(
          doc({ status: "opencode_unavailable", exitCode: 127 }),
          127,
        ),
      /relay reported "opencode_unavailable" \(exit 127\)/,
    );
  });

  it("fails unknown statuses with the status retained", () => {
    assert.throws(
      () => mapDelegateRelayResult(doc({ status: "frobnicated", exitCode: 3 }), 3),
      /relay reported "frobnicated" \(exit 3\)/,
    );
  });

  it("tolerates a missing schema and maps by status", () => {
    const result = mapDelegateRelayResult(
      JSON.stringify({ status: "completed", finalMessage: "Done." }),
      0,
    );
    assert.equal(result.outcome, "Done.");
  });

  it("rejects a wrong schema", () => {
    assert.throws(
      () => mapDelegateRelayResult(doc({ status: "completed" }).replace(SCHEMA, "other.v9"), 0),
      /unsupported result schema "other\.v9"/,
    );
  });

  it("fails a missing status as unknown", () => {
    assert.throws(
      () => mapDelegateRelayResult(doc({ exitCode: 0 }), 0),
      /relay reported "unknown" \(exit 0\)/,
    );
  });

  it("bounds empty or missing final reports on success", () => {
    for (const finalMessage of ["", null, 42]) {
      const result = mapDelegateRelayResult(
        doc({ status: "completed", exitCode: 0, finalMessage }),
        0,
      );
      assert.equal(result.outcome, "completed with no final report (exit 0)");
    }
  });

  it("keeps failed statuses failed when the exit code is zero", () => {
    assert.throws(
      () => mapDelegateRelayResult(doc({ status: "failed", exitCode: 0 }), 0),
      /relay reported "failed" \(exit 0\)/,
    );
  });

  it("keeps timeout failed when the exit code disagrees", () => {
    assert.throws(
      () => mapDelegateRelayResult(doc({ status: "timeout", exitCode: 0 }), 99),
      /relay reported "timeout" \(exit 99\)/,
    );
  });

  it("includes signal diagnostic detail when present", () => {
    assert.throws(
      () =>
        mapDelegateRelayResult(
          doc({ status: "failed", exitCode: 128, signal: "SIGKILL" }),
          128,
        ),
      /relay reported "failed" \(exit 128, signal SIGKILL\)/,
    );
    const without = (() => {
      try {
        mapDelegateRelayResult(doc({ status: "failed", exitCode: 1 }), 1);
        return "";
      } catch (error: unknown) {
        return errorMessage(error);
      }
    })();
    assert.ok(!without.includes("signal"), "no signal invented when absent");
  });

  it("tolerates touchedFiles in every documented shape", () => {
    for (const touchedFiles of [["a.py"], [], null]) {
      const result = mapDelegateRelayResult(
        doc({ status: "completed", exitCode: 0, finalMessage: "Done.", touchedFiles }),
        0,
      );
      assert.equal(result.outcome, "Done.");
      assert.deepEqual(Object.keys(result).sort(), ["outcome"], "nothing exposed");
    }
  });

  it("tolerates session IDs without exposing workflow state", () => {
    const first = mapDelegateRelayResult(COMPLETED, 0);
    const second = mapDelegateRelayResult(COMPLETED, 0);
    assert.deepEqual(first, second, "deterministic");
    assert.deepEqual(Object.keys(first).sort(), ["outcome"]);
    assert.ok(!JSON.stringify(first).includes("ses_abc123"), "session stays out");
  });

  it("never mutates its input and stays deterministic", () => {
    const before = COMPLETED;
    const first = mapDelegateRelayResult(before, 0);
    const second = mapDelegateRelayResult(before, 0);
    assert.equal(before, COMPLETED);
    assert.deepEqual(first, second);
  });

  it("rejects malformed documents safely", () => {
    for (const [raw, label] of [
      ["{oops", "unparseable"],
      ["[1,2]", "array"],
      ["null", "null"],
      ["42", "number"],
    ] as const) {
      assert.throws(
        () => mapDelegateRelayResult(raw, 7),
        /result\.json malformed \(relay exit 7\)/,
        label,
      );
    }
  });

  it("uses no I/O, time, environment, or configuration", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "providers", "delegate-result.ts"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]))];
    assert.deepEqual(importedModules.sort(), ["./delegate"], "contract import only");
    assert.ok(!/Date\.now|process\.|fs\.|child_process|fetch/.test(code), "pure mapping");
    assert.ok(!/commit|push|retry|fallback|review|config/i.test(code), "no adjacent behavior");
  });

  it("keeps the generic contract provider-neutral", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "providers", "delegate.ts"),
      "utf8",
    );
    assert.ok(!/relay|opencode|codex|status|touched/i.test(source), "contract unchanged");
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/delegate-result");
    assert.deepEqual(Object.keys(module).sort(), [
      "DELEGATE_RELAY_RESULT_SCHEMA",
      "mapDelegateRelayResult",
    ]);
    assert.equal(DELEGATE_RELAY_RESULT_SCHEMA, "delegate-relay.result.v1");
  });
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
