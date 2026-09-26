/**
 * Production sprint CLI command (M19 E2E-004): `ai-team sprint`.
 *
 * The user-facing thin adapter over the E2E-003 production
 * operation. One invocation means exactly one composed
 * production call — one source read, one sprint workflow
 * traversal, at most one final synchronization — and then
 * the command reports the bounded result and exits. No
 * loops, no retries, no re-entry, no drain, no background
 * continuation: reenterable outcomes exit non-success and
 * the operator invokes the command again explicitly.
 *
 * ```text
 * CLI (argument + config + credential assembly only)
 *  ↓ runGitHubProductionSprintWorkflow (E2E-003, sole runtime seam)
 * TicketSource → runSprintWorkflow → TicketSink
 * ```
 *
 * The CLI never executes roles, decides reviews itself,
 * creates correction tickets, calls GitHub or OpenCode, or
 * touches workflow states: it assembles validated
 * configuration (`providers.github`, the same owner, repo,
 * `managedLabel`, and `specialty` keys `ai-team run` uses),
 * reads the token through the shared stdin reader, adapts
 * its configured OpenCode agent once through the existing
 * execution factory and stamps the exact Technical Lead and
 * Project Manager identities on it (explicit sharing, the
 * R-006 pattern — never another role's reference), builds
 * the correction issue tracker through the existing GitHub
 * issue-provider factory, supplies explicit decision
 * resolvers, and translates the production result into
 * concise bounded output plus an exit code. The token
 * travels only in memory into the production call — never
 * argv, history, logs, output, errors, or disk.
 *
 * Decisions stay explicit per stage. `--review-decision`
 * keeps its exact `ai-team run` semantics (Coordinator
 * review only, validated through the same seam) and is
 * never propagated: Technical Lead, PM/User Testing, and
 * final approval each take their own `--tl-decision`,
 * `--pm-decision`, and `--final-decision` arguments
 * non-interactively, or their own interactive TTY prompt
 * (report shown, decided once, never assumed) when the
 * corresponding arguments are absent. Non-interactive runs
 * without a needed explicit decision fail safely instead of
 * auto-approving.
 */

import { FrameworkConfig } from "./config/schema";
import { loadConfig } from "./config/loader";
import { validateConfig } from "./config/validator";
import { AgentProvider } from "./providers/agent";
import { IssueProvider } from "./providers/issue";
import { isImplementerSpecialty } from "./roles/contract";
import { createOpenCodeProvider } from "./providers/opencode";
import { createOpenCodeExecutionProvider } from "./providers/opencode-execution";
import { createGitHubIssueProvider } from "./providers/github";
import { CliResult } from "./cli";
import { ask, promptReviewDecision, readTokenFromStdin, TokenReader } from "./cli-run";
import { CoordinatorTicketResult } from "./runtime/coordinator";
import {
  ReviewDecisionResolver,
  validateReviewDecisionResolution,
} from "./runtime/review-decision";
import {
  TechnicalLeadDecisionRequest,
  TechnicalLeadDecisionResolution,
  TechnicalLeadDecisionResolver,
} from "./runtime/technical-lead";
import {
  PmUserTestingDecisionRequest,
  PmUserTestingDecisionResolution,
  PmUserTestingDecisionResolver,
} from "./runtime/pm-testing";
import {
  FinalApprovalDecisionRequest,
  FinalApprovalDecisionResolution,
  FinalApprovalDecisionResolver,
} from "./runtime/final-approval";
import {
  GitHubProductionSprintOptions,
  runGitHubProductionSprintWorkflow,
} from "./runtime/github-production";
import { ProductionSprintResult } from "./runtime/production-sprint";

/** Production execution bound for `ai-team sprint`. */
const SPRINT_TIMEOUT_MS = 300000;

/**
 * Injectable production dependencies, following the
 * cli-run seam pattern. Production uses config files, stdin
 * credentials, the real OpenCode provider, the existing
 * GitHub issue-provider factory, interactive TTY decision
 * prompts, and the E2E-003 GitHub composition; tests inject
 * fakes for all of them.
 */
