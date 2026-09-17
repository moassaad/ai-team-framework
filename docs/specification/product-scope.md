# Product Scope — AI Team Framework 0.1.0

Derived from plan §1, §2, §16. The plan is the authoritative source.

## 1. Purpose

A reusable, project-agnostic system that coordinates AI-assisted software
development. A single default agent (Coordinator) faces the user. The user may
explicitly select a role through three optional interfaces — CLI, natural
language, and host-supported slash commands — which all map to the same Role
Contracts (see `roles.md`).

The framework adapts to new or existing target projects. It must not prescribe
any target-project technology, and it must require no `AGENTS.md` inside a
target project.

## 2. Binding principles

- Project-agnostic (plan §2.1)
- Isolated team configuration under `.ai-team/` (plan §2.2)
- One ticket at a time by default (plan §2.3)
- Human control via the Coordinator (plan §2.4)
- No guessing — stop and ask (plan §2.5)
- Minimal complexity for the first release (plan §2.6)

## 3. MVP boundary for 0.1.0

### 3.1 Included

- The five roles: Coordinator, Project Manager, Technical Lead, Implementers,
  Senior Reviewer (plan §16).
- One general Senior Reviewer; specialized review skills optional (plan §3.5).
- Role selection via CLI, natural-language prompt, and optional slash commands,
  all resolving to identical role contracts (plan §4).
- `.ai-team/` workspace with local workflow state (plan §5).
- Configuration schema and validation (plan §6.3, `configuration.md`).
- Basic existing-project discovery and analysis report (plan §7, §16).
- Project/feature planning and small-ticket generation (plan §8).
- One-ticket-at-a-time execution with a review loop (plan §2.3, §6, §16).
- Manual approval as the default; approval configuration validated (plan §6.3).
- OpenCode as the required execution provider (plan §9.1).
- Basic Spec Kit adapter, basic GitHub Issues provider, and optional
  delegate-skills adapter — all behind provider boundaries (`providers.md`).
- Tests and beginner-oriented documentation (plan §16).
- Laravel + React worked example (plan §16).
- Project-agnostic behavior (plan §16).

### 3.2 Explicitly out of scope

From plan §16, not part of 0.1.0:

- Web dashboard
- Complex parallel orchestration
- Permanent specialized agent fleet
- Multi-user authorization system
- External database requirement
- Billing, telemetry, cloud orchestration
- Automatic deployment
- Large provider ecosystem

Anything not listed in §3.1 is out of scope for 0.1.0 unless a ticket explicitly
adds it. A ticket that touches 0.1.0 scope must be flagged as a plan change
(plan §21).

## 4. Product capabilities → acceptance mapping

The following 0.1.0 capabilities correspond to the release Definition of Done
(items 1–15 in plan §17), detailed in `release-0.1-definition.md`:

1. Install → 2. Initialize → 3. Run Coordinator → 4. Role selection (all
   interfaces) → 5. Existing-project analysis → 6. Requirements/technical plan →
   7. Small tickets → 8. Execute one ticket → 9. Review → 10. User approval when
   configured → 11. Continue to next ticket → 12. Local + optional GitHub
   tracking → 13. OpenCode execution → 14. Work without delegate-skills →
   15. Self-contained README.

## 5. Scope notes

- The framework's own implementation stack is NOT decided by this document; see
  `open-decisions.md` (OQ-1). The plan's §13 structure is an implementation
  baseline only and must not be created wholesale; directories appear only when
  a ticket requires them.
- MVP lists "basic" levels for the Spec Kit adapter and GitHub Issues provider;
  what "basic" means per provider is fixed in `providers.md`.
- "Automatic" approval mode and `after: sprint` may be configured but their
  non-default semantics are refinements; 0.1.0 default behavior is
  `manual / ticket / always` (plan §6.3).