# Delegate Mode Guide

How to configure, check, and use the optional delegate-skills
integration: carrying one canonical handoff to the supported
destination, reading capability and result contracts, and continuing
manually when Delegate is unavailable or fails. Delegate never runs
the five-role team — it transports implementation work to the
Implementer destination, and the manual path works with Delegate
down. For per-role CLI usage, see
`docs/individual-role-usage.md`; for planning workflows,
`docs/roles.md`.

## Prerequisites and eligibility

- The framework checkout, built (`npm install`, `npm run build`;
  see `docs/installation.md`). The published npm package covers
  supported CLI usage; all paths below are checkout paths because
  this guide's walkthrough uses internal implementation APIs.
  Deep `dist/` imports are the working developer path, not a
  versioned public API (`package.json` declares no `exports` map).
- A configured project (`docs/configuration.md`). Delegate is off
  by default and never auto-enabled — not by setup, not by
  detection, not by dispatch.
- For real delegation (not the stubbed walkthrough below): an
  installed `<name>-delegate` skill, a working implementer command,
  and git — the three things detection probes. Skill installation
  needs Node.js `>= 22.20.0` for the Skills CLI, while the
  framework itself runs on Node 18+.

## Enablement and installation

Opt in through configuration (intent only — this installs nothing
and proves nothing):

```yaml
providers:
  delegate:
    enabled: true
```

Install one explicitly requested skill through the Skills CLI, only
after explicit confirmation:

```text
npx skills add amElnagdy/delegate-skills --skill <skill>
  [--agent <agent>] [--global] -y
```

Project scope is the default (the skill lands inside the project);
`global` must be chosen explicitly. The framework never installs
`delegate-setup`, never provisions implementer CLIs or credentials,
never uses `sudo`, and never upgrades Node. Every install ends with
fresh verification: a successful command exit without a confirming
detection is reported as failure. The confirm-then-act CLI route is
`ai-team setup delegate [--yes]` (explain, ask, install/configure
once, verify); `ai-team status` reports fresh desired-vs-detected
state per integration and changes nothing. Full rules:
`docs/providers-delegate-skills.md`.

## Capability: enabled, detected, ready

`checkDelegateCapability({ integration, isEnabled })`
(`src/providers/delegate-capability.ts`) is strictly read-only —
no install, no config write, no dispatch, no relay run. It returns
one frozen state:

```text
name:                   "delegate"
enabled:                your isEnabled("delegate") — intent from configuration
detected:               fresh probe (SKILL.md + relay.mjs present,
                        implementer --version exits 0, git present)
ready:                  enabled AND detected — the exact formula
detail:                 detector note when present (auth is never
                        probed; availability carries that limit)
supportedDestinations:  ["implementer"] — the only destination,
                        always
```

Read them separately: enabled-but-undetected means you opted in but
reality disagrees (skill missing, relay missing, implementer or git
absent) — never readiness. Detection failure (no roots, unreadable
state) is reported as failure, never converted into absent or
present. Capability never installs, never dispatches, and never
proves a workflow is ready.

## The supported destination boundary

Three different things, often confused:

- **Independent execution** runs any single role locally
  (`ai-team role <role>`).
- **Approved handoff directions** (11 pairs in
  `src/roles/operating-model.ts`) say which role-to-role transfers
  validation accepts for manual copy/paste.
- **Delegate transport** supports exactly one destination:
  `implementer` (`DELEGATE_SUPPORTED_DESTINATIONS`). An allowed
  manual direction does not imply Delegate support — Coordinator,
  Project Manager, Technical Lead, and Senior Reviewer destinations
  are rejected with `kind: "unsupported"`, with no retargeting and
  no wrong-role execution.

## The transport flow

Seven explicit steps, each owned by a real contract — never one
automatic workflow:

1. **Construct** a canonical handoff (a role command's
   `--show-handoff`, or a T-033/T-034/T-035 constructor).
2. **Validate** it (`validateAgentHandoff` — malformed or
   misdirected handoffs fail here, before anything moves).
3. **Check capability** (above) — proceed only when `ready`.
4. **Create the transport** around an already-configured provider:
   `createDelegateSkillsHandoffTransport({ provider })`
   (`src/providers/delegate-handoff-transport.ts`, name:
   `"delegate-skills"`). Construction validates the provider
   shape only; the provider itself (e.g. `createDelegateRelayProvider({
   skillName, skillRoot, projectRoot, model? })`) owns the relay
   invocation, `--cd` root selection, and cleanup.
5. **Dispatch exactly once**:
   `dispatchHandoff({ handoff, transport })`
   (`src/runtime/handoff-dispatcher.ts`). The adapter renders
   the handoff as brief task text (objective first, then labeled
   Requirements / Acceptance criteria / Constraints / Artifacts /
   Notes / Next action sections; empty sections omitted),
   delegates once, and returns the relay outcome as an opaque
   receipt: `{ outcome: "dispatched", transport, destination,
   handoff, receipt }`. No retry, no fallback, no local execution.
6. **Interpret the receipt as opaque text** — never parse it into
   requirements, tasks, criteria, or approvals. A `dispatched`
   outcome proves transport, not completion of the work.