export interface SprintCommandDeps {
  readonly projectRoot: string;
  readonly loadConfiguration: (projectRoot: string) => FrameworkConfig;
  readonly readToken: TokenReader;
  readonly readReviewDecision: ReviewDecisionResolver;
  readonly readTechnicalLeadDecision: TechnicalLeadDecisionResolver;
  readonly readPmDecision: PmUserTestingDecisionResolver;
  readonly readFinalDecision: FinalApprovalDecisionResolver;
  readonly createAgent: () => AgentProvider<string>;
  readonly createIssues: (options: { owner: string; repo: string; token: string }) => IssueProvider;
  readonly runProduction: (
    options: GitHubProductionSprintOptions,
  ) => Promise<ProductionSprintResult>;
}

export function createProductionSprintDeps(projectRoot: string): SprintCommandDeps {
  return {
    projectRoot,
    loadConfiguration: (root) => validateConfig(loadConfig(root)),
    readToken: readTokenFromStdin,
    readReviewDecision: promptReviewDecision,
    readTechnicalLeadDecision: promptTechnicalLeadDecision,
    readPmDecision: promptPmDecision,
    readFinalDecision: promptFinalDecision,
    createAgent: () => createOpenCodeProvider(),
    createIssues: (options) => createGitHubIssueProvider(options),
    runProduction: (options) => runGitHubProductionSprintWorkflow(options),
  };
}

function fail(what: string): never {
  throw new Error(`sprint command: ${what}`);
}

/**
 * Shared stage prompt convention: without a TTY there is no
 * decision mechanism, which fails safely instead of
 * auto-approving. The opaque report is shown so the
 * decision is informed; it is never parsed or classified.
 * "yes" approves; "no" records the stage-specific
 * non-approval with optional verbatim notes (empty notes
 * are omitted, never fabricated); anything else (including
 * EOF) fails without advancing.
 */
async function promptStageDecision<N extends "corrections-required" | "changes-required">(
  stage: string,
  header: string,
  nonApproval: N,
): Promise<{ decision: "approved" } | { decision: N; notes?: string }> {
  if (process.stdin.isTTY !== true) {
    fail(`no interactive decision mechanism available for ${stage}; refusing to auto-approve`);
  }
  process.stdout.write(`${header}\n`);
  const answer = await ask("Approve? [y/N]: ");
  if (answer !== undefined && /^(y|yes)$/i.test(answer.trim())) {
    return { decision: "approved" };
  }
  if (answer !== undefined && /^(n|no)$/i.test(answer.trim())) {
    const notes = await ask("Notes (optional): ");
    const trimmed = notes === undefined ? "" : notes.trim();
    return trimmed.length > 0 ? { decision: nonApproval, notes: trimmed } : { decision: nonApproval };
  }
  fail(`no decision provided for ${stage}; refusing to auto-approve`);
}

/** Interactive review decision: the existing `run` prompt, reused unchanged. */

/** Interactive Technical Lead decision over the opaque TL report. */
export async function promptTechnicalLeadDecision(
  request: TechnicalLeadDecisionRequest,
): Promise<TechnicalLeadDecisionResolution> {
  const header =
    `Technical Lead review complete for tickets ${request.ticket_ids.join(", ")}.\nReport:\n${request.report}`;
  return promptStageDecision("technical lead review", header, "corrections-required");
}

/** Interactive PM/User Testing decision over the opaque PM report. */
export async function promptPmDecision(
  request: PmUserTestingDecisionRequest,
): Promise<PmUserTestingDecisionResolution> {
  const header =
    `PM/User Testing review complete for tickets ${request.ticket_ids.join(", ")}.\nReport:\n${request.report}`;
  return promptStageDecision("pm/user testing review", header, "changes-required");
}

