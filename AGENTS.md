# AI Team Framework — Agent Instructions

## Mission

You are an AI coding agent working on the **AI Team Framework** repository.

The framework is a reusable, project-agnostic AI team system for coordinating:

- Coordinator
- Project Manager
- Technical Lead
- Implementers
- Senior Reviewer

The framework must not impose a programming language, framework, architecture, directory structure, or design pattern on target projects.

## Source of Truth

Before doing work, read:

1. `AI-Team-Framework-Project-Plan.md`
2. Relevant files under `docs/`
3. The current ticket/task supplied by the Coordinator

Do not invent requirements that are not present in the approved plan, specification, ticket, or explicit user instruction.

## Current Phase

```text
M0 — Discovery and Specification: COMPLETE
M1 — Repository Foundation: COMPLETE
M2 — Configuration and Workspace: COMPLETE
M3 — Role Contracts: COMPLETE
M4 — Workflow Engine: COMPLETE
M5 — CLI & Role Invocation: COMPLETE
M6 — Project Discovery: NEXT
```

M0, M1, M2, M3, M4, and M5 are complete. F-001 through F-006, C-001 through C-006, R-001 through R-007, W-001 through W-008, and CLI-001 through CLI-007 are accepted.

Next implementation ticket:

```text
A-001 Define discovery contract
```

Do not start A-001 unless explicitly assigned.

## Role Selection

The framework supports three optional role-selection mechanisms. They must all resolve to the same underlying Role Contract:

### CLI

```text
ai-team run
ai-team run --role project-manager
ai-team run --role technical-lead
ai-team run --role senior-reviewer
ai-team run --role implementer --specialty backend
```

### Natural-language Prompt

```text
Act as the Technical Lead and analyze the current project.
Act as the Project Manager and create a feature plan.
```

### Optional Slash Commands

```text
/coordinator
/project-manager
/technical-lead
/senior-reviewer
/implementer backend
```

Slash-command support is optional. Never assume the host agent supports it.

## Core Execution Rules

1. Work on one ticket at a time unless the workflow explicitly permits parallel execution.
2. Inspect the repository before modifying it.
3. Never invent requirements or silently make sensitive decisions.
4. Modify only files required by the current ticket.
5. Avoid unrelated refactoring and unnecessary dependencies.
6. Preserve existing project conventions.
7. Add/update tests when required.
8. Run relevant validation commands.
9. Do not mark a ticket complete unless its acceptance criteria are satisfied.
10. Do not move to the next ticket unless the workflow allows it.
11. Keep implementation simple, maintainable, and reviewable.
12. Report exact files changed and validation results.

## Ambiguity and Sensitive Changes

Stop and ask the Coordinator/user instead of guessing when requirements are materially ambiguous.

Treat these as sensitive unless explicitly defined by the approved task:

- architecture changes
- deletion/data-loss operations
- credentials/security changes
- broad dependency upgrades
- destructive database operations
- workflow/approval semantic changes
- changes that weaken `.ai-team` isolation

## Role Boundaries

### Coordinator
User-facing routing and orchestration. Do not replace the Technical Lead.

### Project Manager
Owns requirements, scope, business acceptance, and requirement feedback. Do not own low-level implementation decisions.

### Technical Lead
Owns project discovery, technical planning, ticket breakdown, technical decisions, dependencies, and review outcomes.

### Implementer
Implements the assigned ticket and validation only. Do not expand scope.

### Senior Reviewer
Reviews implementation and tests. Does not modify implementation code during review. Findings must identify the problem, why it matters, affected area, and required correction.

## Project-Agnostic Rule

The target project may have its own architecture, conventions, folders, and tools. Adapt to them.

Use:

```text
Discover -> Analyze -> Decide -> Implement -> Review
```

Do not use:

```text
Framework preference -> Force architecture -> Implement
```

## `.ai-team` Isolation

Framework runtime/configuration artifacts belong under:

```text
.ai-team/
```

Do not require `AGENTS.md` inside the target project. This `AGENTS.md` governs the AI Team Framework repository itself.

## Spec Kit

Spec Kit is a specification/planning capability inside the framework, not the Coordinator or Workflow Engine.

Use its artifact flow when useful:

```text
constitution -> specify -> clarify -> plan -> checklist -> tasks -> analyze
```

Do not blindly implement an entire `tasks.md` for this project. Keep execution bounded to small tickets.

## Providers

Keep integrations behind provider/adapter interfaces.

```text
OpenCode = required first-class provider
Spec Kit = specification/planning integration
GitHub Issues = optional tracking provider
delegate-skills = optional delegation provider
```

Optional providers must never become core dependencies.

## Completion Report

Every completed ticket must report:

```text
Ticket ID
Goal
Implementation summary
Files created
Files modified
Files deleted
Commands executed
Validation results
Remaining risks
Questions
Recommended next workflow step
```

## Stop Conditions

Stop and report when:

- requirements conflict;
- required information is missing;
- a sensitive decision is required;
- requested work exceeds ticket scope;
- repository state differs materially from expected context;
- validation cannot be performed safely;
- a required provider is unavailable.

## Final Rule

Prefer **small, correct, reviewable, repeatable progress** over maximum autonomy.
