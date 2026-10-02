# AI Team Framework — Post-0.2.0 Implementation Roadmap

## Current Baseline

Current release:

```text
@moassaad/ai-team-framework@0.2.0
```

Current strengths:

```text
Integration foundation
Spec Kit integration
delegate-skills integration
GitHub Issues integration
Coordinator
Implementer
Senior Reviewer
Technical Lead
PM / User Testing
Final Coordinator Approval
Sprint orchestration
State synchronization
CLI
npm distribution
```

The next objective is to add the missing **AI Team Operating Model** without redesigning the existing runtime.

---

# Target Architecture

The final intended architecture is:

```text
                             USER
                               │
                               ▼
                         COORDINATOR
                               │
                ┌──────────────┼──────────────┐
                │              │              │
             FAST PATH     STANDARD PATH    FULL PATH
                │              │              │
                ▼              ▼              ▼
           IMPLEMENTER       TL / PM          PM
                │              │               │
           SENIOR REVIEW       │               ▼
                │              │              TL
                ▼              ▼               │
               DONE         IMPLEMENTER       ▼
                                  │         SPRINTS
                             SENIOR REVIEW      │
                                  │             ▼
                                  └───────► IMPLEMENTER
                                                │
                                           SENIOR REVIEW
                                                │
                                           ┌────┴────┐
                                           │         │
                                        Rework    Accept
                                           │         │
                                           └────↺    ▼
                                                   TL
                                                    │
                                                   ▼
                                                   PM
                                                    │
                                                    ▼
                                             FINAL APPROVAL
                                                    │
                                                    ▼
                                                   DONE
```

Every role is independently executable:

```text
Coordinator
Project Manager
Technical Lead
Implementer
Senior Reviewer
```

Each role can operate in:

```text
Independent Mode
Manual Handoff Mode
Delegated Mode
```

The delegation mechanism is optional.

---

# Core Principles for M22+

## Principle 1 — Roles are independent

Every role must be executable without requiring the next role.

Example:

```text
User → Technical Lead
```

must work.

Also:

```text
User → Implementer
```

must work.

The complete team is composition, not dependency.

---

## Principle 2 — Handoff is a first-class contract

Every role produces a canonical handoff.

Conceptually:

```text
FROM
TO
OBJECTIVE
CONTEXT
INPUT
REQUIREMENTS
ACCEPTANCE CRITERIA
CONSTRAINTS
OUTPUT
NEXT ACTION
```

The exact contract will be defined in M22.

The same handoff must work for:

```text
Manual
Delegate
Stored artifact
```

---

## Principle 3 — delegate-skills is transport, not architecture

```text
Role
 ↓
Handoff
 ↓
┌──────────────┬──────────────┐
│              │              │
Manual       Delegate       Future
handoff      transport      transport
```

Removing `delegate-skills` must never remove a role or workflow capability.

---

## Principle 4 — No hidden autonomy

The framework must never silently decide:

```text
"This is simple, so I skipped PM."
```

Instead:

```text
Recommended mode: FAST
Reason: small scoped change
```

then explicit confirmation when the policy requires it.

---

## Principle 5 — Token efficiency

The system should support:

```text
FAST
STANDARD
FULL
```

without pretending that every task requires a full software team.

Examples:

```text
typo / tiny bug
→ FAST
```

```text
small feature
→ STANDARD
```

```text
authentication / payments / major architecture
→ FULL
```

The exact routing rules are defined later and must remain explicit.

---

# M22 — Team Operating Model Foundation

## Sprint Goal

Create the common contracts that allow every role to work independently and exchange structured handoffs.

### M22 / T-001 — Role Operating Model

Define the responsibilities and boundaries of:

```text
Coordinator
Project Manager
Technical Lead
Implementer
Senior Reviewer
```

Deliver:

* role responsibility contract
* inputs
* outputs
* authority boundaries
* allowed handoffs
* prohibited assumptions

Do not change runtime orchestration yet.

---

### M22 / T-002 — Agent Identity Contract

Define how an agent knows:

```text
who am I?
what is my role?
what are my responsibilities?
what can I do?
what can I not do?
who can I hand off to?
```

Reuse existing role contracts.

No new role manager.

No hidden role inference.

---

### M22 / T-003 — Canonical Handoff Contract

Create the generic handoff contract shared by all roles.

It must support:

```text
Coordinator → PM
PM → TL
TL → Implementer
Implementer → Senior Reviewer
Senior Reviewer → Implementer
TL → PM
PM → Coordinator
Coordinator → User
```

The contract must be provider-agnostic.

---

### M22 / T-004 — Handoff Validation and Rendering

Implement:

```text
validateHandoff(...)
renderHandoff(...)
```

Requirements:

* deterministic
* bounded
* immutable
* human-readable
* copy/paste friendly
* no provider-specific syntax

---

### M22 / T-005 — Independent Role Execution Contract

Make each role independently executable through a common generic contract.

The caller must be able to invoke:

```text
Coordinator
PM
TL
Implementer
Senior Reviewer
```

without constructing the whole team.

No delegation required.

---

# M23 — Planning and User Conversation

## Sprint Goal

Add the missing planning layer:

```text
User
 ↓
Coordinator
 ↓
PM
 ↓
TL
```

without touching the existing execution workflow.

### M23 / T-006 — Coordinator Planning Session

Add a planning-oriented Coordinator operation.

Responsibilities:

```text
Understand request
Clarify scope
Identify objectives
Produce planning handoff
```

It must not implement code.

---

### M23 / T-007 — Project Manager Planning

PM receives the Coordinator handoff and produces:

```text
Requirements
Scope
Acceptance Criteria
Business Rules
Out of Scope
Questions
```

No technical implementation.

---

### M23 / T-008 — Technical Lead Planning

TL receives the PM output and produces:

```text
Architecture
Technical Constraints
Dependencies
Technical Risks
Implementation Strategy
```

No code execution.

---

### M23 / T-009 — Planning Artifact Model

Define the smallest model representing:

```text
Feature
Requirements
Acceptance Criteria
Architecture
Sprints
Tasks
Dependencies
```

Keep it generic.

Do not bind it directly to GitHub.

---

### M23 / T-010 — Explicit Planning Approval

Introduce the explicit transition:

```text
Planning
 ↓
PM approval
 ↓
TL approval
 ↓
Ready for task creation
```

No automatic approval from report text.

No execution yet.

---

# M24 — Sprint and Task Generation

## Sprint Goal

Turn the approved plan into executable work.

### M24 / T-011 — Sprint Model

Represent:

```text
Sprint
Goal
Scope
Tasks
Dependencies
Acceptance Criteria
```

---

### M24 / T-012 — Task Model

Define executable task information:

```text
Task ID
Title
Description
Requirements
Acceptance Criteria
Dependencies
Specialty
Sprint
```

No provider-specific fields.

---

### M24 / T-013 — TL Task Decomposition

TL transforms the technical plan into:

```text
Sprint 1
  T-001
  T-002
  T-003

Sprint 2
  T-004
  T-005
```

Requirements:

* dependencies explicit
* tasks small enough to execute
* no hidden tasks
* no implementation yet

---

### M24 / T-014 — Plan-to-Ticket Mapper

Map generic tasks into the existing:

```text
IssueRequest
CoordinatorTicket
```

Reuse `IssueProvider`.

Do not redesign IssueProvider unless a concrete limitation requires it.

---

### M24 / T-015 — Task Persistence and Readback

Create the task-storage flow:

```text
TL plan
 ↓
Task creation
 ↓
IssueProvider
 ↓
TicketSource
 ↓
Coordinator execution
```

Prove that generated tasks can be read back without losing:

* requirements
* acceptance criteria
* dependencies
* sprint identity
* task identity

---

# M25 — Independent Roles and Manual Handoff

## Sprint Goal

Make the individual agents practically usable by humans without requiring delegate-skills.

### M25 / T-016 — Direct Role Execution CLI

Expose independent role invocation.

Conceptually:

```bash
ai-team role project-manager
ai-team role technical-lead
ai-team role implementer
ai-team role senior-reviewer
```

Use the existing CLI architecture where possible.

Do not break `run` or `sprint`.

---

### M25 / T-017 — Copy-Ready Handoff Output

When delegation is unavailable:

```text
Next role: Technical Lead

=== AI TEAM HANDOFF ===
...
```

The output must be directly copyable into another agent.

---

### M25 / T-018 — Manual Handoff Resume

Allow the user to supply a previous handoff to the next role without requiring a delegation provider.

Example:

```text
PM
 ↓
copy handoff
 ↓
TL
 ↓
copy handoff
 ↓
Implementer
```

---

### M25 / T-019 — Role-Specific Context Isolation

Ensure each role receives only its intended context.

Example:

```text
Implementer
```

must not accidentally receive unrelated:

```text
Coordinator planning history
Provider credentials
other agent internals
```

---

### M25 / T-020 — Manual Full-Team Flow

Prove the complete feature lifecycle manually:

```text
Coordinator
→ PM
→ TL
→ Implementer
→ Senior Reviewer
→ TL
→ PM
→ Final Approval
```

Every transition uses the canonical handoff.

---

# M26 — Optional Agent-to-Agent Delegation

## Sprint Goal

Make delegate-skills an optional transport for the exact same handoffs.

### M26 / T-021 — Generic Handoff Dispatcher

Create the smallest abstraction that decides:

```text
Manual
OR
Delegate
```

It must not contain role logic.

---

### M26 / T-022 — delegate-skills Handoff Adapter

Adapt:

```text
Canonical Handoff
```

to the existing delegate-skills provider.

Do not redesign delegate-skills.

Do not expose delegate-specific semantics to roles.

---

### M26 / T-023 — Manual / Delegate Parity

Given the same role input:

```text
Manual output
≈
Delegated input
```

The business/technical content must remain equivalent.

Only transport differs.

---

### M26 / T-024 — Delegation Capability Detection

Determine:

```text
delegate available
delegate unavailable
```

using the existing integration detection.

No automatic installation during normal workflow execution.

---

### M26 / T-025 — Delegate Failure Fallback

When delegation is optional:

```text
Delegate failure
 ↓
Manual handoff available
```

without silently changing the workflow decision.

Required delegation must fail explicitly.

No hidden retries.

---

# M27 — Fast / Standard / Full Work Modes

## Sprint Goal

Make the team composable and token-efficient.

### M27 / T-026 — Work Mode Contract

Define:

```text
FAST
STANDARD
FULL
```

with explicit responsibilities for each.

---

### M27 / T-027 — FAST Path

Target:

```text
small bug
small validation fix
tiny refactor
simple test fix
minor UI change
```

Flow:

```text
User
 ↓
Implementer
 ↓
Senior Reviewer
 ↓
Done
```

No PM/TL unless explicitly requested.

---

### M27 / T-028 — STANDARD Path

Flow:

```text
User
 ↓
Coordinator
 ↓
TL
 ↓
Implementer
 ↓
Senior Reviewer
 ↓
Done
```

Use for moderate technical features.

---

### M27 / T-029 — FULL Path

Flow:

```text
User
 ↓
Coordinator
 ↓
PM
 ↓
TL
 ↓
Sprints / Tasks
 ↓
Implementer
 ↓
Senior Reviewer
 ↓
TL
 ↓
PM
 ↓
Final Approval
 ↓
Done
```

---

### M27 / T-030 — Mode Recommendation

Allow the Coordinator to produce:

```text
Recommended mode:
FAST

Reason:
Single scoped change, no architectural impact.

Required confirmation:
YES
```

No hidden bypass of roles.

---

### M27 / T-031 — Mode Guardrails

Prevent invalid combinations such as:

```text
FAST + mandatory PM review
FULL + missing TL
```

Validate the selected mode before execution.

---

# M28 — Cross-Role Rework and Re-entry

## Sprint Goal

Complete the feedback loops between roles while retaining caller-controlled re-entry.

### M28 / T-032 — Correction Reference to Actionable Work

