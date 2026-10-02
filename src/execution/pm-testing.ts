/**
 * PM / User Testing execution (M18 R-019).
 *
 * Composition only: bounded sprint evidence becomes a rendered
 * Project Manager prompt, executed once through the injected
 * generic provider under the O-005 bound. Success returns the
 * PM/User Testing report as opaque evidence for the explicit
 * decision boundary; no edge is PM-owned here, so no
 * transition is ever recommended — on success or on provider
 * failure. No ticket mutation, no correction tickets, no
 * approval, no second attempts. This seam performs no product
 * testing itself of any kind (no browsers, HTTP, UI
 * frameworks, fixtures, or environments); it bounds a
 * reviewer/provider plus an explicit decision source.
 */

import { AgentProvider, isAgentProvider } from "../providers/agent";
import { ExecutionFailureKind, ProviderExecutionError, executeWithTimeout } from "../providers/execution";
import { ExecutionResult } from "../providers/result";
import { renderRolePrompt } from "../providers/prompt";
import { PROJECT_MANAGER_ROLE } from "../roles/project-manager";
import { RoleId } from "../roles/contract";
import { WorkflowState, isWorkflowState } from "../workflow/states";

/**
 * Bounded sprint evidence for one ticket: identity, current
 * state, task context, and preserved feedback when the
 * runtime carries it. Current snapshot only — no history,
 * comments, logs, dumps, or provider metadata.
 */
export interface PmUserTestingTicketEvidence {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly requirements: string;
  readonly state: WorkflowState;
  readonly feedback?: string;
}

export interface PmUserTestingExecutionInput {
  /** Sprint evidence, shape-checked locally, planning contracts untouched. */
  readonly evidence: readonly PmUserTestingTicketEvidence[];
  /**
   * Explicit role identity from the validated PM reference
   * (R-019). Must be "project-manager": the seam stamps it
   * into the provider invocation. Never inferred; a mismatch
   * fails before any provider invocation. Senior Reviewer,
   * Technical Lead, and Implementer identities are rejected.
   */
  readonly role: RoleId;
  /** Target project root; becomes the provider working directory. */
  readonly project_root: string;
  /** Injected generic provider. No detection, no selection. */
  readonly provider: AgentProvider<ExecutionResult>;
  /** Execution bound in milliseconds; owned by O-005 semantics. */
  readonly timeout_ms: number;
}

export interface PmUserTestingCompleted {
  readonly outcome: "completed";
  readonly report: string;
}

export interface PmUserTestingFailed {
  readonly outcome: "failed";
  readonly error: {
    readonly kind: ExecutionFailureKind;
    readonly message: string;
  };
}

export type PmUserTestingExecution = PmUserTestingCompleted | PmUserTestingFailed;

function fail(what: string): never {
  throw new Error(`pm user testing execution: invalid input (${what})`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

function validateEvidence(data: unknown): PmUserTestingTicketEvidence {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("evidence entry must be an object");
  }
  const raw = data as Record<string, unknown>;
  const entry: { id: string; title: string; description: string; requirements: string; state: WorkflowState; feedback?: string } = {
    id: nonEmptyString(raw.id, "evidence.id"),
    title: nonEmptyString(raw.title, "evidence.title"),
    description: nonEmptyString(raw.description, "evidence.description"),
    requirements: nonEmptyString(raw.requirements, "evidence.requirements"),
    state: isWorkflowState(raw.state) ? raw.state : fail("evidence.state must be a workflow state"),
  };
  if (raw.feedback !== undefined) {
    entry.feedback = nonEmptyString(raw.feedback, "evidence.feedback");
  }
  return entry;
}

/**
 * Validate raw data as PM/User Testing input and return a
 * frozen copy. Checks evidence shape, exact PM role identity,
 * project root, injected provider shape, and a positive
 * finite timeout. Rejects mismatched roles and malformed
 * providers without executing anything.
 */
export function validatePmUserTestingInput(data: unknown): PmUserTestingExecutionInput {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  if (!Array.isArray(raw.evidence)) {
    fail("evidence must be an array");
  }
  const evidence = Object.freeze(raw.evidence.map(validateEvidence));
  if (raw.role !== "project-manager") {
    fail(`role must be "project-manager", got ${JSON.stringify(raw.role)}`);
  }
  const project_root = nonEmptyString(raw.project_root, "project_root");
  if (!isAgentProvider(raw.provider)) {
    fail("provider must satisfy the agent provider contract");
  }
  const provider = raw.provider as AgentProvider<ExecutionResult>;
  if (typeof raw.timeout_ms !== "number" || !Number.isFinite(raw.timeout_ms) || raw.timeout_ms <= 0) {
    fail("timeout_ms must be a positive finite number");
  }
  return Object.freeze({
    evidence,
    role: raw.role,
    project_root,
    provider,
    timeout_ms: raw.timeout_ms,
  });
}

function taskText(evidence: readonly PmUserTestingTicketEvidence[]): string {
  const lines = ["Sprint user testing: the Technical Lead has approved the sprint. Verify the implementation matches what was agreed.", ""];
  for (const entry of evidence) {
    lines.push(
      `Ticket ${entry.id}: ${entry.title} [${entry.state}]`,
      `Description: ${entry.description}`,
      `Requirements: ${entry.requirements}`,
      ...(entry.feedback !== undefined ? [`Reviewer notes: ${entry.feedback}`] : []),
      "",
    );
  }
  return lines.join("\n");
}

/**
 * Execute one PM/User Testing review. Renders the canonical
 * PM prompt, runs it once through the injected provider under
 * the timeout bound, and returns the outcome. A single
 * provider attempt with no second attempts, no recovery, no
 * mutation, and no state changes.
 */
export async function executePmUserTesting(
  input: PmUserTestingExecutionInput,
): Promise<PmUserTestingExecution> {
  const validated = validatePmUserTestingInput(input);
  const prompt = renderRolePrompt({
    role: PROJECT_MANAGER_ROLE,
    task: taskText(validated.evidence),
    project: { root: validated.project_root },
  });
  try {
    const result = await executeWithTimeout(
      validated.provider,
      { prompt, project_root: validated.project_root, role: validated.role },
      { timeout_ms: validated.timeout_ms },
    );
    return Object.freeze({
      outcome: "completed",
      report: result.text,
    } as const);
  } catch (error) {
    if (error instanceof ProviderExecutionError) {
      return Object.freeze({
        outcome: "failed",
        error: Object.freeze({ kind: error.kind, message: error.message }),
      } as const);
    }
    throw error;
  }
}
