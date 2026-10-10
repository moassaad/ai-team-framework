# AI Team Framework — Usage Manual

Task-oriented manual for developers using version `0.3.0` in real
projects: what to do, what to run, what inputs are needed, what
happens next, and how to confirm success. For architecture, full
role details, and limitations, see `docs/PROJECT_GUIDE.md`; for
depth, the guides linked at the end of each section.

**Reading convention:** command lines are verified against the real
parser. Output blocks show the real format; values in them are
illustrative unless the text says they were executed. Nothing here
requires reading the source code.

## 1. Getting started

**Prerequisites:** Node.js ≥ 18, npm, a terminal. No credentials or
providers are needed until you execute roles or production
workflows (each section names its prerequisites).

**Install the released version:**

```bash
npm install -g @moassaad/ai-team-framework@0.3.0
```

**Verify:**

```bash
ai-team --version   # 0.3.0
ai-team --help      # usage text, exit 0
```

**New project or existing repository?** An empty (or barely started)
directory follows the new-project path; an established codebase
follows the existing-project path. Both share the same setup and
CLI; they differ only in planning inputs (your own brief vs.
discovery of a real codebase). Details:
`docs/quick-start-new-project.md`,
`docs/quick-start-existing-project.md`.

**Project root and configuration.** Every command that does work
uses your current directory as the project root and requires
`<project>/.ai-team/config.yaml` there. Framework-managed state
lives only inside `.ai-team/` (`config.yaml` plus `roles/
workflows/ state/ specs/ plans/ reviews/ reports/ logs/`). Setup
creates exactly that and nothing else — no source files, no
scaffolding, no guidance files. Minimal valid configuration:

```yaml
version: 1
```

Defaults then apply: manual ticket-level approval, sequential
execution, only the `opencode` provider enabled. Full key reference:
`docs/configuration.md`.

## 2. First steps

**See what's available** (works anywhere, no configuration needed):

```bash
ai-team --help
ai-team run --role coordinator   # prints a role contract, runs nothing
ai-team role                     # prints role-command usage, runs nothing
```

**Check integration status** (run from inside your project):

```bash
cd <project>
ai-team status
```

Exit 0 with one desired-vs-detected line per registered
integration. It changes nothing — detection is read-only.

**What works without what:**

| Action | Needs |
| --- | --- |
| `--help`, contract display, usage texts | nothing |
| `status` | configured project (`.ai-team/config.yaml`) |
| `ai-team role <role>` execution | configured project + working provider (OpenCode) |
| `run` / `sprint` | above + GitHub config + token on stdin |
| `setup <integration>` | configured project + explicit confirmation |

**Safe first-run sequence** (nothing executes, nothing changes):

```bash
ai-team --version
ai-team --help
ai-team run --role coordinator
ai-team run "/technical-lead"
```

## 3. Choosing the interface

- **`ai-team run`** — executes one production Coordinator ticket
  against managed GitHub Issues (list once, run once, synchronize
  once). Needs GitHub config + token (see §6).
- **`ai-team run --role <role>`** and prompt (`"talk to the tech
  lead"`) / slash (`"/technical-lead"`) forms — **present** a role
  contract for reading. This is not execution and not a workflow.
- **`ai-team role <role> [inputs]`** — executes exactly one role,
  once, with no orchestration, modes, delegation, or persistence.
  Running one role never runs the rest of the team.
- **`ai-team sprint`** — executes one production sprint traversal
  (Coordinator → Technical Lead → PM/user-testing → final
  Coordinator approval) over managed issues. Each stage needs its
  own explicit decision (see §4).
- **`ai-team status`** — read-only integration status.
- **`ai-team setup <integration> [--yes]`** — explain, confirm,
  then install/configure **one integration** once. This is
  per-integration setup, not project setup: there is **no**
  project-setup CLI command. Preparing a project's `.ai-team/`
  workspace is available only through the internal TypeScript API
  (`runProjectSetup`); see `docs/quick-start-new-project.md`.

## 4. Common workflows with copyable examples

Prerequisites are stated per workflow. All examples use complete
illustrative values (ticket `T-101`); replace them with your own.

### Inspect a role contract

```bash
ai-team run --role senior-reviewer
```

Prerequisite: none. Success: the contract prints, exit 0. No role
executes.

### Run one implementation task

Prerequisites: configured project, working OpenCode provider.

```bash
ai-team role implementer --id T-101 --title "Render the list" \
  --description "Server-render saved articles newest first." \
  --requirements "Saved articles appear in reverse-chronological order" \
  --specialty backend
```

Success looks like (executed shape, values illustrative):

```text
role implementer completed: ticket T-101 -> implementation_review.
```

Specialty must be one of `backend|frontend|integration|database|
testing|documentation`. The ticket you pass is the whole assignment:
no plan is attached automatically and missing criteria are never
invented. Failure prints `role implementer-failed: ticket T-101
(<kind>): <message>.` (exit 1) — fix the cause and re-run; there is
no retry flag.

### Run a ticket through the Coordinator

