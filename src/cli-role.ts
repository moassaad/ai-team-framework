/**
 * Direct role execution CLI command (M25 T-016): `ai-team role <role>`.
 *
 * The thin CLI adapter over the T-005 independent execution
 * contract. One invocation runs exactly one role — never a
 * chain, never orchestration — through the existing
 * `executeIndependent*` functions, which own all runtime
 * semantics. The CLI only parses explicit per-role flags,
 * resolves production dependencies through the established
 * paths (caller project root, validated configuration,
 * OpenCode provider bridged to execution results), and renders
 * the outcome with the repository's exit-code conventions.
 *
 * ```text
 * ai-team role implementer --id T-001 --title "..." --description "..."
 *   --requirements "..." --specialty backend
 * ai-team role senior-reviewer --id ... --title ... --description ...
 *   --requirements ... --result "..."
 * ai-team role technical-lead --id ... --title ... --description ...
 *   --requirements ... --state technical_approval
 * ai-team role project-manager --id ... --title ... --description ...
 *   --requirements ... --state technical_approval
 * ai-team role coordinator --id ... --title ... --description ...
 *   --requirements ... --specialty backend
 *   --review-decision approved | --review-decision changes_requested --review-feedback "..."
 * ```
 *
 * Role selection reuses `resolveRole` (canonical ids plus the
 * existing aliases, resolved before execution); specialty uses
 * the existing specialty validation; evidence states use the
 * existing workflow-state contract. Single-evidence TL/PM
 * invocations are the CLI boundary — the runtime API supports
 * full arrays. The Coordinator reuses the R-014 explicit
 * decision arguments with the existing TTY prompt as fallback
 * (non-interactive runs without a decision fail safely, exactly
 * like `run`). No handoff I/O yet (T-017/T-018 own that), no
 * modes, no delegation, no persistence, single attempt only.
 */

import { CliResult } from "./cli";
import { FrameworkConfig } from "./config/schema";
import { loadConfig } from "./config/loader";
import { validateConfig } from "./config/validator";
import { AgentProvider } from "./providers/agent";
import { ExecutionResult } from "./providers/result";
import { AgentHandoff } from "./roles/handoff";
import { validateAgentHandoff, renderAgentHandoff } from "./roles/handoff-validation";
import { ImplementerSpecialty, isImplementerSpecialty } from "./roles/contract";
import { resolveRole } from "./roles/selection";
import { isWorkflowState } from "./workflow/states";
import { createOpenCodeProvider } from "./providers/opencode";
import { createOpenCodeExecutionProvider } from "./providers/opencode-execution";
import { promptReviewDecision } from "./cli-run";
import { ReviewDecisionResolver, validateReviewDecisionResolution } from "./runtime/review-decision";
import {
  executeIndependentCoordinator,
  executeIndependentImplementer,
  executeIndependentProjectManager,
  executeIndependentSeniorReviewer,
  executeIndependentTechnicalLead,
} from "./roles/independent-execution";

/** Production execution bound for `ai-team role` (same bound as `run`). */
const ROLE_TIMEOUT_MS = 300000;

/**
 * Injectable command dependencies, following the cli-run seam
 * pattern. Production uses the working directory, validated
 * configuration, the bridged OpenCode provider, the existing
 * TTY decision prompt, and the real T-005 executors; tests
 * inject fakes and spies for all of them.
 */
export interface RoleCommandDeps {
  readonly projectRoot: string;
  readonly loadConfiguration: (projectRoot: string) => FrameworkConfig;
  readonly createAgent: () => AgentProvider<ExecutionResult>;
  readonly readReviewDecision: ReviewDecisionResolver;
  readonly executeImplementer: typeof executeIndependentImplementer;
  readonly executeSeniorReviewer: typeof executeIndependentSeniorReviewer;
  readonly executeTechnicalLead: typeof executeIndependentTechnicalLead;
  readonly executeProjectManager: typeof executeIndependentProjectManager;
  readonly executeCoordinator: typeof executeIndependentCoordinator;
}

