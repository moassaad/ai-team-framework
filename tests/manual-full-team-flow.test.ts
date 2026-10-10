import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCoordinatorPlanning } from "../src/runtime/coordinator-planning";
import { runPmPlanning } from "../src/runtime/pm-planning";
import { runTechnicalLeadPlanning } from "../src/runtime/tl-planning";
import {
  createPlanningArtifact,
  withCoordinatorPlanning,
  withPmPlanning,
  withTechnicalLeadPlanning,
} from "../src/runtime/planning-artifact";
import { decidePlanningApproval } from "../src/runtime/planning-approval";
import { runTechnicalLeadTaskDecomposition } from "../src/runtime/tl-decomposition";
import { mapTaskToTicket, mapTaskToIssueRequest } from "../src/runtime/plan-ticket-mapper";
import { persistSprintPlan, readSprintPlan } from "../src/runtime/task-persistence";
import {
  executeIndependentImplementer,
  executeIndependentSeniorReviewer,
} from "../src/roles/independent-execution";
import { createAgentHandoff, AgentHandoff } from "../src/roles/handoff";
import { validateAgentHandoff, renderAgentHandoff } from "../src/roles/handoff-validation";
import { parseAgentHandoffText } from "../src/roles/handoff-parser";
import { runRoleCommand, RoleCommandDeps } from "../src/cli-role";

// Manual full-team flow tests (M25 T-020): the human is the
// workflow coordinator. Every step composes existing public
// contracts (M22/M23/M24/M25); nothing here invokes another
// role, and no runner, state machine, delegation, mode, or
// re-entry abstraction is introduced. Hermetic: providers are
// counting stubs, persistence uses a temp dir, no network.

const SECRET_SENTINEL = "SECRET_SENTINEL_DO_NOT_FORWARD_7f3a";
const LEGIT_REQUIREMENT = "Saved articles appear in reverse-chronological order";
const LEGIT_ACCEPTANCE = "Saved articles render newest first.";

const REQUEST = "Add a reading-list page that shows saved articles.";
const OBJECTIVE = "Let readers open saved articles from one page.";

const COORDINATOR_INPUT = {
  requirements: [LEGIT_REQUIREMENT, "Opening an article marks it read"],
  constraints: ["Reuse the existing article store", "No new network services"],
};

const PM_INPUT = {
  requirements: [LEGIT_REQUIREMENT, "Opening an article marks it read"],
  scope: { in_scope: ["Reading-list page", "Mark-as-read affordance"], out_of_scope: ["Offline sync"] },
  acceptance_criteria: [LEGIT_ACCEPTANCE, "Opening an article marks it read."],
  business_rules: ["Only the owning reader sees their list."],
  business_constraints: ["Launch behind the existing reader flag."],
};

const TL_INPUT = {
  architecture: ["Server-rendered page over the article store."],
  decomposition_strategy: ["Split page render from read-state update."],
  technical_constraints: ["Reuse the article store client."],
  dependencies: ["Article store availability."],
};

const SPRINT_FIELDS = { id: "sprint-reading-list", goal: "Ship the reading-list page." };

const TASK_INPUTS = [
  {
    id: "T-101",
    title: "Render the reading-list page",
    description: "Server-render saved articles newest first.",
    requirements: LEGIT_REQUIREMENT,
    acceptance_criteria: [LEGIT_ACCEPTANCE],
    specialty: "backend" as const,
  },
  {
    id: "T-102",
    title: "Mark article read on open",
    description: "Record read state when an article opens.",
    requirements: "Opening an article marks it read",
    acceptance_criteria: ["Opening an article marks it read."],
    dependencies: ["T-101"],
    specialty: "backend" as const,
  },
];

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

/** The human transfer step: render, copy, parse, validate. */
function humanTransfer(handoff: AgentHandoff): AgentHandoff {
  const copied = renderAgentHandoff(handoff);
  assert.ok(copied.endsWith("\n") && !copied.endsWith("\n\n"), "copy-ready text is byte-exact");
  const parsed = parseAgentHandoffText(copied);
  assert.deepEqual(parsed, handoff, "parsed handoff equals the sender output");
  return validateAgentHandoff(parsed);
}

function freshRoot(): string {
  return mkdtempSync(join(tmpdir(), "t020-"));
}

