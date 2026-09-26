import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Publish identity and trusted-publishing readiness (M20
// NPM-003): preparation only. The unscoped name is already
// registered by another publisher, no owned scope was
// supplied, and this environment has no npm authentication —
// so the verdict here is legitimately `identity-blocked`,
// with no invented replacement name. Registry interactions
// below are read-only; nothing publishes, mutates, or
// authenticates anything.

const REPO_ROOT = join(__dirname, "..", "..");

type IdentityStatus = "publishable-unscoped" | "publishable-scoped" | "identity-blocked";

/**
 * Explicit identity gate. Availability alone never suffices
 * (publish permission must still be validated at release);
 * a taken name without an explicitly owned scope blocks;
 * an owned scope plus a valid candidate identity opens the
 * scoped path. Nothing is inferred from repository naming.
 */
function classifyIdentity(input: {
  name: string;
  registryTaken: boolean;
  ownedScope: string | null;
  authenticated: boolean;
}): IdentityStatus {
  if (input.ownedScope !== null && input.ownedScope.length > 0 && input.authenticated) {
    return "publishable-scoped";
  }
  if (!input.registryTaken && input.authenticated) {
    return "publishable-unscoped";
  }
  return "identity-blocked";
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function readOnly(cmd: string, args: readonly string[]): { ok: boolean; output: string } {
  const result = spawnSync(cmd, [...args], { cwd: REPO_ROOT, encoding: "utf8" });
  const output = `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`;
  assert.ok(!/token|Bearer|_auth|password/i.test(output), "read-only checks never surface credential material");
  return { ok: result.status === 0, output };
}

describe("npm publish identity gate", () => {
  it("detects the registered name and refuses to invent a replacement", () => {
    const pkg = readJson(join(REPO_ROOT, "package.json"));
    assert.equal(pkg.name, "ai-team-framework", "package identity unchanged by NPM-003");
    assert.equal(pkg.version, "0.1.0", "no version bump in NPM-003");
    const view = readOnly("npm", ["view", "ai-team-framework", "name", "version", "dist-tags"]);
    assert.ok(view.ok, "read-only registry metadata reachable");
    assert.ok(view.output.includes("ai-team-framework"), "registry collision proven, not assumed");
    assert.ok(!view.output.includes("moassaad"), "no ownership evidence for this project; cannot claim the name");
    assert.ok(
      !JSON.stringify(pkg).includes("@moassaad/") && !JSON.stringify(pkg).includes("@ai-team/"),
      "no scope invented from repository naming",
    );
  });

  it("classifies publishability explicitly", () => {
    assert.equal(
      classifyIdentity({ name: "ai-team-framework", registryTaken: true, ownedScope: null, authenticated: false }),
      "identity-blocked",
      "this repository right now: taken name, no supplied scope, no auth",
    );
    assert.equal(
      classifyIdentity({ name: "free-name-xyz", registryTaken: false, ownedScope: null, authenticated: true }),
      "publishable-unscoped",
      "available name plus authenticated publisher",
    );
    assert.equal(
      classifyIdentity({ name: "ai-team-framework", registryTaken: true, ownedScope: "owner-scope", authenticated: true }),
      "publishable-scoped",
      "explicitly owned scope opens the scoped path",
    );
    assert.equal(
      classifyIdentity({ name: "ai-team-framework", registryTaken: true, ownedScope: null, authenticated: true }),
      "identity-blocked",
      "authentication alone never clears a taken name",
    );
    assert.equal(
      classifyIdentity({ name: "free-name-xyz", registryTaken: false, ownedScope: null, authenticated: false }),
      "identity-blocked",
      "availability alone never suffices without authentication",
    );
  });

  it("treats package name and CLI binary as separate concepts", () => {
    const pkg = readJson(join(REPO_ROOT, "package.json")) as { bin?: unknown };
    assert.deepEqual(pkg.bin, { "ai-team": "dist/index.js" }, "executable stays ai-team regardless of package identity");
  });

  it("records authentication as unverified without exposing anything", () => {
    const whoami = readOnly("npm", ["whoami"]);
    assert.equal(whoami.ok, false, "no npm login in this environment");
    assert.ok(/ENEEDAUTH|need auth|not logged in/i.test(whoami.output), "publish-auth-unverified, bounded explanation");
    assert.ok(!/token|Bearer|_auth|password/i.test(whoami.output), "no credential material inspected or printed");
  });
});

describe("npm trusted-publishing workflow", () => {
  const path = join(REPO_ROOT, ".github", "workflows", "publish.yml");
  const raw = existsSync(path) ? readFileSync(path, "utf8") : "";
  // Structural pins read the workflow without `#` comments so
  // prose explaining the no-token design never trips them.
  const workflow = raw.replace(/#.*/g, "");

  it("exists as a release-gated, token-free pipeline", () => {
    assert.ok(existsSync(path), "dedicated publish workflow present");
    assert.ok(/on:\s*\n\s*release:\s*\n\s*types:\s*\[published\]/.test(workflow), "triggered only by a published release");
    assert.ok(!/\n\s*on:\s*[^\n]*push/.test(workflow), "never runs on push");
    assert.ok(!/pull_request/.test(workflow), "never runs on pull requests");
    assert.ok(/id-token:\s*write/.test(workflow), "OIDC minting for trusted publishing");
    assert.ok(/contents:\s*read/.test(workflow), "minimum repository permission");
    assert.ok(!/NODE_AUTH_TOKEN|_authToken|secrets\.[A-Z_]*TOKEN|password/i.test(workflow), "no token or credential in the workflow");
  });

  it("pins a compliant toolchain and verifies before publishing", () => {
    assert.ok(/node-version:\s*22\.14\.0/.test(workflow), "publish runner targets Node 22.14");
    assert.ok(/npm@\^11\.5\.1/.test(workflow), "publish runner targets npm 11.5.1+");
    const steps = [...workflow.matchAll(/run:\s*(.+)/g)].map((match) => match[1].trim());
    const indexOf = (pattern: RegExp): number => steps.findIndex((step) => pattern.test(step));
    const build = indexOf(/^npm run build$/);
    const test = indexOf(/^npm test$/);
    const verify = indexOf(/^npm pack --dry-run$/);
    const publish = indexOf(/^npm publish( --access public)?$/);
    assert.ok(build >= 0 && test >= 0 && verify >= 0 && publish >= 0, "build, test, artifact verification, and explicit publish steps present");
    assert.ok(build < test && test < publish && verify < publish, "verification precedes publication");
    assert.ok(!/cache:\s*(npm|true)/.test(workflow), "no package-manager cache contaminating release builds");
  });

  it("keeps consumer runtime independent from the publish runner", () => {
    const pkg = readJson(join(REPO_ROOT, "package.json")) as { engines?: unknown };
    assert.deepEqual(pkg.engines, { node: ">=18" }, "consumer floor untouched by the Node 22 publish requirement");
  });

  it("introduces no publish lifecycle or registry mutation", () => {
    const pkg = readJson(join(REPO_ROOT, "package.json")) as { scripts?: Record<string, string>; publishConfig?: unknown };
    const scriptText = Object.entries(pkg.scripts ?? {}).map(([name, command]) => `${name} ${command}`).join("\n");
    assert.ok(!/prepublish|postinstall|prepare/i.test(scriptText), "no hidden automatic publish hooks");
    assert.ok(!/publish/i.test(scriptText), "publish happens only as the explicit workflow step");
    assert.equal(pkg.publishConfig, undefined, "no provenance disabling or registry redirection");
    assert.ok(!/npm (unpublish|deprecate|dist-tag add|access (grant|revoke))/i.test(workflow), "workflow performs no other registry mutation");
  });
});

describe("npm publish readiness boundary", () => {
  it("keeps the NPM-001/NPM-002 boundary intact with no runtime changes", { timeout: 120000 }, () => {
    const pkg = readJson(join(REPO_ROOT, "package.json"));
    assert.deepEqual(pkg.files, ["dist"], "artifact boundary unchanged");
    const dryRun = readOnly("npm", ["pack", "--dry-run"]);
    assert.ok(dryRun.ok, "pack dry-run succeeds");
    assert.ok(/total files:\s*199/.test(dryRun.output), "reproducible 199-file consumer boundary");
    assert.ok(!/src\/|tests\/|docs\//.test(dryRun.output.replace(/dist\//g, "")), "no source, tests, or docs leak into the artifact");
  });

  it("documentation matches the verified blocked identity", () => {
    const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
    const install = readFileSync(join(REPO_ROOT, "docs", "installation.md"), "utf8");
    assert.ok(readme.includes("npm install -g ai-team-framework"), "install examples use the actual package identity");
    assert.ok(!/npmjs\.com\/package\/ai-team-framework/.test(readme + install), "no fake package URL claimed");
    assert.ok(/not yet published/i.test(readme + install), "unpublished state stated, never claimed otherwise");
    assert.ok(/identity-blocked|naming decision|not.*available/i.test(install), "collision and decision requirement documented");
  });

  it("no credential files or tokens enter the repository", () => {
    assert.ok(!existsSync(join(REPO_ROOT, ".npmrc")), "no npmrc in the repository");
    const workflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "publish.yml"), "utf8").replace(/#.*/g, "");
    assert.ok(!/auth_token|authtoken|_auth\b|secrets\.|password|NODE_AUTH/i.test(workflow), "workflow carries no credential material (id-token:write is the OIDC permission, not a secret)");
  });
});
