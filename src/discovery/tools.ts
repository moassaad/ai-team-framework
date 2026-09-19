/**
 * Package-manager and build-tool detection (A-003).
 *
 * Read-only, deterministic, project-agnostic detection of the
 * `package_managers` and `build_tools` categories from a fixed
 * whitelist of lockfiles, manifests, and tool configs. Lockfiles and
 * explicit declarations yield `detected`; an assessed project with no
 * positive evidence yields `not_detected`; a project with no relevant
 * files at all yields `unknown` — never a guess. No writes, no
 * subprocesses, no network, no providers.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  DiscoveryEvidence,
  DiscoveryFinding,
  ProjectContext,
  validateFinding,
  validateProjectContext,
} from "./contract";

function has(root: string, rel: string): boolean {
  try {
    return statSync(join(root, rel)).isFile();
  } catch {
    return false;
  }
}

function readText(root: string, rel: string): string | undefined {
  try {
    const path = join(root, rel);
    if (!statSync(path).isFile()) {
      return undefined;
    }
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function cleanVersion(raw: string): string | undefined {
  const cleaned = raw
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/^[\s^~>=<v]+/, "")
    .split(/[\s,|]+/)[0]
    ?.trim();
  return cleaned && cleaned.length > 0 ? cleaned : undefined;
}

/** Lockfile path to canonical package-manager name, fixed order. */
const LOCKFILES: Array<[rel: string, manager: string]> = [
  ["package-lock.json", "npm"],
  ["yarn.lock", "yarn"],
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["composer.lock", "composer"],
  ["poetry.lock", "poetry"],
  ["uv.lock", "uv"],
  ["go.sum", "go modules"],
  ["Cargo.lock", "cargo"],
  ["Gemfile.lock", "bundler"],
];

/**
 * Single-manager manifests: the file format belongs to exactly one
 * package manager, so presence positively establishes it. Ambiguous
 * manifests (package.json, pyproject.toml, requirements.txt) are
 * deliberately excluded — they need a lockfile or declaration.
 */
const MANAGER_MANIFESTS: Array<[rel: string, manager: string]> = [
  ["go.mod", "go modules"],
  ["Cargo.toml", "cargo"],
  ["Gemfile", "bundler"],
  ["composer.json", "composer"],
  ["pom.xml", "maven"],
  ["build.gradle", "gradle"],
  ["build.gradle.kts", "gradle"],
];

/** Build-config path to generic build-tool name, fixed order. */
const BUILD_CONFIGS: Array<[rel: string, tool: string]> = [
  ["vite.config.ts", "vite"],
  ["vite.config.js", "vite"],
  ["vite.config.mts", "vite"],
  ["vite.config.mjs", "vite"],
  ["webpack.config.js", "webpack"],
  ["webpack.config.ts", "webpack"],
  ["webpack.config.cjs", "webpack"],
  ["webpack.config.mjs", "webpack"],
  ["rollup.config.js", "rollup"],
  ["rollup.config.ts", "rollup"],
  ["rollup.config.mjs", "rollup"],
  ["Makefile", "make"],
  ["makefile", "make"],
  ["GNUmakefile", "make"],
  ["CMakeLists.txt", "cmake"],
  ["pom.xml", "maven"],
  ["build.gradle", "gradle"],
  ["build.gradle.kts", "gradle"],
  ["Cargo.toml", "cargo"],
  ["tsconfig.json", "tsc"],
];

/** Binary names recognized inside package.json script commands. */
const SCRIPT_TOOLS: Array<[binary: string, tool: string]> = [
  ["vite", "vite"],
  ["webpack", "webpack"],
  ["rollup", "rollup"],
  ["esbuild", "esbuild"],
  ["parcel", "parcel"],
  ["tsc", "tsc"],
];

interface ToolEvidence {
  managers: Array<{ name: string; ref: string; note?: string }>;
  tools: Array<{ name: string; ref: string; note?: string }>;
  assessedRefs: string[];
}

function pushUnique(
  target: Array<{ name: string; ref: string; note?: string }>,
  entry: { name: string; ref: string; note?: string },
): void {
  if (!target.some((item) => item.name === entry.name)) {
    target.push(entry);
  }
}

