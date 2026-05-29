/**
 * v3.1.0 — TestForge handoff regression tests.
 *
 * One test per issue from the handoff report (Issues 1-5). These are
 * assertion-style rather than byte-exact snapshots — each issue has a
 * specific acceptance criterion that's checked directly.
 */

import { describe, it, expect } from "vitest";
import * as path from "path";
import { parseFeature } from "../../src/parser/gherkinParser";
import { matchStep } from "../../src/transformers/stepMatcher";
import { emitTestFile } from "../../src/emitters/facade";
import { detectHallucinatedLocators } from "../../src/llm/anthropicClient";
import type { PageObjectIR, StepBinding } from "../../src/types";

const FIXTURES = path.resolve(__dirname, "..", "fixtures", "v3.1.0");

const EMPTY_POM: PageObjectIR = {
  className: "Page",
  filePath: "pages/page.page.ts",
  fields: [],
  methods: [{ name: "goto", params: [], body: "", origin: "generated" }],
  exists: false,
};

const UI_POM: PageObjectIR = {
  className: "LoginPage",
  filePath: "pages/login.page.ts",
  fields: [
    {
      api: "getByRole",
      args: '"button", { name: "Submit" }',
      fieldName: "submitButton",
      source: { tag: "button" },
      confidence: "unique",
    },
  ],
  methods: [{ name: "goto", params: [], body: "", origin: "generated" }],
  exists: false,
};

async function render(
  fixtureName: string,
  pom: PageObjectIR,
  pageVar: string,
  opts: { stepHooks?: boolean; stepMarkers?: boolean } = {},
): Promise<string> {
  const feature = await parseFeature(
    path.join(FIXTURES, fixtureName, "input.feature"),
  );
  const scenarios = feature.scenarios.map((s) => ({
    name: s.name,
    bindings: s.steps.map<StepBinding>((step) => matchStep(step, pom, pageVar)),
    tags: s.tags,
  }));
  const out = emitTestFile({
    describeName: `Feature: ${feature.name}`,
    scenarios,
    pomImports: [],
    stepHooks: opts.stepHooks,
    stepMarkers: opts.stepMarkers,
  });
  return out.contents;
}

