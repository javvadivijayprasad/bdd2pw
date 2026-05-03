import { describe, it, expect } from "vitest";
import {
  pascalCase,
  camelCase,
  kebabCase,
  snakeCase,
  pageObjectFileStem,
  specFileStem,
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
});
