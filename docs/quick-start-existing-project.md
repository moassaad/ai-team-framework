# Existing Project Quick Start

From a repository checkout to an approved, persisted Sprint/Task plan
for a project that already exists. You will install the framework, run
project setup safely against your existing root, analyze the project
through the discovery contract, and run the Existing Project planning
workflow (`runExistingProject`) with explicit inputs and approvals.

This guide is for an established codebase. For starting from an empty
directory, see `docs/quick-start-new-project.md`. For the full role
reference, see `docs/roles.md`; for configuration,
`docs/configuration.md`; for problems, `docs/troubleshooting.md`.

Three jobs stay distinct throughout: **setup** prepares the
framework-managed workspace and configuration; **discovery** analyzes
your project read-only and reports what its detectors actually found;
**planning** coordinates the roles and produces a validated plan. None
of them modifies your application source.

## What this guide does and does not do

- `runProjectSetup` creates only `<project>/.ai-team/` (workspace
  directories plus `config.yaml`). Existing source and configuration
  are preserved byte-for-byte; nothing is scaffolded.
- `generateProjectAnalysis` reads your project and returns findings
  with coverage metadata. Categories its detectors cannot establish
  are reported `not_detected` or `unknown` — never guessed.
- `runExistingProject` validates your existing-project context,
  analyzes the root, then runs the canonical planning sequence
  (Coordinator → PM → TL, dual approvals, Sprint/Task decomposition,
  persistence plus readback). It never implements a feature and never
  writes outside the `.ai-team/plans/` plan file.

## 1. Prerequisites

- Node.js 18+ and npm 9+.
- Your existing project, checked out at `<project>`, with its true
  root identified (the directory holding its manifest — e.g.
  `package.json`, `go.mod`, `pyproject.toml` — not a parent folder).
- A terminal. No credentials or providers are needed for this guide
  (the planning example uses an inline stub provider; a real provider
  is a later step).

## 2. Install the framework

The released npm package (`npm install -g
@moassaad/ai-team-framework@0.3.0`) covers supported CLI usage.
This guide's walkthrough additionally uses internal TypeScript
planning APIs (`runProjectSetup`, `generateProjectAnalysis`,
`runExistingProject`) that are not stable public package imports,
so it requires a repository checkout with a local build:

```bash
git clone https://github.com/moassaad/ai-team-framework.git
cd ai-team-framework
npm install
npm run build
```

Below, `<framework>` is that checkout and `<project>` is your
existing project. They must be different directories — double-check
the root before every write step.

## 3. Run project setup against the existing root

There is no `ai-team setup <project>` command — the existing
`ai-team setup <integration>` manages optional integrations, not
project setup. Project setup is the `runProjectSetup` TypeScript API,
run here against the checkout you just built:

```bash
node -e "console.log(JSON.stringify(require('<framework>/dist/config/setup.js').runProjectSetup({ project_root: '<project>' }), null, 2))"
```

Two honest caveats: `package.json` declares no `exports` map, so this
deep `dist/` path is the working checkout path, not a versioned
public API; and setup prints only the result object.

`completed` means the workspace and/or configuration were created.
`already-configured` is the safe no-op on re-runs — nothing is
rewritten. `invalid-configuration` means your existing `config.yaml`
failed validation: it is kept byte-for-byte with diagnostics in
`issues`, so edit the YAML yourself and re-run (setup never repairs
or overwrites it). `failed` means a write failed — never treat it as
configured.

Verify that setup added exactly one thing:

```bash
ls <project>
ls <project>/.ai-team
```

Your source tree must be otherwise identical (confirm with your own
`git status`: only `.ai-team/` is new). Inside `.ai-team/`, expect
the eight workspace directories (`roles workflows state specs plans
reviews reports logs`) plus `config.yaml` — and nothing else.

## 4. Read the configuration

```bash
cat <project>/.ai-team/config.yaml
```

Fresh defaults: `version: 1`, manual ticket-level approval, and only
the `opencode` provider enabled. If the project already had a
`config.yaml`, your values were preserved untouched. Validation is
strict — unknown keys are rejected — so after any edit, re-run setup
and expect `already-configured`, not `invalid-configuration`.

From inside `<project>`, confirm integration status (CLI commands use
the current directory as the project root):

```bash
cd <project>
node <framework>/dist/index.js status
```

Exit 0 with one desired-vs-detected line per registered integration.
Nothing here installs or enables anything.

## 5. Build the existing-project context

Discovery starts from a `ProjectContext` you construct and the
contract validates — a bare directory path proves nothing on its own:

```js
const { validateProjectContext } = require("<framework>/dist/discovery/contract.js");

const project = validateProjectContext({
  root: "<project>",
  name: "reading-list",
  kind: "existing",
});
```

