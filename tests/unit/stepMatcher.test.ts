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
});
