/**
 * End-to-end regression test for the cms-login fixture (selenium14 dialect).
 *
 * Locks the third-person + compound-input coverage that landed in Phase 1c.
 * If this test ever fails after a rule change, one of these regressed:
 *   - subject-agnostic step matching ("user" / "User" / no subject)
 *   - rule 1 with a trailing quoted URL after bare text
 *   - the compound input rule (2c) emitting a customBody with N .fill() lines
 *   - rule 11 accepting "is redirected"
 *
 * Uses the pinned snapshot file (no network) so CI doesn't depend on
 * cms.anhtester.com being reachable.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { scaffold } from "../../src";

const fixtureDir = path.resolve(__dirname, "..", "..", "examples", "cms-login");
const featurePath = path.join(fixtureDir, "login.feature");
const snapshotPath = path.join(fixtureDir, "snapshot.json");

describe("cms-login end-to-end (third-person dialect + compound input)", () => {
  let outDir: string;
  let pomContents: string;
  let specContents: string;
  let result: Awaited<ReturnType<typeof scaffold>>;

  beforeAll(async () => {
    outDir = path.join(os.tmpdir(), `bdd2pw-cms-${Date.now()}`);
    result = await scaffold({
      feature: featurePath,
      url: "https://cms.anhtester.com/login",
      page: "LoginPage",
      repo: outDir,
      noValidate: true,
      // @ts-expect-error — Phase 1a snapshot bypass
      snapshotFile: snapshotPath,
    });
    pomContents = await fs.readFile(path.join(outDir, "pages", "login.page.ts"), "utf8");
    specContents = await fs.readFile(path.join(outDir, "tests", "login.spec.ts"), "utf8");
  });

  afterAll(async () => {
    await fs.remove(outDir).catch(() => undefined);
  });

  describe("scaffold result", () => {
    it("emits zero warnings (every step matched a rule)", () => {
      const warnings = result.reviewItems.filter((i) => i.severity === "warn");
      expect(warnings).toEqual([]);
    });

    it("zero tsc errors", () => {
      expect(result.tscErrorCount).toBe(0);
    });
  });

  describe("emitted pages/login.page.ts", () => {
    it("declares LoginPage class", () => {
      expect(pomContents).toContain("export class LoginPage {");
    });

    it("contains the three fields the steps reference", () => {
      expect(pomContents).toContain("readonly emailInput: Locator;");
      expect(pomContents).toContain("readonly passwordInput: Locator;");
      expect(pomContents).toContain("readonly loginButton: Locator;");
    });

    it("synthesises goto() that navigates to the URL", () => {
      expect(pomContents).toContain("async goto(): Promise<void> {");
      expect(pomContents).toContain(
        'await this.page.goto("https://cms.anhtester.com/login");',
      );
    });
  });

  describe("emitted tests/login.spec.ts", () => {
    it("describe uses the feature name", () => {
      expect(specContents).toContain('test.describe("Login Test CMS"');
    });

    it("rule 1 (third-person + bare text + quoted URL) → goto()", () => {
      // Background contains: Given User navigate to Login Page for Admin "URL"
      const beforeEachIdx = specContents.indexOf("test.beforeEach");
      const slice = specContents.slice(beforeEachIdx, beforeEachIdx + 400);
      expect(slice).toContain("await loginPage.goto();");
    });

    it("rule 2c (compound input) emits TWO .fill() lines from ONE Gherkin step", () => {
      expect(specContents).toContain(
        'await loginPage.emailInput.fill("admin@example.com");',
      );
      expect(specContents).toContain('await loginPage.passwordInput.fill("123456");');
    });

    it("rule 3 (no subject prefix) → loginButton.click()", () => {
      expect(specContents).toContain("await loginPage.loginButton.click();");
    });

    it("rule 11 (third-person 'is redirected') → toHaveURL", () => {
      expect(specContents).toMatch(
        /await expect\(loginPage\.page\)\.toHaveURL\(new RegExp\("Dashboard"\)\);/,
      );
    });

    it("preserves the original Gherkin text as the test.step label", () => {
      // v2.1.0 — bindings are wrapped in `await test.step("<keyword> <text>", ...)`
      // instead of leading `// keyword text` comments. The Gherkin text still
      // travels with the rendered code, just as the step label.
      expect(specContents).toContain(
        'await test.step("When user enter email \\"admin@example.com\\" password \\"123456\\""',
      );
      expect(specContents).toContain('await test.step("And click Login button"');
    });

    it("emits exactly 1 test() block (1 scenario, no outline)", () => {
      const matches = specContents.match(/^\s*test\(/gm);
      expect(matches?.length ?? 0).toBe(1);
    });
  });
});
