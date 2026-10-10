import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dispatchHandoff } from "../src/runtime/handoff-dispatcher";
import { createDelegateSkillsHandoffTransport } from "../src/providers/delegate-handoff-transport";
import { createManualFallback } from "../src/runtime/delegate-fallback";
import { createTlImplementerReworkHandoff } from "../src/runtime/tl-implementer-rework-handoff";
import { validateAgentHandoff, renderAgentHandoff } from "../src/roles/handoff-validation";
import { parseAgentHandoffText } from "../src/roles/handoff-parser";
import { executeIndependentImplementer } from "../src/roles/independent-execution";
import { runFastBugLifecycle } from "../src/runtime/fast-bug-lifecycle";
import { getWorkModeDescriptor } from "../src/runtime/work-mode";
import { DelegationRequest } from "../src/providers/delegate";

// Manual/delegate end-to-end parity tests (M29 T-042).
//
// Proven scope, stated plainly: HANDOFF-LEVEL parity (the
// same canonical handoff survives manual render/parse and
// delegate dispatch with equivalent semantics) plus
// DESTINATION-LEVEL parity (the implementer — the only
// supported delegate destination — receives equivalent
// inputs and produces equivalent structured outcomes under
// controlled conditions). NOT whole-team workflow parity:
// lifecycles never route through dispatchHandoff, and the
// delegate transport supports the implementer destination
// only. The relay double below is a TEST HARNESS modeling
// destination execution behind the transport boundary; it
// is not production orchestration and creates no src files.

function tlReworkFixture() {
  const correction = {
    origin: "technical-lead",
    ticketIds: ["T-501"],
    feedback: "Harden the sync path: retries must back off exponentially.",
    action: { description: "Rework T-501 per the TL correction.", ticketId: "T-501" },
  };
  const handoff = createTlImplementerReworkHandoff({ correction });
  const ticket = { id: "T-501", title: "Harden sync retries", description: "Back off exponentially on sync failure.", requirements: "Retries back off exponentially" };
  return { correction, handoff, ticket };
}

function stubProvider(calls: { role?: string }[], text: string, rejectRole?: string) {
  return {
    name: "stub",
    execute: async (request: { prompt: string; project_root: string; role?: string }) => {
      calls.push({ role: request.role });
      if (request.role === rejectRole) {
        throw new Error("provider boom");
      }
      return { status: "succeeded" as const, text };
    },
  };
}

/**
 * Test-only relay double: captures the delegate brief, then
 * models destination execution by running the independent
 * implementer with the caller-built ticket through the
 * shared stub provider. Proves the transported meaning
 * drives equivalent execution; owns no production role.
 */
function relayDouble(
  requests: DelegationRequest[],
  ticket: { id: string; title: string; description: string; requirements: string },
  provider: ReturnType<typeof stubProvider>,
  executions: { count: number },
) {
  return {
    name: "parity-relay-double",
    delegate: async (request: DelegationRequest) => {
      requests.push(request);
      const outcome = await executeIndependentImplementer({
        identity: { role: "implementer" },
        input: { ticket, specialty: "backend", role: "implementer", project_root: "/proj", provider, timeout_ms: 1000 },
      });
      executions.count += 1;
      if (outcome.execution.outcome !== "completed") {
        return { outcome: `implementation failed for ${ticket.id}` };
      }
      return { outcome: outcome.execution.result.text };
    },
  };
}

