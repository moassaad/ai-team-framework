# Existing-Project Example: Notes API

A complete walkthrough of using the framework with a project that
already exists. The sample is a tiny Python/Flask API — chosen
because it is small and framework-neutral, not because the
framework prefers Python. Every discovery claim below was produced
by running the real detectors against the shown fixture.

## Principle

```text
Discover → Analyze → Decide → Implement → Review
```

The existing project determines the technical context; the
framework coordinates the work. Nothing is assumed about your
stack: discovery reports what it finds, marks the rest `unknown`
or `not_detected`, and never guesses.

## Sample project tree

```text
notes/
├── requirements.txt   # flask==3.0.0, pytest==8.0.0
├── pytest.ini         # [pytest] testpaths = tests
├── src/app.py         # Flask app, GET /notes
├── tests/test_notes.py
├── README.md          # "# Notes — A tiny note-taking API."
└── .gitignore         # __pycache__/
```

No lockfile, no build config, no frontend, no database config.
That sparseness is deliberate — watch how the framework handles
absence.

## Discovery (actually executed)

Running `generateProjectAnalysis({ root })` over this tree yields:

| Category | Status | Value |
|---|---|---|
| languages | detected | `python` (`requirements.txt`) |
| backend_framework | detected | `flask 3.0.0` (`requirements.txt`) |
| frontend_framework | unknown | — |
| database | not_detected | assessed `requirements.txt`, no database dep |
| package_managers | not_detected | no lockfile — pip vs poetry not guessed |
| build_tools | not_detected | no build config found |
| testing_tools | detected | `pytest` (`pytest.ini`) |
| git | detected | `gitignore` (`.gitignore`) |
| naming_conventions | unknown | — |
| architecture | unknown | — (no architecture doc; directory names ignored) |
| documentation | detected | `readme` (`README.md`) |
| technical_constraints | unknown | — |

Note what did *not* happen: no frontend invented from `src/`, no
database assumed, no package manager picked without a lockfile, no
architecture inferred from directory layout. Unknown stays unknown.

## User request

```text
"Add CSV export for the existing notes list."
```

Small enough for one ticket: one endpoint, one format, no schema
change.

## Requirements and scope (Project Manager)

- **Requirement:** users can download all notes as a CSV file with
  `id` and `text` columns.
- **Scope:** new `GET /notes.csv` route reusing the existing
  in-memory list; one test asserting status, content type, and both
  columns.
- **Acceptance criteria:** `GET /notes.csv` returns 200 with
  `text/csv`, all notes present, existing `/notes` unchanged,
  project test suite passes.
- **Out of scope (stated, not assumed):** file downloads to disk,
  authentication, pagination, other formats. Anything beyond the
  request above would be sent back as a clarification question,
  not invented.

## Technical planning (Technical Lead)

Grounded in the discovered facts only:

- Relevant files: `src/app.py` (route lives next to `list_notes`),
  `tests/test_notes.py` (house style: plain asserts).
- Constraints: Python/Flask 3 per `requirements.txt`; pytest per
  `pytest.ini`; no build step to update (none detected); README
  documents the API in one paragraph — extend it by one line.
- Dependencies: none beyond the existing Flask install.
- Validation: the project's own runner (`pytest`), plus a manual
  `GET /notes.csv` check.

## Example ticket

```text
Ticket ID: T-001
Goal: Add GET /notes.csv exporting all notes as CSV.
Context: Notes API (Python/Flask 3.0.0, pytest). Existing route
  GET /notes in src/app.py returns the in-memory list as JSON.
  No database, no frontend, no build step (per discovery).
Allowed files: src/app.py, tests/test_notes.py, README.md
Forbidden changes: schema/storage changes, new dependencies,
  changes to GET /notes behavior, architecture restructuring.
Inputs: Requirement and acceptance criteria above.
Expected outputs: CSV route, one passing test, README line.
Dependencies: none.
Acceptance criteria: GET /notes.csv → 200 text/csv with id,text
  columns and all notes; GET /notes unchanged; pytest passes.
Validation commands: pytest
Stop conditions: missing test library, ambiguous CSV format
  decision, any failure outside the allowed files.
```

## Implementation (illustrative)

The Implementer receives only this ticket: add the route, add the
test, update the README line, run `pytest`, report exactly what
changed. No rewrite, no new dependency, no scope expansion. This
stage is shown as the framework defines it — the example feature
was not executed end-to-end by the CLI here.

## Senior Review (illustrative)

Review checks the implementation against the ticket: both CSV
columns present, `/notes` untouched, test passes, conventions kept
(plain asserts, neighboring route style). Findings or an explicit
clean report go back to the Technical Lead; the reviewer modifies
nothing and approves nothing.

## Workflow continuation

With default manual configuration the ticket then follows the
standard path: technical approval on clean review, PM review of
business acceptance, explicit user approval, closure — and only
then the next ticket. Successful implementation alone closes
nothing. Full rules: `docs/workflow.md`.

## What the framework does NOT do

- Replace the Flask structure with a preferred stack.
- Assume Laravel, React, Java, or anything else.
- Invent the CSV column format beyond the stated requirement.
- Implement unrelated tickets alongside this one.
- Let execution approve or close the work.
- Require GitHub (the local issue provider suffices) or
  delegate-skills (optional, not installed here).

## Walkthrough summary

```text
1. Start in the existing project (notes/ above).
2. Run the Coordinator: node dist/index.js run
3. Discover the project (Technical Lead; findings table above).
4. Review the analysis — including every unknown.
5. Confirm the change request with the PM (scope above).
6. Produce the technical plan from discovered facts only.
7. Create one implementation ticket (T-001 above).
8. Implement within the allowed files.
9. Review without modifying.
10. Approve and close per the manual workflow.
```

Steps 1–2 use the real CLI today; steps 3–10 describe role
activities through the framework's library modules and contracts,
not additional CLI commands — no interactive prompts are implied
beyond what `ai-team run` implements.
