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

## Planning Artifact (M23 T-009)

The Planning Artifact (`src/runtime/planning-artifact.ts`) is the
shared canonical planning data model: a Coordinator section
(request plus explicit objective, context, requirements,
constraints, questions), the PM plan reused verbatim, and the TL
plan reused verbatim — with business and technical constraints
kept separate. Every section is optional, so planning grows
incrementally (Coordinator, then +PM, then +TL) with absence
meaning not-yet-planned, never placeholder text. Construction and
pure `withX` composition validate, copy, and freeze everything;
provider reports are excluded, questions stay questions, and no
task, sprint, approval, persistence, or orchestration exists here —
those belong to M24 and later.

## Planning Approval (M23 T-010)

Planning Approval (`decidePlanningApproval` in
`src/runtime/planning-approval.ts`) gates M23 planning from M24
task generation: one explicit, externally supplied decision
(`approved` or `changes-required`, with optional notes) by the
Project Manager or the Technical Lead — the roadmap's Planning →
PM approval → TL approval chain, recorded one authority at a
time with no sequencing state and no hierarchy. The artifact must
be complete (all three sections present; empty content is not
failure) and question-free to earn `approved`; open questions
allow only `changes-required`, which never replans or re-enters.
The operation is synchronous and provider-free, carries a frozen
artifact copy on its frozen result, mutates nothing, and is
entirely separate from R-020 final approval. M24 starts only
from an approved planning artifact.

## Sprint Model (M24 T-011)

A Sprint (`src/runtime/sprint-model.ts`) is a bounded planned
execution container: a caller-supplied stable `id`, a required
`goal`, and optional `scope` (in/out, the repository's
established shape), `tasks` (task-identifier references only —
the full Task Model belongs to T-012), `dependencies`, and
`acceptance_criteria`. Construction is pure, validated, and
deeply frozen with verbatim preservation. A sprint carries no
status, dates, approval, provider, or issue fields, embeds no
Planning Artifact, and generates nothing — decomposition (T-013),
ticket mapping (T-014), and persistence (T-015) build on it
later.

## Task Model (M24 T-012)

A Task (`src/runtime/task-model.ts`) is one actionable
implementation unit: caller-supplied stable `id` plus the
ticket-compatible `title`, `description`, and `requirements`
(required, so T-014 can map tasks onto tickets without inventing
content), with optional `acceptance_criteria`, `dependencies`
(ordered identifier references, no graph engine), `specialty`
(one of the six canonical Implementer specialties; absent means
a generic Implementer), and `sprint` (identifier reference only,
so both models stay independently constructible). Pure,
validated, deeply frozen, verbatim preservation — with no
lifecycle state (workflow states belong to tickets), no roles,
no estimates, no timestamps, no issue fields, and no generation,
decomposition, mapping, or persistence. Those belong to
T-013/T-014/T-015.

## TL Task Decomposition (M24 T-013)

Task decomposition (`runTechnicalLeadTaskDecomposition` in
`src/runtime/tl-decomposition.ts`) turns an approved plan into
one Sprint plus its Task list: explicit TL identity, a T-009
artifact, and a T-010 `approved` result covering exactly that
artifact are all required up front. Sprint and task structures
are caller-supplied and built through the canonical T-011/T-012
constructors, with the sprint↔task link assigned by construction
(task IDs in order, every task naming the sprint); the provider
is invoked once for opaque considerations whose text never
becomes structure (no parsing, no JSON-in-text protocols).
Artifacts are never mutated, business intent is never rewritten,
and no tickets, persistence, execution, or orchestration happen
here — mapping (T-014) and storage (T-015) build on the output
later.

## Plan-to-Ticket Mapper (M24 T-014)

The mapper (`src/runtime/plan-ticket-mapper.ts`) is the pure,
side-effect-free boundary from planning to execution tickets:
one validated Task becomes one `CoordinatorTicket` (identity
preserved, title/description/requirements verbatim, state
`ready` as the lifecycle entry point) and one `IssueRequest`
(same content, no identifier — issue identity stays
provider-assigned). Acceptance criteria ride as a labeled
description section per the repository's established append
convention; dependencies, specialty, and sprint stay with their
owning layers (decomposition, runtime RoleResolver, Sprint
model). Tickets stay unfrozen so the workflow can advance state;
no transport, persistence, execution, or orchestration happens
here — the IssueProvider and T-015 consume the output later.

