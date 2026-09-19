/**
 * Project-stack detection (A-002).
 *
 * Read-only, deterministic, project-agnostic detection of the core
 * stack (languages, backend/frontend frameworks, database) from a
 * small fixed set of manifest and configuration files. Positive
 * evidence yields `detected`; checked-but-empty evidence yields
 * `not_detected`; insufficient evidence yields `unknown` — never a
 * guess. No writes, no subprocesses, no network, no providers.
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

interface Dep {
  name: string;
  version?: string;
}

function cleanVersion(raw: string): string | undefined {
  const cleaned = raw
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/^[\s^~>=<v]+/, "")
    .split(/[\s,|]+/)[0]
    ?.trim();
  return cleaned && cleaned.length > 0 ? cleaned : undefined;
}

function label(dep: Dep, display?: string): string {
  const name = display ?? dep.name;
  return dep.version ? `${name} ${dep.version}` : name;
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

function parseJsonDeps(text: string, sections: string[]): Dep[] {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return [];
  }
  const deps: Dep[] = [];
  for (const section of sections) {
    const bucket = data[section];
    if (typeof bucket !== "object" || bucket === null) {
      continue;
    }
    for (const [name, version] of Object.entries(bucket as Record<string, unknown>)) {
      deps.push({
        name,
        version: typeof version === "string" ? cleanVersion(version) : undefined,
      });
    }
  }
  return deps;
}

function parseRequirementLine(line: string): Dep | undefined {
  const stripped = line.split("#")[0]?.trim();
  if (!stripped) {
    return undefined;
  }
  const match = /^([A-Za-z0-9_.\-]+)\s*(?:[=<>!~]+\s*([^\s;]+))?/.exec(stripped);
  if (!match) {
    return undefined;
  }
  return { name: match[1]!, version: match[2] ? cleanVersion(match[2]) : undefined };
}

function parseRequirements(text: string): Dep[] {
  const deps: Dep[] = [];
  for (const line of text.split("\n")) {
    const dep = parseRequirementLine(line);
    if (dep) {
      deps.push(dep);
    }
  }
  return deps;
}

function parsePyproject(text: string): Dep[] {
  const deps: Dep[] = [];
  let inDeps = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      inDeps = line === "[project]" || line === "[tool.poetry.dependencies]";
      continue;
    }
    if (!inDeps || !line || line.startsWith("#") || /^dependencies\s*=/.test(line)) {
      continue;
    }
    const listed = /^["']([^"']+)["'],?$/.exec(line);
    if (listed) {
      const dep = parseRequirementLine(listed[1]!);
      if (dep) {
        deps.push(dep);
      }
      continue;
    }
    const bare = /^([A-Za-z0-9_.\-]+)\s*=\s*(.+)$/.exec(line);
    if (bare && bare[1] !== "python") {
      const pinned = /version\s*=\s*"([^"]+)"/.exec(bare[2]!);
      const version = pinned ? cleanVersion(pinned[1]!) : cleanVersion(bare[2]!.replace(/["']/g, ""));
      deps.push({ name: bare[1]!, version });
    }
  }
  return deps;
}

function parseCargoDeps(text: string): Dep[] {
  const deps: Dep[] = [];
  let inDeps = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      inDeps = line === "[dependencies]";
      continue;
    }
    if (!inDeps || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const name = line.split("=")[0]?.trim();
    const versionMatch = /version\s*=\s*"([^"]+)"/.exec(line) ?? /^[^=]+=\s*"([^"]+)"/.exec(line);
    if (name) {
      deps.push({ name, version: versionMatch ? cleanVersion(versionMatch[1]!) : undefined });
    }
  }
  return deps;
}

function parseGemfile(text: string): Dep[] {
  const deps: Dep[] = [];
  for (const rawLine of text.split("\n")) {
    const match = /^\s*gem\s+['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]+)['"])?/.exec(rawLine);
    if (match) {
      deps.push({ name: match[1]!, version: match[2] ? cleanVersion(match[2]) : undefined });
    }
  }
  return deps;
}

function parsePomArtifacts(text: string): string[] {
  const artifacts: string[] = [];
  for (const match of text.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)) {
    artifacts.push(match[1]!.trim());
  }
  return artifacts;
}

/** Dependency-name fragment (lowercase) to generic display name. */
const BACKEND_DEPS: Record<string, string> = {
  "laravel/framework": "laravel",
  "symfony/framework-bundle": "symfony",
  "symfony/symfony": "symfony",
  django: "django",
  flask: "flask",
  fastapi: "fastapi",
  rails: "rails",
  express: "express",
  fastify: "fastify",
  koa: "koa",
  "@nestjs/core": "nestjs",
  "@hapi/hapi": "hapi",
  "gin-gonic/gin": "gin",
  "labstack/echo": "echo",
  "gorilla/mux": "mux",
  "gofiber/fiber": "fiber",
  "actix-web": "actix-web",
  rocket: "rocket",
  axum: "axum",
};

