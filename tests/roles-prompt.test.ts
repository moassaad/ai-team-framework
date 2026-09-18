import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolvePromptRole } from "../src/roles/prompt";

// Prompt-mapping tests only: fixed English keyword baseline from
// roles.md §7. No inference, scoring, translations, or LLM behavior.
describe("prompt role resolution", () => {
  it("maps every approved keyword to its canonical role", () => {
    const cases: Array<[string, string]> = [
      ["talk to the coordinator", "coordinator"],
      ["Act as the Project Manager and create a feature plan.", "project-manager"],
      ["ask pm about scope", "project-manager"],
      ["analyze this as the technical lead", "technical-lead"],
      ["talk to the tech lead", "technical-lead"],
      ["assign this to the implementer", "implementer"],
      ["the senior reviewer found issues", "senior-reviewer"],
      ["send it to the reviewer", "senior-reviewer"],
    ];
    for (const [prompt, role] of cases) {
      assert.equal(resolvePromptRole(prompt), role, `prompt: ${prompt}`);
    }
  });

  it("matches case-insensitively with surrounding whitespace", () => {
    assert.equal(resolvePromptRole("TECH LEAD"), "technical-lead");
    assert.equal(resolvePromptRole("  pm  "), "project-manager");
  });

  it("leaves conflicting multi-role prompts unresolved", () => {
    assert.equal(resolvePromptRole("ask the project manager and tech lead"), undefined);
    assert.equal(resolvePromptRole("coordinator and pm sync up"), undefined);
  });

  it("leaves unknown and natural-language input unresolved", () => {
    for (const prompt of [
      "",
      "hello world",
      "handle the backend task",
      "please review my code",
      "I need someone for architecture",
      "the backend person",
      "review",
      "camp",
      "backend",
    ]) {
      assert.equal(resolvePromptRole(prompt), undefined, `prompt: ${prompt}`);
    }
  });

  it("resolves the role without selecting a specialty", () => {
    assert.equal(resolvePromptRole("implementer backend"), "implementer");
  });

  it("is deterministic", () => {
    assert.equal(
      resolvePromptRole("talk to the tech lead"),
      resolvePromptRole("talk to the tech lead"),
    );
  });
});