export function createProductionRoleDeps(projectRoot: string): RoleCommandDeps {
  const openCode = createOpenCodeProvider();
  const agent = createOpenCodeExecutionProvider(openCode);
  return {
    projectRoot,
    loadConfiguration: (root) => validateConfig(loadConfig(root)),
    createAgent: () => agent,
    readReviewDecision: promptReviewDecision,
    executeImplementer: executeIndependentImplementer,
    executeSeniorReviewer: executeIndependentSeniorReviewer,
    executeTechnicalLead: executeIndependentTechnicalLead,
    executeProjectManager: executeIndependentProjectManager,
    executeCoordinator: executeIndependentCoordinator,
  };
}

function fail(what: string): never {
  throw new Error(`role command: ${what}`);
}

function ok(stdout: string): CliResult {
  return { exitCode: 0, stdout, stderr: "" };
}

function commandError(stderr: string): CliResult {
  return { exitCode: 1, stdout: "", stderr };
}

const ROLE_USAGE = `usage: ai-team role <role> [role inputs]
Directly execute exactly one role with no orchestration, no modes,
no delegation, and no persistence. Roles: coordinator,
project-manager, technical-lead, implementer, senior-reviewer
(aliases pm, tl, reviewer, sr resolve before execution).

  ai-team role implementer --id ID --title TITLE --description TEXT --requirements TEXT --specialty backend|frontend|integration|database|testing|documentation
  ai-team role senior-reviewer --id ID --title TITLE --description TEXT --requirements TEXT --result TEXT
  ai-team role technical-lead --id ID --title TITLE --description TEXT --requirements TEXT --state STATE
  ai-team role project-manager --id ID --title TITLE --description TEXT --requirements TEXT --state STATE
  ai-team role coordinator --id ID --title TITLE --description TEXT --requirements TEXT --specialty SPECIALTY --review-decision approved | --review-decision changes_requested --review-feedback TEXT

Without an explicit --review-decision, the coordinator asks once at
a TTY prompt; non-interactive runs without one fail safely.

Append --show-handoff to any role invocation to print exactly the
canonical handoff carried by its result (nothing else) for manual
copying; when the execution produced no handoff, the command
reports that instead of inventing one.
`;

function parseFlags(argv: string[], allowed: readonly string[], booleans: readonly string[] = []): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      fail(`unexpected argument ${JSON.stringify(token)}`);
    }
    if (!allowed.includes(token)) {
      fail(`unsupported flag ${JSON.stringify(token)} for this role`);
    }
    if (flags[token] !== undefined) {
      fail(`duplicate flag ${JSON.stringify(token)}`);
    }
    if (booleans.includes(token)) {
      flags[token] = "true";
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      fail(`missing value for ${token}`);
    }
    flags[token] = value;
    index += 1;
  }
  return flags;
}

function requiredFlag(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (value === undefined || value.length === 0) {
    fail(`missing required ${name}`);
  }
  return value;
}

interface TicketFlags {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly requirements: string;
}

function ticketFlags(flags: Record<string, string>): TicketFlags {
  return {
    id: requiredFlag(flags, "--id"),
    title: requiredFlag(flags, "--title"),
    description: requiredFlag(flags, "--description"),
    requirements: requiredFlag(flags, "--requirements"),
  };
}

function specialtyFlag(flags: Record<string, string>): ImplementerSpecialty {
  const specialty = requiredFlag(flags, "--specialty");
  if (!isImplementerSpecialty(specialty)) {
    fail(`unknown specialty ${JSON.stringify(specialty)}`);
  }
  return specialty;
}

function parseCoordinatorDecision(flags: Record<string, string>): ReviewDecisionResolver | undefined {
  const decision = flags["--review-decision"];
  const feedback = flags["--review-feedback"];
  if (decision === undefined && feedback === undefined) {
    return undefined;
  }
  if (decision === undefined) {
    fail("--review-feedback requires --review-decision");
  }
  const resolution = validateReviewDecisionResolution(
    { decision, ...(feedback !== undefined ? { feedback } : {}) },
    "cli",
  );
  const frozen = Object.freeze({ ...resolution });
  return async () => frozen;
}

/**
 * Copy-ready handoff output (M25 T-017). When `--show-handoff`
 * was passed and the execution completed, stdout becomes exactly
 * the canonical T-004 rendering of the outcome's handoff — no
 * wrapper, no metadata, directly copyable. The handoff is
 * re-validated before rendering (an executor returning an
 * invalid direction fails here through the outer boundary).
 * Completed executions without a handoff report that explicitly;
 * failed executions keep their failure rendering regardless of
 * the flag.
 */
