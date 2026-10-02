# Spec Kit Integration Audit (S-001)

Audit of the historical Spec Kit implementation against the current
framework architecture, the project plan (M15), and current upstream
Spec Kit documentation (verified 2026-09-25 from
`github.com/github/spec-kit` README, integrations reference,
and existing-projects guide). No production code was changed;
all findings come from source and doc inspection.

## 1. Current implementation inventory

| File | Ticket | What it does |
|---|---|---|
| `src/providers/specification.ts` | P-001 | Generic contract: `SpecificationRequest{requirements, project_root, artifact: specification\|plan}`, `SpecificationArtifact`, validators, `isSpecificationProvider`. No I/O, no tool names. |
| `src/providers/speckit.ts` | P-002 | Adapter over an injected `AgentProvider`: builds the prompt `"Use the Spec Kit ${operation} operation"` (`specify`/`plan`) and returns the agent's text as the artifact. No process management, no setup, no detection. |
| `src/planning/mapper.ts`, `src/planning/tickets.ts` | P-003/P-004 | Pure mapping: artifact → plan → bounded tickets. Provider-neutral. |
| `src/providers/fallback.ts` | P-005 | Self-contained local fallback artifact producer. No Spec Kit coupling. |
| `src/config/schema.ts` (`speckit.enabled`, default false) | config | Desired-state flag only. |
| Docs (`providers.md`, `troubleshooting.md`, `quick-start.md`) | P-006 (open) | Describe the adapter in one paragraph each; no setup/installation instructions. No doc covers the `specify` CLI. |

## 2. Upstream behavior verified

- Install: `uv tool install specify-cli` (requires Python 3.11+, `uv`).
- Init: `specify init <project> --integration <key>`; existing projects: `specify init --here --force --integration <key>` **after** committing/stashing (baseline for review). `--force` permits non-empty dirs and may replace conflicting managed paths only; it does not delete the application.
- `opencode` is a supported integration key; skills install into `.opencode/commands`; it is declared multi-install safe.
- Integration management: `specify integration list/search/info/install/uninstall/switch/use/upgrade/status/catalog` (all scoped to an initialized project). State lives in `.specify/integration.json` (`default_integration`, `installed_integrations`, …).
- `specify integration status [--json]` is read-only, machine-readable, exit 0 on ok/warning, 1 on error.
- Uninstall preserves user-modified files (SHA-256 tracked); `--force` overrides.
- Workflow skills run **in the coding agent's chat** (`/speckit-constitution`, `/speckit-specify`, `/speckit-clarify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-analyze`, `/speckit-implement`, `/speckit-converge`), one at a time — they are not terminal commands. Project-local assets live under `.specify/`.

## 3. P-001 to P-006 classification

- **P-001 — keep.** The generic request/artifact contract is tool-neutral, validated, and compatible with the I-001 style. (Artifact kinds may need extension in S-005 for clarify/checklist/tasks outputs; that is later work, not a defect now.)
- **P-002 — replace.** The prompt-delegation adapter assumes an agent that understands "Spec Kit operations" with no installation, no detection, and no skills present. Upstream requires installed skills (`.opencode/commands`) plus the `specify` CLI, and its vocabulary is skill names, not "specify/plan operations". The mechanism — not just the boundary — is incompatible, so adaptation would leave a misleading core.
- **P-003/P-004 — keep.** Framework-owned, provider-neutral mapping; exactly where Spec Kit outputs must enter under the approved architecture.
- **P-005 — keep.** Local fallback with no Spec Kit coupling; remains the designed path when Spec Kit is unavailable/disabled.
- **P-006 — see §9.**

## 4. Obsolete assumptions

1. An agent can perform Spec Kit work from a prompt alone (no skills/CLI needed). Upstream: skills must be installed per integration; CLI setup is a separate terminal step.
2. "Specify/plan operations" as invocation vocabulary. Upstream: `/speckit-*` skills in agent chat.
3. No detection/installation/configuration surface needed. Upstream + plan M15 require all three (S-002/S-003).
4. Single unspecified agent backend. Upstream: per-key integrations with manifests, multi-install rules, and a default-integration record.
5. `specify` CLI, `.specify/` assets, and `integration.json` state play no role. They are the entire upstream integration model.

Each is evidenced by §2 against `src/providers/speckit.ts` (57 lines, zero setup/detection references — see its own boundary test).

## 5. Required adaptations

- New adapter over the I-001 contract exposing `detect` (required) plus `version`/`install`/`configure` (optional), targeting the `specify` CLI and project-local state — not the agent-prompt path.
- Config `speckit.enabled` stays as desired state; it must be combined with fresh detection, never treated as availability proof.
- Mapping layer (P-003/P-004) stays untouched; S-005 will feed it from real Spec Kit artifacts.

## 6. Items to remove

- The P-002 prompt-delegation mechanism (`operationPrompt` and its "Spec Kit operation" vocabulary) once the replacement lands. Nothing else is obsolete: no other file contains Spec Kit-specific logic.

## 7. Items to preserve

- P-001 contract, P-003/P-004 mapping, P-005 fallback, `speckit.enabled` desired-state flag, and the boundary rules (no workflow ownership, no approval bypass, optional-only, fallback-first).

## 8. S-002 implementation boundary

Implement `SpecKitIntegration` against I-001/I-002 without touching workflow, tickets, review, approval, or the generic foundation:

- `detect()`: establish `specify` CLI presence and version, project initialization (`.specify/` assets), and agent-integration state for the configured key (starting with `opencode`), preferring read-only signals such as `specify integration status --json`. Never infer success from config alone.
- `version()` / `install()` / `configure()`: expose only what the environment supports; `install` must follow Detect → Explain → Ask → Install → Verify (S-003) and never run automatically.
- Existing projects: follow the upstream baseline-then-`init --here --force` flow; initialization must be explicit, documented, and non-destructive (S-004 owns the details).

## 9. P-006 resolution

P-006 is **not** resolved by documentation alone. Resolution requires: (a) the S-002 adapter above, (b) S-007 usage documentation written against it covering install (`uv` + `specify init`), the skills-in-chat model, the existing-project flow, and the mapping into AI Team tickets — using the verified facts in §2. This audit supplies the verified facts; S-007 delivers the resolution.

## 10. Open questions

1. Exact machine-readable detection signals: is `specify integration status --json` (plus exit codes) sufficient for CLI presence, version, init state, and agent-integration state, or is direct `.specify/integration.json` inspection also needed? (S-002 to determine against the real CLI.)
2. Whether framework-side detection shells out to `specify` directly or observes project files only — a no-process-execution preference in this repo favors files-first, CLI-confirming design.
3. Timing of artifact-kind extension (clarify/checklist/tasks) for P-001 — deferred to S-005, no action now.

## Architecture boundary check (verified)

The future adapter, per plan §9.6 and this audit, must not own workflow state, ticket approval, or implementation; must not bypass Senior Reviewer; must not run `/speckit-implement` as the framework's implementation mechanism (ticket-by-ticket Implementer flow stays authoritative); must keep provider logic out of the generic foundation; must stay optional; and must never let `speckit.enabled` stand in for detection. The S-002 boundary in §8 satisfies all seven.
