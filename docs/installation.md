# Installation Guide

How to install the AI Team Framework and reach a working CLI.
The current release is `@moassaad/ai-team-framework@0.3.0`,
published on npm (the `latest` dist-tag). Install it with
`npm install -g @moassaad/ai-team-framework@0.3.0`; contributors
working from source use the checkout path below. For first use
after installing, see `docs/quick-start.md` (first-use path),
`docs/usage.md` (task-oriented manual), and
`docs/PROJECT_GUIDE.md` (authoritative reference).

The package is tested from the generated npm artifact: the
suite packs the real tarball, installs it with npm into a
temporary consumer, and runs the installed `ai-team`
binary there — including a registry-backed installation
check for the released version.

## Release identity (published 0.3.0)

- Released package: `@moassaad/ai-team-framework@0.3.0` (npm
  `latest`). Verify with `npm view @moassaad/ai-team-framework
  version dist-tags.latest`.
- The unscoped `ai-team-framework` name is owned by another
  publisher and was never used for this project's release.
- The `ai-team` CLI binary is unchanged; package name and
  executable remain separate contracts.
- The pre-publish blocker (owner two-factor authentication on the
  first publish attempt) was resolved during the 0.3.0 release;
  history: `docs/release-0.3.0.md`. Publication now goes through
  the release workflow below.

The release workflow (`.github/workflows/publish.yml`) is prepared for
npm Trusted Publishing over OIDC — no tokens in the
repository, `id-token: write` plus `contents: read`, Node
22.14.0 with npm 11.5.1+, build → test → artifact check →
explicit `npm publish --access public` on release publication.
The first release goes out by direct authenticated
publication (`moassaad` session); the workflow remains the
Trusted Publishing path for future releases once the
matching trusted publisher is configured on npmjs.com.

## Prerequisites

- Node.js 18+ (verified on v18.19.1; `package.json` declares
  `engines: { "node": ">=18" }`, so treat 18 as the floor).
- npm 9+ (verified on 9.2.0). It is needed for dependency
  installation and for running the `build`/`test`/`lint` scripts.
- No global TypeScript installation: `typescript`, `eslint`, and
  `@types/node` are local devDependencies invoked through npm scripts.
- No operating-system constraints are declared; the framework uses
  only portable Node.js built-ins plus one runtime dependency.
- Runtime dependency (installed automatically): `yaml` — the only
  entry in `dependencies`. Everything else in `package.json` is a
  development-only tool.

## Installation paths

Two paths exist. The registry path is the primary one for
normal users; the checkout path is for contributors and
developers working from source. They differ only in where you
run the commands.

### Published package (end users)

```bash
npm install -g @moassaad/ai-team-framework@0.3.0
ai-team --help
ai-team --version   # 0.3.0
```

Global installation needs no `sudo` step beyond the user's own npm
setup. Do not invent one.

### Repository checkout (contributors and developers)

```bash
git clone <repository-url>
cd ai-team-framework
npm install   # requires network: fetches yaml + dev dependencies
npm run build # compile src/ into dist/ (requires the dev dependencies)
```

### Packaged artifact (end users)

`package.json` declares `files: ["dist"]` with `main` and `bin`
both pointing at the built output:

```json
"main": "dist/index.js",
"bin": { "ai-team": "dist/index.js" }
```

The published artifact therefore contains `dist/`, `package.json`,
`README.md`, and `LICENSE` — never `src/`, `tests/`, or
`node_modules/` (verified by `npm pack --dry-run` in
`tests/installation-verification.test.ts`). Installing that artifact
still requires its one runtime dependency (`yaml`), so a registry or
tarball install needs network access for dependency resolution.

```bash
npm install -g @moassaad/ai-team-framework@0.3.0
ai-team --help
ai-team --version   # 0.3.0
```


## Build behavior

`npm run build` runs `tsc`, compiling `src/**/*.ts` into `dist/`
with source maps. The CLI entry point is `dist/index.js` (shebang
`#!/usr/bin/env node`), which reads its version from the adjacent
`package.json` — that file must ship alongside `dist/`, which npm
does automatically. You must build before running the CLI directly:
invoking `node dist/index.js` with `dist/` missing fails with a
module-not-found error (exit 1).

## Verification

From the repository root, using the built files only:

```bash
node dist/index.js --help
node dist/index.js --version   # prints 0.3.0
```

Expected: `--help` prints the usage text starting with
`AI Team Framework CLI` (exit 0); `--version` prints the package
version (exit 0). Neither command contacts any service, reads user
configuration, or requires a provider.

## CLI after installation

Reach the Coordinator through the built entry point:

```bash
node dist/index.js run
```

Once installed as a package binary the same invocation is
`ai-team run`. Role selection (`run --role ...`, prompt text,
slash commands) only presents role contracts — it reports
`Role execution is not implemented yet` there and never executes;
`ai-team role <role>` instead executes exactly one role, and bare
`ai-team run` executes one production Coordinator ticket via the
GitHub runtime (`providers.github` configured, token on stdin).
First-use workflow: `docs/quick-start.md`.

## Network and registry boundaries

Honest accounting of what each step needs:

- Verified offline: package metadata, build output layout, CLI
  startup/help/version/run from a clean directory, unknown-command
  failure mode, packed file listing.
- Requires network in a real user environment: `npm install`
  (dependency download) and any registry/tarball install.
- Verified for the 0.3.0 release: registry install end-to-end
  (installed from the registry into an isolated prefix; `ai-team
  --version` → `0.3.0`).
- Not verified: system-global (`-g`) bin linking in a user's own
  npm setup. This is an unsupported claim until tested, not a
  failure.

## Troubleshooting

- `node: command not found` — install Node.js 18+ first; nothing
  else in this guide works without it.
- `npm ERR!` during `npm install` — network or registry access
  problem; dependencies cannot be installed offline.
- `Error: Cannot find module '.../dist/index.js'` (exit 1) — you
  skipped the build; run `npm run build`.
- `tsc: command not found` from a direct `tsc` call — use
  `npm run build` instead; TypeScript is local, not global.
- `error: unknown command "..."` (exit 1, empty stdout) — the CLI
  works, but the arguments match no documented command; run with
  `--help` for the supported forms.
- Version prints `unknown` — `package.json` is missing next to
  `dist/`; reinstall from a complete artifact, since the CLI reads
  its version from that file.
