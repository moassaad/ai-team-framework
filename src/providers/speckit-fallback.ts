/**
 * Spec Kit failure and fallback selection (S-006).
 *
 * The one missing composition seam between the modern Spec Kit
 * integration (S-002) and the existing provider-neutral fallback
 * (P-005): given desired state, fresh detection, and whether the
 * caller explicitly requires Spec Kit, select the Spec Kit path or the
 * fallback for a single specification/plan generation. No manager, no
 * taxonomy, no framework — one function reusing existing contracts:
 *
 * ```text
 * disabled                     → fallback (generic) / failure (required);
 *                                 Spec Kit never invoked, not even probed
 * enabled + detection failure  → fallback (generic) / failure (required)
 * enabled + detected absence   → fallback (generic) / failure (required)
 * enabled + available          → primary attempt, then
 *                                fallback (generic) / identical
 *                                rejection (required)
 * ```
 *
 * Detection absence (`available: false`) and detection failure (the
 * probe threw or broke its contract) stay distinct all the way into
 * the required-operation error text. Nothing is ever installed,
 * initialized, retried, persisted, or reconfigured here: recovery is
 * "fallback or bounded failure", and the P-005 provider itself is
 * untouched and stays provider-neutral. Failure messages name the
 * integration, the requested artifact operation, and the underlying
 * cause without stack traces or vague text.
 */

import {
  DetectionResult,
  isDetectionResult,
} from "./integration";
import {
  SpecificationArtifact,
  SpecificationArtifactKind,
  SpecificationProvider,
  isSpecificationArtifactKind,
} from "./specification";
import {
  createFallbackProvider,
} from "./fallback";

/** Selection input. Desired state arrives as a boolean (I-004 at the caller); no config is read here. */
export interface SpecKitGenerationInput {
  /** PM-owned requirements text, carried verbatim to whichever provider runs. */
  readonly requirements: string;
  /** Target project root, bounded to the project. */
  readonly project_root: string;
  /** Which planning artifact to produce. */
  readonly artifact: SpecificationArtifactKind;
  /** Desired state: false means Spec Kit is not selected, never probed. */
  readonly specKitEnabled: boolean;
  /** True when the caller explicitly requires Spec Kit: never silently fall back. */
  readonly requireSpecKit: boolean;
  /** Fresh S-002 detection; rejection means detection failure. */
  readonly detectSpecKit: () => Promise<DetectionResult>;
  /** The Spec Kit path; invoked only when selected. */
  readonly primary: SpecificationProvider;
  /** Generic fallback; defaults to the P-005 provider. */
  readonly fallback?: SpecificationProvider;
}

function fail(what: string): never {
  throw new Error(`spec-kit fallback: ${what}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isProvider(value: unknown): value is SpecificationProvider {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { generate?: unknown }).generate === "function"
  );
}

/**
 * Generate one specification/plan artifact through the Spec Kit path
 * when it is selected and healthy, else through the generic fallback
 * (generic operations) or a bounded failure (explicitly required
 * operations). Single attempt per provider, no retries, no side
 * effects beyond the providers' own generation.
 */
export async function generateSpecKitArtifact(
  input: SpecKitGenerationInput,
): Promise<SpecificationArtifact> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a generation input object");
  }
  if (typeof input.requirements !== "string" || input.requirements.length === 0) {
    fail("requirements must be a non-empty string");
  }
  if (typeof input.project_root !== "string" || input.project_root.length === 0) {
    fail("project_root must be a non-empty string");
  }
  if (!isSpecificationArtifactKind(input.artifact)) {
    fail(`unknown artifact ${JSON.stringify(input.artifact)}`);
  }
  if (typeof input.specKitEnabled !== "boolean") {
    fail("specKitEnabled must be a boolean");
  }
  if (typeof input.requireSpecKit !== "boolean") {
    fail("requireSpecKit must be a boolean");
  }
  if (typeof input.detectSpecKit !== "function") {
    fail("detectSpecKit must be a function");
  }
  if (!isProvider(input.primary)) {
    fail("primary must be a specification provider");
  }
  const fallback = input.fallback ?? createFallbackProvider();
  if (!isProvider(fallback)) {
    fail("fallback must be a specification provider");
  }
  const request = {
    requirements: input.requirements,
    project_root: input.project_root,
    artifact: input.artifact,
  };

  if (!input.specKitEnabled) {
    if (input.requireSpecKit) {
      fail(
        `Spec Kit is explicitly required for ${input.artifact} generation ` +
          "but disabled (specKitEnabled is false); not falling back",
      );
    }
    return fallback.generate(request);
  }

  let detected: DetectionResult;
  try {
    const raw = await input.detectSpecKit();
    if (!isDetectionResult(raw)) {
      throw new Error("detection broke its result contract");
    }
    detected = raw;
  } catch (error: unknown) {
    if (input.requireSpecKit) {
      fail(
        `Spec Kit is explicitly required for ${input.artifact} generation ` +
          `but detection failed (${errorMessage(error)})`,
      );
    }
    return fallback.generate(request);
  }
  if (!detected.available) {
    if (input.requireSpecKit) {
      fail(
        `Spec Kit is explicitly required for ${input.artifact} generation ` +
          `but unavailable (${detected.detail ?? "no detail"})`,
      );
    }
    return fallback.generate(request);
  }
  try {
    return await input.primary.generate(request);
  } catch (error: unknown) {
    if (input.requireSpecKit) {
      throw error;
    }
    return fallback.generate(request);
  }
}
