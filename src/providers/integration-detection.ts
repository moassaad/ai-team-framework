/**
 * Fresh integration detection (I-003).
 *
 * Runs one registered integration's declared `detect()` capability
 * and reports the outcome. Every call invokes `detect()` anew: no
 * stored results are read, kept, or returned, and the registry is
 * never turned into a state store.
 *
 * Outcomes distinguish "unavailable" from "detection failed". A
 * detector that returns `{ available: false }` is a successful
 * detection of absence. A detector that throws, rejects, or returns
 * a contract-violating value is a failure, reported explicitly and
 * never converted into an available state.
 *
 * Detection consults no user configuration and touches no optional
 * capability (`version`, `install`, `configure` are never called
 * here). Provider-specific logic stays in concrete adapters; this
 * module names no external tool.
 */

import {
  DetectionResult,
  validateDetectionResult,
} from "./integration";
import { IntegrationRegistry } from "./integration-registry";

function fail(what: string): never {
  throw new Error(`integration detection: ${what}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fresh detection outcome. `detected` carries the validated result
 * (absence included); `failed` carries the detector's error text.
 */
export type DetectionOutcome =
  | { status: "detected"; result: DetectionResult }
  | { status: "failed"; error: string };

/**
 * Detect one registered integration by its stable identifier. Looks
 * the entry up through the registry, invokes only its `detect()`
 * capability, and validates the returned value against the I-001
 * contract. Unknown identifiers throw; they are a caller error, not
 * a detection result.
 */
export async function detectIntegration(
  registry: IntegrationRegistry,
  name: string,
): Promise<DetectionOutcome> {
  if (
    typeof registry !== "object" ||
    registry === null ||
    typeof (registry as IntegrationRegistry).get !== "function"
  ) {
    fail("expected an integration registry");
  }
  const entry = typeof name === "string" ? registry.get(name) : undefined;
  if (entry === undefined) {
    fail(`unknown integration ${JSON.stringify(name)}`);
  }
  let raw: unknown;
  try {
    raw = await entry.detect();
  } catch (error: unknown) {
    return { status: "failed", error: errorMessage(error) };
  }
  try {
    return { status: "detected", result: validateDetectionResult(raw) };
  } catch (error: unknown) {
    return { status: "failed", error: errorMessage(error) };
  }
}