describe("v3.1.0 — TestForge handoff regression suite", () => {
  // ── Issue 1 ────────────────────────────────────────────────────────
  it("Issue 1 — prose visibility never emits toHaveURL or URL regex", async () => {
    const out = await render("01-visibility-prose", EMPTY_POM, "page");
    // Critical: NO toHaveURL anywhere.
    expect(out).not.toMatch(/toHaveURL/);
    expect(out).not.toMatch(/new RegExp/);
    // Should produce a TODO since no POM field matches the prose noun.
    expect(out).toMatch(/TODO/);
    expect(out).toMatch(/ambiguous visibility step/);
  });

  // ── Issue 2 ────────────────────────────────────────────────────────
  it("Issue 2 — :root locator is never emitted as a locator call", async () => {
    const out = await render("02-no-root-locator", EMPTY_POM, "page");
    // The thing we actually want to ban is the locator-call shape:
    //   locator(":root") / locator(':root') / page.locator(":root")
    // The substring `:root` may legitimately appear inside the feature
    // title / scenario name / step.text (which echo the fixture text
    // verbatim, and that text is ABOUT :root) — that's harmless.
    expect(out).not.toMatch(/locator\(\s*['"]:root['"]\s*\)/);
    expect(out).not.toMatch(/page\.locator\(\s*['"]:root['"]\s*\)/);
  });

  it("Issue 2 — detectHallucinatedLocators flags :root", () => {
    expect(
      detectHallucinatedLocators("await expect(locator(':root')).toBeVisible()"),
    ).toContain("locator(':root')");
    expect(
      detectHallucinatedLocators('await expect(locator(":root")).toBeVisible()'),
    ).toContain("locator(':root')");
    expect(
      detectHallucinatedLocators("await expect(page.locator('.foo')).toBeVisible()"),
    ).toEqual([]);
  });

  // ── Issue 3 ────────────────────────────────────────────────────────
  it("Issue 3 — every test() callback receives testInfo", async () => {
    const out = await render("03-test-info", EMPTY_POM, "page");
    // Match `async ({ page }, testInfo) => {` — fixtures, then testInfo.
    expect(out).toMatch(/async\s*\(\s*\{\s*page\s*\}\s*,\s*testInfo\s*\)\s*=>/);
    // The OLD signature without testInfo must not appear.
    expect(out).not.toMatch(/async\s*\(\s*\{\s*page\s*\}\s*\)\s*=>/);
  });

  // ── Issue 4 ────────────────────────────────────────────────────────
  it("Issue 4 — stepHooks: false emits NO __bdd2pwHooks references", async () => {
    const out = await render("04-step-hooks", UI_POM, "loginPage", {
      stepHooks: false,
    });
    expect(out).not.toContain("__bdd2pwHooks");
  });

  it("Issue 4 — stepHooks: true emits beforeStep + afterStep per step (v3.3.0 shape)", async () => {
    const out = await render("04-step-hooks", UI_POM, "loginPage", {
      stepHooks: true,
    });
    // At least one beforeStep + afterStep should appear per step (2 steps).
    const beforeStepCount = (out.match(/__bdd2pwHooks\?\.beforeStep/g) ?? []).length;
    const afterStepCount = (out.match(/__bdd2pwHooks\?\.afterStep/g) ?? []).length;
    expect(beforeStepCount).toBeGreaterThanOrEqual(2);
    expect(afterStepCount).toBeGreaterThanOrEqual(2);
    // Optional chain — consumers who don't set the hook see no behavior.
    expect(out).toMatch(/globalThis as any/);

    // v3.3.0 — both hooks now also receive a fixtures object.
    // The default fixture list is `{ page }` (matches pw-emit's
    // testEmitter default destructure).
    expect(out).toMatch(
      /beforeStep\?\.\(testInfo, "[^"]+", \{ page \}\)/,
    );
    // v3.3.0 — afterStep also receives a status arg before fixtures.
    expect(out).toMatch(
      /afterStep\?\.\(testInfo, "[^"]+", _bdd2pwStatus, \{ page \}\)/,
    );
    // v3.3.0 — body is wrapped in try/catch/finally so afterStep fires
    // on the failure path too.
    expect(out).toMatch(/let _bdd2pwStatus: "passed" \| "failed" = "passed";/);
    expect(out).toMatch(/try \{/);
    expect(out).toMatch(/catch \(_bdd2pwErr\) \{/);
    expect(out).toMatch(/_bdd2pwStatus = "failed";/);
    expect(out).toMatch(/throw _bdd2pwErr;/);
    expect(out).toMatch(/finally \{/);
  });

  // ── Issue 5 ────────────────────────────────────────────────────────
  it("Issue 5 — stepMarkers: false emits NO marker comments", async () => {
    const out = await render("05-step-markers", UI_POM, "loginPage", {
      stepMarkers: false,
    });
    expect(out).not.toContain("bdd2pw:step-open");
    expect(out).not.toContain("bdd2pw:step-close");
  });

  it("Issue 5 — stepMarkers: true brackets every test.step with id=NNNN", async () => {
    const out = await render("05-step-markers", UI_POM, "loginPage", {
      stepMarkers: true,
    });
    // 3 steps in the fixture, so 3 opens and 3 closes.
    const opens = out.match(/bdd2pw:step-open id="\d{4}"/g) ?? [];
    const closes = out.match(/bdd2pw:step-close id="\d{4}"/g) ?? [];
    expect(opens).toHaveLength(3);
    expect(closes).toHaveLength(3);
    // IDs are zero-padded 4 digits, sequential 0001 / 0002 / 0003.
    expect(out).toContain('bdd2pw:step-open id="0001"');
    expect(out).toContain('bdd2pw:step-open id="0002"');
    expect(out).toContain('bdd2pw:step-open id="0003"');
    expect(out).toContain('bdd2pw:step-close id="0001"');
    expect(out).toContain('bdd2pw:step-close id="0002"');
    expect(out).toContain('bdd2pw:step-close id="0003"');
  });

  // ── Cross-cutting ──────────────────────────────────────────────────
  it("looksLikeProse flags visibility-shaped slugs (URL-slug rules will decline)", async () => {
    const { looksLikeProse } = await import("../../src/transformers/stepNormalizer");
    expect(looksLikeProse("the user's name or profile indicator is visible in the UI")).toBe(true);
    expect(looksLikeProse("the welcome banner is shown")).toBe(true);
    expect(looksLikeProse("the success message appears")).toBe(true);
    expect(looksLikeProse("the panel is displayed")).toBe(true);
    // Valid URL slugs still pass through.
    expect(looksLikeProse("dashboard")).toBe(false);
    expect(looksLikeProse("user-profile")).toBe(false);
  });
});
