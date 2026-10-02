/**
 * Coordinator planning session (M23 T-006).
 *
 * The planning-side Coordinator capability, separate from the
 * ticket-execution runtime (`runCoordinatorTicket`, untouched):
 *
 *   user request (+ caller-structured planning content)
 *     → validate input and Coordinator identity
 *     → build the canonical Coordinator → Project Manager handoff
 *       from caller-supplied content only (Pattern B: the provider
 *       returns opaque text; nothing is parsed, classified, or
 *       extracted from its report — no structured-output contract
 *       exists anywhere in the repository, so none is invented)
 *     → validate and freeze the handoff (T-004)
 *     → invoke the Coordinator planning agent exactly once
 *     → return the bounded planning result
 *
 * No-invention boundary: every handoff field except the fixed
 * endpoints comes verbatim from the caller, who alone decides what
 * the user explicitly stated. The operation reorganizes nothing
 * beyond deterministic placement — request text into context,
 * explicit requirements into requirements, explicit constraints
 * into constraints, unresolved questions into notes. Unresolved
 * questions ride in `notes` — newline-joined verbatim, order
 * preserved — because it is the smallest existing field for bounded non-decision extras; they are never
 * requirements, never acceptance criteria, and never answered
 * here. The default next action restates the PM's
 * contract-established planning responsibility; it commands
 * nothing and invokes nobody — PM planning belongs to M23/T-007.
 *
 * One provider attempt, no retry, no fallback, no persistence, no
 * workflow states, no tickets, no orchestration. Stateless: one
 * invocation is one session; repeated calls with updated input are
 * the caller's concern.
 */

import { AgentHandoff } from "../roles/handoff";
import { validateAgentIdentity } from "../roles/identity";
import { validateAgentHandoff } from "../roles/handoff-validation";
import { COORDINATOR_ROLE } from "../roles/coordinator";
import { AgentProvider, isAgentProvider } from "../providers/agent";
import { ExecutionResult } from "../providers/result";
import { ProviderExecutionError, executeWithTimeout } from "../providers/execution";
import { renderRolePrompt } from "../providers/prompt";

/** Fixed next-action descriptor: the PM's own contract responsibility, commanding nothing. */
export const COORDINATOR_PLANNING_NEXT_ACTION =
  "Continue planning as Project Manager: establish requirements, scope, and acceptance criteria.";

export interface CoordinatorPlanningInput {
  /** Explicit Coordinator identity; every other role is rejected. */
  readonly identity: unknown;
  /** Raw user request, preserved verbatim. */
  readonly request: string;
  /** User's objective; falls back to the verbatim request when absent. */
  readonly objective?: string;
  /** Known context supplied by the user. */
  readonly context?: string;
  /** Requirements explicitly stated by the user — never inferred. */
  readonly requirements?: readonly string[];
  /** Constraints explicitly stated by the user — never inferred. */
  readonly constraints?: readonly string[];
  /** Unresolved questions for the user/PM — carried as handoff notes, never answered. */
  readonly questions?: readonly string[];
  /** Target project root; becomes the provider working directory. */
  readonly project_root: string;
  /** Caller-supplied generic provider. No detection, no selection. */
  readonly provider: AgentProvider<ExecutionResult>;
  /** Execution bound in milliseconds; owned by O-005 semantics. */
  readonly timeout_ms: number;
}

export interface CoordinatorPlanningCompleted {
  readonly outcome: "completed";
  readonly role: "coordinator";
  readonly handoff: AgentHandoff;
  /** Provider's planning text, verbatim and opaque. Never parsed. */
  readonly report: string;
}

export interface CoordinatorPlanningFailed {
  readonly outcome: "failed";
  readonly role: "coordinator";
  readonly error: { readonly kind: string; readonly message: string };
}

export type CoordinatorPlanningResult = CoordinatorPlanningCompleted | CoordinatorPlanningFailed;

function fail(what: string): never {
  throw new Error(`coordinator planning: ${what}`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return nonEmptyString(value, field);
}

function optionalTextList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${field} must be a non-empty string array when supplied`);
  }
  for (const entry of value) {
    nonEmptyString(entry, `${field} entry`);
  }
  return [...(value as string[])];
}

function planningTaskText(request: string, objective: string, context: string | undefined): string {
  return [
    "Coordinator planning session: understand the user request and prepare it for Project Manager planning.",
    "",
    `Objective: ${objective}`,
    "",
    `User request: ${request}`,
    ...(context !== undefined ? ["", `Known context: ${context}`] : []),
    "",
    "Establish nothing beyond what is stated above. Do not invent requirements, technology, acceptance criteria, or tasks.",
  ].join("\n");
}

/**
 * Run one Coordinator planning session. Validates identity (must
 * be `coordinator`) and input, builds the canonical PM handoff
 * from caller content only, validates it, invokes the provider
 * once with the planning prompt, and returns the frozen result.
 * Provider failure yields one bounded `failed` outcome; unexpected
 * programmer errors propagate. Never invokes PM, TL, Implementer,
 * or Reviewer; never touches tickets, states, or storage.
 */
export async function runCoordinatorPlanning(
  input: CoordinatorPlanningInput,
): Promise<CoordinatorPlanningResult> {
  if (typeof input !== "object" || input === null) {
    fail("expected a planning input object");
  }
  const identity = validateAgentIdentity(input.identity);
  if (identity.role !== "coordinator") {
    fail(`coordinator planning requires the coordinator identity, got ${JSON.stringify(identity.role)}`);
  }
  const request = nonEmptyString(input.request, "request");
  const objective = optionalText(input.objective, "objective") ?? request;
  const context = optionalText(input.context, "context");
  const requirements = optionalTextList(input.requirements, "requirements");
  const constraints = optionalTextList(input.constraints, "constraints");
  const questions = optionalTextList(input.questions, "questions");  const project_root = nonEmptyString(input.project_root, "project_root");
  if (!isAgentProvider(input.provider)) {
    fail("provider must satisfy the agent provider contract");
  }
  if (typeof input.timeout_ms !== "number" || !Number.isFinite(input.timeout_ms) || input.timeout_ms <= 0) {
    fail("timeout_ms must be a positive finite number");
  }

  const handoff = validateAgentHandoff({
    from: "coordinator",
    to: "project-manager",
    objective,
    context: context === undefined ? request : `${request}\n\n${context}`,
    ...(requirements !== undefined ? { requirements } : {}),
    ...(constraints !== undefined ? { constraints } : {}),
    ...(questions !== undefined ? { notes: questions.join("\n") } : {}),
    next_action: COORDINATOR_PLANNING_NEXT_ACTION,
  });

  const prompt = renderRolePrompt({
    role: COORDINATOR_ROLE,
    task: planningTaskText(request, objective, context),
    project: { root: project_root },
  });
  try {
    const result = await executeWithTimeout(
      input.provider,
      { prompt, project_root, role: "coordinator" },
      { timeout_ms: input.timeout_ms },
    );
    return Object.freeze({
      outcome: "completed",
      role: "coordinator",
      handoff,
      report: result.text,
    } as const);
  } catch (error) {
    if (error instanceof ProviderExecutionError) {
      return Object.freeze({
        outcome: "failed",
        role: "coordinator",
        error: Object.freeze({ kind: error.kind, message: error.message }),
      } as const);
    }
    throw error;
  }
}
