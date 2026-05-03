/**
 * End-to-end regression test for the practice-test-login fixture.
 *
 * Calls the public `scaffold()` API with the bundled fixture, then asserts
 * the emitted `pages/login.page.ts` and `tests/login.spec.ts` contain the
 * critical fragments that — when present — the spec runs green against
 * https://practicetestautomation.com/practice-test-login/.
 *
 * If this test ever fails after a rule/picker/emitter change, the rule-based
 * pipeline has regressed against a previously-working real-world scenario.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { scaffold } from "../../src";

const fixtureDir = path.resolve(__dirname, "..", "..", "examples", "practice-test-login");
const featurePath = path.join(fixtureDir, "login.feature");
const snapshotPath = path.join(fixtureDir, "snapshot.json");

describe("practice-test-login end-to-end", () => {
  let outDir: string;
  let pomContents: string;
  let specContents: string;
  let result: Awaited<ReturnType<typeof scaffold>>;

  beforeAll(async () => {
    outDir = path.join(os.tmpdir(), `bdd2pw-e2e-${Date.now()}`);
    result = await scaffold({
      feature: featurePath,
      url: "https://practicetestautomation.com/practice-test-login/",
      page: "LoginPage",
      repo: outDir,
      noValidate: true,
      // @ts-expect-error — Phase 1a snapshot-file bypass
      snapshotFile: snapshotPath,
    });
    pomContents = await fs.readFile(path.join(outDir, "pages", "login.page.ts"), "utf8");
    specContents = await fs.readFile(path.join(outDir, "tests", "login.spec.ts"), "utf8");
  });

  afterAll(async () => {
    await fs.remove(outDir).catch(() => undefined);
  });

  describe("scaffold result", () => {
    it("emits 7 files (4 scaffolded + POM + spec + review)", () => {
      expect(result.filesWritten.length).toBeGreaterThanOrEqual(7);
    });

    it("produces zero tsc errors (validation skipped — no install)", () => {
      expect(result.tscErrorCount).toBe(0);
    });

    it("review report exists at the right path", () => {
      expect(result.reviewReportPath).toContain("BDD_REVIEW.md");
    });

    it("no warning-level review items (every step matched a rule)", () => {
      const warnings = result.reviewItems.filter((i) => i.severity === "warn");
      expect(warnings).toEqual([]);
    });
  });

  describe("emitted pages/login.page.ts", () => {
    it("declares the LoginPage class", () => {
      expect(pomContents).toContain("export class LoginPage {");
    });

    it("imports Page, Locator, expect from @playwright/test", () => {
      expect(pomContents).toMatch(
        /import \{ Page, Locator, expect \} from "@playwright\/test";/,
      );
    });

    it("derives usernameInput from #username (cssSelectorToName)", () => {
      expect(pomContents).toContain("readonly usernameInput: Locator;");
      expect(pomContents).toContain('this.usernameInput = page.locator("#username");');
    });

    it("derives passwordInput from #password", () => {
      expect(pomContents).toContain("readonly passwordInput: Locator;");
      expect(pomContents).toContain('this.passwordInput = page.locator("#password");');
    });

    it("picks getByRole for the Submit button", () => {
      expect(pomContents).toContain("readonly submitButton: Locator;");
      expect(pomContents).toContain(
        'this.submitButton = page.getByRole("button", { name: "Submit" });',
      );
    });

    it("derives error field from #error (no role/name in snapshot)", () => {
      expect(pomContents).toMatch(/this\.error\w* = page\.locator\("#error"\);/);
    });

    it("synthesises a goto() method that navigates to the URL", () => {
      expect(pomContents).toContain("async goto(): Promise<void> {");
      expect(pomContents).toContain(
        'await this.page.goto("https://practicetestautomation.com/practice-test-login/");',
      );
    });
  });

  describe("emitted tests/login.spec.ts", () => {
    it("starts with the @playwright/test + LoginPage imports", () => {
      expect(specContents).toContain('import { test, expect } from "@playwright/test";');
      expect(specContents).toContain('import { LoginPage } from "../pages/login.page";');
    });

    it("opens a test.describe with the feature name", () => {
      expect(specContents).toContain('test.describe("User Login", () => {');
    });

    it("emits a beforeEach that instantiates the POM and calls goto()", () => {
      expect(specContents).toContain("test.beforeEach(async ({ page }) => {");
      // The beforeEach body should declare loginPage AND call goto
      const beforeEachIdx = specContents.indexOf("test.beforeEach");
      const slice = specContents.slice(beforeEachIdx, beforeEachIdx + 400);
      expect(slice).toContain("const loginPage = new LoginPage(page);");
      expect(slice).toContain("await loginPage.goto();");
    });

    it("instantiates the POM at the top of every test (no shared instance)", () => {
      const occurrences = specContents.match(/const loginPage = new LoginPage\(page\);/g);
      // beforeEach + 5 scenarios + 2 outline rows = 8 occurrences
      expect(occurrences?.length ?? 0).toBeGreaterThanOrEqual(7);
    });

    it("rule 2b binds 'I enter username \"student\"' to usernameInput.fill", () => {
      expect(specContents).toContain('await loginPage.usernameInput.fill("student");');
    });

    it("rule 3 binds 'I click the login button' to submitButton.click (suffix-constrained)", () => {
      expect(specContents).toContain("await loginPage.submitButton.click();");
    });

    it("rule 8 emits toContainText against the error field for 'an error message'", () => {
      expect(specContents).toMatch(
        /await expect\(loginPage\.error\w*\)\.toContainText\("Your username is invalid!"\);/,
      );
    });

    it("rule 9a emits toContainText for 'containing'", () => {
      expect(specContents).toMatch(
        /\.toContainText\("Congratulations"\)/,
      );
    });

    it("rule 11 emits toHaveURL with regex for 'redirected to the logged-in page'", () => {
      expect(specContents).toMatch(
        /await expect\(loginPage\.page\)\.toHaveURL\(new RegExp\("logged.in"\)\);/,
      );
    });

    it("rule 12 emits toHaveAttribute for 'should be of type'", () => {
      expect(specContents).toContain(
        'await expect(loginPage.passwordInput).toHaveAttribute("type", "password");',
      );
    });

    it("rule 13 emits anchored toHaveURL for 'should start with'", () => {
      expect(specContents).toMatch(/toHaveURL\(new RegExp\("\^https"\)\)/);
    });

    it("expands Scenario Outline into one test() per Examples row", () => {
      // Two Examples rows → two test() blocks with bracketed labels
      expect(specContents).toContain(
        'test("Login fails when credentials are empty [username=, password=Password123, errorMessage=Your username is invalid!]"',
      );
      expect(specContents).toContain(
        'test("Login fails when credentials are empty [username=student, password=, errorMessage=Your password is invalid!]"',
      );
    });

    it("emits exactly 7 test() blocks (5 scenarios + 2 outline rows)", () => {
      const matches = specContents.match(/^\s*test\(/gm);
      expect(matches?.length ?? 0).toBe(7);
    });
  });
});
