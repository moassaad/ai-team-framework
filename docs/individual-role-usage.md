# Individual Role Usage Guide

How to invoke each of the five AI Team roles on its own with
`ai-team role <role>`, what each role actually does, and how to pass
work to the next role with the manual copy/paste handoff. For
planning a whole project, see `docs/quick-start-new-project.md` and
`docs/quick-start-existing-project.md`; for the architecture
reference, `docs/roles.md`.

## Prerequisites

- The framework checkout, built (`npm install`, `npm run build`;
  see `docs/installation.md`).
- A configured project directory: run every command below from
  inside it, because the CLI uses the current directory as the
  project root and validates `<project>/.ai-team/config.yaml`
  before anything else. Without it you get `role error:
  Configuration file not found: ...` (exit 1) before any flag is
  even parsed. See `docs/configuration.md`.
- A working provider for real execution: production role commands
  call through the OpenCode provider, so OpenCode must be installed
  and reachable (see `docs/providers-opencode.md`). Without it the
  command fails with the provider's error — exit 1, nothing
  invented. The examples below show exact commands and verified
  outputs; your report text will differ because it comes from the
  provider.

## One role, nothing else

`ai-team role <role> [role inputs]` executes exactly one role with
no orchestration, no modes, no delegation, and no persistence.
Running the Coordinator alone does not run PM or Technical Lead;
running the Implementer alone does not run the reviewer, acceptance,
validation, or approval; running a reviewer never triggers another
implementation attempt. Complete team sequences are separate
operations (`runNewProject`, `runExistingProject`, and the FAST /
STANDARD / FULL lifecycles — TypeScript APIs documented in
`docs/roles.md`, not CLI shortcuts).

Roles: `coordinator`, `project-manager`, `technical-lead`,
`implementer`, `senior-reviewer` (aliases `pm`, `tl`, `reviewer`,
`sr` resolve before execution). Anything else prints the usage text
(exit 1). Flags are per-role: unknown, duplicate, or valueless flags
fail (`unsupported flag`, `duplicate flag`, `missing value for`),
and every role requires its own set below (`missing required
--title`, exit 1).

## Implementer

Implements one ticket: one provider attempt, no retry. Required
flags: `--id`, `--title`, `--description`, `--requirements`, plus
`--specialty` (one of `backend`, `frontend`, `integration`,
`database`, `testing`, `documentation` — anything else fails with
`unknown specialty`, exit 1). It does not receive a project plan
automatically and never invents missing acceptance criteria: the
ticket you pass is the whole assignment.

```bash
ai-team role implementer --id T-001 --title "Render the list" --description "Server-render saved articles newest first." --requirements "Saved articles appear in reverse-chronological order" --specialty backend
```

Success (exit 0):

```text
role implementer completed: ticket T-001 -> implementation_review.
```

Failure keeps the ticket id, the error kind, and the message
(exit 1):

```text
role implementer-failed: ticket T-001 (<kind>): <message>.
```

## Senior Reviewer

Reviews one implementation and writes an advisory report — it never
modifies code. Required flags: the four ticket flags plus `--result`
(the implementation result text to review). The report is opaque
provider text: it is not an approval, and it never reruns the
Implementer on its own. Acceptance is a separate explicit decision
owned by later contracts, not something review text grants.

```bash
ai-team role senior-reviewer --id T-001 --title "Render the list" --description "Server-render saved articles newest first." --requirements "Saved articles appear in reverse-chronological order" --result "Implemented per description."
```

Success (exit 0):

```text
role senior-reviewer completed: ticket T-001.
Report:
<report text>
```

## Technical Lead (role command)

Performs the post-implementation technical-approval review of one
ticket in a given workflow state — not technical planning and not
task decomposition (those live in the planning workflow APIs).
Required flags: the four ticket flags plus `--state`, which must be
a canonical workflow state (`ready`, `in_progress`,
`implementation_review`, `technical_approval`, `pm_review`,
`closed`, `blocked`, `needs_user_input`, `changes_requested`,
`failed`, `cancelled`); anything else fails with `unknown workflow
state`, exit 1.

```bash
ai-team role technical-lead --id T-001 --title "Render the list" --description "Server-render saved articles newest first." --requirements "Saved articles appear in reverse-chronological order" --state technical_approval
```

Success (exit 0):

```text
role technical-lead completed.
Report:
<report text>
```

## Project Manager (role command)

Performs PM user-testing validation of one ticket in a given
workflow state — not business planning (that lives in the planning
workflow APIs). Same flags as the Technical Lead command, with a
state such as `pm_review`:

```bash
ai-team role project-manager --id T-001 --title "Render the list" --description "Server-render saved articles newest first." --requirements "Saved articles appear in reverse-chronological order" --state pm_review
```

Success (exit 0):

```text
role project-manager completed.
Report:
<report text>
```

## Coordinator

Runs one production Coordinator ticket: the ticket starts in state
`ready` (fixed — there is no `--state` flag), Implementer staffing
comes from `--specialty`, and the review decision is explicit.
Required flags: the four ticket flags plus `--specialty`, plus
either `--review-decision approved` or `--review-decision
changes_requested --review-feedback "..."`. Without an explicit
decision the Coordinator asks once at a TTY prompt; non-interactive
runs without one fail safely. `--review-feedback` without
`--review-decision` fails.

