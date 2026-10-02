/**
 * Production sprint composition (M19 E2E-003).
 *
 * The smallest callable operation representing a real
 * production sprint traversal, wiring existing components
 * only:
 *
 * ```text
 * caller-supplied TicketSource / TicketSink
 *        ↓ read once (validate with the source contract)
 * assemble: OpenCode string agent → execution adapter →
 *   createProductionCoordinatorDeps (R-004/R-005/R-006 path)
 *        ↓ runSprintWorkflow once
 * completed → synchronizeSprintOutcome once → combined result
 * anything else → wrapped workflow result, zero sink calls
 * ```
 *
 * Composition only: no workflow, review, decision,
 * correction, selection, state-transition, provider, GitHub,
 * configuration, setup, scheduling, retry, or re-entry logic
 * lives here — every stage below keeps its own semantics,
 * and this module routes on explicit result outcomes alone.
 * One call means one traversal: the source is read once,
 * the workflow runs once, synchronization runs at most once
 * (only after `completed`), and re-entry stays
 * caller-controlled per E2E-002. Composition and input
 * failures throw bounded errors before execution; source,
 * workflow, and synchronization outcomes return as results
 * with child diagnostics preserved.
 */

import { AgentProvider } from "../providers/agent";
import { IssueProvider, isIssueProvider } from "../providers/issue";
import { ImplementerSpecialty } from "../roles/contract";
import { createOpenCodeExecutionProvider } from "../providers/opencode-execution";
import { createProductionCoordinatorDeps } from "./production";
import { ReviewDecisionResolver, isReviewDecisionResolver } from "./review-decision";
import { TicketSource, isTicketSource, validateSourceTickets } from "./ticket-source";
import { TicketSink, isTicketSink } from "./ticket-sink";
import {
  CoordinatorApprovalReference,
  ProjectManagerRoleReference,
  TechnicalLeadRoleReference,
  validateCoordinatorApprovalReference,
  validateProjectManagerReference,
  validateTechnicalLeadReference,
} from "./roles";
import {
  TechnicalLeadDecisionResolver,
  isTechnicalLeadDecisionResolver,
} from "./technical-lead";
import {
  PmUserTestingDecisionResolver,
  isPmUserTestingDecisionResolver,
} from "./pm-testing";
import {
  FinalApprovalDecisionResolver,
  isFinalApprovalDecisionResolver,
} from "./final-approval";
import {
  SprintWorkflowCompleted,
  SprintWorkflowCorrectionFailed,
  SprintWorkflowCorrectionsRequired,
  SprintWorkflowFailed,
  SprintWorkflowFinalNotReady,
  SprintWorkflowFinalRejected,
  SprintWorkflowPmChangesRequired,
  SprintWorkflowPmNotReady,
  SprintWorkflowResult,
  SprintWorkflowTechnicalLeadNotReady,
  SprintWorkflowWorkRemaining,
  runSprintWorkflow,
} from "./sprint-workflow";
import {
  SprintSynchronizationResult,
  SprintSyncFailed,
  SprintSynchronized,
  synchronizeSprintOutcome,
} from "./sprint-synchronization";

/**
 * Production sprint input. Every dependency arrives
 * explicitly; nothing is defaulted, discovered, inferred, or
 * read from configuration or the environment. In particular
 * the Technical Lead, Project Manager, and Coordinator
 * approval references arrive as themselves — never derived
 * from the Coordinator roles, never silently reusing another
 * role — and every approval/rejection arrives through an
 * explicit decision resolver.
 */
