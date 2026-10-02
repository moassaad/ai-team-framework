/**
 * Integration desired state (I-004).
 *
 * Reads what the user wants from validated framework configuration:
 * `isIntegrationEnabled` returns true only for explicitly enabled
 * integrations, false for disabled or unspecified ones. This is
 * desired state only — it says nothing about whether the integration
 * is installed, available, or ready, and it performs no detection.
 *
 * Names are resolved generically against the `providers` section;
 * unknown or unspecified names read as false (not wanted). The
 * closed provider key set itself is enforced by the existing config
 * validator, not here. No registry lookup, no detection calls, no
 * provider-specific logic.
 */

import { FrameworkConfig } from "../config/schema";

function fail(what: string): never {
  throw new Error(`integration config: ${what}`);
}

/**
 * Read the desired enabled flag for one integration. True means the
 * user wants it enabled; false means disabled or unspecified.
 * Throws on malformed configuration input or non-boolean flags.
 */
export function isIntegrationEnabled(config: FrameworkConfig, name: string): boolean {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    fail("expected a validated framework configuration object");
  }
  if (typeof name !== "string" || name.length === 0) {
    fail("expected a non-empty integration name");
  }
  const providers = (config as { providers?: unknown }).providers;
  if (providers === undefined) {
    return false;
  }
  if (typeof providers !== "object" || providers === null || Array.isArray(providers)) {
    fail("expected a providers section object");
  }
  const entry = (providers as Record<string, unknown>)[name];
  if (entry === undefined) {
    return false;
  }
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    fail(`expected providers.${name} to be an object`);
  }
  const enabled = (entry as Record<string, unknown>).enabled;
  if (enabled === undefined) {
    return false;
  }
  if (typeof enabled !== "boolean") {
    fail(`expected providers.${name}.enabled to be a boolean`);
  }
  return enabled;
}
