# Open Decisions Requiring User Input

These decisions cannot be resolved from the approved plan without guessing
(plan §2.5, AGENTS.md "No Guessing"). They are recorded here as the single
source of truth for pending decisions. None of them blocks acceptance of the M0
specification documents themselves; they block the dependent later work.

When the user resolves an item, update this file and the affected specification,
then record the decision per plan §21 (change control).

---

## OQ-1 — Framework implementation stack

- Question: Should the framework itself be implemented in TypeScript on Node.js
  for 0.1.0?
- Evidence: plan §13 shows `package.json`, `tsconfig.json`, `src/cli.ts` and an
  npm-style build/test/lint milestone (F-002/F-003), but labels the structure
  "an implementation baseline, not a license" and AGENTS.md forbids choosing a
  framework without evidence.
- Blocks: F-001..F-006 (repository foundation), and all implementation
  milestones (the framework's own language is not the same as target-project
  language, which stays project-agnostic).
- Recommended default (not a decision): TypeScript/Node.js, consistent with
  plan §13.

## OQ-2 — User-facing language support in 0.1.0

- Question: Must 0.1.0 resolve natural-language role prompts (and user replies
  such as approvals) in Arabic, in English only, or bilingually?
- Evidence: plan §2.4 and §4.3 use Arabic user examples (e.g. `وافق`,
  `تحدث مع Technical Lead`), but all documentation and the master agent prompt
  are English, and no requirement statement exists.
- Blocks: CLI-004 (prompt-based role selection); PM plan/report templates;
  REL documentation language scope. It does not block the role IDs, which are
  language-independent.
- Recommended default (not a decision): English-only keyword resolution for
  0.1.0, with a documented path to add more languages against the same role IDs.

## OQ-3 — Semantics of `approval.after: sprint`

- Question: What is a "sprint" in this framework, and how does a sprint-level
  approval gate batch and close tickets?
- Evidence: plan §6.3 lists `after: sprint` as a supported value, but the plan
  defines no sprint lifecycle, no batching rule, and no sprint state.
- Blocks: W-003/W-005 automatic/sprint approval work, and any use of the
  non-default `after: sprint` mode. It does not block 0.1.0 default behavior
  (`after: ticket`).
- Recommended default (not a decision): keep `after: ticket` as the only
  exercised mode in 0.1.0 and define sprint semantics in a later plan change.

---

## Resolved (for traceability)

- License: MIT (explicit user decision, recorded during M1).
- Default role when none is selected: Coordinator (plan §4.1).
- Default approval configuration: `manual / ticket / always` (plan §6.3).
- Slash commands are optional and host-dependent; a documented equivalent is
  provided when unsupported (plan §4.4).
- Optional providers are disabled by default and never core (plan §9, §2.2).
- Parallel execution is out of scope for 0.1.0 (plan §2.3).