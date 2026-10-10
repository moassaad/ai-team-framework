/**
 * FAST Work Mode Path (M27 T-027).
 *
 * The minimal execution composition from the T-026 contract:
 *
 *   user ticket → Implementer → Senior Reviewer → terminal result
 *
 * Composition only, reusing existing seams without redesigning
 * them: `executeIndependentImplementer` once, then — only on
 * Implementer success — `executeIndependentSeniorReviewer`
 * once with explicitly selected fields (ticket plus the
 * implementation result text, never a whole-result spread),
 * then the caller-supplied `ReviewDecisionResolver` once
 * (validated by `validateReviewDecisionResolution`; reports
 * stay opaque, no text is parsed for decisions). Terminal
 * outcomes reuse existing vocabularies: `completed` on
 * `approved`, `changes-required` (feedback surfaced, no rework)
 * on `changes_requested`, `failed` on any Implementer,
 * Reviewer, or decision failure.
 *
 * Exclusions (all deliberate, all tested): no Coordinator, PM,
 * or TL in any form; no planning, artifact, approval,
 * decomposition, sprint, task, ticket-mapping, persistence, or
 * final-approval stages; no retry, fallback, alternate
 * transport, automatic re-entry, or local re-execution; no
 * handoff is invented (the path takes none and creates none —
 * reviewer input comes from explicit fields per the existing
 * contract). Delegation is neither enabled nor blocked here:
 * the path is provider-neutral and uses the injected provider
 * as supplied; dispatching would require the caller to select
 * a delegate transport, which this module never does.
 */

import { AgentProvider } from "../providers/agent";
import { ExecutionResult } from "../providers/result";
import { RoleId, ImplementerSpecialty } from "../roles/contract";
import { validateWorkMode } from "./work-mode";
import {
  executeIndependentImplementer,
  executeIndependentSeniorReviewer,
} from "../roles/independent-execution";
import { ImplementerCompleted } from "../execution/implementer";
import { ReviewerCompleted } from "../execution/reviewer";
import {
  ReviewDecisionResolver,
  isReviewDecisionResolver,
  validateReviewDecisionResolution,
} from "./review-decision";

export interface FastTicket {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly requirements: string;
}

export interface FastInput {
  /** Must validate to `"fast"` through the T-026 contract. */
  readonly mode: unknown;
  /** Actionable work item; the Implementer seam's existing ticket shape. */
  readonly ticket: FastTicket;
  /** Already-resolved canonical Implementer specialty. */
  readonly specialty: ImplementerSpecialty;
  /** Target project root for both role executions. */
  readonly project_root: string;
  /** Pre-computed discovery summary for the Implementer step only. */
  readonly discovery_summary?: string;
  /** Injected generic provider used by both steps, unmodified. */
  readonly provider: AgentProvider<ExecutionResult>;
  /** Explicit review decision, invoked exactly once on review completion. */
  readonly reviewDecision: ReviewDecisionResolver;
  /** Per-step execution bound in milliseconds; owned by O-005 semantics. */
  readonly timeout_ms: number;
}

export interface FastCompleted {
  readonly outcome: "completed";
  readonly mode: "fast";
  readonly ticket_id: string;
  readonly implementation: ImplementerCompleted;
  readonly review: ReviewerCompleted;
}

export interface FastChangesRequired {
  readonly outcome: "changes-required";
  readonly mode: "fast";
  readonly ticket_id: string;
  readonly implementation: ImplementerCompleted;
  readonly review: ReviewerCompleted;
  /** Resolver-supplied feedback, verbatim. */
  readonly feedback: string;
}

export interface FastFailed {
  readonly outcome: "failed";
  readonly mode: "fast";
  readonly ticket_id: string;
  /** Which step failed: implementer, reviewer, or the decision resolver. */
  readonly stage: "implementer" | "reviewer" | "decision";
  readonly error: { readonly kind: string; readonly message: string };
}

export type FastResult = FastCompleted | FastChangesRequired | FastFailed;

function fail(what: string): never {
  throw new Error(`fast path: ${what}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run one FAST composition: validate the mode (`"fast"` only)
 * and inputs, execute the Implementer once, stop on its
 * failure; execute the Senior Reviewer once with explicit
 * fields, stop on its failure; resolve the explicit review
 * decision once. No other role, stage, retry, or side effect.
 */
export async function runFast(input: FastInput): Promise<FastResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a fast input object");
  }
  const mode = validateWorkMode(input.mode);
  if (mode !== "fast") {
    fail(`runFast executes the fast mode only, got ${JSON.stringify(mode)}`);
  }
  if (!isReviewDecisionResolver(input.reviewDecision)) {
    fail("reviewDecision must be a review decision resolver function");
  }
  const ticket = input.ticket;
  const specialty = input.specialty;
  const project_root = input.project_root;
  const provider = input.provider;
  const timeout_ms = input.timeout_ms;

  const implementation = await executeIndependentImplementer({
    identity: { role: "implementer" as RoleId },
    input: {
      ticket,
      specialty,
      role: "implementer" as RoleId,
      project_root,
      ...(input.discovery_summary !== undefined ? { discovery_summary: input.discovery_summary } : {}),
      provider,
      timeout_ms,
    },
  });
  if (implementation.execution.outcome !== "completed") {
    return Object.freeze({
      outcome: "failed",
      mode: "fast",
      ticket_id: ticket.id,
      stage: "implementer",
      error: Object.freeze({ ...implementation.execution.error }),
    } as const);
  }
  const completed: ImplementerCompleted = implementation.execution;

  const review = await executeIndependentSeniorReviewer({
    identity: { role: "senior-reviewer" as RoleId },
    input: {
      ticket: { id: ticket.id, title: ticket.title, description: ticket.description, requirements: ticket.requirements },
      implementation_result: completed.result.text,
      role: "senior-reviewer" as RoleId,
      project_root,
      provider,
      timeout_ms,
    },
  });
  if (review.execution.outcome !== "completed") {
    return Object.freeze({
      outcome: "failed",
      mode: "fast",
      ticket_id: ticket.id,
      stage: "reviewer",
      error: Object.freeze({ ...review.execution.error }),
    } as const);
  }
  const report: ReviewerCompleted = review.execution;

  let resolution: { decision: string; feedback?: string };
  try {
    const decided = await input.reviewDecision({
      ticket_id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      requirements: ticket.requirements,
      report: report.report,
    });
    resolution = validateReviewDecisionResolution(decided, ticket.id) as { decision: string; feedback?: string };
  } catch (error: unknown) {
    return Object.freeze({
      outcome: "failed",
      mode: "fast",
      ticket_id: ticket.id,
      stage: "decision",
      error: Object.freeze({ kind: "decision-error", message: errorMessage(error) }),
    } as const);
  }
  if (resolution.decision === "approved") {
    return Object.freeze({
      outcome: "completed",
      mode: "fast",
      ticket_id: ticket.id,
      implementation: completed,
      review: report,
    } as const);
  }
  return Object.freeze({
    outcome: "changes-required",
    mode: "fast",
    ticket_id: ticket.id,
    implementation: completed,
    review: report,
    feedback: resolution.feedback as string,
  } as const);
}
