/**
 * Full sprint orchestration skeleton (M19 E2E-001).
 *
 * One generic function connecting the M18 runtime boundaries
 * into a single deterministic traversal over the caller's
 * ticket collection:
 *
 * ```text
 * runCoordinatorTicket (one ticket at most)
 *    ↓ completed / no-work
 * evaluateSprintCompletion
 *    ↓ readyForTechnicalLeadReview
 * runTechnicalLeadReview (once)
 *    ↓ approved
 * createTechnicalLeadCorrectionTicket on corrections-required (once, then stop)
 *    ↓ approved
 * runPmUserTestingReview (once)
 *    ↓ approved
 * runFinalApproval (once)
 *    ↓ approved → completed
 * ```
 *
 * Orchestration only: every stage owns its semantics, and
 * this module duplicates none of them. Routing reads
 * explicit result-level outcomes (`outcome === ...`) — never
 * ticket text, report text, issue existence, or provider
 * behavior. One call means one traversal: a single
 * Coordinator invocation (no drain loop, no batching, no
 * parallelism), at most one invocation per later stage, and
 * no retries, fallbacks, or re-entry anywhere. A caller may
 * invoke again explicitly with a fresh snapshot.
 *
 * Conservative by design: the orchestrator performs no
 * direct state mutation (the Coordinator-selected ticket
 * advances only through the existing Coordinator
 * semantics), creates nothing except through R-018, calls
 * no sink, closes nothing, and stops — with the stage and
 * its bounded child result — at the first non-advancing
 * outcome. Synchronization of final approval into ticket
 * states belongs to later E2E work, never to this skeleton.
 */

import { IssueProvider, isIssueProvider } from "../providers/issue";
import {
  CoordinatorTicket,
  CoordinatorTicketResult,
  isTicket,
  runCoordinatorTicket,
} from "./coordinator";
import {
  RoleResolver,
  TechnicalLeadRoleReference,
  ProjectManagerRoleReference,
  CoordinatorApprovalReference,
  isRoleResolver,
  validateTechnicalLeadReference,
  validateProjectManagerReference,
  validateCoordinatorApprovalReference,
} from "./roles";
import { ReviewDecisionResolver, isReviewDecisionResolver } from "./review-decision";
import { SprintCompletionResult, evaluateSprintCompletion } from "./sprint";
import {
  TechnicalLeadDecisionResolver,
  TechnicalLeadReviewResult,
  isTechnicalLeadDecisionResolver,
  runTechnicalLeadReview,
} from "./technical-lead";
import {
  TechnicalLeadCorrectionResult,
  createTechnicalLeadCorrectionTicket,
} from "./corrections";
import {
  PmUserTestingDecisionResolver,
  PmUserTestingReviewResult,
  isPmUserTestingDecisionResolver,
  runPmUserTestingReview,
} from "./pm-testing";
import {
  FinalApprovalDecisionResolver,
  FinalApprovalResult,
  isFinalApprovalDecisionResolver,
  runFinalApproval,
} from "./final-approval";

export interface SprintWorkflowInput {
  /** Caller-owned sprint ticket collection; stages may advance the selected ticket only. */
  readonly tickets: CoordinatorTicket[];
  /** Explicit Coordinator role resolution (Implementer + Senior Reviewer). */
  readonly roles: RoleResolver;
  /** Explicit Technical Lead reference. */
  readonly technicalLead: TechnicalLeadRoleReference;
  /** Explicit PM/User Testing reference. */
  readonly projectManager: ProjectManagerRoleReference;
  /** Explicit final Coordinator approval authority. */
  readonly coordinatorApproval: CoordinatorApprovalReference;
  /** Explicit issue tracker for correction creation only. */
  readonly issues: IssueProvider;
  /** Target project root shared by all provider invocations. */
  readonly project_root: string;
  /** Execution bound in milliseconds shared by all stages. */
  readonly timeout_ms: number;
  /** Senior Reviewer verdict resolver for the Coordinator call. */
  readonly decideReview: ReviewDecisionResolver;
  /** Technical Lead decision resolver. */
  readonly decideTechnicalLead: TechnicalLeadDecisionResolver;
  /** PM/User Testing decision resolver. */
  readonly decidePmUserTesting: PmUserTestingDecisionResolver;
  /** Final Coordinator decision resolver. */
  readonly decideFinalApproval: FinalApprovalDecisionResolver;
  /** Pre-computed discovery summary for the Coordinator call, when available. */
  readonly discovery_summary?: string;
}

