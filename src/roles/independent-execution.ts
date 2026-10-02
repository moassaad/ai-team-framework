/**
 * Independent role execution contract (M22 T-005).
 *
 * The smallest generic boundary that invokes exactly one role
 * without constructing or invoking the rest of the team:
 *
 *   caller-supplied identity + optional handoff + complete seam input
 *     → identity/role gate, handoff gate
 *     → one call into the existing role-specific seam
 *     → the seam's own outcome, carried with its authorizing handoff
 *
 * Five thin entry points (`executeIndependentCoordinator`,
 * `executeIndependentProjectManager`,
 * `executeIndependentTechnicalLead`,
 * `executeIndependentImplementer`,
 * `executeIndependentSeniorReviewer`) share one private gate and
 * delegate everything else to the proven seams
 * (`runCoordinatorTicket`, `executePmUserTesting`,
 * `executeTechnicalLeadReview`, `executeImplementerTicket`,
 * `executeReviewerTicket`). No seam is replaced, no prompt is
 * reinvented, no second role is ever invoked: the Coordinator
 * entry only reuses what `runCoordinatorTicket` intrinsically
 * does, and every other entry performs exactly one underlying
 * provider call with no retry, no fallback, and no persistence.
 *
 * Identity is explicit and validated (`AgentIdentity`); a mismatch
 * between the supplied identity and the entry point's role fails
 * before anything executes. A supplied handoff is validated
 * (`validateAgentHandoff`) and receiver-matched
 * (`handoff.to === identity.role`); the sender needs no local
 * session — a PM handoff consumed by an independent TL invocation
 * is the normal case, not an error. Direct execution without a
 * handoff is fully supported wherever the seam input allows it.
 *
 * Deliberate non-mapping: handoff fields are NOT merged into seam
 * inputs. Ticket and evidence shapes require caller-owned ids and
 * workflow states no handoff carries, and inventing a merge policy
 * (concatenation, precedence, id synthesis) would violate the
 * no-invention rule — so the validated handoff gates the
 * invocation and travels on the outcome as provenance, while the
 * caller keeps building seam inputs explicitly. Field-level
 * handoff-to-input mapping is deferred to the planning/task
 * tickets that own those semantics (M23/M24), reported rather
 * than guessed.
 */

import { RoleId } from "./contract";
import { AgentHandoff } from "./handoff";
import { identityMatchesRole, validateAgentIdentity } from "./identity";
import { validateAgentHandoff } from "./handoff-validation";
import { executeImplementerTicket, ImplementerExecution, ImplementerExecutionInput } from "../execution/implementer";
import { executeReviewerTicket, ReviewerExecution, ReviewerExecutionInput } from "../execution/reviewer";
import {
  executeTechnicalLeadReview,
  TechnicalLeadExecution,
  TechnicalLeadExecutionInput,
} from "../execution/technical-lead";
import {
  executePmUserTesting,
  PmUserTestingExecution,
  PmUserTestingExecutionInput,
} from "../execution/pm-testing";
import { runCoordinatorTicket, CoordinatorRuntimeInput, CoordinatorTicketResult } from "../runtime/coordinator";

function fail(what: string): never {
  throw new Error(`independent role execution: ${what}`);
}

/**
 * One independent invocation: an explicit identity, an optional
 * canonical handoff, and the complete input the role's existing
 * seam requires. Nothing is inferred; nothing is defaulted.
 */
export interface IndependentRoleCall<TInput> {
  readonly identity: unknown;
  readonly handoff?: unknown;
  readonly input: TInput;
}

/**
 * One independent result: the role performed, the seam's own
 * outcome preserved verbatim, and the validated handoff that
 * authorized the invocation when one was supplied. Frozen.
 */
export interface IndependentRoleOutcome<TResult> {
  readonly role: RoleId;
  readonly execution: TResult;
  readonly handoff?: AgentHandoff;
}

/**
 * Shared gate: validate the identity, require it to be this
 * entry point's role, and — when a handoff is supplied — validate
 * it and require it to address this role. Throws before any
 * provider invocation; mutates nothing.
 */
