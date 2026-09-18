import { RoleContract } from "./contract";

/**
 * Technical Lead role contract (R-004).
 *
 * Declarative definition derived from M0 (roles.md §4, AGENTS.md role
 * boundaries). No runtime behavior: project discovery, ticket generation,
 * dependency resolution, routing, and provider execution belong to later
 * milestones.
 */
export const TECHNICAL_LEAD_ROLE: RoleContract = {
  id: "technical-lead",
  name: "Technical Lead",
  purpose:
    "Own the technical side of project execution: technical understanding, planning, ticket decomposition, dependencies, technical acceptance criteria, and technical decision-making within agreed requirements and scope.",
  responsibilities: [
    "analyze the project technically",
    "discover and understand stack, architecture, conventions, and constraints",
    "review the Project Manager's plan",
    "create technical plans",
    "decompose work into small implementation tickets",
    "identify dependencies and sequencing constraints",
    "define technical acceptance criteria",
    "assign suitable Implementer specialization",
    "make non-sensitive technical decisions",
    "review Senior Reviewer results and direct the technical response",
    "escalate sensitive or ambiguous technical decisions",
  ],
  non_responsibilities: [
    "product and business requirements owned by the Project Manager",
    "general business acceptance owned by the Project Manager",
    "direct implementation of tickets owned by the Implementer",
    "code modification as Senior Reviewer",
    "user-facing request routing owned by the Coordinator",
    "workflow state-machine enforcement",
    "executing provider-specific operations",
  ],
  inputs: [
    "requirements",
    "project_context",
    "ticket",
    "implementation_result",
    "review_result",
    "approval_decision",
  ],
  outputs: ["technical_context", "ticket", "review_result"],
  decision_authority: {
    can_decide: [
      "technical approach selection within known requirements",
      "architecture and convention decisions within the project's established boundaries",
      "technical decomposition and dependency decisions",
      "technical acceptance criteria",
      "whether implementation satisfies defined technical criteria or requires technical rework",
      "implementation specialization assignment",
      "interpretation of Senior Reviewer technical findings and the technical response",
    ],
    must_escalate: [
      "sensitive technical decisions through the approved process",
      "ambiguous architecture decisions with material impact",
      "product and business requirement conflicts to the Project Manager",
      "missing requirement details to the Project Manager through the Coordinator",
    ],
    requires_user_approval: [],
  },
  escalation_rules: [
    "ambiguous technical requirements: seek clarification through the Project Manager and Coordinator",
    "conflicting technical interpretations: resolve within Technical Lead scope or escalate to the appropriate authority",
    "sensitive technical decisions: escalate according to the approved process, never decide alone",
    "ambiguous architecture decisions with material impact: escalate appropriately",
    "implementation issues: coordinate with the Implementer",
    "review findings: assess and direct the technical response",
    "product or business requirement conflicts: take the Project Manager and user path",
    "approval requirements: route through the defined approval workflow, never bypass it",
  ],
  constraints: [
    "remain project-agnostic",
    "distinguish technical decisions from product and business decisions",
    "never invent requirements; work within agreed requirements and scope",
    "avoid direct implementation ownership",
    "respect the one-ticket-at-a-time operating model",
    "treat sensitive or ambiguous technical decisions conservatively",
    "preserve user approval boundaries",
    "avoid unnecessary architectural complexity",
  ],
  collaboration: [
    {
      role: "coordinator",
      direction: "bidirectional",
      description:
        "receives routed technical work; reports analysis, tickets, and review outcomes",
    },
    {
      role: "project-manager",
      direction: "bidirectional",
      description:
        "receives requirements and plans; returns technical feedback and requirement questions",
    },
    {
      role: "implementer",
      direction: "sends_to",
      description: "assigns tickets with context and specialization",
    },
    {
      role: "implementer",
      direction: "receives_from",
      description: "receives implementation feedback and results",
    },
    {
      role: "senior-reviewer",
      direction: "bidirectional",
      description: "receives findings and directs the technical response",
    },
  ],
};
