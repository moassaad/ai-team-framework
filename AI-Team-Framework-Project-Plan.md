# AI Team Framework — Project Plan

> **Document status:** Approved baseline plan  
> **Current phase:** M10 — GitHub Issues (next)  
> **M0:** COMPLETE  
> **M1:** COMPLETE  
> **M2:** COMPLETE  
> **M3:** COMPLETE  
> **M4:** COMPLETE  
> **M5:** COMPLETE  
> **M6:** COMPLETE  
> **M7:** COMPLETE  
> **M8:** COMPLETE  
> **M9:** COMPLETE  
> **Implementation started:** Yes  
> **Target:** First usable release (MVP / `0.1.0`)

## 1. Project Goal

Build a reusable, project-agnostic AI Team Framework that can coordinate AI-assisted software development for new or existing projects.

The framework is designed to work with a single default agent (Coordinator) while allowing the user to explicitly select a role through multiple optional entry methods:

1. CLI commands.
2. Natural-language prompts.
3. Slash commands such as `/project-manager`, `/technical-lead`, `/implementer`, and `/senior-reviewer`.

These are different interfaces to the same role system; they must not create separate implementations of the roles.

The framework must remain independent from the target project's architecture, language, framework, folder structure, and development conventions.

---

# 2. Core Principles

## 2.1 Project-Agnostic

The framework must not assume:

- Laravel
- React
- Vue
- Java/Spring
- REST APIs
- Docker
- GitHub
- Spec Kit
- OpenCode
- a specific database
- a specific architecture or design pattern

The team must first discover the target project and then work according to what already exists.

## 2.2 Isolated Team Configuration

All framework-specific configuration and working data inside the target project must be isolated under:

```text
.ai-team/
```

The framework must not require a root `AGENTS.md` file in the target project.

An adapter for external agent instruction formats may be added later if useful.

## 2.3 One Ticket at a Time by Default

The default execution model is sequential:

```text
Plan → Ticket → Implement → Review → Approve → Next Ticket
```

Parallel execution may be supported later for clearly independent work, but it is not a first-release requirement.

## 2.4 Human Control

The user interacts primarily with the Coordinator.

The user does not need to manually manipulate ticket states.

For example:

```text
User: وافق
```

or:

```text
User: عدّل الخطة
```

The Coordinator forwards the intent to the appropriate role, and the responsible role changes the workflow state.

## 2.5 No Guessing

When required information is missing, conflicting, sensitive, or ambiguous, the agent must stop and ask for user input rather than inventing a decision.

## 2.6 Minimal Complexity

The first release should favor:

- small modules
- explicit contracts
- low token usage
- few dependencies
- predictable workflow
- easy installation
- understandable documentation

---

# 3. Team Roles

## 3.1 Coordinator

The default user-facing role.

Responsibilities:

- receive the user's request
- identify the required workflow
- select or invoke the appropriate role
- pass context between roles
- report progress and results
- preserve the workflow rules
- stop when human input is required

The Coordinator is a coordination role, not an additional technical specialist.

## 3.2 Project Manager

Responsibilities:

- collect requirements from the user/client
- create a project plan for a new project
- create a feature/change plan for an existing project
- identify missing requirements
- ask the user when requirements are incomplete
- review whether implementation matches the agreed requirements
- communicate required changes to the Technical Lead
- request/report user approval according to workflow configuration

The Project Manager does not own day-to-day code implementation details.

## 3.3 Technical Lead

Responsibilities:

- analyze the existing project
- identify stack, tooling, tests, conventions, and constraints
- review the Project Manager's plan
- make non-sensitive technical decisions
- identify dependencies and risks
- split work into implementation tickets
- select the appropriate Implementer type
- review Senior Reviewer results
- decide whether a ticket should be reworked or can proceed
- ask the user when a technical decision is sensitive or ambiguous

## 3.4 Implementer

Responsibilities:

