import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Release identity verification for the explicitly
// supplied candidate `@moassaad/ai-team-framework` (M21
// identity ticket). The candidate is unclaimed on the
// registry (404), but npm authentication is unavailable in
// this environment, so neither the `moassaad` publisher
// identity nor `@moassaad` scope control can be verified —
// the verdict is `identity-blocked`, with no downgrade to
// another candidate, no manifest change, no version bump,
// and no merge. All npm interactions are read-only.

const REPO_ROOT = join(__dirname, "..", "..");
const CANDIDATE = "@moassaad/ai-team-framework";
const EXPECTED_PUBLISHER = "moassaad";

type Decision = "identity-approved" | "identity-blocked";

/**
 * The ticket's approval rule for the explicit candidate:
 * the authenticated npm identity must be the expected
 * publisher, the scope must be verifiably controlled, and
 * no contradictory registry evidence may exist. The
 * candidate itself arrives only as explicit owner input.
 */
function decideCandidate(input: {
  candidate: string;
  authenticatedUser: string | null;
  scopeControlled: boolean;
  registryContradicts: boolean;
}): Decision {
  if (
    input.candidate === CANDIDATE &&
    input.authenticatedUser === EXPECTED_PUBLISHER &&
    input.scopeControlled &&
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
  return { ok: result.status === 0, output };
}

describe("npm explicit candidate verification", () => {
  it("treats the supplied candidate as the only candidate", () => {
    assert.equal(CANDIDATE, "@moassaad/ai-team-framework", "explicit owner input, byte-exact");
    // The candidate may be recorded exactly where the
    // blocked decision is documented, and nowhere else:
    // never in the manifest, workflow, or install commands
    // until approval.
    const implementation = ["package.json", "README.md", "docs/quick-start.md", ".github/workflows/publish.yml"]
      .map((file) => readFileSync(join(REPO_ROOT, file), "utf8"))
      .join("\n");
    assert.ok(!/@[A-Za-z0-9-]+\/ai-team-framework/.test(implementation), "no scoped variant in implementation surfaces");
    const decision = readFileSync(join(REPO_ROOT, "docs", "installation.md"), "utf8");
    assert.ok(decision.includes(CANDIDATE), "blocked decision documents the explicit candidate");
    assert.ok(!/ai-team-framework-(cli|js|node|core)/.test(implementation + decision), "no suffixed fallback generated");
  });

  it("finds the candidate unclaimed but authentication unavailable", () => {
    const view = readOnly(["view", CANDIDATE, "name", "version", "dist-tags"]);
    assert.equal(view.ok, false, "candidate not on the registry");
    assert.ok(/E404|Not Found|not in this registry/i.test(view.output), "unclaimed, not contradicted");
    const whoami = readOnly(["whoami"]);
    assert.equal(whoami.ok, false, "no npm login in this environment");
    assert.ok(/ENEEDAUTH|need auth|not logged in/i.test(whoami.output), "publisher identity unverifiable here");
  });

  it("blocks without verified publisher and scope control", () => {
    assert.equal(
      decideCandidate({ candidate: CANDIDATE, authenticatedUser: null, scopeControlled: false, registryContradicts: false }),
      "identity-blocked",
      "this environment: 404 candidate, no auth, no scope proof",
    );
    assert.equal(
      decideCandidate({ candidate: CANDIDATE, authenticatedUser: "someone-else", scopeControlled: false, registryContradicts: false }),
      "identity-blocked",
      "a different authenticated username stays blocked",
    );
    assert.equal(
      decideCandidate({ candidate: CANDIDATE, authenticatedUser: EXPECTED_PUBLISHER, scopeControlled: false, registryContradicts: false }),
      "identity-blocked",
      "publisher name alone never proves scope control",
    );
    assert.equal(
      decideCandidate({ candidate: CANDIDATE, authenticatedUser: EXPECTED_PUBLISHER, scopeControlled: true, registryContradicts: true }),
      "identity-blocked",
      "contradictory registry evidence blocks despite auth",
    );
    assert.equal(
      decideCandidate({ candidate: CANDIDATE, authenticatedUser: EXPECTED_PUBLISHER, scopeControlled: true, registryContradicts: false }),
      "identity-approved",
      "only verified publisher plus verified scope control approves",
    );
  });

  it("changes nothing while blocked", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      name?: unknown;
      version?: unknown;
      bin?: unknown;
    };
    assert.equal(pkg.name, "ai-team-framework", "manifest updated only after approval — still unscoped");
    assert.equal(pkg.version, "0.1.0", "no version bump while blocked");
    assert.deepEqual(pkg.bin, { "ai-team": "dist/index.js" }, "CLI identity separate and stable");
    const workflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "publish.yml"), "utf8").replace(/#.*/g, "");
    assert.ok(/run:\s*npm publish\s*$/m.test(workflow), "publish step untouched");
    assert.ok(!/--access public/.test(workflow), "no scoped access flag without an approved scoped identity");
  });

  it("performs no writes and prints no credentials", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    assert.ok(
      !/publish|dist-tag|deprecate|access (grant|revoke)/i.test(Object.values(pkg.scripts ?? {}).join(" ")),
      "no registry write configured",
    );
  });
});
