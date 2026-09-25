# Troubleshooting

Diagnose common problems by symptom. Every message below was copied
from real runs of the current implementation — match yours against
them before changing anything. Philosophy: observe the exact error,
identify its layer, check the documented requirement, verify, then
read the linked guide. Never delete files or reinstall at random.

## Installation and build

**`node: command not found`** — install Node.js 18+ first; nothing
else here works without it (`docs/installation.md`).

**`npm ERR!` during `npm install`** — network or registry problem.
Dependencies (`yaml` plus dev tools) cannot be installed offline.

**`Error: Cannot find module '.../dist/index.js'`** — you skipped
the build. Run `npm run build` (`tsc` compiles `src/` into `dist/`;
TypeScript is local, so use the npm script, never a global `tsc`).

**`ai-team` command not found in your shell** — global installation
is not part of the verified path. Run the built entry directly:

```bash
node dist/index.js --help
```

## CLI: unknown commands and roles

Anything the CLI does not recognize fails the same way — exit 1,
empty stdout, usage hint on stderr:

```text
error: unknown command "run --role bogus".
Run "ai-team --help" for usage.
```

Common triggers, all verified: unknown role (`--role bogus`),
unknown specialty (`--specialty wizard`), undocumented slash form
(`/pm`), prompt text matching no keyword. There is no fallback role
and no near-match correction — check spelling against the five
roles (`coordinator`, `project-manager`, `technical-lead`,
`implementer`, `senior-reviewer`), four aliases (`pm`, `tl`,
`reviewer`, `sr`), and six specialties (`backend`, `frontend`,
`integration`, `database`, `testing`, `documentation`).
Specialties work only with `--role implementer`. Details:
`docs/roles.md`.

## Configuration errors

Configuration fails before any workflow step, naming the exact
field as `config.<path>: <rule>`. Real examples:

```text
config.typo: unknown top-level key; expected one of "version", "approval", "workflow", "providers"
config.approval.mode: expected one of "manual", "automatic", got "sometimes"
config.providers.delegate.enabled: expected a boolean, got "yes"
config.providers.github.owner: required non-empty string, got undefined
config.version: required field is missing
Configuration file not found: <project>/.ai-team/config.yaml
```

What to check: `version: 1` present; enums lowercase and exact;
booleans are real booleans (`"yes"`/`1` fail); `github.enabled:
true` requires non-empty `owner` and `repo`; unknown top-level or
provider keys mean a typo. Omitted optional values are fine — they
receive defaults. Full reference: `docs/configuration.md`.

## Provider problems

Distinguish four different facts: **disabled** (not opted in),
**unavailable** (not present), **failed execution**, **timeout**.
They surface differently per provider, always explicitly:

- Execution timeout: `provider execution timed out after <N> ms`.
  The late result, if any arrives, never overrides it. One attempt
  only — never a silent retry.
- Provider failure: `provider execution failed` (request content
  sanitized out).
- GitHub: `github provider: request failed`, `... with status
  <N>`, or `unexpected response`. No token or response body is
  included. Exactly one tracker operation per call.
- Delegation gates in order: not enabled → not confirmed →
  unavailable → attempt failed once. Any outcome returns control
  to the normal flow (`not_delegated` with a reason), never a
  fabricated delegated result. The upstream executable-protocol
  limitation is documented, not solved
  (`docs/providers-delegate-skills.md`).
- Spec Kit unavailable/disabled → local fallback artifact; this is
  the designed path, not an error (end-user Spec Kit setup docs
  remain open as P-006).

## Execution problems

- **Timed out** does not become success later. The outcome stays a
  timeout failure with no transition recommended.
- **Provider failure** surfaces as a failed outcome with
  `next_state: null` — never as success, never as approval.
- **Synchronous programmer errors** (a provider throwing instead of
  rejecting) propagate raw rather than converting into failed
  outcomes. That is intentional: bugs must not masquerade as
  execution failures.
- Remember the separations: failure ≠ success, execution ≠
  approval, review ≠ closure.

## Workflow confusion

- *"Success didn't close the ticket."* Correct behavior: closure
  needs review findings accepted, approval granted where
  configured, and the valid `→ closed` transition. Check the
  current state and the missing evidence, not the execution log.
- *"Waiting for review / user input."* `implementation_review`
  waits for the Senior Reviewer; `needs_user_input` waits for a
  human (an answer, a sensitive decision, or manual approval).
  Generic input is not PM approval.
- *"Changes went back to implementation."* Valid findings route
  through `changes_requested → in_progress` explicitly — rework is
  assigned, never automatic.
- *"No automatic retry."* Only `failed → in_progress`, ordered by
  the TL with explicit conditions. Anything else is not a retry.
- *"Cancelled ticket can't continue."* `closed` and `cancelled`
  are terminal with no outgoing transitions, by design.
- `after: sprint` is accepted by validation but unsupported by the
  approval flows — it stays deferred (OQ-3). Full state machine:
  `docs/workflow.md`.

## Debugging checklist

```text
1. Copy the exact error/output.
2. Check Node 18+, npm, and that npm run build ran (dist/ exists).
3. Validate configuration (field path in the message → docs/configuration.md).
4. Check role/command syntax (--help; docs/roles.md).
5. Check provider state: disabled vs unavailable vs failed vs timeout.
6. Check the current workflow state and what it actually permits.
7. Read the relevant detailed guide.
```

Do not delete project data, reset state, or bypass approvals to
"fix" a failure — the failure is information.

## Reporting a problem

Include: the exact command, the full error message, the current
workflow state if relevant, the configuration area involved, and
whether it reproduces. Never paste API tokens, passwords, or
secrets — redact values before sharing, and use placeholders like
`owner: "acme"` in examples. There is no secret-management system
to configure; secrets stay out of `.ai-team/` entirely.
