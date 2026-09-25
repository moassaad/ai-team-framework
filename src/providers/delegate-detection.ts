/**
 * Delegate-skill capability detection (D-102).
 *
 * Replaces the historical executable-based availability check (D-002,
 * classified replace in D-101) with detection for the current
 * Skills/relay model over the M14 foundation (I-001): for one
 * requested delegate skill, establish whether its material is present
 * and whether its required implementer capability is sufficiently
 * present for a later delegation adapter — without dispatching work.
 *
 * Detection order, each step read-only, short-circuiting on the first
 * reliable absence:
 *
 * ```text
 * 1. `<root>/<skill>/SKILL.md` readable in a bounded caller-supplied
 *    root list (no home-tree walk, no recursive search);
 * 2. `<root>/<skill>/scripts/relay.mjs` readable beside it;
 * 3. `<implementer> --version` exits 0 (fixed argv, no shell);
 * 4. `git --version` exits 0 (relay prerequisite).
 * ```
 *
 * Skill presence, relay presence, and implementer presence stay
 * distinct facts in the result detail. Authentication is not probed:
 * no safe read-only signal exists, so availability always carries
 * that limitation instead of guessing. No version text is parsed, no
 * version is rejected as unknown, no model/lane/session/fleet state
 * exists here. `delegate-setup` is never consulted.
 *
 * Fresh every call: no cache, no persistence, no registry mutation,
 * no config reads (`delegate.enabled` is user intent, never
 * evidence), no writes anywhere. The historical PATH probe and
 * executable adapter are untouched dead paths; this module is the
 * active detection boundary.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DetectionResult,
  Integration,
  validateDetectionResult,
} from "./integration";

/** Stable integration identity, local to this concrete module. */
export const DELEGATE_SKILLS_INTEGRATION_NAME = "delegate" as const;

/** Skill descriptor filename. Always this name; never caller-supplied. */
const SKILL_DESCRIPTOR = "SKILL.md" as const;

/** Relay script path inside a skill directory. Always this path. */
const RELAY_SCRIPT = ["scripts", "relay.mjs"] as const;

/** Hang guard for the read-only version probes. */
const COMMAND_TIMEOUT_MS = 30_000;

/** Completed read-only command execution. */
export interface DelegateCommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
}

/** Launch-function seam. Production spawns directly; tests inject a fake. */
export interface DelegateCommandRunner {
  (
    command: string,
    args: readonly string[],
    options: { readonly cwd: string },
  ): DelegateCommandResult | Promise<DelegateCommandResult>;
}

/** File-read seam. Throws when the file is missing or unreadable. */
export interface DelegateFileReader {
  (absolutePath: string): string | Promise<string>;
}

export interface DelegateSkillIntegrationOptions {
  /**
   * Requested delegate skill identifier (e.g. `"opencode-delegate"`).
   * One skill per integration instance; nothing is ever scanned for
   * every `*-delegate` skill.
   */
  readonly skillName: string;
  /**
   * Implementer CLI the requested skill requires (e.g. `"opencode"`),
   * resolved by the caller from the skill's own documentation. No
   * global implementer table lives here.
   */
  readonly implementerCommand: string;
  /**
   * Bounded candidate locations holding installed skills. Each entry
   * is checked as `<root>/<skillName>/` only — never walked, never
   * globbed. Empty means detection cannot establish anything and
   * every call fails closed.
   */
  readonly skillRoots: readonly string[];
  /** Command runner; defaults to a `spawnSync` runner with no shell. */
  readonly runCommand?: DelegateCommandRunner;
  /** File reader; defaults to a UTF-8 read. */
  readonly readFile?: DelegateFileReader;
}

