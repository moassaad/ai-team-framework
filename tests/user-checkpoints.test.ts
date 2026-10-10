import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHECKPOINT_BOUNDARIES,
  CHECKPOINT_DECISIONS,
  CHECKPOINT_WORKFLOWS,
  CHECKPOINT_BOUNDARY_GUIDANCE,
  MAX_CHECKPOINT_ID_LENGTH,
  MAX_CHECKPOINT_TEXT_LENGTH,
  createUserCheckpoint,
  describeCheckpointBoundary,
  isCheckpointBoundary,
  isCheckpointDecision,
  isCheckpointWorkflow,
  resolveUserCheckpoint,
  validateUserCheckpoint,
  validateUserCheckpointResponse,
  UserCheckpointInput,
  UserCheckpointResponseInput,
} from "../src/runtime/user-checkpoint";
import { decidePlanningApproval } from "../src/runtime/planning-approval";
import { recommendMode } from "../src/runtime/mode-recommendation";
import { validateCorrectionReference } from "../src/runtime/correction-reference";
import { renderAgentHandoff, validateAgentHandoff } from "../src/roles/handoff-validation";
import { parseAgentHandoffText } from "../src/roles/handoff-parser";

function checkpointInput(overrides: Partial<UserCheckpointInput> = {}): UserCheckpointInput {
  return {
    id: "checkpoint-plan-001",
    boundary: "plan-approval",
    workflow: "new-project",
    stage: "planning-approval",
    purpose: "Approve the complete planning artifact before sprint decomposition.",
    ...overrides,
  };
}

function responseInput(overrides: Partial<UserCheckpointResponseInput> = {}): UserCheckpointResponseInput {
  return {
    checkpointId: "checkpoint-plan-001",
    stage: "planning-approval",
    decision: "proceed",
    ...overrides,
  };
}

