# Roles Guide

What the five AI Team Framework roles do, how to select them, and
where each role's authority ends. The binding contract is
`docs/specification/roles.md`; this guide is the beginner-friendly
view. Verified against `src/roles/`, `src/cli.ts`, and the live CLI.

## Why multiple roles

One request needs different kinds of judgment: understanding the
user, defining scope, planning technically, writing code, and
checking the result. The framework assigns each judgment to the
role that owns it, so no single step silently absorbs the others.
The typical flow (roles are invoked as needed, not always all of
them):

```text
Coordinator
→ Project Manager
→ Technical Lead
→ Implementer
→ Senior Reviewer
→ Technical Lead
→ Project Manager
→ User approval when required
```

## Coordinator

The default user-facing role and the entry point (`ai-team run`
with no role flag selects it). It receives your request, routes it
to the right role, carries context between roles, and reports
progress and results — including relaying your explicit approval
decisions. It is not an implementation role: it writes no code and
never replaces the Technical Lead on technical decisions.

Final Coordinator approval (`runFinalApproval`) requires explicit
PM/User Testing approval first, then one explicit Coordinator
decision over the current ticket snapshot with the opaque PM
report as evidence. It mutates nothing and creates nothing —
translating approval into ticket state transitions belongs to
later orchestration work.

## Project Manager

Owns requirements, scope, and business acceptance. It collects
requirements, turns them into plans, asks when requirements are
missing, and later checks whether the implementation matches what
was agreed. It is not the low-level implementation authority — that
belongs to the Technical Lead's tickets and the Implementer.

PM/User Testing is an explicit sprint-level boundary
(`runPmUserTestingReview`) that runs only after explicit
Technical Lead approval: one provider invocation under the
`project-manager` identity over the current ticket snapshot,
an opaque report, and an explicit verdict (`approved` or
`changes-required`). It is report-opaque and non-mutating —
it creates no correction tickets and performs no final
Coordinator approval.

## Technical Lead

Owns project discovery, technical planning, ticket breakdown, and
technical acceptance. It analyzes your project as it is (any
language or stack — the framework prescribes none), records
constraints and conventions, splits work into small tickets,
assigns Implementer specialties, decides rework-or-proceed after
review, and escalates technical decisions it cannot resolve. It
never invents requirements; those stay with the Project Manager.

After Coordinator work is ready (no executable, in-flight,
blocked, failed, or invalid tickets remain), the Technical Lead
reviews the sprint as a separate runtime stage
(`runTechnicalLeadReview`): one provider invocation under the
explicit `technical-lead` identity, an opaque report, and an
explicit verdict (`approved` or `corrections-required`). The
review never mutates tickets and never creates correction
tickets itself — those belong to a later stage — and it never
invokes PM or user review.

Technical Lead corrections produce one generic aggregated
correction ticket through `IssueProvider`
(`createTechnicalLeadCorrectionTicket`): the affected ticket
IDs plus verbatim notes, never a parsed report or per-ticket
fan-out.

## Implementer

Implements exactly one assigned ticket: reads its scope, makes the
change, runs the required validation, and reports precisely what
changed. It does not expand scope silently, does not review its
own work, does not grant approval, and does not close tickets.
Implementation ends in a result handed to review.

## Implementer specialties

Specialties select the *kind* of implementation work. They are not
separate roles — the role is always `implementer`. Exactly six
exist, verified in `src/roles/contract.ts`:

```text
backend
frontend
integration
database
testing
documentation
```

```bash
node dist/index.js run --role implementer --specialty testing
```

A specialty is optional and never defaulted: without `--specialty`
the Implementer still resolves, with no specialty line shown.

## Senior Reviewer

Reviews implementation and tests against requirements, conventions,
and regressions, then reports one of two outcomes: explicit
findings requiring changes, or an explicit clean report. The
boundary is strict and verified in the M9 review flow:

```text
Reviewer reviews.
Reviewer does not modify implementation.
Reviewer does not grant approval by itself.
Reviewer does not close the ticket.
```

## How to select a role

### CLI flags

```bash
node dist/index.js run --role coordinator
node dist/index.js run --role project-manager
node dist/index.js run --role technical-lead
node dist/index.js run --role implementer
node dist/index.js run --role senior-reviewer
```

### Aliases

Four short forms exist, verified in `src/roles/selection.ts`:

```text
pm       → project-manager
tl       → technical-lead
reviewer → senior-reviewer
sr       → senior-reviewer
```

Input is trimmed and lowercased, so `  TL  ` works. Nothing else is
matching: no fuzzy correction, no prefix guessing.

### Prompt text

```bash
node dist/index.js run "talk to the tech lead"
```

A fixed keyword set maps prompt text to one role
(`docs/specification/roles.md` §7). Exactly one distinct role must
match; zero or conflicting matches resolve to nothing. This is
keyword matching, not language understanding: arbitrary synonyms
and other languages are out of scope.