function requireIndependentCall(role: RoleId, identity: unknown, handoff: unknown): AgentHandoff | undefined {
  const validatedIdentity = validateAgentIdentity(identity);
  if (!identityMatchesRole(validatedIdentity, role)) {
    fail(`identity role ${JSON.stringify(validatedIdentity.role)} cannot invoke independent ${role} execution`);
  }
  if (handoff === undefined) {
    return undefined;
  }
  const validatedHandoff = validateAgentHandoff(handoff);
  if (validatedHandoff.to !== role) {
    fail(`handoff addresses ${JSON.stringify(validatedHandoff.to)} and cannot authorize independent ${role} execution`);
  }
  return validatedHandoff;
}

function carryOutcome<TResult>(role: RoleId, execution: TResult, handoff: AgentHandoff | undefined): IndependentRoleOutcome<TResult> {
  const outcome: { role: RoleId; execution: TResult; handoff?: AgentHandoff } = { role, execution };
  if (handoff !== undefined) {
    outcome.handoff = handoff;
  }
  return Object.freeze(outcome);
}

/**
 * Invoke the Implementer independently: one existing Implementer
 * ticket execution, exactly one provider attempt, no retry.
 */
export async function executeIndependentImplementer(
  call: IndependentRoleCall<ImplementerExecutionInput>,
): Promise<IndependentRoleOutcome<ImplementerExecution>> {
  const handoff = requireIndependentCall("implementer", call.identity, call.handoff);
  return carryOutcome("implementer", await executeImplementerTicket(call.input), handoff);
}

/**
 * Invoke the Senior Reviewer independently: one existing review,
 * opaque report preserved, exactly one provider attempt. Never
 * becomes a rework controller: no follow-up invocation happens
 * here regardless of the report.
 */
export async function executeIndependentSeniorReviewer(
  call: IndependentRoleCall<ReviewerExecutionInput>,
): Promise<IndependentRoleOutcome<ReviewerExecution>> {
  const handoff = requireIndependentCall("senior-reviewer", call.identity, call.handoff);
  return carryOutcome("senior-reviewer", await executeReviewerTicket(call.input), handoff);
}

/**
 * Invoke the Technical Lead independently through the existing
 * TL review seam. This establishes invocability, not planning:
 * architecture planning and task decomposition belong to M23/M24.
 */
export async function executeIndependentTechnicalLead(
  call: IndependentRoleCall<TechnicalLeadExecutionInput>,
): Promise<IndependentRoleOutcome<TechnicalLeadExecution>> {
  const handoff = requireIndependentCall("technical-lead", call.identity, call.handoff);
  return carryOutcome("technical-lead", await executeTechnicalLeadReview(call.input), handoff);
}

/**
 * Invoke the Project Manager independently through the existing
 * PM/User Testing seam. This establishes invocability, not
 * planning: requirements/scope planning belongs to M23/T-007.
 */
export async function executeIndependentProjectManager(
  call: IndependentRoleCall<PmUserTestingExecutionInput>,
): Promise<IndependentRoleOutcome<PmUserTestingExecution>> {
  const handoff = requireIndependentCall("project-manager", call.identity, call.handoff);
  return carryOutcome("project-manager", await executePmUserTesting(call.input), handoff);
}

/**
 * Invoke the Coordinator independently as a thin boundary around
 * the existing ticket runtime. Not a planning agent (M23/T-006
 * owns that): the same ticket execution the Coordinator already
 * performs, gated by an explicit Coordinator identity and an
 * optional handoff. Caller tickets are defensively copied first —
 * the runtime advances ticket state in place by design, and an
 * independent invocation must never mutate caller-owned data.
 */
export async function executeIndependentCoordinator(
  call: IndependentRoleCall<CoordinatorRuntimeInput>,
): Promise<IndependentRoleOutcome<CoordinatorTicketResult>> {
  const handoff = requireIndependentCall("coordinator", call.identity, call.handoff);
  const input: CoordinatorRuntimeInput = {
    ...call.input,
    tickets: call.input.tickets.map((ticket) => ({ ...ticket })),
  };
  return carryOutcome("coordinator", await runCoordinatorTicket(input), handoff);
}
