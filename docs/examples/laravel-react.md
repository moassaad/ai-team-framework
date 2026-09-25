# Laravel + React Example: Shopdesk Reports

Using the framework with an existing Laravel backend plus React
frontend. The sample project below is synthetic and small; every
discovery claim in the evidence table was produced by running the
real detectors against that exact fixture.

## Principle

```text
Laravel + React are discovered facts about this project.
They are not requirements imposed by the framework.
```

Detectors read manifests at the analyzed project root only. A
split `backend/` + `frontend/` layout would be analyzed per
directory; this example keeps both manifests at one root so a
single analysis covers both ecosystems.

## Sample project tree

```text
shopdesk/
├── composer.json          # example/shopdesk, laravel/framework ^11.0
├── composer.lock          # {}
├── package.json           # shopdesk-reports, react ^18.2.0, vite + vitest dev
├── package-lock.json      # {}
├── vite.config.ts         # defineConfig({})
├── routes/web.php         # Route::get('/reports', [ReportController::class, 'index']);
├── src/ReportsPage.tsx    # <h1>Reports</h1>
├── phpunit.xml            # Unit testsuite → ./tests/Unit
├── README.md              # "Laravel reports backend with a React reports page."
└── .editorconfig / .gitignore
```

No database config, no API client, no state-management library, no
architecture document. Absence is part of the example.

## Discovery (actually executed)

| Area | Detected evidence | Status |
|---|---|---|
| Backend language | `composer.json` | Detected: `php` |
| Backend framework | `composer.json` | Detected: `laravel 11.0` |
| Frontend language | `package.json` | Detected: `javascript` |
| Frontend framework | `package.json` | Detected: `react 18.2.0` |
| Package/build tooling | `composer.lock`, `package-lock.json`, `vite.config.ts` | Detected: `npm, composer` / `vite` |
| Testing | `phpunit.xml`, `package.json` | Detected: `phpunit, vitest` |
| Git conventions | `.gitignore` | Detected: `gitignore` |
| Naming conventions | `.editorconfig` | Detected: `editorconfig` |
| Documentation | `README.md` | Detected: `readme` |
| Database | assessed manifests, no match | Not detected (not assumed) |
| Architecture | no architecture doc | Unknown (directory names ignored) |
| Technical constraints | no version/docker files | Unknown |

Notably *not* claimed: no REST/Inertia/GraphQL assumption (the
fixture contains no API wiring, so the integration mechanism is
unknown), no database, no queue, no deployment story. The
framework adapts to what is there.

## User request

```text
"Add a CSV export button to the existing reports page."
```

Backend plus frontend, but bounded: one route, one button, one
format.

## Requirements and scope (Project Manager)

- **Requirement:** from the reports page, users can download the
  displayed report as CSV.
- **Scope:** `GET /reports.csv` reusing the existing report query;
  a button on `ReportsPage`; one backend test; one frontend test
  update if the project has one.
- **Acceptance criteria:** button visible on the reports page;
  click downloads CSV matching the displayed rows; existing page
  and route unchanged; both test suites pass.
- **Out of scope:** other formats, scheduled exports, auth changes.
- **Clarification needed (asked, not assumed):** how the frontend
  reaches the backend (no API client exists in the fixture) — the
  ticket must define this contract explicitly.

## Technical planning (Technical Lead)

- Affected backend: `routes/web.php` (new route beside the
  existing one), one new controller file for the CSV response.
- Affected frontend: `src/ReportsPage.tsx` (button + download
  handler per the contract the ticket defines).
- Conventions: `.editorconfig` formatting; PHPUnit suite via
  `phpunit.xml`; Vitest via devDependency.
- Dependencies: none new (both ecosystems already present).
- Validation: the project's own PHPUnit and Vitest suites.

## One implementation ticket

```text
Ticket ID: T-001
Goal: Add CSV export button to the reports page with backend download.
Context: Shopdesk (Laravel 11 + React 18, npm + composer, vite,
  phpunit + vitest per discovery). Existing GET /reports route and
  ReportsPage component; no API client in the tree.
Allowed files: routes/web.php,
  app/Http/Controllers/ReportExportController.php (new),
  src/ReportsPage.tsx, tests/, README.md
Forbidden changes: schema/storage changes, new dependencies,
  auth changes, unrelated routes/components, architecture changes.
Inputs: Requirement, scope, and acceptance criteria above,
  including the explicitly defined frontend-backend contract.
Expected outputs: CSV route, button, passing tests, README line.
Dependencies: none.
Acceptance criteria: button downloads CSV matching displayed rows;
  existing page/route unchanged; phpunit and vitest suites pass.
Validation commands: project's PHPUnit suite; project's Vitest suite.
Stop conditions: missing API contract decision, auth implications
  discovered, failures outside the allowed files.
```

## Implementation stage (illustrative)

The Implementer receives only T-001: add the controller and route,
add the button per the ticket's contract, extend tests, run both
suites, report exact changes. Existing Laravel and React
conventions are authoritative; no framework preference replaces
them. Illustrative — the feature was not executed end-to-end here.

## Senior Review (illustrative)

```text
Implementation → Review → Findings or clean report
```

Review checks requirements, backend/frontend consistency (CSV
matches displayed rows), both suites, regressions, and existing
conventions — then reports findings or a clean report. No
modification, no approval, no closure by the reviewer.

## Workflow continuation

Default manual configuration: clean review → technical approval →
PM review → explicit user approval → closed, then the next ticket.
Execution never closes; sprint approval stays deferred (OQ-3).

## What this example demonstrates

- Discover before planning, on the real fixture.
- Respect the existing Laravel + React architecture.
- Separate user requirements (CSV download) from technical
  decisions (the API contract, explicitly clarified).
- Keep one small cross-stack ticket instead of a rewrite.
- Review before approval; never treat execution as approval.
- Report unknown integration details instead of guessing them.

## What this example does NOT demonstrate

- Production deployment of any kind.
- External GitHub synchronization.
- delegate-skills execution.
- Real OpenCode execution of this feature.
- Automatic approval or sprint-level approval.
- Framework-controlled architecture.
- A successfully implemented CSV feature (illustrative stages
  only, labeled as such).