function fail(what: string): never {
  throw new Error(`delegate detection: ${what}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True for failed starts/reads where the target itself is absent. */
function isMissingError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function defaultRunCommand(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string },
): DelegateCommandResult {
  const completed = spawnSync(command, [...args], {
    cwd: options.cwd,
    shell: false,
    encoding: "utf8",
    timeout: COMMAND_TIMEOUT_MS,
  });
  if (completed.error !== undefined) {
    throw completed.error;
  }
  return {
    exitCode: completed.status,
    stdout: typeof completed.stdout === "string" ? completed.stdout : "",
  };
}

function defaultReadFile(absolutePath: string): string {
  return readFileSync(absolutePath, "utf8");
}

/**
 * Build the delegate-skill detection integration for one requested
 * skill. Every `detect()` call re-checks the skill material and
 * re-probes the implementer; nothing is cached, stored, or repaired.
 */
export function createDelegateSkillIntegration(
  options: DelegateSkillIntegrationOptions,
): Integration {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    fail("expected an options object");
  }
  const { skillName, implementerCommand, skillRoots } = options;
  if (typeof skillName !== "string" || skillName.length === 0) {
    fail("skillName must be a non-empty string");
  }
  if (typeof implementerCommand !== "string" || implementerCommand.length === 0) {
    fail("implementerCommand must be a non-empty string");
  }
  if (
    !Array.isArray(skillRoots) ||
    skillRoots.some((root) => typeof root !== "string" || root.length === 0)
  ) {
    fail("skillRoots must be an array of non-empty strings");
  }
  const runCommand = options.runCommand ?? defaultRunCommand;
  if (typeof runCommand !== "function") {
    fail("runCommand must be a function");
  }
  const readFile = options.readFile ?? defaultReadFile;
  if (typeof readFile !== "function") {
    fail("readFile must be a function");
  }

  async function readSkillFile(skillDir: string, relative: string): Promise<string> {
    return readFile(join(skillDir, relative));
  }

  async function locateSkill(): Promise<
    | { found: true; skillDir: string }
    | { found: false; descriptorSeen: boolean }
  > {
    let descriptorSeen = false;
    for (const root of skillRoots) {
      const skillDir = join(root, skillName);
      let descriptor: string;
      try {
        descriptor = await readSkillFile(skillDir, SKILL_DESCRIPTOR);
      } catch (error: unknown) {
        if (isMissingError(error)) {
          continue;
        }
        throw new Error(
          `delegate detection: unable to read ${skillName} descriptor (${errorMessage(error)})`,
        );
      }
      void descriptor;
      descriptorSeen = true;
      try {
        await readSkillFile(skillDir, join(RELAY_SCRIPT[0], RELAY_SCRIPT[1]));
      } catch (error: unknown) {
        if (isMissingError(error)) {
          continue;
        }
        throw new Error(
          `delegate detection: unable to read ${skillName} relay (${errorMessage(error)})`,
        );
      }
      return { found: true, skillDir };
    }
    return { found: false, descriptorSeen };
  }

  async function probeVersion(
    command: string,
    args: readonly string[],
    cwd: string,
    label: string,
  ): Promise<boolean> {
    let completed: DelegateCommandResult;
    try {
      completed = await runCommand(command, args, { cwd });
    } catch (error: unknown) {
      if (isMissingError(error)) {
        return false;
      }
      throw new Error(
        `delegate detection: ${label} probe failed (${errorMessage(error)})`,
      );
    }
    if (completed.exitCode !== 0) {
      throw new Error(
        `delegate detection: ${label} probe failed (exit ${String(completed.exitCode)})`,
      );
    }
    return true;
  }

  async function detect(): Promise<DetectionResult> {
    if (skillRoots.length === 0) {
      fail("no skill discovery locations configured");
    }
    const located = await locateSkill();
    if (!located.found) {
      return validateDetectionResult({
        available: false,
        detail: located.descriptorSeen
          ? `delegate skill "${skillName}" installed but relay missing`
          : `delegate skill "${skillName}" not installed (searched ${String(skillRoots.length)} locations)`,
      });
    }
    if (!(await probeVersion(implementerCommand, ["--version"], located.skillDir, "implementer"))) {
      return validateDetectionResult({
        available: false,
        detail: `implementer "${implementerCommand}" not installed`,
      });
    }
    if (!(await probeVersion("git", ["--version"], located.skillDir, "git prerequisite"))) {
      return validateDetectionResult({
        available: false,
        detail: "git prerequisite not installed",
      });
    }
    return validateDetectionResult({
      available: true,
      detail:
        `delegate skill "${skillName}" installed with relay; ` +
        `implementer "${implementerCommand}" available; ` +
        "authentication not verified",
    });
  }

  return Object.freeze({
    name: DELEGATE_SKILLS_INTEGRATION_NAME,
    capabilities: Object.freeze(["detect"] as const),
    detect,
  });
}
