# Installation Guide

How to install the AI Team Framework and reach a working CLI.
Only the paths below exist; registry installation has not been
verified and is labeled as such. For first use after installing,
see `docs/quick-start.md`.

## Prerequisites

- Node.js 18+ (verified on v18.19.1; `package.json` declares no
  narrower `engines` range, so treat 18 as the floor).
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

Two paths exist. They differ only in where you run the commands.

### Repository checkout (developers and first-time users)

This is the verified path:

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
Registry installation itself was **not** executed during
verification; do not treat it as tested.

Global installation (`npm install -g`) is not part of the verified
path and no `sudo` step is documented or required. Do not invent one.

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
node dist/index.js --version   # prints 0.1.0
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
slash commands) presents role contracts and reports
`Role execution is not implemented yet` rather than executing
autonomously; bare `ai-team run` instead executes one
production Coordinator ticket via the GitHub runtime
(`providers.github` configured, token on stdin). First-use
workflow: `docs/quick-start.md`.

## Network and registry boundaries

Honest accounting of what each step needs:

- Verified offline: package metadata, build output layout, CLI
  startup/help/version/run from a clean directory, unknown-command
  failure mode, packed file listing.
- Requires network in a real user environment: `npm install`
  (dependency download) and any registry/tarball install.
- Not verified: registry install end-to-end, global `bin` linking.
  These are unsupported claims until tested, not failures.

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