### Slash commands

Shortcuts for the same selection, not separate implementations:

```bash
node dist/index.js run "/technical-lead"
node dist/index.js run "/implementer testing"
```

Five commands exist (`/coordinator`, `/project-manager`,
`/technical-lead`, `/implementer`, `/senior-reviewer`); only
`/implementer` accepts a specialty. Forms are exact — `/pm`,
`/Technical-Lead`, and trailing words on non-Implementer commands
are rejected.

## Invalid selection

Unknown roles fail loudly without a fallback. There is no silent
Coordinator default and no near-match correction:

```bash
$ node dist/index.js run --role bogus
error: unknown command "run --role bogus".
Run "ai-team --help" for usage.
```

Exit code is 1 with empty stdout. The same holds for unknown
specialties, prompt text matching no keyword, and undocumented
slash forms. (Inspected for the known fallback-vs-error question:
both layers agree — `resolveRole` returns `undefined`, the CLI
reports `unknown command`. No discrepancy found.)

## Role boundaries at a glance

```text
Coordinator     = orchestration/user-facing coordination
Project Manager = requirements/scope
Technical Lead  = technical planning/decomposition
Implementer     = implementation
Senior Reviewer = review
```

No role outranks another; each owns its judgment and escalates the
rest. In particular: the Coordinator never decides scope, the PM
never decides implementation, the Implementer never approves, and
the Reviewer never edits.

## Operating model (M22 T-001)

The canonical operating model is declared in
`src/roles/operating-model.ts` on top of the five contracts in
`src/roles/`. Per role: owns → does not own → scoped authority →
output it must be able to hand off (the handoff schema itself is
later work, not implemented here).

| Role | Scoped authority | Hands off |
|---|---|---|
| Coordinator | workflow and orchestration | planning/orchestration direction |
| Project Manager | requirements, scope, business | requirements/scope/acceptance/business plan |
| Technical Lead | technical architecture/decomposition | technical plan/decomposition/constraints |
| Implementer | implementation within approved scope | implementation result + tests/evidence |
| Senior Reviewer | implementation review | review result + actionable feedback |

Approved handoff directions (definition only — no handoff mechanism
is implemented in T-001):

```text
Coordinator → Project Manager, Technical Lead
Project Manager → Technical Lead, Coordinator
Technical Lead → Implementer, Project Manager, Coordinator
Implementer → Senior Reviewer, Technical Lead
Senior Reviewer → Implementer, Technical Lead
```

Every role is directly invocable (`User → <role>` for any of the
five); invoking one role never automatically invokes another, and
the full team chain is one possible composition, not a dependency.
Boundary behavior: surface problems to the owning authority through
the workflow — the Implementer never silently rewrites requirements
or becomes the Technical Lead, the Reviewer never silently redefines
scope, and PM and TL never silently replace each other.

## Agent Identity (M22 T-002)

An agent acting as a role holds an **Agent Identity** (declared in
`src/roles/identity.ts`): exactly one canonical role, validated and
frozen for one invocation. The five canonical identities are the
`RoleId` values — `coordinator`, `project-manager`,
`technical-lead`, `implementer`, `senior-reviewer` — and nothing
else: no sixth role, no `user` identity, no provider or model names.

```text
Identity:  technical-lead        ← WHO performs this invocation
Invocation: ticket/sprint context + role-specific task  ← WHAT is given
Provider:   some AgentProvider   ← HOW it executes
```

Identity is **explicit**: it is supplied and validated
(`validateAgentIdentity`), never inferred from prompt words,
provider names, or apparent task simplicity — `pm`, `tl`,
`reviewer`, and `sr` are presentation-layer conveniences resolved
before validation and are rejected as identities. Identity is
**immutable** per invocation: a different role means a new identity,
never a mid-invocation change, and an identity satisfies only its
own role — a Senior Reviewer identity never passes a Technical Lead
check, with no silent reuse. Every identity stands alone: a
`project-manager` identity never requires a Coordinator invocation
to exist. An identity selects exactly one existing role contract
(`getRoleContract` returns the shared contract object); it never
redefines responsibilities — those stay in `src/roles/` and the
operating model above.

## Canonical Handoff (M22 T-003)

Work moves between roles as a canonical **Agent Handoff**
(`src/roles/handoff.ts`, built with `createAgentHandoff`): sender,
receiver, the receiver's objective, and bounded supporting
information — optional context, requirements, acceptance criteria,
constraints, artifact references, notes, and the expected next
action. Requirements stay verbatim and separate from constraints;
acceptance criteria stay optional; notes never double as approvals
(there is no approval field); next actions describe, never command.

Handoffs are frozen on creation — including their collections —
deterministic, free of IDs, timestamps, provider metadata, workflow
states, and report parsing. The same object works for manual
copy/paste today and delegated transport later. A permitted
direction never forces execution: it only says the transfer is
structurally valid.

