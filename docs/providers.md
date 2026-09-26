# Providers Guide

How the AI Team Framework talks to external tools without depending
on them. Beginner-friendly; the binding contract is
`docs/specification/providers.md` and the code under
`src/providers/` (all claims below verified against both).

## What is a provider?

A provider is an isolated integration boundary: a small contract
plus an adapter that speaks to one external tool, so the core
framework (roles, workflow, configuration) never imports tool-
specific behavior. Four categories exist — no others:

- **Execution** (`AgentProvider`) — runs a prepared request, returns
  a result. Implemented by OpenCode.
- **Specification/planning** (`SpecificationProvider`) — produces
  plan/specification artifacts. Implemented by the Spec Kit adapter,
  with a local fallback provider.
- **Issue tracking** (`IssueProvider`) — creates, updates, and
  completes external issue records. Implemented by the GitHub
  adapter, with a local fallback provider.
- **Delegation** (`DelegateProvider`) — hands work to a separate
  agent system. Implemented by the delegate-skills adapter, with a
  safe non-delegated fallback path.

## Philosophy (enforced, not aspirational)

- Provider logic lives in its adapter module; core code sees only
  the generic contract.
- Optional providers stay optional: the framework works with all of
  them disabled, and none may silently become required.
- Failures are explicit rejections with sanitized messages — never
  fabricated success, never silent retries.
- No provider owns workflow states, approvals, or transitions.

## OpenCode (required execution boundary)

OpenCode (`"opencode"`) is the initial execution provider. It
receives a finished prompt plus a project root through
`AgentProvider.execute`, runs the `opencode` command once per call
(`shell: false`, no retry), and its output is normalized into the
shared `ExecutionResult` shape (`{status: "succeeded", text}`).
Executions run under `executeWithTimeout`: the caller supplies
`timeout_ms` (positive finite, no default), expiry rejects with a
`timeout` error, provider failure rejects as `provider_error` —
both fixed messages carrying no prompt content. Details:
`docs/providers-opencode.md`. External OpenCode installation and
authentication are outside this guide.

## Spec Kit (optional planning)

Spec Kit (`"spec-kit"`) is an optional specification/planning
capability — a tool, not a role and not the workflow engine. The
division of labor is fixed:

```text
Project Manager → requirements/scope
Technical Lead  → technical planning/tickets
Spec Kit        → optional specification/plan artifacts
```

The modern integration (M15) manages Spec Kit through its own
provider boundary: fresh detection of the `specify` CLI and project
state (configuration is intent, never proof), confirmed CLI
installation (`uv`/`pipx`/`pip`, nothing bootstrapped), confirmed
existing-project initialization (`specify init --here --force
--non-interactive --integration <key>`, managed files only),
integration installation without `--force`, read-only mapping of
`spec.md`/`plan.md`/`tasks.md` into framework tickets through the
unchanged generic planner, and bounded failure/fallback selection
that never installs, retries, or reconfigures automatically. Full
user guide: `docs/providers-speckit.md` (P-006 resolved there).
When Spec Kit is unavailable or disabled, the local fallback
provider (`"fallback"`) produces a minimal deterministic artifact
from the same requirements, and planning proceeds with plain
framework artifacts.

## GitHub Issues (optional tracking)

GitHub Issues (`"github"`) is an optional external tracker behind
the generic `IssueProvider` contract (`create`/`update`/`complete`).
The framework works without it; internal workflow state stays
conceptually separate from external issue records.

- Configuration: `providers.github.enabled` plus `owner`/`repo`
  (both required when enabled). The API token is injected by the
  caller and never stored under `.ai-team/`.
- State mapping is one-way and coarse: every actionable workflow
  state maps to issue `open`; only `closed` and `cancelled` map to
  `closed`. There is no two-way sync, no labels, no sub-issues, no
  webhooks.
- Failures (transport errors, non-2xx status, malformed responses)
  reject with sanitized fixed messages that carry neither the token
  nor the tracker's response body. Exactly one tracker operation
  per call; no retry, no automatic local fallback.
- Read path: GitHub Issues can also act as a read-only
  `TicketSource` (`createGitHubIssuesTicketSource`) with explicit
  managed-label selection and caller-supplied state decoding.
  Details: `docs/providers-github-issues.md`. Writes stay on the
  `IssueProvider` contract; synchronization is deferred.

