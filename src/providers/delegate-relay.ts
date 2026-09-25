/**
 * Relay-based delegate provider (D-104).
 *
 * The first real delegation execution path through the current
 * delegate-skills model: one bounded `DelegationRequest` becomes one
 * self-contained brief, dispatched once through an installed
 * `*-delegate` skill's bundled relay as `node
 * <skillRoot>/scripts/relay.mjs --brief <brief> [--model <model>]
 * --cd <projectRoot> --out-dir <tempDir>` (verified upstream
 * invocation), then the structured `<outDir>/result.json`
 * (`delegate-relay.result.v1`) decides the outcome. No fleet, no
 * queue, no resume, no read-only mode, no lanes — direct explicit
 * skill selection only.
 *
 * The provider owns dispatch alone. It never reviews, approves,
 * commits, pushes, retries, falls back, authenticates, configures, or
 * touches workflow state; the brief explicitly forbids committing so
 * the reviewer-owned commit boundary holds. Its own direct writes are
 * limited to the isolated temp dir (brief + relay artifacts, cleaned
 * afterwards best-effort); target project files are written only by
 * the delegated implementer, which is the purpose of delegation.
 * Single attempt per `delegate()` call, fixed argument arrays, no
 * shell, bounded process timeout (constructor-overridable).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DelegateProvider,
  DelegationRequest,
  DelegationResult,
  validateDelegationRequest,
  validateDelegationResult,
} from "./delegate";
import {
  DelegateCommandResult,
  defaultRunCommand,
} from "./delegate-detection";
import type { DelegateCommandRunner } from "./delegate-detection";

/** Relay script path inside a skill root. Always this path. */
const RELAY_SCRIPT = ["scripts", "relay.mjs"] as const;

/** Brief filename inside the isolated output directory. */
const BRIEF_FILENAME = "brief.txt" as const;

/** Structured relay result filename inside the output directory. */
const RESULT_FILENAME = "result.json" as const;

/** Result-format version this provider understands. */
const RESULT_SCHEMA = "delegate-relay.result.v1" as const;

/** Bounded process wait default: implementation runs take a while. */
const DEFAULT_TIMEOUT_MS = 1_800_000;

/**
 * Minimal filesystem seam: the only direct writes this provider ever
 * performs live behind it, so tests stay hermetic and production stays
 * explicit. Covers exactly one temp dir lifecycle plus two file reads.
 */
export interface DelegateRelayFileSystem {
  writeFile(path: string, content: string): void | Promise<void>;
  readFile(path: string): string | Promise<string>;
  makeTempDir(prefix: string): string | Promise<string>;
  removeDir(path: string): void | Promise<void>;
}

/** Default filesystem: Node built-ins, temp dirs under the OS temp dir. */
export function defaultDelegateRelayFileSystem(): DelegateRelayFileSystem {
  return Object.freeze({
    writeFile: (path: string, content: string): void => {
      writeFileSync(path, content, "utf8");
    },
    readFile: (path: string): string => readFileSync(path, "utf8"),
    makeTempDir: (prefix: string): string => mkdtempSync(join(tmpdir(), prefix)),
    removeDir: (path: string): void => {
      rmSync(path, { recursive: true, force: true });
    },
  });
}

export interface DelegateRelayProviderOptions {
  /** Requested skill identifier (e.g. `"opencode-delegate"`), for brief/errors. */
  readonly skillName: string;
  /** Resolved installed skill directory containing `SKILL.md`. */
  readonly skillRoot: string;
  /** Target project root: relay `--cd` and child process working directory. */
  readonly projectRoot: string;
  /**
   * Implementer model (skill-specific `provider/model` form). Passed as
   * `--model` only when supplied; never invented.
   */
  readonly model?: string;
  /**
   * True when the selected skill requires `--model` on a fresh run
   * (verified per-skill truth, e.g. opencode-delegate). Missing model
   * then fails before launch. Defaults to false.
   */
  readonly requireModel?: boolean;
  /** Process bound in milliseconds. Must be positive and finite. */
  readonly timeoutMs?: number;
  /** Process launcher; defaults to the shared no-shell runner. */
  readonly runCommand?: DelegateCommandRunner;
  /** Filesystem seam; defaults to Node built-ins. */
  readonly files?: DelegateRelayFileSystem;
}

function fail(what: string): never {
  throw new Error(`delegate provider: ${what}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildBrief(skillName: string, request: DelegationRequest): string {
  return [
    `# Delegated Task (via ${skillName})`,
    "",
    "## Task",
    request.task,
    "",
    "## Current context",
    request.context ?? "Not provided.",
    "",
    "## Scope",
    "Implement exactly what the task requests. Do not expand scope.",
    "",
    "## Constraints",
    "- Do not commit changes.",
    "- Do not push, merge, or create branches.",
    "",
    "## Expected report",
    "End with a concise final summary of what changed and which checks were run.",
    "",
  ].join("\n");
}

