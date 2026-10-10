import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// Local npm-session authentication gate (T-050 follow-up).
//
// The three live `npm whoami` checks below were relocated here,
// verbatim in assertion, from npm-publish-readiness,
// npm-identity-moassaad, and npm-identity-decision so the ordinary
// `npm test` suite stays deterministic without a personal npm
// login. Run explicitly with `npm run test:npm-session`.
//
// Semantics are preserved, not weakened: this file fails when no
// valid `moassaad` session exists, never skips, never succeeds
// silently. It verifies a LOCAL token/session only — it does not
// run before OIDC publishing and cannot prove GitHub OIDC
// readiness (`npm whoami` cannot mint or check an OIDC token;
// OIDC is proven by the publish operation plus post-publish
// registry verification in `.github/workflows/publish.yml`).
// This file is intentionally NOT matched by the default test
// runner: its compiled output `dist-test/tests/npm-session-auth.js`
// carries no `.test.` infix, so `node --test dist-test/tests/`
// ignores it and only the explicit `test:npm-session` command
// executes it.

const REPO_ROOT = join(__dirname, "..", "..");

function readOnlySession(): { ok: boolean; output: string } {
  const result = spawnSync("npm", ["whoami"], { cwd: REPO_ROOT, encoding: "utf8" });
  const output = `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`;
  assert.ok(!/token|Bearer|_authToken|password/i.test(output), "session checks never surface credential material");
  return { ok: result.status === 0, output };
}

describe("npm local session authentication gate", () => {
  it("verifies the authenticated publisher read-only (from npm-publish-readiness)", () => {
    const whoami = readOnlySession();
    assert.ok(whoami.ok, "npm session authenticated");
    assert.ok(whoami.output.includes("moassaad"), "authenticated publisher is the expected moassaad");
  });

  it("confirms the authenticated publisher read-only (from npm-identity-moassaad)", () => {
    const whoami = readOnlySession();
    assert.ok(whoami.ok, "npm session authenticated");
    assert.ok(whoami.output.includes("moassaad"), "authenticated identity is the expected publisher");
  });

  it("verifies the session publisher read-only (from npm-identity-decision)", () => {
    const whoami = readOnlySession();
    assert.ok(whoami.ok, "session authenticated");
    assert.ok(whoami.output.includes("moassaad"), "authenticated publisher verified read-only");
  });
});
