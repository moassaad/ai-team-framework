# delegate-skills Integration Audit (D-101)

Audit of the historical delegate-skills implementation against the
current framework architecture, the project plan (M16), and the
current upstream `amElnagdy/delegate-skills` model (verified 2026-09-25
from upstream `README.md`, the `skills/` listing — 17
`*-delegate` skills plus `delegate-setup` — and
`skills/opencode-delegate/SKILL.md`). No production code was changed;
all findings come from source and doc inspection. No Skills, CLIs,
relays, or implementers were installed or run.

## 1. Current implementation inventory

| File | Ticket | What it does |
|---|---|---|
| `src/providers/delegate.ts` | D-001 | Generic contract: `DelegationRequest{task, context?}`, `DelegationResult{outcome}`, validators, `isDelegateProvider`. No I/O, no tool names. |
| `src/providers/delegate-availability.ts` | D-002 | PATH probe for an executable literally named `delegate-skills` (`accessSync` + `X_OK`); injected probe seam; never throws (reports unavailable). |
| `src/providers/delegate-skills.ts` | D-003 | Adapter over an injected spawn seam: `spawn("delegate-skills", [task] \| [task, context])`, stdout collected as `outcome`; rejects on process failure or empty output. |
| `src/config/schema.ts` (`delegate.enabled`, default false) + `tests/config-delegate-enablement.test.ts` | D-004 | Desired-state flag only, never auto-enabled. |
| `src/providers/delegate-confirmation.ts` | D-005 | Generic `confirmed \| rejected \| pending` human-decision seam; names no tool, runs nothing. |
| `src/providers/delegate-fallback.ts` | D-006 | `not_delegated` outcome with reason `disabled \| unconfirmed \| unavailable \| failed`; gate order setting → decision → presence → one attempt; reports, never executes. |
| `docs/providers-delegate-skills.md` (+ `providers.md` §, `configuration.md`, `troubleshooting.md`, `README.md` notes) | D-007 | Documents the executable assumption plus its known upstream mismatch ("documented, not solved"). |
| Tests `providers-delegate*.test.ts` (availability, skills, confirmation, fallback, contract) | D-001–D-006 | Fake-launcher/PATH-hermetic; pin the executable model. |

## 2. Current upstream model verified

- Skills CLI package, not an executable: installed via `npx skills add
  amElnagdy/delegate-skills [--skill <name>] [--agent ...] [--global]`,
  pinnable with `@vMAJOR.MINOR.PATCH`. **No `delegate-skills`
  executable exists.**
- 17 implementer skills (`opencode-delegate`, `codex-delegate`,
  `claude-delegate`, `cline-delegate`, `aider-delegate`,
  `agy-delegate`, `commandcode-delegate`, `cursor-delegate`,
  `grok-delegate`, `kimi-delegate`, `pi-delegate`, `omp-delegate`,
  `qoder-delegate`, `vibe-delegate`, `copilot-delegate`,
  `warp-delegate`, `zcode-delegate`) plus `delegate-setup`.