## Task Persistence and Readback (M24 T-015)

Persistence (`src/runtime/task-persistence.ts`) stores one
validated sprint plan (`{ sprint, tasks }` as JSON) per sprint
at `<projectRoot>/.ai-team/plans/<sprint-id>.json` — the
existing planning workspace, no new directories — and reads it
back through the canonical T-011/T-012 validators, so stored
data round-trips into identical frozen domain objects.
Validation precedes every write (duplicates, mismatched links,
and path-unsafe IDs rejected); missing or corrupt files throw
loudly, never silent empties; re-persisting replaces wholesale
with no merging. Caller data is never mutated, reads never
cache, project roots never share data, and no transport,
execution, orchestration, or issue-tracker contact exists here.

## Direct Role Execution CLI (M25 T-016)

`ai-team role <role>` (`src/cli-role.ts`, routed in
`src/index.ts`) executes exactly one role directly through the
T-005 independent-execution contract — no orchestration, modes,
delegation, or persistence. Each role takes explicit flags for
its runtime input (ticket fields for all; plus `--specialty`,
`--result`, `--state`, or `--review-decision` per role);
single-evidence TL/PM invocations are the CLI boundary while
the runtime API supports full arrays. Outcomes render the role,
ticket, and exposed reports verbatim with repository exit codes
(0 completed, 1 otherwise); invalid input and missing TTY
decisions fail safely before execution. `run --role` still only
presents contracts; manual handoff I/O arrives in T-017/T-018.

## Copy-Ready Handoff Output (M25 T-017)

Appending `--show-handoff` to `ai-team role <role>` prints
exactly the canonical T-004 rendering of the handoff carried by
that execution — byte-identical, no wrapper, no metadata — for
direct human copy/paste into the next role. Directions are never
retargeted, reports are never parsed, and nothing is constructed
or persisted by the CLI: completed executions without a handoff
report that explicitly, failed executions keep their failure
status, and no destination role is invoked. Handoffs reach role
execution through supply (manual resume arrives in T-018);
delegation transport arrives in M26.

## Manual Handoff Resume (M25 T-018)

Pasting canonical handoff text into `ai-team role <role>
--handoff-stdin` (piped or pasted to stdin, then EOF) resumes
it: `parseAgentHandoffText` (`src/roles/handoff-parser.ts`)
accepts only the exact T-004 grammar — ordered sections,
sequential numbering, duplicates and retargeting rejected —
validates through T-004, verifies byte-identical re-rendering,
and hands the handoff to the selected role's T-005 executor as
gate plus provenance (role inputs still come from flags; no
field merging is invented). Destination mismatch, malformed
text, and empty input fail explicitly; no role chains, no
persistence, no clipboard, no delegation. Paired with
`--show-handoff`, the full manual loop (execute → copy → paste
→ resume) works transport-free until M26.

## Role-Specific Context Isolation (M25 T-019)

Each role receives sufficient explicit context and nothing
else: prompts are built from named fields only (ticket,
evidence, request, handoff slices), validators strip unknown
fields, and provider invocations carry just prompt, project
root, and role identity. Upstream context flows where
contracted (requirements to TL/review, feedback to TL/PM
review, mapped acceptance into ticket descriptions) while
reviewer notes, planning deliberation, workflow internals,
provider secrets, and prior reports stay out unless an explicit
contracted field carries them; handoffs gate but never merge.
No new managers, helpers, or registries were needed — the
existing explicit construction already isolates, and the
executable allowlists pin it. No orchestration is introduced.

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

## Manual full-team flow (M25 T-020)

The five roles compose into one feature flow with the human as
the workflow coordinator. No delegation, no automatic chaining,
no modes: every arrow below is a person copying output from one
step into the next step's explicit input.

```text
1. Run Coordinator planning (request in, Coordinator → PM handoff out)
2. Copy the Coordinator → PM handoff text
3. Run PM planning with that handoff (PM → TL handoff out)
4. Copy the PM → TL handoff text
5. Run TL planning with that handoff (technical plan out)
6. Assemble the PlanningArtifact (coordinator + PM + TL sections)
7. Record an explicit Planning Approval decision (approved or
   changes-required, with a PM or TL identity)
8. Decompose the approved artifact into one Sprint plus Tasks
   (caller-structured: you supply sprint fields and task inputs)
9. Map the chosen Task to a Ticket representation (no GitHub call)
10. Persist the Sprint + Tasks, then read them back and use the
    read-back models for everything downstream
11. Run the Implementer independently for the selected read-back Task
12. Author the Implementer → Reviewer handoff from the ticket plus
    the implementation result (canonical fields only — the
    Implementer emits no handoff of its own, so `--show-handoff`
    has nothing to print there) and copy its rendered text
13. Run the Senior Reviewer independently with that handoff supplied
    via `--handoff-stdin`
14. Handle any changes-required report yourself: nothing re-invokes
    the Implementer automatically (richer re-entry arrives in M28)
```

