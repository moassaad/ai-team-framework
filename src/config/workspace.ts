import * as fs from "node:fs";
import * as path from "node:path";

export const WORKSPACE_DIRNAME = ".ai-team";

/**
 * Required workspace subdirectories, relative to `<projectRoot>/.ai-team/`.
 * Exactly the directories from the approved workspace contract
 * (`docs/specification/configuration.md` §1). No more, no fewer.
 */
export const WORKSPACE_SUBDIRECTORIES: readonly string[] = [
  "roles",
  "workflows",
  "state",
  "specs",
  "plans",
  "reviews",
  "reports",
  "logs",
];

/**
 * Resolve the framework workspace directory for a target project.
 * The target project root is always supplied by the caller; nothing
 * is hard-coded and the framework's own directory is never used.
 */
export function resolveWorkspacePath(projectRoot: string): string {
  return path.join(projectRoot, WORKSPACE_DIRNAME);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ensureDirectory(dirPath: string): void {
  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(dirPath);
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      try {
        fs.mkdirSync(dirPath);
      } catch (mkdirError: unknown) {
        throw new Error(
          `Cannot create workspace directory ${dirPath}: ${errorMessage(mkdirError)}`,
        );
      }
      return;
    }
    throw new Error(
      `Cannot inspect workspace path ${dirPath}: ${errorMessage(error)}`,
    );
  }
  if (!stat.isDirectory()) {
    throw new Error(
      `Workspace path exists as a file, expected a directory: ${dirPath}`,
    );
  }
}

/**
 * Initialize the framework workspace (`<projectRoot>/.ai-team/`) for a
 * target project and return the workspace path.
 *
 * Additive and idempotent: missing required directories are created,
 * everything already present is left intact. Never deletes, overwrites,
 * renames, or resets anything, and never touches files outside `.ai-team/`.
 * No configuration files are created — default content belongs to C-005.
 * No configuration is loaded or validated — those belong to C-002/C-003.
 */
export function initializeWorkspace(projectRoot: string): string {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new Error(
      `Invalid target project root: expected a non-empty path, got ${JSON.stringify(projectRoot)}`,
    );
  }

  let rootStat: fs.Stats;
  try {
    rootStat = fs.statSync(projectRoot);
  } catch (error: unknown) {
    throw new Error(
      `Invalid target project root ${JSON.stringify(projectRoot)}: ${errorMessage(error)}`,
    );
  }
  if (!rootStat.isDirectory()) {
    throw new Error(
      `Invalid target project root ${JSON.stringify(projectRoot)}: not a directory`,
    );
  }

  const workspacePath = resolveWorkspacePath(projectRoot);
  ensureDirectory(workspacePath);
  for (const subdir of WORKSPACE_SUBDIRECTORIES) {
    ensureDirectory(path.join(workspacePath, subdir));
  }
  return workspacePath;
}
