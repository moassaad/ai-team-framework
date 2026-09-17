# Release 0.1.0 — Definition of Done

Derived from plan §11, §16, §17, §2.6. The plan is authoritative.

## 1. Ticket Definition of Done

A ticket is complete only when ALL of the following hold (plan §11, §12,
AGENTS.md):

1. The ticket contains the required contract fields (plan §11): Ticket ID,
   Goal, Context, Allowed files, Forbidden changes, Inputs, Expected outputs,
   Dependencies, Acceptance criteria, Validation commands, Stop conditions.
2. All acceptance criteria are satisfied.
3. Required validation commands were executed with recorded results.
4. No file outside the ticket's allowed scope was modified.
5. Project conventions were preserved and no unnecessary dependency was added.
6. The completion report is produced (see §3).
7. The workflow reaches `closed` through valid transitions (`workflow.md`),
   including any required approval gates.

A ticket must not be marked complete on intent; unmet criteria keep it open.

## 2. Release Definition of Done (0.1.0)

Release `0.1.0` is complete when a new user can (plan §17):

1. Install the framework.
2. Initialize it in a new or existing project.
3. Run the Coordinator.
4. Select a role through CLI, prompt, or a supported slash command.
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
15. Understand the workflow from the README without prior repository knowledge.

## 3. Completion report format

Every completed ticket reports (AGENTS.md):

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

## 4. Release quality gates

- Minimal complexity honored: small modules, explicit contracts, low token
  usage, few dependencies, predictable workflow, easy installation,
  understandable docs (plan §2.6).
- Project-agnostic behavior preserved; no target-project technology imposed
  (plan §2.1).
- `.ai-team` isolation preserved; no root `AGENTS.md` required in targets
  (plan §2.2).
- All three role-selection interfaces resolve to one role contract
  (`roles.md`).
- Slash commands remain optional with a documented fallback (plan §4.4).
- All optional providers can be disabled without breaking the workflow
  (`providers.md`).
- Validation suites pass: unit foundation, workflow transitions, configuration
  validation, role selection, provider failure, discovery, safe execution, an
  end-to-end sample project, and installation verification (M12).
- Beginner-oriented documentation exists: quick start, installation,
  configuration, roles, workflow, providers, troubleshooting, existing-project
  example, Laravel + React example, final README (M13).

## 5. Explicit non-goals for 0.1.0

Web dashboard; complex parallel orchestration; permanent specialized agent
fleet; multi-user authorization; external database requirement; billing;
telemetry; cloud orchestration; automatic deployment; large provider ecosystem
(plan §16).

## 6. Milestone completion

0.1.0 depends on M0–M13 completing in dependency order (plan §15). Parallel
work is allowed only where contracts are stable, and the Coordinator still
presents one focused ticket at a time (plan §15).

M0 (this specification package) is complete when the derived contracts in
`docs/specification/` are accepted and the open decisions in `open-decisions.md`
that block later milestones are resolved by the user.

## 7. Change control

Any change affecting MVP scope, role responsibilities, workflow, provider
boundaries, or the definitions above is a plan change and must be recorded per
plan §21.