Prerequisites: as above, plus your review decision up front
(`--review-decision approved`, or `changes_requested` with
`--review-feedback "..."`; without one it asks once at a TTY, and
non-interactive runs without one fail safely). The token rule in §6
applies only to production `run`, not to `role coordinator`.

```bash
ai-team role coordinator --id T-101 --title "Render the list" \
  --description "Server-render saved articles newest first." \
  --requirements "Saved articles appear in reverse-chronological order" \
  --specialty backend --review-decision approved
```

Success: `role coordinator completed: ticket T-101 ->
<final_state>.` (exit 0). `--review-feedback` without
`--review-decision` is rejected.

### Run a sprint

Prerequisites: GitHub config (`providers.github` with `owner`,
`repo`, `managedLabel`, `specialty`) + token on stdin. Each stage
takes **its own exact vocabulary** — they are not interchangeable:

```bash
echo "$GITHUB_TOKEN" | ai-team sprint \
  --review-decision approved \
  --tl-decision approved \
  --pm-decision approved \
  --final-decision approved
```

- `--review-decision`: `approved` | `changes_requested` (needs `--review-feedback "..."`).
- `--tl-decision`: `approved` | `corrections-required` (optional `--tl-notes "..."`, which requires `--tl-decision`).
- `--pm-decision`: `approved` | `changes-required` (optional `--pm-notes "..."`, which requires `--pm-decision`).
- `--final-decision`: `approved` | `changes-required` (optional `--final-notes "..."`, which requires `--final-decision`).

A rejection stops its stage with a bounded result; nothing retries
or re-enters automatically. Never place the token in a command,
flag, or file — stdin only.

### Perform a review and handle `changes_requested`

```bash
ai-team role senior-reviewer --id T-101 --title "Render the list" \
  --description "Server-render saved articles newest first." \
  --requirements "Saved articles appear in reverse-chronological order" \
  --result "Implemented per description."
```

The printed `Report:` is advisory text: it approves nothing and
reruns nobody. A `changes_requested`-style outcome means revising
the work and explicitly re-invoking the next step yourself. Depth:
`docs/individual-role-usage.md`.

### Prepare and continue a manual handoff

When an execution carries a handoff, print exactly that text:

```bash
ai-team role implementer --id T-101 --title "Render the list" \
  --description "Server-render saved articles newest first." \
  --requirements "Saved articles appear in reverse-chronological order" \
  --specialty backend --show-handoff > handoff.txt
```

If the execution carries none, the command reports `role error: no
handoff available for role "implementer" in this execution.` (exit
1) instead of inventing one. Inspect `handoff.txt` (it starts with
`=== AI TEAM HANDOFF ===`), then resume into the destination with
its own required flags — the handoff authorizes and travels as
provenance; inputs are never merged:

```bash
ai-team role senior-reviewer --id T-101 --title "Render the list" \
  --description "Server-render saved articles newest first." \
  --requirements "Saved articles appear in reverse-chronological order" \
  --result "Implemented per description." \
  --handoff-stdin < handoff.txt
```

Garbage, empty stdin, and wrong-destination text fail before any
provider work. Never hand-edit role ids. The 11 allowed directions
are listed in `docs/PROJECT_GUIDE.md`.

### Use Delegate mode where supported

Prerequisites: `providers.delegate.enabled: true`, an installed
`<name>-delegate` skill (Skills CLI needs Node ≥ 22.20), working
implementer + git. Delegate transports **implementer-destination**
handoffs only — never the whole team — and the manual path above
works with Delegate down:

```bash
ai-team setup delegate        # explain → confirm → install once
ai-team status                # confirm desired-vs-detected state
```

Scope, capability states, and fallback are detailed in
`docs/delegate-mode.md`; do not attempt other destinations.

### Set up a new or existing project

There is no project-setup CLI. Both paths prepare `.ai-team/` via
the internal `runProjectSetup` API (checkout required), then verify
with `ls <project>/.ai-team` (eight workspace directories +
`config.yaml`, nothing else) and re-run for the safe
`already-configured` no-op. Invalid existing configuration is
reported, kept byte-for-byte, and repaired by your own edit —
never silently replaced. New-project planning and
existing-project discovery + planning are covered step by step in
`docs/quick-start-new-project.md` and
`docs/quick-start-existing-project.md`; follow those guides rather
than improvising inputs.

### Handle corrections and re-entry

A rejected review/approval produces findings you route back
explicitly (correction reference → role-specific rework handoff →
re-entry validation → fresh explicit decision). No step executes or
resumes anything on its own, and a correction is never proof of
completion. Mechanics: `docs/PROJECT_GUIDE.md` §6; contracts:
`docs/roles.md`.

## 5. Role-selection guide