/** Interactive final Coordinator decision over the bounded sprint evidence. */
export async function promptFinalDecision(
  request: FinalApprovalDecisionRequest,
): Promise<FinalApprovalDecisionResolution> {
  const header =
    `Final approval requested for tickets ${request.ticket_ids.join(", ")}.\nPM report:\n${request.pmReport}`;
  return promptStageDecision("final coordinator approval", header, "changes-required");
}

function ok(stdout: string): CliResult {
  return { exitCode: 0, stdout, stderr: "" };
}

function commandError(stderr: string): CliResult {
  return { exitCode: 1, stdout: "", stderr };
}

const SPRINT_USAGE = `usage: ai-team sprint [--review-decision approved | --review-decision changes_requested --review-feedback "..."]
                          [--tl-decision approved | --tl-decision corrections-required [--tl-notes "..."]]
                          [--pm-decision approved | --pm-decision changes-required [--pm-notes "..."]]
                          [--final-decision approved | --final-decision changes-required [--final-notes "..."]]
Executes one production sprint traversal: reads managed GitHub
issues once, runs the sprint workflow once (Coordinator, then
Technical Lead, PM/User Testing, and final Coordinator approval
reviews), and synchronizes explicitly approved tickets once.
Configuration (providers.github with owner, repo, managedLabel,
specialty) comes from .ai-team/config.yaml; the GitHub token is
read from stdin (pipe it in, never pass it as an argument).
Every review stage needs its own explicit decision: --review-decision
(Coordinator review only, same semantics as ai-team run),
--tl-decision, --pm-decision, --final-decision — or decide
interactively at the TTY prompts after each stage report.
Non-interactive runs without a needed explicit decision fail
safely instead of auto-approving. Never retries, never re-enters:
reenterable outcomes exit non-success for an explicit later call.
`;

interface ParsedDecisions {
  readonly decideReview?: ReviewDecisionResolver;
  readonly decideTechnicalLead?: TechnicalLeadDecisionResolver;
  readonly decidePmUserTesting?: PmUserTestingDecisionResolver;
  readonly decideFinalApproval?: FinalApprovalDecisionResolver;
}

const DECISION_FLAGS = [
  "--review-decision",
  "--review-feedback",
  "--tl-decision",
  "--tl-notes",
  "--pm-decision",
  "--pm-notes",
  "--final-decision",
  "--final-notes",
] as const;

/**
 * Parse explicit non-interactive stage decisions: each
 * `--<stage>-decision <verdict>` pair becomes a deterministic
 * resolver, with optional `--<stage>-notes` traveling
 * verbatim. `--review-decision` keeps its exact `run`
 * semantics through the shared validation seam and is never
 * propagated to other stages. Every invalid shape fails
 * here, before configuration, credentials, or runtime work.
 */
