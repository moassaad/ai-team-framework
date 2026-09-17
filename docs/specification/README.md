# AI Team Framework — Specification

Status: M0 — Discovery and Specification (see plan §19)

This directory contains the implementation contracts derived from the approved
baseline plan (`AI-Team-Framework-Project-Plan.md`, "the plan"). The plan is the
single source of truth. These documents make the plan concrete enough that a
weak or free AI agent can implement the framework through small, bounded tickets.

## Source-of-truth hierarchy

1. `AI-Team-Framework-Project-Plan.md` — approved baseline plan (wins on conflict)
2. `AGENTS.md` — working rules for agents on this repository
3. `docs/specification/` — derived contracts (must never contradict 1 or 2)

If a specification contradicts the plan, the plan wins and the specification
must be corrected under change control (plan §21).

## Reading order

| Order | Document | Covers M0 items |
|---|---|---|
| 1 | `product-scope.md` | M0-001 Product Scope, M0-002 MVP Definition |
| 2 | `roles.md` | M0-003 Role Contracts |
| 3 | `workflow.md` | M0-004 Workflow Specification |
| 4 | `configuration.md` | M0-005 Configuration Specification |
| 5 | `providers.md` | M0-006 Provider Boundaries |
| 6 | `release-0.1-definition.md` | M0-007 Release 0.1.0 Definition of Done |
| — | `open-decisions.md` | Cross-cutting; needs user input |

## Cross-cutting constraints

These hold for every document in this package and must never be violated by a
future ticket:

- Project-agnostic: the framework imposes no language, framework, architecture,
  or conventions on target projects (plan §2.1).
- `.ai-team` isolation: all framework artifacts in a target project live under
  `.ai-team/`; no root `AGENTS.md` is required in the target (plan §2.2).
- One ticket at a time by default; parallel execution is out of scope for 0.1.0
  (plan §2.3).
- The three role-selection interfaces (CLI, natural-language prompt, optional
  slash commands) must all resolve to the same underlying Role Contract
  (plan §4, AGENTS.md).
- Slash commands are optional and dependent on host support (plan §4.4).
- OpenCode is the required first-class provider; Spec Kit, GitHub Issues, and
  delegate-skills are optional and never core dependencies (plan §9).
- No guessing: missing, conflicting, sensitive, or ambiguous requirements
  require stopping and asking (plan §2.5).
- Keep execution bounded to small tickets; do not implement the whole `tasks.md`
  at once (AGENTS.md).

Do not create specification files outside this directory without an explicit
ticket.