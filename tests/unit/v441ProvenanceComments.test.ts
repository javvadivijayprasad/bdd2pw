/**
 * v4.4.1 — in-spec `// @bdd2pw` provenance comment emission.
 *
 * Pins the contract documented in `docs/PROVENANCE_CONTRACT.md`:
 *
 *   provenance-comment = "// @bdd2pw" SP field *(SP field)
 *   lane=rule rule=<id> [pack=<name>]
 *   lane=llm provider=<p> model=<m> cached=<b> governance=<g>
 *   lane=todo
 *
 * The grammar is SemVer-covered. Field keys, order, and enum values
 * are stable across patch and minor releases.
 */

import { describe, expect, it } from "vitest";
import { emitTestFile } from "../../src/emitters/facade";
import type { StepBinding } from "../../src/types";

function build(bindings: StepBinding[], tags?: string[]) {
  return emitTestFile({
    describeName: "Provenance comment emission",
    scenarios: [{ name: "scenario", bindings, tags }],
    pomImports: [{ className: "LoginPage", fromPath: "../pages/login.page" }],
  });
}

const rulePomCall = { page: "loginPage", method: "usernameInput.fill", args: ['"x"'] };

describe("v4.4.1 — // @bdd2pw provenance comment grammar", () => {
  it("rule binding with ruleId + pack emits lane=rule rule=... pack=...", () => {
    const b: StepBinding = {
      step: { keyword: "When", text: "I enter my ssn" },
      pomCall: rulePomCall,
      provenance: { source: "rule", ruleId: "domain-03", pack: "banking" },
    };
    const out = build([b]).contents;
    expect(out).toContain("// @bdd2pw lane=rule rule=domain-03 pack=banking");
  });

  it("rule binding without pack omits the pack= field entirely", () => {
    const b: StepBinding = {
      step: { keyword: "When", text: "I click submit" },
      pomCall: rulePomCall,
      provenance: { source: "rule", ruleId: "rule-14" },
    };
    const out = build([b]).contents;
    expect(out).toContain("// @bdd2pw lane=rule rule=rule-14\n");
    expect(out).not.toContain("pack=");
  });

  it("rule binding without ruleId emits bare lane=rule (fallback)", () => {
    const b: StepBinding = {
      step: { keyword: "When", text: "some step" },
      pomCall: rulePomCall,
      provenance: { source: "rule" },
    };
    const out = build([b]).contents;
    expect(out).toContain("// @bdd2pw lane=rule\n");
  });

  it("legacy binding with no provenance emits bare lane=rule (fallback)", () => {
    const b: StepBinding = {
      step: { keyword: "When", text: "some step" },
      pomCall: rulePomCall,
    };
    const out = build([b]).contents;
    expect(out).toContain("// @bdd2pw lane=rule\n");
  });

  it("LLM binding emits lane=llm with provider/model/cached/governance in exact order", () => {
    const b: StepBinding = {
      step: { keyword: "When", text: "edge step" },
      pomCall: rulePomCall,
      provenance: {
        source: "llm",
        llm: {
          provider: "openai",
          model: "gpt-4o-mini",
          cached: false,
          governance: "sanitised",
          at: "2026-10-11T09:00:00.000Z",
        },
      },
    };
    const out = build([b]).contents;
    expect(out).toContain(
      "// @bdd2pw lane=llm provider=openai model=gpt-4o-mini cached=false governance=sanitised",
    );
  });

  it("LLM binding with cached=true + governance=skipped serialises correctly", () => {
    const b: StepBinding = {
      step: { keyword: "When", text: "edge step" },
      pomCall: rulePomCall,
      provenance: {
        source: "llm",
        llm: {
          provider: "gemini",
          model: "gemini-2.5-flash",
          cached: true,
          governance: "skipped",
          at: "2026-10-11T09:00:00.000Z",
        },
      },
    };
    const out = build([b]).contents;
    expect(out).toContain(
      "// @bdd2pw lane=llm provider=gemini model=gemini-2.5-flash cached=true governance=skipped",
    );
  });

  it("TODO step (no pomCall / assertion / customBody) emits lane=todo and nothing else", () => {
    const b: StepBinding = {
      step: { keyword: "Then", text: "I should see a confirmation" },
      warning: "no rule matched: ...",
    };
    const out = build([b]).contents;
    expect(out).toContain("// @bdd2pw lane=todo");
    // Lane=todo has no other fields.
    const line = out
      .split("\n")
      .find((l) => l.includes("@bdd2pw lane=todo"));
    expect(line?.trim()).toBe("// @bdd2pw lane=todo");
  });

  it("TODO lane wins over stale LLM provenance on the binding", () => {
    // Defensive: should not happen in practice, but if the LLM path
    // left a stale provenance block AND the binding has no runtime
    // body, the comment reports lane=todo.
    const b: StepBinding = {
      step: { keyword: "Then", text: "nothing to bind" },
      warning: "no rule matched",
      provenance: {
        source: "llm",
        llm: {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          cached: false,
          governance: "sanitised",
          at: "2026-10-11T09:00:00.000Z",
        },
      },
    };
    const out = build([b]).contents;
    const line = out
      .split("\n")
      .find((l) => l.includes("@bdd2pw lane"));
    expect(line?.trim()).toBe("// @bdd2pw lane=todo");
  });

  it("provenance comment is the FIRST comment inside each test.step body", () => {
    const b: StepBinding = {
      step: { keyword: "When", text: "I click something" },
      pomCall: rulePomCall,
      provenance: { source: "rule", ruleId: "rule-01" },
    };
    const out = build([b]).contents;
    // Match: test.step(...) line, open brace, newline, provenance comment.
    const re = /await test\.step\([^)]+\), async \(\) => \{\s*\/\/ @bdd2pw lane=rule rule=rule-01/;
    expect(re.test(out)).toBe(true);
  });
});