> The canonical role-to-role handoff contract is distinct from the
> existing retry/rework handoff mechanism (`createHandoff` in
> `src/workflow/retry-handoff.ts`); their direction sets are not
> required to be identical.

## Handoff Validation (M22 T-004)

`validateAgentHandoff` (`src/roles/handoff-validation.ts`) enforces
the full contract: canonical sender and receiver, distinct
endpoints, an approved operating-model direction (a structurally
valid pair such as `coordinator → implementer` is still rejected),
and bounded fields. Invalid input throws — nothing is coerced or
redirected — and the result is frozen with defensive copies.

## Human-readable Handoff Rendering (M22 T-004)

`renderAgentHandoff` validates first, then produces one deterministic
artifact: the `=== AI TEAM HANDOFF ===` header, `From`/`To`, and the
objective plus only the sections present, in fixed order, with lists
numbered in caller order and all content verbatim. The text is plain
and copyable — no JSON, commands, IDs, or provider syntax — and
works identically for manual paste today and delegated transport
later. Reports stay opaque and nothing executes: rendering is
presentation only, and the retry/rework mechanism is untouched.

## Independent Role Execution (M22 T-005)

Each role is invocable alone through a thin boundary
(`src/roles/independent-execution.ts`) over its existing execution
seam — Coordinator over the ticket runtime, Project Manager over
PM/User Testing, Technical Lead over TL review, Implementer over
ticket execution, Senior Reviewer over review. The caller supplies
an explicit identity (mismatches fail before anything runs), the
complete seam input, and optionally a validated handoff addressing
that role; direct execution without a handoff is fully supported.
Exactly one underlying provider call happens per invocation — no
retry, no fallback — and no other role is ever invoked, so
delegate-skills is not required and handoff transport stays
separate. Results preserve the seam's own outcome; a supplied
handoff travels on the outcome as provenance. This establishes
invocability only: planning, decomposition, CLI commands, modes,
and orchestration remain future work.

## Coordinator Planning (M23 T-006)

Planning and ticket execution are separate Coordinator
capabilities: `runCoordinatorTicket` keeps running tickets, while
`runCoordinatorPlanning` (`src/runtime/coordinator-planning.ts`)
handles a user request before PM planning. Given an explicit
Coordinator identity and caller-structured content, it builds a
validated Coordinator → Project Manager handoff — objective,
verbatim request and context, explicit requirements/constraints,
unresolved questions as notes, and a descriptive PM next action —
then invokes the Coordinator planning agent exactly once and
returns the frozen handoff plus the provider's opaque report
(never parsed). Nothing is invented: no requirements, technology,
acceptance criteria, or tasks are filled in, and missing
information becomes explicit questions, not answers. Nobody is
invoked automatically — PM planning (T-007) consumes the handoff
later, manually or delegated.

## Project Manager Planning (M23 T-007)

PM planning (`runPmPlanning` in `src/runtime/pm-planning.ts`) is
distinct from PM/User Testing: it takes the validated Coordinator
→ PM handoff plus caller-structured business content and produces
a frozen PM plan (requirements, in/out scope, acceptance criteria,
business rules, business constraints, unresolved questions) with
an opaque provider report that is never parsed. With no open
questions it also emits a validated PM → Technical Lead handoff —
requirements to requirements, acceptance to acceptance criteria,
scope and rules as labeled business context, business constraints
to constraints, questions to notes; with open questions it returns
`clarification-required` and no TL handoff instead of pretending
readiness. Business meaning never becomes technical prescription,
one provider call happens at most once, and nobody is invoked —
TL planning (T-008) consumes the handoff later.

## Technical Lead Planning (M23 T-008)

TL planning (`runTechnicalLeadPlanning` in `src/runtime/tl-planning.ts`)
is distinct from TL sprint review: it takes the validated PM → TL
handoff plus caller-structured technical content and returns a frozen
TL plan (architecture, decomposition strategy, technical constraints,
dependencies, unresolved questions) with an opaque provider report
that is never parsed. The PM handoff stays the untouched business
source; technical content comes only from explicit caller input, and
the decomposition strategy never becomes tasks, sprints, issues, or
an Implementer handoff — those belong to M24. Open questions return
`clarification-required` with the partial plan; one provider call
happens at most once; nobody is invoked.

## Practical example (conceptual)

```text
User: "Add CSV export for customer reports."

Coordinator → routes the request
Project Manager → defines scope and acceptance criteria
Technical Lead → analyzes the project, creates a small ticket
Implementer → implements the ticket
Senior Reviewer → reviews the result
Technical Lead / PM → continue per the configured workflow and approval mode
```

Conceptual: it shows how the roles divide one request, not behavior
the CLI performs autonomously today.

## Where to go next

- `docs/quick-start.md` — run these commands yourself.
- `docs/specification/roles.md` — the full role contracts.
- `docs/specification/workflow.md` — states, gates, and transitions.
- `docs/configuration.md` — approval modes and provider settings.
