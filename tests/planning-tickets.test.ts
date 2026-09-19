import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { generateTicketsFromPlan, validatePlan } from "../src/planning/tickets";

// Ticket-generation tests: public behavior only, no providers involved.
describe("plan to ticket generation", () => {
  const plan = {
    requirements: "Build a shop.",
    basis: "specification" as const,
    specification: "# Catalog\n\nList products.\n\n# Checkout\n\nTake payment.\n",
  };

  it("decomposes a plan into ordered ticket structures", () => {
    const tickets = generateTicketsFromPlan(plan);
    assert.equal(tickets.length, 2);
    assert.deepEqual(tickets[0], {
      id: "T-001",
      title: "Catalog",
      description: "# Catalog\n\nList products.\n",
      requirements: "Build a shop.",
    });
    assert.deepEqual(tickets[1]?.id, "T-002");
    assert.deepEqual(tickets[1]?.title, "Checkout");
    assert.ok(Object.isFrozen(tickets));
    assert.ok(tickets.every((ticket) => Object.isFrozen(ticket)));
  });

  it("treats leading unheaded content as an overview ticket", () => {
    const tickets = generateTicketsFromPlan({
      requirements: "Build.",
      basis: "plan" as const,
      specification: "Context line.\n\n# First\n\nBody.\n",
    });
    assert.equal(tickets.length, 2);
    assert.equal(tickets[0]?.id, "T-001");
    assert.equal(tickets[0]?.title, "Overview");
    assert.ok((tickets[0]?.description ?? "").includes("Context line."));
    assert.equal(tickets[1]?.title, "First");
  });

  it("yields zero tickets for content-free specifications", () => {
    assert.deepEqual(generateTicketsFromPlan({
      requirements: "Build.",
      basis: "plan" as const,
      specification: "\n   \n",
    }), []);
  });

  it("is deterministic with stable ids and ordering", () => {
    const input = {
      requirements: "Build a shop.",
      basis: "specification" as const,
      specification: "# B\n\nTwo.\n\n# A\n\nOne.\n\n# B\n\nAgain.\n",
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    const first = generateTicketsFromPlan(input);
    assert.deepEqual(generateTicketsFromPlan(input), first);
    assert.deepEqual(input, snapshot);
    assert.deepEqual(first.map((ticket) => ticket.id), ["T-001", "T-002", "T-003"]);
    assert.deepEqual(first.map((ticket) => ticket.title), ["B", "A", "B"]);
  });

  it("preserves requirements and specification context verbatim", () => {
    const requirements = 'Build a "quoted" $shop.';
    const tickets = generateTicketsFromPlan({
      requirements,
      basis: "specification" as const,
      specification: "# Only\n\nBody with $pecial \"chars\".\n",
    });
    assert.equal(tickets.length, 1);
    assert.equal(tickets[0]?.requirements, requirements);
    assert.ok((tickets[0]?.description ?? "").includes('$pecial "chars".'));
  });

  it("rejects invalid plans and validates nested shape", () => {
    for (const data of [
      null,
      "x",
      [],
      {},
      { requirements: "", basis: "plan", specification: "# P\n" },
      { basis: "plan", specification: "# P\n" },
      { requirements: "Build.", basis: "tasks", specification: "# P\n" },
      { requirements: "Build.", basis: "plan" },
      { requirements: "Build.", basis: "plan", specification: "" },
    ] as unknown[]) {
      assert.throws(
        () => generateTicketsFromPlan(data as Parameters<typeof generateTicketsFromPlan>[0]),
        /ticket generation: invalid input/,
      );
    }
    assert.deepEqual(Object.keys(validatePlan(plan)).sort(), ["basis", "requirements", "specification"]);
  });

  it("invents no tracker, workflow, or dependency fields", () => {
    const tickets = generateTicketsFromPlan(plan);
    for (const ticket of tickets) {
      assert.deepEqual(Object.keys(ticket).sort(), ["description", "id", "requirements", "title"]);
    }
  });

  it("keeps the public API minimal", async () => {
    const module = await import("../src/planning/tickets");
    assert.deepEqual(Object.keys(module).sort(), ["generateTicketsFromPlan", "validatePlan"]);
  });

  it("touches no providers, execution, workflow, or external systems", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(join(__dirname, "..", "..", "src", "planning", "tickets.ts"), "utf8");
    assert.ok(!/speckit|AgentProvider|opencode/i.test(code), "no provider coupling");
    assert.ok(!/child_process|execSync|spawn|fetch\(|http|node:/i.test(code), "no execution");
    assert.ok(!/workflow|approval|cli|github|issue/i.test(code), "no surrounding systems");
    assert.ok(!/setTimeout|timeout|retry/i.test(code), "no execution policy");
  });
});