- Each `*-delegate` skill: `SKILL.md` + `scripts/relay.mjs` +
  `references/` (brief, dispatch-and-poll, review-and-land,
  multi-task-queues). Dispatch shape (opencode verified):
  `node "<skill-dir>/scripts/relay.mjs" --brief brief.txt --model
  <provider/model> --cd /path/to/repo` (+ `--lane`, `--read-only`,
  `--resume-last`, `--timeout`). Skill-dir location varies by
  orchestrator (`find ~ -name relay.mjs -path '*<skill>*'` is
  upstream's own answer).
- Loop: write brief → relay dispatch → wait → structured
  `result.json` (`delegate-relay.result.v1`: `status`, `exitCode`,
  `signal`, final report, `touchedFiles`, session id) → review diff +
  re-run gates → **orchestrator lands the commit**. The relay never
  commits; exit 2 = usage error (no result file); missing CLI exits
  127 but still writes an `<cli>_unavailable` result.
- `delegate-setup` (`discover.mjs`/`config.mjs`/`lane.mjs`): discovers
  installed implementer CLIs, proposes fleet lanes, writes global or
  project config **only after approval**. Never dispatches work.
- Requirements: implementer CLI installed **and authenticated** (per-
  skill login), Node 18+, `git`, an orchestrator that can run shell
  commands and read files. Relay scripts are Node built-ins only.
- opencode specifics: `--model` required on fresh runs (no safe
  default); the human owns the allowed-model set, the orchestrator
  picks per task from that set; write via `build` agent (auto-approve
  passed so headless runs never block); read-only via `plan` agent.

## 3. D-001 classification

- **keep.**
- Reason: the generic `delegate(request{task, context?}) →
  DelegationResult{outcome}` seam is tool-neutral, validated, and
  sufficient as the boundary the core depends on. Upstream's richer
  result fields do not force a contract change (see §17); any future
  optional metadata is D-104/D-105 scope, not an audit finding.

## 4. D-002 classification

- **replace.**
- Reason: the PATH probe answers "is an executable named
  `delegate-skills` present" — a question with no true answer upstream,
  and it cannot distinguish skill-installed from implementer-usable.
  The detection question itself must change (see §19).

## 5. D-003 classification

- **replace** (which implies removing the current mechanism).
- Reason: `spawn("delegate-skills", [task, context?])` targets a
  nonexistent executable with an invented argument protocol.
  Upstream execution is `node <skill-dir>/scripts/relay.mjs` with
  skill-specific flags plus a brief artifact, returning structured
  `result.json` — different executable, different argv, different
  result shape, plus a skill-dir discovery problem. Adaptation would
  preserve a misleading core.

## 6. D-004 classification

- **keep.**
- Reason: `providers.delegate.enabled` already means exactly user
  desired state (default false, never auto-enabled). It must not gain
  skill-installed/implementer-ready meanings; no second configuration
  mechanism is needed.

## 7. D-005 classification

- **keep.**
- Reason: the generic confirmed/rejected/pending seam is tool-
  agnostic and composes correctly with delegation-that-modifies-files,
  manual approval, Senior Reviewer, and one-ticket-at-a-time.
  Upstream's review-first loop complements it; neither replaces the
  other's approval ownership.

## 8. D-006 classification

- **adapt.**
- Reason: the `not_delegated` shape, reason vocabulary, and gate
  order (setting → decision → presence → one attempt) remain valid,
  but two inputs change source: "presence" must come from the new
  Skills/relay detection (not the PATH probe), and "failed" must map
  relay result statuses (completed vs failed vs `<cli>_unavailable`
  vs exit-2-no-result) instead of raw spawn failures. Same boundary,
  rewired evidence.

## 9. D-007 classification

- **update.**
- Reason: `docs/providers-delegate-skills.md` correctly records the
  executable-protocol mismatch as unsolved, so its limitation section
  is keepable — but every setup/invocation statement describes the
  obsolete model and must be rewritten for Skills/relay/fleet once
  D-102+ lands. Structure reusable; working claims not.

## 10. Obsolete assumptions

1. An executable named `delegate-skills` exists (D-002, D-003).
2. Spawning it with `[task]`/`[task, context]` delegates work (D-003).
3. A fixed, known CLI argument protocol (D-003: none documented, none exists).
4. One executable, one implicit implementer (D-002/D-003 vs 17 skills).
5. Prompt-in/argv-out delegation with stdout as the whole result (D-003 vs brief + `result.json`).
6. No installation concept (vs Skills CLI install per skill).
7. No relay, no `result.json`, no session/resume (vs relay.mjs core loop).
8. No fleet/lane concept (vs `delegate-setup` + `--lane`).
9. PATH presence proves delegation capability (vs skill-installed ≠ implementer-usable ≠ authenticated).
10. Structured result fields (`touchedFiles`, exit status, session) irrelevant to the contract surface.

## 11. Required adaptations

- New detection over I-001 (`detect` required) answering skill +
  implementer reality, registered generically (D-102).
- New adapter driving `node <skill-dir>/scripts/relay.mjs` with brief
  + explicit skill flags, parsing `delegate-relay.result.v1` into
  `DelegationResult` (D-104), with result mapping limited to §17
  (D-105).
- D-006 rewired to the new evidence sources without changing its
  shape or gate order.
- D-007 rewritten around Skills/relay/fleet (after implementation).
- Optional installation capability via Skills CLI under
  Detect→Explain→Confirm→Install→Verify (D-103), never automatic.

## 12. Components to remove

- The `delegate-skills` executable assumption: `DELEGATE_SKILLS_COMMAND`
  in `delegate-skills.ts`, the PATH lookup in
  `delegate-availability.ts`, and every test asserting that model —
  when their replacements land (not swept early; D-102+ owns the swap).
- Nothing else: no other file contains delegate-specific mechanics.

## 13. Components to preserve

- D-001 contract, D-004 flag, D-005 confirmation seam, D-006 shape/
  reasons/gate order, I-001–I-004 foundation usage, hermetic-seam test
  style, and all boundary rules (optional-only, no workflow ownership,
  no approval bypass, confirmation-gated mutation).

## 14. delegate-setup assessment

`delegate-setup` (discovers CLIs, proposes lanes, writes approved
config) is **not** a dispatch path and must not be used internally by
the delegation adapter. It writes human-owned global/project fleet
configuration after approval — a setup-UX concern belonging to M17
`ai-team setup`, not to per-ticket delegation. Recommendation:
framework uses **direct `*-delegate` skills with explicit skill
choice**; fleet/lane selection maps in a later runtime layer (see
§15). Do not support both paths now; record `delegate-setup` output
as future M17 setup-flow input only.

## 15. Implementer scope assessment

AI Team specialties (`backend`, `frontend`, `integration`,
`database`, `testing`, `documentation`) describe *work kinds*;
delegate skill names (`opencode-delegate`, …) describe *tools*.
No automatic mapping exists between them, and none belongs in the
adapter (tool knowledge would leak upward) or in configuration
(which stays a desired-state flag). The specialty→skill/lane
decision belongs to a later runtime selection layer (M18 provider/
integration selection), with an explicit skill override always
available. Not implemented now.

## 16. OpenCode relationship

Two independent capabilities sharing only a binary name:

- **AI Team OpenCode provider** = direct execution
  (`opencode run <prompt>`, one call, output normalized to the agent
  contract).
- **opencode-delegate** = a separate background OpenCode session via
  `relay.mjs` (brief file, required `--model`, session lifecycle,
  `result.json`, orchestrator reviews and lands).

Do not merge, do not wrap one in the other. The future adapter must
not route through the OpenCode provider, and the OpenCode provider
must not gain delegation concerns. Shared prerequisite (an installed,
authenticated `opencode` CLI) may share detection helpers in D-102
without sharing behavior.

## 17. Result-contract assessment

Against `delegate-relay.result.v1`, classified for AI Team need:

- **Required by workflow**: final implementer report → `outcome`
  text; terminal status (completed vs failed/unavailable) → success
  vs explicit rejection. The current `DelegationResult{outcome}`
  carries both (rejections stay rejections).
- **Useful optional metadata (later, D-105)**: `touchedFiles` as a
  reviewer starting point. Not a contract field now.
- **Diagnostic detail, mapped into error text on failure only**:
  `exitCode`/`signal`/host-killed hints. Never new taxonomy.
- **Upstream-only detail (not needed)**: session/resume ids.
  Cross-ticket resume conflicts with one-ticket-at-a-time; defer
  until a ticket needs it.
- Verdict: **no contract expansion in D-101/D-102**. Map report →
  outcome; fold status/exit evidence into messages.

## 18. Installation boundary recommendation

The framework installs nothing automatically — no Skills package, no
implementer CLI, no authentication, no fleet config. D-103 should
expose installation of **one specific skill**
(`npx skills add amElnagdy/delegate-skills --skill <name>`) only,
under the established Detect→Explain→Confirm→Install→Verify order
with fresh verification; whole-package install only on explicit
confirmation, never by default. `delegate-setup` is never auto-run;
implementer CLIs and credentials are prerequisites to detect and
report, never to provision.

## 19. D-102 implementation boundary

Implement `DelegateSkillsIntegration` against I-001/I-002 without
touching workflow, tickets, review, approval, or the generic
foundation. `detect()` establishes, read-only, for the requested
skill: skill material present (skill directory with `relay.mjs`
resolvable without an unbounded search — bounded candidate locations
only), target implementer CLI present (bounded `--version` probe),
and records which evidence is missing. Authentication/readiness only
where a safe read-only probe exists per skill; never inferred from
config. No relay runs, no installs, no writes, no registry mutation,
no caching. Non-goals: fleet/lane resolution, model selection,
brief construction, result mapping, `delegate-setup`.

## 20. Architecture boundary check (verified)

The future integration, per plan §9.4/§9.6 and this audit, must:
remain optional (never a core dependency); own no workflow state,
tickets, or approvals; never bypass Senior Reviewer; never commit
(relay and framework agree: orchestrator lands); never leak relay
argv/skill paths into role contracts; never force one implementer
per task; keep implementer logic out of generic integration modules;
never gate unrelated workflows on the Skills CLI. The D-102 boundary
in §19 satisfies all eleven; delegate-setup/fleet/model open items
are fenced into §21, not the adapter.

## 21. Open questions

1. Skill-dir discovery: installed location varies by orchestrator;
   upstream suggests `find ~` — D-102 must design a bounded, safe
   search, not a home-tree walk.
2. Model selection: opencode-class implementers have no safe default
   and the human owns the allowed set — D-104 needs a product
   decision on where that set lives for headless framework use.
3. Brief construction (temp files, content policy) and per-ticket
   working directories: new write/scope behavior needing an
   explicit confirmation-scope decision before D-104.
4. Lane/fleet mapping home (M18 selection vs adapter option) and
   whether session resume ever crosses ticket boundaries.
