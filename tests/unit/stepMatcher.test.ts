import { describe, it, expect } from "vitest";
import { matchStep } from "../../src/transformers/stepMatcher";
import type { PageObjectIR, StepIR } from "../../src/types";

const pom: PageObjectIR = {
  className: "LoginPage",
  filePath: "pages/login.page.ts",
  fields: [
    { api: "getByLabel", args: "'Username'", fieldName: "usernameInput", source: { tag: "input" }, confidence: "unique" },
    { api: "getByLabel", args: "'Password'", fieldName: "passwordInput", source: { tag: "input" }, confidence: "unique" },
    { api: "getByRole", args: "'button', { name: 'Login' }", fieldName: "loginButton", source: { tag: "button" }, confidence: "unique" },
    { api: "getByRole", args: "'alert'", fieldName: "errorMessageAlert", source: { tag: "div" }, confidence: "unique" },
  ],
  methods: [],
  exists: false,
};

function step(keyword: StepIR["keyword"], text: string): StepIR {
  return { keyword, text };
}

describe("stepMatcher rules", () => {
  it("navigation: 'I am on the login page' → goto('/login')", () => {
    const b = matchStep(step("Given", "I am on the login page"), pom, "loginPage");
    expect(b.pomCall?.method).toBe("goto");
  });

  it('input: \'I enter "alice" into the username field\' → usernameInput.fill', () => {
    const b = matchStep(
      step("When", 'I enter "alice" into the username field'),
      pom,
      "loginPage",
    );
    expect(b.pomCall?.method).toBe("usernameInput.fill");
    expect(b.pomCall?.args).toEqual(['"alice"']);
  });

  it("click: 'I click the login button' → loginButton.click", () => {
    const b = matchStep(step("And", "I click the login button"), pom, "loginPage");
    expect(b.pomCall?.method).toBe("loginButton.click");
  });

  it("visibility: 'I should see the dashboard' → toBeVisible", () => {
    const b = matchStep(step("Then", "I should see the dashboard"), pom, "loginPage");
    expect(b.assertion?.matcher).toBe("toBeVisible");
  });

  it('error message: \'I should see the error message "Invalid credentials"\' → toContainText', () => {
    const b = matchStep(
      step("Then", 'I should see the error message "Invalid credentials"'),
      pom,
      "loginPage",
    );
    expect(b.assertion?.matcher).toBe("toContainText");
    expect(b.assertion?.expected).toBe('"Invalid credentials"');
  });

  it("URL contains: 'redirected to dashboard (URL contains \"/dashboard\")' → toHaveURL with literal regex", () => {
    const b = matchStep(
      step("Then", 'user redirected to dashboard (URL contains "/dashboard")'),
      pom,
      "loginPage",
    );
    expect(b.assertion?.matcher).toBe("toHaveURL");
    expect(b.assertion?.locator).toBe("loginPage.page");
    // Forward slashes are not regex metachars, but the rule still wraps in RegExp
    expect(b.assertion?.expected).toBe('new RegExp("/dashboard")');
  });

  it("URL contains: regex metacharacters in fragment are escaped", () => {
    // '?' is a regex metachar; the fix MUST escape it so the literal '?' is matched.
    const b = matchStep(
      step("Then", 'URL contains "/search?q=test"'),
      pom,
      "loginPage",
    );
    expect(b.assertion?.matcher).toBe("toHaveURL");
    expect(b.assertion?.expected).toBe('new RegExp("/search\\\\?q=test")');
  });

  it("unmatched step → warning, no pomCall", () => {
    const b = matchStep(step("When", "I do something exotic"), pom, "loginPage");
    expect(b.warning).toBeTruthy();
    expect(b.pomCall).toBeUndefined();
  });

  // ──────────────────────────────────────────────────────────────────────
  // LLM-narrative dialect rules (v1.1.1)
  // ──────────────────────────────────────────────────────────────────────

  describe("LLM-narrative — N1 Locate-and-fill", () => {
    it("'Locate the username input field and enter \\'student\\'' → usernameInput.fill", () => {
      const b = matchStep(
        step("When", "Locate the username input field and enter 'student'"),
        pom,
        "loginPage",
      );
      expect(b.pomCall?.method).toBe("usernameInput.fill");
      expect(b.pomCall?.args).toEqual(['"student"']);
    });

    it("'Locate the password field and type \\'pw\\'' → passwordInput.fill (no 'input' suffix)", () => {
      const b = matchStep(
        step("When", "Locate the password field and type 'pw'"),
        pom,
        "loginPage",
      );
      expect(b.pomCall?.method).toBe("passwordInput.fill");
      expect(b.pomCall?.args).toEqual(['"pw"']);
    });

    it("'Find the username and fill \\'X\\'' → usernameInput.fill (no UI suffix at all)", () => {
      const b = matchStep(
        step("When", "Find the username and fill 'X'"),
        pom,
        "loginPage",
      );
      expect(b.pomCall?.method).toBe("usernameInput.fill");
    });
  });

  describe("LLM-narrative — N2 Leave field empty", () => {
    it("'Leave the username input field empty (do not type anything)' → comment", () => {
      const b = matchStep(
        step("When", "Leave the username input field empty (do not type anything)"),
        pom,
        "loginPage",
      );
      expect(b.customBody).toBe("// intentionally left empty: username");
      expect(b.pomCall).toBeUndefined();
    });

    it("'Leave the password field blank' → comment (different verb)", () => {
      const b = matchStep(
        step("When", "Leave the password field blank"),
        pom,
        "loginPage",
      );
      expect(b.customBody).toBe("// intentionally left empty: password");
    });
  });

  describe("LLM-narrative — N3 Observe / Note annotations", () => {
    it("'Observe the resulting page and URL' → comment (strips leading 'the')", () => {
      const b = matchStep(
        step("When", "Observe the resulting page and URL"),
        pom,
        "loginPage",
      );
      // Rule strips the optional "the " prefix so the comment is cleaner.
      expect(b.customBody).toBe("// observation: resulting page and URL");
    });

    it("'Note the error message' → comment", () => {
      const b = matchStep(
        step("When", "Note the error message"),
        pom,
        "loginPage",
      );
      expect(b.customBody).toBe("// observation: error message");
    });
  });

  describe("LLM-narrative — N4 URL does not change", () => {
    it("'URL does not change to the success page' → not.toHaveURL", () => {
      const b = matchStep(
        step("Then", "URL does not change to the success page"),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("not.toHaveURL");
      expect(b.assertion?.expected).toBe('new RegExp("success")');
    });

    it("'URL doesn\\'t change' (no destination) defaults to 'success' fragment", () => {
      const b = matchStep(
        step("Then", "URL doesn't change"),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("not.toHaveURL");
      expect(b.assertion?.expected).toBe('new RegExp("success")');
    });
  });

  describe("LLM-narrative — N5 narrative text-contains (such as / e.g.)", () => {
    it("'Page displays a success message such as \\'Welcome\\'' → toContainText", () => {
      const b = matchStep(
        step("Then", "Page displays a success message such as 'Welcome'"),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toContainText");
      expect(b.assertion?.expected).toBe('"Welcome"');
    });

    it("'An error message is displayed (e.g., \\'Invalid!\\')' → toContainText against error field", () => {
      const b = matchStep(
        step("Then", "An error message is displayed (e.g., 'Invalid!')"),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toContainText");
      expect(b.assertion?.expected).toBe('"Invalid!"');
      // POM has errorMessageAlert, the rule should pick it up
      expect(b.assertion?.locator).toContain("errorMessage");
    });

    it("'... indicating \\'X\\'' alternation also captures", () => {
      const b = matchStep(
        step("Then", "An error message is displayed indicating 'Bad password'"),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toContainText");
      expect(b.assertion?.expected).toBe('"Bad password"');
    });
  });

  describe("LLM-narrative — N6 A 'X' button is visible", () => {
    it("synthesises cross-role locator when POM lacks the field (v1.1.3)", () => {
      const b = matchStep(
        step("Then", "A 'Log out' button is visible on the page"),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toBeVisible");
      // v1.1.3: cross-role + flexible-text synthesis to handle button-vs-link
      // and "Logout" vs "Log out" mismatches.
      expect(b.assertion?.locator).toContain(
        `locator("a, button, [role='button'], [role='link']")`,
      );
      // Spaces stripped before regex assembly: "Log out" → "Logout" → flexible regex
      expect(b.assertion?.locator).toContain("L\\\\s*o\\\\s*g\\\\s*o\\\\s*u\\\\s*t");
      expect(b.assertion?.locator).toContain(".first()");
    });

    it("uses POM field if name matches an existing one", () => {
      const b = matchStep(
        step("Then", "A 'Login' button is visible on the page"),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toBeVisible");
      // POM has 'loginButton' — should resolve to that field, not synthesise
      expect(b.assertion?.locator).toBe("loginPage.loginButton");
    });
  });

  describe("LLM-narrative — N7 No 'X' appears / No <noun> displayed", () => {
    it("'No \\'Log out\\' button appears' → not.toBeVisible (cross-role synthesis, v1.1.3)", () => {
      const b = matchStep(
        step("Then", "No 'Log out' button appears"),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("not.toBeVisible");
      expect(b.assertion?.locator).toContain(
        `locator("a, button, [role='button'], [role='link']")`,
      );
      expect(b.assertion?.locator).toContain("L\\\\s*o\\\\s*g\\\\s*o\\\\s*u\\\\s*t");
      expect(b.assertion?.locator).toContain(".first()");
    });

    it("'No error messages are displayed' → not.toBeVisible against error field", () => {
      const b = matchStep(
        step("Then", "No error messages are displayed"),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("not.toBeVisible");
      expect(b.assertion?.locator).toContain("errorMessage");
    });

    it("'No success message is shown' → not.toBeVisible (no field on this POM, falls back to getByText)", () => {
      const b = matchStep(
        step("Then", "No success message is shown"),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("not.toBeVisible");
      // POM has no success* field, falls back to getByText with the description
      expect(b.assertion?.locator).toContain("getByText");
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // LLM-narrative dialect rules — v1.1.2 (Background, page-level, subject-prefixed)
  // ──────────────────────────────────────────────────────────────────────

  describe("LLM-narrative — N1.5 'the X page is displayed'", () => {
    it("'Given the login page is displayed' → goto", () => {
      const b = matchStep(
        step("Given", "the login page is displayed"),
        pom,
        "loginPage",
      );
      expect(b.pomCall?.method).toBe("goto");
    });

    it("'the dashboard page is loaded' → goto with synthesised method", () => {
      const b = matchStep(
        step("Given", "the dashboard page is loaded"),
        pom,
        "loginPage",
      );
      expect(b.pomCall?.method).toBe("goto");
    });
  });

  describe("LLM-narrative — N2.5 subject-prefixed Leave-empty", () => {
    it("'the user leaves the username field empty' → comment", () => {
      const b = matchStep(
        step("When", "the user leaves the username field empty"),
        pom,
        "loginPage",
      );
      expect(b.customBody).toBe("// intentionally left empty: username");
    });

    it("'I leave the password field blank' → comment (first-person variant)", () => {
      const b = matchStep(
        step("When", "I leave the password field blank"),
        pom,
        "loginPage",
      );
      expect(b.customBody).toBe("// intentionally left empty: password");
    });
  });

  describe("LLM-narrative — N5b page-level text assertion", () => {
    it("'the page displays \"Logged In Successfully\"' → getByText.toBeVisible", () => {
      const b = matchStep(
        step("And", 'the page displays "Logged In Successfully"'),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toBeVisible");
      expect(b.assertion?.locator).toContain('getByText("Logged In Successfully")');
    });

    it("'the page contains the message \"Welcome\"' → getByText.toBeVisible", () => {
      const b = matchStep(
        step("Then", 'the page contains the message "Welcome"'),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toBeVisible");
      expect(b.assertion?.locator).toContain('getByText("Welcome")');
    });
  });

  describe("LLM-narrative — N5c subject-less specific-message containing", () => {
    it("'an error message containing \"Bad pwd\" is displayed' → toContainText against error field", () => {
      const b = matchStep(
        step("Then", 'an error message containing "Bad pwd" is displayed'),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toContainText");
      expect(b.assertion?.expected).toBe('"Bad pwd"');
      // POM has errorMessageAlert
      expect(b.assertion?.locator).toContain("errorMessage");
    });

    it("'a success message containing \"OK\" is shown' → toContainText against success field (or getByText)", () => {
      const b = matchStep(
        step("Then", 'a success message containing "OK" is shown'),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toContainText");
      expect(b.assertion?.expected).toBe('"OK"');
    });
  });

  describe("LLM-narrative — N6 unquoted role+name variant", () => {
    it("'a Logout button is visible' (unquoted) → cross-role synthesis (v1.1.3)", () => {
      const b = matchStep(
        step("And", "a Logout button is visible"),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toBeVisible");
      // Test pom has no Logout field; synthesise cross-role locator with
      // flexible regex so "Logout" matches both "Logout" and "Log out".
      expect(b.assertion?.locator).toContain(
        `locator("a, button, [role='button'], [role='link']")`,
      );
      expect(b.assertion?.locator).toContain("L\\\\s*o\\\\s*g\\\\s*o\\\\s*u\\\\s*t");
      expect(b.assertion?.locator).toContain(".first()");
    });

    it("'A Login button is visible' (unquoted) → resolves to loginButton (POM has it)", () => {
      const b = matchStep(
        step("Then", "A Login button is visible"),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toBeVisible");
      expect(b.assertion?.locator).toBe("loginPage.loginButton");
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // v1.1.4 — article stripping + N5d optional URL
  // ──────────────────────────────────────────────────────────────────────

  describe("v1.1.4 — article stripping in URL slugs", () => {
    it("'redirected to a logged-in page' → slug strips 'a'", () => {
      const b = matchStep(
        step("Then", "the user is redirected to a logged-in page"),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toHaveURL");
      // Without stripArticles, this would emit "a[-_/]?logged-in" and fail
      // to match /logged-in-successfully/ on real sites.
      expect(b.assertion?.expected).toBe('new RegExp("logged-in")');
    });

    it("'redirected to an admin dashboard' → slug strips 'an'", () => {
      const b = matchStep(
        step("Then", "I should be redirected to an admin dashboard"),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toHaveURL");
      expect(b.assertion?.expected).toBe('new RegExp("admin[-_/]?dashboard")');
    });

    it("'should remain on a login page' → slug strips 'a'", () => {
      const b = matchStep(
        step("Then", "I should remain on a login page"),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toHaveURL");
      expect(b.assertion?.expected).toBe('new RegExp("login")');
    });
  });

  describe("v1.1.4 — N5d optional URL suffix", () => {
    it("'the user is on the login page' (no 'at URL') → goto", () => {
      const b = matchStep(
        step("Given", "the user is on the login page"),
        pom,
        "loginPage",
      );
      expect(b.pomCall?.method).toBe("goto");
    });

    it("'the user is on the login page at \"URL\"' (with URL) → still goto", () => {
      const b = matchStep(
        step("Given", 'the user is on the login page at "https://example.com/login"'),
        pom,
        "loginPage",
      );
      expect(b.pomCall?.method).toBe("goto");
    });

    it("v1.1.7: 'the user is on the login page \"URL\"' (no 'at', URL appended directly) → goto", () => {
      // LLM sometimes drops the word "at" between "page" and the quoted URL.
      // Without v1.1.7, this fell to TODO. Background still navigates so tests
      // still pass, but BDD_REVIEW.md filled with noise.
      const b = matchStep(
        step("Given", 'the user is on the login page "https://practicetestautomation.com/practice-test-login/"'),
        pom,
        "loginPage",
      );
      expect(b.pomCall?.method).toBe("goto");
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // v1.1.5 — rule 2b SUBJ optional (subject-less compact form)
  // ──────────────────────────────────────────────────────────────────────

  describe("v2.2.2 — URL contains 'a path segment X' dialect (production bug 3)", () => {
    it("'the current URL contains a path segment \"logged-in-successfully\"' → toHaveURL", () => {
      const b = matchStep(
        step("Then", 'the current URL contains a path segment "logged-in-successfully"'),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toHaveURL");
      expect(b.assertion?.expected).toBe('new RegExp("logged-in-successfully")');
    });

    it("'URL contains a fragment \"X\"' → toHaveURL (fragment variant)", () => {
      const b = matchStep(
        step("Then", 'URL contains a fragment "dashboard"'),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toHaveURL");
      expect(b.assertion?.expected).toBe('new RegExp("dashboard")');
    });

    it("'Page URL contains the path \"/admin\"' → toHaveURL", () => {
      const b = matchStep(
        step("Then", 'Page URL contains the path "/admin"'),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toHaveURL");
      expect(b.assertion?.expected).toBe('new RegExp("/admin")');
    });

    it("regression: plain 'URL contains \"X\"' still matches (no path/segment word)", () => {
      const b = matchStep(
        step("Then", 'URL contains "abc"'),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toHaveURL");
      expect(b.assertion?.expected).toBe('new RegExp("abc")');
    });
  });

  describe("v2.2.2 — prose-as-URL-slug guard (production bug 2)", () => {
    it("'remains on login page without any redirect' → TODO (prose, not a URL slug)", () => {
      const b = matchStep(
        step("Then", "user remains on login page without any redirect"),
        pom,
        "loginPage",
      );
      // Without the prose guard this would emit toHaveURL with
      // "login[-_/]?page[-_/]?without[-_/]?any[-_/]?redirect" which
      // never matches a real URL.
      expect(b.warning).toBeTruthy();
      expect(b.warning).toContain("reads like prose");
      expect(b.assertion).toBeUndefined();
    });

    it("regression: 'remains on the login page' (clean) still matches rule 10", () => {
      const b = matchStep(
        step("Then", "user remains on the login page"),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toHaveURL");
      expect(b.assertion?.expected).toBe('new RegExp("login")');
    });
  });

  describe("v1.1.5 — subject-less 'enters <field> \"V\"'", () => {
    it("'enters password \"Password123\"' → passwordInput.fill", () => {
      const b = matchStep(
        step("And", 'enters password "Password123"'),
        pom,
        "loginPage",
      );
      expect(b.pomCall?.method).toBe("passwordInput.fill");
      expect(b.pomCall?.args).toEqual(['"Password123"']);
    });

    it("'enters username \"alice\"' → usernameInput.fill", () => {
      const b = matchStep(
        step("When", 'enters username "alice"'),
        pom,
        "loginPage",
      );
      expect(b.pomCall?.method).toBe("usernameInput.fill");
      expect(b.pomCall?.args).toEqual(['"alice"']);
    });

    it("subject-prefix forms still match (regression — original rule 2b coverage)", () => {
      const b = matchStep(
        step("When", 'User enters username "alice"'),
        pom,
        "loginPage",
      );
      expect(b.pomCall?.method).toBe("usernameInput.fill");
    });

    it("'types the password \"secret\"' (verb 'types', article 'the') → passwordInput.fill", () => {
      const b = matchStep(
        step("And", 'types the password "secret"'),
        pom,
        "loginPage",
      );
      expect(b.pomCall?.method).toBe("passwordInput.fill");
      expect(b.pomCall?.args).toEqual(['"secret"']);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // v1.1.6 — rule 2a SUBJ optional + parenthetical stripping
  // ──────────────────────────────────────────────────────────────────────
  //
  // Two production gaps surfaced when running cloud-jobs against the LLM
  // stack with cache disabled:
  //   1. Subject-less `Enter 'X' in the field` (rule 2a required SUBJ).
  //   2. Descriptive parentheticals leaked into URL slugs in rules 10/11b/N4/N5e.
  // Both made tests silently pass without doing anything.
  describe("v1.1.6 — subject-less 'Enter 'X' in the field'", () => {
    it("subject-less 'Enter 'student' in the username field' → usernameInput.fill", () => {
      const b = matchStep(
        step("When", "Enter 'student' in the username field"),
        pom,
        "loginPage",
      );
      expect(b.pomCall?.method).toBe("usernameInput.fill");
      expect(b.pomCall?.args).toEqual(['"student"']);
    });

    it("subject-less 'Enter \"Password123\" into the password field' (preposition 'into')", () => {
      const b = matchStep(
        step("And", 'Enter "Password123" into the password field'),
        pom,
        "loginPage",
      );
      expect(b.pomCall?.method).toBe("passwordInput.fill");
      expect(b.pomCall?.args).toEqual(['"Password123"']);
    });

    it("subject-prefixed 'I enter \"x\" in the username field' still works (regression)", () => {
      const b = matchStep(
        step("When", 'I enter "x" in the username field'),
        pom,
        "loginPage",
      );
      expect(b.pomCall?.method).toBe("usernameInput.fill");
    });
  });

  describe("v1.1.6 — parenthetical prose in URL slug rules", () => {
    it("rule 11b: 'redirected to logged-in page (URL changes away from login page)' → slug 'logged-in', NOT slug with parenthetical", () => {
      const b = matchStep(
        step(
          "Then",
          "User is redirected to logged-in page (URL changes away from login page)",
        ),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toHaveURL");
      // Parenthetical and trailing ` page` should both be stripped before slugifying.
      // Hyphen is not a regex metachar, so it stays unescaped in the slug.
      expect(b.assertion?.expected).toBe('new RegExp("logged-in")');
    });

    it("rule 10: 'remains on login page (URL does not change away from login page)' → slug 'login'", () => {
      const b = matchStep(
        step(
          "And",
          "user remains on login page (URL does not change away from login page)",
        ),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toHaveURL");
      expect(b.assertion?.expected).toBe('new RegExp("login")');
    });

    it("rule N5e: 'is NOT redirected away from login page (URL ...)' → slug 'login'", () => {
      const b = matchStep(
        step(
          "Then",
          "user is NOT redirected away from login page (URL stays the same)",
        ),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toHaveURL");
      expect(b.assertion?.expected).toBe('new RegExp("login")');
    });

    it("rule 11a still wins for authoritative '(URL contains \"X\")' parentheticals (regression)", () => {
      // 11a runs first; the parenthetical IS the authoritative URL fragment
      // and 11a should grab it directly.
      const b = matchStep(
        step("Then", 'redirected to logged-in page (URL contains "/logged-in/")'),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toHaveURL");
      expect(b.assertion?.expected).toBe('new RegExp("/logged-in/")');
    });
  });
});
