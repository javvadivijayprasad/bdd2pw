/**
 * v4.0.1 — reject hallucinated POM-instance methods.
 *
 * The LLM occasionally invents helpers on the POM, e.g.
 * `loginPage.fill(page.getByLabel(...), "x")` or
 * `loginPage.click(page.getByRole(...))`. Real POMs only expose
 * `goto`, `page`, and whatever fields the locator picker discovered.
 *
 * These tests pin the rejector's behaviour so the v4.0 bench failures
 * in 06-conduit and 08-automation-practice never regress.
 */

import { describe, expect, it } from "vitest";
import {
  detectHallucinatedPomMethods,
  parseBindingJson,
} from "../../src/llm/anthropicClient";
import type { GenerateBindingInput } from "../../src/llm/types";
import type { PageObjectIR } from "../../src/types";

const POM_WITH_USERNAME: PageObjectIR = {
  className: "LoginPage",
  filePath: "pages/login.page.ts",
  fields: [
    {
      api: "getByLabel",
      args: '"Username"',
      fieldName: "usernameInput",
      source: { tag: "input" },
      confidence: "unique",
    },
    {
      api: "getByLabel",
      args: '"Password"',
      fieldName: "passwordInput",
      source: { tag: "input" },
      confidence: "unique",
    },
  ],
  methods: [{ name: "goto", params: [], body: "", origin: "generated" }],
  exists: false,
};

const STEP: GenerateBindingInput = {
  step: { keyword: "When", text: "I do a thing" },
  pom: POM_WITH_USERNAME,
  pageVar: "loginPage",
  scaffoldId: "scaffold-test",
};

describe("v4.0.1 — detectHallucinatedPomMethods", () => {
  const known = new Set(["goto", "page", "usernameInput", "passwordInput"]);

  it("rejects loginPage.fill(...)", () => {
    expect(
      detectHallucinatedPomMethods(
        'await loginPage.fill(page.getByLabel("Email"), "x");',
        "loginPage",
        known,
      ),
    ).toEqual(["loginPage.fill"]);
  });

  it("rejects loginPage.click(...)", () => {
    expect(
      detectHallucinatedPomMethods(
        'await loginPage.click(page.getByRole("button"));',
        "loginPage",
        known,
      ),
    ).toEqual(["loginPage.click"]);
  });

  it("accepts loginPage.goto()", () => {
    expect(
      detectHallucinatedPomMethods(
        "await loginPage.goto();",
        "loginPage",
        known,
      ),
    ).toEqual([]);
  });

  it("accepts loginPage.page (field chain to Page methods)", () => {
    expect(
      detectHallucinatedPomMethods(
        "await loginPage.page.getByLabel(/x/i).fill('y');",
        "loginPage",
        known,
      ),
    ).toEqual([]);
  });

  it("accepts loginPage.usernameInput.fill (chain to Locator methods on a known field)", () => {
    expect(
      detectHallucinatedPomMethods(
        'await loginPage.usernameInput.fill("x");',
        "loginPage",
        known,
      ),
    ).toEqual([]);
  });

  it("rejects multiple unknowns in one body", () => {
    const text = `
      await loginPage.fill(x, "a");
      await loginPage.click(y);
      await loginPage.submit();
    `;
    const hits = detectHallucinatedPomMethods(text, "loginPage", known);
    // Set semantics in caller — order of insertion = order of regex hits
    expect(hits.sort()).toEqual([
      "loginPage.click",
      "loginPage.fill",
      "loginPage.submit",
    ]);
  });

  it("only matches the configured pomVar", () => {
    // Other variable names should not trigger.
    expect(
      detectHallucinatedPomMethods(
        "await otherThing.fill(x);",
        "loginPage",
        known,
      ),
    ).toEqual([]);
  });
});

