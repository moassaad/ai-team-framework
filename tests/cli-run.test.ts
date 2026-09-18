import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli";
import { COORDINATOR_ROLE } from "../src/roles/coordinator";
import { PROJECT_MANAGER_ROLE } from "../src/roles/project-manager";
import { TECHNICAL_LEAD_ROLE } from "../src/roles/technical-lead";
import { IMPLEMENTER_ROLE } from "../src/roles/implementer";
import { SENIOR_REVIEWER_ROLE } from "../src/roles/senior-reviewer";

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

  it("rejects run with unsupported extra arguments", () => {
    for (const argv of [["run", "backend"], ["run", "extra"]]) {
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

describe("cli run --role selection", () => {
  const CONTRACTS = [
    COORDINATOR_ROLE,
    PROJECT_MANAGER_ROLE,
    TECHNICAL_LEAD_ROLE,
    IMPLEMENTER_ROLE,
    SENIOR_REVIEWER_ROLE,
  ];

  it("resolves every canonical role id through its own contract", () => {
    for (const contract of CONTRACTS) {
      const result = run(["run", "--role", contract.id], "0.1.0");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.ok(result.stdout.includes(contract.name));
      assert.ok(result.stdout.includes(contract.id));
      assert.ok(result.stdout.includes(contract.purpose));
    }
  });

  it("resolves the existing aliases to their canonical roles", () => {
    const cases: Array<[string, typeof PROJECT_MANAGER_ROLE]> = [
      ["pm", PROJECT_MANAGER_ROLE],
      ["tl", TECHNICAL_LEAD_ROLE],
      ["reviewer", SENIOR_REVIEWER_ROLE],
      ["sr", SENIOR_REVIEWER_ROLE],
    ];
    for (const [alias, contract] of cases) {
      const result = run(["run", "--role", alias], "0.1.0");
      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes(contract.name));
      assert.ok(result.stdout.includes(contract.id));
    }
  });

  it("rejects specialties, unknown roles, and malformed usage without fallback", () => {
    for (const value of [
      "backend",
      "frontend",
      "integration",
      "database",
      "testing",
      "documentation",
      "unknown",
      "developer",
      "",
    ]) {
      const result = run(["run", "--role", value], "0.1.0");
      assert.equal(result.exitCode, 1, `must reject --role ${JSON.stringify(value)}`);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /unknown command/);
    }
    for (const argv of [["run", "--role"], ["run", "--role", "pm", "extra"], ["run", "--specialty", "backend"]]) {
      const result = run(argv, "0.1.0");
      assert.equal(result.exitCode, 1, `must reject ${JSON.stringify(argv)}`);
      assert.equal(result.stdout, "");
    }
  });

  it("keeps help and version precedence over --role", () => {
    assert.match(run(["run", "--role", "pm", "--help"], "0.1.0").stdout, /Usage:/);
    assert.equal(run(["run", "--role", "pm", "--version"], "9.9.9-test").stdout, "9.9.9-test\n");
  });

  it("behaves deterministically for role selection", () => {
    assert.deepEqual(
      run(["run", "--role", "tl"], "0.1.0"),
      run(["run", "--role", "technical-lead"], "0.1.0"),
    );
  });
});
