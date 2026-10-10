import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dispatchHandoff } from "../src/runtime/handoff-dispatcher";
import {
  DELEGATE_SKILLS_TRANSPORT_NAME,
  createDelegateSkillsHandoffTransport,
  renderHandoffBrief,
} from "../src/providers/delegate-handoff-transport";
import { DELEGATE_SUPPORTED_DESTINATIONS, checkDelegateCapability } from "../src/providers/delegate-capability";
import { createManualFallback } from "../src/runtime/delegate-fallback";
import { validateAgentHandoff } from "../src/roles/handoff-validation";

const GUIDE = join(__dirname, "..", "..", "docs", "delegate-mode.md");
const REPO_ROOT = join(__dirname, "..", "..");

// Documented-path verification for docs/delegate-mode.md (M30
// T-048): the walkthrough executes through the real dispatcher,
// adapter, and fallback contracts with a controlled stub provider
// (explicitly labeled, never a real installation); capability,
// destination, parity, link, and scope claims are checked against
// source. No new product behavior.
function guideText(): string {
  return readFileSync(GUIDE, "utf8");
}

function implementerHandoff() {
  return validateAgentHandoff({
    from: "technical-lead",
    to: "implementer",
    objective: "Implement T-501.",
    requirements: ["Render saved articles newest first."],
    acceptance_criteria: ["Saved articles render newest first."],
    artifacts: ["T-501"],
  });
}

function stubTransport(outcome = "stubbed implementation of T-501") {
  return createDelegateSkillsHandoffTransport({
    provider: { name: "stub-relay", delegate: async () => ({ outcome }) },
  });
}