describe("v4.4.1 — opt-out", () => {
  it("provenanceComments: false suppresses all @bdd2pw lines", () => {
    const b: StepBinding = {
      step: { keyword: "When", text: "I click something" },
      pomCall: rulePomCall,
      provenance: { source: "rule", ruleId: "rule-01" },
    };
    const out = emitTestFile({
      describeName: "scenario",
      scenarios: [{ name: "s", bindings: [b] }],
      pomImports: [{ className: "LoginPage", fromPath: "../pages/login.page" }],
      provenanceComments: false,
    }).contents;
    expect(out).not.toContain("// @bdd2pw");
    // Binding statement is still emitted.
    expect(out).toContain("await loginPage.usernameInput.fill");
  });

  it("default (unspecified) emits provenance comments", () => {
    const b: StepBinding = {
      step: { keyword: "When", text: "I click something" },
      pomCall: rulePomCall,
      provenance: { source: "rule", ruleId: "rule-01" },
    };
    const out = emitTestFile({
      describeName: "scenario",
      scenarios: [{ name: "s", bindings: [b] }],
      pomImports: [{ className: "LoginPage", fromPath: "../pages/login.page" }],
    }).contents;
    expect(out).toContain("// @bdd2pw lane=rule rule=rule-01");
  });
});

describe("v4.4.1 — one comment per step", () => {
  it("multi-step scenario emits exactly one @bdd2pw line per step", () => {
    const bindings: StepBinding[] = [
      {
        step: { keyword: "Given", text: "first" },
        pomCall: rulePomCall,
        provenance: { source: "rule", ruleId: "rule-01" },
      },
      {
        step: { keyword: "When", text: "second" },
        pomCall: rulePomCall,
        provenance: {
          source: "llm",
          llm: {
            provider: "anthropic",
            model: "claude-sonnet-4-6",
            cached: false,
            governance: "sanitised",
            at: "2026-10-11T09:00:00.000Z",
          },
        },
      },
      {
        step: { keyword: "Then", text: "third" },
        warning: "no rule matched",
      },
    ];
    const out = build(bindings).contents;
    const occurrences = (out.match(/@bdd2pw lane=/g) || []).length;
    expect(occurrences).toBe(3);
    expect(out).toContain("lane=rule rule=rule-01");
    expect(out).toContain("lane=llm provider=anthropic");
    expect(out).toContain("lane=todo");
  });
});
