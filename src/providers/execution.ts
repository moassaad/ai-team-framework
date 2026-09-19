/**
 * Provider execution handling (O-005).
 *
 * A provider-agnostic wrapper around `AgentProvider.execute` adding a
 * bounded timeout and safe failure normalization. Success passes the
 * O-004 `ExecutionResult` through untouched; timeout and provider
 * failures reject with `ProviderExecutionError`, never with workflow
 * states. Exactly one provider attempt per call, with no second
 * attempts and no delay-based rescheduling.
 *
 * Limitation: settling on timeout only settles the framework-level
 * promise. The `AgentProvider` contract offers no way to stop
 * underlying provider work from here.
 */

import { AgentInvocation, AgentProvider, validateAgentInvocation } from "./agent";
import { ExecutionResult } from "./result";

export type ExecutionFailureKind = "timeout" | "provider_error";

/** Failure marker. Carries only a kind and a fixed safe message. */
export class ProviderExecutionError extends Error {
  readonly kind: ExecutionFailureKind;

  constructor(kind: ExecutionFailureKind, message: string) {
    super(message);
    this.name = "ProviderExecutionError";
    this.kind = kind;
  }
}

export interface ExecutionOptions {
  /**
   * Bound for one execution attempt in milliseconds. Must be a
   * positive finite number. No default is imposed here; callers pass
   * the bound their context requires.
   */
  readonly timeout_ms: number;
}

function fail(what: string): never {
  throw new Error(`execution options: invalid options (${what})`);
}

/**
 * Validate raw data as execution options and return a frozen copy.
 * Rejects missing, non-numeric, non-finite, and non-positive timeouts.
 */
export function validateExecutionOptions(data: unknown): ExecutionOptions {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  if (typeof raw.timeout_ms !== "number" || !Number.isFinite(raw.timeout_ms) || raw.timeout_ms <= 0) {
    fail("timeout_ms must be a positive finite number");
  }
  return Object.freeze({ timeout_ms: raw.timeout_ms });
}

/**
 * Run one provider execution under a timeout. Resolves with the
 * provider's `ExecutionResult` on success. Rejects with
 * `ProviderExecutionError` (`timeout` after `timeout_ms`, or
 * `provider_error` when the provider rejects) using fixed messages
 * that carry no request content, output, or environment data. The
 * timer is always cleared once the call settles.
 */
export async function executeWithTimeout(
  provider: AgentProvider<ExecutionResult>,
  request: AgentInvocation,
  options: ExecutionOptions,
): Promise<ExecutionResult> {
  const config = validateExecutionOptions(options);
  const invocation = validateAgentInvocation(request);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<ExecutionResult>((resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new ProviderExecutionError(
            "timeout",
            `provider execution timed out after ${config.timeout_ms} ms`,
          ),
        );
      }, config.timeout_ms);
      provider.execute(invocation).then(
        (result) => resolve(result),
        () => reject(new ProviderExecutionError("provider_error", "provider execution failed")),
      );
    });
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
