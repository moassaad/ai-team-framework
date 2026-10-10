import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_IDS } from "../src/roles/contract";
import {
  executeIndependentCoordinator,
  executeIndependentImplementer,
  executeIndependentProjectManager,
  executeIndependentSeniorReviewer,
  executeIndependentTechnicalLead,
} from "../src/roles/independent-execution";

// Independent role execution tests (M22 T-005): one role per
// invocation through the existing seams. Hermetic: every provider
// is a caller-supplied counting stub; failure means rejection,
// never a real system.
interface CallRecord {
  prompt: string;
  project_root: string;
  role?: string;
}

function countingProvider(calls: CallRecord[], text: string, reject = false) {
  return {
    name: "stub",
    execute: async (request: { prompt: string; project_root: string; role?: string }) => {
      calls.push({ prompt: request.prompt, project_root: request.project_root, role: request.role });
      if (reject) {
        throw new Error("provider boom");
      }
      return { status: "succeeded" as const, text };
    },
  };
}

function ticket(id: string) {
  return { id, title: `Title ${id}`, description: `Description ${id}`, requirements: `Requirements ${id}` };
}

function evidence(id: string, state: "technical_approval") {
  return { ...ticket(id), state };
}

describe("independent role identity", () => {
  it("executes each role independently with its own identity", async () => {
    const calls: CallRecord[] = [];
    const provider = countingProvider(calls, "done");
    const implementer = await executeIndependentImplementer({
      identity: { role: "implementer" },
      input: { ticket: ticket("T-1"), specialty: "backend", role: "implementer", project_root: "/proj", provider, timeout_ms: 1000 },
    });
    assert.equal(implementer.role, "implementer");
    assert.equal(implementer.execution.outcome, "completed");

    const reviewer = await executeIndependentSeniorReviewer({
      identity: { role: "senior-reviewer" },
      input: { ticket: ticket("T-1"), implementation_result: "result", role: "senior-reviewer", project_root: "/proj", provider, timeout_ms: 1000 },
    });
    assert.equal(reviewer.role, "senior-reviewer");
    assert.equal(reviewer.execution.outcome, "completed");

    const lead = await executeIndependentTechnicalLead({
      identity: { role: "technical-lead" },
      input: { evidence: [evidence("T-1", "technical_approval")], role: "technical-lead", project_root: "/proj", provider, timeout_ms: 1000 },
    });
    assert.equal(lead.role, "technical-lead");
    assert.equal(lead.execution.outcome, "completed");

    const manager = await executeIndependentProjectManager({
      identity: { role: "project-manager" },
      input: { evidence: [evidence("T-1", "technical_approval")], role: "project-manager", project_root: "/proj", provider, timeout_ms: 1000 },
    });
    assert.equal(manager.role, "project-manager");
    assert.equal(manager.execution.outcome, "completed");
  });

  it("executes the Coordinator independently around its existing ticket runtime", async () => {
    const calls: CallRecord[] = [];
    const implementerProvider = countingProvider(calls, "Implemented.");
    const reviewerProvider = countingProvider(calls, "Clean.");
    const tickets = [{ ...ticket("T-1"), state: "ready" as const }];
    const outcome = await executeIndependentCoordinator({
      identity: { role: "coordinator" },
      input: {
        tickets,
        roles: {
          resolveImplementer: () => ({ role: "implementer", specialty: "backend", provider: implementerProvider }),
          resolveSeniorReviewer: () => ({ role: "senior-reviewer", provider: reviewerProvider }),
        },
        project_root: "/proj",
        timeout_ms: 1000,
        decideReview: async () => ({ decision: "approved" as const }),
      },
    });
    assert.equal(outcome.role, "coordinator");
    assert.equal(outcome.execution.outcome, "completed");
    assert.deepEqual(tickets, [{ ...ticket("T-1"), state: "ready" as const }], "caller tickets never mutated");
  });

  it("rejects unknown and malformed identities before any provider call", async () => {
    const calls: CallRecord[] = [];
    const provider = countingProvider(calls, "done");
    const input = { ticket: ticket("T-1"), specialty: "backend" as const, role: "implementer" as const, project_root: "/proj", provider, timeout_ms: 1000 };
    for (const identity of [{ role: "bogus" }, { role: "pm" }, {}, null, "implementer", 7]) {
      await assert.rejects(executeIndependentImplementer({ identity, input }), "identity validated first");
    }
    assert.equal(calls.length, 0);
  });

  it("rejects cross-role mismatch without inferring or repairing the role", async () => {
    const calls: CallRecord[] = [];
    const provider = countingProvider(calls, "done");
    await assert.rejects(
      executeIndependentSeniorReviewer({
        identity: { role: "implementer" },
        input: { ticket: ticket("T-1"), implementation_result: "result", role: "senior-reviewer", project_root: "/proj", provider, timeout_ms: 1000 },
      }),
      "Implementer identity never invokes the Reviewer",
    );
    await assert.rejects(
      executeIndependentTechnicalLead({
        identity: { role: "senior-reviewer" },
        input: { evidence: [evidence("T-1", "technical_approval")], role: "technical-lead", project_root: "/proj", provider, timeout_ms: 1000 },
      }),
      "Reviewer identity never invokes the Lead",
    );
    assert.equal(calls.length, 0);
  });

  it("keeps the canonical identity immutable", async () => {
    const calls: CallRecord[] = [];
    const provider = countingProvider(calls, "done");
    const identity = { role: "implementer" };
    const outcome = await executeIndependentImplementer({
      identity,
      input: { ticket: ticket("T-1"), specialty: "backend", role: "implementer", project_root: "/proj", provider, timeout_ms: 1000 },
    });
    assert.deepEqual(identity, { role: "implementer" });
    assert.equal(outcome.execution.outcome, "completed");
  });
});

