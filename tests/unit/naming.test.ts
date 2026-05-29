import { describe, it, expect } from "vitest";
import {
  pascalCase,
  camelCase,
  kebabCase,
  snakeCase,
  pageObjectFileStem,
  specFileStem,
  toJsIdentifier,
} from "../../src/utils/naming";

describe("naming helpers", () => {
  describe("pascalCase", () => {
    it("converts kebab-case", () => {
      expect(pascalCase("login-page")).toBe("LoginPage");
    });
    it("converts snake_case", () => {
      expect(pascalCase("login_page")).toBe("LoginPage");
    });
    it("converts space separated", () => {
      expect(pascalCase("login page")).toBe("LoginPage");
    });
    it("preserves already-PascalCase", () => {
      expect(pascalCase("LoginPage")).toBe("LoginPage");
    });
    it("normalises mixed acronyms", () => {
      expect(pascalCase("HTTPServer")).toBe("HttpServer");
    });
  });

  describe("camelCase", () => {
    it("works on multi-word input", () => {
      expect(camelCase("submit button")).toBe("submitButton");
    });
    it("works on a single word", () => {
      expect(camelCase("login")).toBe("login");
    });
  });

  describe("kebabCase", () => {
    it("converts PascalCase", () => {
      expect(kebabCase("LoginPage")).toBe("login-page");
    });
    it("converts camelCase", () => {
      expect(kebabCase("submitButton")).toBe("submit-button");
    });
  });

  describe("snakeCase", () => {
    it("converts PascalCase", () => {
      expect(snakeCase("LoginPage")).toBe("login_page");
    });
  });

  describe("pageObjectFileStem", () => {
    it("strips trailing 'Page' suffix", () => {
      expect(pageObjectFileStem("LoginPage")).toBe("login.page");
      expect(pageObjectFileStem("DashboardPage")).toBe("dashboard.page");
    });
    it("works without 'Page' suffix", () => {
      expect(pageObjectFileStem("Login")).toBe("login.page");
    });
  });

  describe("specFileStem", () => {
    it("converts feature names", () => {
      expect(specFileStem("User Login")).toBe("user-login.spec");
      expect(specFileStem("CheckoutFlow")).toBe("checkout-flow.spec");
    });
  });

  describe("toJsIdentifier (v2.2.5 — BUG-9)", () => {
    it("passes valid identifiers unchanged", () => {
      expect(toJsIdentifier("usernameInput")).toBe("usernameInput");
      expect(toJsIdentifier("submitButton")).toBe("submitButton");
      expect(toJsIdentifier("_private")).toBe("_private");
      expect(toJsIdentifier("$dollar")).toBe("$dollar");
    });

    it("prefixes digit-leading identifiers with underscore (juice-shop case)", () => {
      // The exact production bug: camelCase('0 of 0') → '0Of0' which is
      // not a valid JS identifier and crashes the .spec.ts parse.
      expect(toJsIdentifier("0Of0")).toBe("_0Of0");
      expect(toJsIdentifier("1500Of0")).toBe("_1500Of0");
      expect(toJsIdentifier("123")).toBe("_123");
    });

    it("strips commas (juice-shop '1,500 of 0' case)", () => {
      // Some labels make it through with the comma preserved. The
      // resulting `0,0Of0` is invalid — comma is not an identifier char.
      expect(toJsIdentifier("0,0Of0")).toBe("_00Of0");
      expect(toJsIdentifier("foo,bar")).toBe("foobar");
    });

    it("strips arbitrary non-identifier characters", () => {
      expect(toJsIdentifier("foo-bar")).toBe("foobar");
      expect(toJsIdentifier("foo.bar")).toBe("foobar");
      expect(toJsIdentifier("foo bar baz")).toBe("foobarbaz");
      expect(toJsIdentifier("foo!@#$bar")).toBe("foo$bar"); // $ is allowed
    });

    it("returns _field for empty / all-punctuation input", () => {
      expect(toJsIdentifier("")).toBe("_field");
      expect(toJsIdentifier("---")).toBe("_field");
      expect(toJsIdentifier(",,,")).toBe("_field");
    });
  });
});