describe("manual/delegate end-to-end parity (M29 T-042)", () => {
  describe("handoff-level parity", () => {
    it("M26 lower-level parity holds: manual round-trip is byte-exact", () => {
      const { handoff } = tlReworkFixture();
      assert.deepEqual(validateAgentHandoff(parseAgentHandoffText(renderAgentHandoff(handoff))), handoff);
    });

    it("the same validated handoff enters both transports", async () => {
      const { handoff } = tlReworkFixture();
      const manual = validateAgentHandoff(parseAgentHandoffText(renderAgentHandoff(handoff)));
      const requests: DelegationRequest[] = [];
      const executions = { count: 0 };
      const provider = stubProvider([], "relay executed");
      const result = await dispatchHandoff({
        handoff: validateAgentHandoff(handoff),
        transport: createDelegateSkillsHandoffTransport({ provider: relayDouble(requests, tlReworkFixture().ticket, provider, executions) }),
      });
      assert.equal(result.outcome, "dispatched");
      assert.deepEqual(manual, handoff);
      assert.equal(requests.length, 1);
    });

    it("every semantic field survives both paths", async () => {
      const { handoff, correction } = tlReworkFixture();
      const manual = validateAgentHandoff(parseAgentHandoffText(renderAgentHandoff(handoff)));
      assert.equal(manual.from, "technical-lead");
      assert.equal(manual.to, "implementer");
      assert.equal(manual.objective, handoff.objective);
      assert.equal(manual.notes, correction.feedback);
      assert.deepEqual(manual.artifacts, ["T-501"]);
      const requests: DelegationRequest[] = [];
      const executions = { count: 0 };
      await dispatchHandoff({
        handoff,
        transport: createDelegateSkillsHandoffTransport({ provider: relayDouble(requests, tlReworkFixture().ticket, stubProvider([], "x"), executions) }),
      });
      assert.ok(requests[0].task.includes("Rework T-501 per the TL correction."));
      assert.ok(requests[0].task.includes("Harden the sync path: retries must back off exponentially."));
      assert.ok(requests[0].task.includes("T-501"));
    });

    it("canonical render and parse behavior is unchanged by either path", () => {
      const { handoff } = tlReworkFixture();
      const text = renderAgentHandoff(handoff);
      assert.ok(text.startsWith("=== AI TEAM HANDOFF ==="));
      assert.ok(!text.toLowerCase().includes("delegate") && !text.toLowerCase().includes("relay"));
    });

    it("invalid handoffs fail before dispatch and before manual acceptance", async () => {
      const requests: DelegationRequest[] = [];
      const executions = { count: 0 };
      const transport = createDelegateSkillsHandoffTransport({ provider: relayDouble(requests, tlReworkFixture().ticket, stubProvider([], "x"), executions) });
      await assert.rejects(dispatchHandoff({ handoff: { from: "technical-lead" }, transport }), /agent handoff/);
      assert.throws(() => parseAgentHandoffText("not a handoff"), /./);
      assert.equal(requests.length, 0);
      assert.equal(executions.count, 0);
    });

    it("unsupported destinations fail explicitly on delegate while manual still transfers", async () => {
      const pmTl = validateAgentHandoff({ from: "project-manager", to: "technical-lead", objective: "Replan T-9" });
      const requests: DelegationRequest[] = [];
      const executions = { count: 0 };
      const result = await dispatchHandoff({
        handoff: pmTl,
        transport: createDelegateSkillsHandoffTransport({ provider: relayDouble(requests, tlReworkFixture().ticket, stubProvider([], "x"), executions) }),
      });
      assert.equal(result.outcome, "failed");
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.error.kind, "unsupported");
      assert.equal(executions.count, 0);
      assert.deepEqual(validateAgentHandoff(parseAgentHandoffText(renderAgentHandoff(pmTl))), pmTl);
    });
  });

  describe("destination-level parity", () => {
    it("destination inputs are equivalent under controlled conditions", async () => {
      const { handoff, ticket } = tlReworkFixture();
      const manualCalls: { role?: string }[] = [];
      const manual = await executeIndependentImplementer({
        identity: { role: "implementer" },
        input: { ticket, specialty: "backend", role: "implementer", project_root: "/proj", provider: stubProvider(manualCalls, "done"), timeout_ms: 1000 },
      });
      assert.deepEqual(validateAgentHandoff(parseAgentHandoffText(renderAgentHandoff(handoff))), handoff);
      const requests: DelegationRequest[] = [];
      const executions = { count: 0 };
      const relayProvider = stubProvider([], "done");
      const dispatched = await dispatchHandoff({
        handoff,
        transport: createDelegateSkillsHandoffTransport({ provider: relayDouble(requests, ticket, relayProvider, executions) }),
      });
      assert.equal(dispatched.outcome, "dispatched");
      assert.equal(manual.execution.outcome, "completed");
      assert.equal(executions.count, 1, "one destination execution per path, nothing else");
    });

    it("structured destination outcomes match without parsing provider text", async () => {
      const { handoff, ticket } = tlReworkFixture();
      const manual = await executeIndependentImplementer({
        identity: { role: "implementer" },
        input: { ticket, specialty: "backend", role: "implementer", project_root: "/proj", provider: stubProvider([], "identical output"), timeout_ms: 1000 },
      });
      const requests: DelegationRequest[] = [];
      const executions = { count: 0 };
      const relayed = await dispatchHandoff({
        handoff,
        transport: createDelegateSkillsHandoffTransport({ provider: relayDouble(requests, ticket, stubProvider([], "identical output"), executions) }),
      });
      if (manual.execution.outcome !== "completed") throw new Error("unreachable");
      assert.equal(relayed.outcome, "dispatched");
      if (relayed.outcome !== "dispatched") throw new Error("unreachable");
      assert.equal(manual.execution.ticket_id, "T-501");
      assert.equal(manual.execution.next_state, "implementation_review");
      assert.equal(relayed.receipt !== undefined && (relayed.receipt as { outcome: string }).outcome, "identical output", "same stub text both sides: meaning preserved end to end");
    });

    it("destination failure surfaces equivalently without conflating layers", async () => {
      const { ticket } = tlReworkFixture();
      const manual = await executeIndependentImplementer({
        identity: { role: "implementer" },
        input: { ticket, specialty: "backend", role: "implementer", project_root: "/proj", provider: stubProvider([], "x", "implementer"), timeout_ms: 1000 },
      });
      assert.equal(manual.execution.outcome, "failed");
      if (manual.execution.outcome !== "failed") throw new Error("unreachable");
      assert.equal(manual.execution.ticket_id, "T-501");
      const requests: DelegationRequest[] = [];
      const executions = { count: 0 };
      const relayed = await dispatchHandoff({
        handoff: tlReworkFixture().handoff,
        transport: createDelegateSkillsHandoffTransport({ provider: relayDouble(requests, ticket, stubProvider([], "x", "implementer"), executions) }),
      });
      assert.equal(relayed.outcome, "dispatched", "transport succeeded; the destination reported failure inside the receipt");
      if (relayed.outcome !== "dispatched") throw new Error("unreachable");
      assert.deepEqual(relayed.receipt, { outcome: "implementation failed for T-501" });
    });
  });

  describe("transport failure and explicit fallback", () => {
    it("transport failure preserves kind and message through the dispatcher", async () => {
      const { handoff } = tlReworkFixture();
      const failing = {
        name: "down-relay",
        delegate: async () => {
          throw new Error("relay unreachable");
        },
      };
      const result = await dispatchHandoff({
        handoff,
        transport: createDelegateSkillsHandoffTransport({ provider: failing }),
      });
      assert.equal(result.outcome, "failed");
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.error.message, "relay unreachable");
      assert.deepEqual(result.handoff, handoff);
    });

    it("manual fallback returns the original handoff for caller review, executing nothing", async () => {
      const implementerCalls: { role?: string }[] = [];
      const { handoff } = tlReworkFixture();
      const failing = {
        name: "down-relay",
        delegate: async () => {
          throw new Error("relay unreachable");
        },
      };
      const result = await dispatchHandoff({
        handoff,
        transport: createDelegateSkillsHandoffTransport({ provider: failing }),
      });
      if (result.outcome !== "failed") throw new Error("unreachable");
      const fallback = createManualFallback({ failure: result });
      assert.equal(fallback.transport, "manual");
      assert.deepEqual(fallback.handoff, handoff);
      assert.equal(fallback.renderedHandoff, renderAgentHandoff(handoff));
      assert.equal(validateAgentHandoff(parseAgentHandoffText(fallback.renderedHandoff)).to, "implementer");
      assert.equal(implementerCalls.length, 0, "fallback construction runs no role");
    });

    it("manual mode stays usable while delegate is unavailable", async () => {
      const { handoff, ticket } = tlReworkFixture();
      const failing = {
        name: "down-relay",
        delegate: async () => {
          throw new Error("down");
        },
      };
      const failed = await dispatchHandoff({
        handoff,
        transport: createDelegateSkillsHandoffTransport({ provider: failing }),
      });
      assert.equal(failed.outcome, "failed");
      const transferred = validateAgentHandoff(parseAgentHandoffText(renderAgentHandoff(handoff)));
      const manual = await executeIndependentImplementer({
        identity: { role: "implementer" },
        input: { ticket, specialty: "backend", role: "implementer", project_root: "/proj", provider: stubProvider([], "manual done"), timeout_ms: 1000 },
      });
      assert.deepEqual(transferred, handoff);
      assert.equal(manual.execution.outcome, "completed");
    });
  });

  describe("shared lifecycle stop behavior", () => {
    it("a shared review rejection stops both scenarios identically", async () => {
      const runScenario = (label: string) =>
        runFastBugLifecycle({
          ticket: { id: "T-501", title: "Harden sync retries", description: "Back off exponentially.", requirements: "Retries back off exponentially" },
          specialty: "backend",
          project_root: "/proj",
          provider: stubProvider([], `${label} output`),
          reviewDecision: () => ({ decision: "changes_requested" as const, feedback: "Reproduce first." }),
          timeout_ms: 1000,
        });
      const manualPath = await runScenario("manual");
      const { handoff } = tlReworkFixture();
      const requests: DelegationRequest[] = [];
      const executions = { count: 0 };
      await dispatchHandoff({
        handoff,
        transport: createDelegateSkillsHandoffTransport({ provider: relayDouble(requests, tlReworkFixture().ticket, stubProvider([], "x"), executions) }),
      });
      const delegatePath = await runScenario("delegate");
      for (const result of [manualPath, delegatePath]) {
        assert.equal(result.outcome, "changes-required");
        if (result.outcome !== "changes-required") throw new Error("unreachable");
        assert.equal(result.feedback, "Reproduce first.");
      }
      assert.deepEqual(manualPath.outcome, delegatePath.outcome);
    });

    it("repeat runs stay semantically equivalent", async () => {
      const { handoff } = tlReworkFixture();
      const runOnce = async () => {
        const requests: DelegationRequest[] = [];
        const executions = { count: 0 };
        const result = await dispatchHandoff({
          handoff,
          transport: createDelegateSkillsHandoffTransport({ provider: relayDouble(requests, tlReworkFixture().ticket, stubProvider([], "steady"), executions) }),
        });
        if (result.outcome !== "dispatched") throw new Error("unreachable");
        return result.receipt;
      };
      assert.deepEqual(await runOnce(), await runOnce());
      assert.deepEqual(await runOnce(), { outcome: "steady" });
    });
  });

  describe("scope honesty and boundaries", () => {
    it("labels the proven scope: implementer-only delegate destination", async () => {
      const reviewerHandoff = validateAgentHandoff({ from: "implementer", to: "senior-reviewer", objective: "Review T-501" });
      const requests: DelegationRequest[] = [];
      const executions = { count: 0 };
      const result = await dispatchHandoff({
        handoff: reviewerHandoff,
        transport: createDelegateSkillsHandoffTransport({ provider: relayDouble(requests, tlReworkFixture().ticket, stubProvider([], "x"), executions) }),
      });
      assert.equal(result.outcome, "failed", "reviewer destinations unsupported: parity stops at the implementer");
    });

    it("introduces no unsupported role directions in either path", async () => {
      const requests: DelegationRequest[] = [];
      const executions = { count: 0 };
      const transport = createDelegateSkillsHandoffTransport({ provider: relayDouble(requests, tlReworkFixture().ticket, stubProvider([], "x"), executions) });
      await assert.rejects(dispatchHandoff({ handoff: { from: "project-manager", to: "implementer", objective: "Skip" }, transport }), /unsupported handoff direction/);
      assert.throws(() => validateAgentHandoff({ from: "project-manager", to: "implementer", objective: "Skip" }), /unsupported handoff direction/);
      assert.equal(requests.length, 0);
    });

    it("adds no production modules, runners, registries, or later-ticket behavior", () => {
      const ownSource = readFileSync(join(__dirname, "..", "..", "tests", "manual-delegate-end-to-end-parity.test.ts"), "utf8");
      assert.ok(!/export (function|const|interface|type) \w*(Runner|Orchestrat|Registr|Engine|Manager)\w*/.test(ownSource));
      for (const token of ["runFullTeam", "runWorkMode", "T-043", "M30", "checkpoint", "scaffold"]) {
        const occurrences = ownSource.split(token).length - 1;
        assert.equal(occurrences, 1, `${token} appears only in this scope pin, never as implemented logic`);
      }
      const stray = ["runtime", "providers"].flatMap((dir) =>
        readdirSync(join(__dirname, "..", "..", "src", dir)).filter((entry) => /parity|e2e|end-to-end/i.test(entry)),
      );
      assert.deepEqual(stray, [], "parity composition lives in tests only");
    });

    it("leaves M22 through M41 contracts and lifecycles unchanged", async () => {
      assert.deepEqual(getWorkModeDescriptor("full").lifecycle.length, 7);
      for (const file of ["src/runtime/handoff-dispatcher.ts", "src/providers/delegate-handoff-transport.ts", "src/runtime/delegate-fallback.ts", "src/runtime/fast-path.ts", "src/runtime/reentry-request.ts"]) {
        const code = readFileSync(join(__dirname, "..", "..", file), "utf8");
        assert.ok(!code.includes("end-to-end-parity") && !code.includes("EndToEndParity"), `${file} unchanged by T-042`);
      }
      const { handoff, ticket } = tlReworkFixture();
      const requests: DelegationRequest[] = [];
      const executions = { count: 0 };
      const result = await dispatchHandoff({
        handoff,
        transport: createDelegateSkillsHandoffTransport({ provider: relayDouble(requests, ticket, stubProvider([], "ok"), executions) }),
      });
      assert.equal(result.outcome, "dispatched");
    });
  });
});
