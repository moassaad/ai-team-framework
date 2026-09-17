# Configuration Specification

Derived from plan §5, §6.3. Defaults from plan §6.3 and §2.2.

## 1. Workspace layout (target project)

Framework artifacts isolated under `.ai-team/` (plan §5):

```text
.ai-team/
├── config.yaml
├── project.yaml
├── roles/
├── workflows/
├── state/
├── specs/
├── plans/
├── reviews/
├── reports/
└── logs/
```

None of these must exist before initialization (plan §5). Each subdirectory is
created only when the relevant milestone/ticket requires it (plan §13).

## 2. `config.yaml` schema (working proposal)

```yaml
version: 1

workflow:
  execution: sequential     # parallel is out of scope for 0.1.0
  default_state: ready

approval:
  mode: manual              # manual | automatic
  after: ticket             # ticket | sprint
  sensitive_changes: always # always | configured | never
  sensitive_rules: []       # used only when sensitive_changes: configured

providers:
  opencode:
    enabled: true           # required first-class provider (plan §9.1)
  speckit:
    enabled: false          # optional (plan §8.3, §9.2)
  github:
    enabled: false          # optional (plan §10)
    owner: ""               # required when github enabled
    repo: ""                # required when github enabled
  delegate:
    enabled: false          # optional; never auto-enabled (plan §9.3)
```

## 3. `project.yaml` schema (minimal)

```yaml
name: <target project name>
kind: existing | new
location: <relative/absolute path to target project root>
stack: []          # discovered, not assumed
conventions: []    # discovered project conventions
notes: []          # discovered constraints/risks
```

`project.yaml` is generated during project analysis; it records discovery
results marked with confidence (known vs unknown) per the discovery contract in
plan §7. Uncertain results must be recorded as `unknown`, never as guesses.

## 4. Validation rules

Configuration must be validated before any workflow step (M2 milestone). Rules:

- `version` is required and must be supported.
- `approval.mode`, `approval.after`, `approval.sensitive_changes` must match
  their enumerated values (plan §6.3).
- Provider keys must be known values; unknown values → configuration error with
  a clear message.
- `github.enabled: true` requires non-empty `owner` and `repo`.
- `delegate.enabled` defaults to `false` and requires explicit enablement
  (plan §9.3).
- Unknown top-level keys → rejected (strict) so weak agents get deterministic
  feedback instead of silently ignoring typos.
- Credentials/API tokens must NOT be stored in `config.yaml` or any file under
  `.ai-team/`; secrets stay out-of-band (environment/tool native auth).
- Configuration affecting MVP scope, workflow, or provider boundaries is a plan
  change and requires explicit approval (plan §21).

## 5. State storage

- 0.1.0 uses local workflow state only (plan §16 "local workflow state").
- State files live under `.ai-team/state/`; no external database in 0.1.0
  (plan §16 out-of-scope "external database requirement").
- State records every ticket: id, title, state, owner-role, history of
  transitions, current approval gate. Transitions must follow `workflow.md`.
- Exact physical format (JSON/YAML) is an M4 implementation decision; the
  workflow contract (states/transitions) is fixed by `workflow.md`.

## 6. Sensitive-change classification

Default sensitive set (AGENTS.md), used by `sensitive_changes: always` and as
the baseline for `configured`:

- architecture changes
- deletion/data-loss operations
- credentials/security changes
- broad dependency upgrades
- destructive database operations
- workflow/approval semantic changes
- changes that weaken `.ai-team` isolation

A ticket or plan that touches any item in the set must be flagged sensitive and
route through the sensitive approval requirement (`workflow.md` §4).

## 7. Configuration documentation

Configuration values beyond this contract (exact comments, defaults per file)
belong to C-006/M13 documentation tickets and must not contradict this spec.