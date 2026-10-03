import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_IDS } from "../src/roles/contract";
import { isTicket } from "../src/runtime/coordinator";
import { validateIssueRequest } from "../src/providers/issue";
import { mapTaskToIssueRequest, mapTaskToTicket } from "../src/runtime/plan-ticket-mapper";

// Plan-to-ticket mapper tests (M24 T-014): Task in, existing
// ticket representations out. Pure and synchronous: no
// providers, no transport, no persistence.
const taskFixture = {
  id: "T-001",
  title: "Add sign-in form",
  description: "Render the sign-in form on the login page.",
  requirements: "Users can sign in",
  acceptance_criteria: ["Invalid credentials are rejected.", "Valid credentials sign in."],
  dependencies: ["T-000"],
  specialty: "frontend" as const,
  sprint: "sprint-1",
};

describe("canonical destinations", () => {
  it("returns exactly the existing ticket types with no duplicate interface", () => {
    const ticket = mapTaskToTicket({ ...taskFixture });
    assert.ok(isTicket(ticket), "output satisfies the CoordinatorTicket contract");
    const request = mapTaskToIssueRequest({ ...taskFixture });
    assert.deepEqual(validateIssueRequest(request), request, "output satisfies the IssueRequest contract");
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "plan-ticket-mapper.ts"), "utf8");
    assert.ok(!/interface \w*Ticket|type \w*Ticket/.test(source), "no competing ticket interface created");
  });
});

describe("task to ticket mapping", () => {
  it("maps identity, title, description, and requirements", () => {
    const ticket = mapTaskToTicket({ ...taskFixture });
    assert.equal(ticket.id, "T-001", "task identity preserved, never regenerated");
    assert.equal(ticket.title, "Add sign-in form");
    assert.ok(ticket.description.startsWith("Render the sign-in form on the login page."), "description base verbatim");
    assert.equal(ticket.requirements, "Users can sign in");
    assert.equal(ticket.state, "ready", "new tickets enter the workflow as ready; no transition performed");
  });

  it("carries acceptance criteria as a labeled description section", () => {
    const ticket = mapTaskToTicket({ ...taskFixture });
    assert.ok(
      ticket.description.includes("\n\nAcceptance criteria:\nInvalid credentials are rejected.\nValid credentials sign in."),
      "labeled append per repository convention, order preserved",
    );
    const plain = mapTaskToTicket({
      id: "T-002",
      title: "Plain task",
      description: "Do the thing.",
      requirements: "Thing required",
    });
    assert.equal(plain.description, "Do the thing.", "no section invented when criteria absent");
    const empty: Record<string, unknown> = {
      id: "T-003",
      title: "Empty criteria",
      description: "Do the other thing.",
      requirements: "Other required",
      acceptance_criteria: [],
    };
    assert.equal(mapTaskToTicket(empty).description, "Do the other thing.", "empty criteria add nothing");
  });

  it("maps the issue payload with the same field semantics and no identifier", () => {
    const request = mapTaskToIssueRequest({ ...taskFixture });
    assert.equal(request.title, "Add sign-in form");
    assert.ok(request.description.startsWith("Render the sign-in form on the login page."));
    assert.ok(request.description.includes("\n\nAcceptance criteria:\nInvalid credentials are rejected.\nValid credentials sign in."));
    assert.equal(request.requirements, "Users can sign in", "planning-layer requirements context carried opaquely");
    assert.ok(!("id" in request), "issue identity stays provider-assigned; never a task or GitHub id");
    assert.ok(Object.isFrozen(request), "frozen through the canonical constructor");
  });

  it("represents unmapped fields by explicit rule, never silently", () => {
    const ticket = mapTaskToTicket({ ...taskFixture });
    assert.deepEqual(Object.keys(ticket).sort(), ["description", "id", "requirements", "state", "title"]);
    assert.ok(!("dependencies" in ticket || "specialty" in ticket || "sprint" in ticket), "decomposition, runtime-resolution, and grouping layers own those fields");
    const request = mapTaskToIssueRequest({ ...taskFixture });
    assert.deepEqual(Object.keys(request).sort(), ["description", "requirements", "title"]);
  });
});