describe("delegate mode guide (M30 T-048)", () => {
  it("the documented walkthrough dispatches through the real contracts", async () => {
    const transport = stubTransport();
    assert.equal(transport.name, DELEGATE_SKILLS_TRANSPORT_NAME);
    assert.equal(DELEGATE_SKILLS_TRANSPORT_NAME, "delegate-skills");
    const result = await dispatchHandoff({ handoff: implementerHandoff(), transport });
    assert.equal(result.outcome, "dispatched");
    if (result.outcome !== "dispatched") {
      throw new Error("the documented walkthrough must dispatch");
    }
    assert.equal(result.transport, "delegate-skills");
    assert.equal(result.destination, "implementer");
    assert.deepEqual(result.receipt, { outcome: "stubbed implementation of T-501" });
    const brief = renderHandoffBrief(implementerHandoff());
    assert.ok(brief.startsWith("Delegated handoff from technical-lead to implementer.\n\nImplement T-501."));
    for (const section of ["Requirements:", "Acceptance criteria:", "Artifacts:"]) {
      assert.ok(brief.includes(section), `brief carries the labeled ${section} section`);
    }
  });

  it("the implementer-only destination boundary holds exactly as documented", async () => {
    assert.deepEqual([...DELEGATE_SUPPORTED_DESTINATIONS], ["implementer"]);
    const approvedButUnsupported: [string, string][] = [
      ["implementer", "technical-lead"],
      ["senior-reviewer", "technical-lead"],
      ["technical-lead", "project-manager"],
      ["coordinator", "technical-lead"],
    ];
    for (const [from, to] of approvedButUnsupported) {
      const result = await dispatchHandoff({
        handoff: validateAgentHandoff({ from, to, objective: "Route elsewhere." }),
        transport: stubTransport(),
      });
      assert.equal(result.outcome, "failed", `${to} never dispatches`);
      if (result.outcome !== "failed") {
        throw new Error("unreachable");
      }
      assert.equal(result.error.kind, "unsupported");
    }
    const text = guideText();
    assert.ok(/implementer.*only|only.*implementer/i.test(text));
    assert.ok(/destinations\s+are rejected with/i.test(text), "rejected destinations are named as rejected");
  });

  it("capability fields mean what the guide says, with no side effects", async () => {
    const integration = { name: "delegate", capabilities: ["detect"], detect: () => ({ available: true }) };
    const ready = await checkDelegateCapability({ integration, isEnabled: () => true });
    assert.deepEqual(
      { name: ready.name, enabled: ready.enabled, detected: ready.detected, ready: ready.ready },
      { name: "delegate", enabled: true, detected: true, ready: true },
    );
    assert.deepEqual([...ready.supportedDestinations], ["implementer"]);
    assert.ok(Object.isFrozen(ready));
    const unavailable = await checkDelegateCapability({
      integration: { name: "delegate", capabilities: ["detect"], detect: () => ({ available: false }) },
      isEnabled: () => true,
    });
    assert.equal(unavailable.enabled, true);
    assert.equal(unavailable.detected, false);
    assert.equal(unavailable.ready, false, "enabled-but-undetected is never ready");
  });

  it("transport failure and manual fallback behave as documented", async () => {
    const failed = await dispatchHandoff({
      handoff: implementerHandoff(),
      transport: {
        name: "broken",
        dispatch: async () => { throw new Error("relay exploded"); },
      },
    });
    assert.equal(failed.outcome, "failed");
    if (failed.outcome !== "failed") {
      throw new Error("unreachable");
    }
    assert.equal(failed.error.kind, "transport-error");
    assert.equal(failed.error.message, "relay exploded");
    const fallback = createManualFallback({ failure: failed });
    assert.equal(fallback.transport, "manual");
    assert.equal(fallback.destination, "implementer");
    assert.deepEqual(fallback.handoff, implementerHandoff());
    assert.match(fallback.renderedHandoff, /^=== AI TEAM HANDOFF ===/);
    assert.deepEqual(fallback.error, { kind: "transport-error", message: "relay exploded" });
    assert.ok(Object.isFrozen(fallback));
    const text = guideText();
    assert.ok(/does not itself execute|executes nothing/i.test(text), "fallback performs nothing");
  });

  it("the documented installation and configuration route matches source and docs", () => {
    const text = guideText();
    assert.ok(text.includes("npx skills add amElnagdy/delegate-skills --skill <skill>"));
    assert.ok(text.includes("providers:\n  delegate:\n    enabled: true"));
    assert.ok(/never auto-enabled|off\n  by default|off by default/i.test(text));
    assert.ok(/>= 22\.20\.0/.test(text), "the Skills CLI Node floor is stated");
    assert.ok(/never uses `sudo`|never.*sudo/i.test(text));
    assert.ok(/ai-team setup delegate/.test(text), "the verified per-integration setup command is named");
    assert.ok(existsSync(join(REPO_ROOT, "docs", "providers-delegate-skills.md")));
  });

  it("parity scope is reported as handoff- and destination-level only", () => {
    const text = guideText();
    assert.ok(/handoff-level parity/i.test(text));
    assert.ok(/destination-level parity/i.test(text));
    assert.ok(/NOT proven|not.*whole-team/i.test(text), "whole-team parity is disclaimed");
    assert.ok(!/five-role.*parity|whole-team.*proven|end-to-end.*workflow.*parity/i.test(text), "no inflated parity claim");
  });

  it("correction, secrecy, and manual-independence claims match the contracts", () => {
    const text = guideText();
    assert.ok(/CorrectionReference|rework handoff/i.test(text));
    assert.ok(/does not approve the correction|never.*approves/i.test(text));
    assert.ok(/never.*secrets|Never put secrets/i.test(text));
    assert.ok(!/--token|password\s*[:=]\s*\S|Bearer [A-Za-z0-9]/i.test(text), "no credential material");
    assert.ok(/works with Delegate\n  down|with Delegate down|manual path works/i.test(text), "manual mode stands alone");
  });

  it("every documentation link resolves and every referenced module exists", () => {
    const text = guideText();
    const links = [...text.matchAll(/`?(docs\/[a-z0-9-]+\.md)`?/g)].map((match) => match[1]);
    assert.ok(links.length > 0);
    for (const link of new Set(links)) {
      assert.ok(existsSync(join(REPO_ROOT, link)), `guide link resolves: ${link}`);
    }
    for (const module of [
      "delegate-handoff-transport.ts",
      "delegate-capability.ts",
      "handoff-dispatcher.ts",
      "delegate-fallback.ts",
    ]) {
      assert.ok(text.includes(module), `the guide names ${module}`);
      const full = module === "handoff-dispatcher.ts" || module === "delegate-fallback.ts"
        ? join("src", "runtime", module)
        : join("src", "providers", module);
      assert.ok(existsSync(join(REPO_ROOT, full)), `referenced module exists: ${full}`);
    }
  });

  it("the guide stays within T-048 scope", () => {
    const text = guideText();
    assert.ok(/T-049/.test(text) && /forthcoming/i.test(text), "T-049 is deferred, not written");
    assert.ok(!/release 0\.3\.0|npm publish/.test(text), "no T-050 release work");
    assert.ok(!existsSync(join(REPO_ROOT, "docs", "final-product-e2e.md")), "no T-049 verification artifact");
  });

  it("existing manual/Delegate parity coverage remains intact", async () => {
    const handoff = implementerHandoff();
    const viaDelegate = await dispatchHandoff({ handoff, transport: stubTransport("same text") });
    assert.equal(viaDelegate.outcome, "dispatched");
    if (viaDelegate.outcome !== "dispatched") {
      throw new Error("unreachable");
    }
    assert.deepEqual(viaDelegate.handoff, handoff, "the dispatched handoff travels intact");
    assert.deepEqual(viaDelegate.receipt, { outcome: "same text" }, "receipts stay opaque and unparsed");
  });
});