describe("independent handoff consumption", () => {
  it("accepts a valid handoff addressing the invoked role", async () => {
    const calls: CallRecord[] = [];
    const provider = countingProvider(calls, "done");
    const handoff = {
      from: "technical-lead",
      to: "implementer",
      objective: "implement the ticket",
      requirements: ["first requirement"],
    };
    const outcome = await executeIndependentImplementer({
      identity: { role: "implementer" },
      handoff,
      input: { ticket: ticket("T-1"), specialty: "backend", role: "implementer", project_root: "/proj", provider, timeout_ms: 1000 },
    });
    assert.equal(outcome.execution.outcome, "completed");
    assert.deepEqual(outcome.handoff, {
      from: "technical-lead",
      to: "implementer",
      objective: "implement the ticket",
      requirements: ["first requirement"],
    });
    assert.ok(Object.isFrozen(outcome) && Object.isFrozen(outcome.handoff));
    assert.deepEqual(handoff, {
      from: "technical-lead",
      to: "implementer",
      objective: "implement the ticket",
      requirements: ["first requirement"],
    }, "caller handoff never modified");
  });

  it("rejects invalid handoffs before any provider call", async () => {
    const calls: CallRecord[] = [];
    const provider = countingProvider(calls, "done");
    const input = { ticket: ticket("T-1"), specialty: "backend" as const, role: "implementer" as const, project_root: "/proj", provider, timeout_ms: 1000 };
    await assert.rejects(executeIndependentImplementer({ identity: { role: "implementer" }, handoff: { from: "technical-lead", to: "implementer" }, input }), "objective required");
    await assert.rejects(executeIndependentImplementer({ identity: { role: "implementer" }, handoff: { from: "pm", to: "implementer", objective: "work" }, input }), "sender validated");
    assert.equal(calls.length, 0);
  });

  it("rejects handoffs addressing a different role without retargeting", async () => {
    const calls: CallRecord[] = [];
    const provider = countingProvider(calls, "done");
    await assert.rejects(
      executeIndependentImplementer({
        identity: { role: "implementer" },
        handoff: { from: "coordinator", to: "technical-lead", objective: "lead work" },
        input: { ticket: ticket("T-1"), specialty: "backend", role: "implementer", project_root: "/proj", provider, timeout_ms: 1000 },
      }),
      "no silent handoff retargeting",
    );
    assert.equal(calls.length, 0);
  });

  it("reuses canonical direction rules with no retry-handoff coupling", async () => {
    const calls: CallRecord[] = [];
    const provider = countingProvider(calls, "done");
    await assert.rejects(
      executeIndependentImplementer({
        identity: { role: "implementer" },
        handoff: { from: "coordinator", to: "implementer", objective: "direct tasking" },
        input: { ticket: ticket("T-1"), specialty: "backend", role: "implementer", project_root: "/proj", provider, timeout_ms: 1000 },
      }),
      "structurally valid but canonically unapproved direction rejected",
    );
    const outcome = await executeIndependentSeniorReviewer({
      identity: { role: "senior-reviewer" },
      handoff: { from: "implementer", to: "senior-reviewer", objective: "review this" },
      input: { ticket: ticket("T-1"), implementation_result: "result", role: "senior-reviewer", project_root: "/proj", provider, timeout_ms: 1000 },
    });
    assert.equal(outcome.execution.outcome, "completed");
    assert.equal(calls.length, 1);
  });
});