describe("mapper validation and identity", () => {
  it("rejects malformed tasks through T-012 without coercion", () => {
    assert.throws(() => mapTaskToTicket(null));
    assert.throws(() => mapTaskToTicket({ id: "T-001" }));
    assert.throws(() => mapTaskToTicket({ ...taskFixture, id: "" }));
    assert.throws(() => mapTaskToTicket({ ...taskFixture, specialty: "devops" }));
    assert.throws(() => mapTaskToIssueRequest(undefined));
    assert.throws(() => mapTaskToIssueRequest({ ...taskFixture, requirements: 7 }));
  });

  it("preserves task identity exactly with no generation metadata", () => {
    const ticket = mapTaskToTicket({ ...taskFixture, id: "T-042" });
    assert.equal(ticket.id, "T-042");
    assert.ok(!JSON.stringify(ticket).match(/github|issue_number|random|timestamp|uuid/i), "no external or generated identity leaks in");
  });

  it("maps one task to exactly one ticket with no sprint ticket", () => {
    const first = mapTaskToTicket({ ...taskFixture, id: "T-001" });
    const second = mapTaskToTicket({ ...taskFixture, id: "T-002" });
    assert.equal(first.id, "T-001");
    assert.equal(second.id, "T-002");
    assert.notDeepEqual(first, second, "no aggregation across tasks");
    assert.ok(!("sprint" in first), "sprints group tickets; they never become one");
  });
});

describe("mapper immutability and determinism", () => {
  it("never mutates inputs and returns independent outputs", () => {
    const task = { ...taskFixture };
    const before = JSON.stringify(task);
    const first = mapTaskToTicket(task);
    const second = mapTaskToTicket(task);
    assert.equal(JSON.stringify(task), before);
    assert.deepEqual(first, second, "same task maps identically every time");
    assert.notEqual(first, second, "each mapping returns its own ticket object");
    first.state = "in_progress";
    assert.equal(second.state, "ready", "outputs share no mutable state");
  });

  it("keeps the workflow ticket unfrozen by contract design", () => {
    const ticket = mapTaskToTicket({ ...taskFixture });
    assert.ok(!Object.isFrozen(ticket), "CoordinatorTicket stays mutable so the runtime can advance state in place");
  });
});

describe("mapper separation", () => {
  it("touches no provider, transport, persistence, role, or orchestration concept", () => {
    assert.equal(ROLE_IDS.length, 5);
    const source = readFileSync(join(__dirname, "..", "..", "src", "runtime", "plan-ticket-mapper.ts"), "utf8");
    assert.ok(!/RoleManager|TeamManager|AgentManager|TaskManager|Registry|Discovery|Finder|Chooser|AgentProvider|isAgentProvider/i.test(source.replace(/RoleResolver/g, "")), "no new manager/resolver abstraction; the existing RoleResolver is referenced, never reimplemented");
    for (const token of [
      "executeWithTimeout",
      "runCoordinatorTicket",
      "runPmPlanning",
      "runCoordinatorPlanning",
      "runTechnicalLeadPlanning",
      "runTechnicalLeadTaskDecomposition",
      "decidePlanningApproval",
      "createSprint",
      "SprintModel",
      "runSprintWorkflow",
      "TicketSource",
      "TicketSink",
      "IssueProvider",
      "WorkflowState",
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
      "parseReport",
      "reenter",
      "Router",
      "FAST",
      "issue_url",
      "ticket_source",
      "async ",
      "await ",
      "Promise<",
    ]) {
      assert.ok(!source.includes(token), `mapper never touches ${token}`);
    }
    assert.ok(!/from "\.\.\/(execution|config|cli)/.test(source));
    assert.ok(!/from "\.\.\/workflow\//.test(source));
    assert.ok(source.includes("validateTask") && source.includes("validateIssueRequest") && source.includes("isTicket"), "existing validation reused, never bypassed");
  });
});
