# Workflow Guide

How work moves through the AI Team Framework, from a user request
to a closed ticket. Beginner-friendly; the binding contract is
`docs/specification/workflow.md` and the transition table in
`src/workflow/transitions.ts` (verified by 531+ workflow tests).

## Overview

```text
User request
→ Coordination
→ Requirements (Project Manager)
→ Technical planning (Technical Lead)
→ Ticket
→ Implementation
→ Senior Review
→ Technical review/approval
→ PM review
→ User approval when required
→ Closed / next ticket
```

The exact path depends on review findings and the configured
approval mode. Not every ticket touches every state — the sections
below show which steps are required and which are conditional.

## One ticket at a time

A ticket is the bounded unit of implementation: one scope, one
Implementer, one validation. The framework finishes the review and
approval path for the current ticket before unrelated work begins.
There is no parallel orchestration in this release, and nothing
silently continues into the next ticket.

## The 11 states

| State | Meaning |
|---|---|
| `ready` | Ticket created by the TL, not started |
| `in_progress` | Implementer actively working the ticket |
| `implementation_review` | Implementation submitted; Senior Reviewer evaluates |
| `technical_approval` | Reviewer findings accepted; TL decides rework or proceed |
| `pm_review` | Technical acceptance passed; PM checks business acceptance |
| `closed` | Ticket accepted and finished (**terminal**) |
| `changes_requested` | Valid findings or requirement gaps require rework |
| `blocked` | Cannot proceed; blocker documented by the actor |
| `needs_user_input` | Human input required (information or approval) |
| `failed` | Unresolvable or unsafe implementation attempt |
| `cancelled` | Explicitly aborted (**terminal**) |

Terminal states (`closed`, `cancelled`) have no outgoing
transitions. Nothing resumes from them.

## Primary lifecycle

The default path when reviews are clean and approval is granted:

```text
ready
  ↓  (TL assigns to an Implementer)
in_progress
  ↓  (Implementer submits implementation + validation)
implementation_review
  ↓  (TL accepts: no blocking findings)
technical_approval
  ↓  (technical acceptance passed)
pm_review
  ↓  (acceptance + approval, see below)
closed
```

Exceptional states (`changes_requested`, `blocked`,
`needs_user_input`, `failed`, `cancelled`) can interrupt this path
at the points described below.

## Who does what (and what each step is not)

- **Implementer** performs implementation. A successful execution is
  a result, not an approval.
- **Senior Reviewer** reviews. Review is findings, not closure.
- **Technical Lead** assesses review findings and recommends the
  `implementation_review → technical_approval` edge, or sends the
  ticket back via `changes_requested`. A recommendation names a
  valid transition; it does not perform it.
- **Project Manager** checks business acceptance at `pm_review`.
- **User** approves when the configuration requires it. Approval is
  its own responsibility, separate from execution and review.

## Changes requested

When review finds real problems, the ticket loops back for rework
— requesting changes and executing them are separate steps:

```text
Implementation
→ Review
→ Problems found → changes_requested
→ Implementation resumes (changes_requested → in_progress)
→ Review again
```

Rework is assigned explicitly by the TL (or PM, for requirement
gaps via `pm_review → changes_requested`). No step retries anything
automatically.

## Failure and retry

`failed` means the attempt was unresolvable or unsafe — never a
hidden success. Exactly one recovery edge exists:

```text
failed → in_progress   (retry, ordered by the TL with explicit conditions)
failed → cancelled     (abort after user/PM confirmation)
```

Retry requires the `failed` source plus explicitly stated
conditions; there is no counter, no automatic loop, and no other
state can originate a retry. Details:
`src/workflow/retry-handoff.ts`.

## Blocked and user input

- `blocked` pauses work the agent cannot proceed with
  (`in_progress → blocked`, blocker documented). It resolves via
  `blocked → in_progress` (blocker resolved) or
  `blocked → needs_user_input` (a user decision is needed).
