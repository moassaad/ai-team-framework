import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { detectProjectStack } from "../src/discovery/stack";
import { generateProjectAnalysis } from "../src/discovery/report";
import { DiscoveryFinding } from "../src/discovery/contract";
import { createFallbackProvider } from "../src/providers/fallback";
import { mapRequirementsToPlan } from "../src/planning/mapper";
import { generateTicketsFromPlan, PlanTicket } from "../src/planning/tickets";
import { AgentInvocation, AgentProvider } from "../src/providers/agent";
import { ExecutionResult, executionResultFromText } from "../src/providers/result";
import { executeImplementerTicket } from "../src/execution/implementer";
import { executeReviewerTicket } from "../src/execution/reviewer";
import { recommendTechnicalApproval } from "../src/execution/technical-approval";
import { recommendPmReview } from "../src/execution/pm-review";
import { reportCompletion } from "../src/execution/completion";
import { createLocalIssueProvider } from "../src/providers/local-issue";
import { IssueProvider, IssueReference } from "../src/providers/issue";
import { withTempProject, withTempProjectAsync } from "./helpers/temp-project";

// End-to-end sample-project test (T-008): one small deterministic
// fixture through the real framework lifecycle — discovery,
// specification, planning, tickets, implementer, reviewer, review
// recommendations, local issue tracking, and completion reporting.
// External effects use injected fakes and local providers only:
// no network, credentials, or installed tools.
const SAMPLE_FILES: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "sample-shop",
    version: "1.0.0",
    scripts: { build: "tsc -p .", test: "vitest run" },
    dependencies: { express: "4.18.2" },
    devDependencies: { vitest: "1.0.0", typescript: "5.0.0" },
  }),
  "package-lock.json": JSON.stringify({ name: "sample-shop", lockfileVersion: 3 }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
  "src/index.js": "const express = require('express');\nconst app = express();\nmodule.exports = app;\n",
  "test/shop.test.js": "const assert = require('node:assert');\nassert.equal(1 + 1, 2);\n",
  "README.md": "# Sample Shop\n\nA tiny catalog service.\n",
  ".gitignore": "node_modules/\n",
  ".editorconfig": "root = true\n",
  ".nvmrc": "20\n",
};

const REQUIREMENTS = "Add a catalog page listing products.";

function withSampleProject(fn: (root: string) => void): void {
  withTempProject(SAMPLE_FILES, fn);
}

function withSampleProjectAsync(fn: (root: string) => Promise<void>): Promise<void> {
  return withTempProjectAsync(SAMPLE_FILES, fn);
}

function finding(findings: readonly DiscoveryFinding[], category: string): DiscoveryFinding {
  const found = findings.find((entry) => entry.category === category);
  assert.ok(found, `missing finding for ${category}`);
  return found;
}

function fakeProvider(  calls: AgentInvocation[],
  text: string,
): AgentProvider<ExecutionResult> {
  return {
    name: "fake",
    execute: async (request: AgentInvocation): Promise<ExecutionResult> => {
      calls.push(request);
      return executionResultFromText(text);
    },
  };
}

async function completeIssue(
  issues: IssueProvider,
  ref: IssueReference,
): Promise<IssueReference> {
  assert.ok(issues.complete, "local provider exposes completion");
  return issues.complete(ref);
}

interface LifecycleSummary {
  ticketIds: string[];
  implementOutcome: string;
  implementNext: string | null;
  reviewOutcome: string;
  reviewNext: string | null;
  technicalTo: string;
  pmOutcome: string;
  completionEligible: boolean;
  completionNext: string | null;
  issueId: string;
}

