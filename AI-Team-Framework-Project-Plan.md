# AI Team Framework — Project Plan

> **Document status:** Approved active project plan  
> **Current phase:** Post-`0.1.0` modernization and integration architecture  
> **Implementation started:** Yes  
> **Baseline:** Release `0.1.0` completed  
> **Current target:** Release `0.2.0`

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

External tools must remain isolated behind provider/integration boundaries so the core framework owns the team workflow and does not become coupled to a specific external implementation.

## 9.1 Required Initial Provider

```text
OpenCode
```

OpenCode is the initial execution provider for the `0.1.0` baseline. Its integration is still isolated behind a provider boundary even though execution depends on it by default.

## 9.2 Optional Integrations

```text
Spec Kit
delegate-skills
GitHub Issues
```

Optional means:

- the framework can run without the integration when the requested workflow does not require it;
- absence must not break the core workflow unnecessarily;
- the integration is discovered and reported explicitly;
- enablement is a user/configuration decision, not an implicit side effect.

## 9.3 Integration Architecture

The framework owns the workflow. Integrations provide capabilities.

```text
                    AI Team Framework
                           |
                   Owns the workflow
                           |
                  Integration / Provider
                           |
        +------------------+------------------+
        |                  |                  |
     Spec Kit        delegate-skills      GitHub Issues
     capability          capability          capability
```

The integration layer must be extensible, but it must not become a large generic framework before a real second/third integration proves the need.

## 9.4 delegate-skills

`delegate-skills` is an optional delegation capability, not a role and not a required dependency.

The framework must not depend on a historical executable contract such as `delegate-skills` being available on `PATH`. The current upstream project is a Skills package with delegate skills and relay scripts, so the adapter must target the currently supported interface rather than preserve the old executable assumption.

## 9.5 Spec Kit

Spec Kit is an optional specification/planning capability, not the team manager and not the workflow engine.

The framework may use Spec Kit for specification, clarification, planning, tasks, or analysis when enabled, but the resulting work must flow back into the framework's own ticket and approval workflow.

## 9.6 Integration Ownership Rules

- The framework owns workflow state, ticket lifecycle, approvals, and review gates.
- Integrations own only their external capability and provider-specific mechanics.
- No integration may bypass the Senior Reviewer or configured approval gates.
- Provider-specific implementation must remain outside core role contracts.
- Integration absence must be represented explicitly rather than simulated as success.

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

This section supersedes the original pre-release milestone status and defines the modernization work after release `0.1.0`.

## M0–M13 — Release 0.1.0 Baseline

Status: **COMPLETE**

The original M0–M13 milestones are treated as the completed `0.1.0` baseline.

Key baseline results:

```text
- Core roles and contracts implemented
- Sequential ticket workflow implemented
- Manual approval default preserved
- OpenCode provider implemented
- GitHub Issues provider implemented as optional
- Initial Spec Kit adapter implemented
- Initial delegate-skills adapter implemented as optional
- Configuration validation implemented
- Project discovery implemented
- Execution/review safety implemented
- End-to-end tests completed
- Documentation and release artifacts completed
- Release 0.1.0 prepared/released in repository state
```

Important baseline limitations retained for modernization:

```text
- Spec Kit integration model must be updated to the current upstream interface
- P-006 (Spec Kit usage documentation) remains unresolved until the new integration is completed
- Historical delegate-skills adapter assumes an executable contract that no longer matches current upstream
- Real role orchestration still needs to be completed beyond provider/role selection plumbing
```

## M14 — Integration Foundation

Status: **NEXT**

Purpose: introduce only the minimum reusable integration foundation required by the real project, then validate it immediately against the existing OpenCode path before expanding it.

Design rules:

```text
- Capability-based, not feature-maximal
- detect is required
- version/install/configure are optional capabilities
- status is derived by the framework, not trusted as an external source of truth
- setup is confirmation-based and non-destructive
- stored configuration is desired state + last-known state, not proof of reality
- every abstraction must have a real usage test before the next abstraction is added
```

### I-001 — Define Minimal Integration Contract

```text
Required capability:
- detect()

Optional capabilities:
- version()
- install()
- configure()
- healthCheck() when genuinely needed
```

Acceptance criteria:

```text
- Core contract does not require install/configure/version on every integration
- Contract represents capabilities explicitly
- Provider-specific details are excluded from the core contract
- Existing OpenCode integration can remain compatible or be adapted without unnecessary redesign
- Tests cover required and optional capability combinations
```

### I-002 — Add Minimal Integration Registry

Acceptance criteria:

