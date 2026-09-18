import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSlashCommand } from "../src/roles/slash";

// Slash-command tests only: exact documented forms from the spec.
// No fuzzy matching, inference, aliases beyond the documented set,
// or host/OpenCode behavior.
describe("slash command resolution", () => {
  it("resolves the five documented slash commands", () => {
    const cases: Array<[string, string]> = [
      ["/coordinator", "coordinator"],
      ["/project-manager", "project-manager"],
      ["/technical-lead", "technical-lead"],
      ["/implementer", "implementer"],
      ["/senior-reviewer", "senior-reviewer"],
    ];
    for (const [input, role] of cases) {
      assert.deepEqual(resolveSlashCommand(input), { role });
    }
  });

  it("resolves the documented implementer specialty form", () => {
    assert.deepEqual(resolveSlashCommand("/implementer backend"), {
      role: "implementer",
      specialty: "backend",
    });
    assert.deepEqual(resolveSlashCommand("/implementer testing")?.specialty, "testing");
  });

  it("rejects undocumented, fuzzy, and malformed forms", () => {
    for (const input of [
      "/pm",
      "/tl",
      "/sr",
      "/reviewer",
      "/coordinator ",
      "//technical-lead",
      "/technical lead extra words",
      "/tech",
      "/reviewer-now",
      "/Technical-Lead",
      "/implementer unknown",
      "/implementer backend extra",
      "technical-lead",
      "",
    ]) {
      assert.equal(resolveSlashCommand(input), undefined, `input: ${JSON.stringify(input)}`);
    }
  });

  it("rejects specialty forms for non-Implementer roles", () => {
    for (const input of [
      "/coordinator backend",
      "/project-manager backend",
      "/technical-lead backend",
      "/senior-reviewer backend",
    ]) {
      assert.equal(resolveSlashCommand(input), undefined, `input: ${input}`);
    }
  });

  it("reuses existing value normalization without new matching rules", () => {
    assert.deepEqual(resolveSlashCommand("/implementer Backend"), {
      role: "implementer",
      specialty: "backend",
    });
  });

  it("is deterministic", () => {
    assert.deepEqual(resolveSlashCommand("/technical-lead"), resolveSlashCommand("/technical-lead"));
  });
});