- implement one ticket at a time
- modify only relevant files
- preserve project conventions
- add/update tests where required
- run validation commands
- fix implementation-related failures
- report changed files, commands, and results

Initial specializations:

```text
backend
frontend
integration
database
testing
documentation
```

A generic Implementer may be used when no specific specialty is needed.

## 3.5 Senior Reviewer

One general Senior Reviewer is preferred in the first release to reduce complexity and token usage.

Responsibilities:

- review implementation
- review tests
- verify requirements
- check impact on the existing project
- provide specific actionable findings
- never modify implementation code directly
- avoid requesting changes without a concrete reason
- ask the Technical Lead when clarification is needed
- explicitly report when no issues are found

Specialized review Skills may be invoked when needed:

```text
backend-review
frontend-review
integration-review
security-review
testing-review
```

---

# 4. Role Selection Interfaces

The same role system must support multiple optional entry methods.

## 4.1 Default CLI

Example design:

```bash
ai-team run
```

Starts the Coordinator.

## 4.2 Explicit CLI Role Selection

Example design:

```bash
ai-team run --role project-manager
ai-team run --role technical-lead
ai-team run --role implementer --specialty backend
ai-team run --role senior-reviewer
```

These are design examples only until implemented.

## 4.3 Natural-Language Prompt Selection

The user may select a role through normal language.

Example:

```text
تحدث مع Technical Lead وحلل المشروع الحالي.
```

```text
تصرف كـ Project Manager وأنشئ خطة لهذه الميزة.
```

## 4.4 Optional Slash Commands

Slash commands are also supported as an optional user-facing shortcut.

Example design:

```text
/project-manager
```

```text
/technical-lead
```

```text
/implementer backend
```

```text
/senior-reviewer
```

```text
/coordinator
```

Slash commands must be treated as aliases for role selection, not as separate agent implementations.

The first release should support them in a lightweight way where the host environment allows it. If a specific host (such as OpenCode) does not provide a native slash-command mechanism, the framework should provide a documented equivalent rather than forcing the whole architecture to depend on it.

---

# 5. Target Project Workspace

When initialized inside a target project:

```text
my-project/
├── existing-project-files/
└── .ai-team/
    ├── config.yaml
    ├── project.yaml
    ├── roles/
    ├── workflows/
    ├── state/
    ├── specs/
    ├── plans/
    ├── reviews/
    ├── reports/
    └── logs/
```

The framework must not require these folders to exist before initialization.

---

# 6. Workflow

## 6.1 High-Level Flow

```text
User
  ↓
Coordinator
  ↓
Project Manager
  ↓
Technical Lead
  ↓
Ticket
  ↓
Implementer
  ↓
Senior Reviewer
  ↓
Technical Lead
  ↓
Project Manager (according to approval configuration)
  ↓
User Approval when required
  ↓
Next Ticket / Closed
```

## 6.2 Ticket State Machine

Primary flow:

```text
ready
  ↓
in_progress
  ↓
implementation_review
  ↓
technical_approval
  ↓
pm_review
  ↓
closed
```

Additional states:

```text
blocked
needs_user_input
changes_requested
failed
cancelled
```

## 6.3 Approval Configuration

Target configuration:

```yaml
approval:
  mode: manual
  after: ticket
  sensitive_changes: always
```

Supported values:

```text
mode: manual | automatic
after: ticket | sprint
sensitive_changes: always | configured | never
```

Default for the first release:

```yaml
approval:
  mode: manual
  after: ticket
  sensitive_changes: always
```

---

# 7. Project Discovery

Before planning implementation work in an existing project, the Technical Lead must inspect the project and identify, where available:

- programming languages
- backend framework
- frontend framework
- database
- package managers
- build tools
- testing tools
- CI/CD configuration
- Docker or container setup
- Git conventions
- naming conventions
- architecture already present
- documentation
- available development commands
- existing issues/tasks
- important entry points
- technical constraints
- potentially sensitive files/configuration

