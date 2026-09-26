/**
 * Integration setup planning and confirmation foundation (M17 U-003).
 *
 * The smallest provider-agnostic setup seam, following the
 * lifecycle Detect → Explain → Confirm → Install/Configure →
 * Verify. Two functions, no framework:
 *
 * - `planIntegrationSetup` is read-only: one fresh detection plus
 *   declared-capability inspection produces a bounded,
 *   user-showable plan. It never mutates anything.
 * - `runIntegrationSetup` executes one plan: it re-plans (one
 *   fresh detection), requires an explicit caller-supplied
 *   `confirmed` decision before any mutation, invokes exactly one
 *   declared capability at most once, then verifies with one more
 *   fresh detection. The final result always comes from the
 *   verification detection — never from a bare command exit.
 *
 * Capability rules, from the integration's own declarations
 * (checked with `supportsCapability`, never assumed):
 *
 * ```text
 * already ready (enabled + available)      → no-op, nothing invoked
 * available but disabled                   → no-op, configuration untouched
 * detection failed                         → no mutation, failure retained
 * unavailable + install declared           → propose install
 * unavailable + configure only             → propose configure
 * unavailable + neither                    → bounded inability
 * ```
 *
 * An integration declaring both install and configure gets
 * install only: availability is about presence, and no current
 * provider justifies a combined sequence. `configure()` is
 * invoked with `undefined` settings — providers needing settings
 * belong to a later ticket. No retries, no polling, no repair,
 * no shelling out (provider command details stay inside the
 * provider), no delegate skill/fleet/model invention, no
 * configuration redesign. The interactive `ai-team setup`
 * command that will consume this seam is a later ticket.
 */

import {
  supportsCapability,
} from "./integration";
import { IntegrationRegistry } from "./integration-registry";
import { detectIntegration } from "./integration-detection";

/** Proposed mutation, or null when setup proposes nothing. */
export type SetupAction = "install" | "configure";

/** Bounded machine-readable reason for a plan. */
export type SetupReason =
  | "already-ready"
  | "available-but-disabled"
  | "detection-failed"
  | "no-mutation-capability"
  | "proposed-install"
  | "proposed-configure";

/**
 * What setup intends to do, produced before any confirmation.
 * Read-only: safe to show to the user and safe to discard.
 */
export interface SetupPlan {
  readonly integration: string;
  readonly enabled: boolean;
  readonly detected: boolean;
  readonly detectionFailed: boolean;
  readonly detail?: string;
  readonly action: SetupAction | null;
  readonly reason: SetupReason;
  readonly explanation: string;
  readonly confirmationRequired: boolean;
}

/** Plan input. The integration is selected by name; nothing is inferred. */
export interface SetupPlanInput {
  readonly registry: IntegrationRegistry;
  readonly name: string;
  readonly isEnabled: (name: string) => boolean;
}

/** Run input. `confirmed` is the caller's explicit decision; absence is never approval. */
export interface SetupRunInput extends SetupPlanInput {
  readonly confirmed: boolean;
}

/**
 * Setup outcome. Extends the executed plan with what actually
 * happened: `mutated` tells whether a capability ran, `verified`
 * tells whether verification detection ran, and `message` is the
 * bounded human result. After a mutation, `detected`,
 * `detectionFailed`, and `detail` always come from the
 * verification detection.
 */
export interface SetupResult extends SetupPlan {
  readonly mutated: boolean;
  readonly verified: boolean;
  readonly message: string;
}

function fail(what: string): never {
  throw new Error(`integration setup: ${what}`);
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0];
}

function isRegistry(value: unknown): value is IntegrationRegistry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as IntegrationRegistry).list === "function" &&
    typeof (value as IntegrationRegistry).get === "function"
  );
}

function validatedInput(input: SetupPlanInput): { registry: IntegrationRegistry; name: string; enabled: boolean } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a setup input object");
  }
  if (!isRegistry(input.registry)) {
    fail("registry must be an integration registry");
  }
  if (typeof input.name !== "string" || input.name.length === 0) {
    fail("name must be a non-empty string");
  }
  if (typeof input.isEnabled !== "function") {
    fail("isEnabled must be a function");
  }
  if (input.registry.get(input.name) === undefined) {
    fail(`unknown integration ${JSON.stringify(input.name)}`);
  }
  const enabled = input.isEnabled(input.name);
  if (typeof enabled !== "boolean") {
    fail(`isEnabled must return a boolean for ${JSON.stringify(input.name)}`);
  }
  return { registry: input.registry, name: input.name, enabled };
}

function describeDetail(detail: string | undefined, fallback: string): string {
  return typeof detail === "string" && detail.length > 0 ? detail : fallback;
}

function buildPlan(
  name: string,
  enabled: boolean,
  detected: boolean,
  detectionFailed: boolean,
  detail: string | undefined,
  action: SetupAction | null,
  reason: SetupReason,
  explanation: string,
): SetupPlan {
  const plan: SetupPlan = {
    integration: name,
    enabled,
    detected,
    detectionFailed,
    action,
    reason,
    explanation,
    confirmationRequired: action !== null,
  };
  if (detail !== undefined) {
    return Object.freeze({ ...plan, detail });
  }
  return Object.freeze(plan);
}