7. **On failure**, the dispatcher returns `{ outcome: "failed",
   transport, destination, handoff, error: { kind, message } }`
   (e.g. `unsupported` for a wrong destination,
   `transport-error` for a relay failure) — one attempt, reported,
   never retried.

Walkthrough with a controlled stub provider standing in for the
relay (same shapes the real relay path produces; a stub proves the
flow, not a real installation):

```js
const { validateAgentHandoff } = require("<framework>/dist/roles/handoff-validation.js");
const { createDelegateSkillsHandoffTransport } = require("<framework>/dist/providers/delegate-handoff-transport.js");
const { dispatchHandoff } = require("<framework>/dist/runtime/handoff-dispatcher.js");

const handoff = validateAgentHandoff({
  from: "technical-lead", to: "implementer",
  objective: "Implement T-501.",
  requirements: ["Render saved articles newest first."],
  acceptance_criteria: ["Saved articles render newest first."],
  artifacts: ["T-501"],
});
const transport = createDelegateSkillsHandoffTransport({
  provider: { name: "stub-relay", delegate: async (request) => ({ outcome: "stubbed implementation of T-501" }) },
});
const result = await dispatchHandoff({ handoff, transport });
// { outcome: "dispatched", transport: "delegate-skills",
//   destination: "implementer",
//   receipt: { outcome: "stubbed implementation of T-501" } }
```

A valid handoff to any other role fails instead:

```text
outcome: "failed", error.kind: "unsupported"
"delegate-skills dispatches implementation work only; ..."
```

## Failure and manual fallback

`createManualFallback({ failure })`
(`src/runtime/delegate-fallback.ts`) takes one **failed** dispatch
(successful results are rejected) and returns the frozen explicit
continuation: `transport: "manual"`, the unchanged destination, the
original validated handoff untouched, `renderedHandoff` byte-equal
to the canonical rendering for copy/paste, the failed transport
name, and the preserved `{ kind, message }` error. Constructing it
executes nothing — no role run, no transport retry, no dispatch
elsewhere, no config change. The caller copies `renderedHandoff`
into the destination via `--handoff-stdin` plus that role's required
flags (`docs/individual-role-usage.md`), which still must all be
supplied: a valid handoff never exempts the destination's other
inputs. Transport failure (the handoff never moved) stays distinct
from a destination role's structured execution failure (the role ran
and reported): never convert one into the other, and never present a
`failed` dispatch as a successful workflow result.

## Corrections and re-entry

Correction information travels through Delegate like any other
handoff content, provided the destination is the Implementer: build
the rework handoff with the matching constructor
(`tl-implementer-rework-handoff` for reviewer/TL findings;
`pm-tl-reentry-handoff` and `final-approval-reentry-handoff` for
their stages; `CorrectionReference` + `ReentryRequest` for the
traceable request), validate it, and dispatch. The transport
preserves the feedback verbatim; it does not approve the correction,
resume any workflow, execute the other roles in the chain, or close
the re-entry — completion is established only by the roles'
explicit decisions afterwards.

## Parity: what is proven

Authoritative evidence: the T-042 tests (`docs/roles.md`,
"Manual/Delegate End-to-End Parity"). Proven, under controlled
conditions: **handoff-level parity** (the identical validated
handoff survives manual render → parse → validate and delegate
`dispatchHandoff` with every semantic field intact) and
**destination-level parity** (the Implementer receives equivalent
inputs and produces equivalent structured outcomes both paths,
including matching failure reports). Formatting differs by design
and is never byte-compared. NOT proven: whole-team workflow parity
— lifecycles never route through the dispatcher, and Delegate
cannot run other roles. Do not claim it.

## Security

- Never put secrets, tokens, or credentials in handoffs, brief
  text, logs, or reports; role inputs carry only what the role is
  authorized to receive, and cross-role context travels as the
  canonical handoff, never as copied credentials.
- Detection and capability checks run bounded, shell-free probes
  and never mutate; installation runs the verified Skills CLI form
  only, project scope by default.
- Status/detection output never surfaces credential material.

## Troubleshooting

- `ready: false` with `enabled: true` — the skill, relay,
  implementer, or git is missing: install/verify, then re-check.
- `kind: "unsupported"` — the handoff targets a non-Implementer
  role: continue manually instead.
- `kind: "transport-error"` — the relay failed: read `message`,
  fix the cause, and either re-dispatch explicitly or continue via
  `createManualFallback`.
- `invalid-configuration` / config errors — `docs/configuration.md`;
  never bypass validation.
- Install refuses on Node version — upgrade Node outside the
  framework; the Skills CLI floor is `>= 22.20.0`.

Next: Final Product E2E Verification (T-049, forthcoming) —
validating the assembled product, not extending Delegate. Reference:
`docs/providers-delegate-skills.md` (full integration contract),
`docs/individual-role-usage.md` (manual path),
`docs/configuration.md`, `docs/installation.md`,
`docs/quick-start-new-project.md`,
`docs/quick-start-existing-project.md`, `docs/roles.md`.