```text
- Registry owns the supported integration descriptors
- Integrations are registered in one place
- Registry does not perform provider-specific work itself
- Adding a second integration does not require changing Coordinator workflow logic
- No speculative plugin framework is introduced
```

### I-003 — Add Framework-Owned Detection and State Resolution

Define the separation:

```text
Integration detect()
        |
        v
Detection Result
        |
        +----> User Configuration / Desired State
        |
        v
Framework Integration State
```

Minimum state must distinguish at least:

```text
detected
installed/available when this can be established
enabled
ready
lastKnownState
```

Acceptance criteria:

```text
- Fresh detection is possible at runtime
- Stored state cannot override a failed fresh detection
- enabled is independent from detected/installed
- ready is derived from actual checks
- unknown state is represented explicitly
```

### I-004 — Validate the Foundation with OpenCode

This is the M14 proof gate before introducing the new optional integrations.

Acceptance criteria:

```text
- Existing OpenCode provider works through the new integration model where applicable
- No regression in existing CLI/runtime behavior
- Existing tests remain green
- At least one integration status output is based on fresh detection
- No unnecessary new dependency is introduced
```

M14 exit gate:

```text
Contract -> Registry -> Detection/State -> Real OpenCode proof
```

Only after this gate passes should M15 begin.

## M15 — Modern Spec Kit Integration

Status: **PENDING**

Purpose: replace the historical Spec Kit adapter assumptions with a current, project-safe integration.

Current upstream reference points used for this plan:

```text
- specify CLI
- specify init / --integration
- integration management commands
- project-local Spec Kit assets and agent integration
- specification / clarification / planning / tasks / analysis workflow
```

The framework must not blindly delegate the full `/speckit-implement` flow because AI Team Framework owns ticket-by-ticket implementation, review, and approval.

### S-001 — Audit Existing Spec Kit Adapter

```text
Classify each existing piece as:
- keep
- adapt
- remove
- replace
```

Must explicitly resolve P-006.

### S-002 — Implement Spec Kit Detection

Detection must establish, where possible:

```text
- specify availability
- installed version
- target project initialized state
- expected agent integration state
- compatibility/readiness
```

No successful detection may be inferred only from the config file.

### S-003 — Add Optional Installation Capability

The integration may expose installation through the Framework when the environment supports the upstream installation path.

Rules:

```text
Detect -> Explain -> Ask for confirmation -> Install -> Verify
```

No automatic installation merely because `ai-team setup` was executed.

### S-004 — Handle Existing Projects Safely

The adapter must support existing projects without assuming a clean directory.

Any initialization/merge behavior must be explicit, documented, and non-destructive.

### S-005 — Map Spec Kit Outputs into AI Team Artifacts

```text
Spec Kit specification / plan / tasks
              |
              v
AI Team mapping layer
              |
              v
AI Team tickets
              |
              v
Implementer -> Senior Reviewer -> Approval
```

### S-006 — Spec Kit Failure and Fallback Behavior

Cover:

```text
not installed
not enabled
wrong integration
unsupported environment
command failure
invalid project state
```

Fallback must preserve the core workflow where possible.

### S-007 — Spec Kit Usage Documentation

Update:

```text
provider/integration documentation
configuration documentation
troubleshooting
existing-project guidance
```

M15 exit gate:

```text
Spec Kit is optional, detected correctly, installable only with confirmation,
usable through the Framework, and cannot bypass the Framework workflow.
```

## M16 — Modern delegate-skills Integration

Status: **PENDING**

Purpose: replace the old executable-based delegate integration with an adapter for the current Skills/relay model.

### D-101 — Audit Historical Delegate Adapter

Review all existing D-001–D-007 behavior and explicitly identify obsolete assumptions.

The historical assumption:

```text
spawn("delegate-skills", ...)
```

must not survive merely for backward compatibility unless current upstream evidence proves the executable contract is still supported.

### D-102 — Detect the Current Skills Installation

Detection should establish, where possible:

```text
- delegate skill package available
- requested delegate skill available
- relay script available
- required implementer CLI available
- implementer authentication/readiness when observable safely
```

### D-103 — Optional Installation Capability

Installation may be exposed through Framework setup where the environment can safely support the upstream Skills installation flow.

Rules remain:

```text
Detect -> Explain -> Confirm -> Install -> Verify
```

### D-104 — Delegate Provider v2

The provider must adapt the current delegate skill/relay behavior into the framework's existing `DelegateProvider` contract without leaking relay arguments or skill paths into role contracts.

### D-105 — Result Mapping

Current external result information may include status, exit information, final report, touched files, and session metadata when available.

