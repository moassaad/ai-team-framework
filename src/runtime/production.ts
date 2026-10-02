/**
 * Production runtime dependency assembly (M18 R-004).
 *
 * The one composition root between the application and the
 * Coordinator runtime: explicit caller inputs become a frozen
 * `RoleResolver`, which the Coordinator consumes generically.
 * Composition owns creation; orchestration owns execution —
 * this module never selects tickets, invokes providers, or
 * advances workflow.
 *
 * Everything arrives explicitly. There are no defaults because
 * the repository establishes none: no role/specialty mapping
 * exists in configuration, no generic `AgentProvider` factory
 * exists to default to, and a default that changes provider
 * behavior would not be harmless. In particular, the existing
 * OpenCode factory yields `AgentProvider<string>`, not the
 * `AgentProvider<ExecutionResult>` the execution seams require,
 * and no normalizing adapter exists — building one would be new
 * provider implementation, which is forbidden here. So providers
 * arrive ready-made from the caller: assembly checks the
 * structural contract (like every seam in this repo; result
 * conformance itself is compile-time plus downstream
 * validation), and anything missing or malformed fails here
 * with a bounded error before any ticket can execute. Delegate
 * specifics (skills, models, fleets, sessions) cannot arrive
 * through this module: the reference shapes have no fields for
 * them.
 */

import { AgentProvider, isAgentProvider } from "../providers/agent";
import { ExecutionResult } from "../providers/result";
import { ImplementerSpecialty, isImplementerSpecialty } from "../roles/contract";
import {
  ImplementerRoleReference,
  RoleResolver,
  SeniorReviewerRoleReference,
  isRoleResolver,
} from "./roles";

/** Explicit production inputs. Every field required; nothing inferred. */
export interface ProductionCoordinatorInput {
  /** Implementer specialty, decided externally by the caller. */
  readonly specialty: ImplementerSpecialty;
  /** Ready-made generic provider executing Implementer prompts. */
  readonly implementerProvider: AgentProvider<ExecutionResult>;
  /** Ready-made generic provider executing Senior Reviewer prompts. */
  readonly reviewerProvider: AgentProvider<ExecutionResult>;
}

/** Assembled production dependencies. The Coordinator takes `roles`. */
export interface ProductionCoordinatorDeps {
  readonly roles: RoleResolver;
}

function fail(what: string): never {
  throw new Error(`production runtime: ${what}`);
}

/**
 * Assemble production Coordinator dependencies from explicit
 * inputs. Validates specialty and both providers, then returns a
 * frozen resolver yielding frozen references — the same
 * references on every call, independent per factory invocation.
 * Pure construction: never executes, detects, reads config, or
 * touches the environment.
 */
export function createProductionCoordinatorDeps(
  input: ProductionCoordinatorInput,
): ProductionCoordinatorDeps {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a dependencies input object");
  }
  if (!isImplementerSpecialty(input.specialty)) {
    fail(`unknown specialty ${JSON.stringify(input.specialty)}`);
  }
  if (!isAgentProvider(input.implementerProvider)) {
    fail("implementerProvider must satisfy the agent provider contract");
  }
  if (!isAgentProvider(input.reviewerProvider)) {
    fail("reviewerProvider must satisfy the agent provider contract");
  }
  const implementer: ImplementerRoleReference = Object.freeze({
    role: "implementer",
    specialty: input.specialty,
    provider: input.implementerProvider as AgentProvider<ExecutionResult>,
  });
  const reviewer: SeniorReviewerRoleReference = Object.freeze({
    role: "senior-reviewer",
    provider: input.reviewerProvider as AgentProvider<ExecutionResult>,
  });
  const roles: RoleResolver = {
    resolveImplementer: () => implementer,
    resolveSeniorReviewer: () => reviewer,
  };
  if (!isRoleResolver(roles)) {
    fail("assembled an invalid role resolver");
  }
  return Object.freeze({ roles });
}