Define how:

```text
TL corrections-required
```

becomes explicit actionable work without parsing the TL report.

Do not silently convert references.

---

### M28 / T-033 — TL → Implementer Rework Handoff

Create the handoff:

```text
Technical Lead
 ↓
Correction Handoff
 ↓
Implementer
```

with:

```text
affected tasks
requirements
verbatim correction notes
acceptance criteria
```

---

### M28 / T-034 — PM → TL Re-entry

When PM says:

```text
changes-required
```

produce an explicit re-entry handoff:

```text
PM
 ↓
TL
```

No automatic loop.

---

### M28 / T-035 — Final Approval Re-entry

When final approval is rejected:

```text
Final Approval
 ↓
changes-required
```

return explicit next action without rerunning anything automatically.

---

### M28 / T-036 — Re-entry Request Contract

Create a deterministic explicit re-entry request such as:

```text
reenter:
  role
  work
  reason
  handoff
```

The caller decides whether to execute it.

No recursive orchestration.

---

# M29 — Full AI Team Orchestration

## Sprint Goal

Connect planning + execution + handoffs + modes into one coherent product.

### M29 / T-037 — New Project Workflow

Support:

```text
Create Project
 ↓
AI Team setup
 ↓
Coordinator
 ↓
PM
 ↓
TL
 ↓
Sprint / Tasks
 ↓
Execution
```

---

### M29 / T-038 — Existing Project Workflow

Support:

```text
Existing Repository
 ↓
Discovery
 ↓
Coordinator
 ↓
PM
 ↓
TL
 ↓
Task Planning
 ↓
Execution
```

Do not assume greenfield architecture.

---

### M29 / T-039 — FULL Feature Lifecycle

Verify the entire lifecycle:

```text
User
 ↓
Coordinator
 ↓
PM
 ↓
TL
 ↓
Sprint
 ↓
Tasks
 ↓
Implementer
 ↓
Senior Reviewer
 ↺
 ↓
TL
 ↺
 ↓
PM
 ↓
Final Approval
 ↓
Sync
```

---

### M29 / T-040 — STANDARD Feature Lifecycle

Verify the lighter path:

```text
Coordinator
 ↓
TL
 ↓
Implementer
 ↓
Senior Reviewer
 ↓
Done
```

---

### M29 / T-041 — FAST Bug Lifecycle

Verify:

```text
User
 ↓
Implementer
 ↓
Senior Reviewer
 ↓
Done
```

without unnecessary PM/TL execution.

---

### M29 / T-042 — Manual / Delegate End-to-End Parity

Verify that the same feature works through:

```text
Manual Handoffs
```

and:

```text
delegate-skills
```

with equivalent workflow semantics.

---

### M29 / T-043 — User Checkpoints

Define where the human may:

```text
approve plan
reject plan
change requirements
select work mode
approve re-entry
approve sensitive changes
```

The user remains the authority.

---

# M30 — Onboarding, Documentation and Productization

## Sprint Goal

Only after the complete team model is implemented do we update the user experience/documentation.

### M30 / T-044 — Project Setup Workflow

Finalize:

```bash
npm install -g @moassaad/ai-team-framework
cd project
ai-team status
```

and the setup path for required integrations.

---

### M30 / T-045 — New Project Quick Start

Document:

```text
New Project
 ↓
Install
 ↓
Setup
 ↓
Configure roles
 ↓
Start Coordinator
 ↓
Plan
 ↓
Execute
```

---

### M30 / T-046 — Existing Project Quick Start

Document:

```text
Existing Project
 ↓
Install
 ↓
Discover
 ↓
Review project rules
 ↓
Create work
 ↓
Select mode
 ↓
Execute
```

---

### M30 / T-047 — Individual Role Usage Guide

Document:

```text
Coordinator
PM
TL
Implementer
Senior Reviewer
```

individually.

Include manual handoff usage.

---

### M30 / T-048 — Delegate Mode Guide

Document:

```text
with delegate-skills
without delegate-skills
```

with identical role semantics.

---

