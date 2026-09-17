# Contributing to AI Team Framework

Contributions should be small, scoped, validated, and reviewable. Work proceeds one ticket at a time, following the ticket's allowed files, acceptance criteria, and validation commands.

## Ground rules

1. **Inspect before changing.** Read the ticket, the relevant files under `docs/specification/`, and the actual repository state before modifying anything.
2. **One ticket at a time.** Do not start the next ticket until the current one is accepted, unless the workflow explicitly permits it.
3. **Keep changes scoped.** Modify only what the ticket requires. No unrelated refactoring.
4. **No new dependencies without a clear reason.** Prefer Node.js built-ins; keep the dependency set minimal.
5. **Stay project-agnostic.** Never impose a language, framework, architecture, or tooling choice on target projects.
6. **Do not invent requirements.** If the ticket, plan, and specification do not define it, stop and ask instead of guessing.
7. **Validate.** Run the relevant checks and record the results:
   ```bash
   npm run build
   npm test
   npm run lint
   ```
8. **Report exact changes.** List files created, modified, and deleted, the commands executed, and their results.

## Where things live

- `README.md` — public project overview.
- `CONTRIBUTING.md` (this file) — contributor workflow and expectations.
- `AGENTS.md` — persistent instructions for AI agents working in this repository. It is not duplicated here; contributors working with AI agents should follow it.
- `docs/specification/` — detailed product and system specification; the source of truth alongside the project plan.

## What not to do

- Do not implement planned functionality ahead of its ticket (roles, workflow engine, providers, `.ai-team/` initialization).
- Do not document unimplemented commands or capabilities as available.
- Do not weaken `.ai-team/` isolation, change approval semantics, or make other sensitive changes without explicit approval.
- Do not modify the license, versioning, or dependency policy casually; those are project-level decisions.
