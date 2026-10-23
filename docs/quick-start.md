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
- The published package (`npm install -g
  @moassaad/ai-team-framework@0.3.0`) or a built repository
  checkout for contributors (see `docs/installation.md`).
- No credentials, external services, or installed providers are needed
  for the first run.

## Install

Package users (`npm install -g …`) skip straight to First run.
From a contributor checkout, at the repository root:

```bash
npm install
npm run build   # compile TypeScript into dist/
npm test        # full suite; expect a green run
```

## First run

Verify the installation:

```bash
ai-team --help
ai-team --version
```

If you installed the package globally, `ai-team` is available in
`PATH`. From a built repository checkout, use `node dist/index.js`
instead:

```bash
node dist/index.js --help
node dist/index.js --version
```

Both forms are equivalent when the binary is on `PATH`; from a
checkout, `node dist/index.js` is the direct alternative. Do not
assume both are interchangeable in an environment where the binary
is not on `PATH`. See `docs/installation.md` for installation
details.

Bare `ai-team run` executes one production Coordinator ticket
against managed GitHub issues (it needs `providers.github` with
`owner`, `repo`, `managedLabel`, and `specialty` in
`.ai-team/config.yaml`, plus the GitHub token on stdin):

```bash
printf '%s' "$GITHUB_TOKEN" | ai-team run
```

These are four distinct CLI entry points with different
responsibilities. `run` and `sprint` execute their respective
production workflows; `role` executes one role, while
`run --role` only presents a role contract:

- `ai-team run` (bare, or with `--review-decision`):
  Executes one production Coordinator ticket (reads managed issues
  once, runs at most one ticket, synchronizes once). Requires
  GitHub configuration and token on stdin.

- `ai-team run --role <role>` / prompt text / slash command:
  Presents the selected role contract only; prints
  `Role execution is not implemented yet.` No execution occurs.

- `ai-team role <role>` [role inputs]:
  Executes exactly one role directly (coordinator, project-manager,
  technical-lead, implementer, senior-reviewer) with explicit
  flags. See `ai-team role` for usage.

- `ai-team sprint` [per-stage decisions]:
  Executes one production sprint traversal (reads managed issues
  once, runs the sprint workflow once through Coordinator,
  Technical Lead, PM/User Testing, and final Coordinator approval,
  then synchronizes explicitly approved tickets once). Same GitHub
  configuration and stdin token as `run`; each review stage needs
  its own explicit decision flag or interactive TTY prompt.

A complete copyable sprint example:

```bash
printf '%s' "$GITHUB_TOKEN" | ai-team sprint \
  --review-decision approved \
  --tl-decision approved \
  --pm-decision approved \
  --final-decision approved
```

Prerequisites for this command:

- The `ai-team` binary must be available in `PATH`, for example
  after a global npm installation.
- From a built repository checkout, run the equivalent command
  as `node dist/index.js sprint` with the same flags.
- The current directory must be the configured project root.
- `.ai-team/config.yaml` must contain valid GitHub provider
  configuration including `owner`, `repo`, `managedLabel`, and
  `specialty` (see `docs/configuration.md`).
- `GITHUB_TOKEN` must contain a valid GitHub token with
  appropriate repository permissions. Never put an actual
  credential in documentation.

Exit `0` means final synchronization succeeded; any other exit
means the sprint stopped (work remaining, corrections created,
changes required, or a failure) with a bounded message. The
command never retries or re-enters the workflow automatically;
invoke it again explicitly when follow-up work has landed.

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
- `AI-Team-Framework-Project-Plan.md` — milestone status and history.
- `docs/PROJECT_GUIDE.md` — authoritative project guide for release 0.3.0.
- `docs/usage.md` — practical task-oriented usage manual.