- `needs_user_input` pauses for human input of any kind: a missing
  answer, a sensitive decision, or an approval gate. It does not
  automatically mean PM approval — the manual approval gate is one
  specific use (`pm_review → needs_user_input`), owned by the
  approval flow, not by generic input requests.

## Approval modes

Configured in `.ai-team/config.yaml` (defaults shown):

```yaml
approval:
  mode: manual              # manual | automatic
  after: ticket             # ticket | sprint (sprint deferred, see below)
  sensitive_changes: always # always | configured | never
```

- **Manual (default):** at `pm_review` the PM requests user
  approval (`pm_review → needs_user_input`); the ticket reaches
  `closed` only on explicit user approval, and returns to
  `changes_requested` on rejection.
- **Automatic:** `pm_review → closed` directly on PM acceptance, no
  user gate.
- `after: sprint` passes validation but approval reports
  `unsupported_scope`: sprint semantics are deferred (open decision
  OQ-3). Do not treat it as implemented.
- `sensitive_changes: always` (default) routes classified sensitive
  changes through user input regardless of mode. It is a routing
  rule, not a sandbox or permission model; values and rules live in
  `docs/configuration.md`.

## Completion is not execution

Five different things, kept separate by design:

```text
execution result   — what the implementation produced
review result      — what the reviewer found
approval           — the explicit human/PM decision where required
completion eligibility — evidence check (W-008): approval granted,
                         review clean, validation present
workflow transition — the state change itself
```

Completion eligibility is computed from evidence; it performs no
transition. A ticket is `closed` only when the eligible state takes
its configured `→ closed` edge — success alone never closes
anything.

## Cancelled

`cancelled` is terminal. Any active state may reach it on explicit
user cancellation (via the Coordinator); `failed` may additionally
reach it on confirmed abort. There is no resume path.

## Worked example

```text
User asks for a feature
→ PM clarifies scope
→ TL creates a small ticket          (ready)
→ Implementer executes               (in_progress → implementation_review)
→ Senior Reviewer checks it
→ reviewer requests changes          (→ changes_requested → in_progress)
→ Implementer updates the ticket     (→ implementation_review)
→ reviewer reports clean             (→ technical_approval)
→ PM reviews                         (→ pm_review)
→ user approves (manual mode)        (→ needs_user_input → closed)
→ next ticket can begin
```

Illustrative: it shows how the states connect, not a feature the
CLI performs autonomously today.

## Failure example

```text
Provider execution fails
→ ticket becomes failed (explicit failure, no fabricated success)
→ retry only when the TL orders it with explicit conditions
→ otherwise abort, block, or cancel through the defined edges
```

## State diagram (verified transitions only)

```text
PRIMARY PATH (clean reviews, approval granted):

ready ──assign──▶ in_progress ──submit──▶ implementation_review
  ──accept──▶ technical_approval ──accept──▶ pm_review ──approve──▶ closed ★
                                                  (auto mode: pm_review ──accept──▶ closed ★)

REVIEW LOOP:

implementation_review ──findings──▶ changes_requested ──rework──▶ in_progress
technical_approval ──rework needed──▶ changes_requested
pm_review ──requirement gap──▶ changes_requested

MANUAL GATE:

pm_review ──request approval──▶ needs_user_input ──approve──▶ closed ★
needs_user_input ──reject/change──▶ changes_requested
needs_user_input ──answer received──▶ in_progress

EXCEPTIONAL PAUSES:

in_progress ──blocker──▶ blocked ──resolved──▶ in_progress
blocked ──user decision needed──▶ needs_user_input
in_progress ──missing info──▶ needs_user_input
in_progress ──unresolvable failure──▶ failed
failed ──retry (TL-ordered, explicit conditions)──▶ in_progress
failed ──confirmed abort──▶ cancelled ★

★ = terminal (no outgoing transitions). Any active state ──user cancels──▶ cancelled ★.
```

## Where to go next

- `docs/specification/workflow.md` — the full contract this guide summarizes.
- `docs/roles.md` — who owns each step.
- `docs/configuration.md` — approval and provider settings.
- `docs/quick-start.md` — run the commands yourself.