Handoffs move through the copy-ready loop only: `renderAgentHandoff`
prints the text, the human copies it, `--handoff-stdin` feeds it to
the next role, and parse plus validation reject anything malformed
or misaddressed before the destination role runs. Handoffs gate;
they never merge into role inputs, are never written to disk, and
no clipboard API is involved. Where a delegate-skills transport
is configured, the same handoff can travel through
`createDelegateSkillsHandoffTransport` instead (implementer
destinations only; brief rendered from canonical fields; no
fallback) — see `docs/providers.md`. Parity between the two
transports is proven, not assumed: identical field semantics
(multiline/unicode/order/presence preserved), direction approval
shared, hostile content unable to retarget either path, receipts
kept out of handoff meaning. Unsupported delegate destinations
fail explicitly with the handoff untouched; manual transport
stays independently usable after any delegate failure.
When delegation fails, `createManualFallback` exposes the same
canonical handoff as copy-ready manual text — same destination,
same meaning, user decides whether to continue. No retry, no
alternate transport, no automatic local execution, no new
commands: the existing `--handoff-stdin` resume path is the
fallback path.

## Work Modes (M27 T-026, contract only)

A Work Mode names one workflow composition — how much of the
team participates — independent of roles, providers, transports,
approvals, workflow states, and priorities. Three canonical
modes, lowercase and exact, with no aliases and no default:

- `fast` — minimal implementation/review lifecycle
  (Implementer → Senior Reviewer). No planning roles, no
  Sprint/Task generation, no approval gates.
- `standard` — Coordinator plus Technical Lead planning around
  implementation/review. Planning participates; Sprint/Task
  generation and approval gates do not.
- `full` — the complete planning/business/technical lifecycle
  through Sprint/Task generation, implementation/review,
  technical acceptance, PM validation, and Final approval.

The runtime contract (`src/runtime/work-mode.ts`) is identity
plus a declarative composition policy (`lifecycle` role order
plus `planning`/`sprints`/`approvals` flags) that later tickets
consume: T-027/T-028/T-029 implement the paths, T-030 owns
recommendation (no mode is ranked or preferred here), T-031
owns guardrails. Modes are not quality tiers, priorities, or
speed settings; the flags describe composition and enforce
nothing. No execution, persistence, configuration, or CLI
belongs to the contract.

## FAST Path (M27 T-027, first mode path)

`runFast` (`src/runtime/fast-path.ts`) executes the `fast`
composition and nothing else: one `executeIndependentImplementer`
call, then — only on Implementer success — one
`executeIndependentSeniorReviewer` call built from explicit
fields (same ticket plus the implementation result text), then
the caller-supplied `ReviewDecisionResolver` exactly once.
Terminal results reuse existing vocabularies: `completed` on
`approved`, `changes-required` with verbatim feedback on
`changes_requested` (the path stops; M28 owns re-entry),
`failed` with a stage marker (`implementer`/`reviewer`/
`decision`) on any failure. FAST takes a ticket in the
Implementer's existing shape (no Task conversion, no mapper),
invents no handoff, and skips planning, sprints, approvals,
Coordinator/PM/TL, persistence, retry, and local re-execution.
It is provider-neutral — the injected provider is used as
supplied, never selected or dispatched — and runtime-only
(no CLI). STANDARD (T-028) and FULL (T-029) build on this
precedent; recommendation (T-030) and guardrails (T-031) come
later.

## STANDARD Path (M27 T-028, second mode path)

