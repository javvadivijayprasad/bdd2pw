import { describe, it, expect } from "vitest";
import { pickLocator, dedupeLocators } from "../../src/transformers/locatorPicker";
import type { ElementIR } from "../../src/types";

describe("pickLocator priority chain", () => {
  it("getByRole when role + name are present", () => {
    const el: ElementIR = { tag: "button", role: "button", name: "Sign in" };
    const c = pickLocator(el, [el]);
    expect(c.api).toBe("getByRole");
    // pickLocator uses JSON.stringify → double-quoted string literals
    expect(c.args).toContain('"button"');
    expect(c.args).toContain('"Sign in"');
    expect(c.confidence).toBe("unique");
  });

  it("getByLabel when label is present and no role/name", () => {
    const el: ElementIR = { tag: "input", label: "Username" };
    const c = pickLocator(el, [el]);
    expect(c.api).toBe("getByLabel");
    expect(c.args).toBe('"Username"');
  });

  it("getByPlaceholder when only placeholder is present", () => {
    const el: ElementIR = { tag: "input", placeholder: "Search…" };
    const c = pickLocator(el, [el]);
    expect(c.api).toBe("getByPlaceholder");
  });

  it("getByTestId when only testId is present", () => {
    const el: ElementIR = { tag: "div", testId: "user-card" };
    const c = pickLocator(el, [el]);
    expect(c.api).toBe("getByTestId");
  });

  it("falls back to css then xpath then tag", () => {
    expect(pickLocator({ tag: "div", cssSelector: ".x" }, []).api).toBe("locator");
    expect(pickLocator({ tag: "div", xpath: "//div" }, []).args).toContain("xpath=");
    expect(pickLocator({ tag: "div" }, []).api).toBe("locator");
  });

  it("ambiguous when multiple elements share the same role + name", () => {
    const a: ElementIR = { tag: "button", role: "button", name: "OK" };
    const b: ElementIR = { tag: "button", role: "button", name: "OK" };
    const c = pickLocator(a, [a, b]);
    expect(c.confidence).toBe("ambiguous");
  });

  it("synthesises field names with role-based suffixes", () => {
    expect(pickLocator({ tag: "input", role: "textbox", name: "Username" }, []).fieldName).toBe(
      "usernameInput",
    );
    expect(pickLocator({ tag: "button", role: "button", name: "Sign in" }, []).fieldName).toBe(
      "signInButton",
    );
  });
});

describe("dedupeLocators", () => {
  it("suffixes collisions with a numeric index", () => {
    const out = dedupeLocators([
      { api: "locator", args: "'#a'", fieldName: "foo", source: { tag: "" }, confidence: "unique" },
      { api: "locator", args: "'#b'", fieldName: "foo", source: { tag: "" }, confidence: "unique" },
      { api: "locator", args: "'#c'", fieldName: "foo", source: { tag: "" }, confidence: "unique" },
    ]);
    expect(out.map((c) => c.fieldName)).toEqual(["foo", "foo2", "foo3"]);
  });
});
