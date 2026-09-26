import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDelegateProvider } from "../src/providers/delegate";
import {
  createDelegateRelayProvider,
} from "../src/providers/delegate-relay";

// Relay delegation tests (D-104): injected fakes only. No real skill,
// relay, implementer, filesystem, or network ever runs. The fake relay
// simulates upstream behavior: it plants `<out-dir>/result.json` with
// `delegate-relay.result.v1` shape, exactly as the real helper would.

interface RecordedCall {
  command: string;
  args: readonly string[];
  cwd: string;
  timeoutMs?: number;
}

const SKILL = "opencode-delegate";
const SKILL_ROOT = "/skills/opencode-delegate";
const PROJECT = "/proj/shop";
const RELAY = join(SKILL_ROOT, "scripts", "relay.mjs");

const COMPLETED = {
  schema: "delegate-relay.result.v1",
  status: "completed",
  exitCode: 0,
  finalMessage: "Export endpoint implemented; gates pass.",
};

function failedResult() {
  return {
    schema: "delegate-relay.result.v1",
    status: "failed",
    exitCode: 1,
    finalMessage: "",
  };
}

function baseHarness(options: {
  relay?: (outDir: string, written: Map<string, string>) => { exitCode: number | null; stdout: string };
  relayMissing?: boolean;
  model?: string;
  requireModel?: boolean;
  timeoutMs?: number;
}): {
  calls: RecordedCall[];
  writes: Array<{ path: string; content: string }>;
  removals: string[];
  runs: () => number;
  provider: ReturnType<typeof createDelegateRelayProvider>;
  written: Map<string, string>;
} {
  const calls: RecordedCall[] = [];
  const writes: Array<{ path: string; content: string }> = [];
  const removals: string[] = [];
  let relayRuns = 0;
  const written = new Map<string, string>();
  if (options.relayMissing !== true) {
    written.set(RELAY, "// bundled relay (fixture presence only; never executed)");
  }
  const provider = createDelegateRelayProvider({
    skillName: SKILL,
    skillRoot: SKILL_ROOT,
    projectRoot: PROJECT,
    model: options.model,
    requireModel: options.requireModel,
    timeoutMs: options.timeoutMs,
    runCommand: async (command, args, runOptions) => {
      calls.push({
        command,
        args: [...args],
        cwd: runOptions.cwd,
        timeoutMs: runOptions.timeoutMs,
      });
      assert.equal(command, "node");
      relayRuns += 1;
      const outDir = args[args.indexOf("--out-dir") + 1] as string;
      if (options.relay !== undefined) {
        return options.relay(outDir, written);
      }
      written.set(join(outDir, "result.json"), JSON.stringify(COMPLETED));
      return { exitCode: 0, stdout: "relay summary" };
    },
    files: {
      writeFile: async (path: string, content: string): Promise<void> => {
        writes.push({ path, content });
        written.set(path, content);
      },
      readFile: async (path: string): Promise<string> => {
        if (path === RELAY && options.relayMissing === true) {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }
        const content = written.get(path);
        if (content === undefined) {
          throw Object.assign(new Error(`missing ${path}`), { code: "ENOENT" });
        }
        return content;
      },
      makeTempDir: async (prefix: string): Promise<string> => `/tmp/${prefix}fake-1`,
      removeDir: async (path: string): Promise<void> => {
        removals.push(path);
      },
    },
  });
  assert.equal(calls.length, 0, "construction performs no calls");
  return { calls, writes, removals, runs: () => relayRuns, provider, written };
}

const TASK = "Implement the export endpoint.";
const CONTEXT = "Repo uses streaming CSV.";

function expectedBrief(): string {
  return [
    "# Delegated Task (via opencode-delegate)",
    "",
    "## Task",
    TASK,
    "",
    "## Current context",
    CONTEXT,
    "",
    "## Scope",
    "Implement exactly what the task requests. Do not expand scope.",
    "",
    "## Constraints",
    "- Do not commit changes.",
    "- Do not push, merge, or create branches.",
    "",
    "## Expected report",
    "End with a concise final summary of what changed and which checks were run.",
    "",
  ].join("\n");
}

