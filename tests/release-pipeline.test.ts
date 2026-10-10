import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const WORKFLOW_PATH = join(REPO_ROOT, ".github", "workflows", "publish.yml");

// Release-pipeline verification (T-050 follow-up): the publish
// workflow is tag-triggered, OIDC-compatible, and verified, and
// local npm-session checks are separated from the deterministic
// suite without weakening any authentication assertion. Structural
// pins only — no live publishing is performed or required.
function workflowStripped(): string {
  return readFileSync(WORKFLOW_PATH, "utf8").replace(/#.*/g, "");
}

function stepsOf(workflow: string): string[] {
  return [...workflow.matchAll(/run:\s*(.+)/g)].map((match) => match[1].trim());
}

describe("release pipeline (T-050 follow-up)", () => {
  describe("tag trigger and ordering", () => {
    it("triggers on version-tag pushes, never on a published release", () => {
      const raw = readFileSync(WORKFLOW_PATH, "utf8");
      assert.ok(/push:\s*\n\s*tags:\s*\n\s*-\s*"v\*"/.test(raw), "tag-push trigger restricted to v*");
      assert.ok(!/release:\s*\n\s*types:\s*\[published\]/.test(raw), "no release-published trigger remains");
      assert.ok(!/\n\s*on:\s*[^\n]*push[^:]/m.test(raw.replace(/push:\s*\n\s*tags:[^\n]*\n[^\n]*/g, "")), "no branch-push trigger");
    });

    it("validates the tag against package metadata before anything publishes", () => {
      const workflow = workflowStripped();
      assert.ok(workflow.includes("GITHUB_REF") && workflow.includes("package.json"), "tag-validation step present");
      const steps = stepsOf(workflow);
      const publish = steps.findIndex((step) => /^npm publish --access public$/.test(step));
      assert.ok(publish >= 0, "explicit scoped publish step present");
      assert.ok(workflow.indexOf("GITHUB_REF") < workflow.indexOf("npm publish --access public"), "validation precedes publication");
      assert.ok(/TAG_VERSION.*PKG_VERSION|tag version.*package\.json/i.test(workflow), "tag/package version comparison enforced");
      assert.ok(/@moassaad\/ai-team-framework/.test(workflow), "approved scoped identity enforced");
      assert.ok(/exit 1/.test(workflow), "mismatch refuses to publish");
    });

    it("checks out the tagged commit and keeps the OIDC toolchain floors", () => {
      const workflow = workflowStripped();
      assert.ok(/ref:\s*\$\{\{\s*github\.ref\s*\}\}/.test(workflow), "workflow runs on the tagged commit");
      assert.ok(/node-version:\s*22\.14\.0/.test(workflow), "Node floor intact");
      assert.ok(/npm@\^11\.5\.1/.test(workflow), "npm floor intact");
      assert.ok(/id-token:\s*write/.test(workflow), "OIDC minting permission intact");
      assert.ok(/contents:\s*read/.test(workflow), "minimum repository permission intact");
      const steps = stepsOf(workflow);
      for (const required of ["npm ci", "npm run build", "npm test", "npm pack --dry-run"]) {
        assert.ok(steps.some((step) => step === required), `${required} still gates publication`);
      }
    });
  });

  describe("deterministic suite and session separation", () => {
    it("the deterministic suite contains no live npm-session check", () => {
      for (const file of ["npm-publish-readiness.test.ts", "npm-identity-moassaad.test.ts", "npm-identity-decision.test.ts"]) {
        const code = readFileSync(join(REPO_ROOT, "tests", file), "utf8");
        assert.ok(!/npm", \["whoami"\]|\(\["whoami"\]\)/.test(code), `${file} performs no live whoami`);
      }
    });
    it("the default test command discovers compiled test files explicitly, not by directory", () => {
      const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { scripts?: Record<string, string> };
      assert.ok(
        (pkg.scripts?.test ?? "").includes("node --test dist-test/tests/*.test.js"),
        "deterministic suite passes explicit compiled-test paths (directory form fails on the release Node toolchain; quoted globs are not expanded by it)",
      );
      assert.ok(!(pkg.scripts?.test ?? "").includes("npm-session-auth"), "the glob cannot match the session gate file");
      assert.ok((pkg.scripts?.["test:npm-session"] ?? "").includes("dist-test/tests/npm-session-auth.js"), "explicit session command runs the session file");
    });
  });

    it("all authentication assertions are preserved in the session gate", () => {
      const code = readFileSync(join(REPO_ROOT, "tests", "npm-session-auth.ts"), "utf8");
      assert.ok(code.includes('"npm", ["whoami"]'), "the live whoami invocation is preserved");
      assert.equal(code.split("readOnlySession()").length - 1, 4, "helper plus all three session checks preserved");
      assert.ok(/moassaad/.test(code), "publisher expectation preserved");
      assert.ok(/_authToken|password/.test(code), "credential-material scan preserved");
      assert.ok(!/describe\.skip|it\.skip|process\.exit\(0\)/.test(code), "no silent skip or forced success");
    });

    it("OIDC publishing does not depend on npm whoami", () => {
      const workflow = workflowStripped();
      assert.ok(!/whoami/.test(workflow), "no whoami step in the publish pipeline");
      assert.ok(/npm publish --access public/.test(workflow), "OIDC mint happens inside npm publish");
    });
  });

  describe("post-publish verification and safe reruns", () => {
    it("verifies the exact published version on the registry with bounded retries", () => {
      const workflow = workflowStripped();
      assert.ok(/npm view "@moassaad\/ai-team-framework@\$PKG_VERSION" version/.test(workflow), "registry version check present");
      assert.ok(/REPORTED.*PKG_VERSION|registry reports/.test(workflow), "reported version compared to package metadata");
      assert.ok(/for attempt in|sleep 10/.test(workflow), "bounded visibility retries present");
      assert.ok(!/npm publish.*for attempt|for .*npm publish/.test(workflow), "publish itself is never retried");
    });

    it("smoke-tests the installed CLI against the package version", () => {
      const workflow = workflowStripped();
      assert.ok(/npm install "@moassaad\/ai-team-framework@\$PKG_VERSION"/.test(workflow), "isolated install of the exact version");
      assert.ok(/--version/.test(workflow), "installed CLI version asserted");
      assert.ok(!/latest/.test(workflow.replace(/ubuntu-latest/g, "")), "no floating version passes verification");
    });

    it("fails closed when the version already exists, with recovery", () => {
      const workflow = workflowStripped();
      assert.ok(workflow.includes("already exists"), "existence guard present");
      assert.ok(
        workflow.indexOf("already exists") < workflow.indexOf("npm publish --access public"),
        "existence guard precedes publication",
      );
      assert.ok(/dist\.integrity|Recovery/.test(workflow), "integrity comparison or recovery instruction present");
      assert.ok(!/npm unpublish|--force/.test(workflow), "no destructive recovery path");
    });

    it("verification and smoke failures fail the workflow without republishing", () => {
      const workflow = workflowStripped();
      assert.ok(/do NOT republish|never recommend republishing|do not.*republish/i.test(workflow), "immutable-version discipline stated");
    });
  });

  describe("no automatic GitHub Release", () => {
    it("the workflow never creates a release", () => {
      const workflow = workflowStripped();
      assert.ok(!/gh release create/.test(workflow), "no release creation step");
      assert.ok(!/releases:\s*write/.test(workflow), "no release-write permission");
      assert.ok(existsSync(join(REPO_ROOT, "docs", "release-0.3.0.md")), "manual release notes exist for the owner step");
    });
  });