## Local IssueProvider fallback

The local provider (`"local"`) keeps issue entries in memory inside
its instance (`local-1`, `local-2`, …): useful when GitHub is
unconfigured or unreachable. Entries start open; `complete` is
idempotent. It offers no persistence (nothing survives a restart),
no synchronization, and no selection or routing — it is a local
stand-in, not a persistent tracker.

## delegate-skills (optional delegation)

`delegate-skills` (`"delegate"`) is an optional delegation
provider, **not a role**. The modern integration (M16) delegates
through an explicitly chosen installed `*-delegate` skill's
bundled relay script — there is no `delegate-skills` executable,
and the historical executable assumption is obsolete (see the
historical note in `docs/providers-delegate-skills.md`):

```text
detect      fresh skill + implementer reality over bounded roots
install     one explicitly requested skill via the Skills CLI,
            only when explicitly requested and confirmed
verify      re-check reality after any change; this decides success
delegate    one relay call (node <skill>/scripts/relay.mjs),
            brief forbids commit/push/merge/branching
map         result.json → DelegationResult{outcome}; failures stay
            failures; sessions/touched-files never exposed
fallback    caller-supplied non-delegate path when optional;
            bounded failure when explicitly required
```

Enabling it, installing a skill, and requiring a delegation are
separate explicit decisions. Detection never installs; delegation
never repairs — absence is reported, then fallback or bounded
failure. No retry, no alternate provider, no workflow changes,
no commits. The Skills CLI requires Node `>= 22.20.0`; the
framework checks and fails safely instead of upgrading anything.
Full behavior: `docs/providers-delegate-skills.md`.

## Provider selection

There is no provider registry, priority system, or switching UI.
"Selection" in this framework means exactly two things: explicit
`providers.*.enabled` settings in configuration, and injected
provider instances passed to the execution functions by the caller.
Adapters never discover, choose, or replace each other.

## Exists, enabled, available, successful

Four different facts, easily confused:

- **Exists** — the external tool/skill is installed
  (installation is always explicit and confirmed, never
  automatic).
- **Enabled** — the user explicitly opted in via configuration
  (opt-in, default off for every optional provider).
- **Available** — the capability is detected in the current
  environment (only the delegation boundary currently probes this).
- **Successful** — an actual call returned a valid result.

Enabled never implies available; available never implies enabled;
neither implies confirmation or success.

## Failures

Provider errors reject explicitly per adapter contract
(`provider_error`/`timeout` at the execution boundary, sanitized
per-adapter messages elsewhere). Failure never becomes success —
except where a fallback contract explicitly defines a
non-delegated outcome (Spec Kit → local artifact; delegation →
caller-supplied fallback result, or the historical D-006
`not_delegated` report), which is a reported outcome, not a
fabricated result. There are no hidden retries anywhere in the
provider layer.

## Configuration summary

```yaml
providers:
  opencode:  { enabled: true }   # required boundary
  speckit:   { enabled: false }  # optional
  github:    { enabled: false, owner: "", repo: "" }  # owner/repo required when true
  delegate:  { enabled: false }  # optional, never auto-enabled
```

Full reference: `docs/configuration.md`.

## Security notes

- Tokens and credentials are injected at runtime, never stored
  under `.ai-team/`, never logged, and never embedded in error
  messages (verified by per-adapter sanitization tests).
- No allowlists, sandboxing, credential stores, or permission
  systems exist in the provider layer; do not assume them.

## Comparison

| Provider | Purpose | Required/Optional | Fallback |
|---|---|---|---|
| OpenCode | Execution | Required provider boundary | Explicit `timeout`/`provider_error` failure behavior |
| Spec Kit | Specification/planning | Optional | Local fallback provider |
| GitHub Issues | Tracking | Optional | Local IssueProvider |
| delegate-skills | Delegation | Optional | Safe non-delegated path |

No ranking is implied. Every cell verified against
`src/providers/*` and the M7/M8/M10/M11 tests.

## Where to go next

- `docs/providers-opencode.md` — execution path details.
- `docs/providers-speckit.md` — Spec Kit setup, mapping, fallback (P-006 resolved).
- `docs/providers-delegate-skills.md` — delegation setup and limitations.
- `docs/configuration.md` — all provider settings.
- `docs/workflow.md` — what providers never own.