The framework must report uncertainty rather than pretending to detect something it cannot establish.

---

# 8. Planning Responsibilities

## 8.1 Project Manager Planning

For a new project:

```text
Requirements
→ Scope
→ Features
→ Acceptance Criteria
→ Project Plan
```

For an existing project:

```text
User Request
→ Current Project Analysis
→ Requirements
→ Change Scope
→ Feature Plan
```

## 8.2 Technical Lead Planning

```text
PM Plan
→ Technical Analysis
→ Constraints
→ Dependencies
→ Ticket Breakdown
→ Execution Order
```

## 8.3 Spec Kit

Spec Kit is an optional planning/specification tool and is not the team manager.

The intended responsibility split is:

```text
Project Manager → Requirements and scope
Technical Lead  → Technical plan and ticket decomposition
Spec Kit        → Specification/plan artifacts when enabled
Workflow Engine → Execution states and transitions
```

---

# 9. Providers and Integrations

Provider integrations must be isolated behind interfaces so the core framework does not depend directly on one external tool.

## 9.1 Required Initial Provider

```text
OpenCode
```

OpenCode is the initial execution provider.

## 9.2 Optional Providers

```text
Spec Kit
delegate-skills
GitHub Issues
```

## 9.3 delegate-skills

`delegate-skills` is an optional delegation provider, not a role.

The integration must:

- remain optional
- detect availability
- require explicit enablement
- avoid making the framework dependent on it
- provide a safe fallback when unavailable
- document the external setup clearly

---

# 10. GitHub Issues

GitHub Issues are an optional external tracking provider.

The framework should still work without GitHub.

The intended model is:

```text
Internal workflow state
        ↕
GitHub Issue state (when enabled)
```

The integration may synchronize:

- ticket title
- ticket description
- state
- dependencies
- review result
- completion summary

GitHub must not be assumed for every target project.

---

# 11. Ticket Contract

Every implementation ticket should contain:

```text
Ticket ID
Goal
Context
Allowed files
Forbidden changes
Inputs
Expected outputs
Dependencies
Acceptance criteria
Validation commands
Stop conditions
```

A ticket is complete only when its acceptance criteria are satisfied and required validation has been performed.

---

# 12. AI Agent Execution Rules

The framework is intended to work well even with a free or relatively weak AI agent.

The agent must:

1. Read only the necessary instructions and context first.
2. Understand the current ticket before coding.
3. Work on one ticket at a time by default.
4. Never invent missing requirements.
5. Preserve existing architecture unless a change is explicitly approved.
6. Avoid unnecessary dependencies.
7. Avoid unrelated file modifications.
8. Add/update tests when required.
9. Run available validation commands.
10. Report exactly what changed.
11. Stop when user input is required.
12. Follow the configured approval mode.

---

# 13. Repository Structure — Initial Design

The repository itself is proposed as:

```text
ai-team-framework/
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts
│   ├── commands/
│   ├── coordinator/
│   ├── roles/
│   ├── workflow/
│   ├── project/
│   ├── config/
│   └── providers/
├── roles/
│   ├── coordinator/
│   ├── project-manager/
│   ├── technical-lead/
│   ├── implementers/
│   └── senior-reviewer/
├── skills/
│   ├── requirements/
│   ├── project-analysis/
│   ├── planning/
│   ├── implementation/
│   ├── testing/
│   ├── review/
│   └── delegation/
├── templates/
│   ├── project-config/
│   ├── role-config/
│   └── workflow-config/
├── docs/
└── tests/
```

This structure is an implementation baseline, not a license to create every directory immediately. Each directory must be introduced only when a ticket requires it.

---

# 14. Milestones and Tickets

## M0 — Discovery and Specification

Status: **COMPLETE**

```text
M0-001 Product Scope
M0-002 MVP Definition
M0-003 Role Contracts
M0-004 Workflow Specification
M0-005 Configuration Specification
M0-006 Provider Boundaries
M0-007 Release 0.1.0 Definition of Done
```

