# New Project Quick Start

From a fresh checkout to an approved, persisted Sprint/Task plan for a
new software project. You will install the framework, prepare one
project directory with `runProjectSetup`, verify the result, meet the
Coordinator, and run the New Project planning workflow
(`runNewProject`) with explicit inputs and approvals.

This guide covers a **new** project (empty or barely started
directory). For bringing the framework to an established codebase, see
the Existing Project Quick Start (T-046, forthcoming — not yet
written). For the full role reference, see `docs/roles.md`; for
configuration, `docs/configuration.md`; for problems,
`docs/troubleshooting.md`.

## What this guide does and does not do

- **Framework setup** (`runProjectSetup`) creates only
  `<project>/.ai-team/` (workspace directories plus `config.yaml`).
  It never creates application source, never installs an app
  framework, and never scaffolds a repository.
- **New Project Workflow** (`runNewProject`) coordinates planning —
  Coordinator → Project Manager → Technical Lead, dual approvals,
  Sprint/Task decomposition, persistence — and stops there. It never
  implements a feature and never generates application code.
- **Feature lifecycles** (`runFastBugLifecycle`,
  `runStandardFeatureLifecycle`, `runFullFeatureLifecycle`) are the
  later step that implements and reviews a feature. They are named in
  the last section as the next step, not walked through here.

## 1. Prerequisites

- Node.js 18+ and npm 9+.
- A terminal. No credentials, external services, or providers are
  needed for this guide (the planning example uses a stub provider
  you define inline; a real provider is a later step).

## 2. Install the framework

The released npm package (`npm install -g
@moassaad/ai-team-framework@0.3.0`) covers supported CLI usage.
This guide's walkthrough additionally uses internal TypeScript
planning APIs (`runProjectSetup`, `runNewProject`) that are not
stable public package imports, so it requires a repository
checkout with a local build:

```bash
git clone https://github.com/moassaad/ai-team-framework.git
cd ai-team-framework
npm install
npm run build
```

This guide assumes the commands below run with the checkout at
`<framework>` and your new project at `<project>`. They may be
different directories — setup validates whichever root you pass.

Check the CLI works:

```bash
node <framework>/dist/index.js --help
```

## 3. Choose the project directory

Create or pick the directory that will hold your new project. It must
already exist; setup never creates it for you:

```bash
mkdir -p <project>
```

## 4. Run project setup

There is no `ai-team setup <project>` command — the existing
`ai-team setup <integration>` manages optional integrations, not
project setup. Project setup is the `runProjectSetup` TypeScript API,
run here against the checkout you just built:

```bash
node -e "console.log(JSON.stringify(require('<framework>/dist/config/setup.js').runProjectSetup({ project_root: '<project>' }), null, 2))"
```

Two honest caveats: `package.json` declares no `exports` map, so this
deep `dist/` path is the working checkout path, not a versioned
public API; and the result object below is the whole story — setup
prints nothing else.

Expected result (paths abbreviated):

```text
{
  "status": "completed",
  "projectRoot": "<project>",
  "workspacePath": "<project>/.ai-team",
  "configPath": "<project>/.ai-team/config.yaml",
  "files": [
    { "path": "<project>/.ai-team", "action": "created" },
    { "path": "<project>/.ai-team/config.yaml", "action": "created" }
  ],
  ...
}
```

The other outcomes: `already-configured` (safe no-op — re-running
setup rewrites nothing), `invalid-configuration` (your existing
`config.yaml` failed validation; it is kept byte-for-byte with
diagnostics in `issues` — edit the YAML yourself and re-run; setup
never repairs or overwrites it), and `failed` (a write failed; the
message says what is incomplete — never treat it as configured).

## 5. Verify the managed files

```bash
ls <project>/.ai-team
```

Expected: the eight workspace directories (`roles workflows state
specs plans reviews reports logs`) plus `config.yaml` — and nothing
else. Setup scaffolds no application: the rest of `<project>` is
untouched.

## 6. Read the initial configuration

```bash
cat <project>/.ai-team/config.yaml
```

Fresh defaults: `version: 1`, manual ticket-level approval, sequential
execution, and only the `opencode` provider enabled (all optional
providers — `speckit`, `github`, `delegate` — default to disabled and
are never auto-enabled). Safe to edit: `approval.mode`,
`approval.sensitive_changes`, and the `providers.*.enabled` flags.
Validation is strict — unknown keys are rejected — so re-run setup
after editing to confirm `already-configured` rather than
`invalid-configuration`. Enabling `github` additionally requires
`owner`, `repo`, `managedLabel`, and `specialty`; leave it disabled
for this guide.

## 7. Check integration status

CLI commands use the **current directory** as the project root, so run
them from inside `<project>`:

```bash
cd <project>
node <framework>/dist/index.js status
```

Expected for a fresh setup (exit 0):

