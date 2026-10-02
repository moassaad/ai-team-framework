/**
 * OpenCode ExecutionResult provider boundary (M18 R-005).
 *
 * The one concrete type mismatch in the M18 runtime path: the
 * existing OpenCode provider yields `AgentProvider<string>`
 * (raw process output, possibly empty on exit 0), while the
 * Coordinator execution seams require
 * `AgentProvider<ExecutionResult>`. This adapter bridges exactly
 * that gap and nothing more: one awaited call per `execute()`,
 * then the existing `executionResultFromText` normalization seam
 * maps the text onto the shared shape verbatim — no rewriting,
 * summarizing, classifying, or decision inference.
 *
 * Rejections propagate untouched (no catch, no retry, no
 * suppression); the Coordinator's established failure behavior
 * owns them. Empty or non-string resolutions — reachable
 * whenever the process exits 0 without output or an untyped
 * caller resolves garbage — fail with the existing bounded
 * result-contract error, never become success. No CLI
 * invocation, process handling, timeout, or environment logic
 * lives here: the wrapped provider owns all of that, and this
 * module never imports it (any `AgentProvider<string>` works;
 * OpenCode is simply the one that exists).
 */

import {
  AgentInvocation,
  AgentProvider,
  isAgentProvider,
  validateAgentInvocation,
} from "./agent";
import {
  ExecutionResult,
  executionResultFromText,
} from "./result";

function fail(what: string): never {
  throw new Error(`opencode execution provider: ${what}`);
}

/**
 * Adapt a string-yielding agent provider (such as the existing
 * OpenCode provider) to the generic execution-result contract.
 * Construction validates the wrapped provider only; every
 * `execute()` validates its invocation, awaits exactly one
 * underlying call, and normalizes the text.
 */
export function createOpenCodeExecutionProvider(
  agent: AgentProvider<string>,
): AgentProvider<ExecutionResult> {
  if (!isAgentProvider(agent)) {
    fail("agent must satisfy the agent provider contract");
  }
  return {
    name: `${agent.name}-execution`,
    execute: async (invocation: AgentInvocation): Promise<ExecutionResult> => {
      const validated = validateAgentInvocation(invocation);
      const text = await agent.execute(validated);
      return executionResultFromText(text);
    },
  };
}
