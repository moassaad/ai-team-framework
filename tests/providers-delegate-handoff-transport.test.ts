import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDelegateSkillsHandoffTransport,
  renderHandoffBrief,
  DELEGATE_SKILLS_TRANSPORT_NAME,
} from "../src/providers/delegate-handoff-transport";
import { dispatchHandoff, isHandoffTransport } from "../src/runtime/handoff-dispatcher";
import { AgentHandoff } from "../src/roles/handoff";
import { renderAgentHandoff, validateAgentHandoff } from "../src/roles/handoff-validation";
import { DelegationRequest, DelegationResult } from "../src/providers/delegate";

// delegate-skills handoff adapter tests (M26 T-022): one
// adapter, one configured provider, one implementer-capable
// destination. Hermetic: the relay boundary is a fake
// DelegateProvider; no processes, no network, no skills
// installation, no filesystem discovery.

const ADAPTER_SOURCE = join(__dirname, "..", "..", "src", "providers", "delegate-handoff-transport.ts");
const DISPATCHER_SOURCE = join(__dirname, "..", "..", "src", "runtime", "handoff-dispatcher.ts");

function codeLines(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/**") && !trimmed.startsWith("*/");
    })
    .join("\n");
}

function implementerHandoff(): AgentHandoff {
  return validateAgentHandoff({
    from: "technical-lead",
    to: "implementer",
    objective: "Implement T-101: Render the reading-list page",
    context: "Server-rendered page over the existing article store.",
    requirements: ["Saved articles appear in reverse-chronological order"],
    acceptance_criteria: ["Saved articles render newest first."],
    constraints: ["Reuse the article store client."],
    artifacts: ["article-store.ts"],
    notes: "Behind the existing reader flag.",
    next_action: "Implement the ticket, then report what changed and which checks ran.",
  });
}

function fakeDelegate(
  requests: DelegationRequest[],
  outcome: unknown = { outcome: "relay outcome text" },
  rejectWith?: unknown,
): { provider: { name: string; delegate: (request: DelegationRequest) => Promise<DelegationResult> }; calls: () => number } {
  let calls = 0;
  return {
    provider: {
      name: "fake-relay",
      delegate: async (request: DelegationRequest) => {
        calls += 1;
        requests.push(request);
        if (rejectWith !== undefined) {
          throw rejectWith;
        }
        return outcome as DelegationResult;
      },
    },
    calls: () => calls,
  };
}

