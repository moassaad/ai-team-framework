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

## Project Manager

Owns requirements, scope, and business acceptance. It collects
requirements, turns them into plans, asks when requirements are
missing, and later checks whether the implementation matches what
was agreed. It is not the low-level implementation authority — that
belongs to the Technical Lead's tickets and the Implementer.

## Technical Lead

Owns project discovery, technical planning, ticket breakdown, and
technical acceptance. It analyzes your project as it is (any
language or stack — the framework prescribes none), records
constraints and conventions, splits work into small tickets,
assigns Implementer specialties, decides rework-or-proceed after
review, and escalates technical decisions it cannot resolve. It
never invents requirements; those stay with the Project Manager.

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