## M1 — Repository Foundation

Status: **COMPLETE**

```text
F-001 Initialize repository
F-002 Configure TypeScript
F-003 Add build/test/lint scripts
F-004 Add basic CLI entry point
F-005 Add README and contribution guide
F-006 Add license
```

## M2 — Configuration and Workspace

Status: **COMPLETE**

```text
C-001 Define configuration schema
C-002 Add configuration loader
C-003 Validate configuration
C-004 Initialize .ai-team directory
C-005 Add default configuration
C-006 Add configuration documentation
```

## M3 — Role Contracts

Status: **COMPLETE**

```text
R-001 Define role contract format
R-002 Define Coordinator contract
R-003 Define Project Manager contract
R-004 Define Technical Lead contract
R-005 Define Implementer contract
R-006 Define Senior Reviewer contract
R-007 Define role selection rules
```

## M4 — Workflow Engine

Status: **COMPLETE**

```text
W-001 Define state machine
W-002 Define valid transitions
W-003 Add approval configuration
W-004 Add manual approval flow
W-005 Add automatic approval flow
W-006 Add blocked and user-input states
W-007 Add retry and handoff rules
W-008 Add ticket completion rules
```

## M5 — CLI and Role Invocation

Status: **COMPLETE**

```text
CLI-001 Implement default Coordinator command
CLI-002 Implement explicit --role selection
CLI-003 Implement --specialty for Implementer
CLI-004 Implement prompt-based role selection
CLI-005 Define slash-command alias contract
CLI-006 Implement slash-command aliases where host-supported
CLI-007 Add help and discoverability
```

## M6 — Project Discovery

Status: **COMPLETE**

M6 provides discovery contracts, stack detection, package/build detection, testing detection, project conventions detection, an aggregated analysis report, Laravel and React examples, and safe unknown-stack behavior.

```text
A-001 Define discovery contract ✅
A-002 Detect project stack ✅
A-003 Detect package/build tools ✅
A-004 Detect testing tools ✅
A-005 Detect project conventions ✅
A-006 Generate analysis report ✅
A-007 Laravel analysis example ✅
A-008 React analysis example ✅
A-009 Handle unknown stack safely ✅
```

## M7 — OpenCode Provider

Status: **COMPLETE**

M7 provides a generic agent provider interface, an isolated OpenCode provider, role prompt rendering, a shared execution result format, timeout/failure handling, and OpenCode usage documentation.

```text
O-001 Define agent provider interface ✅
O-002 Add OpenCode provider ✅
O-003 Add role prompt rendering ✅
O-004 Add execution result format ✅
O-005 Add timeout/failure handling ✅
O-006 Document OpenCode usage ✅
```

## M8 — Planning and Ticket Generation

Status: **COMPLETE**

M8 provides a generic specification provider interface, a Spec Kit adapter, a fallback provider, requirements-to-plan mapping, and plan-to-ticket decomposition.

```text
P-001 Define specification provider interface ✅
P-002 Add Spec Kit adapter ✅
P-003 Map requirements to plans ✅
P-004 Map plans to tickets ✅
P-005 Add fallback when Spec Kit is unavailable ✅
P-006 Document Spec Kit usage
```

## M9 — Implementation and Review Flow

Status: **COMPLETE**

M9 provides Implementer execution, Senior Reviewer execution, the changes-requested loop, technical approval, PM review, and completion reporting over the W-002 and W-008 contracts.

```text
IR-001 Implementer execution flow ✅
IR-002 Senior Reviewer execution flow ✅
IR-003 Changes-requested loop ✅
IR-004 Technical approval flow ✅
IR-005 PM review flow ✅
IR-006 Completion reporting ✅
```

## M10 — GitHub Issues

Status: **PENDING**

