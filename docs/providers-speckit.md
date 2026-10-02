# Spec Kit Integration Guide

Spec Kit is an **optional specification/planning capability** inside
AI Team Framework — a tool the framework can use, not a role and not
the workflow engine. The framework owns workflow, tickets, Senior
Review, and approval; Spec Kit only helps produce specification and
planning artifacts that flow back into framework tickets.

```text
AI Team Framework
  → owns workflow / tickets / review / approval

Spec Kit (optional)
  → helps produce specification, plan, and task artifacts
```

Normal framework operation does **not** require Spec Kit. When Spec
Kit is unavailable or not wanted, the framework works with its local
fallback provider instead. Only an operation that explicitly asks for
Spec Kit fails when Spec Kit cannot satisfy it.

## How AI Team uses Spec Kit

Everything goes through the framework's Spec Kit provider boundary
(`src/providers/speckit-*.ts`), which can — only after your explicit
confirmation for the changing steps:

```text
detect      fresh check of the real environment/project state
install     install the Spec Kit CLI or a missing project integration
initialize  initialize Spec Kit inside an existing project
verify      re-check reality after any change; this decides success
```

Spec Kit's own workflow skills (`/speckit-specify`, `/speckit-plan`,
`/speckit-tasks`, …) run inside your coding agent's chat, not as
terminal commands, and AI Team never runs `/speckit.implement`: ticket
execution always stays with the framework's Implementer → Senior
Reviewer → approval flow.

## Enabling Spec Kit

Spec Kit is disabled by default. Opt in with desired-state
configuration (verified against `src/config/schema.ts`):

```yaml
providers:
  speckit:
    enabled: true
```

`enabled` means **you want the integration enabled**. It never means
installed, ready, or available — those are established by fresh
detection every time:

```text
Configuration  = user intent
Detection      = current reality
```

So `enabled: true` does not mean Spec Kit is installed, and
`enabled: false` does not mean it is absent. The framework never
changes this setting for you: installation does not enable anything,
and detection failure does not disable anything.

## Detection: four different conditions

Fresh detection distinguishes conditions that are easy to confuse:

| Condition | Meaning |
|---|---|
| Installed but disabled | Present on the machine/project, but you have not opted in. The framework does not use it. |
| Enabled but unavailable | You opted in, but reality disagrees (not installed, not initialized, integration missing). Falls back or fails clearly — never pretends readiness. |
| Available but disabled | Usable, but not selected. Stays out of the way until enabled. |
| Detection failure | Reality itself could not be established (e.g. unreadable state). Reported as failure, never converted into "absent" or "present". |

## Installing the Spec Kit CLI

If the `specify` command is missing, the framework's install
capability can install the published `specify-cli` package through an
already-available tool, in upstream's recommended order: `uv` (`uv
tool install specify-cli`), then `pipx`, then `pip`. No version
pinning is added; the default official package route is used.

Safety rules, enforced:

- Installation happens **only after your explicit confirmation**.
  Nothing installs merely because a command ran.
- The framework never installs `uv`, Python, or system packages, never
  uses `sudo`, and never bootstraps your environment.
- If no supported installer exists, it stops and tells you exactly
  what is missing instead of modifying anything.

## Existing projects: initialization vs integration installation

Three different situations, three different capabilities:

```text
CLI missing
  → install capability (above)

CLI present + project not initialized (no Spec Kit project state)
  → initialization capability (this section)

Project initialized + requested integration missing
  → integration installation capability
     (`specify integration install <key>`, never with --force)
```

### Initializing an existing project

Before saying yes, create a reviewable baseline: commit or stash your
work (upstream's recommendation). Initialization then runs the
documented upstream form for a non-empty directory:

```text
specify init --here --force --non-interactive --integration <key>
```

What this means in plain language:

- Spec Kit creates or updates **its own managed project files**
  (`.specify/` infrastructure plus your agent's skill/command files).
  The framework itself does not rewrite your application source.
- `--force` acknowledges the merge into your non-empty directory. It
  may replace files at conflicting *managed* paths; it does not
  delete the rest of your application.
- `--non-interactive` keeps the run deterministic: it can never hang
  waiting for a prompt. If your installed Spec Kit is too old to
  support it, the operation fails with an upgrade message instead of
  running a possibly-blocking command.
- This runs **only after your explicit confirmation**. There is no
  silent auto-initialization, and `--force` is never retried
  automatically after a failure.

What the framework never does for you: commit, stash, reset, branch,
or roll back your project. Git stays yours — the framework only reads
Git state (when Git exists) so the confirmation can mention a dirty
working tree. Be precise with yourself too: do **not** expect "nothing
will be modified" — expect "only Spec Kit's own managed files".

## From Spec Kit artifacts to AI Team tickets

A Spec Kit feature directory may contain `spec.md`, `plan.md`, and
`tasks.md` (plus optional `research.md`, `data-model.md`,
`quickstart.md`, `contracts/`, which stay optional and are not
required). Mapping is read-only and one-directional:

```text
Spec Kit artifacts
  ↓  Spec Kit adapter (reads only)
spec.md → requirement/behavior context
plan.md → technical approach/constraints
tasks.md → implementation work items (T001, phases, dependencies)
  ↓  existing generic planning mapper + ticket generator