export interface ProductionSprintWorkflowInput {
  /** Read-only ticket source; read exactly once per invocation. */
  readonly ticketSource: TicketSource;
  /** Write-only sink for explicit final synchronization; required, never defaulted. */
  readonly ticketSink: TicketSink;
  /** Implementer specialty, decided externally by the caller. */
  readonly specialty: ImplementerSpecialty;
  /** Ready-made OpenCode string agent (such as `createOpenCodeProvider()` output). */
  readonly openCodeAgent: AgentProvider<string>;
  /** Explicit Technical Lead reference; exact `technical-lead` identity. */
  readonly technicalLead: TechnicalLeadRoleReference;
  /** Explicit PM/User Testing reference; exact `project-manager` identity. */
  readonly projectManager: ProjectManagerRoleReference;
  /** Explicit final approval authority; exact `coordinator` identity. */
  readonly coordinatorApproval: CoordinatorApprovalReference;
  /** Explicit issue tracker for Technical Lead correction creation only. */
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

/** Final approval synchronized: the full production success. */
export interface ProductionSprintSynchronized {
  readonly outcome: "workflow-completed-and-synchronized";
  readonly workflow: SprintWorkflowCompleted;
  readonly synchronization: SprintSynchronized;
}

/** Final approval reached but persistence rejected: success preserved, failure exposed. */
export interface ProductionSprintSyncFailed {
  readonly outcome: "workflow-completed-sync-failed";
  readonly workflow: SprintWorkflowCompleted;
  readonly synchronization: SprintSyncFailed;
}

/** Explicit non-final workflow outcome: returned unchanged, never synchronized. */
export interface ProductionSprintNotCompleted {
  readonly outcome: "workflow-not-completed";
  readonly workflow:
    | SprintWorkflowWorkRemaining
    | SprintWorkflowTechnicalLeadNotReady
    | SprintWorkflowCorrectionsRequired
    | SprintWorkflowCorrectionFailed
    | SprintWorkflowPmNotReady
    | SprintWorkflowPmChangesRequired
    | SprintWorkflowFinalNotReady
    | SprintWorkflowFinalRejected;
}

/** Coordinator-level workflow failure, preserved with its diagnostics. */
export interface ProductionSprintFailed {
  readonly outcome: "workflow-failed";
  readonly workflow: SprintWorkflowFailed;
}

/** The ticket snapshot never arrived: workflow never invoked, nothing fabricated. */
export interface ProductionSprintSourceFailed {
  readonly outcome: "source-failed";
  readonly error: { readonly kind: string; readonly message: string };
}

export type ProductionSprintResult =
  | ProductionSprintSynchronized
  | ProductionSprintSyncFailed
  | ProductionSprintNotCompleted
  | ProductionSprintFailed
  | ProductionSprintSourceFailed;

function fail(what: string): never {
  throw new Error(`production sprint: ${what}`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

function sourceFailed(error: unknown): ProductionSprintSourceFailed {
  return Object.freeze({
    outcome: "source-failed",
    error: {
      kind: "ticket-source-failed",
      message: error instanceof Error ? error.message : String(error),
    },
  } as const);
}

/**
 * Run one production sprint traversal: validate every
 * dependency, assemble the Coordinator roles through the
 * established R-004/R-005 path, read the source once, run
 * the sprint workflow once, and — only after `completed` —
 * synchronize once. No loops, no retries, no re-entry, no
 * second anything.
 */
export async function runProductionSprintWorkflow(
  input: ProductionSprintWorkflowInput,
): Promise<ProductionSprintResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a production sprint input object");
  }
  if (!isTicketSource(input.ticketSource)) {
    fail("ticketSource must satisfy the ticket source contract");
  }
  if (!isTicketSink(input.ticketSink)) {
    fail("ticketSink must satisfy the ticket sink contract");
  }
  const execution = createOpenCodeExecutionProvider(input.openCodeAgent);
  const deps = createProductionCoordinatorDeps({
    specialty: input.specialty,
    implementerProvider: execution,
    reviewerProvider: execution,
  });
  const technicalLead = validateTechnicalLeadReference(input.technicalLead);
  const projectManager = validateProjectManagerReference(input.projectManager);
  let coordinatorApproval: CoordinatorApprovalReference;
  try {
    coordinatorApproval = validateCoordinatorApprovalReference(input.coordinatorApproval);
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

  let listed: unknown;
  try {
    listed = await input.ticketSource.listTickets();
  } catch (error) {
    return sourceFailed(error);
  }
  let tickets;
  try {
    tickets = validateSourceTickets(listed);
  } catch (error) {
    return sourceFailed(error);
  }

  const workflow: SprintWorkflowResult = await runSprintWorkflow({
    tickets,
    roles: deps.roles,
    technicalLead,
    projectManager,
    coordinatorApproval,
    issues: input.issues,
    project_root,
    timeout_ms: input.timeout_ms,
    decideReview: input.decideReview,
    decideTechnicalLead: input.decideTechnicalLead,
    decidePmUserTesting: input.decidePmUserTesting,
    decideFinalApproval: input.decideFinalApproval,
    ...(discovery_summary !== undefined ? { discovery_summary } : {}),
  });
  if (workflow.outcome === "failed") {
    return Object.freeze({ outcome: "workflow-failed", workflow } as const);
  }
  if (workflow.outcome !== "completed") {
    return Object.freeze({ outcome: "workflow-not-completed", workflow } as const);
  }
  const synchronization: SprintSynchronizationResult = await synchronizeSprintOutcome({
    tickets,
    workflow,
    ticketSink: input.ticketSink,
  });
  if (synchronization.outcome === "sync-failed") {
    return Object.freeze({ outcome: "workflow-completed-sync-failed", workflow, synchronization } as const);
  }
  if (synchronization.outcome !== "synchronized") {
    fail("synchronization refused a completed workflow result");
  }
  return Object.freeze({ outcome: "workflow-completed-and-synchronized", workflow, synchronization } as const);
}
