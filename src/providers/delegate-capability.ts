/**
 * Delegation Capability Detection (M26 T-024).
 *
 * Read-only composition over existing contracts — nothing new is
 * detected here and no new status model is introduced:
 *
 * - detection itself is the D-102 skill integration
 *   (`createDelegateSkillIntegration`: skill descriptor + relay
 *   presence plus read-only implementer/git version probes, never
 *   dispatching, never installing);
 * - desired state is the caller's `isEnabled` function (the I-004
 *   pattern; production reads `providers.delegate.enabled`,
 *   default false, never auto-enabled);
 * - derivation is the M17 `getIntegrationStatus` seam
 *   (`enabled` → wanted, `detected` → fresh availability,
 *   `ready` → the conjunction, `detection failed:` stays
 *   distinct from unavailable).
 *
 * `checkDelegateCapability` takes one caller-supplied delegate
 * integration (which must carry the stable `"delegate"`
 * identity), registers it in a fresh per-call registry, evaluates
 * it through `getIntegrationStatus`, and returns the single
 * frozen state plus the one capability fact T-022 established:
 * delegate transport supports `implementer` destinations only.
 * Global vs project scope lives entirely in the caller's
 * `isEnabled` function; skill selection lives in the supplied
 * integration. The production `ai-team status` registry
 * intentionally stays untouched — no configuration names a
 * skill, its implementer, or its roots, and inventing any of
 * them would be setup behavior.
 *
 * Strictly read-only: no installation, no configuration writes,
 * no dispatch, no relay execution, no fallback, no persistence.
 * Authentication is not probed (no safe read-only signal
 * exists); availability always carries that limitation via the
 * detector's own detail.
 */

import { isIntegration } from "./integration";
import { createIntegrationRegistry } from "./integration-registry";
import { getIntegrationStatus } from "./integration-status";
import { DELEGATE_SKILLS_INTEGRATION_NAME } from "./delegate-detection";

/** Delegate-transport destinations T-022 supports: implementer only. */
export const DELEGATE_SUPPORTED_DESTINATIONS = Object.freeze(["implementer"] as const);

export type DelegateSupportedDestination = (typeof DELEGATE_SUPPORTED_DESTINATIONS)[number];

export interface DelegateCapabilityInput {
  /**
   * Caller-supplied delegate integration, normally built by
   * `createDelegateSkillIntegration` with an explicit skill name,
   * implementer command, and skill roots. Must carry the stable
   * delegate identity; anything else is a caller error.
   */
  readonly integration: unknown;
  /** Desired enabled state per integration name; must return a boolean. */
  readonly isEnabled: (name: string) => boolean;
}

/**
 * One delegation capability state. The `enabled`, `detected`,
 * `ready`, and `detail` fields are the M17 `IntegrationState`
 * semantics verbatim; `supportedDestinations` records the
 * implementer-only transport capability without becoming
 * workflow state.
 */
export interface DelegateCapability {
  readonly name: typeof DELEGATE_SKILLS_INTEGRATION_NAME;
  readonly enabled: boolean;
  readonly detected: boolean;
  readonly ready: boolean;
  readonly detail?: string;
  readonly supportedDestinations: readonly [DelegateSupportedDestination];
}

function fail(what: string): never {
  throw new Error(`delegate capability: ${what}`);
}

/**
 * Evaluate delegation capability once: register the supplied
 * delegate integration in a fresh registry, run the existing
 * status derivation (one fresh detection, caller-supplied
 * desired state), and return the frozen capability. Never
 * rejects for an unavailable integration — absence is a state,
 * not an exception. Invalid input (non-integration, wrong
 * identity, non-function `isEnabled`) throws as a caller error.
 */
export async function checkDelegateCapability(
  input: DelegateCapabilityInput,
): Promise<DelegateCapability> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a capability input object");
  }
  if (!isIntegration(input.integration)) {
    fail("integration must satisfy the integration contract");
  }
  if (input.integration.name !== DELEGATE_SKILLS_INTEGRATION_NAME) {
    fail(
      `integration must carry the delegate identity ${JSON.stringify(DELEGATE_SKILLS_INTEGRATION_NAME)}, got ${JSON.stringify(input.integration.name)}`,
    );
  }
  if (typeof input.isEnabled !== "function") {
    fail("isEnabled must be a function");
  }
  const registry = createIntegrationRegistry();
  registry.register(input.integration);
  const states = await getIntegrationStatus({ registry, isEnabled: input.isEnabled });
  const state = states[0];
  return Object.freeze({
    name: DELEGATE_SKILLS_INTEGRATION_NAME,
    enabled: state.enabled,
    detected: state.detected,
    ready: state.ready,
    ...(state.detail !== undefined ? { detail: state.detail } : {}),
    supportedDestinations: DELEGATE_SUPPORTED_DESTINATIONS,
  } as const);
}
