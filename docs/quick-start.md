# Quick Start

The minimum path from installation to your first framework-guided task.
Every command below was verified against the current implementation;
anything the framework does not do yet is labeled as such.

## What it is

The AI Team Framework coordinates five specialized AI roles working
one ticket at a time on any software project — yours keeps its own
language, architecture, and tooling:

- **Coordinator** — default entry point; routes requests, reports progress.
- **Project Manager** — requirements, scope, business acceptance.
- **Technical Lead** — discovery, planning, ticket breakdown, technical gates.
- **Implementer** — implements one assigned ticket (backend, frontend,
  integration, database, testing, or documentation specialty).
- **Senior Reviewer** — reviews implementation without modifying code;
  findings are advisory.

Work flows through review and approval gates before anything is
accepted. OpenCode, Spec Kit, GitHub Issues, and delegate-skills are
optional integrations, never requirements. Details:
`docs/specification/roles.md`, `docs/specification/workflow.md`,
`docs/specification/providers.md`.

## Prerequisites

- Node.js 18+ and npm.
- A checkout of this repository (registry installation has not been
  verified; see `tests/installation-verification.test.ts` for what the
  verified local path covers).
- No credentials, external services, or installed providers are needed
  for the first run.

## Install

From the repository root:

```bash
npm install
npm run build   # compile TypeScript into dist/
npm test        # full suite; expect 581/581 passing
```

## First run

Verify the installation and meet the Coordinator:

```bash
node dist/index.js --help
node dist/index.js --version
node dist/index.js run
```

`run` with no arguments selects the Coordinator and prints its
contract:

```text
Coordinator (coordinator)
Default user-facing role: receive user requests, route work to the appropriate roles, and communicate status and results.
Role execution is not implemented yet.
```

The last line is honest scoping: the CLI currently presents role
contracts and resolves role selection. Full role execution is wired
through the library modules (`src/roles/`, `src/execution/`), not
yet through autonomous CLI orchestration.

## Your first task

Select a role explicitly (aliases `pm`, `tl`, `reviewer`, `sr` work):

```bash
node dist/index.js run --role technical-lead
node dist/index.js run --role implementer --specialty backend
```

Or select by plain prompt text or slash command — all three resolve
to the same role contract:

```bash
node dist/index.js run "talk to the tech lead"
node dist/index.js run "/technical-lead"
```

The intended first real task is project discovery: the Technical
Lead inspects your existing project (languages, frameworks, tools,
conventions — uncertainty reported as `unknown`, never guessed)
before any planning. Discovery reads files only; see
`docs/specification/product-scope.md` and `src/discovery/`.

## How the workflow works

One ticket moves through these stages, each owned by its role:

```text
ready → in_progress → implementation_review → technical_approval → pm_review → closed
```

Five ideas keep the model safe; they are different things:

- **Execution** runs one ticket and reports a result.
- **Review** produces advisory findings, never code changes.
- **Recommendation** names the next valid transition without performing it.
- **Approval** (manual by default) is an explicit human decision at the gate.
- **Transition** is the state change itself, owned by exactly one role.

A successful execution never closes a ticket by itself: closure
requires the review, approval, and transition steps above. Full
rules: `docs/specification/workflow.md`.

Framework state for a target project lives under that project's
`.ai-team/` directory (config, state, plans, reports); the
framework never imposes its own architecture on your project. See
`docs/specification/configuration.md`.

## Where to go next

- `docs/providers-opencode.md` — the required execution provider path.
- `docs/providers-delegate-skills.md` — the optional delegation
  integration, including its documented setup and known limitations.
- `docs/specification/configuration.md` — `providers.*.enabled`
  settings (all optional providers default to disabled).
- `AI-Team-Framework-Project-Plan.md` — milestone status and what is
  planned next (M13 documentation tickets cover installation, roles,
  workflow, providers, and troubleshooting in depth).
