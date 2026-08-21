/**
 * v4.1.0 — binding rewriter for the OpenAI invented-helper pattern.
 *
 * OpenAI gpt-4o-mini emits `pomCall` shapes like:
 *   {"page":"loginPage","method":"fill","args":["loginPage.usernameInput","\"x\""]}
 * treating the POM as if it had a generic `fill(locator, value)` helper.
 * The v4.0.1 rejector correctly identified this as invalid and dropped
 * the binding as TODO. v4.1 rewrites the pattern into the equivalent
 * chained form (`{method:"usernameInput.fill", args:["\"x\""]}`) so
 * OpenAI runs actually close scenarios instead of landing everything
 * as TODO.
 *
 * The rewriter is fail-safe: if the pattern doesn't match, the v4.0.1
 * rejector still runs, preserving the fail-closed guarantee.
 */

import { describe, expect, it } from "vitest";
import {
  parseBindingJson,
  tryRewriteInventedHelper,
} from "../../src/llm/anthropicClient";
import type { GenerateBindingInput } from "../../src/llm/types";
import type { PageObjectIR } from "../../src/types";

const POM: PageObjectIR = {
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
    {
      api: "getByRole",
      args: '"button", { name: "Sign in" }',
      fieldName: "signInButton",
      source: { tag: "button" },
      confidence: "unique",
    },
  ],
  methods: [{ name: "goto", params: [], body: "", origin: "generated" }],
  exists: false,
};

const STEP: GenerateBindingInput = {
  step: { keyword: "When", text: "I enter my username" },
  pom: POM,
  pageVar: "loginPage",
  scaffoldId: "scaffold-test",
};

const KNOWN_FIELDS = new Set([
  "page",
  "usernameInput",
  "passwordInput",
  "signInButton",
]);
const KNOWN_METHODS = new Set(["goto"]);

describe("v4.1.0 — tryRewriteInventedHelper (unit)", () => {
  it("rewrites fill(pomVar.field, value) → field.fill(value)", () => {
    const pomCall = {
      page: "loginPage",
      method: "fill",
      args: ["loginPage.usernameInput", '"standard_user"'],
    };
    const rewritten = tryRewriteInventedHelper(
      pomCall,
      "loginPage",
      KNOWN_FIELDS,
      KNOWN_METHODS,
    );
    expect(rewritten).toBe(true);
    expect(pomCall.method).toBe("usernameInput.fill");
    expect(pomCall.args).toEqual(['"standard_user"']);
  });

  it("rewrites click(pomVar.field) → field.click() with no args", () => {
    const pomCall = {
      page: "loginPage",
      method: "click",
      args: ["loginPage.signInButton"],
    };
    const rewritten = tryRewriteInventedHelper(
      pomCall,
      "loginPage",
      KNOWN_FIELDS,
      KNOWN_METHODS,
    );
    expect(rewritten).toBe(true);
    expect(pomCall.method).toBe("signInButton.click");
    expect(pomCall.args).toEqual([]);
  });

  it("rewrites type(pomVar.field, value) → field.type(value)", () => {
    const pomCall = {
      page: "loginPage",
      method: "type",
      args: ["loginPage.usernameInput", '"user"', "{ delay: 50 }"],
    };
    const rewritten = tryRewriteInventedHelper(
      pomCall,
      "loginPage",
      KNOWN_FIELDS,
      KNOWN_METHODS,
    );
    expect(rewritten).toBe(true);
    expect(pomCall.method).toBe("usernameInput.type");
    expect(pomCall.args).toEqual(['"user"', "{ delay: 50 }"]);
  });

  it("does NOT rewrite when method is outside the allowlist", () => {
    // "foo" isn't in LOCATOR_METHOD_ALLOWLIST — leave as-is for the
    // v4.0.1 rejector to catch as a hallucination.
    const pomCall = {
      page: "loginPage",
      method: "foo",
      args: ["loginPage.usernameInput", '"x"'],
    };
    const rewritten = tryRewriteInventedHelper(
      pomCall,
      "loginPage",
      KNOWN_FIELDS,
      KNOWN_METHODS,
    );
    expect(rewritten).toBe(false);
    expect(pomCall.method).toBe("foo");
  });

  it("does NOT rewrite when method IS a known POM method (e.g. goto)", () => {
    // `goto` is a legitimate POM method; don't touch it even if the
    // first arg happens to reference a field.
    const pomCall = {
      page: "loginPage",
      method: "goto",
      args: ["loginPage.usernameInput"],
    };
    const rewritten = tryRewriteInventedHelper(
      pomCall,
      "loginPage",
      KNOWN_FIELDS,
      KNOWN_METHODS,
    );
    expect(rewritten).toBe(false);
    expect(pomCall.method).toBe("goto");
  });

  it("does NOT rewrite when first arg isn't `pomVar.<field>`", () => {
    // First arg is a bare string, not a field access.
    const pomCall = {
      page: "loginPage",
      method: "fill",
      args: ['"standard_user"', '"password"'],
    };
    const rewritten = tryRewriteInventedHelper(
      pomCall,
      "loginPage",
      KNOWN_FIELDS,
      KNOWN_METHODS,
    );
    expect(rewritten).toBe(false);
    expect(pomCall.method).toBe("fill");
  });

  it("does NOT rewrite when field isn't declared on the POM", () => {
    // `emailInput` is not in KNOWN_FIELDS — falls through to v4.0.1
    // rejector which would drop the binding as TODO.
    const pomCall = {
      page: "loginPage",
      method: "fill",
      args: ["loginPage.emailInput", '"x"'],
    };
    const rewritten = tryRewriteInventedHelper(
      pomCall,
      "loginPage",
      KNOWN_FIELDS,
      KNOWN_METHODS,
    );
    expect(rewritten).toBe(false);
    expect(pomCall.method).toBe("fill");
  });

  it("does NOT rewrite when first arg references `page` (built-in, not POM field)", () => {
    // `page` is in knownFields for chain-detection but pointing an
    // invented-helper rewrite at the built-in Playwright page would
    // produce broken code (`page.fill("x")` is not valid on Page).
    const pomCall = {
      page: "loginPage",
      method: "fill",
      args: ["loginPage.page", '"x"'],
    };
    const rewritten = tryRewriteInventedHelper(
      pomCall,
      "loginPage",
      KNOWN_FIELDS,
      KNOWN_METHODS,
    );
    expect(rewritten).toBe(false);
  });

  it("does NOT rewrite when args array is empty", () => {
    const pomCall = {
      page: "loginPage",
      method: "fill",
      args: [],
    };
    const rewritten = tryRewriteInventedHelper(
      pomCall,
      "loginPage",
      KNOWN_FIELDS,
      KNOWN_METHODS,
    );
    expect(rewritten).toBe(false);
  });

  it("does NOT rewrite when first arg is `pomVar.field.something` (chain)", () => {
    // Chain like `loginPage.usernameInput.first()` is more complex —
    // conservative: don't rewrite, let LLM correct next time.
    const pomCall = {
      page: "loginPage",
      method: "fill",
      args: ["loginPage.usernameInput.first()", '"x"'],
    };
    const rewritten = tryRewriteInventedHelper(
      pomCall,
      "loginPage",
      KNOWN_FIELDS,
      KNOWN_METHODS,
    );
    expect(rewritten).toBe(false);
  });

  it("handles pomVar with regex-special characters (escaping)", () => {
    const pomCall = {
      page: "login.page",
      method: "fill",
      args: ["login.page.usernameInput", '"x"'],
    };
    const rewritten = tryRewriteInventedHelper(
      pomCall,
      "login.page",
      KNOWN_FIELDS,
      KNOWN_METHODS,
    );
    expect(rewritten).toBe(true);
    expect(pomCall.method).toBe("usernameInput.fill");
  });
});

