/**
 * User Checkpoints (M29 T-043).
 *
 * The explicit, typed contract for the six human decision
 * boundaries named in the roadmap — approve plan, reject
 * plan, change requirements, select work mode, approve
 * re-entry, approve sensitive changes — with the user left
 * as the authority in every case.
 *
 * What this module is: a request/response contract plus a
 * static boundary catalog. `createUserCheckpoint` builds a
 * validated, frozen checkpoint request at a permitted
 * boundary; `resolveUserCheckpoint` matches one explicit
 * user response to its request and returns a frozen,
 * discriminated resolution. The caller — never this module —
 * then takes the next supported action through the existing
 * workflow or approval contract named in the boundary
 * guidance (for example, supplying the corresponding
 * authority decision to `decidePlanningApproval`).
 *
 * What this module is not: there is no pause/resume, no
 * waiting, no persistence, no callbacks, no resume tokens,
 * no registry, no orchestration engine, and no second
 * workflow runner. All five established entry points take
 * their decisions as caller-supplied input in a single
 * call, so a checkpoint can only be a pending request the
 * caller displays, answers, resolves, and then continues
 * from through the supported API. Nothing here executes a
 * role, dispatches a transport, retries, falls back,
 * re-enters, or resumes anything.
 *
 * User confirmation stays generic (`proceed` /
 * `request-changes` / `stop`) and is never converted into a
 * role-owned approval: no PM/TL planning approval, no
 * reviewer decision, no TL acceptance, no PM user-testing
 * approval, no final approval. A missing response, an empty
 * string, a provider report, a timeout, or an exception is
 * never approval — only an explicit matching response
 * resolves, and a `stop` is never a `proceed`.
 *
 * Pure and synchronous: validate, freeze, return. No
 * providers, no execution, no persistence, no mutation of
 * caller-owned objects.
 */

/** The six human decision boundaries named in the roadmap. */
export const CHECKPOINT_BOUNDARIES = [
  "plan-approval",
  "plan-rejection",
  "requirements-change",
  "work-mode-selection",
  "reentry-approval",
  "sensitive-change-approval",
] as const;

/** One of the six roadmap decision boundaries. */
export type CheckpointBoundary = (typeof CHECKPOINT_BOUNDARIES)[number];

/** True for canonical checkpoint boundaries; rejects free text. */
export function isCheckpointBoundary(value: unknown): value is CheckpointBoundary {
  return (
    typeof value === "string" &&
    (CHECKPOINT_BOUNDARIES as readonly string[]).includes(value)
  );
}

/** Workflows whose boundaries can raise a checkpoint. Existing entry points only. */
export const CHECKPOINT_WORKFLOWS = [
  "new-project",
  "existing-project",
  "full-feature",
  "standard-feature",
  "fast-bug",
] as const;

/** One of the five established workflow entry points. */
export type CheckpointWorkflow = (typeof CHECKPOINT_WORKFLOWS)[number];

/** True for canonical checkpoint workflows; rejects free text. */
export function isCheckpointWorkflow(value: unknown): value is CheckpointWorkflow {
  return (
    typeof value === "string" &&
    (CHECKPOINT_WORKFLOWS as readonly string[]).includes(value)
  );
}

/** Generic user decisions. Deliberately distinct from every role-owned approval vocabulary. */
export const CHECKPOINT_DECISIONS = [
  "proceed",
  "request-changes",
  "stop",
] as const;

/** One explicit user decision. */
export type CheckpointDecision = (typeof CHECKPOINT_DECISIONS)[number];

/** True for canonical checkpoint decisions; rejects free text and provider-shaped values. */
export function isCheckpointDecision(value: unknown): value is CheckpointDecision {
  return (
    typeof value === "string" &&
    (CHECKPOINT_DECISIONS as readonly string[]).includes(value)
  );
}

export const MAX_CHECKPOINT_ID_LENGTH = 200;
export const MAX_CHECKPOINT_TEXT_LENGTH = 2000;

/**
 * Where the human may decide: each roadmap boundary, the
 * workflows it applies to, and the existing contract the
 * caller continues through. Static data only — this table
 * describes; it never executes, routes, or resumes.
 */