describe("delegate-skills handoff adapter (M26 T-022)", () => {
  describe("adapter contract", () => {
    it("satisfies the generic T-021 HandoffTransport shape", () => {
      const { provider } = fakeDelegate([]);
      const transport = createDelegateSkillsHandoffTransport({ provider });
      assert.ok(isHandoffTransport(transport));
      assert.equal(typeof transport.dispatch, "function");
    });

    it("exposes a stable transport name", () => {
      assert.equal(DELEGATE_SKILLS_TRANSPORT_NAME, "delegate-skills");
      const { provider } = fakeDelegate([]);
      assert.equal(createDelegateSkillsHandoffTransport({ provider }).name, "delegate-skills");
    });

    it("rejects a non-provider at construction", () => {
      assert.throws(() => createDelegateSkillsHandoffTransport({ provider: { name: "x" } }), /delegation provider contract/);
      assert.throws(() => createDelegateSkillsHandoffTransport({ provider: null }), /delegation provider contract/);
      assert.throws(() => createDelegateSkillsHandoffTransport(null as unknown as { provider: unknown }), /options object/);
    });

    it("rejects a malformed handoff before any relay contact", async () => {
      const requests: DelegationRequest[] = [];
      const { provider, calls } = fakeDelegate(requests);
      const transport = createDelegateSkillsHandoffTransport({ provider });
      await assert.rejects(transport.dispatch({ from: "technical-lead" } as unknown as AgentHandoff), /agent handoff/);
      assert.equal(calls(), 0);
    });

    it("preserves canonical direction validation", async () => {
      const requests: DelegationRequest[] = [];
      const { provider, calls } = fakeDelegate(requests);
      const transport = createDelegateSkillsHandoffTransport({ provider });
      await assert.rejects(
        transport.dispatch({ from: "implementer", to: "project-manager", objective: "Skip" } as unknown as AgentHandoff),
        /unsupported handoff direction/,
      );
      assert.equal(calls(), 0);
    });
  });

  describe("supported destination role", () => {
    it("dispatches handoffs targeting the implementer", async () => {
      const requests: DelegationRequest[] = [];
      const { provider, calls } = fakeDelegate(requests);
      const transport = createDelegateSkillsHandoffTransport({ provider });
      const receipt = await transport.dispatch(implementerHandoff());
      assert.deepEqual(receipt, { outcome: "relay outcome text" });
      assert.equal(calls(), 1);
    });

    it("rejects a senior-reviewer destination as unsupported", async () => {
      const requests: DelegationRequest[] = [];
      const { provider, calls } = fakeDelegate(requests);
      const transport = createDelegateSkillsHandoffTransport({ provider });
      const handoff = validateAgentHandoff({ from: "implementer", to: "senior-reviewer", objective: "Review T-1" });
      await assert.rejects(transport.dispatch(handoff), /implementation work only/);
      assert.equal(calls(), 0, "no relay attempt for an unsupported destination");
    });

    it("rejects a technical-lead destination as unsupported", async () => {
      const requests: DelegationRequest[] = [];
      const { provider, calls } = fakeDelegate(requests);
      const transport = createDelegateSkillsHandoffTransport({ provider });
      const handoff = validateAgentHandoff({ from: "project-manager", to: "technical-lead", objective: "Plan it" });
      await assert.rejects(transport.dispatch(handoff), /implementation work only/);
      assert.equal(calls(), 0);
    });

    it("carries a structured unsupported kind for the dispatcher", async () => {
      const requests: DelegationRequest[] = [];
      const { provider } = fakeDelegate(requests);
      const transport = createDelegateSkillsHandoffTransport({ provider });
      const handoff = validateAgentHandoff({ from: "coordinator", to: "project-manager", objective: "Plan it" });
      try {
        await transport.dispatch(handoff);
        assert.fail("expected unsupported rejection");
      } catch (error: unknown) {
        assert.equal((error as { kind?: string }).kind, "unsupported");
      }
    });

    it("unsupported flows through the generic dispatcher as failed with the kind preserved", async () => {
      const requests: DelegationRequest[] = [];
      const { provider, calls } = fakeDelegate(requests);
      const transport = createDelegateSkillsHandoffTransport({ provider });
      const handoff = validateAgentHandoff({ from: "implementer", to: "senior-reviewer", objective: "Review T-1" });
      const result = await dispatchHandoff({ handoff, transport });
      assert.equal(result.outcome, "failed");
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.error.kind, "unsupported");
      assert.equal(calls(), 0);
    });

    it("never retargets: the handoff destination is untouched", async () => {
      const requests: DelegationRequest[] = [];
      const { provider } = fakeDelegate(requests);
      const transport = createDelegateSkillsHandoffTransport({ provider });
      const handoff = implementerHandoff();
      await transport.dispatch(handoff);
      assert.equal(handoff.to, "implementer");
      assert.equal(handoff.from, "technical-lead");
    });
  });

  describe("brief generation", () => {
    it("renders the full handoff to an exact brief", () => {
      assert.equal(
        renderHandoffBrief(implementerHandoff()),
        [
          "Delegated handoff from technical-lead to implementer.",
          "",
          "Implement T-101: Render the reading-list page",
          "",
          "Requirements:",
          "Saved articles appear in reverse-chronological order",
          "",
          "Acceptance criteria:",
          "Saved articles render newest first.",
          "",
          "Constraints:",
          "Reuse the article store client.",
          "",
          "Artifacts:",
          "article-store.ts",
          "",
          "Notes:",
          "Behind the existing reader flag.",
          "",
          "Next action:",
          "Implement the ticket, then report what changed and which checks ran.",
        ].join("\n"),
      );
    });

    it("renders a minimal handoff with empty sections omitted", () => {
      const brief = renderHandoffBrief(validateAgentHandoff({ from: "technical-lead", to: "implementer", objective: "Do T-1" }));
      assert.equal(brief, "Delegated handoff from technical-lead to implementer.\n\nDo T-1");
      for (const absent of ["Requirements:", "Acceptance criteria:", "Constraints:", "Artifacts:", "Notes:", "Next action:"]) {
        assert.ok(!brief.includes(absent), `empty section ${absent} omitted`);
      }
    });

    it("maps context to the delegation context field verbatim", async () => {
      const requests: DelegationRequest[] = [];
      const { provider } = fakeDelegate(requests);
      await createDelegateSkillsHandoffTransport({ provider }).dispatch(implementerHandoff());
      assert.equal(requests[0].context, "Server-rendered page over the existing article store.");
    });

    it("omits the context field when the handoff carries none", async () => {
      const requests: DelegationRequest[] = [];
      const { provider } = fakeDelegate(requests);
      const handoff = validateAgentHandoff({ from: "technical-lead", to: "implementer", objective: "Do T-1" });
      await createDelegateSkillsHandoffTransport({ provider }).dispatch(handoff);
      assert.ok(!("context" in requests[0]));
    });

    it("preserves every canonical field in the brief text", async () => {
      const requests: DelegationRequest[] = [];
      const { provider } = fakeDelegate(requests);
      await createDelegateSkillsHandoffTransport({ provider }).dispatch(implementerHandoff());
      const task = requests[0].task;
      for (const expected of [
        "Implement T-101: Render the reading-list page",
        "Saved articles appear in reverse-chronological order",
        "Saved articles render newest first.",
        "Reuse the article store client.",
        "article-store.ts",
        "Behind the existing reader flag.",
        "Implement the ticket, then report what changed and which checks ran.",
        "Server-rendered page over the existing article store.",
      ]) {
        assert.ok((task.includes(expected) || requests[0].context === expected || task.includes("Requirements:")), `brief carries: ${expected}`);
      }
    });

    it("invents no fields beyond the handoff", async () => {
      const requests: DelegationRequest[] = [];
      const { provider } = fakeDelegate(requests);
      await createDelegateSkillsHandoffTransport({ provider }).dispatch(implementerHandoff());
      assert.ok(!requests[0].task.includes("model:") && !requests[0].task.includes("lane:"));
      assert.deepEqual(Object.keys(requests[0]).sort(), ["context", "task"]);
    });

    it("brief rendering is deterministic", () => {
      assert.equal(renderHandoffBrief(implementerHandoff()), renderHandoffBrief(implementerHandoff()));
    });

    it("uses no provider report content anywhere in the brief", async () => {
      const requests: DelegationRequest[] = [];
      const { provider } = fakeDelegate(requests, { outcome: "REPORT_SENTINEL_Z9" });
      const receipt = await createDelegateSkillsHandoffTransport({ provider }).dispatch(implementerHandoff());
      assert.ok(!requests[0].task.includes("REPORT_SENTINEL_Z9"));
      assert.deepEqual(receipt, { outcome: "REPORT_SENTINEL_Z9" }, "report rides the receipt opaquely");
    });
  });

  describe("relay invocation boundary", () => {
    it("delegates exactly once with a validated request", async () => {
      const requests: DelegationRequest[] = [];
      const { provider, calls } = fakeDelegate(requests);
      await createDelegateSkillsHandoffTransport({ provider }).dispatch(implementerHandoff());
      assert.equal(calls(), 1);
      assert.equal(requests.length, 1);
      assert.ok(requests[0].task.length > 0);
    });

    it("passes the project root through the configured provider, not the handoff", async () => {
      const seenRoot: Array<string | undefined> = [];
      const provider = {
        name: "root-checking-relay",
        projectRoot: "/proj/from-configuration",
        delegate: async (request: DelegationRequest) => {
          seenRoot.push(provider.projectRoot);
          assert.ok(!request.task.includes("/proj"), "handoff text never selects cwd");
          return { outcome: "ok" };
        },
      };
      const handoff = validateAgentHandoff({ from: "technical-lead", to: "implementer", objective: "Do T-1" });
      await createDelegateSkillsHandoffTransport({ provider }).dispatch(handoff);
      assert.deepEqual(seenRoot, ["/proj/from-configuration"]);
    });

    it("propagates relay rejection without retry", async () => {
      const requests: DelegationRequest[] = [];
      const { provider, calls } = fakeDelegate(requests, undefined, new Error("relay down"));
      await assert.rejects(createDelegateSkillsHandoffTransport({ provider }).dispatch(implementerHandoff()), /relay down/);
      assert.equal(calls(), 1);
    });

    it("rejects a malformed relay outcome instead of forwarding garbage", async () => {
      const requests: DelegationRequest[] = [];
      const { provider, calls } = fakeDelegate(requests, { nope: true });
      await assert.rejects(createDelegateSkillsHandoffTransport({ provider }).dispatch(implementerHandoff()), /outcome/);
      assert.equal(calls(), 1);
    });

    it("accepts a valid structured relay outcome as the opaque receipt", async () => {
      const requests: DelegationRequest[] = [];
      const { provider } = fakeDelegate(requests, { outcome: "implemented; checks green" });
      const receipt = await createDelegateSkillsHandoffTransport({ provider }).dispatch(implementerHandoff());
      assert.deepEqual(receipt, { outcome: "implemented; checks green" });
    });

    it("performs no shell, process, or filesystem calls of its own", () => {
      const code = codeLines(ADAPTER_SOURCE);
      for (const forbidden of ["node:fs", "node:child_process", "spawn", "execFile", "execSync", "shell", "writeFile", "mkdtemp", "readFile"]) {
        assert.ok(!code.includes(forbidden), `adapter code never mentions ${forbidden}`);
      }
    });
  });

  describe("end to end through the generic dispatcher", () => {
    it("dispatches an implementer handoff through dispatcher plus adapter", async () => {
      const requests: DelegationRequest[] = [];
      const { provider, calls } = fakeDelegate(requests, { outcome: "done by relay" });
      const transport = createDelegateSkillsHandoffTransport({ provider });
      const result = await dispatchHandoff({ handoff: implementerHandoff(), transport });
      assert.equal(result.outcome, "dispatched");
      if (result.outcome !== "dispatched") throw new Error("unreachable");
      assert.equal(result.transport, "delegate-skills");
      assert.equal(result.destination, "implementer");
      assert.deepEqual(result.receipt, { outcome: "done by relay" });
      assert.equal(calls(), 1);
    });

    it("relay failure through the stack yields failed with one attempt", async () => {
      const requests: DelegationRequest[] = [];
      const { provider, calls } = fakeDelegate(requests, undefined, new Error("relay exit 1"));
      const result = await dispatchHandoff({
        handoff: implementerHandoff(),
        transport: createDelegateSkillsHandoffTransport({ provider }),
      });
      assert.equal(result.outcome, "failed");
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.equal(result.error.message, "relay exit 1");
      assert.equal(calls(), 1);
    });

    it("the dispatcher learns nothing delegate-specific", async () => {
      const requests: DelegationRequest[] = [];
      const { provider } = fakeDelegate(requests);
      const result = await dispatchHandoff({
        handoff: implementerHandoff(),
        transport: createDelegateSkillsHandoffTransport({ provider }),
      });
      assert.equal(result.outcome, "dispatched");
      if (result.outcome !== "dispatched") throw new Error("unreachable");
      assert.deepEqual(Object.keys(result).sort(), ["destination", "handoff", "outcome", "receipt", "transport"]);
    });
  });

  describe("temporary brief and project hygiene", () => {
    it("adapter dispatch creates no files in the project tree", async () => {
      const root = mkdtempSync(join(tmpdir(), "t022-"));
      const before = readdirSync(root);
      const requests: DelegationRequest[] = [];
      const { provider } = fakeDelegate(requests);
      await createDelegateSkillsHandoffTransport({ provider }).dispatch(implementerHandoff());
      assert.deepEqual(readdirSync(root), before);
    });

    it("adapter owns no temp lifecycle: brief files belong to the relay provider", () => {
      const code = codeLines(ADAPTER_SOURCE);
      assert.ok(!code.includes("tmpdir") && !code.includes(".ai-team"), "no temp or state paths in adapter code");
      assert.ok(!code.includes("briefPath") && !code.includes("outDir"), "no brief-file handling in adapter code");
    });

    it("adapter options surface is exactly one configured provider", () => {
      const code = codeLines(ADAPTER_SOURCE);
      assert.ok(code.includes("readonly provider: unknown;"));
      assert.ok(!code.includes("skillRoot") && !code.includes("skillName"), "no relay discovery fields");
      assert.ok(!/readonly model[?:]/.test(code), "no model configuration field");
    });
  });

  describe("error handling without fallback", () => {
    it("missing relay entrypoint surfaces as dispatch failure", async () => {
      const requests: DelegationRequest[] = [];
      const { provider } = fakeDelegate(requests, undefined, new Error("relay not available at /skills/x/scripts/relay.mjs"));
      const result = await dispatchHandoff({
        handoff: implementerHandoff(),
        transport: createDelegateSkillsHandoffTransport({ provider }),
      });
      assert.equal(result.outcome, "failed");
      if (result.outcome !== "failed") throw new Error("unreachable");
      assert.ok(result.error.message.includes("relay not available"));
    });

    it("non-zero relay outcomes still resolve through the provider contract", async () => {
      const requests: DelegationRequest[] = [];
      const { provider, calls } = fakeDelegate(requests, undefined, new Error("result.json malformed (relay exit 1)"));
      const result = await dispatchHandoff({
        handoff: implementerHandoff(),
        transport: createDelegateSkillsHandoffTransport({ provider }),
      });
      assert.equal(result.outcome, "failed");
      assert.equal(calls(), 1, "no retry on relay failure");
    });

    it("authentication failure is a transport failure, not a workflow decision", async () => {
      const requests: DelegationRequest[] = [];
      const { provider } = fakeDelegate(requests, undefined, new Error("relay authentication failed"));
      const result = await dispatchHandoff({
        handoff: implementerHandoff(),
        transport: createDelegateSkillsHandoffTransport({ provider }),
      });
      assert.equal(result.outcome, "failed");
      assert.deepEqual(Object.keys(result).sort(), ["destination", "error", "handoff", "outcome", "transport"]);
    });

    it("invalid provider configuration fails at construction", () => {
      assert.throws(() => createDelegateSkillsHandoffTransport({ provider: { name: "", delegate: async () => ({}) } }), /delegation provider contract/);
    });

    it("failed dispatch never invokes a local executor", async () => {
      const code = codeLines(ADAPTER_SOURCE);
      for (const forbidden of ["executeIndependent", "independent-execution", "executeImplementerTicket", "executeReviewerTicket"]) {
        assert.ok(!code.includes(forbidden), `adapter code never mentions ${forbidden}`);
      }
      const requests: DelegationRequest[] = [];
      const { provider, calls } = fakeDelegate(requests, undefined, new Error("down"));
      const result = await dispatchHandoff({
        handoff: implementerHandoff(),
        transport: createDelegateSkillsHandoffTransport({ provider }),
      });
      assert.equal(result.outcome, "failed");
      assert.equal(calls(), 1);
    });
  });

  describe("immutability", () => {
    it("input handoff and nested lists survive dispatch byte-identical", async () => {
      const requests: DelegationRequest[] = [];
      const { provider } = fakeDelegate(requests);
      const handoff = implementerHandoff();
      const before = JSON.stringify(handoff);
      await createDelegateSkillsHandoffTransport({ provider }).dispatch(handoff);
      assert.equal(JSON.stringify(handoff), before);
    });

    it("input handoff survives even a failing dispatch", async () => {
      const requests: DelegationRequest[] = [];
      const { provider } = fakeDelegate(requests, undefined, new Error("down"));
      const handoff = implementerHandoff();
      const before = JSON.stringify(handoff);
      await assert.rejects(createDelegateSkillsHandoffTransport({ provider }).dispatch(handoff), /down/);
      assert.equal(JSON.stringify(handoff), before);
    });

    it("adapter results are frozen", async () => {
      const requests: DelegationRequest[] = [];
      const { provider } = fakeDelegate(requests);
      const receipt = await createDelegateSkillsHandoffTransport({ provider }).dispatch(implementerHandoff());
      assert.ok(Object.isFrozen(receipt));
    });
  });

  describe("core isolation", () => {
    it("the T-021 dispatcher takes no delegation dependency", () => {
      const code = codeLines(DISPATCHER_SOURCE);
      for (const forbidden of ["delegate-skills", "DelegateProvider", "providers/delegate", "HandoffTransport\" from"]) {
        assert.ok(!code.includes(forbidden), `dispatcher code never mentions ${forbidden}`);
      }
      assert.ok(!/^import .*delegate/m.test(code), "dispatcher imports no delegation module");
    });

    it("the adapter imports the dispatcher only for its transport type", () => {
      const imports = readFileSync(ADAPTER_SOURCE, "utf8")
        .split("\n")
        .filter((line) => line.trim().startsWith("import "));
      assert.deepEqual(imports, [
        'import { AgentHandoff } from "../roles/handoff";',
        'import { validateAgentHandoff } from "../roles/handoff-validation";',
        'import { HandoffTransport } from "../runtime/handoff-dispatcher";',
        "import {",
      ]);
      assert.ok(readFileSync(ADAPTER_SOURCE, "utf8").includes("DelegateProvider,"));
    });

    it("delegation specifics live only in the adapter boundary", () => {
      const dispatcherCode = codeLines(DISPATCHER_SOURCE);
      assert.ok(!dispatcherCode.includes("brief") && !dispatcherCode.includes("implementer"), "dispatcher knows no roles or briefs");
    });
  });

  describe("no setup, detection, persistence, or orchestration", () => {
    it("no installation, setup, discovery, or fleet logic exists in the adapter", () => {
      const code = codeLines(ADAPTER_SOURCE);
      for (const forbidden of ["delegate-setup", "skills add", "npx", "install", "fleet", "lane", "discover", "detect", "isDelegateAvailable", "SKILL.md", "skillRoot", "readdir", "glob"]) {
        assert.ok(!code.includes(forbidden), `adapter code never mentions ${forbidden}`);
      }
    });

    it("no capability-detection surface is defined", () => {
      const source = readFileSync(ADAPTER_SOURCE, "utf8");
      assert.ok(!/export (function|const|interface|type) \w*(Availab|Detect|Discover|Fleet|Capabilit)\w*/.test(source));
    });

    it("no persistence, GitHub, or network behavior exists in the adapter", () => {
      const code = codeLines(ADAPTER_SOURCE);
      for (const forbidden of [".ai-team", "persist", "IssueProvider", "TicketSink", "TicketSource", "github", "fetch(", "http"]) {
        assert.ok(!code.includes(forbidden), `adapter code never mentions ${forbidden}`);
      }
    });

    it("no orchestration, modes, retry, fallback, or re-entry exists in the adapter", () => {
      const code = codeLines(ADAPTER_SOURCE);
      for (const forbidden of ["orchestrat", "FAST", "STANDARD", "FULL", "retry", "fallback", "reentry", "re-enter", "next_role", "next-role", "changes-required"]) {
        assert.ok(!code.includes(forbidden), `adapter code never mentions ${forbidden}`);
      }
    });

    it("the only role literal is the implementer gate", () => {
      const code = codeLines(ADAPTER_SOURCE);
      assert.ok(code.includes('"implementer"'));
      for (const role of ["coordinator", "project-manager", "technical-lead", "senior-reviewer"]) {
        assert.ok(!code.includes(`"${role}"`), `adapter never names ${role}`);
      }
    });
  });

  describe("manual transport compatibility", () => {
    it("the same handoff renders identically before and after adapter dispatch", async () => {
      const requests: DelegationRequest[] = [];
      const { provider } = fakeDelegate(requests);
      const handoff = implementerHandoff();
      const before = renderAgentHandoff(handoff);
      await createDelegateSkillsHandoffTransport({ provider }).dispatch(handoff);
      assert.equal(renderAgentHandoff(handoff), before);
    });

    it("adapter brief and manual rendering carry the same objective and requirements", async () => {
      const requests: DelegationRequest[] = [];
      const { provider } = fakeDelegate(requests);
      const handoff = implementerHandoff();
      await createDelegateSkillsHandoffTransport({ provider }).dispatch(handoff);
      assert.ok(requests[0].task.includes(handoff.objective));
      for (const requirement of handoff.requirements ?? []) {
        assert.ok(requests[0].task.includes(requirement));
      }
      assert.ok(renderAgentHandoff(handoff).includes(handoff.objective));
    });
  });
});