async function runLifecycle(root: string): Promise<LifecycleSummary> {
  const report = generateProjectAnalysis({ root });
  assert.ok(report.findings.length > 0);

  const specification = createFallbackProvider();
  const artifact = await specification.generate({
    requirements: REQUIREMENTS,
    project_root: root,
    artifact: "specification",
  });
  const plan = mapRequirementsToPlan({ requirements: REQUIREMENTS, artifact });
  const tickets = generateTicketsFromPlan(plan);
  assert.ok(tickets.length > 0);
  const ticket: PlanTicket = tickets[0]!;

  const issues = createLocalIssueProvider();
  const issueRef = await issues.create({
    title: ticket.title,
    description: ticket.description,
    requirements: ticket.requirements,
  });

  const implementCalls: AgentInvocation[] = [];
  const implemented = await executeImplementerTicket({
    ticket: {
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      requirements: ticket.requirements,
    },
    specialty: "backend",
    project_root: root,
    provider: fakeProvider(implementCalls, "Catalog page implemented; vitest passes."),
    timeout_ms: 1000,
  });
  assert.equal(implemented.outcome, "completed");
  assert.equal(implementCalls.length, 1);
  if (implemented.outcome !== "completed") {
    throw new Error("implementer must complete in the sample flow");
  }

  const reviewCalls: AgentInvocation[] = [];
  const reviewed = await executeReviewerTicket({
    ticket: {
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      requirements: ticket.requirements,
    },
    implementation_result: implemented.result.text,
    project_root: root,
    provider: fakeProvider(reviewCalls, "No blocking issues; validation output present."),
    timeout_ms: 1000,
  });
  assert.equal(reviewed.outcome, "completed");
  if (reviewed.outcome !== "completed") {
    throw new Error("reviewer must complete in the sample flow");
  }

  const technical = recommendTechnicalApproval({
    ticket_id: ticket.id,
    from_state: "implementation_review",
    review_clean: true,
    validation_present: true,
    report: reviewed.report,
  });
  const pm = recommendPmReview({
    ticket_id: ticket.id,
    from_state: "pm_review",
    requirements_accepted: true,
    reason: "Catalog page matches the accepted requirements.",
    report: reviewed.report,
  });
  assert.equal(pm.outcome, "accepted");

  const completion = reportCompletion({
    ticket_id: ticket.id,
    config: { version: 1 },
    from_state: "needs_user_input",
    approval_granted: true,
    review_clean: true,
    validation_present: true,
  });

  const closed = await completeIssue(issues, issueRef);
  assert.deepEqual(closed, issueRef);

  return {
    ticketIds: tickets.map((entry) => entry.id),
    implementOutcome: implemented.outcome,
    implementNext: implemented.next_state,
    reviewOutcome: reviewed.outcome,
    reviewNext: reviewed.next_state,
    technicalTo: technical.to_state,
    pmOutcome: pm.outcome,
    completionEligible: completion.eligible,
    completionNext: completion.next_state,
    issueId: issueRef.id,
  };
}

function snapshot(root: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        entries[path.relative(root, full)] = fs.readFileSync(full, "utf8");
      }
    }
  };
  walk(root);
  return entries;
}