```text
G-001 Define issue provider interface ✅
G-002 Add GitHub Issues provider ✅
G-003 Map ticket states ✅
G-004 Add issue creation ✅
G-005 Add issue update ✅
G-006 Add issue completion ✅
G-007 Add local-only fallback
```

## M11 — Optional delegate-skills Integration

Status: **PENDING**

```text
D-001 Define delegate provider contract
D-002 Detect delegate-skills availability
D-003 Add optional delegate adapter
D-004 Add explicit enablement setting
D-005 Add safety confirmation
D-006 Add delegate failure fallback
D-007 Document optional installation
```

## M12 — Testing and Safety

Status: **PENDING**

```text
T-001 Unit test foundation
T-002 Workflow transition tests
T-003 Configuration validation tests
T-004 Role selection tests
T-005 Provider failure tests
T-006 Project discovery tests
T-007 Safe execution tests
T-008 End-to-end sample project
T-009 Installation verification
```

## M13 — Documentation and Release

Status: **PENDING**

```text
REL-001 Quick start
REL-002 Installation guide
REL-003 Configuration guide
REL-004 Roles guide
REL-005 Workflow guide
REL-006 Providers guide
REL-007 Troubleshooting
REL-008 Existing-project example
REL-009 Laravel + React example
REL-010 Final README
REL-011 Release checklist
REL-012 Release 0.1.0
```

---

# 15. Dependencies

The major dependency chain is:

```text
M0
 ↓
M1
 ↓
M2
 ↓
M3
 ↓
M4
 ↓
M5
 ↓
M6
 ↓
M7
 ↓
M8
 ↓
M9
 ↓
M10 / M11
 ↓
M12
 ↓
M13
```

Some tickets may be developed in parallel once their contracts are stable, but the Coordinator should still present work to the implementation agent as one focused ticket at a time.

---

# 16. MVP Scope for Release 0.1.0

## Included

- Coordinator
- Project Manager
- Technical Lead
- Implementer
- Senior Reviewer
- CLI role selection
- Prompt role selection
- Optional slash-command role selection
- `.ai-team/` workspace
- configuration validation
- basic project discovery
- project/feature planning
- ticket generation
- one-ticket-at-a-time execution
- review loop
- manual approval
- local workflow state
- OpenCode provider
- basic GitHub Issues provider
- basic Spec Kit adapter
- optional delegate-skills adapter
- tests
- beginner-oriented documentation
- Laravel + React example
- project-agnostic behavior

## Explicitly Out of Scope

- Web dashboard
- complex parallel orchestration
- permanent specialized agent fleet
- multi-user authorization system
- external database requirement
- billing
- telemetry
- cloud orchestration
- automatic deployment
- large provider ecosystem

---

# 17. Definition of Done for 0.1.0

Release `0.1.0` is considered complete when a new user can:

1. Install the framework.
2. Initialize it in a new or existing project.
3. Run the Coordinator.
4. Select a role through CLI, prompt, or supported slash command.
5. Analyze an existing project before implementation.
6. Produce a requirements/technical plan.
7. Produce small implementation tickets.
8. Execute one ticket.
9. Run review.
10. Request user approval when configured.
11. Continue to the next ticket.
12. Track work locally and optionally in GitHub Issues.
13. Use OpenCode as the execution provider.
14. Run without delegate-skills when it is not installed.
15. Understand the workflow from the README without prior knowledge of the repository.

---

# 18. Master Agent Prompt

The following prompt is the baseline instruction for an AI Agent working on this repository.