function withHandoffOutput(
  role: string,
  showHandoff: boolean,
  outcome: { readonly execution: { readonly outcome: string }; readonly handoff?: unknown },
  normal: CliResult,
): CliResult {
  if (!showHandoff || outcome.execution.outcome !== "completed") {
    return normal;
  }
  if (outcome.handoff === undefined) {
    return commandError(`role error: no handoff available for role ${JSON.stringify(role)} in this execution.\n`);
  }
  const validated: AgentHandoff = validateAgentHandoff(outcome.handoff);
  return ok(renderAgentHandoff(validated));
}

function describeImplementer(result: Awaited<ReturnType<typeof executeIndependentImplementer>>): CliResult {
  if (result.execution.outcome === "completed") {
    return ok(`role implementer completed: ticket ${result.execution.ticket_id} -> ${result.execution.next_state}.\n`);
  }
  return commandError(
    `role implementer-failed: ticket ${result.execution.ticket_id} (${result.execution.error.kind}): ${result.execution.error.message}.\n`,
  );
}

function describeReviewer(result: Awaited<ReturnType<typeof executeIndependentSeniorReviewer>>): CliResult {
  if (result.execution.outcome === "completed") {
    return ok(`role senior-reviewer completed: ticket ${result.execution.ticket_id}.\nReport:\n${result.execution.report}\n`);
  }
  return commandError(
    `role reviewer-failed: ticket ${result.execution.ticket_id} (${result.execution.error.kind}): ${result.execution.error.message}.\n`,
  );
}

function describeTechnicalLead(result: Awaited<ReturnType<typeof executeIndependentTechnicalLead>>): CliResult {
  if (result.execution.outcome === "completed") {
    return ok(`role technical-lead completed.\nReport:\n${result.execution.report}\n`);
  }
  return commandError(`role technical-lead-failed (${result.execution.error.kind}): ${result.execution.error.message}.\n`);
}

function describeProjectManager(result: Awaited<ReturnType<typeof executeIndependentProjectManager>>): CliResult {
  if (result.execution.outcome === "completed") {
    return ok(`role project-manager completed.\nReport:\n${result.execution.report}\n`);
  }
  return commandError(`role project-manager-failed (${result.execution.error.kind}): ${result.execution.error.message}.\n`);
}

function describeCoordinator(
  result: Awaited<ReturnType<typeof executeIndependentCoordinator>>,
): CliResult {
  const execution = result.execution;
  switch (execution.outcome) {
    case "completed":
      return ok(`role coordinator completed: ticket ${execution.ticket_id} -> ${execution.final_state}.\n`);
    case "no-work":
      return ok(`role coordinator no-work: ${execution.reason}.\n`);
    case "conflict":
      return commandError(`role coordinator conflict: ticket ${execution.ticket_id} (${execution.state}): ${execution.reason}.\n`);
    default:
      return commandError(
        `role coordinator ${execution.outcome}: ticket ${execution.ticket_id} (${execution.error.kind}): ${execution.error.message}.\n`,
      );
  }
}

/**
 * Execute `ai-team role <role>` exactly once: parse the role and
 * its explicit flags, resolve production dependencies, invoke
 * exactly one T-005 executor with the canonical identity, and
 * render the outcome. Unknown roles, malformed flags, and
 * runtime failures become bounded exit-1 results; this function
 * never rejects and never invokes any other role.
 */
