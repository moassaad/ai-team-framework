/**
 * Workflow state model (W-001).
 *
 * The canonical workflow states, their stable identifiers, and minimal
 * descriptive metadata. Derived from the approved M0 workflow
 * specification (`docs/specification/workflow.md`).
 *
 * States only: valid transitions, guards, execution, approval handling,
 * and persistence belong to later W-00x tickets. Nothing here encodes a
 * state-to-state edge. Role assignment is also out of scope: states are
 * independent from role implementations.
 */

export type WorkflowStateKind = "normal" | "exceptional";

export interface WorkflowStateMeta {
  kind: WorkflowStateKind;
  terminal: boolean;
  description: string;
}

export const WORKFLOW_STATES = {
  ready: {
    kind: "normal",
    terminal: false,
    description: "Ticket created, work not started.",
  },
  in_progress: {
    kind: "normal",
    terminal: false,
    description: "Ticket actively being worked.",
  },
  implementation_review: {
    kind: "normal",
    terminal: false,
    description: "Implementation submitted for review.",
  },
  technical_approval: {
    kind: "normal",
    terminal: false,
    description: "Technical gate: rework-or-proceed decision pending.",
  },
  pm_review: {
    kind: "normal",
    terminal: false,
    description: "Business acceptance gate pending.",
  },
  closed: {
    kind: "normal",
    terminal: true,
    description: "Ticket accepted and finished.",
  },
  blocked: {
    kind: "exceptional",
    terminal: false,
    description: "Execution cannot proceed because of a dependency or unresolved decision.",
  },
  needs_user_input: {
    kind: "exceptional",
    terminal: false,
    description: "Human input is required before continuing.",
  },
  changes_requested: {
    kind: "exceptional",
    terminal: false,
    description: "Review identified work that must be addressed.",
  },
  failed: {
    kind: "exceptional",
    terminal: false,
    description: "Current execution attempt failed and requires later workflow handling.",
  },
  cancelled: {
    kind: "exceptional",
    terminal: true,
    description: "Intentionally stopped and no longer proceeding.",
  },
} as const;

export type WorkflowState = keyof typeof WORKFLOW_STATES;

/** True for canonical workflow state identifiers. */
export function isWorkflowState(value: unknown): value is WorkflowState {
  return typeof value === "string" && value in WORKFLOW_STATES;
}

/** True for terminal states (`closed`, `cancelled`). */
export function isTerminalState(state: WorkflowState): boolean {
  return WORKFLOW_STATES[state].terminal;
}
