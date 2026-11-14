/**
 * v4.7.0 — POMWright target PoC. Unit tests pin the emitted POM/spec
 * shape so a refactor that breaks the integration surfaces in CI
 * rather than at the next POMWright user's `npx playwright test`.
 *
 * The PoC is scoped to the design discussion with DyHex on POMWright#63:
 * new POMs only, hierarchy inferred from xpath, flat fallback with a
 * review marker when the DOM lacks structure.
 */

import { describe, it, expect } from "vitest";
import { inferPomwrightPath } from "../../src/transformers/hierarchyInferrer";
import { emitPomwrightPom, emitPomwrightSpec } from "../../src/emitters/pomwrightEmitter";
import type { LocatorChoice, PageObjectIR } from "../../src/types";

const makeChoice = (
  partial: Partial<LocatorChoice> & {
    api?: LocatorChoice["api"];
    source?: Partial<LocatorChoice["source"]>;
  } = {},
): LocatorChoice => ({
  api: partial.api ?? "getByLabel",
  args: partial.args ?? '"Username"',
  fieldName: partial.fieldName ?? "usernameInput",
  source: {
    tag: "input",
    role: "textbox",
    label: "Username",
    xpath: '/html/body/main/form[@id="login"]/input[@name="username"]',
    ...(partial.source ?? {}),
  } as LocatorChoice["source"],
  confidence: partial.confidence ?? "unique",
});

describe("v4.7.0 PoC — hierarchyInferrer (POMWright)", () => {
  it("extracts main + named form + leaf from a clean xpath", () => {
    const inf = inferPomwrightPath(makeChoice());
    expect(inf.path).toBe("main.form@login.input@username");
    expect(inf.reviewNeeded).toBe(false);
  });

  it("falls back to flat path + review marker when no stable ancestor", () => {
    const inf = inferPomwrightPath(
      makeChoice({
        source: {
          tag: "h1",
          role: "heading",
          text: "Welcome",
          xpath: "/html/body/div/h1",
        },
      }),
    );
    expect(inf.segments.length).toBe(1);
    expect(inf.reviewNeeded).toBe(true);
    expect(inf.path).toMatch(/heading@/);
  });

  it("recognises `nav` as a stable landmark without a name attribute", () => {
    const inf = inferPomwrightPath(
      makeChoice({
        fieldName: "homeLink",
        source: {
          tag: "a",
          role: "link",
          name: "Home",
          xpath: "/html/body/nav/a",
        },
      }),
    );
    expect(inf.path.startsWith("nav.link@")).toBe(true);
  });

  it("treats positional divs (`div[2]`) as unstable and drops them", () => {
    const inf = inferPomwrightPath(
      makeChoice({
        source: {
          tag: "input",
          role: "textbox",
          label: "Email",
          xpath: '/html/body/main/div[2]/input[@name="email"]',
        },
      }),
    );
    // `main` kept, `div[2]` dropped.
    expect(inf.path).toBe("main.input@username");
  });

  it("uses CSS selector fallback when xpath is missing", () => {
    const inf = inferPomwrightPath(
      makeChoice({
        source: {
          tag: "input",
          role: "textbox",
          label: "Username",
          cssSelector: 'main form#login input[name="username"]',
        },
      }),
    );
    expect(inf.path).toBe("main.form@login.input@username");
  });
});

