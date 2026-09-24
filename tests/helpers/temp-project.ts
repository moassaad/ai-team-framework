/**
 * Shared filesystem-isolation helper for unit tests (T-001).
 *
 * Consolidates the temporary-project setup previously copied into
 * each file-based test: create an isolated directory under the OS
 * temp area, optionally pre-populate it with files, run the test
 * body, then remove the directory. Cleanup runs even when the body
 * throws, and every call gets a fresh unique root, so tests stay
 * deterministic, independent, and free of machine-specific paths.
 * No network, no external tools, no shared mutable state.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Run `fn` with a fresh temporary project root pre-populated with
 * `files` (relative path to UTF-8 content; parent directories are
 * created). The root is removed afterwards, even on failure.
 */
export function withTempProject(
  files: Record<string, string>,
  fn: (root: string) => void,
): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-team-test-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
    }
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Run `fn` with a fresh empty temporary project root. Removed after. */
export function withEmptyTempProject(fn: (root: string) => void): void {
  withTempProject({}, fn);
}

/**
 * Async variant of `withTempProject` for flows that await framework
 * calls inside the body. Cleanup still runs even when the body
 * rejects; the caller must await the returned promise.
 */
export async function withTempProjectAsync(
  files: Record<string, string>,
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-team-test-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf8");
    }
    await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
