/**
 * v3.7.1 — regression tests for the two TestForge-reported issues.
 *
 * #R1 PascalCase className: a caller passing `page: "repro"`
 *      (lowercase) used to produce `const repro = new repro(page);`
 *      which dies with `Cannot access 'repro' before initialization`
 *      (the local variable shadows the class import).
 *
 * #R2 test.step wrapping: the wrapper is supposed to surround every
 *      Gherkin step body so the bdd2pwHooks.afterStep callback fires.
 *      A future emitter refactor that accidentally drops the wrapper
 *      would silently break every step-instrumentation pipeline.
 *
 * Both are exercised through the public `emitTestFile` entry point so
 * they catch regressions wherever in the emitter chain they might
 * appear.
 */

import { describe, it, expect } from "vitest";
import { emitTestFile } from "../../src/emitters/facade";
import { pascalCase } from "../../src/utils/naming";
import type { PageObjectIR, StepBinding } from "../../src/types";

const EMPTY_POM: PageObjectIR = {
  className: "Repro",
  filePath: "pages/repro.page.ts",
  fields: [],
  methods: [{ name: "goto", params: [], body: "", origin: "generated" }],
  exists: false,
};

function reproBinding(): StepBinding {
  return {
    step: { keyword: "Given", text: "I am on the login page" },
    pomCall: { page: "reproPage", method: "goto", args: [] },
  };
}

describe("v3.7.1 — TestForge regression report (2026-05-22)", () => {
  // ── Regression #1 ──────────────────────────────────────────────────
  it("#R1 — pascalCase normalises lowercase className inputs", () => {
    // Direct pascalCase check — the normalisation is the foundation
    // of the fix. The full pipeline runs scaffold().opts.page through
    // pascalCase() up front; we verify the helper's behavior here.
    expect(pascalCase("repro")).toBe("Repro");
    expect(pascalCase("login_page")).toBe("LoginPage");
    expect(pascalCase("LoginPage")).toBe("LoginPage"); // idempotent
    expect(pascalCase("login-page")).toBe("LoginPage");
    expect(pascalCase("loginPage")).toBe("LoginPage");
  });

  it("#R1 — emitted spec uses PascalCase class for both import and `new`", () => {
    const out = emitTestFile({
      describeName: "Repro",
      scenarios: [
        {
          name: "Repro",
          bindings: [reproBinding()],
        },
      ],
      pomImports: [
        { className: "Repro", fromPath: "../pages/repro.page" },
      ],
    });
    // Import uses PascalCase.
    expect(out.contents).toMatch(/import\s*\{\s*Repro\s*\}/);
    // `new Repro(page)` uses PascalCase.
    expect(out.contents).toMatch(/new\s+Repro\s*\(\s*page\s*\)/);
    // The pageVar (camelCase) is `repro` — must NOT collide with the
    // class. Specifically: there must NOT be `new repro(page)` (lowercase).
    expect(out.contents).not.toMatch(/new\s+repro\s*\(/);
  });

  // ── Regression #2 ──────────────────────────────────────────────────
  it("#R2 — every Gherkin step is wrapped in `await test.step(...)`", () => {
    const bindings: StepBinding[] = [
      {
        step: { keyword: "Given", text: "I am on the login page" },
        pomCall: { page: "loginPage", method: "goto", args: [] },
      },
      {
        step: { keyword: "When", text: "I click the submit button" },
        pomCall: { page: "loginPage", method: "submitButton.click", args: [] },
      },
      {
        step: { keyword: "Then", text: "I see the dashboard" },
        assertion: { locator: "loginPage.heading", matcher: "toBeVisible" },
      },
    ];
    const out = emitTestFile({
      describeName: "Multi-step",
      scenarios: [{ name: "Many", bindings }],
      pomImports: [],
    });
    const stepCount = (out.contents.match(/await test\.step\(/g) ?? []).length;
    expect(stepCount).toBe(3);
    // Every step's title text should appear inside its wrapper —
    // confirm the labelLit matches the step text shape.
    expect(out.contents).toContain('"Given I am on the login page"');
    expect(out.contents).toContain('"When I click the submit button"');
    expect(out.contents).toContain('"Then I see the dashboard"');
  });

  // ── Other observation from the regression report ───────────────────
  it("#R0 — testInfo is part of the test signature (v3.1.0 contract preserved)", () => {
    const out = emitTestFile({
      describeName: "TestInfo check",
      scenarios: [
        {
          name: "Sanity",
          bindings: [reproBinding()],
        },
      ],
      pomImports: [],
    });
    // v3.1.0 made testInfo unconditional. TestForge's report flagged
    // that v3.7.0 was missing it — verify it's still there.
    expect(out.contents).toMatch(
      /async\s*\(\s*\{\s*page\s*\}\s*,\s*testInfo\s*\)\s*=>/,
    );
  });
});