const FRONTEND_DEPS: Record<string, string> = {
  react: "react",
  vue: "vue",
  "@angular/core": "angular",
  svelte: "svelte",
  "solid-js": "solidjs",
  preact: "preact",
  next: "next",
  nuxt: "nuxt",
};

const DATABASE_DEPS: Record<string, string> = {
  pg: "postgresql",
  "pg-native": "postgresql",
  mysql: "mysql",
  mysql2: "mysql",
  "better-sqlite3": "sqlite",
  sqlite3: "sqlite",
  mongoose: "mongodb",
  ioredis: "redis",
  redis: "redis",
  "psycopg2": "postgresql",
  "psycopg2-binary": "postgresql",
  psycopg: "postgresql",
  pymysql: "mysql",
  mysqlclient: "mysql",
  pymongo: "mongodb",
  pg8000: "postgresql",
  oracledb: "oracle",
  ojdbc11: "oracle",
  mssql: "sql server",
  tedious: "sql server",
};

const DB_ADAPTERS: Record<string, string> = {
  postgresql: "postgresql",
  postgis: "postgresql",
  mysql2: "mysql",
  mysql: "mysql",
  sqlite3: "sqlite",
};

const PRISMA_PROVIDERS: Record<string, string> = {
  postgresql: "postgresql",
  mysql: "mysql",
  sqlite: "sqlite",
  mongodb: "mongodb",
  sqlserver: "sql server",
};

interface StackEvidence {
  languages: string[];
  languageRefs: string[];
  backends: string[];
  frontends: string[];
  databases: string[];
  backendRefs: string[];
  frontendRefs: string[];
  databaseRefs: string[];
}

function matchDeps(deps: Dep[], table: Record<string, string>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const dep of deps) {
    const display = table[dep.name.toLowerCase()];
    if (display && !seen.has(display)) {
      seen.add(display);
      found.push(label(dep, display));
    }
  }
  return found;
}

function matchSubstrings(lines: string[], table: Record<string, string>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const [fragment, display] of Object.entries(table)) {
    if (seen.has(display)) {
      continue;
    }
    if (lines.some((line) => line.toLowerCase().includes(fragment))) {
      seen.add(display);
      found.push(display);
    }
  }
  return found;
}

function collect(root: string): StackEvidence {
  const evidence: StackEvidence = {
    languages: [],
    languageRefs: [],
    backends: [],
    frontends: [],
    databases: [],
    backendRefs: [],
    frontendRefs: [],
    databaseRefs: [],
  };

  const packageJson = readText(root, "package.json");
  if (packageJson !== undefined) {
    evidence.languageRefs.push("package.json");
    evidence.languages.push("javascript");
    const deps = parseJsonDeps(packageJson, ["dependencies", "devDependencies"]);
    if (deps.some((dep) => dep.name === "typescript") || readText(root, "tsconfig.json") !== undefined) {
      evidence.languages.push("typescript");
      evidence.languageRefs.push("tsconfig.json");
    }
    evidence.backendRefs.push("package.json");
    evidence.frontendRefs.push("package.json");
    evidence.databaseRefs.push("package.json");
    evidence.backends.push(...matchDeps(deps, BACKEND_DEPS));
    evidence.frontends.push(...matchDeps(deps, FRONTEND_DEPS));
    evidence.databases.push(...matchDeps(deps, DATABASE_DEPS));
  }

  const composerJson = readText(root, "composer.json");
  if (composerJson !== undefined) {
    evidence.languageRefs.push("composer.json");
    evidence.languages.push("php");
    evidence.backendRefs.push("composer.json");
    const deps = parseJsonDeps(composerJson, ["require", "require-dev"]);
    evidence.backends.push(...matchDeps(deps, BACKEND_DEPS));
  }

  const requirements = readText(root, "requirements.txt");
  if (requirements !== undefined) {
    evidence.languageRefs.push("requirements.txt");
    evidence.languages.push("python");
    evidence.backendRefs.push("requirements.txt");
    evidence.databaseRefs.push("requirements.txt");
    const deps = parseRequirements(requirements);
    evidence.backends.push(...matchDeps(deps, BACKEND_DEPS));
    evidence.databases.push(...matchDeps(deps, DATABASE_DEPS));
  }

  const pyproject = readText(root, "pyproject.toml");
  if (pyproject !== undefined) {
    evidence.languageRefs.push("pyproject.toml");
    evidence.languages.push("python");
    evidence.backendRefs.push("pyproject.toml");
    evidence.databaseRefs.push("pyproject.toml");
    const deps = parsePyproject(pyproject);
    evidence.backends.push(...matchDeps(deps, BACKEND_DEPS));
    evidence.databases.push(...matchDeps(deps, DATABASE_DEPS));
  }

  const goMod = readText(root, "go.mod");
  if (goMod !== undefined) {
    evidence.languageRefs.push("go.mod");
    evidence.languages.push("go");
    evidence.backendRefs.push("go.mod");
    evidence.backends.push(
      ...matchSubstrings(
        goMod.split("\n").map((line) => line.split("//")[0] ?? ""),
        BACKEND_DEPS,
      ),
    );
  }

  const cargoToml = readText(root, "Cargo.toml");
  if (cargoToml !== undefined) {
    evidence.languageRefs.push("Cargo.toml");
    evidence.languages.push("rust");
    evidence.backendRefs.push("Cargo.toml");
    evidence.backends.push(...matchDeps(parseCargoDeps(cargoToml), BACKEND_DEPS));
  }

  const gemfile = readText(root, "Gemfile");
  if (gemfile !== undefined) {
    evidence.languageRefs.push("Gemfile");
    evidence.languages.push("ruby");
    evidence.backendRefs.push("Gemfile");
    evidence.databaseRefs.push("Gemfile");
    const deps = parseGemfile(gemfile);
    evidence.backends.push(...matchDeps(deps, BACKEND_DEPS));
    evidence.databases.push(...matchDeps(deps, DATABASE_DEPS));
  }

  const pomXml = readText(root, "pom.xml");
  if (pomXml !== undefined) {
    evidence.languageRefs.push("pom.xml");
    evidence.languages.push("java");
    evidence.backendRefs.push("pom.xml");
    evidence.databaseRefs.push("pom.xml");
    const artifacts = parsePomArtifacts(pomXml).map((name) => ({ name }));
    evidence.backends.push(
      ...artifacts
        .filter((dep) => dep.name.startsWith("spring-boot-starter"))
        .map(() => "spring boot")
        .filter((name, index, all) => all.indexOf(name) === index),
    );
    evidence.databases.push(...matchDeps(artifacts, DATABASE_DEPS));
  }

  const prismaSchema = readText(root, "prisma/schema.prisma");
  if (prismaSchema !== undefined) {
    evidence.databaseRefs.push("prisma/schema.prisma");
    const provider = /provider\s*=\s*"([^"]+)"/.exec(prismaSchema)?.[1];
    if (provider && PRISMA_PROVIDERS[provider]) {
      evidence.databases.push(PRISMA_PROVIDERS[provider]!);
    }
  }

  const databaseYml = readText(root, "config/database.yml");
  if (databaseYml !== undefined) {
    evidence.databaseRefs.push("config/database.yml");
    const adapter = /adapter:\s*([A-Za-z0-9_]+)/.exec(databaseYml)?.[1];
    if (adapter && DB_ADAPTERS[adapter]) {
      evidence.databases.push(DB_ADAPTERS[adapter]!);
    }
  }

  return evidence;
}