export interface CheckpointBoundaryGuidance {
  readonly boundary: CheckpointBoundary;
  readonly workflows: readonly CheckpointWorkflow[];
  readonly decidedThrough: string;
}

const GUIDANCE: CheckpointBoundaryGuidance[] = [
  {
    boundary: "plan-approval",
    workflows: ["new-project", "existing-project"],
    decidedThrough:
      "decidePlanningApproval with an explicit project-manager or technical-lead identity and decision; the checkpoint response never approves on its own",
  },
  {
    boundary: "plan-rejection",
    workflows: ["new-project", "existing-project"],
    decidedThrough:
      "decidePlanningApproval with an explicit changes-required decision and notes; rejection travels through the same authority contract as approval",
  },
  {
    boundary: "requirements-change",
    workflows: ["new-project", "existing-project", "full-feature", "standard-feature"],
    decidedThrough:
      "caller-owned PM/TL planning fields on the next workflow call; feedback travels verbatim and is never parsed into requirements",
  },
  {
    boundary: "work-mode-selection",
    workflows: ["new-project", "existing-project", "full-feature", "standard-feature", "fast-bug"],
    decidedThrough:
      "recommendMode plus checkModeGuardrails: the caller selects the mode and supplies any required explicit confirmation; the checkpoint never selects for the caller",
  },
  {
    boundary: "reentry-approval",
    workflows: ["full-feature", "standard-feature", "fast-bug", "new-project", "existing-project"],
    decidedThrough:
      "the M28 correction contracts (validateCorrectionReference, the T-033/T-034/T-035 handoff constructors, reentry validation); the checkpoint never re-enters on its own",
  },
  {
    boundary: "sensitive-change-approval",
    workflows: ["new-project", "existing-project", "full-feature", "standard-feature", "fast-bug"],
    decidedThrough:
      "the owning confirmation contract (integration-setup confirmed, delegation confirmation); absence of confirmation never approves",
  },
];

export const CHECKPOINT_BOUNDARY_GUIDANCE: readonly CheckpointBoundaryGuidance[] = Object.freeze(
  GUIDANCE.map((entry) => Object.freeze({ ...entry, workflows: Object.freeze([...entry.workflows]) })),
);

/** True when guidance exists for the boundary; the table covers every canonical boundary exactly once. */
export function describeCheckpointBoundary(boundary: CheckpointBoundary): CheckpointBoundaryGuidance {
  const found = CHECKPOINT_BOUNDARY_GUIDANCE.find((entry) => entry.boundary === boundary);
  if (found === undefined) {
    fail(`no checkpoint guidance for boundary ${JSON.stringify(boundary)}`);
  }
  return found;
}

/**
 * A user checkpoint request: caller-supplied identity, the
 * workflow and stage that raised it, the boundary it sits
 * on, the explicit question for the human, the decisions
 * the caller will accept, and any structured references or
 * caller-authored feedback the human needs. References are
 * carried verbatim; opaque reports are never parsed.
 */
export interface UserCheckpoint {
  readonly id: string;
  readonly boundary: CheckpointBoundary;
  readonly workflow: CheckpointWorkflow;
  readonly stage: string;
  readonly purpose: string;
  readonly decisions: readonly CheckpointDecision[];
  readonly references?: readonly string[];
  readonly feedback?: string;
}

export interface UserCheckpointInput {
  readonly id: unknown;
  readonly boundary: unknown;
  readonly workflow: unknown;
  readonly stage: unknown;
  readonly purpose: unknown;
  readonly decisions?: unknown;
  readonly references?: unknown;
  readonly feedback?: unknown;
}

/**
 * The explicit human answer: which checkpoint it resolves
 * (by id and stage, both must match), the decision, and
 * feedback — required for `request-changes` so a requested
 * change always grounds action, optional otherwise.
 */
export interface UserCheckpointResponse {
  readonly checkpointId: string;
  readonly stage: string;
  readonly decision: CheckpointDecision;
  readonly feedback?: string;
}

export interface UserCheckpointResponseInput {
  readonly checkpointId: unknown;
  readonly stage: unknown;
  readonly decision: unknown;
  readonly feedback?: unknown;
}

