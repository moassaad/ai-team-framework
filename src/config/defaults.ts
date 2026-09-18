import * as fs from "node:fs";
import { stringify as stringifyYaml } from "yaml";
import {
  APPROVAL_DEFAULTS,
  CONFIG_VERSION,
  PROVIDER_DEFAULTS,
  WORKFLOW_DEFAULTS,
  FrameworkConfig,
} from "./schema";
import { validateConfig } from "./validator";
import { initializeWorkspace } from "./workspace";
import { resolveConfigPath } from "./loader";

/**
 * Build the canonical default configuration from the approved C-001
 * defaults. No literals are duplicated here: every value comes from the
 * schema constants (mutable values are copied, never shared by reference).
 */
export function buildDefaultConfig(): FrameworkConfig {
  return {
    version: CONFIG_VERSION,
    approval: {
      mode: APPROVAL_DEFAULTS.mode,
      after: APPROVAL_DEFAULTS.after,
      sensitive_changes: APPROVAL_DEFAULTS.sensitive_changes,
      sensitive_rules: [...APPROVAL_DEFAULTS.sensitive_rules],
    },
    workflow: {
      execution: WORKFLOW_DEFAULTS.execution,
      default_state: WORKFLOW_DEFAULTS.default_state,
    },
    providers: {
      opencode: { enabled: PROVIDER_DEFAULTS.opencode.enabled },
      speckit: { enabled: PROVIDER_DEFAULTS.speckit.enabled },
      github: { enabled: PROVIDER_DEFAULTS.github.enabled },
      delegate: { enabled: PROVIDER_DEFAULTS.delegate.enabled },
    },
  };
}

/**
 * Generate the default `<projectRoot>/.ai-team/config.yaml` and return
 * its path.
 *
 * Ensures the workspace exists via `initializeWorkspace` (which also
 * validates the project root), then writes the validated canonical
 * defaults as YAML. The canonical object is passed through
 * `validateConfig` first so generation fails loudly rather than writing
 * a file that the validator would reject.
 *
 * An existing `config.yaml` is preserved byte-for-byte: it is never
 * read, merged, overwritten, or deleted — generation is a no-op that
 * returns the existing path.
 */
export function generateDefaultConfig(projectRoot: string): string {
  initializeWorkspace(projectRoot);
  const configPath = resolveConfigPath(projectRoot);
  if (fs.existsSync(configPath)) {
    return configPath;
  }
  const canonical = validateConfig(buildDefaultConfig());
  fs.writeFileSync(configPath, stringifyYaml(canonical), "utf8");
  return configPath;
}
