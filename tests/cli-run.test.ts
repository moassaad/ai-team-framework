import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli";
import { COORDINATOR_ROLE } from "../src/roles/coordinator";

// Default-Coordinator-command tests only (`ai-team run`, CLI-001).
// No --role/--specialty handling, providers, or orchestration.
describe("cli run command", () => {
  it("resolves bare run to the Coordinator role contract", () => {
    const result = run(["run"], "0.1.0");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.ok(result.stdout.includes(COORDINATOR_ROLE.name));
    assert.ok(result.stdout.includes(COORDINATOR_ROLE.id));
    assert.ok(result.stdout.includes(COORDINATOR_ROLE.purpose));
  });

  it("states that role execution is not implemented", () => {
    const result = run(["run"], "0.1.0");
    assert.match(result.stdout, /not implemented/);
  });

  it("keeps help and version behavior ahead of run", () => {
    for (const argv of [["run", "--help"], ["run", "-h"]]) {
      const result = run(argv, "0.1.0");
      assert.equal(result.exitCode, 0);
      assert.match(result.stdout, /Usage:/);
    }
    const versioned = run(["run", "--version"], "9.9.9-test");
    assert.equal(versioned.stdout, "9.9.9-test\n");
  });

  it("rejects run with extra arguments such as --role", () => {
    for (const argv of [
      ["run", "--role", "project-manager"],
      ["run", "backend"],
      ["run", "extra"],
    ]) {
      const result = run(argv, "0.1.0");
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /unknown command/);
    }
  });

  it("never routes run to another role or specialty", () => {
    const result = run(["run"], "0.1.0");
    for (const other of ["project-manager", "technical-lead", "implementer", "senior-reviewer", "backend"]) {
      assert.equal(result.stdout.includes(other), false, `must not mention ${other}`);
    }
  });

  it("behaves deterministically", () => {
    assert.deepEqual(run(["run"], "0.1.0"), run(["run"], "0.1.0"));
  });
});