function manifestEvidence(refs: string[]): DiscoveryEvidence[] {
  return refs.map((ref) => ({ kind: "manifest" as const, ref }));
}

/**
 * Detect the core project stack under `context.root`.
 * Read-only and deterministic: the same root always yields the same
 * validated findings; nothing is written, executed, or contacted.
 */
export function detectProjectStack(context: ProjectContext): DiscoveryFinding[] {
  const { root } = validateProjectContext(context);
  try {
    if (!statSync(root).isDirectory()) {
      throw new Error();
    }
  } catch {
    throw new Error(`discovery: project root is not a readable directory: ${root}`);
  }

  const found = collect(root);
  const findings: DiscoveryFinding[] = [
    found.languages.length > 0
      ? validateFinding({
          category: "languages",
          status: "detected",
          value: found.languages.join(", "),
          evidence: manifestEvidence(found.languageRefs),
        })
      : validateFinding({ category: "languages", status: "unknown" }),
    found.backends.length > 0
      ? validateFinding({
          category: "backend_framework",
          status: "detected",
          value: found.backends.join(", "),
          evidence: manifestEvidence(found.backendRefs),
        })
      : found.backendRefs.length > 0
        ? validateFinding({
            category: "backend_framework",
            status: "not_detected",
            evidence: manifestEvidence(found.backendRefs),
          })
        : validateFinding({ category: "backend_framework", status: "unknown" }),
    found.frontends.length > 0
      ? validateFinding({
          category: "frontend_framework",
          status: "detected",
          value: found.frontends.join(", "),
          evidence: manifestEvidence(found.frontendRefs),
        })
      : found.frontendRefs.length > 0
        ? validateFinding({
            category: "frontend_framework",
            status: "not_detected",
            evidence: manifestEvidence(found.frontendRefs),
          })
        : validateFinding({ category: "frontend_framework", status: "unknown" }),
    found.databases.length > 0
      ? validateFinding({
          category: "database",
          status: "detected",
          value: found.databases.join(", "),
          evidence: manifestEvidence(found.databaseRefs),
        })
      : found.databaseRefs.length > 0
        ? validateFinding({
            category: "database",
            status: "not_detected",
            evidence: manifestEvidence(found.databaseRefs),
          })
        : validateFinding({ category: "database", status: "unknown" }),
  ];
  return findings;
}
