# Release 0.3.0 Preparation (M30 T-050)

Candidate: `@moassaad/ai-team-framework@0.3.0`. Status: **prepared,
not published, not registry-verified**. Do not install from the
registry — only `0.2.0` exists there and `0.3.0` publication is
blocked (see below). Until the release lands, install from a
checkout (`docs/installation.md`).

## Release sequence (T-050 follow-up)

The publish pipeline (`.github/workflows/publish.yml`) is
tag-triggered and OIDC-compatible. The owner performs these steps
in order; no step is automatic before its predecessor succeeds:

1. Complete the release-preparation changes (this branch).
2. Configure the Trusted Publisher on npmjs.com for this
   repository and workflow file (owner session required; status
   cannot be checked from here — do not assume it exists).
3. Commit the release-preparation changes on the intended release
   branch.
4. Push the matching `v0.3.0` tag. The workflow validates the tag
   against `package.json` (version and scoped name), fails closed
   if the version already exists, then runs clean install, build,
   the deterministic test suite, and `npm pack --dry-run`.
5. Wait for the workflow to publish via OIDC and pass registry
   verification (`npm view` of the exact version, bounded
   retries) plus the isolated installed-CLI `--version` smoke
   test.
6. Create the GitHub Release manually from the already-pushed
   `v0.3.0` tag using this file as the release notes — only after
   step 5 succeeds. The workflow never creates a release itself.
7. Merge the release branch into `main` only after the release
   gate (publication + registry verification) passes.

## Local session checks versus OIDC readiness

`npm run test:npm-session` runs the three live `npm whoami`
authentication checks (`tests/npm-session-auth.ts`). They verify a
**local** npm token/session and fail without one — that failure
says nothing about the product. They are excluded from the
ordinary `npm test` suite, never gate OIDC publishing, and cannot
prove OIDC readiness (`whoami` cannot mint or check an OIDC
token). OIDC readiness is proven only by the publish operation
plus the post-publish registry verification above.

## Recovery

If publication succeeds but a later verification command fails:
never republish — published versions are immutable. Compare
`npm view @moassaad/ai-team-framework@0.3.0 dist.integrity`
against a local `npm pack` tarball; if they match, proceed with
the GitHub Release and merge without rerunning publish; if they
do not match, a new patch version is required. If the version
already exists when the workflow runs, it fails closed with this
same instruction instead of overwriting.

## What 0.3.0 contains

Everything on the post-0.2.0 roadmap through T-049, verified by the
T-049 artifact (`docs/final-product-e2e-verification.md`):

- M22–M25 role contracts, planning, sprints, CLI role invocation.
- M26 manual/Delegate handoff parity (Implementer destination).
- M27 work modes (fast/standard/full) with recommendation +
  guardrails.
- M28 correction and re-entry contracts.
- M29 planning/lifecycle entry points, parity proof, user
  checkpoints.
- M30 project setup workflow plus usage guides (new/existing
  quick starts, individual roles, Delegate mode).

## Distribution and entry points

- Package entry: `dist/index.js` (`main`); CLI binary `ai-team`
  (`bin`). No `exports` map exists — deep `dist/` imports are the
  working checkout path, not a versioned public API. Adding an
  exports map is deferred as a product/API decision (see risks).
- `files: ["dist"]`; runtime dependency exactly `["yaml"]`
  (`yaml@2.9.1` locked); engines `node >= 18`.
- Verify locally: `npm run build`, `npm pack --dry-run` (expect
  the 277-file pin in `tests/npm-publish-readiness.test.ts`),
  `node dist/index.js --version` (expect `0.3.0`).

## Blockers (external, owner action required)

1. Registry authentication: `npm whoami` returns `401
   Unauthorized` here — no publish possible from this
   environment, and 2FA must not be bypassed.
2. Release trigger: `.github/workflows/publish.yml` runs only on
   a published GitHub release, and trusted publishing needs the
   npmjs.com trusted-publisher configuration. Neither exists yet:
   no tag, no GitHub release, no publish performed in T-050.
3. Post-publish verification (registry fetch, installed-CLI
   smoke test) cannot run until 1–2 resolve.

## Known limits carried into the release

- Suite shows the 3 npm-identity failures (blocked on 1) plus 1
  skip; 23 pre-existing lint errors in older files.
- All execution evidence uses controlled stub providers and
  transports; real model/delegate behavior is unproven.
- Strict config validation, no project-setup CLI, no
  pause/resume, Delegate implementer-only — documented limits,
  not defects.
