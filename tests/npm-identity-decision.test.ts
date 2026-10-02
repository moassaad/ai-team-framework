import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Release identity decision (M21 release): the owner
// explicitly supplied `@moassaad/ai-team-framework`, the
// session is authenticated as `moassaad`, and the manifest
// now carries the approved scoped identity at 0.2.0. These
// tests pin the approved state: exact identity, no
// alternative generated, version and binary stable,
// workflow flagged for scoped public publication. The
// fixture gate still proves the blocked/approved logic;
// registry writes never happen here.

const REPO_ROOT = join(__dirname, "..", "..");

type Decision = "identity-approved" | "identity-blocked";

/**
 * The ticket's decision rule: approval needs an explicitly
 * supplied candidate plus verified control of its
 * namespace; anything else blocks. The candidate arrives
 * only as an explicit input — never constructed here.
 */
function decideIdentity(input: {
  candidate: string | null;
  namespaceControlled: boolean;
  registryContradicts: boolean;
}): Decision {
  if (
    input.candidate !== null &&
    input.candidate.length > 0 &&
    input.namespaceControlled &&
    !input.registryContradicts
  ) {
    return "identity-approved";
  }
  return "identity-blocked";
}

function readOnly(args: readonly string[]): { ok: boolean; output: string } {
  const result = spawnSync("npm", [...args], { cwd: REPO_ROOT, encoding: "utf8" });
  const output = `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`;
  assert.ok(!/token|Bearer|_authToken|password/i.test(output), "read-only checks never surface credential material");
  return {
    ok: result.status === 0,
    output,
  };
}

describe("npm release identity decision", () => {
  it("records the unscoped collision as history, not identity", () => {
    const view = readOnly(["view", "ai-team-framework", "name", "version", "dist-tags"]);
    assert.ok(view.ok, "registry metadata readable");
    assert.ok(view.output.includes("ai-team-framework"), "unscoped name taken by another publisher");
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { name?: unknown };
    assert.equal(pkg.name, "@moassaad/ai-team-framework", "manifest no longer claims the taken name");
  });

  it("requires an explicit candidate and verified control", () => {
    assert.equal(
      decideIdentity({ candidate: null, namespaceControlled: false, registryContradicts: true }),
      "identity-blocked",
      "no supplied candidate blocks",
    );
    assert.equal(
      decideIdentity({ candidate: null, namespaceControlled: true, registryContradicts: false }),
      "identity-blocked",
      "control without an explicit candidate still blocks",
    );
    assert.equal(
      decideIdentity({ candidate: "@owner-scope/ai-team-framework", namespaceControlled: false, registryContradicts: false }),
      "identity-blocked",
      "unverified ownership blocks even with a candidate",
    );
    assert.equal(
      decideIdentity({ candidate: "ai-team-framework", namespaceControlled: false, registryContradicts: true }),
      "identity-blocked",
      "a contradicted unscoped candidate blocks without a write-probe",
    );
    assert.equal(
      decideIdentity({ candidate: "@moassaad/ai-team-framework", namespaceControlled: true, registryContradicts: false }),
      "identity-approved",
      "this release: explicit candidate plus verified control",
    );
  });

  it("generates no alternative identity", () => {
    const tree = ["package.json", "README.md", "docs/installation.md", "docs/quick-start.md", ".github/workflows/publish.yml"]
      .map((file) => readFileSync(join(REPO_ROOT, file), "utf8"))
      .join("\n");
    const scopes = [...new Set([...tree.matchAll(/@([A-Za-z0-9-]+)\/ai-team-framework/g)].map((match) => match[0]))];
    assert.deepEqual(scopes, ["@moassaad/ai-team-framework"], "exactly the approved identity, nothing else");
    assert.ok(!/ai-team-framework-(cli|js|node|core)/.test(tree), "no suffixed variant constructed");
  });

  it("keeps package, binary, version, and artifact identities consistent", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      name?: unknown;
      version?: unknown;
      bin?: unknown;
    };
    assert.equal(pkg.name, "@moassaad/ai-team-framework", "approved package identity");
    assert.equal(pkg.version, "0.2.0", "first public release version");
    assert.deepEqual(pkg.bin, { "ai-team": "dist/index.js" }, "CLI binary independent of package identity");
    const dryRun = readOnly(["pack", "--dry-run"]);
    assert.ok(dryRun.ok, "pack dry-run succeeds");
    assert.ok(/moassaad-ai-team-framework-0\.2\.0\.tgz/.test(dryRun.output), "tarball name follows the approved identity");
  });

  it("flags the workflow for scoped public publication", () => {
    const workflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "publish.yml"), "utf8").replace(/#.*/g, "");
    assert.ok(/run:\s*npm publish --access public\s*$/m.test(workflow), "scoped public-access publish step");
    assert.ok(/node-version:\s*22\.14\.0/.test(workflow), "toolchain pin intact");
    assert.ok(/id-token:\s*write/.test(workflow) && /contents:\s*read/.test(workflow), "permissions intact");
  });

  it("performs no npm writes and prints no credential material", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    assert.ok(!/publish|dist-tag|deprecate|access/i.test(Object.values(pkg.scripts ?? {}).join(" ")), "no write command configured");
    const whoami = readOnly(["whoami"]);
    assert.ok(whoami.ok, "session authenticated");
    assert.ok(whoami.output.includes("moassaad"), "authenticated publisher verified read-only");
  });
});
