/**
 * Shared execution result contract (O-004).
 *
 * The framework-level shape of a successful agent execution. Provider
 * agnostic: no transport, offering, or host concept appears here, and
 * raw provider output (such as a CLI's raw JSON event stream) is never
 * part of this contract. Failures stay promise rejections owned by O-005; this
 * module represents success only. No execution, no parsing, no policy.
 */

export const EXECUTION_STATUSES = ["succeeded"] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

/** True for supported execution statuses. */
export function isExecutionStatus(value: unknown): value is ExecutionStatus {
  return value === "succeeded";
}

export interface ExecutionResult {
  /** Outcome marker. Only success is representable; failure rejects. */
  readonly status: ExecutionStatus;
  /** Normalized agent response text. Never raw transport output. */
  readonly text: string;
}

function fail(what: string): never {
  throw new Error(`execution result: invalid result (${what})`);
}

/**
 * Validate raw data as an execution result and return a frozen copy.
 * Rejects malformed statuses, missing or empty text, and wrong types.
 * Unknown extra fields are ignored, never carried over.
 */
export function validateExecutionResult(data: unknown): ExecutionResult {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  if (!isExecutionStatus(raw.status)) {
    fail(`unknown status ${JSON.stringify(raw.status)}`);
  }
  if (typeof raw.text !== "string" || raw.text.length === 0) {
    fail("text must be a non-empty string");
  }
  return Object.freeze({ status: raw.status, text: raw.text });
}

/**
 * Build a result from raw provider output text. The only normalization
 * seam: providers map their own successful output onto the shared shape
 * (e.g. O-002's string migrates via this function). Validates like any
 * other result input.
 */
export function executionResultFromText(text: string): ExecutionResult {
  return validateExecutionResult({ status: "succeeded", text });
}