Map only what the framework genuinely needs into `DelegateResult`; do not duplicate the upstream result schema unnecessarily.

### D-106 — Workflow and Commit Boundary

The delegate path must preserve:

```text
Ticket
 -> Delegation
 -> Implementation result
 -> Senior Reviewer
 -> Approval
 -> Next ticket
```

Delegation must not become a second workflow engine.

### D-107 — Safe Failure/Fallback

Cover:

```text
not installed
not enabled
missing implementer
missing model/configuration
relay failure
external CLI failure
```

M16 exit gate:

```text
Delegate Skills is optional and usable internally without requiring the user
or role prompts to know its installation or relay implementation details.
```

## M17 — Setup and Status UX

Status: **PENDING**

Purpose: give the user one framework-level interface for dependency/integration discovery and setup.

### I-201 — Add `ai-team setup`

Expected behavior:

```text
Detect
  -> Show current state
  -> Explain optional actions
  -> Ask for explicit confirmation
  -> Install/configure only selected integrations
  -> Verify
  -> Persist desired + last-known state
```

Setup must not silently install or modify external tools.

### I-202 — Add `ai-team status`

Status should report framework-derived state, for example:

```text
Integration      Detected   Enabled   Ready
--------------------------------------------
OpenCode            yes        yes      yes
Spec Kit             yes         no      yes
Delegate Skills      no         no       no
GitHub               yes        yes      no
```

The exact terminal presentation is an implementation detail; the semantic fields are the source of truth.

### I-203 — Configuration Model for Integrations

Configuration must express:

```yaml
integrations:
  <id>:
    enabled: false
    last_known:
      detected: false
      version: null
      ready: false
```

The concrete field names may change during implementation if the final schema is simpler, but the separation must remain:

```text
desired configuration != observed runtime state
```

### I-204 — Idempotent and Non-Destructive Setup

Repeated setup/status runs must not:

```text
- duplicate configuration
- overwrite unrelated project files
- reinstall working integrations unnecessarily
- erase user changes
```

### I-205 — Integration Selection and Confirmation

The setup flow must make clear which action is about to change the user's environment.

Default policy:

```text
No installation/configuration without explicit confirmation.
```

M17 exit gate:

```text
User can discover, enable, install, and verify integrations from AI Team
Framework without needing to learn the underlying external commands.
```

## M18 — Real Coordinator and Role Runtime

Status: **PENDING**

Purpose: complete the product workflow so integrations support the product rather than becoming the product.

### R-101 — Coordinator Runtime

### R-102 — Project Manager Runtime

### R-103 — Technical Lead Runtime

### R-104 — Implementer Runtime

### R-105 — Senior Reviewer Runtime

### R-106 — Provider/Integration Selection

Selection must consider:

```text
configured intent
capability availability
readiness
workflow rules
```

### R-107 — Workflow Enforcement

External providers cannot directly mutate workflow states outside approved transition rules.

M18 exit gate:

```text
User -> Coordinator -> PM/TL -> Ticket -> Implementer -> Senior Reviewer
      -> Technical/PM checks -> Approval -> Next Ticket
```

## M19 — Integration End-to-End Validation

Status: **PENDING**

M19 is intentionally test-heavy rather than abstraction-heavy.

### E-101 — Clean Environment

Test without optional integrations.

### E-102 — Setup and Status

Test:

```text
not installed
installed
installed + disabled
enabled + missing
installed + broken
```

### E-103 — Existing Project

Use a real existing-project fixture and verify non-destructive behavior.

### E-104 — Spec Kit Flow

```text
User request
 -> Spec Kit capability
 -> Framework artifacts
 -> Tickets
 -> Implementation/review workflow
```

### E-105 — Delegate Flow

```text
Ticket
 -> Delegate capability
 -> Implementation result
 -> Senior Reviewer
```

### E-106 — No-Integration Flow

Core workflows must remain usable when an optional integration is unavailable and the requested task does not require it.

### E-107 — Regression Matrix

Existing `0.1.0` tests must remain green after modernization, with new integration-state and runtime tests added as needed.

M19 exit gate:

```text
The new integrations are proved through real end-to-end scenarios,
not only interface/unit tests.
```

## M20 — npm Distribution

Status: **PENDING**

Purpose: publish the framework publicly on npm with a clean, reproducible release path.

### N-101 — Package Audit

Verify:

```text
package name
version
bin
files
runtime dependencies
README
LICENSE
build output
```

### N-102 — Clean Consumer Installation

Verify both:

```bash
npm install -g <package>
```

and:

```bash
npm install <package>
```