export async function runRoleCommand(deps: RoleCommandDeps, argv: string[]): Promise<CliResult> {
  try {
    if (typeof deps !== "object" || deps === null) {
      fail("expected a dependencies object");
    }
    for (const key of [
      "projectRoot",
      "loadConfiguration",
      "createAgent",
      "readReviewDecision",
      "executeImplementer",
      "executeSeniorReviewer",
      "executeTechnicalLead",
      "executeProjectManager",
      "executeCoordinator",
    ] as const) {
      if (typeof (deps as unknown as Record<string, unknown>)[key] !== (key === "projectRoot" ? "string" : "function")) {
        fail(`${key} has the wrong shape`);
      }
    }
    if (argv.length < 2 || argv[0] !== "role") {
      return commandError(ROLE_USAGE);
    }
    const selection = resolveRole(argv[1]);
    if (selection === undefined) {
      return commandError(ROLE_USAGE);
    }
    const rest = argv.slice(2);
    // Configuration is loaded and validated for its side effect:
    // an invalid configuration fails the command before any
    // provider or runtime work, exactly like `run`.
    void deps.loadConfiguration(deps.projectRoot);
    const provider = deps.createAgent();
    const timeout_ms = ROLE_TIMEOUT_MS;
    switch (selection.role) {
      case "implementer": {
        const flags = parseFlags(rest, ["--id", "--title", "--description", "--requirements", "--specialty", "--show-handoff"], ["--show-handoff"]);
        const ticket = ticketFlags(flags);
        const specialty = specialtyFlag(flags);
        const outcome = await deps.executeImplementer({
          identity: { role: "implementer" },
          input: { ticket, specialty, role: "implementer", project_root: deps.projectRoot, provider, timeout_ms },
        });
        return withHandoffOutput("implementer", flags["--show-handoff"] !== undefined, outcome, describeImplementer(outcome));
      }
      case "senior-reviewer": {
        const flags = parseFlags(rest, ["--id", "--title", "--description", "--requirements", "--result", "--show-handoff"], ["--show-handoff"]);
        const ticket = ticketFlags(flags);
        const implementation_result = requiredFlag(flags, "--result");
        const outcome = await deps.executeSeniorReviewer({
          identity: { role: "senior-reviewer" },
          input: { ticket, implementation_result, role: "senior-reviewer", project_root: deps.projectRoot, provider, timeout_ms },
        });
        return withHandoffOutput("senior-reviewer", flags["--show-handoff"] !== undefined, outcome, describeReviewer(outcome));
      }
      case "technical-lead": {
        const flags = parseFlags(rest, ["--id", "--title", "--description", "--requirements", "--state", "--show-handoff"], ["--show-handoff"]);
        const ticket = ticketFlags(flags);
        const state = requiredFlag(flags, "--state");
        if (!isWorkflowState(state)) {
          fail(`unknown workflow state ${JSON.stringify(state)}`);
        }
        const outcome = await deps.executeTechnicalLead({
          identity: { role: "technical-lead" },
          input: {
            evidence: [{ ...ticket, state }],
            role: "technical-lead",
            project_root: deps.projectRoot,
            provider,
            timeout_ms,
          },
        });
        return withHandoffOutput("technical-lead", flags["--show-handoff"] !== undefined, outcome, describeTechnicalLead(outcome));
      }
      case "project-manager": {
        const flags = parseFlags(rest, ["--id", "--title", "--description", "--requirements", "--state", "--show-handoff"], ["--show-handoff"]);
        const ticket = ticketFlags(flags);
        const state = requiredFlag(flags, "--state");
        if (!isWorkflowState(state)) {
          fail(`unknown workflow state ${JSON.stringify(state)}`);
        }
        const outcome = await deps.executeProjectManager({
          identity: { role: "project-manager" },
          input: {
            evidence: [{ ...ticket, state }],
            role: "project-manager",
            project_root: deps.projectRoot,
            provider,
            timeout_ms,
          },
        });
        return withHandoffOutput("project-manager", flags["--show-handoff"] !== undefined, outcome, describeProjectManager(outcome));
      }
      case "coordinator": {
        const flags = parseFlags(rest, [
          "--id",
          "--title",
          "--description",
          "--requirements",
          "--specialty",
          "--review-decision",
          "--review-feedback",
          "--show-handoff",
        ], ["--show-handoff"]);
        const base = ticketFlags(flags);
        const specialty = specialtyFlag(flags);
        const decideReview = parseCoordinatorDecision(flags) ?? deps.readReviewDecision;
        const outcome = await deps.executeCoordinator({
          identity: { role: "coordinator" },
          input: {
            tickets: [{ ...base, state: "ready" as const }],
            roles: {
              resolveImplementer: () => ({ role: "implementer", specialty, provider }),
              resolveSeniorReviewer: () => ({ role: "senior-reviewer", provider }),
            },
            project_root: deps.projectRoot,
            timeout_ms,
            decideReview,
          },
        });
        return withHandoffOutput("coordinator", flags["--show-handoff"] !== undefined, outcome, describeCoordinator(outcome));
      }
      default:
        return commandError(ROLE_USAGE);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return commandError(`role error: ${message}.\n`);
  }
}
