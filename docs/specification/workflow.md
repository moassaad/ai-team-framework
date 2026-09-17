# Workflow Specification

Derived from plan §6, §11, §12, AGENTS.md.

Canonical state IDs (plan §6.2):

```text
Primary:   ready → in_progress → implementation_review → technical_approval → pm_review → closed
Auxiliary: blocked, needs_user_input, changes_requested, failed, cancelled
```

## 1. High-level flow

```text
User
  ↓
Coordinator
  ↓
Project Manager            (requirements, plans)
  ↓
Technical Lead             (discovery, ticket breakdown)
  ↓
Implementer                (one ticket)
  ↓
Senior Reviewer            (advisory findings)
  ↓
Technical Lead             (technical_approval gate / rework decision)
  ↓
Project Manager            (pm_review gate, business acceptance)
  ↓
User Approval when configured (manual mode)
  ↓
Next Ticket / Closed
```

## 2. State definitions

| State | Meaning |
|---|---|
| `ready` | Ticket created by TL, not started |
| `in_progress` | Implementer actively working the ticket |
| `implementation_review` | Implementation submitted; Senior Reviewer evaluates |
| `technical_approval` | Reviewer findings accepted; TL decides rework/proceed |
| `pm_review` | Technical acceptance passed; PM checks business acceptance |
| `closed` | Ticket accepted and finished (terminal) |
| `changes_requested` | Valid findings/requirement gaps require rework |
| `blocked` | Cannot proceed; blocker documented by the actor |
| `needs_user_input` | Human input required (information or approval) |
| `failed` | Unresolvable or unsafe implementation attempt |
| `cancelled` | Explicitly aborted (terminal) |

## 3. Valid transitions

Owner = the only role allowed to perform the transition. The Coordinator relays
explicit user intents but never invents state changes. The Senior Reviewer never
mutates state; it only produces findings.

| From | To | Owner | Trigger / guard |
|---|---|---|---|
| `ready` | `in_progress` | Technical Lead | Assigns ticket to an Implementer |
| `in_progress` | `implementation_review` | Implementer | Submits implementation + validation results |
| `in_progress` | `blocked` | Implementer | Cannot proceed; blocker documented |
| `in_progress` | `needs_user_input` | Implementer | Missing info or sensitive decision encountered |
| `in_progress` | `failed` | Implementer | Unresolvable failure or unsafe validation |
| `implementation_review` | `technical_approval` | Technical Lead | Reviewer found no blocking issues; TL accepts |
| `implementation_review` | `changes_requested` | Technical Lead | Valid reviewer findings require rework |
| `changes_requested` | `in_progress` | Technical Lead | Rework assigned back to Implementer |
| `technical_approval` | `pm_review` | Technical Lead | Technical acceptance passed |
| `technical_approval` | `changes_requested` | Technical Lead | Rework needed despite submission |
| `pm_review` | `closed` | Project Manager | Auto mode; or manual mode with approval already granted |
| `pm_review` | `needs_user_input` | Project Manager | Manual approval gate for this ticket |
| `pm_review` | `changes_requested` | Project Manager | Requirement/accepted-scope gap found |
| `needs_user_input` | `in_progress` | originating role | Answer received; implementation blocker resolved |
| `needs_user_input` | `closed` | Project Manager | At approval gate; user approved |
| `needs_user_input` | `changes_requested` | Project Manager | User rejected or changed the requirement |
| `blocked` | `in_progress` | Technical Lead | Blocker resolved |
| `blocked` | `needs_user_input` | Technical Lead | Blocker requires a user decision |
| `failed` | `in_progress` | Technical Lead | Retry ordered with explicit conditions |
| `failed` | `cancelled` | Technical Lead | Abort after user/PM confirmation |
| any active state | `cancelled` | Coordinator | User explicitly cancels |

`closed` and `cancelled` are terminal. No transition may skip a required
approval gate. Unknown transitions are invalid and must be reported, not guessed.

## 4. Approval ownership

- Technical gate (`technical_approval`): Technical Lead owns it.
  - Performs rework/proceed from Senior Reviewer findings.
- Business gate (`pm_review`): Project Manager owns it.
  - Performs requirement/scope acceptance and requests user approval per config.
- User approval: requested by the PM, mediated through the Coordinator (user
  talks to the Coordinator, plan §2.4). Required only per approval configuration.
- Senior Reviewer: advisory only; never mutates state.
- Sensitive-change approval: any classified sensitive change must reach
  `needs_user_input` pending explicit user approval before that work proceeds
  (sensitivity rules: plan §6.3, AGENTS.md sensitive list, `configuration.md`).

## 5. Approval modes

From plan §6.3 with defaults bolded:

```yaml
approval:
  mode: manual | automatic        # default: manual
  after: ticket | sprint          # default: ticket
  sensitive_changes: always | configured | never   # default: always
```

- `mode: manual` — a user approval gate applies at `pm_review`. The PM
  transitions to `needs_user_input`; the ticket reaches `closed` only when the
  user approves (via Coordinator). Rejection returns the ticket to
  `changes_requested` or cancels it.
- `mode: automatic` — no user approval gate; `pm_review → closed` it is decided
  by the PM.
- `after: ticket` — approval gate applies after every ticket (0.1.0 behavior).
- `after: sprint` — approval applies after a batch of tickets; no sprint
  lifecycle is defined yet → see `open-decisions.md` (OQ-3). Not exercisable in
  0.1.0 until defined.
- `sensitive_changes: always` — any change in the classified sensitive set
  requires user approval regardless of mode.
- `sensitive_changes: configured` — only changes explicitly marked sensitive in
  the plan/ticket/config `sensitive_rules` require approval.
- `sensitive_changes: never` — no sensitive approval (discouraged; requires
  explicit user opt-in).

## 6. Ticket execution example (default: manual / ticket / always)

```text
TL  creates ticket                              → ready
TL  assigns ticket                              → ready → in_progress
IM  implements + validates                      → in_progress → implementation_review
SR  reviews (no findings)                       (advisory)
TL  accepts                                     → implementation_review → technical_approval
PM  reviews acceptance                          → technical_approval → pm_review
PM  requests user approval (manual)             → pm_review → needs_user_input
User approves via Coordinator                   → needs_user_input → closed → next ticket
```

Any valid finding/shortfall at SR/TL/PM gates instead routes through
`changes_requested → in_progress` following the transition table.

## 7. Retry and handoff rules

- `changes_requested` always returns to `in_progress` under TL.
- The rework loop has no fixed limit in 0.1.0; TL decides to escalate to
  `blocked`, `failed`, or `cancelled` (with user/PM confirmation for abort).
- Handoffs carry context: role X hands work to role Y with stated inputs and
  expected outputs (see `roles.md` handoff fields).
- Context gaps at any handoff → stop and ask, never fabricate context.

## 8. Parallel execution

Out of scope for 0.1.0 (plan §2.3). The workflow is strictly sequential until a
plan change defines parallel orchestration.