/**
 * Project-convention detection (A-005).
 *
 * Read-only, deterministic, project-agnostic detection of the
 * `naming_conventions`, `architecture`, `documentation`, `git`,
 * and `technical_constraints` categories from a fixed whitelist of
 * config files and metadata. Positive evidence yields `detected`;
 * an assessed project with no positive evidence yields
 * `not_detected`; a project with no relevant files at all yields
 * `unknown` — never a guess. No writes, no subprocesses, no network,
 * no providers, no Git history inspection, no statistical inference.
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

function hasDir(root: string, rel: string): boolean {
  try {
    return statSync(join(root, rel)).isDirectory();
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

/** Config-file patterns for naming conventions (formatter/linter configs). */
const NAMING_CONFIGS: Array<[rel: string, convention: string]> = [
  [".editorconfig", "editorconfig"],
  [".prettierrc", "prettier"],
  [".prettierrc.json", "prettier"],
  [".prettierrc.yaml", "prettier"],
  [".prettierrc.yml", "prettier"],
  [".prettierrc.toml", "prettier"],
  [".prettierrc.js", "prettier"],
  [".prettierrc.cjs", "prettier"],
  [".prettierrc.mjs", "prettier"],
  ["prettier.config.js", "prettier"],
  ["prettier.config.cjs", "prettier"],
  ["prettier.config.mjs", "prettier"],
  ["prettier.config.ts", "prettier"],
  ["eslint.config.js", "eslint"],
  ["eslint.config.mjs", "eslint"],
  ["eslint.config.ts", "eslint"],
  [".eslintrc", "eslint"],
  [".eslintrc.json", "eslint"],
  [".eslintrc.yaml", "eslint"],
  [".eslintrc.yml", "eslint"],
  [".eslintrc.js", "eslint"],
  [".eslintrc.cjs", "eslint"],
  [".eslintrc.mjs", "eslint"],
  ["phpcs.xml", "phpcs"],
  ["phpcs.xml.dist", "phpcs"],
  ["checkstyle.xml", "checkstyle"],
  [".golangci.yml", "golangci-lint"],
  [".golangci.yaml", "golangci-lint"],
  [".golangci.toml", "golangci-lint"],
  [".clang-format", "clang-format"],
  ["rustfmt.toml", "rustfmt"],
  ["rustfmt.toml.dist", "rustfmt"],
];

/** Architecture documentation files that explicitly describe architecture. */
const ARCHITECTURE_DOCS: Array<[rel: string, note: string]> = [
  ["ARCHITECTURE.md", "architecture document"],
  ["architecture.md", "architecture document"],
  ["ARCHITECTURE.rst", "architecture document"],
  ["docs/architecture.md", "architecture document"],
  ["docs/ARCHITECTURE.md", "architecture document"],
];

/** Documentation presence files. */
const DOCUMENTATION_FILES: Array<[rel: string, note: string]> = [
  ["README.md", "readme"],
  ["README.rst", "readme"],
  ["README.txt", "readme"],
  ["README", "readme"],
  ["CONTRIBUTING.md", "contributing guide"],
  ["CONTRIBUTING.rst", "contributing guide"],
  ["CHANGELOG.md", "changelog"],
  ["CHANGELOG.rst", "changelog"],
  ["CHANGELOG.txt", "changelog"],
  ["docs/", "docs directory"],
];

/** Git convention evidence. */
const GIT_CONFIGS: Array<[rel: string, note: string]> = [
  [".gitignore", "gitignore"],
  [".gitattributes", "gitattributes"],
  [".git", "git directory"],
];

/** Technical constraint evidence. */
const CONSTRAINT_CONFIGS: Array<[rel: string, note: string]> = [
  [".nvmrc", "node version"],
  [".node-version", "node version"],
  [".python-version", "python version"],
  [".tool-versions", "tool versions"],
  ["Dockerfile", "dockerfile"],
  ["docker-compose.yml", "docker compose"],
  ["docker-compose.yaml", "docker compose"],
];

interface ConventionEvidence {
  naming: Array<{ name: string; ref: string }>;
  architecture: Array<{ name: string; ref: string; note?: string }>;
  documentation: Array<{ name: string; ref: string; note?: string }>;
  git: Array<{ name: string; ref: string; note?: string }>;
  constraints: Array<{ name: string; ref: string; note?: string }>;
  assessedRefs: string[];
}

function pushUnique<T extends { name: string }>(
  target: T[],
  entry: T,
): void {
  if (!target.some((item) => item.name === entry.name)) {
    target.push(entry);
  }
}