function parseDecisionArgs(argv: string[]): { kind: "usage" } | { kind: "ok" } & ParsedDecisions {
  const rest = argv.slice(1);
  if (rest.length === 0) {
    return { kind: "ok" };
  }
  const values = new Map<string, { value: string; count: number }>();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!(DECISION_FLAGS as readonly string[]).includes(token)) {
      return { kind: "usage" };
    }
    const value = rest[index + 1];
    if (value === undefined) {
      fail(`missing value for ${token}`);
    }
    const seen = values.get(token);
    values.set(token, { value, count: (seen?.count ?? 0) + 1 });
    index += 1;
  }
  for (const [flag, entry] of values) {
    if (entry.count > 1) {
      fail(`duplicate ${flag}`);
    }
  }
  const get = (flag: string): string | undefined => values.get(flag)?.value;
  const reviewDecision = get("--review-decision");
  const reviewFeedback = get("--review-feedback");
  const tlDecision = get("--tl-decision");
  const tlNotes = get("--tl-notes");
  const pmDecision = get("--pm-decision");
  const pmNotes = get("--pm-notes");
  const finalDecision = get("--final-decision");
  const finalNotes = get("--final-notes");
  if (reviewFeedback !== undefined && reviewDecision === undefined) {
    fail("--review-feedback requires --review-decision");
  }
  if (tlNotes !== undefined && tlDecision === undefined) {
    fail("--tl-notes requires --tl-decision");
  }
  if (pmNotes !== undefined && pmDecision === undefined) {
    fail("--pm-notes requires --pm-decision");
  }
  if (finalNotes !== undefined && finalDecision === undefined) {
    fail("--final-notes requires --final-decision");
  }
  let decideReview: ReviewDecisionResolver | undefined;
  if (reviewDecision !== undefined) {
    const resolution = validateReviewDecisionResolution(
      { decision: reviewDecision, ...(reviewFeedback !== undefined ? { feedback: reviewFeedback } : {}) },
      "cli",
    );
    const frozen = Object.freeze({ ...resolution });
    decideReview = async () => frozen;
  }
  const decideTechnicalLead = tlDecision === undefined ? undefined : stageResolver("--tl-decision", tlDecision, tlNotes, ["approved", "corrections-required"]);
  const decidePmUserTesting = pmDecision === undefined ? undefined : stageResolver("--pm-decision", pmDecision, pmNotes, ["approved", "changes-required"]);
  const decideFinalApproval = finalDecision === undefined ? undefined : stageResolver("--final-decision", finalDecision, finalNotes, ["approved", "changes-required"]);
  return { kind: "ok", ...(decideReview !== undefined ? { decideReview } : {}), ...(decideTechnicalLead !== undefined ? { decideTechnicalLead } : {}), ...(decidePmUserTesting !== undefined ? { decidePmUserTesting } : {}), ...(decideFinalApproval !== undefined ? { decideFinalApproval } : {}) };
}

/**
 * Build a deterministic resolver for one sprint review
 * stage, mirroring the runtime resolution contracts: the
 * verdict must be exactly one of the stage's literals, and
 * notes travel verbatim only when non-empty. Never approves
 * by default; never parses anything.
 */
function stageResolver<D extends string>(
  flag: string,
  verdict: string,
  notes: string | undefined,
  allowed: readonly D[],
): () => Promise<{ decision: D; notes?: string }> {
  if (!(allowed as readonly string[]).includes(verdict)) {
    fail(`unknown verdict ${JSON.stringify(verdict)} for ${flag}`);
  }
  if (notes !== undefined && notes.length === 0) {
    fail(`${flag.replace("-decision", "-notes")} must be a non-empty string`);
  }
  const frozen = Object.freeze({
    decision: verdict as D,
    ...(notes !== undefined ? { notes } : {}),
  });
  return async () => frozen;
}

function ids(list: readonly string[]): string {
  return list.join(", ");
}

function errorText(error: { kind: string; message: string }): string {
  return `(${error.kind}): ${error.message}`;
}

function ticketText(ticket_id: unknown): string {
  return typeof ticket_id === "string" ? ` ticket ${ticket_id}` : "";
}

function describeWorkflowFailed(coordinator: CoordinatorTicketResult): CliResult {
  switch (coordinator.outcome) {
    case "implementer-failed":
    case "reviewer-failed":
    case "decision-failed":
      return commandError(
        `sprint workflow-failed:${ticketText(coordinator.ticket_id)} coordinator ${coordinator.outcome} ${errorText(coordinator.error)}.\n`,
      );
    default:
      return commandError(
        `sprint workflow-failed: coordinator ${coordinator.outcome}.\n`,
      );
  }
}

