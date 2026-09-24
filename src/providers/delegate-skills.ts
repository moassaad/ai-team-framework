/**
 * Delegate-skills adapter (D-003).
 *
 * The first concrete `DelegateProvider`: runs the `delegate-skills`
 * command with the request texts as positional arguments and maps the
 * textual output to the generic result. All capability-specific logic
 * lives in this module; core code only sees the generic contract from
 * `./delegate`. No subcommands or flags are assumed: the repository
 * documents no delegate-skills protocol, so the adapter passes
 * exactly the request texts and leaves interpretation to the tool.
 *
 * Single attempt per `delegate()` call, no shell, no output shaping
 * beyond the raw textual outcome. Rejects on process failure with a
 * minimal message and no captured output attached.
 */

import { spawn } from "node:child_process";
import {
  DelegateProvider,
  DelegationRequest,
  validateDelegationRequest,
  validateDelegationResult,
} from "./delegate";

/** Stable provider identifier exposed through the generic contract. */
export const DELEGATE_PROVIDER_NAME = "delegate" as const;

/** Capability executable. Always this command; never caller-supplied. */
export const DELEGATE_SKILLS_COMMAND = "delegate-skills" as const;

/** Minimal readable-stream surface needed to collect output. */
export interface DelegateOutputStream {
  on(event: "data", listener: (chunk: Buffer | string) => void): void;
}

/** Minimal child-process surface used by this provider. */
export interface DelegateSpawnedProcess {
  readonly stdout: DelegateOutputStream | null;
  on(event: "close", listener: (code: number | null) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
}

/** Process-launch options fixed by this provider. */
export interface DelegateSpawnOptions {
  readonly shell: false;
}

/**
 * Launch-function seam. Production uses `spawn` directly; tests inject
 * a fake. Local to this provider, not a general injection mechanism.
 */
export interface DelegateSpawnFunction {
  (command: string, args: readonly string[], options: DelegateSpawnOptions): DelegateSpawnedProcess;
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: DelegateSpawnOptions,
): DelegateSpawnedProcess {
  return spawn(command, [...args], { shell: options.shell });
}

function runOnce(spawnFn: DelegateSpawnFunction, invocation: DelegationRequest): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let child: DelegateSpawnedProcess;
    try {
      const args =
        invocation.context === undefined ? [invocation.task] : [invocation.task, invocation.context];
      child = spawnFn(DELEGATE_SKILLS_COMMAND, args, { shell: false });
    } catch {
      reject(new Error("delegate provider: failed to start process"));
      return;
    }
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", () => {
      reject(new Error("delegate provider: process error"));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`delegate provider: process exited with code ${code}`));
      }
    });
  });
}

/**
 * Build a delegate-skills provider. The optional launcher exists for
 * tests; production callers use the default. One launcher call per
 * `delegate()`. Availability is a separate D-002 concern: this
 * adapter never checks it, so construction works with any launcher.
 */
export function createDelegateSkillsProvider(
  spawnFn: DelegateSpawnFunction = defaultSpawn,
): DelegateProvider {
  return {
    name: DELEGATE_PROVIDER_NAME,
    delegate: async (request: DelegationRequest) => {
      const invocation = validateDelegationRequest(request);
      const output = await runOnce(spawnFn, invocation);
      if (output.length === 0) {
        throw new Error("delegate provider: unexpected result");
      }
      return validateDelegationResult({ outcome: output });
    },
  };
}