/**
 * Plan setup for one named integration. One fresh detection, then
 * declared-capability inspection. Read-only: never installs,
 * configures, repairs, retries, or writes.
 */
export async function planIntegrationSetup(input: SetupPlanInput): Promise<SetupPlan> {
  const { registry, name, enabled } = validatedInput(input);
  const outcome = await detectIntegration(registry, name);
  if (outcome.status === "failed") {
    const detail = `detection failed: ${outcome.error}`;
    return buildPlan(
      name, enabled, false, true, detail, null, "detection-failed",
      `${name} detection failed (${outcome.error}); nothing will be changed.`,
    );
  }
  const detected = outcome.result.available;
  const detail = describeDetail(outcome.result.detail, detected ? "available" : "unavailable");
  if (enabled && detected) {
    return buildPlan(
      name, true, true, false, detail, null, "already-ready",
      `${name} is already ready (enabled, detected: ${detail}); nothing to do.`,
    );
  }
  if (!enabled && detected) {
    return buildPlan(
      name, false, true, false, detail, null, "available-but-disabled",
      `${name} is available but disabled; leaving configuration unchanged.`,
    );
  }
  const entry = registry.get(name);
  if (entry !== undefined && supportsCapability(entry, "install")) {
    return buildPlan(
      name, enabled, false, false, detail, "install", "proposed-install",
      `${name} is unavailable (${detail}); proposes install (a capability the integration declares). Confirmation required before anything changes.`,
    );
  }
  if (entry !== undefined && supportsCapability(entry, "configure")) {
    return buildPlan(
      name, enabled, false, false, detail, "configure", "proposed-configure",
      `${name} is unavailable (${detail}); proposes configure (a capability the integration declares). Confirmation required before anything changes.`,
    );
  }
  return buildPlan(
    name, enabled, false, false, detail, null, "no-mutation-capability",
    `${name} is unavailable (${detail}) and exposes no install or configure capability; cannot set up automatically.`,
  );
}

/**
 * Execute one setup: plan, confirm, mutate at most once, verify.
 * Unconfirmed or mutation-free plans return without touching
 * anything. A mutation failure returns a bounded failure with no
 * verification; a completed mutation is always followed by one
 * fresh verification detection whose result decides the outcome.
 */
export async function runIntegrationSetup(input: SetupRunInput): Promise<SetupResult> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a setup input object");
  }
  if (typeof (input as { confirmed?: unknown }).confirmed !== "boolean") {
    fail("confirmed must be a boolean");
  }
  const confirmed = (input as { confirmed: boolean }).confirmed;
  const plan = await planIntegrationSetup(input);
  const unrun: SetupResult = Object.freeze({
    ...plan,
    mutated: false,
    verified: false,
    message: plan.explanation,
  });
  if (plan.action === null) {
    return unrun;
  }
  if (!confirmed) {
    return Object.freeze({
      ...unrun,
      message: `setup of ${plan.integration} requires explicit confirmation; nothing was changed.`,
    });
  }
  const registry = (validatedInput(input).registry);
  const entry = registry.get(plan.integration);
  try {
    if (plan.action === "install") {
      const install = entry?.install;
      if (typeof install !== "function") {
        fail(`integration ${JSON.stringify(plan.integration)} no longer declares install`);
      }
      await (install as () => Promise<void>)();
    } else {
      const configure = entry?.configure;
      if (typeof configure !== "function") {
        fail(`integration ${JSON.stringify(plan.integration)} no longer declares configure`);
      }
      await (configure as (settings: unknown) => Promise<void>)(undefined);
    }
  } catch (error: unknown) {
    return Object.freeze({
      ...plan,
      mutated: true,
      verified: false,
      message: `${plan.action} of ${plan.integration} failed: ${errorMessage(error)}; nothing was verified.`,
    });
  }
  const verification = await detectIntegration(registry, plan.integration);
  if (verification.status === "failed") {
    const detail = `detection failed: ${verification.error}`;
    return Object.freeze({
      ...plan,
      detected: false,
      detectionFailed: true,
      detail,
      mutated: true,
      verified: true,
      message: `${plan.action} of ${plan.integration} completed but verification detection failed (${verification.error}).`,
    });
  }
  if (verification.result.available) {
    const detail = describeDetail(verification.result.detail, "available");
    return Object.freeze({
      ...plan,
      detected: true,
      detectionFailed: false,
      detail,
      mutated: true,
      verified: true,
      message: `${plan.action} of ${plan.integration} completed and verified: ${detail}.`,
    });
  }
  const detail = describeDetail(verification.result.detail, "unavailable");
  return Object.freeze({
    ...plan,
    detected: false,
    detectionFailed: false,
    detail,
    mutated: true,
    verified: true,
    message: `${plan.action} of ${plan.integration} completed but verification still reports unavailable (${detail}); not treated as success.`,
  });
}
