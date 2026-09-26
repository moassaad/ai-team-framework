# GitHub Issues TicketSource (M18 R-009)

GitHub Issues can also serve as a concrete read-only `TicketSource`
(`src/providers/github-issues.ts`, factory
`createGitHubIssuesTicketSource`). It pages through
`GET /repos/{owner}/{repo}/issues` and converts managed entries to
the existing `CoordinatorTicket` shape. Read path only: no issue
updates, creation, completion, comments, or labels; write and
synchronization are deferred to R-010.

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
  `repository not found`, `request rejected`, `server failure`,
  `request failed`, mapping errors): no retry, no empty-source
  fabrication, no credential leakage.
- Not registered in the production integration registry and not
  wired into the application runtime or CLI — composition with
  configuration/credentials is a later ticket. The generic
  `TicketSource` contract is unchanged.
