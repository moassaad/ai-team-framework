/**
 * Generic agent provider contract (O-001).
 *
 * The stable seam between the core framework and any external execution
 * system (providers.md §1). Core code depends only on this module; every
 * integration lives behind it. O-002 provides the first implementation,
 * O-003 builds prompts, O-004 defines the execution result shape, and
 * O-005 handles failure behavior — none of that lives here.
 *
 * This module performs no I/O, starts no processes, contacts nothing, stores
 * no provider list, and names no external tool, transport, or offering.
 */

export interface AgentInvocation {
  /**
   * Prepared instructions to execute. Opaque to the provider: prompt
   * construction belongs to O-003, this contract only carries the
   * finished text.
   */
  readonly prompt: string;
  /**
   * Target project the invocation is bounded to (providers.md §2:
   * "execute a role within a bounded context"). A filesystem path to
   * the project root; never the framework workspace.
   */
  readonly project_root: string;
}

function fail(what: string): never {
  throw new Error(`agent provider: invalid invocation (${what})`);
}

/**
 * Validate raw data as an agent invocation and return a frozen copy.
 * Rejects missing or empty `prompt`/`project_root` and wrong types.
 * Says nothing about any provider or external system.
 */
export function validateAgentInvocation(data: unknown): AgentInvocation {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  if (typeof raw.prompt !== "string" || raw.prompt.length === 0) {
    fail("prompt must be a non-empty string");
  }
  if (typeof raw.project_root !== "string" || raw.project_root.length === 0) {
    fail("project_root must be a non-empty string");
  }
  return Object.freeze({ prompt: raw.prompt, project_root: raw.project_root });
}

/**
 * Generic execution boundary. Implementations accept an already-prepared
 * invocation and return whatever their documented outcome shape is; the
 * shared outcome shape itself belongs to O-004, so the outcome type
 * stays a parameter here. `name` is the stable provider identifier.
 */
export interface AgentProvider<TResult = unknown> {
  readonly name: string;
  execute(request: AgentInvocation): Promise<TResult>;
}

/** True for values shaped like an agent provider: a named object with an async-capable `execute`. */
export function isAgentProvider(value: unknown): value is AgentProvider {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    typeof candidate.execute === "function"
  );
}
