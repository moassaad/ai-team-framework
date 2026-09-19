/**
 * Spec Kit adapter (P-002).
 *
 * The first concrete `SpecificationProvider`. Composes the generic
 * `AgentProvider` seam: it builds an operation prompt from the
 * validated request and delegates execution, then normalizes the
 * agent's successful text into the shared artifact shape. No process
 * management, no environment setup, no requirement decisions —
 * a missing or incompatible setup surfaces as the agent's rejection.
 */

import { AgentProvider } from "./agent";
import { ExecutionResult } from "./result";
import {
  SpecificationArtifact,
  SpecificationProvider,
  SpecificationRequest,
  validateSpecificationArtifact,
  validateSpecificationRequest,
} from "./specification";

/** Stable adapter identity, local to this concrete module. */
export const SPECKIT_PROVIDER_NAME = "spec-kit" as const;

function operationPrompt(request: SpecificationRequest): string {
  const operation = request.artifact === "plan" ? "plan" : "specify";
  return [
    `Produce a Spec Kit ${request.artifact} for the project at ${request.project_root}.`,
    "",
    "Requirements (owned by the Project Manager, preserved verbatim):",
    request.requirements,
    "",
    `Use the Spec Kit ${operation} operation. Return the artifact content as your response text.`,
  ].join("\n");
}

/**
 * Build a Spec Kit adapter over any agent provider. The agent carries
 * out execution; this adapter only maps requests to operation prompts
 * and successful output back to artifacts. One agent call per
 * `generate()`; rejections propagate unchanged.
 */
export function createSpecKitProvider(
  agent: AgentProvider<ExecutionResult>,
): SpecificationProvider {
  return {
    name: SPECKIT_PROVIDER_NAME,
    generate: async (request: SpecificationRequest): Promise<SpecificationArtifact> => {
      const invocation = validateSpecificationRequest(request);
      const result = await agent.execute({
        prompt: operationPrompt(invocation),
        project_root: invocation.project_root,
      });
      return validateSpecificationArtifact({ artifact: invocation.artifact, content: result.text });
    },
  };
}
