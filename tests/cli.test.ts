import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli";

describe("cli", () => {
  it("shows help with no arguments and exits zero", () => {
    const result = run([], "0.1.0");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /--help/);
    assert.match(result.stdout, /--version/);
  });

  it("shows help for --help and -h", () => {
    for (const argv of [["--help"], ["-h"]]) {
      const result = run(argv, "0.1.0");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.match(result.stdout, /AI Team Framework CLI/);
    }
  });

  it("prints the given version for --version and -V", () => {
    for (const argv of [["--version"], ["-V"]]) {
      const result = run(argv, "9.9.9-test");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "9.9.9-test\n");
    }
  });

  it("rejects unknown commands with a non-zero exit and no stack trace", () => {
    for (const argv of [["run"], ["--role"], ["--unknown-flag"]]) {
      const result = run(argv, "0.1.0");
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /unknown command/);
      assert.match(result.stderr, /--help/);
    }
  });
});
