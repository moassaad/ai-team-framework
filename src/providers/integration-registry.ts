/**
 * Minimal integration registry (I-002).
 *
 * A catalog of supported integrations: register definitions by their
 * stable I-001 identifier, retrieve them by that identifier, and list
 * them in registration order. Nothing more.
 *
 * The registry performs no detection, setup, version lookup, or
 * outside calls, and it keeps no record of presence: whether
 * an integration is present, opted in, or usable is decided
 * elsewhere from fresh detection (later work). It uses the I-001
 * `Integration` contract directly and embeds no integration-specific
 * logic.
 */

import {
  Integration,
  validateIntegration,
} from "./integration";

function fail(what: string): never {
  throw new Error(`integration registry: ${what}`);
}

/**
 * Central catalog of supported integrations, backed by an internal
 * insertion-ordered map. Each instance is independent.
 */
export interface IntegrationRegistry {
  /** Register an integration definition. Rejects invalid or duplicate entries. */
  register(integration: Integration): void;
  /** Retrieve a registered integration by its stable identifier, if present. */
  get(name: string): Integration | undefined;
  /** List registered integrations in registration order. */
  list(): readonly Integration[];
}

/** Create an empty integration registry. */
export function createIntegrationRegistry(): IntegrationRegistry {
  const byName = new Map<string, Integration>();
  return Object.freeze({
    register(integration: Integration): void {
      const validated = validateIntegration(integration);
      if (byName.has(validated.name)) {
        fail(`duplicate integration ${JSON.stringify(validated.name)}`);
      }
      byName.set(validated.name, validated);
    },
    get(name: string): Integration | undefined {
      if (typeof name !== "string") {
        return undefined;
      }
      return byName.get(name);
    },
    list(): readonly Integration[] {
      return Object.freeze([...byName.values()]);
    },
  });
}
