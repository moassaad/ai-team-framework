import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Release identity decision (M21 identity ticket): no
// explicit candidate identity was supplied by the owner, so
// no replacement is invented and the verdict is
// `identity-blocked`. These tests pin that decision:
// collision detected, nothing renamed, version frozen,
// workflow untouched, artifact and CLI identities stable.
// All npm interactions are read-only; nothing publishes or
// authenticates anything.

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
  return {
    ok: result.status === 0,
    output: `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`,
  };
}

describe("npm release identity decision", () => {
  it("detects the unscoped collision from read-only metadata", () => {
    const view = readOnly(["view", "ai-team-framework", "name", "version", "dist-tags"]);
    assert.ok(view.ok, "registry metadata readable");
    assert.ok(view.output.includes("ai-team-framework"), "collision detected, not ignored");
    assert.ok(!view.output.includes("moassaad"), "no ownership evidence for this project");
  });

  it("requires an explicit candidate and verified control", () => {
    assert.equal(
      decideIdentity({ candidate: null, namespaceControlled: false, registryContradicts: true }),
      "identity-blocked",
      "this repository: no supplied candidate, taken name",
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
      decideIdentity({ candidate: "@owner-scope/ai-team-framework", namespaceControlled: true, registryContradicts: false }),
      "identity-approved",
      "explicit candidate plus verified control is the only approval path",
    );
  });

  it("invents no replacement identity anywhere", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { name?: unknown };
    assert.equal(pkg.name, "ai-team-framework", "manifest identity untouched");
    const tree = ["package.json", "README.md", "docs/installation.md", "docs/quick-start.md", ".github/workflows/publish.yml"]
      .map((file) => readFileSync(join(REPO_ROOT, file), "utf8"))
      .join("\n");
    assert.ok(!/@[A-Za-z0-9-]+\/ai-team-framework/.test(tree), "no scoped variant constructed");
    assert.ok(!/ai-team-framework-(cli|js|node|core)/.test(tree), "no suffixed variant constructed");
  });

  it("keeps package, binary, version, and artifact identities stable", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      name?: unknown;
      version?: unknown;
      bin?: unknown;
    };
    assert.equal(pkg.name, "ai-team-framework", "package identity stable");
    assert.equal(pkg.version, "0.1.0", "no version bump without approval");
    assert.deepEqual(pkg.bin, { "ai-team": "dist/index.js" }, "CLI binary independent of package identity");
    const dryRun = readOnly(["pack", "--dry-run"]);
    assert.ok(dryRun.ok, "pack dry-run succeeds");
    assert.ok(/ai-team-framework-0\.1\.0\.tgz/.test(dryRun.output), "tarball name follows the unchanged identity");
  });

  it("leaves the trusted-publishing workflow exactly as prepared", () => {
    const workflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "publish.yml"), "utf8").replace(/#.*/g, "");
    assert.ok(/run:\s*npm publish\s*$/m.test(workflow), "explicit publish step present, unflagged");
    assert.ok(!/--access public/.test(workflow), "no access flag invented while no scoped identity is approved");
    assert.ok(/node-version:\s*22\.14\.0/.test(workflow), "toolchain pin intact");
    assert.ok(/id-token:\s*write/.test(workflow) && /contents:\s*read/.test(workflow), "permissions intact");
  });

  it("performs no npm writes and prints no credential material", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    assert.ok(!/publish|dist-tag|deprecate|access/i.test(Object.values(pkg.scripts ?? {}).join(" ")), "no write command configured");
    const whoami = readOnly(["whoami"]);
    assert.equal(whoami.ok, false, "authentication remains unresolved");
    assert.ok(!/token|Bearer|_auth|password/i.test(whoami.output), "no credential material printed");
  });
});
