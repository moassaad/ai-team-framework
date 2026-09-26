# GitHub Issues TicketSource and TicketSink (M18 R-009, R-010)

GitHub Issues serves as a concrete read-only `TicketSource`
(`src/providers/github-issues.ts`, factory
`createGitHubIssuesTicketSource`) and a concrete write-only
`TicketSink` (`src/providers/github-sink.ts`, factory
`createGitHubIssuesTicketSink`). The source pages through
`GET /repos/{owner}/{repo}/issues` and converts managed entries
to the existing `CoordinatorTicket` shape; the sink
synchronizes one Coordinator-processed ticket back through a
single `PATCH /repos/{owner}/{repo}/issues/{issue_number}`.
No issue creation, completion endpoint, comments, polling, or
queues; production registration and runtime composition are
deferred to R-011.

- Explicit inputs only: `owner`, `repo`, `token`, `managedLabel`,
  plus an adapter-local `parseState` decoder and an optional
  `parseFeedback` decoder. No credential defaults, no environment
  reads, no configuration keys. The token is sent as a Bearer
  header and never appears in errors or logs.
- Managed selection is explicit: `managedLabel` is required (no
  default) and is sent as the API `labels` filter, so unmanaged
  issues are never downloaded. Pull-request entries
  (`pull_request` key) are excluded locally; the PR API is never
  queried.
- Body grammar reuses the established `## Requirements` section
  the GitHub `IssueProvider` adapter writes: description before
  the heading, requirements after, preserved exactly. An issue
  without an explicit requirements section is a bounded mapping
  failure — requirements are never fabricated.
- Workflow state comes only from caller-supplied `parseState`
  (GitHub open/closed cannot express the 11 workflow states); its
  result is validated against the existing states. A managed
  `changes_requested` entry without decodable feedback is a
  bounded mapping failure, never an executable rework ticket.
- Pagination is sequential at `per_page=100` until a short page;
  GitHub's returned order is preserved (no sorting, the
  Coordinator owns selection). One `listTickets()` call may use
  many HTTP GETs internally but remains a single source
  operation.
- Failures are bounded rejections (`authentication failed`,
  `repository not found` / `issue not found`, `request rejected`,
  `server failure`, `request failed`, mapping errors): no retry, no empty-source
  fabrication, no credential leakage.
- Not registered in the production integration registry and not
  wired into the application runtime or CLI — composition with
  configuration/credentials is a later ticket. The generic
  `TicketSource` contract is unchanged.

## Sink (R-010)

- Same explicit inputs (`owner`, `repo`, `token`,
  `managedLabel`, injectable transport reusing the R-009 seam
  shape with a local fetch default). One bounded GET pre-read
  verifies the managed label, observes the `pull_request` key
  (pull requests are never mutated), and captures current
  labels; at most one PATCH mutation follows.
- Workflow state synchronizes as adapter-local labels
  `<managedLabel>:<state>` (for example
  `ai-team:technical_approval`); unrelated user labels are
  preserved and only AI Team state labels are replaced,
  idempotently. Native open/closed stays separate: only the
  established close convention (`closed`, `cancelled` →
  native `closed`) touches it. Reachable R-008 states
  (`technical_approval`, `changes_requested`, `failed`,
  `implementation_review`) send labels only; any other state
  without a representation fails bounded before HTTP.
- Minimal PATCH payload (labels, plus native `state` only for
  the close convention): title, body, and the `## Requirements`
  section are never sent and therefore never altered.
  Reviewer feedback is never fabricated into comments or body —
  no comment endpoint is called.
- Update operations require the corresponding GitHub Issues
  write permission; failures surface as bounded rejections
  (`issue gone` for 410 included) with no retry, no rollback,
  and no compensating mutation.

## Production composition (R-011)

`runGitHubProductionCoordinator` (`src/runtime/github-production.ts`)
is the one production path: validated `FrameworkConfig` plus
explicit caller inputs into the shared source/sink pair and the
existing source-based application operation. No CLI, scheduler,
polling, provisioning, or registry changes.

- Required configuration (existing keys, unchanged schema):
  `providers.github.enabled: true` with non-empty
  `providers.github.owner` / `providers.github.repo`. A
  disabled or absent GitHub section fails bounded before any
  HTTP; configuration is never mutated.
- Required explicit inputs (never configuration, never
  defaults): `token` (caller-supplied secret, never logged or
  reported), `managedLabel` (no default label is assumed),
  plus the normal application inputs (specialty, OpenCode
  agent, project root, timeout, review verdict).
- State mapping: `decodeManagedLabelState(managedLabel)` is
  the documented default — the round-trip of the R-010 label
  convention (one `<managedLabel>:<state>` label wins; a
  managed issue with no state label is new work, `ready`;
  ambiguous or unknown state labels fail bounded). Override
  with an explicit `parseState` when a repository needs it;
  an optional `parseFeedback` passes through to the source.
- One transport instance is shared by source and sink.
  Construction performs zero HTTP; execution follows source
  → Coordinator → sink with the existing `sync-failed`
  semantics. No labels, tokens, webhooks, or permissions are
  provisioned — missing GitHub resources fail truthfully.

## CLI runtime execution (R-012)

Bare `ai-team run` (`src/cli-run.ts`) executes exactly one
`runGitHubProductionCoordinator` call: one source read, one
Coordinator invocation, at most one ticket, at most one sink
write — then it reports the result and exits. It never runs a
sprint, never retries, never loops.

- Configuration comes from `.ai-team/config.yaml`
  (`providers.github` with `owner`, `repo`, `managedLabel`,
  `specialty`; timeout 5 min, project root is the working
  directory).
- The GitHub token is read from stdin — pipe it in
  (`echo "$GITHUB_TOKEN" | ai-team run`). It never appears in
  arguments, history, logs, output, errors, or on disk, and
  there is intentionally no `--token` flag, no environment
  lookup, and no credential discovery.
- The review verdict is never assumed: after the Senior
  Reviewer report, `ai-team run` asks once whether to approve
  (interactive terminal only; `changes_requested` needs
  verbatim feedback on the spot). Reviewer output stays
  opaque — never parsed, classified, or scored. A piped
  (non-interactive) run without a decision mechanism fails
  safely before `technical_approval` instead of
  auto-approving; reviewer and decision steps never retry.
- Exit codes: `completed` and `no-work` exit 0;
  `conflict`, `implementer-failed`, `reviewer-failed`,
  `decision-failed`, `sync-failed`, configuration failures,
  credential failures, and unexpected errors exit 1 with a
  bounded single-line message. `sync-failed` states explicitly that
  workflow execution advanced but synchronization failed.
