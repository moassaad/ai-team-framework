import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli";

// Help-content tests only (CLI-007): the help text documents the
// implemented CLI-001 through CLI-006 interfaces and nothing else.
describe("cli help", () => {
  const help = run(["--help"], "0.1.0").stdout;

  it("exits successfully and stays equivalent for -h", () => {
    assert.equal(run(["--help"], "0.1.0").exitCode, 0);
    assert.equal(run(["-h"], "0.1.0").stdout, help);
    assert.deepEqual(run(["--help"], "0.1.0"), run(["--help"], "0.1.0"));
  });

  it("documents the default run command and explicit role selection", () => {
    assert.match(help, /ai-team run\n/);
    assert.match(help, /ai-team run --role <role>/);
    for (const role of [
      "coordinator",
      "project-manager",
      "technical-lead",
      "implementer",
      "senior-reviewer",
    ]) {
      assert.ok(help.includes(role), `help must list ${role}`);
    }
  });

  it("lists only the approved aliases", () => {
    for (const alias of ["pm", "tl", "reviewer", "sr"]) {
      assert.ok(help.includes(alias), `help must list alias ${alias}`);
    }
    for (const invented of ["coord", "dev", "admin", "owner"]) {
      assert.equal(
        new RegExp(`\\b${invented}\\b`).test(help),
        false,
        `help must not list ${invented}`,
      );
    }
  });

  it("documents implementer specialty selection", () => {
    assert.match(help, /ai-team run --role implementer --specialty <specialty>/);
    assert.match(help, /only with --role implementer/);
    for (const specialty of [
      "backend",
      "frontend",
      "integration",
      "database",
      "testing",
      "documentation",
    ]) {
      assert.ok(help.includes(specialty), `help must list ${specialty}`);
    }
  });

  it("documents the positional prompt and slash syntax", () => {
    assert.match(help, /ai-team run "<prompt text>"/);
    assert.match(help, /approved role keywords/);
    assert.match(help, /ai-team run "\/<slash command>"/);
    assert.ok(help.includes("/technical-lead"));
    assert.ok(help.includes("/implementer <specialty>"));
    for (const notDocumented of ["/pm", "/tl", "/sr", "/reviewer"]) {
      assert.equal(help.includes(notDocumented), false, `help must not advertise ${notDocumented}`);
    }
  });

  it("advertises no unsupported flags, providers, or future features", () => {
    for (const unsupported of [
      "--provider",
      "--execute",
      "--output",
      "--watch",
      "OpenCode",
      "delegate-skills",
      "daemon",
    ]) {
      assert.equal(help.includes(unsupported), false, `help must not mention ${unsupported}`);
    }
  });

  it("leaves version behavior unchanged", () => {
    assert.equal(run(["--version"], "9.9.9-test").stdout, "9.9.9-test\n");
    assert.equal(run(["-V"], "9.9.9-test").stdout, "9.9.9-test\n");
  });
});
