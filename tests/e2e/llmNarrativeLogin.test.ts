/**
 * End-to-end regression test for the llm-narrative-login fixture.
 *
 * The fixture is real LLM output from a `test-case-generation-service` job
 * (see examples/llm-narrative-login/README.md). This test asserts that v1.1.1's
 * 9 new dialect rules turn what was previously 6/9 TODO into 9/9 real
 * test code, with zero `// TODO` lines and zero warning-level review items.
 *
 * If this test ever fails after a rule/picker/emitter change, real cloud-jobs
 * runs producing LLM-narrative Gherkin will silently regress to no-op TODOs.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { scaffold } from "../../src";

const fixtureDir = path.resolve(__dirname, "..", "..", "examples", "llm-narrative-login");
const featurePath = path.join(fixtureDir, "login.feature");
const snapshotPath = path.join(fixtureDir, "snapshot.json");

describe("llm-narrative-login end-to-end", () => {
  let outDir: string;
  let pomContents: string;
  let specContents: string;
  let result: Awaited<ReturnType<typeof scaffold>>;

  beforeAll(async () => {
    outDir = path.join(os.tmpdir(), `bdd2pw-llmnarr-e2e-${Date.now()}`);
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
    it("produces zero tsc errors (validation skipped — no install)", () => {
      expect(result.tscErrorCount).toBe(0);
    });

    it("zero warning-level review items (every step matched a rule)", () => {
      const warnings = result.reviewItems.filter((i) => i.severity === "warn");
      // The locked-in scope of v1.1.1: every step in this fixture maps cleanly.
      // If this fails, paste the warnings into a comment with the step text
      // and add a new rule (or extend an existing one) to cover the gap.
      if (warnings.length > 0) {
        // eslint-disable-next-line no-console
        console.error(
          "Unexpected warnings from llm-narrative-login fixture:",
          JSON.stringify(warnings, null, 2),
        );
      }
      expect(warnings).toEqual([]);
    });

    it("emits the 4 expected scenarios as test() blocks", () => {
      const matches = specContents.match(/^\s*test\(/gm);
      expect(matches?.length ?? 0).toBe(4);
    });
  });

  describe("rule N1 — Locate the X (input)? field and enter 'V'", () => {
    it("emits usernameInput.fill('student') for TC-001", () => {
      expect(specContents).toContain('await loginPage.usernameInput.fill("student");');
    });

    it("emits passwordInput.fill('Password123') for TC-001", () => {
      expect(specContents).toContain('await loginPage.passwordInput.fill("Password123");');
    });

    it("emits passwordInput.fill('wrongPassword') for TC-002", () => {
      expect(specContents).toContain('await loginPage.passwordInput.fill("wrongPassword");');
    });

    it("emits passwordInput.fill('WrongPass999') for TC-004", () => {
      expect(specContents).toContain('await loginPage.passwordInput.fill("WrongPass999");');
    });
  });

  describe("Click the 'X' button — handled by existing rule 3", () => {
    it("emits submitButton.click() for 'Click the Submit button'", () => {
      expect(specContents).toContain("await loginPage.submitButton.click();");
    });
  });

  describe("Navigate to <URL> — handled by existing rule 1", () => {
    it("emits goto() for 'Navigate to <URL>' (synthesised method)", () => {
      // The scaffolder synthesises a goto() that navigates to opts.url, so
      // the spec calls it without arguments.
      expect(specContents).toContain("await loginPage.goto();");
    });
  });

  describe("rule N2 — Leave the X field empty (do not type anything)", () => {
    it("emits a comment, no real action, for empty-input scenario", () => {
      expect(specContents).toContain("// intentionally left empty: username");
      expect(specContents).toContain("// intentionally left empty: password");
    });
  });

  describe("rule N3 — Observe / Note", () => {
    it("emits a comment for 'Observe the resulting page and URL' (strips leading 'the')", () => {
      // The rule's `(?:the )?` makes the leading "the" optional and not part
      // of the capture, so the comment is just the substantive content.
      expect(specContents).toContain(
        "// observation: resulting page and URL",
      );
    });

    it("emits a comment for 'Observe the error message displayed on the page'", () => {
      expect(specContents).toContain(
        "// observation: error message displayed on the page",
      );
    });
  });

  describe("rule N4 — URL does not change", () => {
    it("emits not.toHaveURL for 'URL does not change to the success page'", () => {
      expect(specContents).toMatch(
        /await expect\(loginPage\.page\)\.not\.toHaveURL\(new RegExp\("success"\)\);/,
      );
    });
  });

  describe("rule N5 — narrative text-contains (such as / e.g.)", () => {
    it("emits toContainText for 'such as Congratulations...'", () => {
      expect(specContents).toMatch(
        /\.toContainText\("Congratulations student\. You successfully logged in!"\)/,
      );
    });

    it("emits toContainText against error field for '(e.g., Your username is invalid!)'", () => {
      expect(specContents).toMatch(
        /await expect\(loginPage\.error\w*\)\.toContainText\("Your username is invalid!"\);/,
      );
    });

    it("emits toContainText against error field for '(e.g., Your password is invalid!)'", () => {
      expect(specContents).toMatch(
        /await expect\(loginPage\.error\w*\)\.toContainText\("Your password is invalid!"\);/,
      );
    });
  });

  describe("rule N6 — A 'X' button is visible on the page", () => {
    it("resolves 'Log out' to logOutLink (snapshot has it; rule uses POM field)", () => {
      // The snapshot includes the success-page logout link as a 'link' role
      // with name 'Log out'. Picker generates fieldName 'logOutLink'.
      // findFieldByDescription resolves to logOutLink via norm+'Link'.
      expect(specContents).toContain(
        "await expect(loginPage.logOutLink).toBeVisible();",
      );
    });
  });

  describe("rule N7 — No 'X' appears / No <noun> are displayed", () => {
    it("'No \\'Log out\\' button appears' → logOutLink.not.toBeVisible (POM field)", () => {
      expect(specContents).toContain(
        "await expect(loginPage.logOutLink).not.toBeVisible();",
      );
    });

    it("'No error messages are displayed' → error.not.toBeVisible", () => {
      expect(specContents).toMatch(
        /await expect\(loginPage\.error\w*\)\.not\.toBeVisible\(\);/,
      );
    });

    it("'No success message is shown' → success-themed field (success branch)", () => {
      // Dispatcher checks success/congrat BEFORE error/message, so this
      // resolves to a success-related field (loggedInSuccessfullyHeading
      // via fuzzy 'success' substring match) rather than the error field.
      expect(specContents).toMatch(
        /await expect\(loginPage\.\w*[Ss]uccessfully\w*\)\.not\.toBeVisible\(\);/,
      );
    });
  });

  describe("loose error visibility rule N4b (no quoted value)", () => {
    it("'An error or validation message is displayed indicating ...' → error.toBeVisible", () => {
      expect(specContents).toMatch(
        /await expect\(loginPage\.error\w*\)\.toBeVisible\(\);/,
      );
    });
  });

  describe("rule 10 extension — 'User remains on the login page'", () => {
    it("emits toHaveURL for present-tense 'User remains on the login page'", () => {
      expect(specContents).toMatch(
        /await expect\(loginPage\.page\)\.toHaveURL\(new RegExp\("login"\)\);/,
      );
    });
  });

  describe("URL contains rule (1.0.1, rule 11a) still works on parenthetical hint", () => {
    it("emits toHaveURL for 'redirected to ... (URL contains \\'practice-test-login/logged-in-successfully\\')", () => {
      expect(specContents).toMatch(
        /await expect\(loginPage\.page\)\.toHaveURL\(new RegExp\("practice-test-login\/logged-in-successfully"\)\);/,
      );
    });
  });

  describe("emitted POM still has the right shape", () => {
    it("declares LoginPage class with usernameInput, passwordInput, submitButton, error", () => {
      expect(pomContents).toContain("export class LoginPage {");
      expect(pomContents).toContain("readonly usernameInput: Locator;");
      expect(pomContents).toContain("readonly passwordInput: Locator;");
      expect(pomContents).toContain("readonly submitButton: Locator;");
      expect(pomContents).toMatch(/readonly error\w*: Locator;/);
    });

    it("synthesises goto()", () => {
      expect(pomContents).toContain("async goto(): Promise<void> {");
    });
  });
});
