# AI Team Framework

A reusable, project-agnostic framework for coordinating specialized AI roles during software development.

It works with new and existing projects — whatever their language, framework, architecture, or tooling — without imposing any technology of its own. A Coordinator routes work to four specialist roles; implementation proceeds one ticket at a time through review and approval gates. The framework discovers your project before planning anything.

## Status

Version `0.1.0` is released. Implemented and tested: role contracts and selection, workflow engine with 11 states, configuration validation, project discovery, planning and ticket generation, implementer/reviewer execution flows, OpenCode execution provider, optional GitHub Issues / Spec Kit / delegate-skills integrations with local fallbacks, and 581 automated tests. See `AI-Team-Framework-Project-Plan.md` for milestone status.

## How it works

```text
User
→ Coordinator (routes, default entry point)
→ Project Manager (requirements, scope)
→ Technical Lead (discovery, planning, tickets)
→ Implementer (one ticket, with validation)
→ Senior Reviewer (advisory findings, never edits code)
→ approval/workflow continuation
```

Execution, review, recommendation, approval, and state transition are separate responsibilities — success at one step never skips the next. Details: `docs/roles.md`, `docs/workflow.md`.

## Features

- Role selection via CLI flags, prompt keywords, or slash commands — all resolving to one role contract.
- Framework state isolated under the target project's `.ai-team/` directory.
- Validated configuration with safe defaults (`docs/configuration.md`).
- Read-only project discovery that reports `unknown` instead of guessing.
- Requirements → plan → small implementation tickets.
- One-ticket execution with review, technical/PM gates, and manual approval by default.
- OpenCode execution provider with bounded timeouts and sanitized errors.
- Optional Spec Kit, GitHub Issues, and delegate-skills integrations — each with a local fallback and none required.
- 581-test safety coverage (transitions, validation, failures, discovery, execution, end-to-end, installation).

## Current limitations

- The CLI presents role contracts and resolves role selection, but reports `Role execution is not implemented yet` rather than executing autonomously.
- Registry installation was not verified; install from a checkout (`docs/installation.md`).
- End-user Spec Kit setup documentation is resolved (P-006 closed by `docs/providers-speckit.md` on top of the M15 integration).
- delegate-skills is an optional Skills/relay integration (M16): detection, explicit skill installation, one-shot relay delegation with result mapping, and fallback-or-bounded-failure when optional/required. It needs Node `>= 22.20.0` for the Skills CLI step, installs nothing automatically, and has no runtime orchestration yet (M17/M18). Full guide: `docs/providers-delegate-skills.md`.
- `approval.after: sprint` is accepted by validation but unsupported by the approval flows (deferred).

## Installation

Prerequisites: Node.js 18+ and npm. Full guide: `docs/installation.md`.

```bash
npm install
npm run build   # compile TypeScript into dist/
npm test        # full suite; expect 581/581 passing
```

## First run

```bash
node dist/index.js --help
node dist/index.js --version
node dist/index.js run --role technical-lead
node dist/index.js run "talk to the tech lead"
node dist/index.js run "/technical-lead"
```

Bare `ai-team run` executes one production Coordinator ticket
against managed GitHub issues (at most one ticket, at most one
synchronization; never a sprint, never a retry). It needs
`providers.github` with `owner`, `repo`, `managedLabel`, and
`specialty` in `.ai-team/config.yaml`, and reads the GitHub
token from stdin:

```bash
echo "$GITHUB_TOKEN" | node dist/index.js run
```

`ai-team status` reports integration state read-only (desired
state vs fresh detection; never installs or changes anything).
`ai-team setup <integration> [--yes]` explains, asks, then
installs/configures once and verifies (delegate skill selection
is not yet implemented). Both run from a project directory
containing `.ai-team/config.yaml`.

First-use walkthrough: `docs/quick-start.md`.

## Roles

**Coordinator** (default) routes and reports. **Project Manager** owns requirements and acceptance. **Technical Lead** owns discovery, planning, and tickets. **Implementer** implements one ticket (specialties: backend, frontend, integration, database, testing, documentation). **Senior Reviewer** reviews without modifying code. Full guide: `docs/roles.md`.

## Workflow

```text
Discover → Analyze → Plan → Ticket → Implement → Review → Approval → Continue/Close
```

One ticket at a time by default; terminal states are `closed` and `cancelled`. Full guide: `docs/workflow.md`.

## Configuration

Lives at `<project>/.ai-team/config.yaml` (defaults filled by validation):

```yaml
version: 1
approval:
  mode: manual
providers:
  delegate:
    enabled: false
```

Full reference: `docs/configuration.md`.

## Providers

**OpenCode** (required execution boundary) plus optional **Spec Kit**, **GitHub Issues**, and **delegate-skills** — each optional one works without, each with fallback behavior and explicit failures. Overview: `docs/providers.md`.

## Examples

- `docs/examples/existing-project.md` — discovery-to-ticket walkthrough on a small Python project.
- `docs/examples/laravel-react.md` — same flow on a Laravel + React sample.

## Troubleshooting

Installation, CLI, configuration, provider, and workflow problems: `docs/troubleshooting.md`. Never share tokens or secrets when reporting issues.

## Repository structure

```text
src/          # config, roles, workflow, discovery, planning, providers, execution, cli
tests/        # 581 tests (node:test, no external framework)
docs/         # guides, examples, specification/
dist/         # built output (generated by npm run build, not committed)
```

## Documentation map

- `docs/quick-start.md` — first-use path.
- `docs/installation.md` — install, build, verify.
- `docs/configuration.md` — settings and validation.
- `docs/roles.md` — roles, specialties, selection.
- `docs/workflow.md` — lifecycle, states, approval.
- `docs/providers.md` — integrations and fallbacks.
- `docs/providers-delegate-skills.md` — delegate-skills integration guide (M16).
- `docs/troubleshooting.md` — diagnose problems.
- `docs/examples/existing-project.md`, `docs/examples/laravel-react.md` — worked examples.
- `docs/specification/` — detailed product specification.
- `CONTRIBUTING.md` — how to contribute.

## License

MIT — see [LICENSE](LICENSE).