describe("v4.0.1 — parseBindingJson rejects POM-method hallucinations", () => {
  it("rejects a binding with customBody calling loginPage.fill(...)", () => {
    const response = JSON.stringify({
      step: { keyword: "When", text: "I do a thing" },
      customBody: 'await loginPage.fill(page.getByLabel("Email"), "x");',
    });
    expect(parseBindingJson(response, STEP)).toBeUndefined();
  });

  it("rejects a binding with customBody calling loginPage.click(locator)", () => {
    const response = JSON.stringify({
      step: { keyword: "When", text: "I do a thing" },
      customBody:
        'await loginPage.click(page.getByRole("button", { name: "Sign in" }));',
    });
    expect(parseBindingJson(response, STEP)).toBeUndefined();
  });

  it("accepts a binding using the existing usernameInput field", () => {
    const response = JSON.stringify({
      step: { keyword: "When", text: "I do a thing" },
      customBody: 'await loginPage.usernameInput.fill("x");',
    });
    const result = parseBindingJson(response, STEP);
    expect(result?.customBody).toContain("usernameInput");
  });

  it("accepts a binding using page directly (no POM access at all)", () => {
    const response = JSON.stringify({
      step: { keyword: "When", text: "I do a thing" },
      customBody: 'await page.getByLabel("Email").fill("x");',
    });
    const result = parseBindingJson(response, STEP);
    expect(result?.customBody).toContain("page.getByLabel");
  });

  it("accepts a binding via loginPage.page (allowed Page-instance chain)", () => {
    const response = JSON.stringify({
      step: { keyword: "When", text: "I do a thing" },
      customBody:
        'await loginPage.page.getByPlaceholder("Email").fill("x");',
    });
    const result = parseBindingJson(response, STEP);
    expect(result?.customBody).toContain("loginPage.page.getByPlaceholder");
  });

  // v4.0.1.1 — the bench Conduit failure mode. The LLM emits a structured
  // pomCall with the bare method name "fill", which the text-scan path
  // can't see. Must be rejected via the direct pomCall.method check.
  it("rejects pomCall.method='fill' (structured hallucination)", () => {
    const response = JSON.stringify({
      step: { keyword: "When", text: "I enter my email" },
      pomCall: {
        page: "loginPage",
        method: "fill",
        args: ['page.getByLabel(/email/i).first()', '"bench@example.com"'],
      },
    });
    expect(parseBindingJson(response, STEP)).toBeUndefined();
  });

  it("rejects pomCall.method='click' (structured hallucination)", () => {
    const response = JSON.stringify({
      step: { keyword: "When", text: "I click submit" },
      pomCall: {
        page: "loginPage",
        method: "click",
        args: ['page.getByRole("button")'],
      },
    });
    expect(parseBindingJson(response, STEP)).toBeUndefined();
  });

  it("accepts pomCall.method='usernameInput.fill' (chain on known field)", () => {
    const response = JSON.stringify({
      step: { keyword: "When", text: "I enter my username" },
      pomCall: {
        page: "loginPage",
        method: "usernameInput.fill",
        args: ['"alice"'],
      },
    });
    const result = parseBindingJson(response, STEP);
    expect(result?.pomCall?.method).toBe("usernameInput.fill");
  });

  it("accepts pomCall.method='goto' (the always-known method)", () => {
    const response = JSON.stringify({
      step: { keyword: "Given", text: "I am on the page" },
      pomCall: { page: "loginPage", method: "goto", args: [] },
    });
    const result = parseBindingJson(response, STEP);
    expect(result?.pomCall?.method).toBe("goto");
  });

  // v4.0.1.2 — bench Juice Shop regression. The LLM picked a real field
  // ("email") but emitted it as a bare call `loginPage.email("x")` instead
  // of the chain `loginPage.email.fill("x")`. tsc flags "This expression
  // is not callable" because Locator is not callable.
  it("rejects pomCall.method='<field>' (bare field call — not callable)", () => {
    const response = JSON.stringify({
      step: { keyword: "When", text: "I enter my username" },
      pomCall: {
        page: "loginPage",
        method: "usernameInput",
        args: ['"alice"'],
      },
    });
    expect(parseBindingJson(response, STEP)).toBeUndefined();
  });

  it("rejects pomCall.method='page' (bare page call — not callable)", () => {
    const response = JSON.stringify({
      step: { keyword: "When", text: "I do something" },
      pomCall: { page: "loginPage", method: "page", args: ['"x"'] },
    });
    expect(parseBindingJson(response, STEP)).toBeUndefined();
  });

  it("accepts pomCall.method='page.goto' (chained on page field)", () => {
    const response = JSON.stringify({
      step: { keyword: "Given", text: "I navigate" },
      pomCall: {
        page: "loginPage",
        method: "page.goto",
        args: ['"https://example.com"'],
      },
    });
    const result = parseBindingJson(response, STEP);
    expect(result?.pomCall?.method).toBe("page.goto");
  });
});
