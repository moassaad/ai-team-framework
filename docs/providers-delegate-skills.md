# delegate-skills Provider Usage (M11)

How the framework treats the optional delegate-skills integration.
Covers D-001 through D-006 as implemented. No other provider,
workflow, or CLI integration is described here.

Two kinds of statements appear below and are labeled where it
matters: **upstream behavior** (documented in the
[`amElnagdy/delegate-skills`](https://github.com/amElnagdy/delegate-skills)
README, checked 2026-09-24) and **framework behavior** (what the
code in `src/providers/delegate*.ts` actually does).

## Optional nature (framework behavior)

delegate-skills is optional and never a core dependency. The
framework is fully usable without it: every ticket can be worked in
the normal single-role flow. Installing it, enabling it, or
confirming a delegation are three separate explicit decisions —
none implies the others.

## What it provides (upstream behavior)

Upstream describes delegate-skills as a Skills package for
delegating coding tasks to a separate coding-agent CLI while the
orchestrator keeps review and commit responsibility:

- `delegate-setup` — discovers already-installed implementer CLIs,
  proposes named fleet lanes (for example `feature`, `tests`, `ui`),
  and writes configuration only after explicit approval. It never
  dispatches coding work.
- `*-delegate` skills (for example `codex-delegate`,
  `opencode-delegate`) — dispatch a self-contained brief to one
  implementer CLI through a bundled relay script and report a
  structured result. The review-first loop is: brief, dispatch,
  wait, review the diff (re-run the project gates), then land the
  commit yourself. Relays never commit.
- Delegation targets a real working tree in a separate CLI session;
  the diff is the deliverable.

Nothing above is framework behavior. The framework does not ship,
select, or run any of these skills; it only defines the generic
seams (D-001 through D-006) through which an optional delegation
capability can be consulted.

## Prerequisites (upstream behavior)

From the upstream README:

- Node 18+ and `git`.
- An orchestrating agent able to run shell commands and read files.
- For a `*-delegate` skill, the relevant implementer CLI installed
  and authenticated as at the terminal (each skill's `SKILL.md`
  carries its own install and login commands).
- `delegate-setup` itself requires no implementer CLI; it discovers
  whichever ones are available.

Shell examples upstream assume bash/zsh (macOS/Linux, or Git
Bash/WSL on Windows).

## Installation (upstream behavior)

Upstream installs through the
[Skills CLI](https://github.com/vercel-labs/skills):

```bash
npx skills add amElnagdy/delegate-skills --list
npx skills add amElnagdy/delegate-skills
npx skills add amElnagdy/delegate-skills --skill delegate-setup
npx skills add amElnagdy/delegate-skills --skill codex-delegate
```

Variants documented upstream: `--agent <name>` for a specific
agent, `--global` for a global install, and `@vMAJOR.MINOR.PATCH`
to pin a release tag (the CLI installs by git ref).

Installation places skills into an agent's skills directory. The
upstream README documents no standalone `delegate-skills`
executable, command protocol, flags, or output format. See the
implementation limitation below before assuming otherwise.

## Availability (framework behavior)

Installation and runtime availability are distinct. The D-002
detector (`src/providers/delegate-availability.ts`) answers one
factual question — is the capability present in this environment —
by looking for a `delegate-skills` command on the executable search
path. It starts no processes, changes no setting, and never throws
for probe failures (an unreadable environment reads as
unavailable). A detected installation never enables anything; an
absent one never blocks normal framework operation.

## Explicit enablement (framework behavior)

Delegation is off unless the user explicitly opts in through the
existing M2 configuration (D-004 added no new mechanism):

```yaml
providers:
  delegate:
    enabled: false
```

Omitted means `false`. Only an explicit `enabled: true` in
`.ai-team/config.yaml` records the intent to allow delegation, and
that intent alone authorizes nothing: it only permits later steps
to ask for confirmation. Configuration loading never probes the
environment and never constructs a provider.

## Safety confirmation (framework behavior)

Enabling the provider is not authorizing a delegation. Every
delegate operation additionally requires an explicit human
decision through the D-005 seam
(`src/providers/delegate-confirmation.ts`): only the exact decision
`"confirmed"` passes `requireDelegationConfirmation`. `"rejected"`,
`"pending"`, and missing input all block delegation; nothing
confirms automatically, and confirmation is never inferred from
configuration, availability, or message text. The human decision
itself travels through the existing `needs_user_input` channel;
D-005 only checks it. Confirmation executes nothing.

## Fallback (framework behavior)

When delegation cannot be used, control returns to the normal
framework path via the D-006 boundary
(`src/providers/delegate-fallback.ts`), which reports one outcome
per attempt:

```text
delegated                            (executed once, result returned)
not_delegated: disabled              (not enabled; nothing runs)
not_delegated: unconfirmed           (no explicit confirmation; nothing runs)
not_delegated: unavailable           (capability absent; nothing runs)
not_delegated: failed: <sanitized error>  (attempt failed once; no retry)
```

A `not_delegated` outcome carries no result: failure is never
reported as success and no result is fabricated. There is no retry,
no alternate provider, no state change, and no workflow edge — the
caller simply continues with the normal single-role flow.

## Security and trust note (upstream behavior)

Upstream states the package is intentionally inspectable (Markdown
skill content plus small Node scripts) and that those scripts use
Node built-ins only, make no network calls of their own, read or
write no credentials, and send no telemetry; relays launch the
implementer CLI and `git`. Two caveats, also upstream: discovery
may invoke installed CLIs for version/model probes, and those CLIs
may contact their own services; and no relay ever commits —
committing stays the reviewer's job after review. Read the skill
scripts before running them.

## Implementation limitation: adapter invocation vs upstream package

The D-003 adapter (`src/providers/delegate-skills.ts`) invokes a
`delegate-skills` process command with the request texts as
arguments. Current upstream evidence describes delegate-skills as a
Skills package installed through the Skills CLI and documents no
standalone `delegate-skills` executable or command protocol, so the
adapter's invocation model is **not verified upstream behavior**.
Where such a command exists the adapter applies unchanged (its
tests inject the launcher and require no installed tool); where it
does not, availability detection reports unavailable and the
framework proceeds normally per the fallback above. Resolving this
mismatch — for example, bridging the Skills-package model to the
process-command seam — is future work and is intentionally not
decided here. No code was changed in this ticket.

## Explicitly out of scope

Not implemented and not described as supported: provider registry,
automatic provider selection or routing, CLI confirmation flags,
installation automation, retries, persistence, telemetry,
webhooks, polling, workflow changes, and GitHub Issue lifecycle
handling.