export interface SprintWorkflowCompleted {
  readonly outcome: "completed";
  readonly ticket_ids: readonly string[];
  readonly finalApproval: FinalApprovalResult & { outcome: "approved" };
}

export interface SprintWorkflowWorkRemaining {
  readonly outcome: "work-remaining";
  readonly evaluation: SprintCompletionResult;
}

export interface SprintWorkflowFailed {
  readonly outcome: "failed";
  readonly coordinator: CoordinatorTicketResult;
}

export interface SprintWorkflowTechnicalLeadNotReady {
  readonly outcome: "technical-lead-not-ready";
  readonly technicalLead: TechnicalLeadReviewResult;
}

export interface SprintWorkflowCorrectionsRequired {
  readonly outcome: "technical-lead-corrections-required";
  readonly correction: TechnicalLeadCorrectionResult & { outcome: "created" };
}

export interface SprintWorkflowCorrectionFailed {
  readonly outcome: "correction-creation-failed";
  readonly correction: TechnicalLeadCorrectionResult;
}

export interface SprintWorkflowPmNotReady {
  readonly outcome: "pm-not-ready";
  readonly pmReview: PmUserTestingReviewResult;
}

export interface SprintWorkflowPmChangesRequired {
  readonly outcome: "pm-changes-required";
  readonly pmReview: PmUserTestingReviewResult;
}

export interface SprintWorkflowFinalNotReady {
  readonly outcome: "final-approval-not-ready";
  readonly finalApproval: FinalApprovalResult;
}

export interface SprintWorkflowFinalRejected {
  readonly outcome: "final-approval-rejected";
  readonly finalApproval: FinalApprovalResult;
}

export type SprintWorkflowResult =
  | SprintWorkflowCompleted
  | SprintWorkflowWorkRemaining
  | SprintWorkflowFailed
  | SprintWorkflowTechnicalLeadNotReady
  | SprintWorkflowCorrectionsRequired
  | SprintWorkflowCorrectionFailed
  | SprintWorkflowPmNotReady
  | SprintWorkflowPmChangesRequired
  | SprintWorkflowFinalNotReady
  | SprintWorkflowFinalRejected;