describe("relay delegation provider", () => {
  it("satisfies the generic DelegateProvider contract", () => {
    const { provider } = baseHarness({});
    assert.equal(isDelegateProvider(provider), true);
    assert.equal(provider.name, SKILL);
  });

  it("builds a self-contained brief from task and context", async () => {
    const { provider, written } = baseHarness({ model: "prov/model" });
    await provider.delegate({ task: TASK, context: CONTEXT });
    assert.equal(written.get("/tmp/ai-team-delegate-fake-1/brief.txt"), expectedBrief());
  });

  it("brief forbids committing without secrets or env dumps", async () => {
    const { provider, written } = baseHarness({ model: "prov/model" });
    await provider.delegate({ task: TASK });
    const brief = written.get("/tmp/ai-team-delegate-fake-1/brief.txt") as string;
    assert.ok(/do not commit/i.test(brief));
    assert.ok(brief.includes("## Current context\nNot provided."));
    assert.ok(!/password|api[_-]?key|token|secret/i.test(brief));
  });

  it("invokes the exact relay path with pinned cwd", async () => {
    const { calls, provider } = baseHarness({ model: "prov/model" });
    await provider.delegate({ task: TASK, context: CONTEXT });
    assert.equal(calls.length, 1, "one dispatch per request");
    assert.deepEqual(calls[0], {
      command: "node",
      args: [
        RELAY,
        "--brief",
        "/tmp/ai-team-delegate-fake-1/brief.txt",
        "--model",
        "prov/model",
        "--cd",
        PROJECT,
        "--out-dir",
        "/tmp/ai-team-delegate-fake-1",
      ],
      cwd: PROJECT,
      timeoutMs: 1800000,
    });
  });

  it("passes the model only when explicitly supplied", async () => {
    const { calls, provider } = baseHarness({});
    await provider.delegate({ task: TASK });
    assert.ok(!calls[0]?.args.includes("--model"), "no invented model");
    assert.ok(!calls[0]?.args.includes("--lane"), "no lane");
    assert.ok(!calls[0]?.args.includes("--session"), "no session");
    assert.ok(!calls[0]?.args.includes("--resume-last"), "no resume");
    assert.ok(!calls[0]?.args.includes("--read-only"), "no read-only mode");
  });

  it("fails before launch when the skill requires a missing model", async () => {
    const { calls, provider } = baseHarness({ requireModel: true });
    await assert.rejects(
      provider.delegate({ task: TASK }),
      /model is required by skill "opencode-delegate"; supply model explicitly/,
    );
    assert.equal(calls.length, 0, "relay never launched");
  });

  it("returns the relay finalMessage as the outcome on success", async () => {
    const { provider, removals } = baseHarness({ model: "prov/model" });
    const result = await provider.delegate({ task: TASK, context: CONTEXT });
    assert.deepEqual(Object.keys(result).sort(), ["outcome"]);
    assert.equal(result.outcome, "Export endpoint implemented; gates pass.");
    assert.deepEqual(removals, ["/tmp/ai-team-delegate-fake-1"], "temp cleaned on success");
  });

  it("fails failed relay statuses without fabricating success", async () => {
    for (const status of ["failed", "timeout", "aborted", "opencode_unavailable"]) {
      const { provider, removals } = baseHarness({
        model: "prov/model",
        relay: (outDir, written) => {
          written.set(join(outDir, "result.json"), JSON.stringify({ ...COMPLETED, status }));
          return { exitCode: 1, stdout: "relay summary" };
        },
      });
      await assert.rejects(
        provider.delegate({ task: TASK }),
        new RegExp(`relay reported "${status}" \\(exit 1\\)`),
      );
      assert.deepEqual(removals, ["/tmp/ai-team-delegate-fake-1"], `cleaned on ${status}`);
    }
  });

  it("surfaces non-zero relay exits", async () => {
    const { provider } = baseHarness({
      relay: () => ({ exitCode: 2, stdout: "usage error" }),
    });
    await assert.rejects(provider.delegate({ task: TASK }), /relay exit 2/);
  });

  it("surfaces missing relay executables and launch failures", async () => {
    const missing = baseHarness({ relayMissing: true });
    await assert.rejects(
      missing.provider.delegate({ task: TASK }),
      new RegExp(`relay not available at .*relay\\.mjs`),
    );
    assert.equal(missing.calls.length, 0, "nothing launched without a relay");
  });

  it("surfaces timeouts as failure", async () => {
    const { provider } = baseHarness({
      timeoutMs: 1000,
      relay: () => ({ exitCode: null, stdout: "" }),
    });
    await assert.rejects(provider.delegate({ task: TASK }), /timeout 1000ms bound/);
  });

  it("handles missing or malformed result.json safely", async () => {
    const missing = baseHarness({
      relay: () => ({ exitCode: 0, stdout: "no file written" }),
    });
    await assert.rejects(missing.provider.delegate({ task: TASK }), /result\.json unavailable/);
    const malformed = baseHarness({
      relay: (outDir, written) => {
        written.set(join(outDir, "result.json"), "{oops");
        return { exitCode: 0, stdout: "relay summary" };
      },
    });
    await assert.rejects(malformed.provider.delegate({ task: TASK }), /result\.json malformed/);
    const wrongSchema = baseHarness({
      relay: (outDir, written) => {
        written.set(
          join(outDir, "result.json"),
          JSON.stringify({ schema: "other.v9", status: "completed", finalMessage: "x" }),
        );
        return { exitCode: 0, stdout: "relay summary" };
      },
    });
    await assert.rejects(wrongSchema.provider.delegate({ task: TASK }), /unsupported result schema/);
  });

  it("bounds completed runs without a final report", async () => {
    const { provider } = baseHarness({
      relay: (outDir, written) => {
        written.set(
          join(outDir, "result.json"),
          JSON.stringify({ schema: "delegate-relay.result.v1", status: "completed", exitCode: 0 }),
        );
        return { exitCode: 0, stdout: "relay summary" };
      },
    });
    const result = await provider.delegate({ task: TASK });
    assert.equal(result.outcome, "completed with no final report (exit 0)");
  });

  it("never retries, falls back, commits, or authenticates", async () => {
    const { calls, provider } = baseHarness({
      relay: (outDir, written) => {
        written.set(join(outDir, "result.json"), JSON.stringify(failedResult()));
        return { exitCode: 1, stdout: "failed" };
      },
    });
    const before = calls.length;
    await assert.rejects(provider.delegate({ task: TASK }), /relay reported "failed"/);
    assert.equal(calls.length, before + 1, "exactly one attempt");
    for (const call of calls) {
      assert.ok(!call.args.includes("commit"), "no commit");
      assert.ok(!call.args.includes("login"), "no login");
    }
  });

  it("rejects invalid requests before touching anything", async () => {
    const { calls, provider } = baseHarness({ model: "prov/model" });
    await assert.rejects(
      provider.delegate({ task: "", project_root: undefined as never } as never),
      /invalid input/,
    );
    assert.equal(calls.length, 0);
  });

  it("writes only inside its isolated temp dir", async () => {
    const { writes, provider } = baseHarness({ model: "prov/model" });
    await provider.delegate({ task: TASK, context: CONTEXT });
    assert.ok(writes.length >= 1);
    for (const write of writes) {
      assert.ok(
        write.path.startsWith("/tmp/ai-team-delegate-fake-1/"),
        `isolated write ${write.path}`,
      );
      assert.ok(!write.path.startsWith(PROJECT), "never the target project");
    }
  });

  it("dispatches one bounded task per call with fresh isolation", async () => {
    const { calls, provider, runs } = baseHarness({ model: "prov/model" });
    await provider.delegate({ task: "Task one." });
    await provider.delegate({ task: "Task two." });
    assert.equal(runs(), 2);
    assert.equal(calls.length, 2);
  });

  it("stays independent from foundation, config, and sibling providers", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "providers", "delegate-relay.ts"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const importedModules = [...new Set([...code.matchAll(/from "([^"]+)"/g)].map((match) => match[1]))];
    assert.deepEqual(
      importedModules.sort(),
      ["./delegate", "./delegate-detection", "./delegate-result", "node:fs", "node:os", "node:path"],
      "seam-only imports",
    );
    assert.ok(!/shell\s*:/.test(code), "no shell option");
    assert.ok(!/from "\.\/(opencode|config|workflow|roles|integration)"/.test(code));
    assert.ok(!/delegate-setup|fleet|lane|session|resume/.test(code), "no later-ticket machinery");
    assert.ok(!/git (commit|push|merge)|\.commit\(|\.push\(/.test(code), "no commit machinery");
    assert.ok(!/spawn\(|execFile/.test(code), "no ad-hoc processes");
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/providers/delegate-relay");
    assert.deepEqual(Object.keys(module).sort(), [
      "createDelegateRelayProvider",
      "defaultDelegateRelayFileSystem",
    ]);
  });
});