describe("manual full-team flow (M25 T-020)", () => {
  describe("fixture", () => {
    it("uses empty questions so the approved flow is reachable", () => {
      assert.deepEqual(COORDINATOR_INPUT, { ...COORDINATOR_INPUT });
      assert.equal(TASK_INPUTS.length, 2);
    });
  });

  describe("happy path: planning to review through manual composition", () => {
    it("walks all twenty manual steps with no automatic chaining", async () => {
      const coordinatorCalls: CallRecord[] = [];
      const pmCalls: CallRecord[] = [];
      const tlCalls: CallRecord[] = [];
      const decompositionCalls: CallRecord[] = [];
      const implementerCalls: CallRecord[] = [];
      const reviewerCalls: CallRecord[] = [];
      const root = freshRoot();

      // 1-2. User request + Coordinator Planning.
      const coordinator = await runCoordinatorPlanning({
        identity: { role: "coordinator" },
        request: REQUEST,
        objective: OBJECTIVE,
        ...COORDINATOR_INPUT,
        project_root: root,
        provider: countingProvider(coordinatorCalls, `coordinator considerations ${SECRET_SENTINEL}`),
        timeout_ms: 1000,
      });
      assert.equal(coordinator.outcome, "completed");
      assert.equal(coordinatorCalls.length, 1);
      if (coordinator.outcome !== "completed") throw new Error("unreachable");
      assert.equal(coordinator.handoff.from, "coordinator");
      assert.equal(coordinator.handoff.to, "project-manager");

      // 3. Coordinator done invokes nothing: PM/TL/implementer/reviewer untouched.
      assert.deepEqual([pmCalls.length, tlCalls.length, implementerCalls.length, reviewerCalls.length], [0, 0, 0, 0]);

      // 4-5. Human transfers the handoff; PM Planning consumes it.
      const toPm = humanTransfer(coordinator.handoff);
      const pm = await runPmPlanning({
        identity: { role: "project-manager" },
        coordinator_handoff: toPm,
        ...PM_INPUT,
        questions: [],
        project_root: root,
        provider: countingProvider(pmCalls, `pm considerations ${SECRET_SENTINEL}`),
        timeout_ms: 1000,
      });
      assert.equal(pm.outcome, "completed");
      assert.equal(pmCalls.length, 1);
      assert.equal(coordinatorCalls.length, 1, "PM planning never re-invokes the coordinator");
      if (pm.outcome !== "completed") throw new Error("unreachable");
      assert.equal(pm.handoff.from, "project-manager");
      assert.equal(pm.handoff.to, "technical-lead");

      // 6. PM done invokes nothing further.
      assert.deepEqual([tlCalls.length, implementerCalls.length, reviewerCalls.length], [0, 0, 0]);

      // 7-8. Human transfers; TL Planning consumes it.
      const toTl = humanTransfer(pm.handoff);
      const tl = await runTechnicalLeadPlanning({
        identity: { role: "technical-lead" },
        pm_handoff: toTl,
        ...TL_INPUT,
        questions: [],
        project_root: root,
        provider: countingProvider(tlCalls, `tl considerations ${SECRET_SENTINEL}`),
        timeout_ms: 1000,
      });
      assert.equal(tl.outcome, "completed");
      assert.equal(tlCalls.length, 1);
      assert.equal(pmCalls.length, 1, "TL planning never re-invokes PM");
      if (tl.outcome !== "completed") throw new Error("unreachable");

      // 9. TL done invokes nothing: decomposition/implementer/reviewer untouched.
      assert.deepEqual(
        [decompositionCalls.length, implementerCalls.length, reviewerCalls.length],
        [0, 0, 0],
      );

      // 10. Canonical PlanningArtifact assembled from the three sections.
      let artifact = createPlanningArtifact({});
      artifact = withCoordinatorPlanning(artifact, {
        request: REQUEST,
        objective: OBJECTIVE,
        requirements: COORDINATOR_INPUT.requirements,
        constraints: COORDINATOR_INPUT.constraints,
        questions: [],
      });
      artifact = withPmPlanning(artifact, pm.plan);
      artifact = withTechnicalLeadPlanning(artifact, tl.plan);
      assert.ok(artifact.coordinator !== undefined && artifact.project_manager !== undefined && artifact.technical_lead !== undefined);
      assert.ok(Object.isFrozen(artifact));

      // 11. Explicit Planning Approval (PM authority, user-supplied decision).
      const approval = decidePlanningApproval({
        artifact,
        approval: { identity: { role: "project-manager" }, decision: "approved" },
      });
      assert.equal(approval.outcome, "approved");

      // 12-13. TL decomposition (caller-structured) + Sprint/Task link.
      const decomposition = await runTechnicalLeadTaskDecomposition({
        identity: { role: "technical-lead" },
        artifact,
        approval,
        sprint: SPRINT_FIELDS,
        tasks: TASK_INPUTS,
        project_root: root,
        provider: countingProvider(decompositionCalls, `decomposition notes ${SECRET_SENTINEL}`),
        timeout_ms: 1000,
      });
      assert.equal(decomposition.outcome, "completed");
      assert.equal(decompositionCalls.length, 1);
      assert.equal(implementerCalls.length, 0, "decomposition never invokes the implementer");
      if (decomposition.outcome !== "completed") throw new Error("unreachable");
      assert.deepEqual(decomposition.sprint.tasks, ["T-101", "T-102"]);
      for (const task of decomposition.tasks) {
        assert.equal(task.sprint, "sprint-reading-list");
      }

      // 14. Plan-to-Ticket mapping for the human-selected task.
      const selected = decomposition.tasks[0];
      const ticket = mapTaskToTicket(selected);
      assert.equal(ticket.id, "T-101");
      assert.equal(ticket.state, "ready");
      assert.ok(ticket.description.includes(LEGIT_ACCEPTANCE), "acceptance rides the labeled section");

      // 15. Task persistence + readback equivalence.
      const persisted = persistSprintPlan({ project_root: root, sprint: decomposition.sprint, tasks: decomposition.tasks });
      assert.ok(persisted.path.includes("sprint-reading-list.json"));
      const readBack = readSprintPlan({ project_root: root, sprint_id: "sprint-reading-list" });
      assert.deepEqual(readBack.sprint, decomposition.sprint);
      assert.deepEqual(readBack.tasks, decomposition.tasks);

      // 16. Human selects the read-back task; Implementer executes independently.
      const chosen = readBack.tasks[0];
      const implementation = await executeIndependentImplementer({
        identity: { role: "implementer" },
        input: {
          ticket: { id: chosen.id, title: chosen.title, description: chosen.description, requirements: chosen.requirements },
          specialty: "backend",
          role: "implementer",
          project_root: root,
          provider: countingProvider(implementerCalls, `implementation result ${SECRET_SENTINEL}`),
          timeout_ms: 1000,
        },
      });
      assert.equal(implementation.role, "implementer");
      assert.equal(implementation.execution.outcome, "completed");
      assert.equal(implementerCalls.length, 1);
      assert.equal(reviewerCalls.length, 0, "implementer never auto-invokes review");
      if (implementation.execution.outcome !== "completed") throw new Error("unreachable");

      // 17-18. Human builds the Implementer → Reviewer handoff and transfers it.
      const toReviewer = humanTransfer(
        createAgentHandoff({
          from: "implementer",
          to: "senior-reviewer",
          objective: `Review ${chosen.id}: ${chosen.title}`,
          requirements: [chosen.requirements],
          acceptance_criteria: [...(chosen.acceptance_criteria ?? [])],
          next_action: "Review the implementation result against the ticket.",
        }),
      );
      const review = await executeIndependentSeniorReviewer({
        identity: { role: "senior-reviewer" },
        handoff: toReviewer,
        input: {
          ticket: { id: chosen.id, title: chosen.title, description: chosen.description, requirements: chosen.requirements },
          implementation_result: implementation.execution.result.text,
          role: "senior-reviewer",
          project_root: root,
          provider: countingProvider(reviewerCalls, "review report: approved as specified"),
          timeout_ms: 1000,
        },
      });
      assert.equal(review.role, "senior-reviewer");
      assert.equal(review.execution.outcome, "completed");
      assert.equal(reviewerCalls.length, 1);
      assert.equal(implementerCalls.length, 1, "review never re-invokes the implementer");

      // 19. Isolation across the whole path: the provider sentinel never
      // reaches any structured field, file, or downstream prompt.
      const structured = JSON.stringify({
        toPm,
        toTl,
        artifact,
        ticket,
        sprint: decomposition.sprint,
        tasks: decomposition.tasks,
        toReviewer,
      });
      assert.ok(!structured.includes(SECRET_SENTINEL));
      assert.ok(!readFileSync(persisted.path, "utf8").includes(SECRET_SENTINEL));
      for (const calls of [pmCalls, tlCalls, decompositionCalls, implementerCalls]) {
        assert.ok(!calls[0].prompt.includes(SECRET_SENTINEL));
      }
      assert.ok(
        reviewerCalls[0].prompt.includes(SECRET_SENTINEL) === false ||
          reviewerCalls[0].prompt.includes("implementation result"),
        "reviewer sees provider text only through the contracted implementation_result input",
      );

      // 20. Legitimate upstream context survives end to end.
      assert.ok(tlCalls[0].prompt.includes(LEGIT_REQUIREMENT), "PM requirement reaches TL planning");
      assert.ok(decompositionCalls[0].prompt.includes(LEGIT_REQUIREMENT), "PM requirement reaches decomposition");
      assert.deepEqual(ticket.requirements, LEGIT_REQUIREMENT, "task requirements ride verbatim onto the ticket");
      assert.ok(ticket.description.includes(LEGIT_ACCEPTANCE));
      assert.equal(readBack.tasks[0].requirements, LEGIT_REQUIREMENT);
    });
  });

  describe("handoff boundaries", () => {
    it("Coordinator → PM transfers through render/parse/validate into PM planning", async () => {
      const calls: CallRecord[] = [];
      const root = freshRoot();
      const coordinator = await runCoordinatorPlanning({
        identity: { role: "coordinator" },
        request: REQUEST,
        objective: OBJECTIVE,
        ...COORDINATOR_INPUT,
        project_root: root,
        provider: countingProvider(calls, "ok"),
        timeout_ms: 1000,
      });
      if (coordinator.outcome !== "completed") throw new Error("unreachable");
      const transferred = humanTransfer(coordinator.handoff);
      assert.equal(transferred.to, "project-manager");
      const pm = await runPmPlanning({
        identity: { role: "project-manager" },
        coordinator_handoff: transferred,
        ...PM_INPUT,
        questions: [],
        project_root: root,
        provider: countingProvider(calls, "ok"),
        timeout_ms: 1000,
      });
      assert.equal(pm.outcome, "completed");
      assert.equal(calls.length, 2, "exactly one provider call per side, nothing else");
    });

    it("PM → TL transfers through render/parse/validate into TL planning", async () => {
      const calls: CallRecord[] = [];
      const root = freshRoot();
      const pm = await runPmPlanning({
        identity: { role: "project-manager" },
        coordinator_handoff: createAgentHandoff({ from: "coordinator", to: "project-manager", objective: OBJECTIVE }),
        ...PM_INPUT,
        questions: [],
        project_root: root,
        provider: countingProvider(calls, "ok"),
        timeout_ms: 1000,
      });
      if (pm.outcome !== "completed") throw new Error("unreachable");
      const transferred = humanTransfer(pm.handoff);
      assert.equal(transferred.from, "project-manager");
      const tl = await runTechnicalLeadPlanning({
        identity: { role: "technical-lead" },
        pm_handoff: transferred,
        ...TL_INPUT,
        questions: [],
        project_root: root,
        provider: countingProvider(calls, "ok"),
        timeout_ms: 1000,
      });
      assert.equal(tl.outcome, "completed");
      assert.equal(calls.length, 2);
    });

    it("Implementer → Reviewer transfers through render/parse/validate into the reviewer gate", async () => {
      const reviewerCalls: CallRecord[] = [];
      const root = freshRoot();
      const handoff = createAgentHandoff({
        from: "implementer",
        to: "senior-reviewer",
        objective: "Review T-101: Render the reading-list page",
        next_action: "Review the implementation result against the ticket.",
      });
      const transferred = humanTransfer(handoff);
      const review = await executeIndependentSeniorReviewer({
        identity: { role: "senior-reviewer" },
        handoff: transferred,
        input: {
          ticket: { id: "T-101", title: "t", description: "d", requirements: "r" },
          implementation_result: "done",
          role: "senior-reviewer",
          project_root: root,
          provider: countingProvider(reviewerCalls, "approved"),
          timeout_ms: 1000,
        },
      });
      assert.equal(review.execution.outcome, "completed");
      assert.deepEqual(review.handoff?.objective, "Review T-101: Render the reading-list page");
      assert.equal(reviewerCalls.length, 1);
    });
  });

  describe("no automatic chaining", () => {
    it("coordinator planning invokes nothing downstream", async () => {
      const downstream: CallRecord[] = [];
      const spy = countingProvider(downstream, "must never run");
      await runCoordinatorPlanning({
        identity: { role: "coordinator" },
        request: REQUEST,
        project_root: freshRoot(),
        provider: countingProvider([], "ok"),
        timeout_ms: 1000,
      });
      assert.equal(downstream.length, 0);
      assert.equal(spy.name, "stub");
    });

    it("PM planning invokes neither TL nor execution", async () => {
      const later: CallRecord[] = [];
      const pm = await runPmPlanning({
        identity: { role: "project-manager" },
        coordinator_handoff: createAgentHandoff({ from: "coordinator", to: "project-manager", objective: OBJECTIVE }),
        ...PM_INPUT,
        questions: [],
        project_root: freshRoot(),
        provider: countingProvider([], "ok"),
        timeout_ms: 1000,
      });
      assert.equal(pm.outcome, "completed");
      assert.equal(later.length, 0);
    });

    it("TL planning invokes no implementer", async () => {
      const impl: CallRecord[] = [];
      const tl = await runTechnicalLeadPlanning({
        identity: { role: "technical-lead" },
        pm_handoff: createAgentHandoff({ from: "project-manager", to: "technical-lead", objective: OBJECTIVE }),
        ...TL_INPUT,
        questions: [],
        project_root: freshRoot(),
        provider: countingProvider([], "ok"),
        timeout_ms: 1000,
      });
      assert.equal(tl.outcome, "completed");
      assert.equal(impl.length, 0);
    });

    it("decomposition invokes no implementer", async () => {
      const impl: CallRecord[] = [];
      const artifact = withTechnicalLeadPlanning(
        withPmPlanning(
          withCoordinatorPlanning(createPlanningArtifact({}), { request: REQUEST, requirements: [], constraints: [], questions: [] }),
          { requirements: [], scope: {}, acceptance_criteria: [], business_rules: [], business_constraints: [], questions: [] },
        ),
        { architecture: [], decomposition_strategy: [], technical_constraints: [], dependencies: [], questions: [] },
      );
      const approval = decidePlanningApproval({
        artifact,
        approval: { identity: { role: "technical-lead" }, decision: "approved" },
      });
      const result = await runTechnicalLeadTaskDecomposition({
        identity: { role: "technical-lead" },
        artifact,
        approval,
        sprint: { id: "s1", goal: "g" },
        tasks: [{ id: "T-1", title: "t", description: "d", requirements: "r" }],
        project_root: freshRoot(),
        provider: countingProvider([], "ok"),
        timeout_ms: 1000,
      });
      assert.equal(result.outcome, "completed");
      assert.equal(impl.length, 0);
    });

    it("implementer completion performs no reviewer call", async () => {
      const reviewer: CallRecord[] = [];
      const outcome = await executeIndependentImplementer({
        identity: { role: "implementer" },
        input: {
          ticket: { id: "T-1", title: "t", description: "d", requirements: "r" },
          specialty: "backend",
          role: "implementer",
          project_root: freshRoot(),
          provider: countingProvider([], "done"),
          timeout_ms: 1000,
        },
      });
      assert.equal(outcome.execution.outcome, "completed");
      assert.equal(reviewer.length, 0);
    });

    it("reviewer completion performs no second implementer call, even for critical report text", async () => {
      const implementer: CallRecord[] = [];
      const review = await executeIndependentSeniorReviewer({
        identity: { role: "senior-reviewer" },
        input: {
          ticket: { id: "T-1", title: "t", description: "d", requirements: "r" },
          implementation_result: "done",
          role: "senior-reviewer",
          project_root: freshRoot(),
          provider: countingProvider([], "changes required: rework the render path"),
          timeout_ms: 1000,
        },
      });
      assert.equal(review.execution.outcome, "completed");
      assert.equal(implementer.length, 0, "report text is opaque; no rework is triggered");
    });
  });

  describe("approval boundary", () => {
    it("approved continues into decomposition", async () => {
      const artifact = withTechnicalLeadPlanning(
        withPmPlanning(
          withCoordinatorPlanning(createPlanningArtifact({}), { request: REQUEST, requirements: [], constraints: [], questions: [] }),
          { requirements: [], scope: {}, acceptance_criteria: [], business_rules: [], business_constraints: [], questions: [] },
        ),
        { architecture: [], decomposition_strategy: [], technical_constraints: [], dependencies: [], questions: [] },
      );
      const approval = decidePlanningApproval({
        artifact,
        approval: { identity: { role: "project-manager" }, decision: "approved" },
      });
      assert.equal(approval.outcome, "approved");
      const result = await runTechnicalLeadTaskDecomposition({
        identity: { role: "technical-lead" },
        artifact,
        approval,
        sprint: { id: "s1", goal: "g" },
        tasks: [{ id: "T-1", title: "t", description: "d", requirements: "r" }],
        project_root: freshRoot(),
        provider: countingProvider([], "ok"),
        timeout_ms: 1000,
      });
      assert.equal(result.outcome, "completed");
    });

    it("changes-required stops: decomposition rejects it and nothing is persisted or implemented", async () => {
      const impl: CallRecord[] = [];
      const artifact = withTechnicalLeadPlanning(
        withPmPlanning(
          withCoordinatorPlanning(createPlanningArtifact({}), { request: REQUEST, requirements: [], constraints: [], questions: [] }),
          { requirements: [], scope: {}, acceptance_criteria: [], business_rules: [], business_constraints: [], questions: [] },
        ),
        { architecture: [], decomposition_strategy: [], technical_constraints: [], dependencies: [], questions: [] },
      );
      const rejection = decidePlanningApproval({
        artifact,
        approval: { identity: { role: "technical-lead" }, decision: "changes-required", notes: "Scope is unclear" },
      });
      assert.equal(rejection.outcome, "changes-required");
      await assert.rejects(
        runTechnicalLeadTaskDecomposition({
          identity: { role: "technical-lead" },
          artifact,
          approval: rejection,
          sprint: { id: "s1", goal: "g" },
          tasks: [{ id: "T-1", title: "t", description: "d", requirements: "r" }],
          project_root: freshRoot(),
          provider: countingProvider([], "ok"),
          timeout_ms: 1000,
        }),
        /approved/,
      );
      assert.equal(impl.length, 0);
    });

    it("incomplete artifact cannot be approved", () => {
      const partial = withCoordinatorPlanning(createPlanningArtifact({}), { request: REQUEST, requirements: [], constraints: [], questions: [] });
      assert.throws(
        () =>
          decidePlanningApproval({
            artifact: partial,
            approval: { identity: { role: "project-manager" }, decision: "approved" },
          }),
        /complete/,
      );
    });

    it("approval with open questions is rejected even when decided approved", () => {
      const artifact = withTechnicalLeadPlanning(
        withPmPlanning(
          withCoordinatorPlanning(createPlanningArtifact({}), { request: REQUEST, requirements: [], constraints: [], questions: [] }),
          { requirements: [], scope: {}, acceptance_criteria: [], business_rules: [], business_constraints: [], questions: ["Unclear scope"] },
        ),
        { architecture: [], decomposition_strategy: [], technical_constraints: [], dependencies: [], questions: [] },
      );
      assert.throws(
        () =>
          decidePlanningApproval({
            artifact,
            approval: { identity: { role: "technical-lead" }, decision: "approved" },
          }),
        /unresolved question/,
      );
    });

    it("PM clarification-required yields no TL handoff", async () => {
      const pm = await runPmPlanning({
        identity: { role: "project-manager" },
        coordinator_handoff: createAgentHandoff({ from: "coordinator", to: "project-manager", objective: OBJECTIVE }),
        ...PM_INPUT,
        questions: ["Which reader segment first?"],
        project_root: freshRoot(),
        provider: countingProvider([], "ok"),
        timeout_ms: 1000,
      });
      assert.equal(pm.outcome, "clarification-required");
      assert.ok(!("handoff" in pm), "no TL handoff on clarification");
    });
  });

  describe("sprint, task, ticket, persistence", () => {
    it("sprint.tasks and task.sprint link by construction", async () => {
      const artifact = withTechnicalLeadPlanning(
        withPmPlanning(
          withCoordinatorPlanning(createPlanningArtifact({}), { request: REQUEST, requirements: [], constraints: [], questions: [] }),
          { requirements: [], scope: {}, acceptance_criteria: [], business_rules: [], business_constraints: [], questions: [] },
        ),
        { architecture: [], decomposition_strategy: [], technical_constraints: [], dependencies: [], questions: [] },
      );
      const approval = decidePlanningApproval({
        artifact,
        approval: { identity: { role: "technical-lead" }, decision: "approved" },
      });
      const result = await runTechnicalLeadTaskDecomposition({
        identity: { role: "technical-lead" },
        artifact,
        approval,
        sprint: SPRINT_FIELDS,
        tasks: TASK_INPUTS,
        project_root: freshRoot(),
        provider: countingProvider([], "ok"),
        timeout_ms: 1000,
      });
      if (result.outcome !== "completed") throw new Error("unreachable");
      assert.deepEqual(result.sprint.tasks, result.tasks.map((task) => task.id));
      for (const task of result.tasks) {
        assert.equal(task.sprint, result.sprint.id);
      }
    });

    it("Task maps to exactly one ready Ticket with identity preserved", async () => {
      const artifact = withTechnicalLeadPlanning(
        withPmPlanning(
          withCoordinatorPlanning(createPlanningArtifact({}), { request: REQUEST, requirements: [], constraints: [], questions: [] }),
          { requirements: [], scope: {}, acceptance_criteria: [], business_rules: [], business_constraints: [], questions: [] },
        ),
        { architecture: [], decomposition_strategy: [], technical_constraints: [], dependencies: [], questions: [] },
      );
      const approval = decidePlanningApproval({
        artifact,
        approval: { identity: { role: "technical-lead" }, decision: "approved" },
      });
      const result = await runTechnicalLeadTaskDecomposition({
        identity: { role: "technical-lead" },
        artifact,
        approval,
        sprint: SPRINT_FIELDS,
        tasks: TASK_INPUTS,
        project_root: freshRoot(),
        provider: countingProvider([], "ok"),
        timeout_ms: 1000,
      });
      if (result.outcome !== "completed") throw new Error("unreachable");
      const before = JSON.parse(JSON.stringify(result.tasks[0]));
      const ticket = mapTaskToTicket(result.tasks[0]);
      assert.equal(ticket.id, "T-101");
      assert.equal(ticket.state, "ready");
      assert.ok(ticket.description.includes(LEGIT_ACCEPTANCE));
      assert.deepEqual(result.tasks[0], before, "Task unchanged by mapping");
    });

    it("issue mapping assigns no id and invokes no provider", () => {
      const request = mapTaskToIssueRequest(TASK_INPUTS[0]);
      assert.equal(request.title, "Render the reading-list page");
      assert.ok(!("id" in request), "issue identity is provider-assigned externally");
      assert.ok(request.description.includes(LEGIT_ACCEPTANCE));
    });

    it("persistence write/readback round-trips Sprint + Tasks", async () => {
      const root = freshRoot();
      const artifact = withTechnicalLeadPlanning(
        withPmPlanning(
          withCoordinatorPlanning(createPlanningArtifact({}), { request: REQUEST, requirements: [], constraints: [], questions: [] }),
          { requirements: [], scope: {}, acceptance_criteria: [], business_rules: [], business_constraints: [], questions: [] },
        ),
        { architecture: [], decomposition_strategy: [], technical_constraints: [], dependencies: [], questions: [] },
      );
      const approval = decidePlanningApproval({
        artifact,
        approval: { identity: { role: "technical-lead" }, decision: "approved" },
      });
      const result = await runTechnicalLeadTaskDecomposition({
        identity: { role: "technical-lead" },
        artifact,
        approval,
        sprint: SPRINT_FIELDS,
        tasks: TASK_INPUTS,
        project_root: root,
        provider: countingProvider([], "ok"),
        timeout_ms: 1000,
      });
      if (result.outcome !== "completed") throw new Error("unreachable");
      const persisted = persistSprintPlan({ project_root: root, sprint: result.sprint, tasks: result.tasks });
      const readBack = readSprintPlan({ project_root: root, sprint_id: "sprint-reading-list" });
      assert.deepEqual(readBack.sprint, result.sprint);
      assert.deepEqual(readBack.tasks, result.tasks);
      assert.ok(persisted.path.endsWith("sprint-reading-list.json"));
    });

    it("readback of a missing sprint throws loudly", () => {
      assert.throws(
        () => readSprintPlan({ project_root: freshRoot(), sprint_id: "no-such-sprint" }),
        /not found/,
      );
    });

    it("execution consumes the validated read-back models", async () => {
      const root = freshRoot();
      const artifact = withTechnicalLeadPlanning(
        withPmPlanning(
          withCoordinatorPlanning(createPlanningArtifact({}), { request: REQUEST, requirements: [], constraints: [], questions: [] }),
          { requirements: [], scope: {}, acceptance_criteria: [], business_rules: [], business_constraints: [], questions: [] },
        ),
        { architecture: [], decomposition_strategy: [], technical_constraints: [], dependencies: [], questions: [] },
      );
      const approval = decidePlanningApproval({
        artifact,
        approval: { identity: { role: "technical-lead" }, decision: "approved" },
      });
      const result = await runTechnicalLeadTaskDecomposition({
        identity: { role: "technical-lead" },
        artifact,
        approval,
        sprint: SPRINT_FIELDS,
        tasks: TASK_INPUTS,
        project_root: root,
        provider: countingProvider([], "ok"),
        timeout_ms: 1000,
      });
      if (result.outcome !== "completed") throw new Error("unreachable");
      persistSprintPlan({ project_root: root, sprint: result.sprint, tasks: result.tasks });
      const readBack = readSprintPlan({ project_root: root, sprint_id: "sprint-reading-list" });
      const chosen = readBack.tasks[1];
      const outcome = await executeIndependentImplementer({
        identity: { role: "implementer" },
        input: {
          ticket: { id: chosen.id, title: chosen.title, description: chosen.description, requirements: chosen.requirements },
          specialty: "backend",
          role: "implementer",
          project_root: root,
          provider: countingProvider([], "done"),
          timeout_ms: 1000,
        },
      });
      assert.equal(outcome.execution.outcome, "completed");
      if (outcome.execution.outcome !== "completed") throw new Error("unreachable");
      assert.equal(outcome.execution.ticket_id, "T-102");
    });
  });

  describe("failure paths stop the manual flow", () => {
    it("malformed handoff text is rejected by parse", () => {
      assert.throws(() => parseAgentHandoffText("not a handoff at all"), /./);
    });

    it("wrong-destination handoff is rejected before destination provider invocation", async () => {
      const reviewer: CallRecord[] = [];
      const misdirected = createAgentHandoff({ from: "implementer", to: "technical-lead", objective: "Wrong inbox" });
      await assert.rejects(
        executeIndependentSeniorReviewer({
          identity: { role: "senior-reviewer" },
          handoff: misdirected,
          input: {
            ticket: { id: "T-1", title: "t", description: "d", requirements: "r" },
            implementation_result: "done",
            role: "senior-reviewer",
            project_root: freshRoot(),
            provider: countingProvider(reviewer, "must never run"),
            timeout_ms: 1000,
          },
        }),
        /cannot authorize/,
      );
      assert.equal(reviewer.length, 0);
    });

    it("tampered handoff text fails validation on re-render check", () => {
      const handoff = createAgentHandoff({ from: "implementer", to: "senior-reviewer", objective: "Review T-1" });
      const tampered = renderAgentHandoff(handoff).replace("To: senior-reviewer", "To: senior-reviewer\nTo: implementer");
      assert.throws(() => parseAgentHandoffText(tampered), /./);
    });

    it("coordinator provider failure yields failed with no PM step", async () => {
      const pm: CallRecord[] = [];
      const coordinator = await runCoordinatorPlanning({
        identity: { role: "coordinator" },
        request: REQUEST,
        project_root: freshRoot(),
        provider: countingProvider([], "ok", true),
        timeout_ms: 1000,
      });
      assert.equal(coordinator.outcome, "failed");
      assert.ok(!("handoff" in coordinator), "no handoff on failure, so no manual transfer exists");
      assert.equal(pm.length, 0);
    });

    it("decomposition failure persists nothing and implements nothing", async () => {
      const impl: CallRecord[] = [];
      const root = freshRoot();
      const artifact = withTechnicalLeadPlanning(
        withPmPlanning(
          withCoordinatorPlanning(createPlanningArtifact({}), { request: REQUEST, requirements: [], constraints: [], questions: [] }),
          { requirements: [], scope: {}, acceptance_criteria: [], business_rules: [], business_constraints: [], questions: [] },
        ),
        { architecture: [], decomposition_strategy: [], technical_constraints: [], dependencies: [], questions: [] },
      );
      const approval = decidePlanningApproval({
        artifact,
        approval: { identity: { role: "technical-lead" }, decision: "approved" },
      });
      const result = await runTechnicalLeadTaskDecomposition({
        identity: { role: "technical-lead" },
        artifact,
        approval,
        sprint: { id: "s-fail", goal: "g" },
        tasks: [{ id: "T-1", title: "t", description: "d", requirements: "r" }],
        project_root: root,
        provider: countingProvider([], "ok", true),
        timeout_ms: 1000,
      });
      assert.equal(result.outcome, "failed");
      assert.throws(() => readSprintPlan({ project_root: root, sprint_id: "s-fail" }), /not found/);
      assert.equal(impl.length, 0);
    });

    it("persistence failure surfaces with no implementation and no hidden retry", () => {
      const impl: CallRecord[] = [];
      const sprint = { id: "s1", goal: "g", tasks: ["T-1"] };
      const tasks = [{ id: "T-1", title: "t", description: "d", requirements: "r", sprint: "s1" }];
      assert.throws(
        () => persistSprintPlan({ project_root: "/no-such-root-t020", sprint, tasks }),
        /not accessible|cannot create/,
      );
      assert.equal(impl.length, 0);
    });

    it("implementer provider failure yields failed with no reviewer step", async () => {
      const reviewer: CallRecord[] = [];
      const outcome = await executeIndependentImplementer({
        identity: { role: "implementer" },
        input: {
          ticket: { id: "T-1", title: "t", description: "d", requirements: "r" },
          specialty: "backend",
          role: "implementer",
          project_root: freshRoot(),
          provider: countingProvider([], "boom", true),
          timeout_ms: 1000,
        },
      });
      assert.equal(outcome.execution.outcome, "failed");
      assert.ok(!("handoff" in outcome) || outcome.handoff === undefined);
      assert.equal(reviewer.length, 0);
    });

    it("reviewer changes-required report terminates the step with no re-entry", async () => {
      const implementer: CallRecord[] = [];
      const review = await executeIndependentSeniorReviewer({
        identity: { role: "senior-reviewer" },
        input: {
          ticket: { id: "T-1", title: "t", description: "d", requirements: "r" },
          implementation_result: "done",
          role: "senior-reviewer",
          project_root: freshRoot(),
          provider: countingProvider([], "changes required: rework the render path before approval"),
          timeout_ms: 1000,
        },
      });
      assert.equal(review.execution.outcome, "completed");
      if (review.execution.outcome !== "completed") throw new Error("unreachable");
      assert.ok(review.execution.report.includes("changes required"), "result surfaced verbatim");
      assert.equal(implementer.length, 0, "user owns rework; no automatic implementer invocation");
    });
  });

  describe("isolation, determinism, and scope pins", () => {
    it("provider reports never populate structured fields", async () => {
      const pm = await runPmPlanning({
        identity: { role: "project-manager" },
        coordinator_handoff: createAgentHandoff({ from: "coordinator", to: "project-manager", objective: OBJECTIVE }),
        ...PM_INPUT,
        questions: [],
        project_root: freshRoot(),
        provider: countingProvider([], `report ${SECRET_SENTINEL}`),
        timeout_ms: 1000,
      });
      if (pm.outcome !== "completed") throw new Error("unreachable");
      assert.ok(!JSON.stringify({ plan: pm.plan, handoff: pm.handoff }).includes(SECRET_SENTINEL));
      assert.ok(pm.report.includes(SECRET_SENTINEL), "report itself stays verbatim and opaque");
    });

    it("junk input fields are stripped by validators at execution", async () => {
      const outcome = await executeIndependentImplementer({
        identity: { role: "implementer" },
        input: {
          ticket: { id: "T-1", title: "t", description: "d", requirements: "r" },
          specialty: "backend",
          role: "implementer",
          project_root: freshRoot(),
          provider: countingProvider([], "done"),
          timeout_ms: 1000,
          reviewer_notes: "MUST_NOT_TRAVEL",
        } as unknown as Parameters<typeof executeIndependentImplementer>[0]["input"],
      });
      assert.equal(outcome.execution.outcome, "completed");
    });

    it("the happy path is deterministic across runs", async () => {
      const runOnce = async () => {
        const root = freshRoot();
        const coordinator = await runCoordinatorPlanning({
          identity: { role: "coordinator" },
          request: REQUEST,
          objective: OBJECTIVE,
          ...COORDINATOR_INPUT,
          project_root: root,
          provider: countingProvider([], "c"),
          timeout_ms: 1000,
        });
        if (coordinator.outcome !== "completed") throw new Error("unreachable");
        const pm = await runPmPlanning({
          identity: { role: "project-manager" },
          coordinator_handoff: humanTransfer(coordinator.handoff),
          ...PM_INPUT,
          questions: [],
          project_root: root,
          provider: countingProvider([], "p"),
          timeout_ms: 1000,
        });
        if (pm.outcome !== "completed") throw new Error("unreachable");
        return JSON.stringify({ c: coordinator.handoff, p: pm.handoff, plan: pm.plan });
      };
      assert.equal(await runOnce(), await runOnce());
    });

    it("results are frozen; inputs are never mutated", async () => {
      const coordinator = await runCoordinatorPlanning({
        identity: { role: "coordinator" },
        request: REQUEST,
        project_root: freshRoot(),
        provider: countingProvider([], "ok"),
        timeout_ms: 1000,
      });
      if (coordinator.outcome !== "completed") throw new Error("unreachable");
      assert.ok(Object.isFrozen(coordinator.handoff));
      const taskInput = { id: "T-9", title: "t", description: "d", requirements: "r" };
      const snapshot = JSON.stringify(taskInput);
      mapTaskToTicket(taskInput);
      assert.equal(JSON.stringify(taskInput), snapshot);
    });

    it("planning and decomposition never touch the historical ticket runtime", () => {
      for (const file of [
        "src/runtime/coordinator-planning.ts",
        "src/runtime/pm-planning.ts",
        "src/runtime/tl-planning.ts",
        "src/runtime/tl-decomposition.ts",
      ]) {
        const source = readFileSync(join(__dirname, "..", "..", file), "utf8");
        assert.ok(!source.includes("runtime/coordinator"), `${file} stays clear of the historical coordinator seam`);
        assert.ok(!source.includes("delegate"), `${file} introduces no delegation`);
      }
    });

    it("T-020 adds no runner, state, mode, re-entry, or delegation surface", () => {
      const ownSource = readFileSync(join(__dirname, "..", "..", "tests", "manual-full-team-flow.test.ts"), "utf8");
      assert.ok(
        !/\b(function|class|const|type|interface)\s+(runFullTeam|runManualTeam|executeTeam|TeamOrchestrator|ManualWorkflowManager|ReentryRequest)\b/.test(
          ownSource,
        ),
        "no orchestration or re-entry abstraction is defined",
      );
      assert.ok(!/from\s+["'][^"']*delegate[^"']*["']/.test(ownSource), "no delegation import");
      assert.ok(!/require\(\s*["'][^"']*delegate[^"']*["']/.test(ownSource), "no delegation require");
      assert.ok(!/["'](FAST|STANDARD|FULL)["']/.test(ownSource), "no mode routing");
      const stray = readdirSync(join(__dirname, "..", "..", "src")).filter((entry) =>
        /manual|full.?team|orchestrat/i.test(entry),
      );
      assert.deepEqual(stray, [], "no new team-flow modules under src/");
    });

    it("the existing CLI building blocks execute one role step with a stub executor", async () => {
      const implementerCalls: unknown[] = [];
      const provider = { name: "stub", execute: async () => ({ status: "succeeded" as const, text: "done" }) };
      const deps: RoleCommandDeps = {
        projectRoot: "/proj",
        loadConfiguration: () => ({} as never),
        createAgent: () => provider,
        readReviewDecision: async () => ({ decision: "approved" as const }),
        readStdinText: async () => "",
        executeImplementer: (async (call: unknown) => {
          implementerCalls.push(call);
          return {
            role: "implementer" as const,
            execution: {
              outcome: "completed" as const,
              ticket_id: "T-101",
              result: { status: "succeeded" as const, text: "done" },
              next_state: "implementation_review" as const,
            },
          };
        }) as RoleCommandDeps["executeImplementer"],
        executeSeniorReviewer: (async () => {
          throw new Error("not this role");
        }) as RoleCommandDeps["executeSeniorReviewer"],
        executeTechnicalLead: (async () => {
          throw new Error("not this role");
        }) as RoleCommandDeps["executeTechnicalLead"],
        executeProjectManager: (async () => {
          throw new Error("not this role");
        }) as RoleCommandDeps["executeProjectManager"],
        executeCoordinator: (async () => {
          throw new Error("not this role");
        }) as RoleCommandDeps["executeCoordinator"],
      };
      const result = await runRoleCommand(deps, [
        "role",
        "implementer",
        "--id",
        "T-101",
        "--title",
        "t",
        "--description",
        "d",
        "--requirements",
        "r",
        "--specialty",
        "backend",
      ]);
      assert.equal(result.exitCode, 0);
      assert.equal(implementerCalls.length, 1, "exactly one independent execution, nothing else");
    });
  });
});