function describeNotCompleted(
  workflow: Extract<ProductionSprintResult, { outcome: "workflow-not-completed" }>["workflow"],
): CliResult {
  switch (workflow.outcome) {
    case "work-remaining":
      return commandError(
        `sprint work-remaining: tickets ${ids(workflow.evaluation.workRemaining)} still need work; reenter explicitly with ai-team sprint.\n`,
      );
    case "technical-lead-not-ready": {
      const detail = workflow.technicalLead.outcome === "not-ready"
        ? `sprint technical-lead-not-ready: ${workflow.technicalLead.outcome}; attention needed before re-entry.\n`
        : "error" in workflow.technicalLead
          ? `sprint technical-lead-not-ready: ${workflow.technicalLead.outcome} ${errorText(workflow.technicalLead.error)}; attention needed before re-entry.\n`
          : `sprint technical-lead-not-ready: ${workflow.technicalLead.outcome}; attention needed before re-entry.\n`;
      return commandError(detail);
    }
    case "technical-lead-corrections-required":
      return commandError(
        `sprint corrections-required: correction ${workflow.correction.reference.id} created; no further stages ran — reenter explicitly with ai-team sprint when ready.\n`,
      );
    case "correction-creation-failed": {
      const detail = "error" in workflow.correction
        ? `sprint correction-creation-failed ${errorText(workflow.correction.error)}; attention needed before re-entry.\n`
        : "sprint correction-creation-failed; attention needed before re-entry.\n";
      return commandError(detail);
    }
    case "pm-not-ready":
      return commandError(
        `sprint pm-not-ready: ${workflow.pmReview.outcome}; attention needed before re-entry.\n`,
      );
    case "pm-changes-required": {
      const review = workflow.pmReview;
      const notes = review.outcome === "changes-required" && review.notes !== undefined
        ? `: ${review.notes}`
        : "";
      const tickets = review.outcome === "changes-required" || review.outcome === "approved"
        ? ` tickets ${ids(review.ticket_ids)}`
        : "";
      return commandError(
        `sprint pm-changes-required:${tickets}${notes}; no final approval ran.\n`,
      );
    }
    case "final-approval-not-ready":
      return commandError(
        `sprint final-approval-not-ready: ${workflow.finalApproval.outcome}; attention needed before re-entry.\n`,
      );
    case "final-approval-rejected": {
      const rejected = workflow.finalApproval;
      const notes = rejected.outcome === "changes-required" && rejected.notes !== undefined
        ? `: ${rejected.notes}`
        : "";
      const tickets = rejected.outcome === "changes-required" || rejected.outcome === "approved"
        ? ` tickets ${ids(rejected.ticket_ids)}`
        : "";
      return commandError(
        `sprint final-approval-rejected:${tickets}${notes}; nothing synchronized.\n`,
      );
    }
    default:
      return commandError("sprint error: unknown workflow result.\n");
  }
}

function describeResult(result: ProductionSprintResult): CliResult {
  switch (result.outcome) {
    case "workflow-completed-and-synchronized":
      return ok(
        `sprint synchronized: tickets ${ids(result.workflow.ticket_ids)} approved; closed ${ids(result.synchronization.synchronizedIds)}.\n`,
      );
    case "workflow-completed-sync-failed":
      return commandError(
        `sprint sync-failed: tickets ${ids(result.workflow.ticket_ids)} approved but synchronization failed ${errorText(result.synchronization.error)}; workflow success preserved, nothing retried.\n`,
      );
    case "workflow-not-completed":
      return describeNotCompleted(result.workflow);
    case "workflow-failed":
      return describeWorkflowFailed(result.workflow.coordinator);
    case "source-failed":
      return commandError(
        `sprint source-failed ${errorText(result.error)}; workflow never ran.\n`,
      );
    default:
      return commandError("sprint error: unknown production result.\n");
  }
}

/**
 * Execute `ai-team sprint` exactly once: bare for the
 * interactive TTY decision prompts, or with explicit
 * per-stage decision arguments for a fully non-interactive
 * run. Unknown argument shapes are usage errors; malformed
 * decision arguments are bounded errors naming the problem.
 * Either way nothing reaches the runtime. Configuration,
 * credential, and runtime failures become bounded exit-1
 * results; this function never rejects.
 */
