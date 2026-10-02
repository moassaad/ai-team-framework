/**
 * Pure relay-result mapping (D-105).
 *
 * Interprets one `delegate-relay.result.v1` document as an AI Team
 * `DelegationResult` without touching the filesystem, processes,
 * configuration, or workflow state: same input always yields the same
 * output. Extracted from the D-104 execution path so the mapping is
 * explicit and independently testable; D-104 keeps owning launch,
 * file reads, timeouts, and cleanup, and calls this mapper for the
 * read text.
 *
 * Mapping rules (status is primary; the process exit code is only
 * supporting diagnostic context):
 *
 * ```text
 * completed + non-empty finalMessage → outcome is the report
 * completed + missing/empty report   → bounded no-report outcome
 * failed/timeout/aborted/<cli>_unavailable/unknown/missing status
 *                                    → bounded failure naming status
 *                                      (+ signal when present) and exit
 * schema present but different       → failure (contract drift)
 * schema/status/finalMessage absent  → tolerated unless required:
 *                                      missing status fails, everything
 *                                      else degrades per above
 * malformed (unparseable/non-object) → failure
 * ```
 *
 * Deliberately unmapped (tolerated, never exposed): `touchedFiles`
 * (no result field exists and none is added here), `sessionId` (no
 * session persistence, ever), `cost`, timing fields, artifact paths.
 * D-106 consumes completed-vs-failed through the existing
 * resolve/reject convention — no new status taxonomy.
 */

import {
  DelegationResult,
  validateDelegationResult,
} from "./delegate";

/** Result-format version this mapper understands. */
export const DELEGATE_RELAY_RESULT_SCHEMA = "delegate-relay.result.v1" as const;

function fail(what: string): never {
  throw new Error(`delegate provider: ${what}`);
}

/**
 * Map one relay result document to a framework result. `rawText` is
 * the exact `result.json` content; `exitCode` is the relay process
 * exit (null when killed) used only for diagnostic detail.
 * Success resolves; every other outcome rejects with a bounded
 * message. No I/O, no time, no environment, no configuration.
 */
export function mapDelegateRelayResult(
  rawText: string,
  exitCode: number | null,
): DelegationResult {
  if (typeof rawText !== "string") {
    fail(`result.json malformed (relay exit ${String(exitCode)})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    fail(`result.json malformed (relay exit ${String(exitCode)})`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    fail(`result.json malformed (relay exit ${String(exitCode)})`);
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.schema !== undefined &&
    record.schema !== DELEGATE_RELAY_RESULT_SCHEMA
  ) {
    fail(`unsupported result schema ${JSON.stringify(record.schema)}`);
  }
  const status = typeof record.status === "string" ? record.status : "";
  const signal =
    typeof record.signal === "string" && record.signal.length > 0
      ? record.signal
      : undefined;
  const context =
    signal === undefined
      ? `(exit ${String(exitCode)})`
      : `(exit ${String(exitCode)}, signal ${signal})`;
  if (status === "completed") {
    const finalMessage = record.finalMessage;
    const outcome =
      typeof finalMessage === "string" && finalMessage.length > 0
        ? finalMessage
        : `completed with no final report (exit ${String(exitCode)})`;
    return validateDelegationResult({ outcome });
  }
  fail(`relay reported "${status === "" ? "unknown" : status}" ${context}`);
}
