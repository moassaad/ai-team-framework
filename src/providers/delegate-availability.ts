/**
 * Delegate-skills availability detector (D-002).
 *
 * Answers one factual question — is the optional delegation
 * capability present in this environment — without turning anything
 * on, picking a provider, or invoking anything. Detection reads
 * the executable search path for the capability command; it starts no
 * processes, touches no network, changes no setting, and keeps no
 * state. All environment access funnels through an injected probe so
 * tests never depend on the real machine.
 */

import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

/** Capability command looked up on the executable search path. */
const DELEGATE_SKILLS_COMMAND = "delegate-skills";

export interface DelegateAvailability {
  /** True when the capability was found; false otherwise. */
  readonly available: boolean;
}

function fail(what: string): never {
  throw new Error(`delegate availability: invalid input (${what})`);
}

/** True for values shaped like an availability result. */
export function isDelegateAvailability(value: unknown): value is DelegateAvailability {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return typeof (value as Record<string, unknown>).available === "boolean";
}

/**
 * Validate raw data as an availability result and return a frozen
 * copy. Rejects non-boolean availability and wrong types.
 */
export function validateDelegateAvailability(data: unknown): DelegateAvailability {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  if (typeof raw.available !== "boolean") {
    fail("available must be a boolean");
  }
  return Object.freeze({ available: raw.available });
}

/**
 * Environment probe. Returns true when the capability is present.
 * Production probes read the machine; tests inject fakes. A probe
 * must not start processes, reach the network, or alter anything.
 */
export type AvailabilityProbe = () => boolean;

export interface DelegateAvailabilityDetector {
  /** Report current availability. Never throws for probe failures. */
  check(): DelegateAvailability;
}

/**
 * Build a detector around an explicit probe. The default probe looks
 * for the capability command on the search path; callers needing
 * hermetic behavior pass their own. A throwing probe reports
 * unavailable rather than propagating.
 */
export function createDelegateAvailabilityDetector(
  probe: AvailabilityProbe = defaultDelegateSkillsProbe,
): DelegateAvailabilityDetector {
  if (typeof probe !== "function") {
    fail("probe must be a function");
  }
  return Object.freeze({
    check: (): DelegateAvailability => {
      let available = false;
      try {
        available = probe() === true;
      } catch {
        available = false;
      }
      return validateDelegateAvailability({ available });
    },
  });
}

export interface ExecutableProbeDeps {
  /** Search-path value; defaults to the process search path. */
  readonly pathValue?: string;
  /** Existence check; defaults to an executable-file check. */
  readonly isExecutable?: (file: string) => boolean;
}

function defaultExecutableCheck(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Default probe: true when the capability command resolves to an
 * executable file on the search path. Dependency values exist so
 * tests can supply hermetic inputs; production callers pass nothing.
 */
export function defaultDelegateSkillsProbe(deps: ExecutableProbeDeps = {}): boolean {
  if (typeof deps !== "object" || deps === null || Array.isArray(deps)) {
    return false;
  }
  const pathValue = deps.pathValue ?? process.env.PATH ?? "";
  const isExecutable = deps.isExecutable ?? defaultExecutableCheck;
  if (typeof isExecutable !== "function") {
    return false;
  }
  for (const directory of pathValue.split(delimiter)) {
    if (directory.length === 0) {
      continue;
    }
    try {
      if (isExecutable(join(directory, DELEGATE_SKILLS_COMMAND))) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}
