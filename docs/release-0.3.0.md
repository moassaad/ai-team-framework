# AI Team Framework 0.3.0

Version 0.3.0 is published on npm.

## Highlights

- Expanded agent role contracts and direct role invocation.
- Planning, sprint, and task lifecycle workflows with approval checkpoints.
- Fast, standard, and full work modes with recommendations and guardrails.
- Manual and Delegate handoff workflows, with correction and re-entry support.
- Project setup workflows and guides for new and existing projects, individual roles, and Delegate mode.

## Installation

Install the published version with:

`npm install @moassaad/ai-team-framework@0.3.0`

Requirements: Node.js >= 18.

The CLI binary is `ai-team`.

## Release verification

- Version 0.3.0 is published on the npm registry.
- The npm `latest` dist-tag points to 0.3.0.
- The GitHub Actions publish workflow completed successfully.

## Known limitations

- Execution evidence uses controlled stub providers and transports; real model and Delegate behavior has not been fully verified.
- There is no dedicated project-setup CLI or pause/resume support.
- Delegate currently targets the Implementer role only.
- No `exports` map is provided; deep imports from `dist/` are not a stable public API.