describe("v4.1.0 — parseBindingJson end-to-end (integration)", () => {
  it("previously-rejected OpenAI invented-helper now compiles cleanly", () => {
    // Exact shape from the v4.0 OpenAI bench run on SauceDemo.
    const openAiEmission = JSON.stringify({
      pomCall: {
        page: "loginPage",
        method: "fill",
        args: ["loginPage.usernameInput", '"standard_user"'],
      },
    });
    const binding = parseBindingJson(openAiEmission, STEP);
    // Before v4.1 this returned undefined; after v4.1 it returns a
    // valid binding with the chained-form method.
    expect(binding).toBeDefined();
    expect(binding?.pomCall?.method).toBe("usernameInput.fill");
    expect(binding?.pomCall?.args).toEqual(['"standard_user"']);
  });

  it("click emission with single field arg is rewritten and accepted", () => {
    const openAiEmission = JSON.stringify({
      pomCall: {
        page: "loginPage",
        method: "click",
        args: ["loginPage.signInButton"],
      },
    });
    const binding = parseBindingJson(openAiEmission, STEP);
    expect(binding).toBeDefined();
    expect(binding?.pomCall?.method).toBe("signInButton.click");
    expect(binding?.pomCall?.args).toEqual([]);
  });

  it("un-rewritable invented-helper still lands as TODO (fail-closed preserved)", () => {
    // `fill(page.getByLabel("Email"), "x")` — first arg is neither a
    // known field nor a `pomVar.field` reference; falls through to
    // v4.0.1 rejector which drops it.
    const openAiEmission = JSON.stringify({
      pomCall: {
        page: "loginPage",
        method: "fill",
        args: ['page.getByLabel("Email")', '"x"'],
      },
    });
    const binding = parseBindingJson(openAiEmission, STEP);
    expect(binding).toBeUndefined();
  });

  it("valid chained-form emission is unaffected", () => {
    // Anthropic's typical shape — already correct. Rewriter must not
    // interfere.
    const anthropicEmission = JSON.stringify({
      pomCall: {
        page: "loginPage",
        method: "usernameInput.fill",
        args: ['"standard_user"'],
      },
    });
    const binding = parseBindingJson(anthropicEmission, STEP);
    expect(binding).toBeDefined();
    expect(binding?.pomCall?.method).toBe("usernameInput.fill");
    expect(binding?.pomCall?.args).toEqual(['"standard_user"']);
  });
});

