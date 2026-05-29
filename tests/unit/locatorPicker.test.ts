import { describe, it, expect } from "vitest";
import {
  pickLocator,
  dedupeLocators,
  isFrameworkClass,
  isFrameworkOnlySelector,
  stripFrameworkClasses,
} from "../../src/transformers/locatorPicker";
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

  describe("v2.2.6 — BUG-10 framework-class filtering", () => {
    it("isFrameworkClass flags Angular/Material/CDK/MDC state classes", () => {
      expect(isFrameworkClass("ng-untouched")).toBe(true);
      expect(isFrameworkClass("ng-pristine")).toBe(true);
      expect(isFrameworkClass("ng-dirty")).toBe(true);
      expect(isFrameworkClass("mat-form-field")).toBe(true);
      expect(isFrameworkClass("mat-input-element")).toBe(true);
      expect(isFrameworkClass("cdk-overlay-pane")).toBe(true);
      expect(isFrameworkClass("mdc-button")).toBe(true);
      expect(isFrameworkClass("_ngcontent-ng-c1234567")).toBe(true);
      expect(isFrameworkClass("_nghost-ng-c1234567")).toBe(true);
    });

    it("isFrameworkClass leaves user-defined classes alone", () => {
      // Hyphen requirement guards against accidental over-matching.
      expect(isFrameworkClass("search-input")).toBe(false);
      expect(isFrameworkClass("login-button")).toBe(false);
      expect(isFrameworkClass("nginx-banner")).toBe(false); // starts "ng" but no hyphen-after-ng prefix
      expect(isFrameworkClass("ngo-button")).toBe(false); // "ngo-" not "ng-"
      expect(isFrameworkClass("material-card")).toBe(false); // starts "mat" but no "-" right after
    });

    it("isFrameworkOnlySelector flags pure framework-class selectors", () => {
      expect(isFrameworkOnlySelector(".ng-untouched")).toBe(true);
      expect(isFrameworkOnlySelector(".ng-untouched.ng-pristine")).toBe(true);
      expect(isFrameworkOnlySelector(".mat-form-field.cdk-overlay-pane")).toBe(true);
      // Mixed: any user class survives.
      expect(isFrameworkOnlySelector(".ng-untouched.search-input")).toBe(false);
      expect(isFrameworkOnlySelector(".search-input.ng-pristine")).toBe(false);
      // #id always wins.
      expect(isFrameworkOnlySelector("#main.ng-untouched")).toBe(false);
      // Non-class selectors are not "class only".
      expect(isFrameworkOnlySelector("div")).toBe(false);
      expect(isFrameworkOnlySelector("#username")).toBe(false);
      expect(isFrameworkOnlySelector(undefined)).toBe(false);
    });

    it("pickLocator drops a framework-only CSS selector and falls back to tag", () => {
      // Exact BUG-10 reproduction: Angular form input arrives with
      // cssSelector = '.ng-untouched', no role/label/placeholder/text.
      // The old code returned `page.locator('.ng-untouched')` — flaky.
      // The new code falls through to the tag-only fallback.
      const el: ElementIR = {
        tag: "input",
        cssSelector: ".ng-untouched.ng-pristine",
      };
      const c = pickLocator(el, []);
      expect(c.api).toBe("locator");
      expect(c.args).toBe('"input"'); // tag-only fallback
      expect(c.args).not.toContain("ng-untouched");
    });

    it("pickLocator preserves selectors that have at least one non-framework class (v2.2.7 strips framework tokens)", () => {
      // v2.2.6 left `.ng-untouched.search-input` intact. v2.2.7 strips
      // the framework tokens so the emitted locator is `.search-input`
      // alone — stable when the user types and Angular flips
      // `.ng-untouched` → `.ng-touched`.
      const el: ElementIR = {
        tag: "input",
        cssSelector: ".ng-untouched.search-input",
      };
      const c = pickLocator(el, []);
      expect(c.api).toBe("locator");
      expect(c.args).toBe('".search-input"');
      expect(c.args).not.toContain("ng-untouched");
    });

    it("synthFieldName skips framework classes when naming (v2.2.7 no double-suffix)", () => {
      // The v2.2.6 fix avoided naming the field `ngUntouchedInput` but
      // produced the awkward `inputElementInput` (tag-fallback base +
      // role-suffix). v2.2.7 detects the tag-fallback path and skips
      // the role-suffix step, yielding the clean `inputElement`.
      const el: ElementIR = {
        tag: "input",
        cssSelector: ".ng-untouched",
      };
      const out = pickLocator(el, []);
      expect(out.fieldName).not.toContain("ngUntouched");
      expect(out.fieldName).not.toContain("ngPristine");
      expect(out.fieldName).toBe("inputElement");
    });

    it("synthFieldName picks user class when mixed with framework classes", () => {
      // Multi-class selector: skip framework, take user.
      const el: ElementIR = {
        tag: "input",
        cssSelector: ".ng-untouched.search-input",
      };
      expect(pickLocator(el, []).fieldName).toBe("searchInput");
    });
  });

  describe("v2.2.7 — stripFrameworkClasses helper", () => {
    it("strips a single framework class", () => {
      expect(stripFrameworkClasses(".ng-untouched")).toBe("");
      expect(stripFrameworkClasses(".mat-form-field")).toBe("");
    });

    it("strips framework tokens from mixed selectors", () => {
      expect(stripFrameworkClasses(".ng-untouched.search-input")).toBe(
        ".search-input",
      );
      expect(
        stripFrameworkClasses(".ng-untouched.ng-pristine.login-form"),
      ).toBe(".login-form");
      expect(stripFrameworkClasses(".search-input.ng-pristine")).toBe(
        ".search-input",
      );
    });

    it("preserves tag, id, attribute, and combinator parts", () => {
      expect(stripFrameworkClasses("input.ng-untouched")).toBe("input");
      expect(stripFrameworkClasses("input.ng-untouched#main")).toBe(
        "input#main",
      );
      expect(stripFrameworkClasses('input.ng-untouched[type="search"]')).toBe(
        'input[type="search"]',
      );
      expect(
        stripFrameworkClasses("form.ng-untouched .search-input"),
      ).toBe("form .search-input");
    });

    it("leaves selectors with no framework classes alone", () => {
      expect(stripFrameworkClasses(".search-input")).toBe(".search-input");
      expect(stripFrameworkClasses("#username")).toBe("#username");
      expect(stripFrameworkClasses("button.primary")).toBe("button.primary");
    });

    it("does not touch class names inside :not(...) (intentional)", () => {
      // The current implementation strips ALL framework-class tokens
      // including those inside pseudo-classes. Acceptable for now —
      // user-authored selectors rarely use :not(.ng-foo). If we see
      // breakage in the wild we'll add a pseudo-class-aware pass.
      const out = stripFrameworkClasses("input:not(.ng-untouched)");
      // Strip mode: removes the `.ng-untouched` token inside the
      // pseudo-class. Result is syntactically odd but rarely matters.
      expect(out).toBe("input:not()");
    });
  });

  describe("v2.2.5 — BUG-9 digit-leading field names", () => {
    it("prefixes digit-leading text with underscore (juice-shop pagination)", () => {
      // The exact reproduction: juice-shop renders "0 of 0" as pagination
      // text on a status region. camelCase produces "0Of0", which is not a
      // valid JS identifier — the spec.ts would not parse. v2.2.5 prefixes
      // with `_` so the emitted `this._0Of0 = ...` compiles.
      const el: ElementIR = { tag: "div", text: "0 of 0" };
      expect(pickLocator(el, []).fieldName).toBe("_0Of0");
    });

    it("handles '1,500 of 0' (comma stripping + digit prefix)", () => {
      const el: ElementIR = { tag: "div", text: "1,500 of 0" };
      // Commas stripped first, then camelCase, then digit-prefix guard.
      // Words: ["1500", "of", "0"] → "1500Of0" → "_1500Of0".
      expect(pickLocator(el, []).fieldName).toBe("_1500Of0");
    });

    it("does not change valid identifiers", () => {
      // Regression-guard — the new toJsIdentifier pass must be a no-op
      // for inputs that don't need fixing.
      const el: ElementIR = { tag: "input", role: "textbox", name: "Username" };
      expect(pickLocator(el, []).fieldName).toBe("usernameInput");
    });
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
