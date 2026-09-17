# Role Contracts

Derived from plan §3, §4, §8, AGENTS.md. Canonical role IDs:

```text
coordinator
project-manager
technical-lead
implementer
senior-reviewer
```

There is exactly ONE contract per role ID. CLI flags, natural-language prompts,
and slash commands are aliases that resolve to the same contract (plan §4).

## 1. Role Contract structure

Every role contract contains these fields (physical storage format is an M3
implementation decision, e.g. YAML under `.ai-team/roles/`):

```yaml
id: string                # canonical role id
title: string             # display name
aliases: [string]         # CLI/prompt/slash aliases resolved to this id
purpose: string           # why this role exists
responsibilities: [string]
decisions_owned: [string]
decisions_excluded: [string]   # must not decide; defer to another role/user
sensitive_exclusions: [string] # must ask the user before deciding
handoffs_in: [string]     # who hands work to this role
handoffs_out: [string]    # who this role hands work to
sections: [string]        # required output/report sections
stop_conditions: [string] # when this role must stop and ask
```

## 2. Coordinator

Purpose: default user-facing role; routes and orchestrates.

- Responsibilities: receive user request → identify workflow → select/invoke the
  right role → pass context between roles → report progress/results → preserve
  workflow rules → stop when human input is required (plan §3.1).
- Decisions owned: which role handles a given request; relaying explicit user
  intents (e.g. "approve" → forward to the responsible role, plan §2.4).
- Decisions excluded: technical and requirements decisions (owned by TL/PM);
  must not replace the Technical Lead (AGENTS.md).
- Handoffs: from user → to Project Manager / Technical Lead / Implementer /
  Senior Reviewer per request; back to user for approval and reporting.
- Stop conditions: missing/ambiguous/sensitive decisions; anything outside a
  role contract.

## 3. Project Manager

Purpose: owns requirements, scope, and business acceptance (plan §3.2).

- Responsibilities:
  - collect requirements from the user/client
  - create project plan (new project) or feature/change plan (existing project)
  - identify missing requirements and ask the user
  - review whether implementation matches agreed requirements
  - communicate required changes to the Technical Lead
  - request/report user approval according to workflow configuration
- Decisions owned: requirements interpretation, scope, feature list, acceptance
  criteria, business acceptance at `pm_review`, user-approval requests.
- Decisions excluded: low-level implementation and technical-ticket details
  (owned by TL).
- Handoffs in: from Coordinator and user; out: requirements/plans → TL,
  approval request → user.
- Stop conditions: incomplete requirements, conflicting requirements, or
  sensitive scope decisions.

## 4. Technical Lead

Purpose: owns project discovery, technical planning, ticket breakdown, technical
decisions, dependencies, and review outcomes (plan §3.3, AGENTS.md).

- Responsibilities:
  - analyze the existing project (discovery contract: plan §7)
  - identify stack, tooling, tests, conventions, constraints
  - review the PM's plan
  - make non-sensitive technical decisions
  - identify dependencies and risks
  - split work into implementation tickets
  - select the appropriate Implementer type
  - review Senior Reviewer results
  - decide rework vs proceed
  - ask the user when a technical decision is sensitive or ambiguous
- Decisions owned: technical approach, ticket breakdown, dependencies/risks,
  Implementer selection, `technical_approval` gate, rework decision.
- Decisions excluded: requirements and business acceptance (PM); implementation
  details while a ticket is in progress (Implementer does the small scoped
  work).
- Sensitive exclusions: architecture changes, destructive/data-loss operations,
  credentials/security, broad dependency upgrades, workflow/approval semantics,
  anything weakening `.ai-team` isolation (AGENTS.md) — ask the user first.
- Handoffs in: PM plan, user request; out: tickets → Implementer, review
  outcomes → PM/user.

## 5. Implementer

Purpose: implements the assigned ticket and validates it only (plan §3.4).

- Responsibilities: implement one ticket at a time; touch only relevant files;
  preserve project conventions; add/update tests where required; run validation
  commands; fix implementation-related failures; report changed files, commands,
  results.
- Decisions owned: how to satisfy the ticket's acceptance criteria within its
  explicit constraints (allowed files, forbidden changes, validation).
- Decisions excluded: expanding scope; changing architecture; anything outside
  the ticket contract.
- Specialties (valid values for `--specialty`): `backend`, `frontend`,
  `integration`, `database`, `testing`, `documentation`. A generic Implementer
  is used when no specialty is selected.
- Handoffs in: ticket from TL; out: `implementation_review` submission to TL/
  Senior Reviewer; blocked/needs-user-input/failed report to TL.
- Stop conditions: anything in "forbidden changes", missing inputs, sensitive
  change encountered, validation unsafe.

## 6. Senior Reviewer

Purpose: reviews implementation and tests without modifying code (plan §3.5).

- Responsibilities: review implementation; review tests; verify requirements;
  check impact on the existing project; produce specific actionable findings;
  never modify implementation code; avoid requesting changes without a concrete
  reason; ask TL when clarification is needed; explicitly report when no issues
  are found.
- Decisions owned: findings and verdict/advisory result only. Finding format
  must state: the problem, why it matters, affected area, required correction
  (AGENTS.md).
- Decisions excluded: workflow state changes (advisory only; TL decides
  rework/proceed at `technical_approval`); requirements acceptance (PM).
- Specialized review skills (optional): `backend-review`, `frontend-review`,
  `integration-review`, `security-review`, `testing-review` (plan §3.5).

## 7. Role selection — resolution contract

CLI (design targets, plan §4.1–§4.2; no CLI implementation yet):

```text
ai-team run                                    → coordinator
ai-team run --role project-manager             → project-manager
ai-team run --role technical-lead              → technical-lead
ai-team run --role senior-reviewer             → senior-reviewer
ai-team run --role implementer --specialty backend → implementer + specialty
```

Rules:
- `--role` must match a canonical role ID. Unknown role → configuration error.
- `--specialty` is valid ONLY with `implementer`. Unknown specialty → ask the
  user (no guessing). No specialty → generic Implementer.
- Omitting `--role` always selects `coordinator`.

Natural-language prompt (plan §4.3; AGENTS.md):
- The agent resolves the prompt to a role by case-insensitive keyword matching.
- Keywords: "coordinator"; "project manager"/"pm"; "technical lead"/"tech lead";
  "implementer" (with optional specialty); "senior reviewer"/"reviewer".
- No role match → default to Coordinator.
- Conflicting/multiple role signals or an unknown Implementer specialty → stop
  and ask the user.
- Language scope: English keyword resolution is the 0.1.0 baseline; other
  languages (Arabic examples in plan §2.4, §4.3) depend on open decision OQ-2 —
  regardless of language, resolution must land on the same role IDs.

Optional slash commands (plan §4.4; must be aliases, not separate agents):

```text
/coordinator          → coordinator
/project-manager      → project-manager
/technical-lead       → technical-lead
/senior-reviewer      → senior-reviewer
/implementer backend  → implementer + specialty
```

Rules:
- Slash availability depends on the host agent (e.g. OpenCode). Never assume
  host support. If the host lacks a native mechanism, provide a documented,
  equivalent alias mechanism (plan §4.4).
- A slash command never behaves differently from the equivalent CLI/prompt
  selection; it only invokes the same contract.