export async function runSprintCommand(deps: SprintCommandDeps, argv: string[]): Promise<CliResult> {
  try {
    if (typeof deps !== "object" || deps === null) {
      fail("expected a dependencies object");
    }
    if (typeof deps.projectRoot !== "string") {
      fail("projectRoot must be a string");
    }
    if (typeof deps.loadConfiguration !== "function") {
      fail("loadConfiguration must be a function");
    }
    if (typeof deps.readToken !== "function") {
      fail("readToken must be a function");
    }
    if (typeof deps.readReviewDecision !== "function") {
      fail("readReviewDecision must be a function");
    }
    if (typeof deps.readTechnicalLeadDecision !== "function") {
      fail("readTechnicalLeadDecision must be a function");
    }
    if (typeof deps.readPmDecision !== "function") {
      fail("readPmDecision must be a function");
    }
    if (typeof deps.readFinalDecision !== "function") {
      fail("readFinalDecision must be a function");
    }
    if (typeof deps.createAgent !== "function") {
      fail("createAgent must be a function");
    }
    if (typeof deps.createIssues !== "function") {
      fail("createIssues must be a function");
    }
    if (typeof deps.runProduction !== "function") {
      fail("runProduction must be a function");
    }
    if (argv.length < 1 || argv[0] !== "sprint") {
      return commandError(SPRINT_USAGE);
    }
    let parsed: ParsedDecisions = {};
    try {
      const decisions = parseDecisionArgs(argv);
      if (decisions.kind === "usage") {
        return commandError(SPRINT_USAGE);
      }
      parsed = decisions;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return commandError(`sprint error: ${message}.\n`);
    }
    const config = deps.loadConfiguration(deps.projectRoot);
    const github =
      typeof config === "object" && config !== null
        ? (config as FrameworkConfig).providers?.github
        : undefined;
    const managedLabel = github?.managedLabel;
    if (typeof managedLabel !== "string" || managedLabel.length === 0) {
      fail("providers.github.managedLabel is required for ai-team sprint");
    }
    const specialty = github?.specialty;
    if (!isImplementerSpecialty(specialty)) {
      fail("providers.github.specialty is required for ai-team sprint");
    }
    let token: unknown;
    try {
      token = await deps.readToken();
    } catch {
      token = "";
    }
    if (typeof token !== "string" || token.trim().length === 0) {
      fail("a non-empty GitHub token on stdin is required for ai-team sprint");
    }
    const cleanToken = token.trim();
    const issues = deps.createIssues({
      owner: github?.owner as string,
      repo: github?.repo as string,
      token: cleanToken,
    });
    // Explicit Technical Lead and Project Manager references
    // over the CLI's own configured execution substrate: the
    // same OpenCode string agent adapted once through the
    // existing R-005 factory, stamped with the exact
    // `technical-lead` / `project-manager` identities. This
    // is explicit sharing of the configured provider (the
    // R-006 pattern, where one adapted instance serves two
    // roles) — never inferred from, and never reusing,
    // another role's reference. Anything the factories
    // reject fails here as a bounded error, before any run.
    const agent = deps.createAgent();
    const execution = createOpenCodeExecutionProvider(agent);
    const result = await deps.runProduction({
      config,
      token: cleanToken,
      managedLabel,
      specialty,
      openCodeAgent: agent,
      technicalLead: { role: "technical-lead", provider: execution },
      projectManager: { role: "project-manager", provider: execution },
      coordinatorApproval: { role: "coordinator" },
      issues,
      project_root: deps.projectRoot,
      timeout_ms: SPRINT_TIMEOUT_MS,
      decideReview: parsed.decideReview ?? deps.readReviewDecision,
      decideTechnicalLead: parsed.decideTechnicalLead ?? deps.readTechnicalLeadDecision,
      decidePmUserTesting: parsed.decidePmUserTesting ?? deps.readPmDecision,
      decideFinalApproval: parsed.decideFinalApproval ?? deps.readFinalDecision,
    });
    return describeResult(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return commandError(`sprint error: ${message}.\n`);
  }
}
