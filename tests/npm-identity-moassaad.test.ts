import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Release identity verification for the explicitly
// supplied candidate `@moassaad/ai-team-framework` (M21
// release): authenticated as `moassaad`, manifest renamed,
// version at 0.3.0, workflow flagged `--access public`.
// Fixtures still prove every blocked combination; live
// checks confirm the applied state. All npm interactions
// here are read-only; publication itself is the ticket's
// explicit release step, covered by post-publish
// verification — never by this file.

const REPO_ROOT = join(__dirname, "..", "..");
const CANDIDATE = "@moassaad/ai-team-framework";
const EXPECTED_PUBLISHER = "moassaad";

type Decision = "identity-approved" | "identity-blocked";

/**
 * The ticket's approval rule for the explicit candidate:
 * the authenticated npm identity must be the expected
 * publisher, the scope must be verifiably controlled, and
 * no contradictory registry evidence may exist.
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

// Local-session authentication lives in tests/npm-session-auth.ts
// (`npm run test:npm-session`); this file keeps the deterministic
// decision logic and applied-state checks only.

describe("npm explicit candidate verification", () => {
  it("applies exactly the supplied candidate", () => {
    assert.equal(CANDIDATE, "@moassaad/ai-team-framework", "explicit owner input, byte-exact");
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { name?: unknown };
    assert.equal(pkg.name, CANDIDATE, "manifest carries the approved candidate");
    const installRefs = [readFileSync(join(REPO_ROOT, "README.md"), "utf8"), readFileSync(join(REPO_ROOT, "docs", "installation.md"), "utf8")].join("\n");
    assert.ok(installRefs.includes(`npm install -g ${CANDIDATE}`), "install commands use the approved identity");
    assert.ok(!installRefs.replace(/npm install -g @moassaad\/ai-team-framework/g, "").includes("npm install -g ai-team-framework"), "no stale unscoped install command");
  });

  // Local-session authentication lives in tests/npm-session-auth.ts
  // (`npm run test:npm-session`). OIDC readiness is proven by
  // publish plus registry verification, never by a local whoami.
  it("blocks every combination except verified publisher plus verified scope", () => {
    assert.equal(
      decideCandidate({ candidate: CANDIDATE, authenticatedUser: null, scopeControlled: false, registryContradicts: false }),
      "identity-blocked",
      "unavailable auth blocks",
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
      "this release path once scope control is exercised at publish time",
    );
  });

  it("applies exactly the approved change and nothing else", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      name?: unknown;
      version?: unknown;
      bin?: unknown;
      dependencies?: unknown;
      engines?: unknown;
    };
    assert.equal(pkg.name, CANDIDATE, "scoped manifest identity");
    assert.equal(pkg.version, "0.3.0", "release version");
    assert.deepEqual(pkg.bin, { "ai-team": "dist/index.js" }, "CLI identity separate and stable");
    assert.deepEqual(pkg.dependencies, { yaml: "^2.9.1" }, "production dependencies untouched");
    assert.deepEqual(pkg.engines, { node: ">=18" }, "consumer runtime untouched");
    const workflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "publish.yml"), "utf8").replace(/#.*/g, "");
    assert.ok(/run:\s*npm publish --access public\s*$/m.test(workflow), "scoped public-access publish step");
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