`runStandard` (`src/runtime/standard-path.ts`) executes the
`standard` composition: Coordinator Planning over the user
request, Technical Lead evidence review over caller-supplied
evidence, then the FAST-precedent Implementer → Reviewer →
explicit decision chain. The coordinator's PM-bound handoff is
exposed as provenance and never consumed — STANDARD has no PM
and retargeting is forbidden — and no handoff, plan, or report
is ever merged into a downstream input: every step runs on
explicit caller-supplied fields with opaque reports. Terminal
results mirror FAST (`completed` / `changes-required` with
verbatim feedback / `failed` with a five-stage marker), each
carrying the structured coordination, TL, implementation, and
review results. Excluded per the descriptor (`planning=true`,
`sprints=false`, `approvals=false`): PM in any form, TL
planning (it requires a PM handoff), artifact/approval/
decomposition/sprint/task/mapper/persistence/final-approval
stages, retry, fallback, re-entry, and delegation dispatch —
the path is provider-neutral and runtime-only. FULL (T-029)
adds the business-planning lifecycle next.

## FULL Path (M27 T-029, complete mode path)

`runFull` (`src/runtime/full-path.ts`) executes the `full`
composition end to end: Coordinator Planning → PM Planning
(canonical Coordinator → PM handoff) → TL Planning (canonical
PM → TL handoff) → PlanningArtifact (all three sections) →
explicit PM + TL Planning Approval (both required; the TL
approval feeds decomposition) → caller-structured Sprint/Task
Decomposition → T-014 mapping of one explicitly selected
`task_id` (no fan-out, no arbitrary-first) → T-015
persistence + readback (execution uses readback models) →
Implementer → Senior Reviewer → explicit review decision →
Technical Acceptance (explicit TL resolver over tickets the
runner advances along canonical W-002 edges on its own
copies: ready → in_progress → implementation_review →
technical_approval) → PM Validation (explicit PM resolver,
gated on TL approval) → R-020 Final Approval (explicit
coordinator authority + resolver; ticket closes) → Done.
Every rejection or failure stops the invocation with a
bounded `completed` / `changes-required` (with stage +
verbatim feedback) / `failed` (with stage + error) result —
no retry, fallback, re-entry, or alternate transport. Reports
stay opaque throughout (no report parsing anywhere);
structured fields stay caller-owned; acceptance scope is the
executed ticket. Provider-neutral and runtime-only (no CLI);
delegation never required. Recommendation (T-030) and
guardrails (T-031) remain deferred.

## Mode Recommendation (M27 T-030, advice only)

`recommendMode` (`src/runtime/mode-recommendation.ts`) advises
which mode fits caller-asserted facts — it never executes,
overrides, or permits anything. Explicit boolean signals only
(all four required, never inferred from text, reports, scope,
or risk): `needsBusinessPlanning`, `needsSprintDecomposition`,
or `needsApprovals` recommends `full` (only FULL composes PM
planning, sprints, and approval gates); otherwise
`needsTechnicalPlanning` recommends `standard`; otherwise
`fast` fits the bounded change. The deterministic rationale
names the supplied signals and the rule applied — nothing
about size, risk, quality, or preference. An explicit
`selectedMode` is preserved verbatim: agreement and
disagreement surface as `matchesSelection`, and disagreement
alone sets `requiresConfirmation` for the caller to resolve.
No execution paths, providers, I/O, guardrails (T-031), or
re-entry are involved.

## Mode Guardrails (M27 T-031, capability check only)

`checkModeGuardrails` (`src/runtime/mode-guardrails.ts`)
answers whether an explicitly selected mode satisfies the
required lifecycle capabilities — advice about permission,
not permission itself, and never execution. Capability sets
derive from the live T-026 descriptors: business planning,
sprint decomposition, or approvals each require `full`;
technical planning alone requires `standard` or `full`; with
no needs declared, every mode is compatible. Results are a
discriminated union — `allow`, `confirmation-required`, or
`reject` — always carrying the selected and recommended modes
separately (the selection is never replaced). A compatible
selection that differs from the recommendation needs explicit
`{ confirmed: true }` before an allow decision; absent
confirmation is never approval, and confirmation acknowledges
the discrepancy only — it can never bypass a missing
capability. Rejections name every unmet capability in signal
order. The module evaluates only: no runners, providers,
approvals, persistence, retry, re-entry, enforcement, or
later-ticket behavior, and it claims nothing about direct
runtime calls made outside it (M29 owns orchestration-wide
enforcement).

## Correction Reference (M28 T-032, traceability only)

