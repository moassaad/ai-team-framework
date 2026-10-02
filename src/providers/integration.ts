/**
 * Minimal integration contract (I-001).
 *
 * A capability-based boundary between the core framework and optional
 * external integrations. An integration declares which capabilities it
 * provides; only `detect` is required. `version`, `install`, and
 * `configure` are optional and must not be assumed present.
 *
 * Deliberately excluded: integration state and user configuration.
 * This module defines the fresh `DetectionResult` only. Stored status
 * is derived by the framework from fresh detection (later work), and
 * user configuration lives in the existing config system — neither
 * is a field here, and neither may override a fresh detection.
 *
 * Provider-specific logic stays in concrete adapters; this module
 * names no external tool and imports no provider.
 */

export const INTEGRATION_CAPABILITIES = ["detect", "version", "install", "configure"] as const;
export type IntegrationCapability = (typeof INTEGRATION_CAPABILITIES)[number];

/** True for declared capability names. */
export function isIntegrationCapability(value: unknown): value is IntegrationCapability {
  return (
    typeof value === "string" &&
    (INTEGRATION_CAPABILITIES as readonly string[]).includes(value)
  );
}

/**
 * Fresh detection output. Says whether the integration is currently
 * available, with optional human-readable detail. Carries no
 * configuration and no stored status.
 */
export interface DetectionResult {
  readonly available: boolean;
  readonly detail?: string;
}

function fail(what: string): never {
  throw new Error(`integration: invalid input (${what})`);
}

/** True for values shaped like a detection result. */
export function isDetectionResult(value: unknown): value is DetectionResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.available === "boolean" &&
    (candidate.detail === undefined || typeof candidate.detail === "string")
  );
}

/**
 * Validate raw data as a detection result and return a frozen copy.
 * Unknown fields are dropped: detection carries no configuration.
 */
export function validateDetectionResult(data: unknown): DetectionResult {
  if (!isDetectionResult(data)) {
    fail("expected a detection result with a boolean available field");
  }
  const raw = data as unknown as Record<string, unknown>;
  const result: DetectionResult = { available: data.available };
  if (typeof raw.detail === "string") {
    (result as { detail?: string }).detail = raw.detail;
  }
  return Object.freeze(result);
}

/**
 * Generic integration boundary. `capabilities` must include "detect";
 * every other capability is optional. Each declared capability must
 * be backed by its function; undeclared capabilities must not be
 * assumed present.
 */
export interface Integration {
  readonly name: string;
  readonly capabilities: readonly IntegrationCapability[];
  detect(): DetectionResult | Promise<DetectionResult>;
  version?(): string | Promise<string>;
  install?(): Promise<void>;
  configure?(settings: unknown): Promise<void>;
}

/** True for values shaped like an integration with a detect function. */
export function isIntegration(value: unknown): value is Integration {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    (candidate.name as string).length > 0 &&
    Array.isArray(candidate.capabilities) &&
    typeof candidate.detect === "function"
  );
}

const CAPABILITY_METHODS: Record<IntegrationCapability, string> = {
  detect: "detect",
  version: "version",
  install: "install",
  configure: "configure",
};

/**
 * Validate raw data as an integration and return a frozen copy.
 * Rejects missing names, unknown or duplicated capabilities, a
 * missing "detect" declaration, and declared capabilities without
 * their backing function.
 */
export function validateIntegration(data: unknown): Integration {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  if (typeof raw.name !== "string" || raw.name.length === 0) {
    fail("name must be a non-empty string");
  }
  if (!Array.isArray(raw.capabilities)) {
    fail("capabilities must be an array");
  }
  const seen = new Set<string>();
  for (const entry of raw.capabilities) {
    if (!isIntegrationCapability(entry)) {
      fail(`unknown capability ${JSON.stringify(entry)}`);
    }
    if (seen.has(entry)) {
      fail(`duplicate capability ${JSON.stringify(entry)}`);
    }
    seen.add(entry);
  }
  if (!seen.has("detect")) {
    fail('capabilities must include "detect"');
  }
  for (const capability of seen) {
    const method = CAPABILITY_METHODS[capability as IntegrationCapability];
    if (typeof raw[method] !== "function") {
      fail(`declared capability ${JSON.stringify(capability)} has no ${method} function`);
    }
  }
  return Object.freeze({
    name: raw.name,
    capabilities: Object.freeze([...(raw.capabilities as IntegrationCapability[])]),
    detect: raw.detect,
    ...(typeof raw.version === "function" ? { version: raw.version } : {}),
    ...(typeof raw.install === "function" ? { install: raw.install } : {}),
    ...(typeof raw.configure === "function" ? { configure: raw.configure } : {}),
  }) as Integration;
}

/**
 * True when the integration declares a capability and backs it with
 * its function. Undeclared capabilities are never assumed present,
 * even if a same-named property exists.
 */
export function supportsCapability(
  integration: Integration,
  capability: IntegrationCapability,
): boolean {
  if (!isIntegration(integration) || !isIntegrationCapability(capability)) {
    return false;
  }
  const method = CAPABILITY_METHODS[capability];
  return (
    integration.capabilities.includes(capability) &&
    typeof (integration as unknown as Record<string, unknown>)[method] === "function"
  );
}
