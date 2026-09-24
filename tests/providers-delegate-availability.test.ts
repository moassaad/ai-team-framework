import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  createDelegateAvailabilityDetector,
  defaultDelegateSkillsProbe,
  isDelegateAvailability,
  validateDelegateAvailability,
} from "../src/providers/delegate-availability";

// Detector tests: injected probes only, never the real machine.
describe("delegate availability detector", () => {
  it("reports available and unavailable conditions exactly", () => {
    const present = createDelegateAvailabilityDetector(() => true);
    assert.deepEqual(present.check(), { available: true });
    const absent = createDelegateAvailabilityDetector(() => false);
    assert.deepEqual(absent.check(), { available: false });
    assert.equal(Object.isFrozen(present.check()), true);
  });

  it("is deterministic for the same environment", () => {
    let calls = 0;
    const detector = createDelegateAvailabilityDetector(() => {
      calls += 1;
      return calls % 2 === 1;
    });
    assert.deepEqual(detector.check(), { available: true });
    assert.deepEqual(detector.check(), { available: false });
    assert.equal(calls, 2);
    const stable = createDelegateAvailabilityDetector(() => true);
    assert.deepEqual(stable.check(), stable.check());
  });

  it("stays failure-safe when probing fails", () => {
    const throwing = createDelegateAvailabilityDetector(() => {
      throw new Error("env unreadable");
    });
    assert.deepEqual(throwing.check(), { available: false });
    const unruly = createDelegateAvailabilityDetector(() => {
      throw new TypeError("nope");
    });
    assert.doesNotThrow(() => unruly.check());
    assert.throws(
      () => createDelegateAvailabilityDetector("yes" as unknown as () => boolean),
      /delegate availability: invalid input/,
    );
  });

  it("validates availability results and freezes copies", () => {
    assert.deepEqual(validateDelegateAvailability({ available: true }), { available: true });
    assert.deepEqual(validateDelegateAvailability({ available: false, extra: 1 }), { available: false });
    assert.equal(isDelegateAvailability({ available: true }), true);
    assert.equal(isDelegateAvailability({ available: "yes" }), false);
    for (const data of [null, "x", [], {}, { available: "" }, { available: 1 }, {}]) {
      assert.equal(isDelegateAvailability(data), false);
      assert.throws(() => validateDelegateAvailability(data), /delegate availability: invalid input/);
    }
  });

  it("resolves the default probe from injected path inputs", () => {
    assert.equal(defaultDelegateSkillsProbe({ pathValue: "", isExecutable: () => true }), false);
    assert.equal(
      defaultDelegateSkillsProbe({ pathValue: `/bin${":"}/tools`, isExecutable: () => false }),
      false,
    );
    assert.equal(
      defaultDelegateSkillsProbe({
        pathValue: `/nowhere${":"}/tools`,
        isExecutable: (file) => file === `/tools${"/"}delegate-skills`,
      }),
      true,
    );
    assert.equal(defaultDelegateSkillsProbe({ pathValue: "/tools", isExecutable: () => true }), true);
    assert.equal(defaultDelegateSkillsProbe(null as unknown as object), false);
  });

  it("never delegates, constructs providers, or touches the machine", async () => {
    const calls: string[] = [];
    const detector = createDelegateAvailabilityDetector(() => {
      calls.push("probed");
      return true;
    });
    assert.deepEqual(detector.check(), { available: true });
    assert.deepEqual(calls, ["probed"]);
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(
      join(__dirname, "..", "..", "src", "providers", "delegate-availability.ts"),
      "utf8",
    );
    assert.ok(!/DelegateProvider|\.delegate\(|execute\(/i.test(code), "no delegation execution");
    assert.ok(!/child_process|execSync|spawn|execFile|shell/i.test(code), "no subprocesses");
    assert.ok(!/fetch\(|http:|https:|socket/i.test(code), "no network");
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/delegate-availability");
    assert.deepEqual(Object.keys(module).sort(), [
      "createDelegateAvailabilityDetector",
      "defaultDelegateSkillsProbe",
      "isDelegateAvailability",
      "validateDelegateAvailability",
    ]);
  });

  it("adds no selection, routing, config, workflow, or retry machinery", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(
      join(__dirname, "..", "..", "src", "providers", "delegate-availability.ts"),
      "utf8",
    );
    assert.ok(!/regist|singleton|select|rout|fallback|confirm|enabl/i.test(code), "no selection or routing");
    assert.ok(!/writeFile|appendFile|mkdir|process\.argv/i.test(code), "no mutation or CLI");
    assert.ok(!/workflow|transition|approval/i.test(code), "no workflow coupling");
    assert.ok(!/retry|backoff|setTimeout|setInterval/i.test(code), "no retry or timing");
    assert.ok(!/opencode|github|gitlab|jira|octokit/i.test(code), "no foreign provider");
  });
});
