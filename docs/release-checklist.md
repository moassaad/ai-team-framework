# Release 0.1.0 Checklist

Pre-release verification for **AI Team Framework 0.1.0**. This
checklist does not release anything — it gates the project-owner
decision to proceed to REL-012, which owns tagging, publishing,
and the version update. Baseline at writing: 581/581 tests passing;
build, lint, and diff-check clean.

## Documentation

- [ ] `docs/quick-start.md` present and commands verified.
- [ ] `docs/installation.md` present; offline/network boundaries stated.
- [ ] `docs/configuration.md` examples validate against the real validator.
- [ ] `docs/roles.md`, `docs/workflow.md`, `docs/providers.md` present.
- [ ] `docs/troubleshooting.md` present with real error messages.
- [ ] `docs/examples/existing-project.md` and `docs/examples/laravel-react.md` present.
- [ ] `README.md` status accurate (no stale pre-implementation text, no released claims).
- [ ] `docs/specification/`, `LICENSE`, `AI-Team-Framework-Project-Plan.md` present.

## Build and Tests

- [ ] `npm install` succeeds (requires network for dependencies).
- [ ] `npm run build` clean (`tsc`, `src/` → `dist/`).
- [ ] `npm test` fully green (baseline 581/581; require green, not the exact count).
- [ ] `npm run lint` clean; `git diff --check` clean.
- [ ] Unit/contract, end-to-end sample, and installation-verification suites all pass.

## Package

- [ ] `package.json`: name `ai-team-framework`, version `0.1.0`, `main`/`bin` → `dist/index.js`, runtime deps exactly `["yaml"]`.
- [ ] `npm pack --dry-run` lists `dist/`, `package.json`, `README.md`, `LICENSE` — and no `src/`, `tests/`, `node_modules/`, or `dist-test/`.
- [ ] No devDependency leaked into runtime requirements.

## CLI

- [ ] `node dist/index.js --help` → usage text, exit 0.
- [ ] `node dist/index.js --version` → `0.1.0`, exit 0.
- [ ] `node dist/index.js run` → Coordinator, exit 0.
- [ ] Unknown command → exit 1, empty stdout, usage hint on stderr.
- [ ] No external service, credential, or network needed for the above.

## Security

- [ ] No real credentials, tokens, or secrets in any tracked file (fixtures use empty/placeholder values only; search before release).
- [ ] Docs and examples use placeholders (`owner: "acme"`); error paths carry no secrets.
- [ ] No debug credentials or temporary tokens left in the tree.

## Known Limitations (accepted, not blockers unless the owner decides otherwise)

- [ ] P-006 Spec Kit setup docs unresolved/open — README states it.
- [ ] delegate-skills standalone-protocol limitation documented, unresolved — stated, adapter untouched.
- [ ] `approval.after: sprint` deferred (`unsupported_scope`) — not presented as supported.
- [ ] CLI reports `Role execution is not implemented yet` — stated, not hidden.
- [ ] Registry install and global `bin` linking unverified — not claimed.

## Repository

- [ ] `git status` shows only intended release files.
- [ ] `git diff --check` clean; final diff reviewed file by file.
- [ ] No stray temp dirs, debug output, or accidental fixtures.
- [ ] Version strings consistent: `package.json` (`0.1.0`), README ("toward 0.1.0, not yet released"), release definition target.

## Final Decision

- [ ] All required checks above pass.
- [ ] Remaining limitations above are accepted as documented (or the owner declares blockers).
- [ ] Release owner approves proceeding.

```text
REL-011 → checklist passes → project-owner decision → REL-012 → release 0.1.0
```
