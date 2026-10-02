/**
 * Derived integration runtime state (M17 U-001).
 *
 * The read-only composition seam between the M14 foundation
 * (`Integration`, registry, `detectIntegration`, desired-state
 * configuration) and the future `ai-team status` command: for every
 * registered integration, read desired state, perform one fresh
 * detection, and derive a small runtime view. No manager, no cache,
 * no taxonomy — one function reusing existing contracts:
 *
 * ```text
 * enabled    → desired state from configuration (caller-supplied)
 * detected   → current DetectionResult availability (fresh, per call)
 * ready      → derived: enabled && detected, nothing else
 * ```
 *
 * Detection absence (`available: false`) and detection failure (the
 * probe threw or broke its contract) stay distinct: failure is
 * never converted into `available: false`, and the state detail
 * carries a `detection failed: …` prefix so diagnostics remain
 * truthful through presentation. One broken integration never
 * hides the others — every entry is evaluated independently, in
 * registration order.
 *
 * Strictly read-only: no installation, no configuration, no
 * repair, no writes, no registry mutation, no persistence. The
 * only calls made are `registry.list()` and each integration's
 * own `detect()` (via `detectIntegration`); optional `install`,
 * `version`, and `configure` capabilities are never touched.
 *
 * `ai-team status` command wiring is deferred (see the note on
 * `formatIntegrationStatus`): the CLI entry point is synchronous
 * and pure, and assembling a production registry requires setup
 * decisions owned by U-002. This module proves the seam; the
 * command consumes it next.
 */

import { IntegrationRegistry } from "./integration-registry";
import { detectIntegration } from "./integration-detection";

/**
 * Derived runtime view of one registered integration. `enabled`
 * is what the user wants, `detected` is what fresh detection
 * found, `ready` is the conjunction — never anything more.
 * `detail` is human presentation only: detection detail when
 * available, `"disabled"` when not enabled, `"unavailable"` when
 * enabled but absent without detail, and `"detection failed: …"`
 * when detection itself failed.
 */
export interface IntegrationState {
  readonly name: string;
  readonly enabled: boolean;
  readonly detected: boolean;
  readonly ready: boolean;
  readonly detail?: string;
}

/** Status input. Desired state arrives as a function (I-004 at the caller); no config is read here. */
export interface IntegrationStatusInput {
  /** Registered integrations, evaluated in listing order. */
  readonly registry: IntegrationRegistry;
  /** Desired enabled state per integration name. Must return a boolean. */
  readonly isEnabled: (name: string) => boolean;
}

/** Detail prefix marking detection failure; shared with the formatter below. */
const DETECTION_FAILED_PREFIX = "detection failed: " as const;

function fail(what: string): never {
  throw new Error(`integration status: ${what}`);
}

function isRegistry(value: unknown): value is IntegrationRegistry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as IntegrationRegistry).list === "function" &&
    typeof (value as IntegrationRegistry).get === "function"
  );
}

function stateFor(
  name: string,
  enabled: boolean,
  detected: boolean,
  detail: string | undefined,
): IntegrationState {
  const state: IntegrationState = {
    name,
    enabled,
    detected,
    ready: enabled && detected,
  };
  if (detail !== undefined) {
    return Object.freeze({ ...state, detail });
  }
  return Object.freeze(state);
}

/**
 * Evaluate every registered integration once: fresh detection per
 * entry, desired state per name, derived readiness per entry.
 * Sequential, deterministic, side-effect free beyond the
 * integrations' own read-only detection. Never rejects for a
 * broken optional integration — its failure becomes its state.
 */
export async function getIntegrationStatus(
  input: IntegrationStatusInput,
): Promise<readonly IntegrationState[]> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a status input object");
  }
  if (!isRegistry(input.registry)) {
    fail("registry must be an integration registry");
  }
  if (typeof input.isEnabled !== "function") {
    fail("isEnabled must be a function");
  }
  const entries = input.registry.list();
  const states: IntegrationState[] = [];
  for (const entry of entries) {
    const enabled = input.isEnabled(entry.name);
    if (typeof enabled !== "boolean") {
      fail(`isEnabled must return a boolean for ${JSON.stringify(entry.name)}`);
    }
    const outcome = await detectIntegration(input.registry, entry.name);
    if (outcome.status === "failed") {
      states.push(
        stateFor(entry.name, enabled, false, `${DETECTION_FAILED_PREFIX}${outcome.error}`),
      );
      continue;
    }
    if (!enabled) {
      states.push(stateFor(entry.name, false, outcome.result.available, "disabled"));
      continue;
    }
    if (outcome.result.available) {
      states.push(
        stateFor(
          entry.name,
          true,
          true,
          typeof outcome.result.detail === "string" && outcome.result.detail.length > 0
            ? outcome.result.detail
            : undefined,
        ),
      );
      continue;
    }
    states.push(
      stateFor(
        entry.name,
        true,
        false,
        typeof outcome.result.detail === "string" && outcome.result.detail.length > 0
          ? outcome.result.detail
          : "unavailable",
      ),
    );
  }
  return Object.freeze(states);
}

/**
 * Render evaluated states as plain CLI lines (no table framework).
 * Pure presentation for the deferred `ai-team status` command:
 * every state maps to exactly one line naming its condition —
 * `ready`, `disabled`, `unavailable`, or `detection failed` —
 * with the state's own detail where it adds information. An empty
 * registry reports itself truthfully instead of printing nothing.
 */
export function formatIntegrationStatus(states: readonly IntegrationState[]): string {
  if (!Array.isArray(states)) {
    fail("states must be an array");
  }
  if (states.length === 0) {
    return "No integrations registered.\n";
  }
  const lines = ["Integration status:"];
  for (const state of states) {
    if (typeof state !== "object" || state === null || typeof state.name !== "string") {
      fail("states must contain integration states");
    }
    let word: string;
    let extra: string | undefined;
    if (state.ready) {
      word = "ready";
      extra = state.detail;
    } else if (!state.enabled) {
      word = "disabled";
    } else if (
      typeof state.detail === "string" &&
      state.detail.startsWith(DETECTION_FAILED_PREFIX)
    ) {
      word = "detection failed";
      const cause = state.detail.slice(DETECTION_FAILED_PREFIX.length);
      extra = cause.length > 0 ? cause : undefined;
    } else {
      word = "unavailable";
      extra = state.detail === "unavailable" ? undefined : state.detail;
    }
    lines.push(extra === undefined ? `${state.name}: ${word}` : `${state.name}: ${word} (${extra})`);
  }
  return `${lines.join("\n")}\n`;
}