function collect(root: string): ConventionEvidence {
  const evidence: ConventionEvidence = {
    naming: [],
    architecture: [],
    documentation: [],
    git: [],
    constraints: [],
    assessedRefs: [],
  };
  const assessed = (rel: string): void => {
    if (!evidence.assessedRefs.includes(rel)) {
      evidence.assessedRefs.push(rel);
    }
  };

  for (const [rel, convention] of NAMING_CONFIGS) {
    if (has(root, rel)) {
      assessed(rel);
      pushUnique(evidence.naming, { name: convention, ref: rel });
    }
  }

  for (const [rel, note] of ARCHITECTURE_DOCS) {
    if (has(root, rel)) {
      assessed(rel);
      const text = readText(root, rel)?.toLowerCase() ?? "";
      const name = text.includes("clean") ? "clean"
        : text.includes("hexagonal") ? "hexagonal"
        : text.includes("layered") ? "layered"
        : text.includes("modular") ? "modular"
        : text.includes("microservice") ? "microservices"
        : "documented";
      pushUnique(evidence.architecture, { name, ref: rel, note });
    }
  }

  for (const [rel, note] of DOCUMENTATION_FILES) {
    if (rel.endsWith("/") ? hasDir(root, rel) : has(root, rel)) {
      assessed(rel);
      const name = rel.endsWith("/") ? "docs" : rel.replace(/^README.*$/, "readme").replace(/^CONTRIBUTING.*$/, "contributing").replace(/^CHANGELOG.*$/, "changelog");
      pushUnique(evidence.documentation, { name, ref: rel, note });
    }
  }

  for (const [rel, note] of GIT_CONFIGS) {
    if (rel === ".git" ? hasDir(root, rel) : has(root, rel)) {
      assessed(rel);
      pushUnique(evidence.git, { name: rel === ".git" ? "git" : rel.replace(/^\./, ""), ref: rel, note });
    }
  }

  for (const [rel, note] of CONSTRAINT_CONFIGS) {
    if (has(root, rel)) {
      assessed(rel);
      let name: string;
      if (rel === ".nvmrc" || rel === ".node-version") name = "node version";
      else if (rel === ".python-version") name = "python version";
      else if (rel === ".tool-versions") name = "tool versions";
      else if (rel.startsWith("Dockerfile")) name = "docker";
      else if (rel.startsWith("docker-compose")) name = "docker compose";
      else name = rel;
      pushUnique(evidence.constraints, { name, ref: rel, note });
    }
  }

  return evidence;
}

function toEvidence(entries: Array<{ ref: string; note?: string }>): DiscoveryEvidence[] {
  return entries.map((entry) =>
    entry.note ? { kind: "manifest" as const, ref: entry.ref, note: entry.note } : { kind: "manifest" as const, ref: entry.ref },
  );
}

/**
 * Detect project conventions under `context.root`.
 * Read-only and deterministic: the same root always yields the same
 * validated findings; nothing is written, executed, or contacted.
 */
export function detectProjectConventions(context: ProjectContext): DiscoveryFinding[] {
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
    found.naming.length > 0
      ? validateFinding({
          category: "naming_conventions",
          status: "detected",
          value: found.naming.map((entry) => entry.name).join(", "),
          evidence: toEvidence(found.naming),
        })
      : found.assessedRefs.some((ref) => NAMING_CONFIGS.some(([r]) => r === ref))
        ? validateFinding({ category: "naming_conventions", status: "not_detected", evidence: assessed })
        : validateFinding({ category: "naming_conventions", status: "unknown" }),
    found.architecture.length > 0
      ? validateFinding({
          category: "architecture",
          status: "detected",
          value: found.architecture.map((entry) => entry.name).join(", "),
          evidence: toEvidence(found.architecture),
        })
      : found.assessedRefs.some((ref) => ARCHITECTURE_DOCS.some(([r]) => r === ref))
        ? validateFinding({ category: "architecture", status: "not_detected", evidence: assessed })
        : validateFinding({ category: "architecture", status: "unknown" }),
    found.documentation.length > 0
      ? validateFinding({
          category: "documentation",
          status: "detected",
          value: found.documentation.map((entry) => entry.name).join(", "),
          evidence: toEvidence(found.documentation),
        })
      : found.assessedRefs.some((ref) => DOCUMENTATION_FILES.some(([r]) => r === ref))
        ? validateFinding({ category: "documentation", status: "not_detected", evidence: assessed })
        : validateFinding({ category: "documentation", status: "unknown" }),
    found.git.length > 0
      ? validateFinding({
          category: "git",
          status: "detected",
          value: found.git.map((entry) => entry.name).join(", "),
          evidence: toEvidence(found.git),
        })
      : found.assessedRefs.some((ref) => GIT_CONFIGS.some(([r]) => r === ref))
        ? validateFinding({ category: "git", status: "not_detected", evidence: assessed })
        : validateFinding({ category: "git", status: "unknown" }),
    found.constraints.length > 0
      ? validateFinding({
          category: "technical_constraints",
          status: "detected",
          value: found.constraints.map((entry) => entry.name).join(", "),
          evidence: toEvidence(found.constraints),
        })
      : found.assessedRefs.some((ref) => CONSTRAINT_CONFIGS.some(([r]) => r === ref))
        ? validateFinding({ category: "technical_constraints", status: "not_detected", evidence: assessed })
        : validateFinding({ category: "technical_constraints", status: "unknown" }),
  ];
}