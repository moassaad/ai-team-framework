/**
 * Implementer execution flow (IR-001).
 *
 * Composition only: a validated implementer ticket plus an
 * already-resolved specialty becomes a rendered Implementer prompt,
 * executed once through the injected generic provider under the O-005
 * bound. Success recommends the implementer-owned
 * `in_progress → implementation_review` edge (verified, never
 * performed); provider failures recommend no transition. No role
 * resolution, no prompt building, no transport, no second attempts,
 * no state mutation, no approval.
 */

import { AgentProvider, isAgentProvider } from "../providers/agent";
import { ExecutionFailureKind, ProviderExecutionError, executeWithTimeout } from "../providers/execution";
import { ExecutionResult } from "../providers/result";
import { renderRolePrompt } from "../providers/prompt";
import { IMPLEMENTER_ROLE } from "../roles/implementer";
import { ImplementerSpecialty, isImplementerSpecialty } from "../roles/contract";
import { isValidTransition } from "../workflow/transitions";

export interface ImplementerExecutionInput {
  /** Assigned ticket; shape-checked locally, planning contracts untouched. */
  readonly ticket: {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly requirements: string;
  };
  /** Already-resolved canonical specialty. Aliases rejected. */
  readonly specialty: ImplementerSpecialty;
  /** Target project root; becomes the provider working directory. */
  readonly project_root: string;
  /** Pre-computed discovery summary, when available. */
  readonly discovery_summary?: string;
  /** Injected generic provider. No detection, no selection. */
  readonly provider: AgentProvider<ExecutionResult>;
  /** Execution bound in milliseconds; owned by O-005 semantics. */
  readonly timeout_ms: number;
}

export interface ImplementerCompleted {
  readonly outcome: "completed";
  readonly ticket_id: string;
  readonly result: ExecutionResult;
  /** Verified implementer-owned edge; recommended, never performed here. */
  readonly next_state: "implementation_review";
}

export interface ImplementerFailed {
  readonly outcome: "failed";
  readonly ticket_id: string;
  readonly error: {
    readonly kind: ExecutionFailureKind;
    readonly message: string;
  };
  /** No transition recommended on provider failure. */
  readonly next_state: null;
}

export type ImplementerExecution = ImplementerCompleted | ImplementerFailed;

function fail(what: string): never {
  throw new Error(`implementer execution: invalid input (${what})`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

/**
 * Validate raw data as implementer input and return a frozen copy.
 * Checks ticket shape, canonical specialty, project root, injected
 * provider shape, and a positive finite timeout. Rejects aliases,
 * fuzzy input, and malformed providers without executing anything.
 */
export function validateImplementerInput(data: unknown): ImplementerExecutionInput {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  if (typeof raw.ticket !== "object" || raw.ticket === null) {
    fail("ticket must be an object");
  }
  const ticket = raw.ticket as Record<string, unknown>;
  const validatedTicket = {
    id: nonEmptyString(ticket.id, "ticket.id"),
    title: nonEmptyString(ticket.title, "ticket.title"),
    description: nonEmptyString(ticket.description, "ticket.description"),
    requirements: nonEmptyString(ticket.requirements, "ticket.requirements"),
  };
  if (!isImplementerSpecialty(raw.specialty)) {
    fail(`unknown specialty ${JSON.stringify(raw.specialty)}`);
  }
  const project_root = nonEmptyString(raw.project_root, "project_root");
  if (!isAgentProvider(raw.provider)) {
    fail("provider must satisfy the agent provider contract");
  }
  // Shape-checked above; the result type is upheld by the caller's
  // static provider type, as with every generic seam in this repo.
  const provider = raw.provider as AgentProvider<ExecutionResult>;
  if (typeof raw.timeout_ms !== "number" || !Number.isFinite(raw.timeout_ms) || raw.timeout_ms <= 0) {
    fail("timeout_ms must be a positive finite number");
  }
  const input: ImplementerExecutionInput = {
    ticket: Object.freeze(validatedTicket),
    specialty: raw.specialty,
    project_root,
    provider,
    timeout_ms: raw.timeout_ms,
  };
  if (raw.discovery_summary !== undefined) {
    (input as { discovery_summary?: string }).discovery_summary = nonEmptyString(
      raw.discovery_summary,
      "discovery_summary",
    );
  }
  return Object.freeze(input);
}

function taskText(ticket: ImplementerExecutionInput["ticket"]): string {
  return [
    `Ticket ${ticket.id}: ${ticket.title}`,
    "",
    ticket.description,
    "",
    "Requirements:",
    ticket.requirements,
  ].join("\n");
}

/**
 * Execute one assigned implementer ticket. Renders the canonical
 * Implementer prompt, runs it once through the injected provider under
 * the timeout bound, and returns the outcome. A single provider attempt
 * with no second attempts, no recovery, and no state changes.
 */
export async function executeImplementerTicket(
  input: ImplementerExecutionInput,
): Promise<ImplementerExecution> {
  const validated = validateImplementerInput(input);
  const prompt = renderRolePrompt({
    role: IMPLEMENTER_ROLE,
    specialty: validated.specialty,
    task: taskText(validated.ticket),
    project: { root: validated.project_root },
    ...(validated.discovery_summary !== undefined
      ? { discovery_summary: validated.discovery_summary }
      : {}),
  });
  try {
    const result = await executeWithTimeout(
      validated.provider,
      { prompt, project_root: validated.project_root },
      { timeout_ms: validated.timeout_ms },
    );
    if (!isValidTransition("in_progress", "implementation_review")) {
      throw new Error("implementer execution: submission edge is not a valid transition");
    }
    return Object.freeze({
      outcome: "completed",
      ticket_id: validated.ticket.id,
      result,
      next_state: "implementation_review",
    } as const);
  } catch (error) {
    if (error instanceof ProviderExecutionError) {
      return Object.freeze({
        outcome: "failed",
        ticket_id: validated.ticket.id,
        error: Object.freeze({ kind: error.kind, message: error.message }),
        next_state: null,
      } as const);
    }
    throw error;
  }
}