`createCorrectionReference` /
`validateCorrectionReference`
(`src/runtime/correction-reference.ts`) records the link
between a correction raised by an existing review or approval
stage and the explicit action expected to address it — source
(`reviewer`, `technical-lead`, `project-manager`,
`final-approval`, `planning-approval`), concerned ticket ids,
verbatim feedback, and a caller-authored action (description
plus optional existing ticket id). Feedback travels exactly
as supplied: opaque text is never parsed into requirements,
and no summary replaces it. Everything relational is
caller-supplied — a correction without stated feedback is
rejected rather than guessed — and nothing claims resolution,
severity, priority, or ownership. Recording is not executing:
rework handoffs (T-033), re-entry (T-034/T-035/T-036), and all
execution stay deferred.

## TL→Implementer Rework Handoff (M28 T-033, creation only)

`createTlImplementerReworkHandoff`
(`src/runtime/tl-implementer-rework-handoff.ts`) turns a valid
`technical-lead` correction reference into the canonical
`AgentHandoff` to the Implementer — and stops there. The
documented mapping: `objective` carries the caller-authored
action description (what the receiver must do);
`notes` carries the original feedback byte-identical;
`artifacts` carries every correction ticket id bare and
stable, plus the action ticket when it names one outside that
set; requirements, criteria, constraints, context, and next
action stay absent (opaque feedback is never structured, and
nothing is synthesized). Non-TL origins are rejected, never
reinterpreted; the result passes `validateAgentHandoff`
(direction approval included), renders with the existing
renderer, and resumes through the existing manual parser. No
dispatch, execution, status change, persistence, CLI, retry,
re-entry, or orchestration — creating a handoff is not
executing it, and PM→TL (T-034), final-approval (T-035), and
generic re-entry (T-036) remain deferred.

## PM→TL Re-entry Handoff (M28 T-034, creation only)

`createPmTlReentryHandoff`
(`src/runtime/pm-tl-reentry-handoff.ts`) turns a valid
`project-manager` correction reference into the canonical
`AgentHandoff` to the Technical Lead — same tested convention
as T-033 (objective ← action description, notes ← verbatim
feedback, artifacts ← every ticket id plus an outside action
ticket, nothing structured invented), validated through the
existing validators including PM→TL direction approval. It
differs from the PM→TL planning handoff in meaning, not
direction: planning carries forward-looking business content
for first-pass design, while re-entry carries
backward-looking correction content for rework — the fields
prove which is which, and neither is reused as the other.
Origin `project-manager` records the PM role as source
without independently proving the user-testing stage. No TL
execution, looping, persistence, or orchestration — creating
the handoff is not running re-entry, and final-approval
(T-035), generic re-entry (T-036), and M29 remain deferred.

## Final-Approval Re-entry Handoff (M28 T-035, creation only)

`createFinalApprovalReentryHandoff`
(`src/runtime/final-approval-reentry-handoff.ts`) turns a
valid `final-approval` correction reference into the canonical
`AgentHandoff` from the coordinator authority toward an
explicit caller-supplied destination — same tested convention
as T-033/T-034 (objective ← action description, notes ←
verbatim feedback, artifacts ← every ticket id plus an
outside action ticket, nothing structured invented), with one
difference: the destination is required input, never inferred.
Missing destinations fail; unsupported pairs (coordinator
reaches project-manager and technical-lead only) are rejected
by the existing validator, never retargeted. Provenance
limit: origin `final-approval` plus `from: coordinator`
reflect the stage literal and the R-020 authority role
without independently proving a specific approval event —
the caller must actually hold a final-approval
changes-required outcome. No execution, dispatch, status
change, persistence, CLI, retry, re-entry, or orchestration —
creating the handoff is not running re-entry, and generic
re-entry (T-036) plus M29 remain deferred.

## Re-entry Request Contract (M28 T-036, unified validation)

`createReentryRequest` / `validateReentryRequest`
(`src/runtime/reentry-request.ts`) binds one validated
`CorrectionReference` to one canonical `AgentHandoff` under
a discriminator naming the established form —
`tl-implementer`, `pm-technical-lead`, or `final-approval`.
Pair consistency is proven without duplicating route policy:
the constructor rebuilds the expected handoff through the
origin's own T-033/T-034/T-035 constructor and requires
equivalence with the supplied handoff — origins without a
form are rejected, and any unrelated or altered handoff
fails, however canonical it is alone. Source and action
stay separate, feedback stays verbatim, ticket references
stay ordered, and nothing is parsed or synthesized. The
request renders, parses, and revalidates through the
existing manual grammar per form. Provenance limits carry
over unchanged: origin category only, no verified event, no
resolution or execution claims. Validation describes intent;
it authorizes and executes nothing. M28 is complete (5/5);
M29 orchestration remains deferred.

