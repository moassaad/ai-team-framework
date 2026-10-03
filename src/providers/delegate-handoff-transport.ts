/**
 * delegate-skills Handoff Adapter (M26 T-022).
 *
 * The one adapter that presents delegate-skills as a generic
 * T-021 `HandoffTransport`:
 *
 *   validated AgentHandoff → brief → DelegateProvider → receipt
 *
 * The caller supplies an already-configured `DelegateProvider`
 * (for example a relay provider built by
 * `createDelegateRelayProvider` with an explicit `skillRoot`,
 * `projectRoot`, and optional skill-specific `model`). Relay
 * discovery, skill installation, fleet setup, and capability
 * detection all stay outside this module: construction takes the
 * provider object, never a path to search, and dispatch never
 * installs, configures, or detects anything.
 *
 * Handoff → brief mapping (explicit; every canonical field has a
 * recorded disposition, none silently dropped):
 *
 * | Handoff field       | Brief disposition                                  |
 * |---------------------|----------------------------------------------------|
 * | from                | provenance header (`Delegated handoff from X`)     |
 * | to                  | must be `implementer`; anything else is rejected   |
 * | objective           | task goal (required head of the task text)         |
 * | context             | `DelegationRequest.context` verbatim               |
 * | requirements        | labeled `Requirements:` task section               |
 * | acceptance_criteria | labeled `Acceptance criteria:` task section        |
 * | constraints         | labeled `Constraints:` task section                |
 * | artifacts           | labeled `Artifacts:` task section                  |
 * | notes               | labeled `Notes:` task section                      |
 * | next_action         | labeled `Next action:` task section                |
 *
 * Empty sections are omitted; nothing is invented, nothing is
 * read from opaque provider reports, and the handoff itself is
 * never mutated. The brief text is derived from structured
 * handoff fields only. The relay provider owns the temp brief
 * file, the no-shell relay invocation, `--cd` project-root
 * selection, and temp-dir cleanup; the structured `result.json`
 * contract (`mapDelegateRelayResult`) is consumed as
 * machine data, and its opaque `outcome` text rides the adapter
 * receipt verbatim — never parsed for framework decisions.
 *
 * Destination support: delegate-skills delegates implementation
 * work, so only `handoff.to === "implementer"` dispatches. Any
 * other destination rejects with a `kind: "unsupported"` error
 * (which the T-021 dispatcher preserves on its bounded `failed`
 * result): no retargeting, no wrong-role execution, no local
 * fallback. Fallback belongs to T-025, detection to T-024.
 */

import { AgentHandoff } from "../roles/handoff";
import { validateAgentHandoff } from "../roles/handoff-validation";
import { HandoffTransport } from "../runtime/handoff-dispatcher";
import {
  DelegateProvider,
  DelegationRequest,
  isDelegateProvider,
  validateDelegationRequest,
  validateDelegationResult,
} from "./delegate";

/** Stable transport name identifying the delegate-skills adapter. */
export const DELEGATE_SKILLS_TRANSPORT_NAME = "delegate-skills";

export interface DelegateSkillsHandoffTransportOptions {
  /** Already-configured delegate provider; validated by shape. */
  readonly provider: unknown;
}

function fail(what: string): never {
  throw new Error(`delegate-skills handoff adapter: ${what}`);
}

function section(title: string, entries: readonly string[]): string[] {
  if (entries.length === 0) {
    return [];
  }
  return ["", `${title}`, ...entries];
}

function optionalSection(title: string, value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return ["", `${title}`, value];
}

/**
 * Render the canonical handoff as delegate brief task text. Pure,
 * deterministic, structured-fields-only. Empty sections are
 * omitted; the objective always heads the task.
 */
export function renderHandoffBrief(handoff: AgentHandoff): string {
  const validated = validateAgentHandoff(handoff);
  return [
    `Delegated handoff from ${validated.from} to ${validated.to}.`,
    "",
    validated.objective,
    ...section("Requirements:", validated.requirements ?? []),
    ...section("Acceptance criteria:", validated.acceptance_criteria ?? []),
    ...section("Constraints:", validated.constraints ?? []),
    ...section("Artifacts:", validated.artifacts ?? []),
    ...optionalSection("Notes:", validated.notes),
    ...optionalSection("Next action:", validated.next_action),
  ].join("\n");
}

/**
 * Build one delegate-skills handoff transport around an
 * explicitly supplied delegation provider. Construction
 * validates the provider shape and nothing else; every
 * `dispatch` validates the handoff, rejects non-implementer
 * destinations as unsupported, renders the brief, delegates
 * exactly once, and resolves with the opaque relay outcome as
 * its receipt. Never installs, detects, retries, falls back,
 * persists, or executes locally.
 */
export function createDelegateSkillsHandoffTransport(
  options: DelegateSkillsHandoffTransportOptions,
): HandoffTransport {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    fail("expected an options object");
  }
  if (!isDelegateProvider(options.provider)) {
    fail("provider must satisfy the delegation provider contract");
  }
  const provider: DelegateProvider = options.provider;

  async function dispatch(handoff: AgentHandoff): Promise<unknown> {
    const validated = validateAgentHandoff(handoff);
    if (validated.to !== "implementer") {
      const refusal = new Error(
        `delegate-skills dispatches implementation work only; handoff targets ${JSON.stringify(validated.to)}`,
      );
      (refusal as { kind?: string }).kind = "unsupported";
      throw refusal;
    }
    const request: DelegationRequest = validateDelegationRequest({
      task: renderHandoffBrief(validated),
      ...(validated.context !== undefined ? { context: validated.context } : {}),
    });
    const result = validateDelegationResult(await provider.delegate(request));
    return Object.freeze({ outcome: result.outcome });
  }

  return Object.freeze({ name: DELEGATE_SKILLS_TRANSPORT_NAME, dispatch });
}