function packageManagerField(root: string, evidence: ToolEvidence): void {
  const text = readText(root, "package.json");
  if (text === undefined) {
    return;
  }
  let field: unknown;
  try {
    field = (JSON.parse(text) as Record<string, unknown>)["packageManager"];
  } catch {
    return;
  }
  if (typeof field !== "string") {
    return;
  }
  const at = field.lastIndexOf("@");
  const name = at > 0 ? field.slice(0, at) : field;
  const version = at > 0 ? cleanVersion(field.slice(at + 1)) : undefined;
  if (name) {
    pushUnique(evidence.managers, {
      name: version ? `${name} ${version}` : name,
      ref: "package.json",
      note: "packageManager field",
    });
  }
}

function packageJsonScripts(root: string, evidence: ToolEvidence): void {
  const text = readText(root, "package.json");
  if (text === undefined) {
    return;
  }
  let scripts: unknown;
  try {
    scripts = (JSON.parse(text) as Record<string, unknown>)["scripts"];
  } catch {
    return;
  }
  if (typeof scripts !== "object" || scripts === null) {
    return;
  }
  for (const [name, command] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof command !== "string") {
      continue;
    }
    for (const [binary, tool] of SCRIPT_TOOLS) {
      if (new RegExp(`(^|[\\s"';=&|])${binary}(\\s|$)`).test(command)) {
        pushUnique(evidence.tools, { name: tool, ref: "package.json", note: `script "${name}"` });
      }
    }
  }
}

function collect(root: string): ToolEvidence {
  const evidence: ToolEvidence = { managers: [], tools: [], assessedRefs: [] };
  const assessed = (rel: string): void => {
    if (!evidence.assessedRefs.includes(rel)) {
      evidence.assessedRefs.push(rel);
    }
  };

  for (const [rel, manager] of LOCKFILES) {
    if (has(root, rel)) {
      assessed(rel);
      pushUnique(evidence.managers, { name: manager, ref: rel });
    }
  }
  for (const [rel, manager] of MANAGER_MANIFESTS) {
    if (has(root, rel)) {
      assessed(rel);
      pushUnique(evidence.managers, { name: manager, ref: rel });
    }
  }
  // Ambiguous manifests: assess the project but never name a manager.
  for (const rel of ["package.json", "requirements.txt", "pyproject.toml", "Pipfile", "setup.py", "setup.cfg"]) {
    if (has(root, rel)) {
      assessed(rel);
    }
  }
  packageManagerField(root, evidence);
  for (const [rel, tool] of BUILD_CONFIGS) {
    if (has(root, rel)) {
      assessed(rel);
      pushUnique(evidence.tools, { name: tool, ref: rel });
    }
  }
  packageJsonScripts(root, evidence);
  return evidence;
}

function toEvidence(entries: Array<{ ref: string; note?: string }>): DiscoveryEvidence[] {
  return entries.map((entry) =>
    entry.note ? { kind: "manifest" as const, ref: entry.ref, note: entry.note } : { kind: "manifest" as const, ref: entry.ref },
  );
}

/**
 * Detect package managers and build tools under `context.root`.
 * Read-only and deterministic: the same root always yields the same
 * validated findings; nothing is written, executed, or contacted.
 */
export function detectProjectTools(context: ProjectContext): DiscoveryFinding[] {
  const { root } = validateProjectContext(context);
  try {
    if (!statSync(root).isDirectory()) {
      throw new Error();
    }
  } catch {
    throw new Error(`discovery: project root is not a readable directory: ${root}`);
  }

  const found = collect(root);
  const assessed = toEvidence(found.assessedRefs.map((ref) => ({ ref })));
  return [
    found.managers.length > 0
      ? validateFinding({
          category: "package_managers",
          status: "detected",
          value: found.managers.map((entry) => entry.name).join(", "),
          evidence: toEvidence(found.managers),
        })
      : found.assessedRefs.length > 0
        ? validateFinding({ category: "package_managers", status: "not_detected", evidence: assessed })
        : validateFinding({ category: "package_managers", status: "unknown" }),
    found.tools.length > 0
      ? validateFinding({
          category: "build_tools",
          status: "detected",
          value: found.tools.map((entry) => entry.name).join(", "),
          evidence: toEvidence(found.tools),
        })
      : found.assessedRefs.length > 0
        ? validateFinding({ category: "build_tools", status: "not_detected", evidence: assessed })
        : validateFinding({ category: "build_tools", status: "unknown" }),
  ];
}