| Situation | Use | Command |
| --- | --- | --- |
| Route or track one piece of work | Coordinator | `ai-team role coordinator ...` |
| Validate business acceptance of a ticket | Project Manager | `ai-team role project-manager ... --state pm_review` |
| Technical acceptance of a ticket | Technical Lead | `ai-team role technical-lead ... --state technical_approval` |
| Build one ticket | Implementer | `ai-team role implementer ... --specialty ...` |
| Get an advisory review | Senior Reviewer | `ai-team role senior-reviewer ... --result ...` |
| Learn what a role covers | Contract display | `ai-team run --role <role>` (runs nothing) |
| Plan a project / decompose work | Planning workflows | **Not CLI operations** — internal TypeScript APIs (`runNewProject`, `runExistingProject`, lifecycles) used via checkout, per the quick-start guides |

PM/TL **planning** and **decomposition** live only in those internal
planning APIs; the same roles' CLI commands perform post-implementation
review/validation. Do not confuse the two. Individual depth:
`docs/individual-role-usage.md`.

## 6. Configuration recipes

**Minimal** (`<project>/.ai-team/config.yaml`):

```yaml
version: 1
```

**GitHub Issues** (required for production `run`/`sprint`; token
always via stdin, never in files):

```yaml
version: 1
providers:
  github:
    enabled: true
    owner: "<org-or-user>"
    repo: "<repository>"
    managedLabel: "ai-team"
    specialty: backend
```

```bash
echo "$GITHUB_TOKEN" | ai-team run --review-decision approved
```

**Spec Kit** (optional specification support):

```yaml
version: 1
providers:
  speckit:
    enabled: true
```

See `docs/providers-speckit.md` for detection and setup behavior.

**Delegate** (optional; never auto-enabled):

```yaml
version: 1
providers:
  delegate:
    enabled: true
```

`enabled: true` means delegation is allowed — not installed, ready,
or available. Those need the skill install plus fresh detection
(`ai-team status`). Validation is strict: unknown keys are rejected,
and enabling GitHub without its four fields fails. After any edit,
re-run setup/API validation and expect confirmation, not silent
repair.

## 7. Understanding results

- **completed** — the operation did what it claims (role line,
  persisted plan path, dispatch receipt). Verify the artifact it
  names before continuing.
- **changes-required / corrections-required / rejections** — a gate
  asked for changes. Adjust the named inputs and re-invoke; nothing
  was persisted or auto-retried.
- **failed / exit 1** — read the bounded message:
  - `missing required --...`, `unsupported flag`, `unknown
    specialty|workflow state` → compare against §4–§5; each role
    takes different flags.
  - `Configuration file not found` → run from inside the
    configured project or set it up first.
  - `invalid-configuration` → fix `config.yaml` yourself.
  - handoff parser/gate errors → re-copy the complete canonical
    text to the correct destination.
  - provider errors → check installation, enablement, and (for
    GitHub) token + required fields.
- Reviewer/approval **reports are opaque text**: never parse them
  into requirements, tasks, criteria, or approvals, and never treat
  them as authorization.

## 8. Common scenarios

- **Solo developer:** setup → `status` → run one implementer task →
  review it → accept via the matching gate. You supply every
  decision explicitly.
- **Feature development:** plan (quick-start guides) → implement →
  review → TL acceptance → PM validation → final approval, one
  explicit decision per gate.
- **Bug fixing:** narrow ticket → `role implementer` → reviewer →
  rejection returns bounded feedback, never a second attempt.
- **Independent role usage:** any single row of §5 tables, alone.
- **Review and correction:** findings → explicit rework handoff →
  re-entry → fresh decision (§4, last two workflows).
- **GitHub-tracked work:** managed label + specialty configured,
  token on stdin, `run` for one ticket / `sprint` for a traversal
  with all four stage decisions.
- **Delegated implementation:** capability `ready` → dispatch →
  opaque receipt; otherwise manual handoff (works with Delegate
  down). Implementer destination only.
- **New-project planning:** setup → planning API per
  `docs/quick-start-new-project.md` → approved plan file; no
  application code is ever generated.

## 9. Troubleshooting and command cheat sheet

**Session commands:** `ai-team --help` · `ai-team status` (in
project) · `ai-team role` (usage) · `ai-team setup <integration>`
· config at `.ai-team/config.yaml` · plans at `.ai-team/plans/`.

**Common errors and safe resolutions:**

| Message | Meaning | Fix |
| --- | --- | --- |
| `Configuration file not found` | wrong directory / no setup | `cd` into project or set it up |
| `missing required --...` | required flag absent | add the flag (§4) |
| `unsupported flag` | flag not valid for this role | use that role's flag set |
| `unknown specialty/state` | value outside allowlist | use a listed value |
| `no handoff available` | execution carries none | copy nothing; continue without |
| handoff parser/gate errors | bad text or wrong destination | re-copy complete text to the right role |
| provider/detection errors | missing install/enablement | install/enable, re-check `status` |
| `npm whoami` 401 | no local npm session | unrelated to product behavior |

**Deeper help:** `docs/PROJECT_GUIDE.md` (authoritative reference),
`docs/individual-role-usage.md` (roles + handoffs),
`docs/delegate-mode.md` (Delegate), `docs/configuration.md`
(config), `docs/troubleshooting.md` (verified problems),
`docs/quick-start-new-project.md` /
`docs/quick-start-existing-project.md` (planning walkthroughs).
