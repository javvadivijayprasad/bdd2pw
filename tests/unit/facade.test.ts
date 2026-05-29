/**
 * Unit tests for `src/emitters/facade.ts` — focused on the
 * binding-to-TS-body rendering layer.
 *
 * The internal `bindingsToBody` function isn't exported, so we drive it
 * through the public `emitTestFile` entry point. Each test sets up
 * exactly one scenario with one binding and asserts on the rendered TS
 * for that binding.
 */

import { describe, it, expect } from "vitest";
import {
  emitTestFile,
  sanitizeLocatorReferences,
} from "../../src/emitters/facade";
import type { StepBinding } from "../../src/types";

function renderOneBinding(binding: StepBinding): string {
  const out = emitTestFile({
    describeName: "test",
    scenarios: [{ name: "scenario", bindings: [binding] }],
    pomImports: [],
  });
  return out.contents;
}

describe("bindingsToBody — assertion rendering", () => {
  it("v2.2.4 — substitutes `page` when locator is empty (BUG-7)", () => {
    // Exact reproduction of BUG-7: the LLM emits `locator: ""` for a
    // toHaveURL assertion. The renderer must produce
    // `expect(page).toHaveURL(...)` — never `expect().toHaveURL(...)`.
    const out = renderOneBinding({
      step: { keyword: "Then", text: "I am on the dashboard" },
      assertion: {
        locator: "",
        matcher: "toHaveURL",
        expected: 'new RegExp("/dashboard")',
      },
    });
    expect(out).toContain(
      'await expect(page).toHaveURL(new RegExp("/dashboard"));',
    );
    expect(out).not.toMatch(/await expect\(\)/);
  });

  it("v2.2.4 — substitutes `page` for whitespace-only locator", () => {
    const out = renderOneBinding({
      step: { keyword: "Then", text: "title check" },
      assertion: {
        locator: "   ",
        matcher: "toHaveTitle",
        expected: '"Dashboard"',
      },
    });
    expect(out).toContain('await expect(page).toHaveTitle("Dashboard");');
    expect(out).not.toMatch(/await expect\(\)/);
  });

  it("v2.2.4 — substitutes `page` for not.toHaveURL with empty locator", () => {
    const out = renderOneBinding({
      step: { keyword: "Then", text: "no longer on login" },
      assertion: {
        locator: "",
        matcher: "not.toHaveURL",
        expected: 'new RegExp("/login")',
      },
    });
    expect(out).toContain(
      'await expect(page).not.toHaveURL(new RegExp("/login"));',
    );
    expect(out).not.toMatch(/await expect\(\)/);
  });

  it("v2.2.4 — substitutes `page` for empty locator on non-page matchers too", () => {
    // `expect()` is never a legal call — even if the matcher is something
    // weird like toBeVisible (which wouldn't make sense on a page), we'd
    // rather render against page and have it fail at matcher-time with a
    // clear "expected locator" error than emit broken TS.
    const out = renderOneBinding({
      step: { keyword: "Then", text: "something" },
      assertion: { locator: "", matcher: "toBeVisible" },
    });
    expect(out).toContain("await expect(page).toBeVisible();");
    expect(out).not.toMatch(/await expect\(\)/);
  });

  it("preserves non-empty locators unchanged", () => {
    // Regression guard for the new normalisation logic.
    const out = renderOneBinding({
      step: { keyword: "Then", text: "see username field" },
      assertion: {
        locator: "loginPage.usernameInput",
        matcher: "toBeVisible",
      },
    });
    expect(out).toContain(
      "await expect(loginPage.usernameInput).toBeVisible();",
    );
  });
});

describe("sanitizeLocatorReferences (v2.2.5 — BUG-9 safety net)", () => {
  it("prefixes digit-leading member access with underscore", () => {
    // Exact reproduction: cached LLM binding from v2.2.4 references the
    // unsanitized POM field `0Of0`. Without rewriting, the .spec.ts
    // refuses to parse with "Identifier directly after number".
    expect(sanitizeLocatorReferences("r0c934ddf001.0Of0")).toBe(
      "r0c934ddf001._0Of0",
    );
    expect(sanitizeLocatorReferences("loginPage.1500Of0")).toBe(
      "loginPage._1500Of0",
    );
  });

  it("strips commas from digit-leading segments (1,500 case)", () => {
    expect(sanitizeLocatorReferences("page.0,0Of0")).toBe("page._0_0Of0");
  });

  it("rewrites bracket-property access too", () => {
    expect(sanitizeLocatorReferences("foo[0Of0]")).toBe("foo[_0Of0]");
  });

  it("leaves valid identifiers unchanged", () => {
    expect(sanitizeLocatorReferences("loginPage.usernameInput")).toBe(
      "loginPage.usernameInput",
    );
    expect(sanitizeLocatorReferences("page.getByRole('button')")).toBe(
      "page.getByRole('button')",
    );
  });

  it("handles empty/null safely", () => {
    expect(sanitizeLocatorReferences("")).toBe("");
  });
});

describe("bindingsToBody — BUG-9 safety net through render", () => {
  it("v2.2.5 — rewrites digit-leading POM field references in cached assertions", () => {
    // Drives the BUG-9 reproduction end-to-end through the public
    // renderer. A binding with `r0c934ddf001.0Of0` must emit valid TS.
    const out = renderOneBinding({
      step: {
        keyword: "And",
        text: "Zero product cards are visible in the results area",
      },
      assertion: {
        locator: "r0c934ddf001.0Of0",
        matcher: "toBeVisible",
      },
    });
    expect(out).toContain("await expect(r0c934ddf001._0Of0).toBeVisible();");
    // And the broken form must NOT appear.
    expect(out).not.toMatch(/\.0Of0\b/);
  });

  it("v2.2.5 — rewrites digit-leading references in pomCall args + method", () => {
    const out = renderOneBinding({
      step: { keyword: "When", text: "I click the pagination cell" },
      pomCall: {
        page: "page",
        method: "click",
        args: ["loginPage.0Of0"],
      },
    });
    expect(out).toContain("await page.click(loginPage._0Of0);");
  });

  it("v2.2.5 — rewrites digit-leading references in customBody", () => {
    const out = renderOneBinding({
      step: { keyword: "When", text: "complex step" },
      customBody:
        "await loginPage.0Of0.click();\nawait expect(loginPage.0Of0).toBeVisible();",
    });
    expect(out).toContain("await loginPage._0Of0.click();");
    expect(out).toContain("await expect(loginPage._0Of0).toBeVisible();");
  });
});
