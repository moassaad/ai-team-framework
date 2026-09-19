/**
 * Completion reporting (IR-006).
 *
 * Pure eligibility reporting over the W-008 contract: explicit
 * evidence plus framework configuration becomes a frozen completion
 * report. Delegates the entire eligibility decision to
 * `validateCompletion` — no predicate duplicated, no evidence
 * inferred, no transition performed. A report is never a closure;
 * the `next_state` it carries is W-008's recommendation surfaced
 * unchanged.
 */

import { FrameworkConfig } from "../config/schema";
import { validateConfig } from "../config/validator";
import { CompletionRequirement, validateCompletion } from "../workflow/completion";
import { WorkflowState, isWorkflowState } from "../workflow/states";

export interface CompletionReportInput {
  /** Ticket the report applies to. */
  readonly ticket_id: string;
  /** Framework configuration (approval mode and scope live here). */
  readonly config: FrameworkConfig;
  /** Current workflow state under review. */
  readonly from_state: WorkflowState;
  /** Explicit evidence: required approvals granted where they apply. */
  readonly approval_granted: boolean;
  /** Explicit evidence: no outstanding reviewer changes. */
  readonly review_clean: boolean;
  /** Explicit evidence: implementation and validation results submitted. */
  readonly validation_present: boolean;
}

export interface CompletionReport {
  readonly ticket_id: string;
  /** W-008 eligibility verdict, reported unchanged. */
  readonly eligible: boolean;
  /** Unmet requirements, empty when eligible. */
  readonly missing: readonly CompletionRequirement[];
  /** W-008 recommendation when eligible, otherwise null. */
  readonly next_state: WorkflowState | null;
}

function fail(what: string): never {
  throw new Error(`completion reporting: invalid input (${what})`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

function requireFlag(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    fail(`${field} must be a boolean`);
  }
  return value;
}

/**
 * Validate raw data as completion input and return a frozen copy. The
 * configuration passes through the shared C-003 validator (defaults
 * filled); evidence flags must be explicit booleans. Malformed input
 * rejects without reporting anything.
 */
export function validateCompletionReportInput(data: unknown): CompletionReportInput {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail("expected an object");
  }
  const raw = data as Record<string, unknown>;
  const ticket_id = nonEmptyString(raw.ticket_id, "ticket_id");
  let config: FrameworkConfig;
  try {
    config = validateConfig(raw.config);
  } catch {
    fail("config must satisfy the framework configuration contract");
  }
  if (!isWorkflowState(raw.from_state)) {
    fail(`unknown state ${JSON.stringify(raw.from_state)}`);
  }
  const approval_granted = requireFlag(raw.approval_granted, "approval_granted");
  const review_clean = requireFlag(raw.review_clean, "review_clean");
  const validation_present = requireFlag(raw.validation_present, "validation_present");
  return Object.freeze({
    ticket_id,
    config,
    from_state: raw.from_state,
    approval_granted,
    review_clean,
    validation_present,
  });
}

/**
 * Report completion eligibility for validated input. Maps the explicit
 * flags onto W-008 evidence field-for-field and returns its
 * verdict frozen: eligibility, missing requirements, and the
 * recommended next state (null unless W-008 names one). Deterministic,
 * side-effect free, no state touched.
 */
export function reportCompletion(input: CompletionReportInput): CompletionReport {
  const validated = validateCompletionReportInput(input);
  const result = validateCompletion(    validated.config,
    validated.from_state,
    {
      approvalGranted: validated.approval_granted,
      reviewClean: validated.review_clean,
      validationPresent: validated.validation_present,
    },
  );
  return Object.freeze({
    ticket_id: validated.ticket_id,
    eligible: result.complete,
    missing: Object.freeze([...result.missing]),
    next_state: result.nextState ?? null,
  });
}
