import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  isDelegationConfirmation,
  requireDelegationConfirmation,
  resolveDelegationConfirmation,
} from "../src/providers/delegate-confirmation";

// Safety-confirmation tests: pure decision handling only. No provider
// is constructed, nothing is executed, and delegate-skills is never
// needed.
describe("delegation safety confirmation", () => {
  it("represents explicit confirmation correctly", () => {
    assert.equal(resolveDelegationConfirmation("confirmed"), "confirmed");
    assert.equal(isDelegationConfirmation("confirmed"), true);
    assert.doesNotThrow(() => requireDelegationConfirmation("confirmed"));
  });

  it("represents explicit rejection correctly", () => {
    assert.equal(resolveDelegationConfirmation("rejected"), "rejected");
    assert.equal(isDelegationConfirmation("rejected"), true);
    assert.throws(
      () => requireDelegationConfirmation("rejected"),
      /delegate confirmation: delegation requires explicit confirmation/,
    );
  });

  it("treats missing confirmation as pending, never as approval", () => {
    assert.equal(resolveDelegationConfirmation(undefined), "pending");
    assert.equal(resolveDelegationConfirmation(null), "pending");
    assert.equal(isDelegationConfirmation("pending"), true);
    assert.throws(() => requireDelegationConfirmation(undefined), /requires explicit confirmation/);
    assert.throws(() => requireDelegationConfirmation(null), /requires explicit confirmation/);
    assert.throws(() => requireDelegationConfirmation("pending"), /requires explicit confirmation/);
  });

  it("never confirms automatically and never interprets other values", () => {
    for (const value of [true, false, 1, 0, "yes", "no", "approve", "ok", {}, [], "CONFIRMED"]) {
      assert.throws(
        () => resolveDelegationConfirmation(value),
        /delegate confirmation: unknown confirmation/,
      );
      assert.throws(() => requireDelegationConfirmation(value), /delegate confirmation: /);
    }
  });

  it("does not grant confirmation from enablement or availability alone", () => {
    // D-004 enablement is a boolean; D-002 availability is a result
    // object. Neither shape is a confirmation decision.
    assert.throws(() => requireDelegationConfirmation(true), /delegate confirmation: /);
    assert.throws(() => requireDelegationConfirmation(false), /delegate confirmation: /);
    assert.throws(
      () => requireDelegationConfirmation({ available: true }),
      /delegate confirmation: /,
    );
    assert.throws(
      () => requireDelegationConfirmation({ available: false }),
      /delegate confirmation: /,
    );
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/delegate-confirmation");
    assert.deepEqual(Object.keys(module).sort(), [
      "isDelegationConfirmation",
      "requireDelegationConfirmation",
      "resolveDelegationConfirmation",
    ]);
  });

  it("executes nothing and stays provider-neutral", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(
      join(__dirname, "..", "..", "src", "providers", "delegate-confirmation.ts"),
      "utf8",
    );
    assert.ok(!/^import /m.test(code), "no imports: independent of every other module");
    assert.ok(
      !/delegate-skills|spawn|child_process|provider|adapter|registry|rout|select|availability|probe/i.test(
        code,
      ),
      "no execution, tool, or selection vocabulary",
    );
    assert.ok(
      !/config|workflow|approv|cli|install|retry|fallback|transition|WorkflowState/i.test(code),
      "no adjacent systems",
    );
    assert.ok(!/ shell|shell:/i.test(code), "no shell");
  });
});
