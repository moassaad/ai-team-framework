import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * Resolve the framework configuration file for a target project.
 * The target project root is always supplied by the caller; nothing
 * is hard-coded and the framework's own directory is never used.
 */
export function resolveConfigPath(projectRoot: string): string {
  return path.join(projectRoot, ".ai-team", "config.yaml");
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code: unknown = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Load `.ai-team/config.yaml` from a target project root and return the
 * parsed document as raw, unvalidated data.
 *
 * This is loading only: read the file, parse the YAML, return the data
 * as-is. The result is typed `unknown` on purpose — only `validateConfig`
 * (C-003) can establish that it satisfies `FrameworkConfig`. Missing
 * optional sections are NOT filled with defaults here and nothing is
 * validated. The only rejections are fundamental load failures: the file
 * is missing, unreadable, empty, or not valid YAML.
 */
export function loadConfig(projectRoot: string): unknown {
  const configPath = resolveConfigPath(projectRoot);

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") {
      throw new Error(`Configuration file not found: ${configPath}`);
    }
    throw new Error(
      `Cannot read configuration file ${configPath}: ${errorMessage(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw) as unknown;
  } catch (error: unknown) {
    throw new Error(
      `Invalid YAML in configuration file ${configPath}: ${errorMessage(error)}`,
    );
  }

  // An empty, whitespace-only, or comment-only file carries no configuration
  // document. The YAML parser represents all of these as a null document,
  // so they are reported here as an empty file rather than passed on as
  // a missing configuration object for C-003 to puzzle over.
  if (parsed === undefined || parsed === null) {
    throw new Error(`Configuration file is empty: ${configPath}`);
  }

  return parsed;
}