describe("direct independent execution", () => {
  it("executes without a handoff where the seam input permits it", async () => {
    const calls: CallRecord[] = [];
    const provider = countingProvider(calls, "done");
    const outcome = await executeIndependentImplementer({
      identity: { role: "implementer" },
      input: { ticket: ticket("T-9"), specialty: "testing", role: "implementer", project_root: "/proj", provider, timeout_ms: 1000 },
    });
    assert.equal(outcome.execution.outcome, "completed");
    assert.ok(!("handoff" in outcome), "no handoff invented when none supplied");
  });

  it("performs exactly one provider call with no retry or fallback", async () => {
    const calls: CallRecord[] = [];
    const provider = countingProvider(calls, "done");
    await executeIndependentImplementer({
      identity: { role: "implementer" },
      input: { ticket: ticket("T-1"), specialty: "backend", role: "implementer", project_root: "/proj", provider, timeout_ms: 1000 },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].role, "implementer");
    assert.ok(calls[0].prompt.includes("(implementer)"), "canonical role prompt reused");
  });

  it("bounds provider failure to one failed outcome", async () => {
    const calls: CallRecord[] = [];
    const provider = countingProvider(calls, "ignored", true);
    const outcome = await executeIndependentImplementer({
      identity: { role: "implementer" },
      input: { ticket: ticket("T-1"), specialty: "backend", role: "implementer", project_root: "/proj", provider, timeout_ms: 1000 },
    });
    assert.equal(calls.length, 1, "no retry after failure");
    assert.equal(outcome.execution.outcome, "failed");
    assert.ok(outcome.execution.outcome === "failed" && outcome.execution.error.kind === "provider_error");
  });

  it("invokes no other role from an independent invocation", async () => {
    const calls: CallRecord[] = [];
    const provider = countingProvider(calls, "Clean.");
    const outcome = await executeIndependentSeniorReviewer({
      identity: { role: "senior-reviewer" },
      input: { ticket: ticket("T-1"), implementation_result: "result", role: "senior-reviewer", project_root: "/proj", provider, timeout_ms: 1000 },
    });
    assert.equal(calls.length, 1, "reviewer invocation never chains an implementer call");
    assert.ok(outcome.execution.outcome === "completed" && outcome.execution.report === "Clean.", "opaque report preserved verbatim");
    assert.equal(outcome.execution.outcome === "completed" && outcome.execution.next_state, null);
  });
});

describe("existing role semantics preserved", () => {
  it("preserves Implementer, TL, PM, and Coordinator outcome contracts", async () => {
    const calls: CallRecord[] = [];
    const provider = countingProvider(calls, "done");
    const implementer = await executeIndependentImplementer({
      identity: { role: "implementer" },
      input: { ticket: ticket("T-1"), specialty: "backend", role: "implementer", project_root: "/proj", provider, timeout_ms: 1000 },
    });
    assert.ok(implementer.execution.outcome === "completed" && implementer.execution.ticket_id === "T-1");
    assert.ok(implementer.execution.outcome === "completed" && implementer.execution.next_state === "implementation_review");

    const lead = await executeIndependentTechnicalLead({
      identity: { role: "technical-lead" },
      input: { evidence: [evidence("T-1", "technical_approval")], role: "technical-lead", project_root: "/proj", provider, timeout_ms: 1000 },
    });
    assert.ok(lead.execution.outcome === "completed" && lead.execution.report === "done");

    const manager = await executeIndependentProjectManager({
      identity: { role: "project-manager" },
      input: { evidence: [evidence("T-1", "technical_approval")], role: "project-manager", project_root: "/proj", provider, timeout_ms: 1000 },
    });
    assert.ok(manager.execution.outcome === "completed" && manager.execution.report === "done");
  });

  it("behaves deterministically for identical calls", async () => {
    const first: CallRecord[] = [];
    const second: CallRecord[] = [];
    const call = (calls: CallRecord[]) => ({
      identity: { role: "implementer" as const },
      input: { ticket: ticket("T-1"), specialty: "backend" as const, role: "implementer" as const, project_root: "/proj", provider: countingProvider(calls, "done"), timeout_ms: 1000 },
    });
    const one = await executeIndependentImplementer(call(first));
    const two = await executeIndependentImplementer(call(second));
    assert.deepEqual(one, two);
  });
});

describe("independent execution architecture", () => {
  it("touches no provider, delegate, config, CLI, planning, orchestration, or persistence concept", () => {
    assert.equal(ROLE_IDS.length, 5);
    const source = readFileSync(join(__dirname, "..", "..", "src", "roles", "independent-execution.ts"), "utf8");
    assert.ok(!/RoleManager|TeamManager|AgentManager|HandoffManager|RoleRegistry|IdentityResolver|AgentDiscovery/i.test(source), "no manager, registry, resolver, or discovery abstraction");
    assert.ok(!/manager/i.test(source.replace(/projects?[\s-]?manager/gi, "")), "the only manager word is the Project Manager role itself");
    assert.ok(!/Registry|Discovery|Finder|Chooser/.test(source));
    for (const token of [
      "runSprintWorkflow",
      "runProductionCoordinator",
      "delegate-skills",
      "DelegateProvider",
      "relay",
      "github",
      "GitHub",
      "opencode",
      "OpenCode",
      "spec-kit",
      "loadConfig",
      "readConfig",
      "process.env",
      "node:fs",
      "child_process",
      "setTimeout",
      "setInterval",
      "sprint",
      "reenter",
      "Router",
      "FAST",
    ]) {
      assert.ok(!source.includes(token), `independent execution never touches ${token}`);
    }
    assert.ok(!/from "\.\.\/(providers|config|cli)/.test(source));
    assert.ok(!/from "\.\.\/workflow\/retry-handoff"/.test(source), "no retry-handoff coupling");
  });
});