describe("end-to-end sample project", () => {
  it("discovers the sample project stack and conventions", () => {
    withSampleProject((root) => {
      const findings = detectProjectStack({ root });
      assert.equal(finding(findings, "languages").value, "javascript, typescript");
      assert.equal(finding(findings, "backend_framework").value, "express 4.18.2");
      assert.equal(finding(findings, "frontend_framework").status, "not_detected");
      assert.equal(finding(findings, "database").status, "not_detected");

      const report = generateProjectAnalysis({ root });
      assert.equal(report.meta.format, "ai-team-discovery-report");
      assert.equal(finding(report.findings, "package_managers").value, "npm");
      assert.equal(finding(report.findings, "build_tools").value, "tsc");
      assert.equal(finding(report.findings, "testing_tools").value, "vitest");
      assert.equal(finding(report.findings, "naming_conventions").value, "editorconfig");
      assert.ok(
        (finding(report.findings, "documentation").value ?? "").includes("readme"),
      );
      assert.equal(finding(report.findings, "git").status, "detected");
      assert.equal(finding(report.findings, "architecture").status, "unknown");
      assert.ok(
        (finding(report.findings, "technical_constraints").value ?? "").includes("node"),
      );
    });
  });

  it("plans the sample requirements into consumable tickets", async () => {
    await withSampleProjectAsync(async (root) => {
      const specification = createFallbackProvider();
      const artifact = await specification.generate({
        requirements: REQUIREMENTS,
        project_root: root,
        artifact: "specification",
      });
      assert.equal(artifact.artifact, "specification");
      assert.ok(artifact.content.includes(REQUIREMENTS));

      const plan = mapRequirementsToPlan({ requirements: REQUIREMENTS, artifact });
      assert.equal(plan.requirements, REQUIREMENTS);
      assert.equal(plan.basis, "specification");

      const tickets = generateTicketsFromPlan(plan);
      assert.deepEqual(
        tickets.map((ticket) => ticket.id),
        ["T-001", "T-002"],
      );
      for (const ticket of tickets) {
        assert.equal(ticket.requirements, REQUIREMENTS);
        assert.ok(ticket.title.length > 0 && ticket.description.length > 0);
      }
    });
  });

  it("executes implementer and reviewer flows through injected providers", async () => {
    await withSampleProjectAsync(async (root) => {
      const implementCalls: AgentInvocation[] = [];
      const implemented = await executeImplementerTicket({
        ticket: {
          id: "T-001",
          title: "Specification",
          description: "Catalog work.",
          requirements: REQUIREMENTS,
        },
        specialty: "backend",
        project_root: root,
        provider: fakeProvider(implementCalls, "Catalog page implemented; vitest passes."),
        timeout_ms: 1000,
      });
      assert.equal(implemented.outcome, "completed");
      assert.equal(implementCalls.length, 1);
      assert.equal(implementCalls[0]?.project_root, root);
      assert.ok((implementCalls[0]?.prompt ?? "").includes("T-001"));
      if (implemented.outcome !== "completed") {
        throw new Error("implementer must complete");
      }
      assert.equal(implemented.next_state, "implementation_review");

      const reviewCalls: AgentInvocation[] = [];
      const reviewed = await executeReviewerTicket({
        ticket: {
          id: "T-001",
          title: "Specification",
          description: "Catalog work.",
          requirements: REQUIREMENTS,
        },
        implementation_result: implemented.result.text,
        project_root: root,
        provider: fakeProvider(reviewCalls, "No blocking issues found."),
        timeout_ms: 1000,
      });
      assert.equal(reviewed.outcome, "completed");
      if (reviewed.outcome !== "completed") {
        throw new Error("reviewer must complete");
      }
      assert.equal(reviewed.next_state, null);
      assert.equal(reviewed.report, "No blocking issues found.");
      assert.equal(reviewCalls.length, 1);
    });
  });

  it("recommends technical and PM acceptance without granting closure", async () => {
    await withSampleProjectAsync(async (root) => {
      const summary = await runLifecycle(root);
      assert.equal(summary.technicalTo, "technical_approval");
      assert.equal(summary.pmOutcome, "accepted");
      assert.equal(summary.completionEligible, true);
      assert.equal(summary.completionNext, "closed");

      const premature = reportCompletion({
        ticket_id: "T-001",
        config: { version: 1 },
        from_state: "pm_review",
        approval_granted: true,
        review_clean: true,
        validation_present: true,
      });
      assert.equal(premature.eligible, false);
      assert.deepEqual([...premature.missing], ["state"]);
    });
  });

  it("tracks the ticket through the local issue provider", async () => {
    await withSampleProjectAsync(async (root) => {
      const summary = await runLifecycle(root);
      assert.deepEqual(summary.ticketIds, ["T-001", "T-002"]);
      assert.equal(summary.issueId, "local-1");
    });
  });

  it("leaves the sample project unmodified and runs deterministically", async () => {
    let first: LifecycleSummary | undefined;
    let second: LifecycleSummary | undefined;
    await withSampleProjectAsync(async (root) => {
      const before = snapshot(root);
      first = await runLifecycle(root);
      assert.deepEqual(snapshot(root), before);
    });
    await withSampleProjectAsync(async (root) => {
      second = await runLifecycle(root);
    });
    assert.deepEqual(first, second);
  });
});
