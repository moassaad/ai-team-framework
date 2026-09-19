/**
 * OpenCode execution provider (O-002).
 *
 * The first concrete `AgentProvider`: runs the non-interactive
 * `opencode run <prompt>` command with the invocation project root as
 * the working directory. All OpenCode-specific logic lives in this
 * module; core code only sees the generic contract from `./agent`.
 *
 * Single attempt per `execute()` call, no shell, no prompt changes, no
 * outcome shaping beyond the raw textual output (O-004 owns the shared
 * result shape). Rejects on process failure with a minimal message and
 * no captured output attached.
 */

import { spawn } from "node:child_process";
import {
  AgentInvocation,
  AgentProvider,
  validateAgentInvocation,
} from "./agent";

/** Stable provider identifier exposed through the generic contract. */
export const OPENCODE_PROVIDER_NAME = "opencode" as const;

/** Provider executable. Always this command; never caller-supplied. */
export const OPENCODE_COMMAND = "opencode" as const;

/** Minimal readable-stream surface needed to collect output. */
export interface OutputStream {
  on(event: "data", listener: (chunk: Buffer | string) => void): void;
}

/** Minimal child-process surface used by this provider. */
export interface SpawnedProcess {
  readonly stdout: OutputStream | null;
  on(event: "close", listener: (code: number | null) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
}

/** Process-launch options fixed by this provider. */
export interface SpawnInvocationOptions {
  readonly cwd: string;
  readonly shell: false;
}

/**
 * Launch-function seam. Production uses `spawn` directly; tests inject
 * a fake. Local to this provider, not a general injection mechanism.
 */
export interface SpawnFunction {
  (command: string, args: readonly string[], options: SpawnInvocationOptions): SpawnedProcess;
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: SpawnInvocationOptions,
): SpawnedProcess {
  return spawn(command, [...args], { cwd: options.cwd, shell: false });
}

function runOnce(spawnFn: SpawnFunction, invocation: AgentInvocation): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let child: SpawnedProcess;
    try {
      child = spawnFn(
        OPENCODE_COMMAND,
        ["run", invocation.prompt],
        { cwd: invocation.project_root, shell: false },
      );
    } catch {
      reject(new Error("opencode provider: failed to start process"));
      return;
    }
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", () => {
      reject(new Error("opencode provider: process error"));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`opencode provider: process exited with code ${code}`));
      }
    });
  });
}

/**
 * Build an OpenCode provider. The optional launcher exists for tests;
 * production callers use the default. One launcher call per `execute()`.
 */
export function createOpenCodeProvider(
  spawnFn: SpawnFunction = defaultSpawn,
): AgentProvider<string> {
  return {
    name: OPENCODE_PROVIDER_NAME,
    execute: async (request: AgentInvocation): Promise<string> => {
      const invocation = validateAgentInvocation(request);
      return runOnce(spawnFn, invocation);
    },
  };
}