describe("v4.1.0 — Pattern B (bare-field arg + unquoted value)", () => {
  it("rewrites {method:'fill', args:['field','user@host']} and auto-quotes email", () => {
    const pomCall = {
      page: "loginPage",
      method: "fill",
      args: ["usernameInput", "bench@example.com"],
    };
    const ok = tryRewriteInventedHelper(
      pomCall,
      "loginPage",
      KNOWN_FIELDS,
      KNOWN_METHODS,
    );
    expect(ok).toBe(true);
    expect(pomCall.method).toBe("usernameInput.fill");
    expect(pomCall.args).toEqual(['"bench@example.com"']);
  });

  it("pre-quoted Pattern B value is not double-quoted (idempotent)", () => {
    const pomCall = {
      page: "loginPage",
      method: "fill",
      args: ["usernameInput", '"already_quoted"'],
    };
    const ok = tryRewriteInventedHelper(
      pomCall,
      "loginPage",
      KNOWN_FIELDS,
      KNOWN_METHODS,
    );
    expect(ok).toBe(true);
    expect(pomCall.args).toEqual(['"already_quoted"']);
  });

  it("click with just a bare field arg becomes field.click()", () => {
    const pomCall = {
      page: "loginPage",
      method: "click",
      args: ["signInButton"],
    };
    const ok = tryRewriteInventedHelper(
      pomCall,
      "loginPage",
      KNOWN_FIELDS,
      KNOWN_METHODS,
    );
    expect(ok).toBe(true);
    expect(pomCall.method).toBe("signInButton.click");
    expect(pomCall.args).toEqual([]);
  });

  it("text-with-spaces value is auto-quoted", () => {
    const pomCall = {
      page: "loginPage",
      method: "fill",
      args: ["usernameInput", "some plain text"],
    };
    const ok = tryRewriteInventedHelper(
      pomCall,
      "loginPage",
      KNOWN_FIELDS,
      KNOWN_METHODS,
    );
    expect(ok).toBe(true);
    expect(pomCall.args).toEqual(['"some plain text"']);
  });

  it("reserved literal 'true' is NOT wrapped", () => {
    const pomCall = {
      page: "loginPage",
      method: "check",
      args: ["usernameInput", "true"],
    };
    const ok = tryRewriteInventedHelper(
      pomCall,
      "loginPage",
      KNOWN_FIELDS,
      KNOWN_METHODS,
    );
    expect(ok).toBe(true);
    expect(pomCall.args).toEqual(["true"]);
  });

  it("identifier-chain value 'data.email' NOT wrapped (property access = variable)", () => {
    const pomCall = {
      page: "loginPage",
      method: "fill",
      args: ["usernameInput", "data.email"],
    };
    const ok = tryRewriteInventedHelper(
      pomCall,
      "loginPage",
      KNOWN_FIELDS,
      KNOWN_METHODS,
    );
    expect(ok).toBe(true);
    expect(pomCall.args).toEqual(["data.email"]);
  });

  it("single bare identifier IS wrapped (v4.1 SauceDemo fix)", () => {
    // The LLM emitted `fill(locked_out_user)` when the Gherkin step
    // said `I enter "locked_out_user"`. v4.1 auto-wraps to prevent
    // the undefined-reference TS compile error.
    const pomCall = {
      page: "loginPage",
      method: "fill",
      args: ["usernameInput", "locked_out_user"],
    };
    const ok = tryRewriteInventedHelper(
      pomCall,
      "loginPage",
      KNOWN_FIELDS,
      KNOWN_METHODS,
    );
    expect(ok).toBe(true);
    expect(pomCall.args).toEqual(['"locked_out_user"']);
  });

  it("number literal '42' stays unwrapped (not a string)", () => {
    const pomCall = {
      page: "loginPage",
      method: "fill",
      args: ["usernameInput", "42"],
    };
    const ok = tryRewriteInventedHelper(
      pomCall,
      "loginPage",
      KNOWN_FIELDS,
      KNOWN_METHODS,
    );
    expect(ok).toBe(true);
    expect(pomCall.args).toEqual(["42"]);
  });

  it("integration: AutomationPractice Pattern B failure now recovers cleanly", () => {
    const emission = JSON.stringify({
      pomCall: {
        page: "loginPage",
        method: "fill",
        args: ["usernameInput", "bench@example.com"],
      },
    });
    const binding = parseBindingJson(emission, STEP);
    expect(binding).toBeDefined();
    expect(binding?.pomCall?.method).toBe("usernameInput.fill");
    expect(binding?.pomCall?.args).toEqual(['"bench@example.com"']);
  });
});