describe("user checkpoints (M29 T-043)", () => {
  describe("checkpoint request contract", () => {
    it("a valid request constructs, validates, and freezes", () => {
      const checkpoint = createUserCheckpoint(checkpointInput({
        references: ["artifact:plan-001"],
        feedback: "Reviewed the scope section.",
      }));
      assert.equal(checkpoint.id, "checkpoint-plan-001");
      assert.equal(checkpoint.boundary, "plan-approval");
      assert.equal(checkpoint.workflow, "new-project");
      assert.equal(checkpoint.stage, "planning-approval");
      assert.deepEqual(validateUserCheckpoint(checkpoint), checkpoint);
      assert.ok(Object.isFrozen(checkpoint));
      assert.ok(Object.isFrozen(checkpoint.decisions));
      assert.ok(Object.isFrozen(checkpoint.references));
    });

    it("invalid or missing checkpoint identity is rejected", () => {
      assert.throws(() => createUserCheckpoint(checkpointInput({ id: "" })), "non-empty");
      assert.throws(() => createUserCheckpoint(checkpointInput({ id: 42 })), "non-empty");
      assert.throws(() => createUserCheckpoint(checkpointInput({ id: undefined })), "non-empty");
      assert.throws(
        () => createUserCheckpoint(checkpointInput({ id: `c-${"x".repeat(MAX_CHECKPOINT_ID_LENGTH)}` })),
        "bound",
      );
    });

    it("invalid workflow, boundary, or stage identifiers are rejected", () => {
      assert.throws(() => createUserCheckpoint(checkpointInput({ boundary: "approve-everything" })), "boundary");
      assert.throws(() => createUserCheckpoint(checkpointInput({ workflow: "quick-start" })), "workflow");
      assert.throws(() => createUserCheckpoint(checkpointInput({ stage: "" })), "stage");
      assert.throws(() => createUserCheckpoint(checkpointInput({ stage: { name: "x" } })), "stage");
      assert.ok(!isCheckpointBoundary("approve-everything"));
      assert.ok(!isCheckpointWorkflow("quick-start"));
      assert.ok(!isCheckpointDecision("approved"));
    });

    it("the required decision surface is explicit", () => {
      const implicit = createUserCheckpoint(checkpointInput());
      assert.deepEqual([...implicit.decisions], ["proceed", "request-changes", "stop"]);
      const narrowed = createUserCheckpoint(checkpointInput({ decisions: ["proceed", "stop"] }));
      assert.deepEqual([...narrowed.decisions], ["proceed", "stop"]);
      assert.throws(() => createUserCheckpoint(checkpointInput({ decisions: [] })), "decisions");
      assert.throws(() => createUserCheckpoint(checkpointInput({ decisions: ["approved"] })), "decisions");
      assert.throws(() => createUserCheckpoint(checkpointInput({ purpose: "" })), "purpose");
      assert.throws(
        () => createUserCheckpoint(checkpointInput({ purpose: "p".repeat(MAX_CHECKPOINT_TEXT_LENGTH + 1) })),
        "bound",
      );
    });

    it("the boundary catalog covers every roadmap boundary exactly once", () => {
      assert.deepEqual([...CHECKPOINT_BOUNDARIES], [
        "plan-approval",
        "plan-rejection",
        "requirements-change",
        "work-mode-selection",
        "reentry-approval",
        "sensitive-change-approval",
      ]);
      assert.equal(CHECKPOINT_BOUNDARY_GUIDANCE.length, CHECKPOINT_BOUNDARIES.length);
      for (const boundary of CHECKPOINT_BOUNDARIES) {
        const guidance = describeCheckpointBoundary(boundary);
        assert.equal(guidance.boundary, boundary);
        assert.ok(guidance.workflows.length > 0);
        for (const workflow of guidance.workflows) {
          assert.ok((CHECKPOINT_WORKFLOWS as readonly string[]).includes(workflow));
        }
        assert.ok(guidance.decidedThrough.length > 0, "every boundary names the existing contract the caller continues through");
      }
      assert.ok(Object.isFrozen(CHECKPOINT_BOUNDARY_GUIDANCE));
    });
  });

  describe("checkpoint resolution semantics", () => {
    it("a missing user response never allows continuation", () => {
      const checkpoint = createUserCheckpoint(checkpointInput());
      for (const missing of [undefined, null, "proceed", 0, false]) {
        assert.throws(
          () => resolveUserCheckpoint({ checkpoint, response: missing }),
          "missing response never approves",
        );
      }
      assert.throws(
        () => resolveUserCheckpoint({ checkpoint, response: { checkpointId: checkpoint.id, stage: checkpoint.stage } }),
        "missing decision never approves",
      );
      assert.throws(
        () => resolveUserCheckpoint({ checkpoint, response: responseInput({ decision: "" }) }),
        "empty decision never approves",
      );
    });

    it("a valid response resolves only the matching checkpoint", () => {
      const checkpoint = createUserCheckpoint(checkpointInput());
      const resolution = resolveUserCheckpoint({ checkpoint, response: responseInput() });
      assert.deepEqual(resolution, {
        status: "proceed",
        checkpointId: "checkpoint-plan-001",
        boundary: "plan-approval",
        workflow: "new-project",
        stage: "planning-approval",
      });
      assert.ok(Object.isFrozen(resolution));
    });

    it("a mismatched checkpoint id or stage is rejected", () => {
      const checkpoint = createUserCheckpoint(checkpointInput());
      assert.throws(
        () => resolveUserCheckpoint({ checkpoint, response: responseInput({ checkpointId: "checkpoint-plan-002" }) }),
        "does not match",
      );
      assert.throws(
        () => resolveUserCheckpoint({ checkpoint, response: responseInput({ stage: "sprint-decomposition" }) }),
        "does not match",
      );
    });

    it("unsupported response values are rejected", () => {
      const checkpoint = createUserCheckpoint(checkpointInput());
      for (const decision of ["approved", "yes", "confirmed", "APPROVED", "continue"]) {
        assert.throws(
          () => resolveUserCheckpoint({ checkpoint, response: responseInput({ decision }) }),
          `unsupported decision ${decision} rejected`,
        );
      }
      const narrowed = createUserCheckpoint(checkpointInput({ decisions: ["proceed", "stop"] }));
      assert.throws(
        () => resolveUserCheckpoint({ checkpoint: narrowed, response: responseInput({ decision: "request-changes", feedback: "Adjust scope." }) }),
        "not accepted by checkpoint",
      );
    });

    it("a stop decision cannot be mistaken for continue or approval", () => {
      const checkpoint = createUserCheckpoint(checkpointInput());
      const stopped = resolveUserCheckpoint({ checkpoint, response: responseInput({ decision: "stop" }) });
      assert.equal(stopped.status, "stopped");
      assert.ok(!("outcome" in stopped), "no approval outcome vocabulary");
      assert.ok(!("authority" in stopped), "no approval authority");
      assert.deepEqual(Object.keys(stopped).sort(), ["boundary", "checkpointId", "stage", "status", "workflow"]);
    });

    it("changes-requested stays distinct from role-owned approvals and requires feedback", () => {
      const checkpoint = createUserCheckpoint(checkpointInput());
      assert.throws(
        () => resolveUserCheckpoint({ checkpoint, response: responseInput({ decision: "request-changes" }) }),
        "changes without feedback cannot ground action",
      );
      assert.throws(
        () => resolveUserCheckpoint({ checkpoint, response: responseInput({ decision: "request-changes", feedback: "" }) }),
        "empty feedback cannot ground action",
      );
      const resolution = resolveUserCheckpoint({
        checkpoint,
        response: responseInput({ decision: "request-changes", feedback: "Narrow the scope to sign-in only." }),
      });
      assert.deepEqual(resolution, {
        status: "changes-requested",
        checkpointId: "checkpoint-plan-001",
        boundary: "plan-approval",
        workflow: "new-project",
        stage: "planning-approval",
        feedback: "Narrow the scope to sign-in only.",
      });
      assert.ok(!("authority" in resolution), "no impersonated PM/TL authority");
      assert.ok(!("identity" in resolution), "no impersonated role identity");
    });

    it("original feedback and structured references are preserved verbatim", () => {
      const checkpoint = createUserCheckpoint(checkpointInput({
        references: ["  artifact:plan-001  "],
        feedback: "  Keep  the  exact  wording.  ",
      }));
      const resolution = resolveUserCheckpoint({
        checkpoint,
        response: responseInput({ decision: "proceed", feedback: "  Proceed\nwith  care.  " }),
      });
      assert.equal((resolution as { feedback?: string }).feedback, "  Proceed\nwith  care.  ");
      assert.deepEqual(checkpoint.references, ["  artifact:plan-001  "]);
      assert.equal(checkpoint.feedback, "  Keep  the  exact  wording.  ");
    });

    it("provider reports and opaque text are not parsed into user decisions", () => {
      const checkpoint = createUserCheckpoint(checkpointInput());
      assert.throws(
        () => resolveUserCheckpoint({
          checkpoint,
          response: responseInput({ decision: { text: "proceed", outcome: "approved" } }),
        }),
        "provider-shaped decision rejected",
      );
      assert.throws(
        () => validateUserCheckpointResponse({ checkpointId: checkpoint.id, stage: checkpoint.stage, decision: "The user said proceed." }),
        "prose never parses into a decision",
      );
    });

    it("caller-owned objects are not mutated", () => {
      const input = checkpointInput({ references: ["artifact:plan-001"] });
      const before = JSON.parse(JSON.stringify(input)) as unknown;
      const response = responseInput({ decision: "stop", feedback: "Halt here." });
      const responseBefore = JSON.parse(JSON.stringify(response)) as unknown;
      const checkpoint = createUserCheckpoint(input);
      resolveUserCheckpoint({ checkpoint, response });
      assert.deepEqual(input, before);
      assert.deepEqual(response, responseBefore);
    });

    it("results follow immutability conventions", () => {
      const checkpoint = createUserCheckpoint(checkpointInput());
      const response = validateUserCheckpointResponse(responseInput());
      assert.ok(Object.isFrozen(checkpoint));
      assert.ok(Object.isFrozen(response));
      for (const decision of CHECKPOINT_DECISIONS) {
        const resolution = resolveUserCheckpoint({
          checkpoint,
          response: {
            checkpointId: checkpoint.id,
            stage: checkpoint.stage,
            decision,
            ...(decision === "request-changes" ? { feedback: "Adjust." } : {}),
          },
        });
        assert.ok(Object.isFrozen(resolution), `${decision} resolution frozen`);
      }
    });
  });

  describe("architectural boundaries", () => {
    it("creating or resolving a checkpoint executes no role and calls no provider", () => {
      let providerCalls = 0;
      const spyProvider = async () => {
        providerCalls += 1;
        return { text: "must never be read" };
      };
      const checkpoint = createUserCheckpoint({
        ...checkpointInput(),
        provider: spyProvider,
      } as unknown as UserCheckpointInput);
      const resolution = resolveUserCheckpoint({ checkpoint, response: responseInput() });
      assert.equal(providerCalls, 0, "no provider exists for the contract to call");
      assert.ok(!("provider" in checkpoint), "an injected provider is ignored, never retained");
      assert.deepEqual(Object.keys(resolution).sort(), ["boundary", "checkpointId", "stage", "status", "workflow"]);
      assert.ok(!("text" in resolution) && !("result" in resolution), "no provider text leaks into the resolution");
    });

    it("a resolution never impersonates an authorized role decision", () => {
      const checkpoint = createUserCheckpoint(checkpointInput({ boundary: "plan-approval" }));
      const resolution = resolveUserCheckpoint({ checkpoint, response: responseInput({ decision: "proceed" }) });
      assert.deepEqual(Object.keys(resolution).sort(), ["boundary", "checkpointId", "stage", "status", "workflow"]);
      for (const forbidden of ["identity", "authority", "role", "outcome", "approved", "resolver", "token", "resume", "callback"]) {
        assert.ok(!(forbidden in resolution), `resolution carries no ${forbidden}`);
      }
    });

    it("resolution is synchronous: no pause, wait, persistence, or resume", () => {
      const checkpoint = createUserCheckpoint(checkpointInput());
      const created = createUserCheckpoint(checkpointInput({ id: "checkpoint-sync-002" }));
      const resolution = resolveUserCheckpoint({ checkpoint, response: responseInput() });
      for (const value of [checkpoint, created, resolution]) {
        assert.ok(!(value instanceof Promise), "every checkpoint operation returns synchronously");
      }
      assert.deepEqual(Object.keys(resolution).sort(), ["boundary", "checkpointId", "stage", "status", "workflow"]);
    });

    it("no automatic retry, fallback, delegation, re-entry, or resumption occurs", () => {
      const checkpoint = createUserCheckpoint(checkpointInput());
      const first = resolveUserCheckpoint({ checkpoint, response: responseInput({ decision: "stop" }) });
      const second = resolveUserCheckpoint({ checkpoint, response: responseInput({ decision: "stop" }) });
      assert.deepEqual(first, second, "resolution is stateless: no counters, registries, or transitions");
      assert.throws(() => resolveUserCheckpoint({ checkpoint, response: responseInput({ checkpointId: "other" }) }), "first mismatch throws");
      assert.throws(() => resolveUserCheckpoint({ checkpoint, response: responseInput({ checkpointId: "other" }) }), "second identical mismatch throws the same way");
      assert.deepEqual(checkpoint, createUserCheckpoint(checkpointInput()), "the checkpoint itself is unchanged by resolution attempts");
    });

    it("existing planning-approval authority checks remain unchanged", () => {
      const artifact = {
        coordinator: { request: "Add sign-in.", objective: "Secure sign-in.", requirements: ["Sign in"], constraints: [], questions: [] },
        project_manager: {
          requirements: ["Sign in"],
          scope: { in_scope: ["Sign-in form"], out_of_scope: ["Social login"] },
          acceptance_criteria: ["Invalid credentials are rejected."],
          business_rules: ["Verified users access protected resources."],
          business_constraints: ["Launch with the existing user base."],
          questions: [],
        },
        technical_lead: {
          architecture: ["Layered modules."],
          decomposition_strategy: ["Split by bounded context."],
          technical_constraints: ["Reuse existing auth tables."],
          dependencies: ["Session store availability."],
          questions: [],
        },
      };
      const approved = decidePlanningApproval({
        artifact,
        approval: { identity: { role: "project-manager" }, decision: "approved" },
      });
      assert.equal(approved.outcome, "approved");
      assert.equal(approved.authority, "project-manager");
      assert.throws(
        () => decidePlanningApproval({
          artifact,
          approval: { identity: { role: "implementer" }, decision: "approved" },
        }),
        "project-manager or technical-lead",
      );
    });

    it("existing mode recommendation and correction contracts remain unchanged", () => {
      const recommendation = recommendMode({
        signals: {
          needsBusinessPlanning: false,
          needsSprintDecomposition: false,
          needsApprovals: false,
          needsTechnicalPlanning: false,
        },
      });
      assert.equal(recommendation.recommended, "fast");
      assert.equal(recommendation.requiresConfirmation, false);
      const reference = validateCorrectionReference({
        origin: "reviewer",
        ticketIds: ["T-101"],
        feedback: "Rework the render path: rows must sort newest first.",
        action: { description: "Revise the T-101 implementation per the reviewer feedback.", ticketId: "T-101" },
      });
      assert.equal(reference.origin, "reviewer");
      assert.deepEqual(reference.ticketIds, ["T-101"]);
    });

    it("existing manual handoff render/parse/validate behavior remains intact", () => {
      const handoff = validateAgentHandoff({
        from: "technical-lead",
        to: "implementer",
        objective: "Implement T-501 per the correction.",
        notes: "Sort newest first.",
        artifacts: ["T-501"],
      });
      const roundTripped = validateAgentHandoff(parseAgentHandoffText(renderAgentHandoff(handoff)));
      assert.equal(roundTripped.objective, handoff.objective);
      assert.equal(roundTripped.notes, handoff.notes);
    });
  });
});