```bash
ai-team role coordinator --id T-001 --title "Render the list" --description "Server-render saved articles newest first." --requirements "Saved articles appear in reverse-chronological order" --specialty backend --review-decision approved
```

Success (exit 0):

```text
role coordinator completed: ticket T-001 -> <final_state>.
```

## Manual handoff: copy, paste, resume

When an execution carries a canonical handoff, `--show-handoff`
prints exactly that handoff and nothing else (exit 0) for copying.
When the execution produced no handoff, the command says so instead
of inventing one (exit 1):

```text
role error: no handoff available for role "implementer" in this execution.
```

The handoff output starts with the canonical marker:

```text
=== AI TEAM HANDOFF ===

From: implementer
To: senior-reviewer
...
```

Resume it into the destination role by piping or pasting the complete
text on stdin with `--handoff-stdin` (terminate with EOF), **plus**
the destination's own required flags — the handoff authorizes and
travels as provenance, but role inputs still come from explicit
flags; nothing is merged:

```bash
ai-team role senior-reviewer --id T-001 --title "Render the list" --description "Server-render saved articles newest first." --requirements "Saved articles appear in reverse-chronological order" --result "Implemented per description." --handoff-stdin < handoff.txt
```

The text is parsed against the exact canonical grammar and
validated: garbage fails (`handoff parser: missing canonical opening
marker`, exit 1), empty stdin fails (`handoff input is empty; pipe or
paste the canonical handoff text`), and a handoff for another role
fails before any provider work
(`independent role execution: handoff addresses "senior-reviewer"
and cannot authorize independent implementer execution`, exit 1).
Never hand-edit role ids or bypass validation — re-copy the text.

## Responsibilities and allowed directions

Source of truth: `src/roles/operating-model.ts`. In short:

| Role | Does | Consumes | Produces | Next |
| --- | --- | --- | --- | --- |
| coordinator | Routes one ticket, runs implementer + reviewer, applies your explicit review decision | ticket flags, specialty, review decision | final ticket state | planning workflows (`docs/roles.md`) |
| project-manager | User-testing validation of one ticket in a state (role command); business planning (workflow APIs) | ticket flags, state | validation report | TL acceptance / final approval |
| technical-lead | Technical-approval review of one ticket in a state (role command); planning + decomposition (workflow APIs) | ticket flags, state | approval report | implementer rework or acceptance |
| implementer | Implements one ticket, single attempt | ticket flags, specialty | implementation + next state | senior-reviewer |
| senior-reviewer | Advisory review of one implementation result | ticket flags, result text | review report | explicit accept/rework decision |

Approved handoff directions (the only pairs validation accepts):

```text
coordinator -> project-manager
coordinator -> technical-lead
project-manager -> technical-lead
project-manager -> coordinator
technical-lead -> implementer
technical-lead -> project-manager
technical-lead -> coordinator
implementer -> senior-reviewer
implementer -> technical-lead
senior-reviewer -> implementer
senior-reviewer -> technical-lead
```

Correction and rework handoffs (reviewer/lead/manager findings routed
back for another attempt) use the separate T-032–T-036 contracts —
they are re-entry requests with explicit actions, not first-pass
planning handoffs. No role here grants planning approval: PM/TL
planning approvals belong to `decidePlanningApproval` with the
matching authority identity.

## Reading results and failures

- Structured result lines (`role <role> completed...`) are safe to
  script on; `Report:` bodies are opaque provider text — never parse
  them into requirements, tasks, criteria, or approvals.
- `role error: ...` (exit 1) covers missing/invalid flags, bad
  config, unknown states/specialties/roles, handoff problems, and
  provider failures. There is no retry: fix the input and re-run.
- Before chaining a result into the next stage, check the exit code,
  the ticket id, and — for handoffs — the `From`/`To` pair against
  the table above.
- Never put secrets in handoffs or flags; role inputs carry only
  what the selected role is authorized to receive.

## Delegate note (not this guide)

Delegate-skills transport supports the implementer destination only —
it never runs all five roles, role commands never dispatch through
it, and the manual path above works with Delegate down. Setup,
diagnostics, and operating detail belong to the Delegate Mode Guide
(T-048, forthcoming).

## Troubleshooting

- `Configuration file not found` — run from inside the configured
  project, or run project setup first (`docs/configuration.md`).
- `missing required --...` / `unsupported flag` — compare against
  the per-role flag sets above; each role differs.
- `unknown specialty` / `unknown workflow state` — use only the
  listed values.
- `no handoff available` — that execution simply carries none; copy
  nothing.
- Provider errors — check OpenCode installation and
  `providers.opencode.enabled` (`docs/providers-opencode.md`).

Next: the Delegate Mode Guide (T-048, forthcoming). Workflows:
`docs/quick-start-new-project.md`,
`docs/quick-start-existing-project.md`. Configuration:
`docs/configuration.md`. Installation: `docs/installation.md`.
