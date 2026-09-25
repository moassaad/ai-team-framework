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

The Spec Kit adapter builds an operation prompt from PM-owned
requirements and executes it through an injected agent provider,
then maps the result back to the shared artifact shape; agent
failures propagate unchanged. When Spec Kit is unavailable or
disabled, the local fallback provider (`"fallback"`) produces a
minimal deterministic artifact from the same requirements, and
planning proceeds with plain framework artifacts. End-user Spec
Kit installation/setup instructions are **unresolved** (M8 P-006,
still open) — this guide does not claim they exist.

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

## Local IssueProvider fallback

The local provider (`"local"`) keeps issue entries in memory inside
its instance (`local-1`, `local-2`, …): useful when GitHub is
unconfigured or unreachable. Entries start open; `complete` is
idempotent. It offers no persistence (nothing survives a restart),
no synchronization, and no selection or routing — it is a local
stand-in, not a persistent tracker.

## delegate-skills (optional delegation)

`delegate-skills` (`"delegate"`) is an optional delegation
provider, **not a role**. Delegation passes four gates in order,
each owned by a separate boundary:

```text
enabled (explicit providers.delegate.enabled: true, default false)
→ explicit human confirmation (only "confirmed" passes)
→ availability (capability detected in the environment)
→ delegation attempt (exactly once)
```

Failure or absence at any gate returns control to the normal
single-role flow (`not_delegated` with a reason); a failed attempt
is reported, never converted into a fabricated result. No retry,
no alternate provider, no workflow changes. Full behavior and
setup: `docs/providers-delegate-skills.md`.

**Unresolved limitation (preserved):** upstream documentation
describes delegate-skills as a Skills package installed via the
Skills CLI and does not establish the standalone executable
protocol the adapter boundary assumes. This is documented, not
solved, in `docs/providers-delegate-skills.md` and unchanged here.

## Provider selection

There is no provider registry, priority system, or switching UI.
"Selection" in this framework means exactly two things: explicit
`providers.*.enabled` settings in configuration, and injected
provider instances passed to the execution functions by the caller.
Adapters never discover, choose, or replace each other.

## Exists, enabled, available, successful

Four different facts, easily confused:

- **Exists** — the external tool is installed (the framework never
  installs anything).
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
non-delegated outcome (Spec Kit → local artifact, delegation →
`not_delegated`), which is a reported outcome, not a fabricated
result. There are no hidden retries anywhere in the provider layer.

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
- `docs/providers-delegate-skills.md` — delegation setup and limitations.
- `docs/configuration.md` — all provider settings.
- `docs/workflow.md` — what providers never own.