AI Team tickets (framework IDs, e.g. T-001)
```

Rules that protect you:

- Your requirements stay owned by the Project Manager; `spec.md` and
  `plan.md` ground them as context, verbatim.
- Ticket IDs are owned by AI Team. Source IDs (`T001`) remain visible
  inside tickets as context only.
- Task order and dependency notes are preserved as ticket content and
  execution order. Parallel markers (`[P]`) stay informational text.
- File paths mentioned by tasks stay prose — they grant no edit
  permission. The Technical Lead still sets final scope.
- Nothing is written back: `tasks.md` checkboxes are never flipped,
  artifacts are never edited, completion is never synchronized.
- Missing `tasks.md` (or tasks with no actionable items) fails
  explicitly instead of producing an empty "successful" plan.

## One ticket at a time, always

Spec Kit may produce many tasks. The framework still executes:

```text
Ticket 1 → Implement → Senior Review → approval → Ticket 2 → …
```

`tasks.md` is never bulk-executed, and `/speckit.implement` is never
the execution engine.

## When Spec Kit fails: fallback, not magic

```text
Spec Kit unavailable + ordinary operation → local fallback artifact,
                                             workflow continues
Spec Kit unavailable + explicitly Spec-Kit-required operation
                                           → clear failure, no silent swap
```

The fallback is the framework's own local provider producing a
minimal artifact from the same requirements — a reported outcome, not
fabricated Spec Kit output. Failure handling never automatically
installs, reinitializes, retries, switches integrations, edits
configuration, or deletes anything. (For the record: upstream's own
`specify integration install` rolls a *partial install* back to a
clean state itself; that guarantee belongs to Spec Kit, not to AI
Team.)

## OpenCode provider ≠ Spec Kit OpenCode integration

Two separate facts, kept separate:

- **AI Team's OpenCode provider** executes framework prompts. It is
  the required execution boundary.
- **Spec Kit's `opencode` integration** (a supported upstream key)
  means a Spec Kit project has OpenCode skill/command files
  installed. It says nothing about the provider, and the provider
  says nothing about it.

Having one does not imply having the other; neither is merged into
the other.

## Troubleshooting

| Symptom | Meaning | Safe next action |
|---|---|---|
| Spec Kit not detected | `specify` is absent. | Confirm-install the CLI (`uv` recommended), then verify with `specify version`. |
| Installed but project not initialized | CLI works; the project has no Spec Kit state. | Baseline (commit/stash), confirm, then initialize (§Existing projects). |
| Integration missing | Initialized, but not for your agent key. | Confirm-install the integration (`specify integration install <key>` via the framework; never `--force` from here). |
| Malformed Spec Kit state | `.specify/integration.json` unreadable or newer than understood. | Do not hand-edit it (not a repair method). Inspect/restore from your baseline; re-run detection. |
| Unsupported or old CLI | Too old for `--non-interactive` or state schema. | Upgrade `specify-cli` (`uv tool install specify-cli`, pipx, or pip), then verify. |
| Installer unavailable | No `uv`/`pipx`/`pip` on PATH. | Install `uv` (per upstream docs) or ensure `pipx`/`pip` is available; nothing else changes meanwhile. |
| Post-install verification failure | Commands exited 0 but reality disagrees. | Reported as failure — re-run detection; do not assume success from exit codes. |
| Initialization refused | No project root, no CLI, malformed state, or old CLI. | Read the message: it names the blocker (create the directory, install the CLI, fix state, or upgrade). |

## Confirmation and roadmap

Installation and project initialization modify the environment or the
project, so the framework never performs them silently: each runs
only as the confirmed step after you have seen what will change.
There is currently no interactive `ai-team setup` / `ai-team status`
UX — that is planned for M17. Until then, confirmation lives with the
calling layer, and the provider methods assume it already happened.

## Upstream references

Summarized above from the official Spec Kit documentation; read the
source for full detail:

- Installation: <https://github.com/github/spec-kit/blob/main/docs/installation.md>
- Existing projects: <https://github.com/github/spec-kit/blob/main/docs/guides/existing-projects.md>
- Integrations: <https://github.com/github/spec-kit/blob/main/docs/reference/integrations.md>
- Workflow quickstart: <https://github.com/github/spec-kit/blob/main/docs/quickstart.md>

## P-006 resolution

Historical item P-006 (Spec Kit usage documentation, open since M8)
is **resolved** by this guide together with the implemented M15
integration it describes. Covered, each verified against
`src/providers/speckit-*.ts` and its tests:

1. Spec Kit as an optional integration (§top).
2. Framework-managed detection (§How AI Team uses it, §Detection).
3. CLI installation (§Installing, safety rules).
4. Existing-project initialization (§Existing projects).
5. Integration installation (§Existing projects flow).
6. Confirmation boundaries (§Confirmation and roadmap; enforced in code).
7. Existing-project safety (§Existing projects, Git paragraph).
8. Artifact mapping (§From Spec Kit artifacts…).
9. One-ticket-at-a-time execution (§One ticket at a time).
10. Failure/fallback behavior (§When Spec Kit fails).
11. OpenCode relationship (§OpenCode provider ≠ …).
12. Troubleshooting (§Troubleshooting).

The historical prompt-based adapter description is superseded and no
longer documented as current behavior.
