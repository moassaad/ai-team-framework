# AI Team Framework

A reusable, project-agnostic framework for coordinating specialized AI roles during software development.

It is designed to work with new and existing projects — whatever their language, framework, architecture, or tooling — without imposing any technology of its own on the target project.

## Status

M0 (Discovery & Specification) is complete. M1 (Repository Foundation) is in progress.

### Implemented today

- Repository foundation (`package.json`, strict TypeScript configuration, `.gitignore`).
- Build, test, and lint tooling (`npm run build`, `npm test`, `npm run lint`).
- A minimal CLI entry point supporting `ai-team --help` and `ai-team --version`; anything else returns a concise usage error.
- Node.js built-in test runner with TypeScript compilation, plus smoke and CLI tests.

### Planned (designed, not yet implemented)

- The five role contracts in code, role selection, and the `ai-team run` command.
- Workflow engine and ticket state management.
- `.ai-team/` workspace initialization in target projects.
- Provider integrations (OpenCode, Spec Kit, GitHub Issues, delegate-skills).

No role orchestration is implemented yet. Nothing listed under "Planned" should be treated as available.

## The five roles (design)

- **Coordinator** — default user-facing role; routes requests and orchestrates the other roles. Does not replace the Technical Lead.
- **Project Manager** — owns requirements, scope, and business acceptance.
- **Technical Lead** — owns project discovery, technical planning, ticket breakdown, and review outcomes.
- **Implementer** — implements one assigned ticket at a time, with validation; optional specialties such as backend, frontend, or testing.
- **Senior Reviewer** — reviews implementation and tests without modifying code; produces advisory findings.

These are framework design roles, not implemented code yet. Full contracts: `docs/specification/roles.md`.

## Project-agnostic by design

The framework does not assume Laravel, React, Vue, Spring, Docker, GitHub, REST, a specific database, or a specific architecture. It discovers and analyzes the target project before planning anything, then adapts to that project's own conventions.

## Framework workspace

Framework-specific configuration and state are intended to live under `.ai-team/` inside a target project (configuration, roles, workflows, state, specs, plans, reviews, reports, logs). That directory is created by future initialization work — this repository does not create it yet.

## Integrations (planned)

- **OpenCode** — required first-class execution provider.
- **Spec Kit** — optional specification/planning integration.
- **GitHub Issues** — optional tracking provider; local-only tracking is the default.
- **delegate-skills** — optional delegation provider; never required.

None of these integrations is implemented yet, and optional integrations will never become core dependencies. Details: `docs/specification/providers.md`.

## CLI

Only this is implemented today:

```bash
ai-team --help
ai-team --version
```

Running `ai-team` with no arguments prints the help text. Any other command prints a short error pointing at `--help` and exits non-zero. Role invocation commands do not exist yet.

To try it locally after building (see below):

```bash
node dist/index.js --help
```

## Development

Prerequisites: Node.js 18+ and npm.

```bash
npm install
npm run build   # compile TypeScript into dist/
npm test        # compile src/ and tests/, then run the Node.js built-in test runner
npm run lint    # lint src/ and tests/ with ESLint
```

## Testing

Tests are TypeScript files under `tests/`, compiled with `tsc` and executed with the Node.js built-in test runner (`node:test` with `node:assert`). No separate test framework is used, and no future test architecture is assumed.

## Further reading

- `docs/specification/` — detailed product and system specification.
- `docs/quick-start.md` — beginner first-use path.
- `CONTRIBUTING.md` — how to contribute.
- `AGENTS.md` — persistent instructions for AI agents working in this repository.

## License

MIT — see [LICENSE](LICENSE).