/** A resolved checkpoint that allows the caller to continue via the boundary's contract. */
export interface UserCheckpointProceed {
  readonly status: "proceed";
  readonly checkpointId: string;
  readonly boundary: CheckpointBoundary;
  readonly workflow: CheckpointWorkflow;
  readonly stage: string;
  readonly feedback?: string;
}

/** A resolved checkpoint requesting changes; feedback always present. */
export interface UserCheckpointChangesRequested {
  readonly status: "changes-requested";
  readonly checkpointId: string;
  readonly boundary: CheckpointBoundary;
  readonly workflow: CheckpointWorkflow;
  readonly stage: string;
  readonly feedback: string;
}

/** A resolved checkpoint stopping the workflow; never a proceed, never an approval. */
export interface UserCheckpointStopped {
  readonly status: "stopped";
  readonly checkpointId: string;
  readonly boundary: CheckpointBoundary;
  readonly workflow: CheckpointWorkflow;
  readonly stage: string;
  readonly feedback?: string;
}

/** Explicit resolution. Carries no authority, identity, approval, token, or resume of any kind. */
export type UserCheckpointResolution =
  | UserCheckpointProceed
  | UserCheckpointChangesRequested
  | UserCheckpointStopped;

function fail(what: string): never {
  throw new Error(`user checkpoint: ${what}`);
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  if (value.length > max) {
    fail(`${field} exceeds the ${max}-character bound`);
  }
  return value;
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return boundedString(value, field, MAX_CHECKPOINT_TEXT_LENGTH);
}

function checkDecisions(value: unknown): readonly CheckpointDecision[] {
  if (value === undefined) {
    return Object.freeze([...CHECKPOINT_DECISIONS]);
  }
  if (!Array.isArray(value) || value.length === 0) {
    fail("decisions must be a non-empty array of checkpoint decisions when supplied");
  }
  const checked = value.map((entry) => {
    if (!isCheckpointDecision(entry)) {
      fail(`decisions entries must be one of ${CHECKPOINT_DECISIONS.join(", ")}, got ${JSON.stringify(entry)}`);
    }
    return entry;
  });
  return Object.freeze(checked);
}

function checkReferences(value: unknown): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    fail("references must be a non-empty array of reference strings when supplied");
  }
  return Object.freeze(value.map((entry) => boundedString(entry, "references entry", MAX_CHECKPOINT_TEXT_LENGTH)));
}

/**
 * Validate raw data as a user checkpoint request and return
 * a frozen defensive copy. Rejects unknown boundaries,
 * workflows, and decisions, missing or overlong identity,
 * stage, and purpose. Never mutates its input, never
 * executes anything.
 */
export function validateUserCheckpoint(data: unknown): UserCheckpoint {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected a user checkpoint object");
  }
  const raw = data as Record<string, unknown>;
  if (!isCheckpointBoundary(raw.boundary)) {
    fail(`boundary must be one of ${CHECKPOINT_BOUNDARIES.join(", ")}, got ${JSON.stringify(raw.boundary)}`);
  }
  if (!isCheckpointWorkflow(raw.workflow)) {
    fail(`workflow must be one of ${CHECKPOINT_WORKFLOWS.join(", ")}, got ${JSON.stringify(raw.workflow)}`);
  }
  const id = boundedString(raw.id, "id", MAX_CHECKPOINT_ID_LENGTH);
  const stage = boundedString(raw.stage, "stage", MAX_CHECKPOINT_ID_LENGTH);
  const purpose = boundedString(raw.purpose, "purpose", MAX_CHECKPOINT_TEXT_LENGTH);
  const decisions = checkDecisions(raw.decisions);
  const references = checkReferences(raw.references);
  const feedback = optionalText(raw.feedback, "feedback");
  return Object.freeze({
    id,
    boundary: raw.boundary,
    workflow: raw.workflow,
    stage,
    purpose,
    decisions,
    ...(references !== undefined ? { references } : {}),
    ...(feedback !== undefined ? { feedback } : {}),
  });
}

/**
 * Build a user checkpoint request from explicit caller
 * parts. Same validation as `validateUserCheckpoint`; the
 * arguments keep identity, boundary, location, purpose,
 * and context visibly separate at the call site. Creating
 * a checkpoint never executes a role or workflow stage.
 */