describe("v4.7.0 PoC — emitPomwrightPom", () => {
  it("emits the full POMWright POM shape with all parent segments registered", () => {
    const pom: PageObjectIR = {
      className: "LoginPage",
      filePath: "/tmp/login.page.ts",
      fields: [
        makeChoice(),
        makeChoice({
          api: "getByLabel",
          args: '"Password"',
          fieldName: "passwordInput",
          source: {
            tag: "input",
            role: "textbox",
            label: "Password",
            xpath: '/html/body/main/form[@id="login"]/input[@name="password"]',
          },
        }),
        makeChoice({
          api: "getByRole",
          args: '"button", { name: "Submit" }',
          fieldName: "submitButton",
          source: {
            tag: "button",
            role: "button",
            name: "Submit",
            xpath: '/html/body/main/form[@id="login"]/button',
          },
        }),
      ],
      methods: [],
    };
    const r = emitPomwrightPom({
      pom,
      baseUrl: "https://example.com",
      urlPath: "/login",
    });
    // Imports
    expect(r.contents).toContain('import { type Page } from "@playwright/test";');
    expect(r.contents).toContain('import { PageObject } from "pomwright";');
    // Paths union includes every intermediate segment
    expect(r.contents).toContain('"main"');
    expect(r.contents).toContain('"main.form@login"');
    expect(r.contents).toContain('"main.form@login.input@username"');
    expect(r.contents).toContain('"main.form@login.input@password"');
    expect(r.contents).toContain('"main.form@login.button@submit"');
    // Class signature
    expect(r.contents).toContain("export class LoginPage extends PageObject<Paths>");
    // Super call carries baseUrl + urlPath
    expect(r.contents).toContain('super(page, "https://example.com", "/login");');
    // defineLocators has the chain
    expect(r.contents).toContain(
      'this.add("main.form@login.input@username").getByLabel("Username");',
    );
    expect(r.contents).toContain(
      'this.add("main.form@login").getByRole("form", { name: "Login" });',
    );
    expect(r.contents).toContain('this.add("main").getByRole("main");');
    // No warnings for this clean input
    expect(r.warnings.length).toBe(0);
    // pathByFieldName for the spec emitter
    expect(r.pathByFieldName.get("usernameInput")).toBe("main.form@login.input@username");
  });

  it("produces a warning for each field that fell back to flat path", () => {
    const pom: PageObjectIR = {
      className: "LandingPage",
      filePath: "/tmp/landing.page.ts",
      fields: [
        makeChoice({
          fieldName: "heroHeading",
          source: {
            tag: "h1",
            role: "heading",
            text: "Hello",
            xpath: "/html/body/div/h1",
          },
        }),
      ],
      methods: [],
    };
    const r = emitPomwrightPom({
      pom,
      baseUrl: "https://example.com",
      urlPath: "/",
    });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].message).toContain("heroHeading");
    expect(r.warnings[0].severity).toBe("warn");
  });
});

describe("v4.7.0 PoC — emitPomwrightSpec", () => {
  it("rewrites pom.<field>.<call> to pom.getNestedLocator('<path>').<call>", () => {
    const r = emitPomwrightSpec({
      describeName: "Login",
      pomClassName: "LoginPage",
      pomVar: "loginPage",
      pomImportPath: "../pages/login.page",
      scenarios: [
        {
          name: "Successful login",
          bindings: [
            {
              step: { keyword: "When", text: 'I enter "alice" into the username field' },
              pomCall: {
                page: "loginPage",
                method: "usernameInput.fill",
                args: ['"alice"'],
              },
            } as never,
          ],
        },
      ],
      pathByFieldName: new Map([["usernameInput", "main.form@login.input@username"]]),
    });
    expect(r.contents).toContain('import { test as base } from "pomwright";');
    expect(r.contents).toContain("base.extend<{ loginPage: LoginPage }>");
    expect(r.contents).toContain(
      'await loginPage.getNestedLocator("main.form@login.input@username").fill("alice");',
    );
  });

  it("rewrites pom.goto() to pom.navigation.goto() (POMWright API)", () => {
    const r = emitPomwrightSpec({
      describeName: "Login",
      pomClassName: "LoginPage",
      pomVar: "loginPage",
      pomImportPath: "../pages/login.page",
      scenarios: [
        {
          name: "goto",
          bindings: [
            {
              step: { keyword: "Given", text: "I am on the login page" },
              pomCall: { page: "loginPage", method: "goto", args: [] },
            } as never,
          ],
        },
      ],
      pathByFieldName: new Map(),
    });
    expect(r.contents).toContain("await loginPage.navigation.goto();");
    expect(r.contents).not.toContain("await loginPage.goto();");
  });

  it("warns on an unknown field reference rather than silently emitting broken code", () => {
    const r = emitPomwrightSpec({
      describeName: "Login",
      pomClassName: "LoginPage",
      pomVar: "loginPage",
      pomImportPath: "../pages/login.page",
      scenarios: [
        {
          name: "unknown",
          bindings: [
            {
              step: { keyword: "Then", text: "see" },
              assertion: {
                locator: "loginPage.ghost",
                matcher: "toBeVisible",
              },
            } as never,
          ],
        },
      ],
      pathByFieldName: new Map(),
    });
    expect(r.warnings.length).toBeGreaterThanOrEqual(1);
    expect(r.warnings[0].message).toContain("ghost");
  });
});
