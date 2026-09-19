# OpenCode Provider Usage (M7)

How the framework executes an agent through the OpenCode provider path.
Covers O-001 through O-005 as implemented. No other provider, workflow,
or CLI integration is described here.

## Execution flow

```text
RoleContract
    ↓
renderRolePrompt(...)            (src/providers/prompt.ts, O-003)
    ↓  finished prompt: string
createOpenCodeProvider(...)      (src/providers/opencode.ts, O-002)
    ↓  AgentProvider<string>
executeWithTimeout(...)          (src/providers/execution.ts, O-005)
    ↓
ExecutionResult                  (src/providers/result.ts, O-004)
       or
ProviderExecutionError
```

Role selection, workflow, and approval stay outside this path. The
provider receives a finished prompt and a project root, nothing else.

## Prerequisites

- The `opencode` executable must be resolvable by the process
  environment. The provider launches it directly; there is no lookup,
  installation, or version check in the framework.
- The `project_root` supplied in the invocation must be a readable
  directory. Launch failures reject through the execution failure path
  below (`kind = "provider_error"`).

## OpenCode invocation

The provider runs exactly:

```text
executable: opencode
arguments:  run <prompt>
working directory: <project_root>
shell: false
```

Details that are intentionally fixed:

- The prompt is passed as a single argument, never embedded in a shell
  command and never modified, prepended to, or templated.
- One provider attempt per `execute()` call. No retry or backoff.
- Successful output is the concatenated process text, resolved as a
  plain `string`. Raw OpenCode payloads (including `--format json`
  event streams), sessions, and transport fields are not exposed.

Not supported by the current provider: model selection (`--model`),
session reuse, streaming, JSON event parsing, TUI usage.

## Prompt rendering

Prompts are built separately with `renderRolePrompt(input)`, where
`input` carries the already-selected `RoleContract`, the verbatim
`task`, and optional already-prepared context (`specialty`,
`project`, `discovery_summary`). Rendering is pure and deterministic;
OpenCode execution never selects roles or builds prompts.

```text
role + task + optional project/discovery context
        ↓
renderRolePrompt
        ↓
provider.execute(...)
```

## Timeout and failure handling

`executeWithTimeout(provider, request, options)` bounds one execution:

- `options.timeout_ms` is required and must be a positive finite
  number. No default is imposed; invalid values reject deterministically
  and the provider is never called.
- Success resolves with the provider's `ExecutionResult`, unchanged.
- After `timeout_ms` with no settlement, the call rejects with
  `ProviderExecutionError` (`kind = "timeout"`,
  `provider execution timed out after <N> ms`).
- A provider rejection becomes `ProviderExecutionError`
  (`kind = "provider_error"`, `provider execution failed`). The
  provider's own error text is intentionally not propagated, so no
  request content, output, or environment data leaks into the message.
- The timer is cleared on every settle (success, timeout, failure).

## Cancellation limitation

The `AgentProvider` contract has no stop mechanism. When the timeout
fires, only the framework-level promise settles; the underlying
`opencode` process may continue running. Timeout is therefore not
process termination. No `AbortController`, kill, or provider-specific
cancellation exists in the current implementation.

## Execution result

```ts
{
  status: "succeeded",
  text: string,
}
```

The shape is intentionally small and provider-agnostic: normalized
successful agent output only. It never contains stdout/stderr/exit
codes, models, tokens, costs, sessions, timestamps, or raw event
payloads. Failures are rejections, not result values.

## Execution failure vs workflow state

`ProviderExecutionError` reports an execution-level outcome
(`timeout` or `provider_error`). It is not a workflow state: it never
means `failed`, `blocked`, `changes_requested`, or `cancelled`, and it
triggers no workflow transition, approval, or retry. Workflow decisions
belong to the workflow layer.

## Usage example

```ts
import { COORDINATOR_ROLE } from "./src/roles/coordinator";
import { renderRolePrompt } from "./src/providers/prompt";
import { createOpenCodeProvider } from "./src/providers/opencode";
import { executeWithTimeout } from "./src/providers/execution";
import { ProviderExecutionError } from "./src/providers/execution";

const prompt = renderRolePrompt({
  role: COORDINATOR_ROLE,
  task: "Summarize the repository layout.",
  project: { root: "/target/project" },
});

const provider = createOpenCodeProvider();

try {
  const result = await executeWithTimeout(
    provider,
    { prompt, project_root: "/target/project" },
    { timeout_ms: 120_000 },
  );
  console.log(result.text);
} catch (error) {
  if (error instanceof ProviderExecutionError) {
    if (error.kind === "timeout") {
      // bounded wait exceeded; underlying process may still run
    } else {
      // provider could not complete the execution
    }
  }
  throw error;
}
```

## Explicitly out of scope

Not implemented and not described as supported: provider registry,
automatic provider selection, CLI role/provider invocation, configured
timeouts, retry, cancellation, streaming, OpenCode JSON event parsing,
multiple simultaneous providers, workflow orchestration, approval
handling, persistence, telemetry, and token/cost accounting.
