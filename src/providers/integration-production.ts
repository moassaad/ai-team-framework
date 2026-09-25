/**
 * Production integration registry (M17 U-002).
 *
 * The one explicit place where the real application assembles the
 * integrations `ai-team status` reports on. Construction is
 * deterministic and side-effect free: it validates its input,
 * creates a fresh registry via `createIntegrationRegistry()`, and
 * registers each constructible integration in explicit order. No
 * detection runs here, nothing is installed or configured, and no
 * filesystem state is inspected beyond what the factories
 * themselves need at construction (none — they only validate
 * options).
 *
 * Only Spec Kit is registered: it is the sole integration whose
 * factory (`createSpecKitIntegration`) is fully determined by the
 * project root with safe defaults. Delegate selection is
 * intentionally absent — D-102 is one requested skill per
 * instance, and no existing configuration names a skill, its
 * implementer, or its roots, so inventing any of them here would
 * be setup behavior owned by the next ticket. OpenCode is absent
 * because it exposes an execution provider (`AgentProvider`),
 * not an `Integration` adapter, and no adapter may be invented
 * here. Nothing is fabricated to fill the gaps: whatever is
 * registered is exactly what status reports.
 */

import {
  IntegrationRegistry,
  createIntegrationRegistry,
} from "./integration-registry";
import {
  createSpecKitIntegration,
} from "./speckit-detection";

/** Production registry input. Everything assembly needs, nothing more. */
export interface ProductionRegistryInput {
  /** Target project root; forwarded to factories that need it. */
  readonly projectRoot: string;
}

function fail(what: string): never {
  throw new Error(`production registry: ${what}`);
}

/**
 * Build a fresh production registry for one project root. Every
 * call returns an independent registry; nothing is shared or
 * retained between calls, and construction performs no detection,
 * installation, configuration, or I/O.
 */
export function createProductionRegistry(
  input: ProductionRegistryInput,
): IntegrationRegistry {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a registry input object");
  }
  if (typeof input.projectRoot !== "string" || input.projectRoot.length === 0) {
    fail("projectRoot must be a non-empty string");
  }
  const registry = createIntegrationRegistry();
  registry.register(createSpecKitIntegration({ projectRoot: input.projectRoot }));
  return registry;
}