function fail(what: string): never {
  throw new Error(`sprint workflow: ${what}`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

function ticketIds(tickets: readonly CoordinatorTicket[]): readonly string[] {
  return Object.freeze(tickets.map((ticket) => ticket.id));
}

/**
 * Run one full sprint traversal: a single Coordinator ticket
 * invocation, then the sprint gate, TL review, correction
 * creation on demand, PM review, and final approval — each
 * at most once, each routed on its explicit outcome, stopping
 * at the first non-advancing stage. All dependencies arrive
 * explicitly; nothing is read, discovered, defaulted,
 * retried, or run in parallel.
 */
export async function runSprintWorkflow(
  input: SprintWorkflowInput,
): Promise<SprintWorkflowResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a workflow input object");
  }
  if (!Array.isArray(input.tickets)) {
    fail("tickets must be an array");
  }
  for (const ticket of input.tickets) {
    if (!isTicket(ticket)) {
      fail("every ticket must carry id, title, description, requirements, and a valid state");
    }
  }
  if (!isRoleResolver(input.roles)) {
    fail("roles must satisfy the role resolver contract");
  }
  const technicalLeadRef = validateTechnicalLeadReference(input.technicalLead);
  const projectManagerRef = validateProjectManagerReference(input.projectManager);
  try {
    validateCoordinatorApprovalReference(input.coordinatorApproval);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (!isIssueProvider(input.issues)) {
    fail("issues must satisfy the issue provider contract");
  }
  const project_root = nonEmptyString(input.project_root, "project_root");
  if (typeof input.timeout_ms !== "number" || !Number.isFinite(input.timeout_ms) || input.timeout_ms <= 0) {
    fail("timeout_ms must be a positive finite number");
  }
  if (!isReviewDecisionResolver(input.decideReview)) {
    fail("decideReview must be a review decision resolver");
  }
  if (!isTechnicalLeadDecisionResolver(input.decideTechnicalLead)) {
    fail("decideTechnicalLead must be a technical lead decision resolver");
  }
  if (!isPmUserTestingDecisionResolver(input.decidePmUserTesting)) {
    fail("decidePmUserTesting must be a pm user testing decision resolver");
  }
  if (!isFinalApprovalDecisionResolver(input.decideFinalApproval)) {
    fail("decideFinalApproval must be a final approval decision resolver");
  }
  let discovery_summary: string | undefined;
  if (input.discovery_summary !== undefined) {
    discovery_summary = nonEmptyString(input.discovery_summary, "discovery_summary");
  }
  const ids = ticketIds(input.tickets);

  const coordinated = await runCoordinatorTicket({
    tickets: input.tickets,
    roles: input.roles,
    project_root,
    timeout_ms: input.timeout_ms,
    decideReview: input.decideReview,
    ...(discovery_summary !== undefined ? { discovery_summary } : {}),
  });
  if (
    coordinated.outcome === "implementer-failed" ||
    coordinated.outcome === "reviewer-failed" ||
    coordinated.outcome === "decision-failed"
  ) {
    return Object.freeze({ outcome: "failed", coordinator: coordinated } as const);
  }

  const evaluation = evaluateSprintCompletion(input.tickets);
  if (!evaluation.readyForTechnicalLeadReview) {
    return Object.freeze({ outcome: "work-remaining", evaluation } as const);
  }

  const technicalLead = await runTechnicalLeadReview({
    tickets: input.tickets,
    technicalLead: technicalLeadRef,
    project_root,
    timeout_ms: input.timeout_ms,
    decideTechnicalLead: input.decideTechnicalLead,
  });
  if (technicalLead.outcome === "approved") {
    // Fall through to PM/User Testing below.
  } else if (technicalLead.outcome === "corrections-required") {
    const correction = await createTechnicalLeadCorrectionTicket({ review: technicalLead, issues: input.issues });
    if (correction.outcome === "created") {
      return Object.freeze({ outcome: "technical-lead-corrections-required", correction } as const);
    }
    return Object.freeze({ outcome: "correction-creation-failed", correction } as const);
  } else {
    return Object.freeze({ outcome: "technical-lead-not-ready", technicalLead } as const);
  }

  const pmReview = await runPmUserTestingReview({
    tickets: input.tickets,
    technicalLeadReview: technicalLead,
    projectManager: projectManagerRef,
    project_root,
    timeout_ms: input.timeout_ms,
    decidePmUserTesting: input.decidePmUserTesting,
  });
  if (pmReview.outcome === "approved") {
    // Fall through to final approval below.
  } else if (pmReview.outcome === "changes-required") {
    return Object.freeze({ outcome: "pm-changes-required", pmReview } as const);
  } else {
    return Object.freeze({ outcome: "pm-not-ready", pmReview } as const);
  }

  const finalApproval = await runFinalApproval({
    tickets: input.tickets,
    pmReview,
    coordinator: input.coordinatorApproval,
    decideFinalApproval: input.decideFinalApproval,
  });
  if (finalApproval.outcome === "approved") {
    return Object.freeze({ outcome: "completed", ticket_ids: ids, finalApproval } as const);
  } else if (finalApproval.outcome === "changes-required") {
    return Object.freeze({ outcome: "final-approval-rejected", finalApproval } as const);
  } else {
    return Object.freeze({ outcome: "final-approval-not-ready", finalApproval } as const);
  }
}
