# Configuration

How the AI Team Framework's project configuration works as implemented
(C-001 through C-005). The implementation under `src/config/` is the
source of truth; this guide describes its actual behavior.

Configuration controls three things: how approval gates behave, which
providers are enabled, and how tickets flow by default. It does not
control role definitions, workflow transitions, or any external tool's
own settings. Beginners: start from section 3 (defaults) and section
12 (examples); the rest is the complete reference.

## 1. Configuration location

Project configuration lives at:

```text
<projectRoot>/.ai-team/config.yaml
```

`.ai-team/` is created inside the **target project** by workspace
initialization. It is not created automatically inside the framework
repository itself.

## 2. Workspace initialization

`initializeWorkspace(projectRoot)` (`src/config/workspace.ts`) creates
the workspace directories:

```text
.ai-team/
├── roles/
├── workflows/
├── state/
├── specs/
├── plans/
├── reviews/
├── reports/
└── logs/
```

Initialization creates **directories only**. No role files, workflow
files, state files, plans, reviews, reports, or logs are generated.
`project.yaml` is not created either. Initialization is additive and
idempotent: missing directories are created, existing content is left
intact, and nothing is ever deleted, overwritten, or renamed.

## 3. Default configuration

`generateDefaultConfig(projectRoot)` (`src/config/defaults.ts`) writes
the following file when `.ai-team/config.yaml` does not exist yet:

```yaml
version: 1

approval:
  mode: manual
  after: ticket
  sensitive_changes: always
  sensitive_rules: []

workflow:
  execution: sequential
  default_state: ready

providers:
  opencode:
    enabled: true
  speckit:
    enabled: false
  github:
    enabled: false
  delegate:
    enabled: false
```

## 4. Configuration fields

Supported fields and values, exactly as implemented
(`src/config/schema.ts`, enforced by `src/config/validator.ts`):

```text
version                                    1 (required)

approval.mode                              manual | automatic
approval.after                             ticket | sprint
approval.sensitive_changes                 always | configured | never
approval.sensitive_rules                   string array

workflow.execution                         sequential
workflow.default_state                     string

providers.opencode.enabled                 boolean
providers.speckit.enabled                  boolean
providers.github.enabled                   boolean
providers.github.owner                     string
providers.github.repo                      string
providers.delegate.enabled                 boolean
```

No other fields or values are supported.

## 5. Required and optional behavior

- `version` is required; only version `1` is supported.
- Every other section and field is optional. Omitted fields receive the
  canonical defaults from section 3 at validation time, so a validated
  configuration is always fully populated.
- Enum fields accept only the values listed in section 4.
- `sensitive_rules` must be an array of strings when present.
- Provider `enabled` values must be booleans when present.
- `github.owner` and `github.repo` must be non-empty strings when
  `github.enabled` is `true`. When GitHub is disabled, neither is required.
- Unknown **top-level** keys are rejected.
- Unknown **provider** keys (directly under `providers`) are rejected.
- There is no blanket policy for unknown keys deeper inside sections;
  they are ignored, not rejected and not interpreted.

## 6. Configuration loading

`loadConfig(projectRoot)` (`src/config/loader.ts`) reads
`<projectRoot>/.ai-team/config.yaml`, parses it as YAML, and returns the
raw unvalidated document. `resolveConfigPath(projectRoot)` returns the
expected file path without touching the filesystem.

- Missing file → `Configuration file not found: <path>`.
- Unreadable file → `Cannot read configuration file <path>: <reason>`.
- Invalid YAML → `Invalid YAML in configuration file <path>: <reason>`.
- Empty, whitespace-only, or comment-only file →
  `Configuration file is empty: <path>`.

Loading and validation are separate concerns: a successfully loaded
value is **not** proven valid until it passes `validateConfig`.

## 7. Validation

`validateConfig(data)` (`src/config/validator.ts`) checks raw loaded
data against the schema and returns the canonical `FrameworkConfig`:
unknown top-level/provider keys rejected, wrong types and enum values
rejected, the GitHub condition enforced, and omitted optional fields
filled with the approved defaults. Failures throw descriptive errors of
the form `config.<path>: <rule>`, for example
`config.approval.mode: expected one of "manual", "automatic", got "sometimes"`.

## 8. Default generation

`buildDefaultConfig()` builds the canonical defaults in memory.
`generateDefaultConfig(projectRoot)` runs the full flow:

```text
ensure workspace
    ↓
build canonical defaults
    ↓
validate defaults
    ↓
serialize YAML
    ↓
write config.yaml
```

Existing-file rule:

> An existing `.ai-team/config.yaml` is preserved byte-for-byte. It is not overwritten, merged, or deleted.

Calling generation again does not replace an existing configuration;
it returns the existing path unchanged.

## 9. Project root behavior

The target project root must already exist and must be a directory;
otherwise initialization and generation fail with an
`Invalid target project root …` error. The initializer and generator
create `.ai-team/` and its subdirectories, but they never create the
user's project directory itself.

## 10. Providers

Only these provider configuration entries exist:

```text
opencode     enabled by default (required first-class execution provider)
speckit      disabled by default (optional)
github       disabled by default (optional)
delegate     disabled by default (optional, never auto-enabled)
```

This is configuration only. Provider execution lives in the
provider modules (`src/providers/`) and is documented separately
(`docs/providers-opencode.md`, `docs/providers-delegate-skills.md`).

## 11. Approval and workflow values

```text
approval.mode:               manual | automatic
approval.after:              ticket | sprint
approval.sensitive_changes:  always | configured | never
workflow.execution:          sequential
workflow.default_state:      ready
```

Listing `after: sprint` as an allowed configuration value does not mean
sprint-level execution or approval is implemented anywhere: its broader
semantics remain deferred (open decision OQ-3), and no sprint behavior
exists in this codebase.

## 12. Copyable examples

Minimal valid configuration (everything else defaulted):

```yaml
version: 1
```

Automatic mode with GitHub tracking:

```yaml
version: 1
approval:
  mode: automatic
providers:
  github:
    enabled: true
    owner: "acme"
    repo: "shop"
```

Opt-in delegation alongside disabled-everything-else. Intent only:
availability, per-action confirmation, and fallback stay separate
enforced boundaries (`docs/providers-delegate-skills.md`).

```yaml
version: 1
providers:
  delegate:
    enabled: true
```

## 13. Sensitive values

Never store tokens, passwords, or credentials in `config.yaml` or
anywhere under `.ai-team/`. Provider authentication is out-of-band
by contract; use placeholders such as `owner: "acme"` in shared
examples.

## Reference

- Contract: `src/config/schema.ts`
- Loading: `src/config/loader.ts`
- Validation: `src/config/validator.ts`
- Workspace: `src/config/workspace.ts`
- Defaults: `src/config/defaults.ts`
- Specification: `docs/specification/configuration.md`