interface RelayResult {
  readonly status: string;
  readonly finalMessage: unknown;
}

/**
 * Build a relay-based delegate provider. Construction performs no
 * calls; every `delegate()` validates, dispatches once, reads the
 * structured result, and cleans its temp dir on every path.
 */
export function createDelegateRelayProvider(
  options: DelegateRelayProviderOptions,
): DelegateProvider {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    fail("expected an options object");
  }
  const { skillName, skillRoot, projectRoot } = options;
  if (typeof skillName !== "string" || skillName.length === 0) {
    fail("skillName must be a non-empty string");
  }
  if (typeof skillRoot !== "string" || skillRoot.length === 0) {
    fail("skillRoot must be a non-empty string");
  }
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    fail("projectRoot must be a non-empty string");
  }
  const model = options.model;
  if (model !== undefined && (typeof model !== "string" || model.length === 0)) {
    fail("model must be a non-empty string");
  }
  const requireModel = options.requireModel ?? false;
  if (typeof requireModel !== "boolean") {
    fail("requireModel must be a boolean");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    fail("timeoutMs must be a positive finite number");
  }
  const runCommand = options.runCommand ?? defaultRunCommand;
  if (typeof runCommand !== "function") {
    fail("runCommand must be a function");
  }
  const files = options.files ?? defaultDelegateRelayFileSystem();
  if (typeof files !== "object" || files === null) {
    fail("files must be a filesystem seam object");
  }
  for (const method of ["writeFile", "readFile", "makeTempDir", "removeDir"] as const) {
    if (typeof files[method] !== "function") {
      fail(`files.${method} must be a function`);
    }
  }
  const relayPath = join(skillRoot, RELAY_SCRIPT[0], RELAY_SCRIPT[1]);

  async function delegate(request: DelegationRequest): Promise<DelegationResult> {
    const invocation = validateDelegationRequest(request);
    if (requireModel && model === undefined) {
      fail(
        `model is required by skill "${skillName}"; ` +
          "supply model explicitly (no default is assumed)",
      );
    }
    try {
      await files.readFile(relayPath);
    } catch (error: unknown) {
      fail(`relay not available at ${relayPath} (${errorMessage(error)})`);
    }
    const outDir = await files.makeTempDir("ai-team-delegate-");
    const briefPath = join(outDir, BRIEF_FILENAME);
    try {
      await files.writeFile(briefPath, buildBrief(skillName, invocation));
      const args = [
        relayPath,
        "--brief",
        briefPath,
        ...(model === undefined ? [] : ["--model", model]),
        "--cd",
        projectRoot,
        "--out-dir",
        outDir,
      ];
      let completed: DelegateCommandResult;
      try {
        completed = await runCommand("node", args, { cwd: projectRoot, timeoutMs });
      } catch (error: unknown) {
        fail(`relay failed to start (${errorMessage(error)})`);
      }
      let raw: string;
      try {
        raw = await files.readFile(join(outDir, RESULT_FILENAME));
      } catch {
        fail(
          `result.json unavailable (relay exit ${String(completed.exitCode)}` +
            (completed.exitCode === null || completed.exitCode === undefined
              ? `; timeout ${String(timeoutMs)}ms bound exceeded or process killed`
              : "") +
            ")",
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        fail(`result.json malformed (relay exit ${String(completed.exitCode)})`);
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        fail(`result.json malformed (relay exit ${String(completed.exitCode)})`);
      }
      const record = parsed as Record<string, unknown>;
      if (
        record.schema !== undefined &&
        record.schema !== RESULT_SCHEMA
      ) {
        fail(`unsupported result schema ${JSON.stringify(record.schema)}`);
      }
      const result: RelayResult = {
        status: typeof record.status === "string" ? record.status : "",
        finalMessage: record.finalMessage,
      };
      if (result.status !== "completed") {
        fail(
          `relay reported "${result.status === "" ? "unknown" : result.status}" ` +
            `(exit ${String(completed.exitCode)})`,
        );
      }
      const outcome =
        typeof result.finalMessage === "string" && result.finalMessage.length > 0
          ? result.finalMessage
          : `completed with no final report (exit ${String(completed.exitCode)})`;
      return validateDelegationResult({ outcome });
    } finally {
      try {
        await files.removeDir(outDir);
      } catch {
        // Best-effort cleanup of our own temp dir; never fails delegation.
      }
    }
  }

  return { name: skillName, delegate };
}