export function createUserCheckpoint(input: UserCheckpointInput): UserCheckpoint {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a user checkpoint input object");
  }
  return validateUserCheckpoint({
    id: input.id,
    boundary: input.boundary,
    workflow: input.workflow,
    stage: input.stage,
    purpose: input.purpose,
    ...(input.decisions !== undefined ? { decisions: input.decisions } : {}),
    ...(input.references !== undefined ? { references: input.references } : {}),
    ...(input.feedback !== undefined ? { feedback: input.feedback } : {}),
  });
}

/**
 * Validate raw data as a user checkpoint response and
 * return a frozen defensive copy. A missing response, a
 * missing decision, an empty decision, or a provider-shaped
 * value is rejected — never treated as approval.
 * `request-changes` requires non-empty feedback so the
 * requested change always grounds action.
 */
export function validateUserCheckpointResponse(data: unknown): UserCheckpointResponse {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected a user checkpoint response object; a missing response never approves");
  }
  const raw = data as Record<string, unknown>;
  const checkpointId = boundedString(raw.checkpointId, "checkpointId", MAX_CHECKPOINT_ID_LENGTH);
  const stage = boundedString(raw.stage, "stage", MAX_CHECKPOINT_ID_LENGTH);
  if (!isCheckpointDecision(raw.decision)) {
    fail(`decision must be one of ${CHECKPOINT_DECISIONS.join(", ")}, got ${JSON.stringify(raw.decision)}`);
  }
  if (raw.decision === "request-changes") {
    const feedback = boundedString(raw.feedback, "feedback", MAX_CHECKPOINT_TEXT_LENGTH);
    return Object.freeze({ checkpointId, stage, decision: raw.decision, feedback });
  }
  const feedback = optionalText(raw.feedback, "feedback");
  return Object.freeze({
    checkpointId,
    stage,
    decision: raw.decision,
    ...(feedback !== undefined ? { feedback } : {}),
  });
}

/**
 * Match one explicit response to its checkpoint and return
 * the frozen resolution. The response must name the same
 * checkpoint id and stage, and its decision must be within
 * the checkpoint's accepted decisions; anything else fails
 * clearly — malformed request, unmatched reference, missing
 * response, or unsupported action. Resolving never executes
 * a role, never approves, and never resumes a workflow: the
 * caller continues through the boundary's own contract.
 */
export function resolveUserCheckpoint(input: {
  readonly checkpoint: unknown;
  readonly response: unknown;
}): UserCheckpointResolution {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("expected a checkpoint resolution input object");
  }
  const checkpoint = validateUserCheckpoint((input as { checkpoint?: unknown }).checkpoint);
  const response = validateUserCheckpointResponse((input as { response?: unknown }).response);
  if (response.checkpointId !== checkpoint.id) {
    fail(`response resolves checkpoint ${JSON.stringify(response.checkpointId)} but the request is ${JSON.stringify(checkpoint.id)}`);
  }
  if (response.stage !== checkpoint.stage) {
    fail(`response stage ${JSON.stringify(response.stage)} does not match checkpoint stage ${JSON.stringify(checkpoint.stage)}`);
  }
  if (!checkpoint.decisions.includes(response.decision)) {
    fail(`decision ${JSON.stringify(response.decision)} is not accepted by checkpoint ${JSON.stringify(checkpoint.id)}`);
  }
  const base = {
    checkpointId: checkpoint.id,
    boundary: checkpoint.boundary,
    workflow: checkpoint.workflow,
    stage: checkpoint.stage,
  } as const;
  if (response.decision === "proceed") {
    return Object.freeze({
      status: "proceed",
      ...base,
      ...(response.feedback !== undefined ? { feedback: response.feedback } : {}),
    });
  }
  if (response.decision === "request-changes") {
    return Object.freeze({
      status: "changes-requested",
      ...base,
      feedback: response.feedback as string,
    });
  }
  return Object.freeze({
    status: "stopped",
    ...base,
    ...(response.feedback !== undefined ? { feedback: response.feedback } : {}),
  });
}
