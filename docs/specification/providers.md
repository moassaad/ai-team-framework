# Provider Boundaries

Derived from plan §8.3, §9, §10; AGENTS.md.

## 1. Principle

Every integration sits behind a provider/adapter interface. The core framework
(roles, workflow, configuration) must not depend directly on any external tool.

```text
OpenCode       = required first-class execution provider
Spec Kit       = optional specification/planning integration
GitHub Issues  = optional tracking provider
delegate-skills = optional delegation provider
```

Optional providers must never become core dependencies (AGENTS.md). The
framework must work with all optional providers disabled. A provider never owns
or changes workflow semantics; the Workflow Engine and roles remain authoritative
(plan §8.3).

## 2. OpenCode (required)

Role: the initial execution provider (plan §9.1).

- Responsibilities (M7 scope, plan §14):
  - agent provider interface
  - render role prompts from Role Contracts (`roles.md`)
  - execute a role within a bounded context
  - normalize execution results into a documented result format
  - handle timeout/failure without corrupting ticket state
  - support role selection entry points, including a documented equivalent when
    the host lacks native slash commands (plan §4.4)
- Explicit non-responsibilities:
  - not the Coordinator, Project Manager, or Technical Lead
  - not the Workflow Engine or state store
  - not a planning tool (plan §8.3)
- Boundary rule: all OpenCode-specific logic is isolated in the provider layer
  (O-001..O-006). Core contracts must not import host-specific behavior.

## 3. Spec Kit (optional)

Role: optional specification/planning capability (plan §8.3, §9.2). It is a
tool, not the Coordinator or Workflow Engine.

Artifact flow (AGENTS.md) used when enabled:

```text
constitution -> specify -> clarify -> plan -> checklist -> tasks -> analyze
```

Responsibility split (plan §8.3):

| Concern | Owner |
|---|---|
| Requirements and scope | Project Manager |
| Technical plan and ticket decomposition | Technical Lead |
| Specification/plan artifacts (when enabled) | Spec Kit |
| Execution states and transitions | Workflow Engine |

Boundary rules:
- Spec Kit produces artifacts; it does not own requirements or technical
  decisions. The PM/TL remain the decision owners.
- Its `tasks` output is an input to ticket generation; the framework keeps
  execution bounded to small tickets and must not implement an entire `tasks.md`
  at once (AGENTS.md).
- Fallback: when Spec Kit is unavailable or disabled, planning proceeds with
  plain framework artifacts under `.ai-team/specs/` and `.ai-team/plans/`
  (P-005). The framework must not require Spec Kit.
- "Basic adapter" for 0.1.0 means: enable/disable, detect availability, map
  requirements/plans/tickets to/from Spec Kit artifacts, and degrade to the
  fallback.

## 4. GitHub Issues (optional)

Role: optional external tracking provider (plan §10). The framework must work
without GitHub.

- Enablement: explicit in `config.yaml` (`providers.github.enabled: true` plus
  `owner`/`repo`); disabled by default.
- Synchronization model (plan §10):

```text
Internal workflow state
        ↕
GitHub Issue state (when enabled)
```

- Fields that may synchronize: ticket title, description, state, dependencies,
  review result, completion summary.
- Boundary rules:
  - GitHub is never assumed for a target project; local-only is the default.
  - GitHub auth/tokens are out-of-band, never written under `.ai-team/`
    (`configuration.md` §4).
  - "Basic provider" for 0.1.0 means: interface, state mapping, issue creation,
    update, completion, and a local-only fallback (G-001..G-007).
  - Provider failure must not block the workflow; fall back to local state and
    report the failure.

## 5. delegate-skills (optional)

Role: optional delegation provider, not a role (plan §9.3).

Required properties (plan §9.3):
- remain optional
- detect availability
- require explicit enablement (`providers.delegate.enabled`, default false)
- avoid making the framework dependent on it
- provide a safe fallback when unavailable
- document external setup clearly
- add a safety confirmation for delegated actions (D-005)

Boundary rules:
- Delegation never bypasses role contracts, ticket scope, approval gates, or
  sensitive-change controls.
- If delegate-skills is absent or disabled, the same work is performed in the
  normal single-role flow with no loss of correctness (release DoD item 14).

## 6. Availability and fallback matrix

| Provider | Required? | Default | If disabled/unavailable |
|---|---|---|---|
| OpenCode | Yes | enabled | Cannot execute; stop with clear error |
| Spec Kit | No | disabled | Plain `.ai-team/specs`/`plans` artifacts |
| GitHub Issues | No | disabled | Local-only state under `.ai-team/state/` |
| delegate-skills | No | disabled | Normal in-framework execution |

## 7. Provider change control

Adding, removing, or changing provider boundaries alters MVP scope and is a plan
change (plan §21). Providers must never gain authority over workflow states,
approvals, or sensitive-change handling.