```text
Integration status:
spec-kit: disabled
```

Each line reports one registered integration's desired vs. detected
state. Exit 1 with `Configuration file not found` means you ran it
from the wrong directory. Nothing here installs or enables anything —
that is what `ai-team setup <integration>` (per-integration,
explicitly confirmed) is for, and it is optional for this guide.

## 8. Meet the Coordinator

```bash
node <framework>/dist/index.js run --role coordinator
```

This prints the Coordinator contract. Role selection only presents
contracts (`Role execution is not implemented yet` there) — it is how
you confirm which role owns what before planning, not an execution
step.

## 9. Run the New Project planning workflow

`runNewProject` takes one explicit input: your brief, your PM-owned
business content, your TL-owned technical content, two explicit
approval decisions, and your Sprint/Task structure. Provider reports
stay opaque — the plan is built from the structured fields you
supply, never inferred from provider text. Save this as
`plan.js` (replace `<framework>` and `<project>`):

```js
const { runProjectSetup } = require("<framework>/dist/config/setup.js");
const { runNewProject } = require("<framework>/dist/runtime/new-project-workflow.js");

(async () => {
  const project_root = "<project>";
  console.log((runProjectSetup({ project_root })).status);

  const provider = {
    name: "stub",
    execute: async (request) => ({ status: "succeeded", text: `${request.role} output` }),
  };
  const result = await runNewProject({
    request: "Build a reading-list service for saved articles.",
    pm: {
      requirements: ["Saved articles appear in reverse-chronological order"],
      scope: { in_scope: ["Reading-list page"], out_of_scope: ["Offline sync"] },
      acceptance_criteria: ["Saved articles render newest first."],
      business_rules: ["Only the owning reader sees their list."],
      business_constraints: ["Launch behind the existing reader flag."],
    },
    tl: {
      architecture: ["Server-rendered page over the article store."],
      decomposition_strategy: ["Split page render from read-state update."],
      technical_constraints: ["Reuse the article store client."],
      dependencies: ["Article store availability."],
    },
    pmApproval: { identity: { role: "project-manager" }, decision: "approved" },
    tlApproval: { identity: { role: "technical-lead" }, decision: "approved" },
    sprint: { id: "sprint-reading-list", goal: "Ship the reading-list page." },
    tasks: [
      {
        id: "T-101",
        title: "Render the reading-list page",
        description: "Server-render saved articles newest first.",
        requirements: "Saved articles appear in reverse-chronological order",
        acceptance_criteria: ["Saved articles render newest first."],
        specialty: "backend",
      },
    ],
    project_root,
    provider,
    timeout_ms: 10000,
  });
  console.log(result.outcome, result.planPath);
})().catch((error) => { console.error(`planning failed: ${error.message}`); process.exit(1); });
```

```bash
node plan.js
```

Expected:

```text
already-configured
completed <project>/.ai-team/plans/sprint-reading-list.json
```

`completed` plus the plan path is success — the artifact holds all
three planning sections, both approvals approved it, and the plan was
persisted and read back. Confirm the file exists and contains your
sprint and task ids. The other outcomes: `changes-required` (an
approval asked for changes; adjust the PM/TL inputs and re-run —
nothing was persisted) and `failed` (which named stage stopped, with
a message).

Notes on the inputs, because they are the most common stumbling
block:

- The two approvals are **explicit caller decisions**, not inferred:
  `decision: "approved"` with the matching PM/TL identity. Swap in
  `"changes-required"` (with notes) to see the workflow stop safely.
- `tasks` need `id`, `title`, `description`, `requirements`,
  `acceptance_criteria`, and a valid `specialty` (`backend`,
  `frontend`, `integration`, `database`, `testing`, `documentation`).
- The stub provider stands in for a real agent provider (see
  `docs/providers-opencode.md` for the required first-class path).
  Planning never parses its text — swap the stub's text and the plan
  is unchanged.

## 10. What comes next

- **Implement the planned feature** with the matching lifecycle:
  `runFastBugLifecycle` (implementer + reviewer + TL acceptance),
  `runStandardFeatureLifecycle`, or `runFullFeatureLifecycle` —
  each takes explicit inputs and reviewer/approval decisions in the
  same style as above. Details: `docs/roles.md`.
- **Pick a work mode deliberately**: `recommendMode` suggests,
  `checkModeGuardrails` validates, you select. A recommendation is
  never an execution authorization.
- **Delegate (optional)**: the delegate-skills transport handles the
  implementer destination only — it never runs the whole team, and
  the manual path above works without it.
  See `docs/providers-delegate-skills.md`.
- **An established codebase**: wait for the Existing Project Quick
  Start (T-046); do not apply this guide's planning inputs to a
  project you have not discovered first.
- **Problems**: `docs/troubleshooting.md`; configuration reference:
  `docs/configuration.md`.