```text
You are working on the AI Team Framework repository.

Your responsibility is limited to the currently assigned ticket.

Before making any change:

1. Read the repository instructions.
2. Read the relevant AI Team specification and current project state.
3. Read the assigned ticket and all acceptance criteria.
4. Inspect only the project files required to understand the ticket.
5. Do not assume that a framework, architecture, test setup, provider, or tool exists.
6. Preserve existing conventions.
7. Do not modify files outside the ticket scope unless the ticket explicitly requires it.
8. Do not introduce unnecessary dependencies.
9. Do not invent missing requirements.
10. Stop and request user input when a requirement is ambiguous or a sensitive decision is required.

Execution rules:

- Work on one ticket at a time.
- Keep the implementation simple and maintainable.
- Follow the approved AI Team specifications.
- Keep provider-specific logic isolated.
- Do not couple the core framework unnecessarily to OpenCode, Spec Kit, GitHub, or delegate-skills.
- Add or update tests when required.
- Run relevant validation commands.
- Fix failures related to the current ticket only.
- Do not mark the ticket complete unless all acceptance criteria are satisfied.
- Do not move to another ticket unless the workflow explicitly allows it.

Role selection may come from:

- CLI flags
- natural-language prompts
- optional slash commands such as /project-manager or /technical-lead

These interfaces must invoke the same underlying role contracts.

Before finishing, report:

1. Ticket ID.
2. Role used.
3. Summary of changes.
4. Files created.
5. Files modified.
6. Files deleted, if any.
7. Commands executed.
8. Test/validation results.
9. Remaining risks/questions.
10. Suggested next workflow action.
```

---

# 19. Current Execution Status

| Milestone | Status | Notes |
|---|---|---|
| M0 Discovery & Specification | **COMPLETE** | Specifications accepted; M0 closed |
| M1 Repository Foundation | **COMPLETE** | F-001 through F-006 accepted |
| M2 Configuration & Workspace | **COMPLETE** | C-001 through C-006 accepted |
| M3 Role Contracts | **COMPLETE** | R-001 through R-007 accepted |
| M4 Workflow Engine | **COMPLETE** | W-001 through W-008 accepted |
| M5 CLI & Role Invocation | **COMPLETE** | CLI-001 through CLI-007 accepted |
| M6 Project Discovery | **COMPLETE** | A-001 through A-009 accepted |
| M7 OpenCode Provider | **COMPLETE** | O-001 through O-006 accepted |
| M8 Planning & Ticket Generation | **COMPLETE** | P-001 through P-005 accepted |
| M9 Implementation & Review | **COMPLETE** | IR-001 through IR-006 accepted |
| M10 GitHub Issues | PENDING | G-001 through G-006 accepted; G-007 pending |
| M11 delegate-skills | PENDING | Optional integration |
| M12 Testing & Safety | PENDING | Not started |
| M13 Documentation & Release | PENDING | Target release: `0.1.0` |

---

# 20. Next Steps

The next work item is **G-007 — Add local-only fallback** (M10, pending).

M0, M1, M2, M3, M4, M5, M6, M7, M8, and M9 are complete (F-001 through F-006, C-001 through C-006, R-001 through R-007, W-001 through W-008, CLI-001 through CLI-007, A-001 through A-009, O-001 through O-006, P-001 through P-005, and IR-001 through IR-006 accepted). M10 has G-001 through G-006 accepted; G-007 is pending.

### M0 checklist

```text
[done] Approve product direction
[done] Approve core roles
[done] Approve project-agnostic principle
[done] Approve .ai-team isolation
[done] Approve one-ticket-at-a-time default
[done] Approve CLI role selection
[done] Approve prompt role selection
[done] Approve optional slash-command role selection
[done] Approve manual approval as default
[done] Approve optional providers
[done] Finalize Product Scope specification
[done] Finalize Role Contract specification
[done] Finalize Workflow specification
[done] Finalize Configuration specification
[done] Finalize Provider boundaries
[done] Finalize 0.1.0 Definition of Done
```

M10 continues with (not started yet):

```text
G-007 Add local-only fallback
```

---

# 21. Change Control

This document is the current source of truth for the project plan.

When a new decision is made:

1. Update the relevant section.
2. Update the affected milestone/ticket status.
3. Record the decision in the project documentation.
4. Do not silently change the scope.

Any future change that affects the MVP scope, role responsibilities, workflow, or provider boundaries must be explicitly identified as a plan change.