Only `root` is required; `kind: "existing"` is the discriminator the
workflow enforces (pass `"new"` or omit it and `runExistingProject`
rejects the context instead of assuming). Validation checks shapes,
never disk — it says nothing about the project yet.

## 6. Preview the discovery analysis

```js
const { generateProjectAnalysis } = require("<framework>/dist/discovery/report.js");

const preview = generateProjectAnalysis(project);
console.log(`${preview.findings.length} findings,`,
  `${preview.findings.filter((finding) => finding.status === "detected").length} detected,`,
  `coverage ${preview.coverage.analyzed.length}/${preview.coverage.totalSpecCategories} categories`);
for (const finding of preview.findings) {
  console.log(`- ${finding.category}: ${finding.status}`);
}
```

For a small JavaScript project this prints something like `12
findings, 1 detected` with `languages: detected` (from the manifest),
several `not_detected` categories, and the rest `unknown` — plus
explicit `coverage.analyzed` / `coverage.uncovered` lists. That
honesty is the point: only `detected` findings are established facts.
Treat `not_detected`/`unknown` as boundaries of understanding, not as
absences in your project, and write your planning inputs from what
you know — never copy detector output into requirements and never let
anyone tell you discovery "fully understands" the repository.

## 7. Run the Existing Project planning workflow

`runExistingProject` takes the validated context (the discovery root
becomes both the analyzed and the persistence root — one root, no
divergence), your request, your caller-owned PM/TL content, two
explicit approval decisions, and your Sprint/Task structure. Save this
as `plan-existing.js` (replace `<framework>` and `<project>`):

```js
const { runProjectSetup } = require("<framework>/dist/config/setup.js");
const { validateProjectContext } = require("<framework>/dist/discovery/contract.js");
const { runExistingProject } = require("<framework>/dist/runtime/existing-project-workflow.js");

(async () => {
  const root = "<project>";
  console.log((runProjectSetup({ project_root: root })).status);

  const project = validateProjectContext({ root, name: "reading-list", kind: "existing" });
  const provider = {
    name: "stub",
    execute: async (request) => ({ status: "succeeded", text: `${request.role} output` }),
  };
  const result = await runExistingProject({
    project,
    request: "Plan the reading-list page for the existing reader app.",
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
    provider,
    timeout_ms: 10000,
  });
  console.log(result.outcome, result.workflow, result.planPath);
})().catch((error) => { console.error(`planning failed: ${error.message}`); process.exit(1); });
```

```bash
node plan-existing.js
```

Expected:

```text
already-configured
completed existing-project <project>/.ai-team/plans/sprint-reading-list.json
```

`completed` with the `existing-project` tag plus the plan path is
success: discovery analyzed the root (the result carries the
`discovery` report — inspect `result.discovery.findings` before
trusting any claim about the project), all three planning sections
were approved by both authorities, and the plan was persisted and
read back. Confirm the file exists with your sprint and task ids, and
confirm your source tree is still otherwise untouched (`git status`
shows only `.ai-team/`).

The other outcomes: `failed` with `stage: "discovery"` (unreadable
root — the workflow stops before any planning call, and `discovery`
is absent); any later `failed` stage (named stage plus message, with
the discovery report attached); `changes-required` (an approval asked
for changes — adjust the PM/TL inputs and re-run; nothing was
persisted). Passing `kind: "new"` throws instead of running. None of
these is a plan — never describe them as one.

Notes on the inputs:

- Provider reports stay opaque: the plan comes from your structured
  PM/TL fields, never parsed from provider text. Swap the stub's text
  and the plan is unchanged. The stub stands in for a real agent
  provider (see `docs/providers-opencode.md`); it is not an analysis.
- The two approvals are explicit caller decisions with matching
  PM/TL identities — the roles never approve on your behalf.
- `tasks` need `id`, `title`, `description`, `requirements`,
  `acceptance_criteria`, and a valid `specialty` (`backend`,
  `frontend`, `integration`, `database`, `testing`, `documentation`).

## 8. What comes next

- **Implement the planned feature** with the matching lifecycle
  (`runFastBugLifecycle`, `runStandardFeatureLifecycle`, or
  `runFullFeatureLifecycle`) — same explicit-input style. Details:
  `docs/roles.md`.
- **Individual roles and manual handoffs** are covered by the
  Individual Role Usage Guide (T-047, forthcoming) — this guide
  stops at the planned, persisted Sprint/Task plan.
- **Delegate (optional)**: the delegate-skills transport handles the
  implementer destination only — it never runs the whole team, and
  the manual path above works without it.
  See `docs/providers-delegate-skills.md`.
- **Problems**: `docs/troubleshooting.md`; configuration reference:
  `docs/configuration.md`.