with real consumer commands.

### N-103 — npm Package Contents

Use:

```bash
npm pack --dry-run
```

and verify no source-only/test-only/internal files are accidentally published.

### N-104 — Public Package Publish

The package is intended to be public/free to install. Publishing itself is not part of the runtime dependency model.

### N-105 — Automated Release Publishing

Prefer a secure CI publishing path such as npm Trusted Publishing when the repository/registry setup supports it.

CI may use a newer Node/npm toolchain than the user's local runtime; that is acceptable because publishing environment requirements are separate from package runtime requirements.

M20 exit gate:

```text
A fresh user can install the published package and run `ai-team --help`
without cloning the repository.
```

## M21 — Release 0.2.0

Status: **PENDING**

### REL-101 — Documentation Refresh

Update:

```text
README
quick start
installation
configuration
providers
integrations
workflow
troubleshooting
examples
```

### REL-102 — Release Checklist

### REL-103 — Version and Tag

```text
v0.2.0
```

### REL-104 — GitHub Release

### REL-105 — npm Release

```text
<package-name>@0.2.0
```

---

# 15. Dependencies

The post-`0.1.0` dependency chain is deliberately staged to avoid speculative architecture:

```text
M14
 |
 +--> I-001 Integration Contract
 |       |
 |       v
 +--> I-002 Registry
 |       |
 |       v
 +--> I-003 Detection / State
 |       |
 |       v
 +--> I-004 OpenCode Proof Gate
 |
 v
M15 Spec Kit
 |
 v
M16 delegate-skills
 |
 v
M17 setup/status UX
 |
 v
M18 real role runtime
 |
 v
M19 end-to-end validation
 |
 v
M20 npm distribution
 |
 v
M21 release 0.2.0
```

Important planning rule:

```text
Do not complete the abstraction for its own sake.
Each milestone must prove the new layer through a real project path before the next
layer becomes mandatory.
```

The original one-ticket-at-a-time implementation rule remains unchanged.

---

# 16. MVP Scope for Release 0.1.0

The `0.1.0` MVP scope remains historically fixed by the completed baseline. The modernization plan must not silently redefine what `0.1.0` meant.

## Included in 0.1.0 Baseline

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
- initial Spec Kit adapter
- optional delegate-skills adapter
- tests
- beginner-oriented documentation
- Laravel + React example
- project-agnostic behavior

## Explicitly Out of Scope for 0.1.0

- modernized external integration management
- framework-level `ai-team setup`
- framework-level `ai-team status`
- fully autonomous integration installation
- complete current-upstream Spec Kit workflow integration
- complete current-upstream delegate-skills integration
- web dashboard
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

# 17. Definition of Done for Release 0.2.0

Release `0.2.0` is complete when a user can:

1. Install the framework from npm.
2. Initialize it in a new or existing project without destructive setup behavior.
3. Run the Coordinator.
4. Use the existing role interfaces without learning provider-specific commands.
5. Run `ai-team status` and understand which integrations are detected, enabled, and ready.
6. Run `ai-team setup` and explicitly approve any environment-changing installation/configuration step.
7. Use Spec Kit through the framework when enabled.
8. Use delegate-skills through the framework when enabled and supported.
9. Continue to use the core workflow when optional integrations are unavailable and not required.
10. Maintain the ticket-by-ticket Implementer -> Senior Reviewer -> approval workflow.
11. Preserve existing-project files and conventions.
12. Install the published npm package in a fresh consumer project and run the CLI successfully.

---

# 18. Master Agent Prompt

The following prompt is the baseline instruction for AI agents working on the repository after the `0.1.0` baseline.