### M30 / T-049 — Final Product E2E Verification

Run the final matrix:

| Mode     | Delegate | Project  |
| -------- | -------- | -------- |
| Fast     | ❌        | Existing |
| Fast     | ✅        | Existing |
| Standard | ❌        | Existing |
| Standard | ✅        | Existing |
| Full     | ❌        | Existing |
| Full     | ✅        | Existing |
| Full     | ❌        | New      |
| Full     | ✅        | New      |

---

### M30 / T-050 — Release 0.3.0 Preparation

Only after all previous work is green:

```text
Version
Artifact
npm
CLI
Documentation
GitHub
CI
```

Prepare the next public release.

Actual release/publish is a separate final release operation, following the same discipline used for `0.2.0`.

---

# Execution Rules for All Future Tickets

Every ticket follows the same process used in M14–M21:

```text
Ticket
 ↓
Implementation
 ↓
Tests
 ↓
Build
 ↓
Lint
 ↓
Diff check
 ↓
Completion report
 ↓
Review
 ↓
Commit
 ↓
Next ticket
```

The completion report must always include:

```text
Implementation summary
Files created/modified/deleted
Tests
Build/lint/diff
Architecture boundaries
Provider behavior
Retry behavior
Mutation behavior
Remaining risks
Plan adjustments
Next workflow action
```

---

# Strict Architectural Constraints

Throughout M22–M30:

```text
No hidden retries
No hidden re-entry
No hidden approval
No automatic role inference
No provider-specific core runtime
No delegate-skills dependency
No GitHub dependency in generic runtime
No direct state mutation
No parallel execution by default
No giant autonomous agent
No role manager unless proven necessary
No duplicate contracts
No second configuration system
No unnecessary abstractions
```

The framework must remain:

```text
Explicit
Composable
Provider-agnostic
Human-controlled
Token-conscious
Testable
Deterministic
```

---

# Release Direction

Current:

```text
0.2.0
```

Target after M22–M30:

```text
0.3.0
```

The intended conceptual transition is:

```text
0.2.0

Ticket Workflow Framework
          ↓
      0.3.0

Composable AI Team Framework
```

The important difference is not simply adding more agents.

It is adding:

```text
Roles
+
Handoffs
+
Planning
+
Task Creation
+
Independent Execution
+
Manual Delegation
+
Optional Agent Delegation
+
Work Modes
+
Explicit Re-entry
```

while preserving the existing execution/review engine.

---

# Sprint Summary

| Sprint    | Focus                                       |        Tickets |
| --------- | ------------------------------------------- | -------------: |
| M22       | Team Operating Model Foundation             |              5 |
| M23       | Planning & User Conversation                |              5 |
| M24       | Sprint & Task Generation                    |              5 |
| M25       | Independent Roles & Manual Handoff          |              5 |
| M26       | Optional Agent Delegation                   |              5 |
| M27       | FAST / STANDARD / FULL                      |              6 |
| M28       | Cross-Role Rework & Re-entry                |              5 |
| M29       | Full AI Team Orchestration                  |              7 |
| M30       | Onboarding / Documentation / Productization |              7 |
| **Total** |                                             | **50 tickets** |

---

# Recommended Implementation Order

The first tickets are deliberately foundational:

```text
M22
 ↓
Role Identity
 ↓
Handoff Contract
 ↓
Independent Role Execution
 ↓
M23
 ↓
Planning
 ↓
M24
 ↓
Tasks
 ↓
M25
 ↓
Manual Roles
 ↓
M26
 ↓
Delegate Transport
 ↓
M27
 ↓
Work Modes
 ↓
M28
 ↓
Re-entry
 ↓
M29
 ↓
Full Team
 ↓
M30
 ↓
Documentation
 ↓
0.3.0
```

We should NOT start M23 before M22 is stable, because planning outputs need the canonical handoff contract.

We should NOT start M26 before M25, because delegate mode must transport an already-valid manual handoff rather than define its own semantics.

We should NOT start M27 before the independent role paths are stable.

We should NOT write the final Quick Start until M29 is verified.