## New Project Workflow (M29 T-037, planning only)

`runNewProject` (`src/runtime/new-project-workflow.ts`) takes
a caller project brief through one dedicated planning run:
Coordinator Planning → PM Planning (canonical handoffs) → TL
Planning → complete three-section PlanningArtifact → explicit
PM + TL Planning Approval (both required, same artifact) →
caller-structured Sprint/Task Decomposition → T-015
persistence + readback under the caller project root → Done.
Structured fields stay caller-owned and reports stay opaque
throughout; any rejection or failure stops the workflow with
a bounded completed / changes-required / failed result — no
retry, re-entry, or recovery. The result carries the frozen
artifact, both approvals, the read-back Sprint/Tasks, and
the plan path. No Implementer/Reviewer, acceptance,
validation, final approval, scaffolding, delegation, or CLI:
feature work belongs to T-039, existing projects to T-038,
setup to M30.

## Existing Project Workflow (M29 T-038, planning for existing code)

`runExistingProject`
(`src/runtime/existing-project-workflow.ts`) plans against a
project that already exists: it validates the caller context
(`kind` must be `"existing"` — a bare root proves nothing),
runs the read-only discovery analysis over the actual root
(detectors report real findings with coverage metadata; an
unreadable root fails before any planning call), then
delegates the full planning sequence to `runNewProject`
bound to the validated root — one root, no divergence
between analyzed and persisted state. Results carry the
`existing-project` tag plus the frozen discovery report, so
the two workflows never blur. Nothing is invented about the
project (facts come from detectors or explicit caller
input), no source file is created or modified (only the
T-015 plan file is written), and there is no execution,
acceptance, scaffolding, delegation, or CLI. T-039 owns
feature lifecycles; T-038 stops at the approved,
persisted plan.

## FULL Feature Lifecycle (M29 T-039, dedicated entry point)

`runFullFeatureLifecycle`
(`src/runtime/full-feature-lifecycle.ts`) runs one feature
through the canonical FULL lifecycle by delegating to the
`runFull` engine with the mode fixed to `full` — same
planning, approvals, decomposition, persistence, execution,
acceptance, validation, and final approval, with the same
`FullResult` union returned verbatim. Any caller mode field
is rejected rather than replaced (mode disputes belong to
the recommendation/guardrail contracts). No second
sequence, no report parsing, no discovery run (an optional
`discovery_summary` passes straight through), no re-entry
loops, delegation, scaffolding, checkpoints, CLI, or
orchestration framework. STANDARD (T-040) and FAST (T-041)
lifecycles, parity (T-042), and checkpoints (T-043) remain
deferred.

Direct role execution uses the existing command surface only:

```text
ai-team role implementer --id T-101 --title TITLE --description TEXT --requirements TEXT --specialty backend
ai-team role implementer --id T-101 ... --show-handoff
ai-team role senior-reviewer --id T-101 --title TITLE --description TEXT --requirements TEXT --result TEXT --handoff-stdin < handoff.txt
```

Planning, artifact assembly, approval, decomposition, ticket
mapping, and persistence are runtime API calls (see
`tests/manual-full-team-flow.test.ts`, which walks the whole flow
hermetically). A `changes-required` approval, a failed
decomposition, a persistence error, or an implementer failure all
stop the flow with an explicit result — later steps simply have no
input to consume. This flow is the complete M25 milestone: M26
adds optional agent-to-agent delegation, M27 modes, M28 re-entry,
M29 orchestration.

## Delegated transport (M26 T-021, optional)

Manual handoff movement has a transport twin: `dispatchHandoff`
carries the same canonical `AgentHandoff` through an explicitly
selected `HandoffTransport` instead of through a human clipboard.
Same semantics (validated, approved direction, never mutated,
never retargeted), same destination (`handoff.to`), one attempt,
bounded `dispatched`/`failed` result, no retry, no fallback, no
local execution. The dispatcher is runtime-only with no CLI, and
core works identically when no transport exists — delegation is
transport, not workflow ownership. The delegate-skills adapter
(T-022), capability detection (T-023), and failure fallback (T-025)
build on this contract later.

## Where to go next

- `docs/quick-start.md` — run these commands yourself.
- `docs/specification/roles.md` — the full role contracts.
- `docs/specification/workflow.md` — states, gates, and transitions.
- `docs/configuration.md` — approval modes and provider settings.