```text
You are working on the AI Team Framework repository.

Your responsibility is limited to the currently assigned ticket.

Before making any change:

1. Read the repository instructions.
2. Read the relevant AI Team specification and current project state.
3. Read the assigned ticket and all acceptance criteria.
4. Inspect only the project files required to understand the ticket.
5. Do not assume that an external integration, provider, CLI, skill, or authentication method exists.
6. Preserve existing conventions.
7. Do not modify files outside the ticket scope unless the ticket explicitly requires it.
8. Do not introduce unnecessary dependencies.
9. Do not invent missing requirements.
10. Stop and request user input when a requirement is ambiguous or when an environment-changing action requires confirmation.

Execution rules:

- Work on one ticket at a time.
- Keep implementation simple and maintainable.
- Prefer the smallest abstraction that solves the current ticket.
- Keep provider/integration-specific logic isolated.
- The core framework owns workflow state, tickets, review gates, and approvals.
- External tools provide capabilities; they do not own the workflow.
- `detect()` is the minimum integration capability; install/configure/version are optional.
- Runtime detection is stronger than stored configuration state.
- Do not install or configure external tools without explicit user confirmation through the approved setup flow.
- Preserve non-destructive behavior for existing projects.
- Add/update tests when required.
- Run relevant validation commands.
- Fix failures related to the current ticket only.
- Do not mark the ticket complete unless all acceptance criteria are satisfied.
- Do not move to another ticket unless the workflow explicitly allows it.

When integrating Spec Kit or delegate-skills:

- Follow the current upstream interface verified for the ticket.
- Do not preserve obsolete executable assumptions without evidence.
- Hide upstream command/skill/relay mechanics behind the integration adapter.
- Do not bypass the Senior Reviewer or configured approval gates.

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
| M0–M13 | **COMPLETE** | `0.1.0` baseline completed; modernization starts after this baseline |
| M14 Integration Foundation | **NEXT** | Minimal capability contract, registry, detection/state, then OpenCode proof gate |
| M15 Modern Spec Kit | PENDING | Replace historical adapter assumptions and resolve P-006 |
| M16 Modern delegate-skills | PENDING | Replace historical executable-based assumption with current Skills/relay adapter |
| M17 Setup / Status UX | PENDING | Add `ai-team setup` and `ai-team status` with explicit confirmation |
| M18 Real Role Runtime | PENDING | Complete actual Coordinator/PM/TL/Implementer/Senior Reviewer orchestration |
| M19 Integration E2E | PENDING | Real integration and regression validation |
| M20 npm Distribution | PENDING | Publish public package and verify clean consumer installation |
| M21 Release 0.2.0 | PENDING | Final documentation, tag, GitHub Release, npm release |

### Baseline Notes

```text
- 581/581 tests were passing at the 0.1.0 baseline validation point.
- That result does not prove the new post-0.1.0 integrations are complete.
- Historical delegate-skills implementation must be treated as obsolete until replaced by the current integration model.
- Historical P-006 Spec Kit usage documentation remains open until M15 closes it.
```

---

# 20. Next Steps

The next work item is:

```text
M14 / I-001 — Define Minimal Integration Contract
```

I-001 must answer only the minimum contract questions required to support the current project:

```text
- What is required for every integration?
- Which capabilities are optional?
- How are capabilities advertised?
- What result does detect() return?
- How does the registry represent an integration without coupling to its implementation?
```

I-001 must not implement Spec Kit, delegate-skills, `ai-team setup`, or `ai-team status` yet.

The immediate sequence is:

```text
I-001
  ↓
I-002
  ↓
I-003
  ↓
I-004 OpenCode proof gate
  ↓
M15
```

---

# 21. Change Control

This document is the current source of truth for the project plan.

When a new decision is made:

1. Update the relevant section.
2. Update the affected milestone/ticket status.
3. Record the decision in the project documentation when it changes a stable contract.
4. Do not silently change the scope.
5. Prefer extending the smallest existing abstraction over introducing a new framework layer.
6. Require a real usage test before expanding an abstraction that is not yet proven by the product.

The following decisions are now recorded as approved plan constraints:

```text
1. Spec Kit, delegate-skills, and GitHub are optional integrations/capabilities, not core dependencies.
2. The core framework owns workflow state, tickets, reviews, and approvals.
3. Integration contracts are capability-based.
4. detect() is required; install/configure/version are optional capabilities.
5. Integration status is derived by the Framework from detection + configuration; stored state is not proof of current reality.
6. Setup is confirmation-based and non-destructive by default.
7. Users should interact with AI Team Framework commands rather than provider-specific commands wherever the Framework can safely encapsulate them.
8. Abstractions must be justified by real usage and proven incrementally.
9. Optional integration failure must not break unrelated core workflows.
10. The modernization target is release 0.2.0 and npm distribution.
```

---

# 22. Current Verified External References

These references were used to align the modernization plan with the current upstream integration models:

```text
Spec Kit
https://github.com/github/spec-kit
https://github.com/github/spec-kit/blob/main/docs/installation.md
https://github.com/github/spec-kit/blob/main/docs/reference/core.md
https://github.com/github/spec-kit/blob/main/docs/reference/integrations.md

Delegate Skills
https://github.com/amElnagdy/delegate-skills
https://github.com/amelnagdy/delegate-skills/blob/master/skills/opencode-delegate/SKILL.md
```

The references establish the upstream command/skill shapes; implementation tickets must still verify the exact behavior against the version/environment available during implementation rather than assuming that a future upstream release is identical.