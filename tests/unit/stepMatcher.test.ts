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
    it("synthesises getByRole when POM lacks the field", () => {
      const b = matchStep(
        step("Then", "A 'Log out' button is visible on the page"),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toBeVisible");
      expect(b.assertion?.locator).toContain('getByRole("button"');
      expect(b.assertion?.locator).toContain('name: "Log out"');
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
    it("'No \\'Log out\\' button appears' → not.toBeVisible (synthesised getByRole)", () => {
      const b = matchStep(
        step("Then", "No 'Log out' button appears"),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("not.toBeVisible");
      expect(b.assertion?.locator).toContain('getByRole("button"');
      expect(b.assertion?.locator).toContain('name: "Log out"');
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
    it("'a Logout button is visible' (unquoted) → synthesises getByRole", () => {
      const b = matchStep(
        step("And", "a Logout button is visible"),
        pom,
        "loginPage",
      );
      expect(b.assertion?.matcher).toBe("toBeVisible");
      // Test pom has no Logout field, so synthesise getByRole
      expect(b.assertion?.locator).toContain('getByRole("button"');
      expect(b.assertion?.locator).toContain('name: "Logout"');
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
});
