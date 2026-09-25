# delegate-skills Integration Guide (M16)

How the framework treats the optional delegate-skills integration.
Covers the modern integration as implemented: D-102 detection, D-103
installation, D-104 relay provider, D-105 result mapping, and D-106
failure/fallback composition. No other provider, workflow, or CLI
integration is described here.

Two kinds of statements appear below and are labeled where it
matters: **upstream behavior** (documented in the
[`amElnagdy/delegate-skills`](https://github.com/amElnagdy/delegate-skills)
README, checked 2026-09-25) and **framework behavior** (what the
code in `src/providers/delegate*.ts` actually does).

## Optional nature (framework behavior)

delegate-skills is optional and never a core dependency. The
framework is fully usable without it: work can proceed through the
normal non-delegate path. Enabling it, installing a skill, and
requiring a delegation are three separate explicit decisions —
none implies the others.

## What it provides (upstream behavior)

Upstream describes delegate-skills as a Skills package for
delegating coding tasks to a separate coding-agent CLI while the
orchestrator keeps review and commit responsibility:

- `delegate-setup` — discovers already-installed implementer CLIs,
  proposes named fleet lanes (for example `feature`, `tests`, `ui`),
  and writes configuration only after explicit approval. It never
  dispatches coding work, and the framework never invokes it as a
  per-ticket dispatch mechanism.
- `*-delegate` skills (for example `opencode-delegate`,
  `codex-delegate`; 17 exist) — dispatch a self-contained brief to
  one implementer CLI through a bundled relay script and report a
  structured result. The review-first loop is: brief, dispatch,
  wait, review the diff (re-run the project gates), then land the
  commit yourself. Relays never commit.
- Delegation targets a real working tree in a separate CLI session;
  the diff is the deliverable.

The framework does not ship, select, or run any of these skills
itself; it only defines the seams (D-001, D-102 through D-106)
through which one explicitly chosen installed skill can be used.

## How AI Team uses delegate-skills (framework behavior)

Everything goes through the framework's delegate provider boundary
(`src/providers/delegate*.ts`):

```text
detect      fresh check of skill + implementer reality (D-102)
install     install one explicitly requested skill, only when
            explicitly requested and confirmed (D-103)
verify      re-check reality after any change; this decides success
delegate    one relay call through the installed skill (D-104)
map         interpret the relay result (D-105)
fallback    bounded fallback when delegation is optional (D-106)
```

Installation and runtime delegation are different concerns:
detection never installs anything, and delegation never repairs
the environment — a missing skill or implementer is reported, not
fixed, on the delegation path.

## Explicit enablement (framework behavior)

Delegation is off unless explicitly opted in through the existing
configuration (D-004 added no new mechanism):

```yaml
providers:
  delegate:
    enabled: false
```

`enabled` means **you want delegation allowed**. It never means a
skill is installed, ready, or available — those are established by
fresh detection every time:

```text
Configuration  = user intent
Detection      = current reality
```

Omitted means `false`. Configuration loading never probes the
environment and never constructs a provider.

## Detection (framework behavior)

The D-102 detector (`src/providers/delegate-detection.ts`)
establishes, read-only, whether one requested skill can currently
be used. For one explicitly named `<name>-delegate` skill it
checks, in order, short-circuiting on the first reliable absence:

```text
1. <root>/<skill>/SKILL.md readable in a bounded caller-supplied
   root list (never walked, never globbed)
2. <root>/<skill>/scripts/relay.mjs readable beside it
3. <implementer> --version exits 0 (fixed argv, no shell)
4. git --version exits 0 (relay prerequisite)
```

Detection guarantees:

- Fresh every call: no cache, no persistence, no stored status.
- Bounded to the configured skill roots: it does not search the
  filesystem and never walks a home tree.
- No writes anywhere, no installs, no relay runs.
- Authentication is not probed (no safe read-only signal exists),
  so availability always carries that limitation instead of
  guessing.
- No fleet, lane, model, or session state exists here.

Fresh detection distinguishes conditions that are easy to confuse:

| Condition | Meaning |
|---|---|
| Available | Skill material, relay, implementer, and git all present. Usable, but still not selected until enabled. |
| Enabled but unavailable | You opted in, but reality disagrees (skill not installed, relay missing, implementer or git absent). Falls back or fails clearly — never pretends readiness. |
| Detection failure | Reality itself could not be established (e.g. no skill roots configured, unreadable state, broken probe). Reported as failure, never converted into "absent" or "present". |

## Installation (framework behavior)

The D-103 capability (`src/providers/delegate-install.ts`)
installs **one explicitly requested skill** through the
[Skills CLI](https://github.com/vercel-labs/skills), in the
verified upstream form:

```text
npx skills add amElnagdy/delegate-skills --skill <skill>
  [--agent <agent>] [--global] -y
```

Behavior, enforced:

- Installation happens **only after explicit confirmation**.
  Nothing installs merely because delegation was attempted —
  fallback never installs, and detection never installs.
- Scope default is `project` (the upstream default: the skill
  lands inside the project). `global` must be chosen explicitly
  because it reaches beyond the target project.
- `--agent` is passed only when explicitly known; otherwise it is
  omitted and the Skills CLI auto-detects. Multi-agent installs
  are never performed; `--all` is never used.
- The framework never installs `delegate-setup`, never runs it,
  never provisions implementer CLIs or credentials, and never
  uses `sudo`.
- Every install starts with fresh detection and ends with fresh
  verification: a successful command exit without a confirming
  detection is reported as failure.

### Node / Skills CLI compatibility

The Skills CLI requires Node.js `>= 22.20.0` (per its package
metadata). The framework checks the runtime before anything runs:

- On incompatibility, installation fails safely with a message
  naming the requirement and the current runtime. Upgrade Node
  yourself, outside the framework — the framework never upgrades
  Node, installs system packages, or bootstraps environments.
- A missing `npx` likewise fails closed with its prerequisite
  named.

Note for this project's environment: the framework itself runs on
Node 18+, but skill installation needs the newer runtime above.
Until the environment provides it, installation reports the
incompatibility instead of modifying anything.

## The relay provider (framework behavior)

The framework does **not** execute a `delegate-skills`
executable — none exists upstream. Instead, the D-104 provider
(`src/providers/delegate-relay.ts`) invokes the selected
installed skill's relay script through Node:

```text
node <skill-root>/scripts/relay.mjs --brief <brief>
  [--model <model>] --cd <projectRoot> --out-dir <tempDir>
```

The relay receives a generated brief (bounded task context) and
the project directory. The brief explicitly forbids destructive
Git behavior — no commit, no push, no merge, no branch
manipulation — so the reviewer-owned commit boundary holds.

Per delegation request, the provider:

- performs exactly one relay call, with the project root pinned
  as the working directory;
- uses fixed argument arrays and no shell execution;
- writes the brief into an isolated temp dir outside the target
  repository (target files are written only by the delegated
  implementer — that is the purpose of delegation);
- reads the structured `result.json` the relay leaves behind;
- cleans its temp dir afterwards on every path;
- never retries, never commits, never pushes, never merges,
  never authenticates, never reconfigures, never touches
  workflow state.

`--model` is passed only when supplied (some skills, e.g.
opencode-delegate, require it on fresh runs and then fail before
launch when it is missing). The framework never invents a model.

## Result mapping (framework behavior)

The relay writes a structured document
(`delegate-relay.result.v1`) carrying upstream fields such as
`status`, `exitCode`, `signal`, the final report
(`finalMessage`), `touchedFiles`, `sessionId`, and skill/tool
metadata. The D-105 mapper (`src/providers/delegate-result.ts`)
interprets exactly one such document as the framework's minimal
result — the generic contract is unchanged:

```ts
DelegationResult {
  outcome: string;
}
```

Mapping rules (status is primary; the process exit code is only
supporting diagnostic context):

```text
completed + usable non-empty finalMessage → outcome is the report
completed + missing/empty report          → success with a bounded
                                            generic outcome
failed / timeout / aborted /
  <cli>_unavailable / unknown / missing    → bounded failure naming
                                            the status (plus signal
                                            when present) and exit
different schema                          → failure (contract drift)
malformed (unparseable / non-object)      → failure
```

Consequences to rely on:

- Failures remain failures; unknown statuses never become
  success.
- `touchedFiles` are tolerated but never exposed — no result
  field exists and none was added. The reviewer reads the diff.
- `sessionId` is tolerated but never persisted: there is no
  session, resume, or cross-ticket state of any kind.
- Exit code and signal are diagnostic detail inside failure
  messages, not independent success criteria: an exit 0 paired
  with `failed` stays a failure.

## Failure and fallback (framework behavior)

The D-106 seam (`src/providers/delegate-generation.ts`) routes
one delegation request through the delegate or the fallback:

```text
delegate disabled
    → fallback path (never even probed)

delegate enabled + unavailable
    → fallback when delegation is optional

delegate enabled + detection failure
    → fallback when delegation is optional

delegate attempted + failed
    → fallback when delegation is optional

delegate explicitly required
    → bounded failure, never a silent fallback
```

Rules that protect you:

- The fallback is caller-supplied: there is no invented default
  `DelegateProvider`. (M17 wires the real non-delegate path.)
- Detection runs once per operation; delegation runs at most
  once; fallback runs at most once. A failed delegate never
  triggers another delegate call; a failed fallback never
  triggers another fallback.
- There are no retries, no backoff, no polling, no automatic
  installation, and no automatic repair.
- Failure messages name the integration and the cause
  (`explicitly required but unavailable (<detail>)`,
  `... detection failed (<cause>)`, or the original
  relay/result message unchanged) without stack traces.
- Required-delegation failures preserve the distinction between
  "unavailable" and "detection failed" instead of collapsing
  them.

## OpenCode provider ≠ opencode-delegate

Two independent capabilities sharing only a binary name:

- **AI Team's OpenCode provider** executes framework prompts
  directly. It is the required execution boundary.
- **opencode-delegate** is a separate background OpenCode
  session driven through `relay.mjs` (brief file, session
  lifecycle, `result.json`; the orchestrator reviews and lands).

Do not merge, do not wrap one in the other. The relay adapter
never routes through the OpenCode provider, and the OpenCode
provider never gains delegation concerns.

## Current scope vs deferred work

### Implemented in M16

- Integration contract and desired-state configuration.
- Delegate detection (D-102) over bounded skill roots.
- Exact-skill installation via the Skills CLI (D-103).
- Relay execution through the installed skill (D-104).
- Pure relay-result mapping (D-105).
- Failure/fallback composition with optional vs required
  delegation (D-106).
- This documentation (D-107).

### Deferred to M17 / M18

- Real Coordinator wiring of the D-106 seam (callers,
  `requireDelegate` decisions, the real fallback instance).
- Role-to-delegate and specialty-to-skill selection.
- `ai-team setup` / `ai-team status` UX.
- Runtime integration lifecycle and end-to-end ticket
  orchestration.
- Fleet, model, lane, and session management.

Nothing in the deferred list is described anywhere as already
implemented.

## Security and trust note (upstream behavior)

Upstream states the package is intentionally inspectable
(Markdown skill content plus small Node scripts) and that those
scripts use Node built-ins only, make no network calls of their
own, read or write no credentials, and send no telemetry; relays
launch the implementer CLI and `git`. Two caveats, also
upstream: discovery may invoke installed CLIs for version
probes, and those CLIs may contact their own services; and no
relay ever commits — committing stays the reviewer's job after
review. Read the skill scripts before running them.

## Historical note (framework behavior)

The M11 executable-model modules — PATH probing
(`src/providers/delegate-availability.ts`), direct
`delegate-skills` process spawning
(`src/providers/delegate-skills.ts`), and the `not_delegated`
outcome boundary (`src/providers/delegate-fallback.ts`) — are
**superseded** by the Skills/relay integration above. They
remain in the tree but are not the active delegation path. The
D-101 audit (`docs/delegate-skills-integration-audit.md`)
records the original classifications; §M16 resolution there
confirms what replaced them. Stable and unchanged: the generic
`DelegateProvider` contract (D-001), the `providers.delegate`
desired-state flag (D-004), and the explicit human-confirmation
seam (D-005, consulted by the future runtime before delegation
is ever required).

## Explicitly out of scope

Not implemented and not described as supported: provider
registry, automatic provider selection or routing, fleet/lane
resolution, model routing, session persistence or resume,
retries, persistence, telemetry, webhooks, polling, workflow
changes, Git automation, and GitHub Issue lifecycle handling.

## Troubleshooting pointers

Symptom table with safe next actions:
`docs/troubleshooting.md` (§delegate-skills integration
symptoms). Upstream reference for skill behavior:
<https://github.com/amElnagdy/delegate-skills>.
