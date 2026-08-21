/**
 * Unit tests for the LLM module — v2.0.
 *
 * No real provider calls. We use a MockLLMClient that returns scripted
 * bindings for given step text, plus an in-memory cache and a temp-dir
 * candidate-rules writer. The real AnthropicLLMClient is exercised in the
 * e2e tests where a fixture LLM response is patched in.
 *
 * Tests focus on:
 *   - parseBindingJson handles fenced/clean JSON, rejects malformed
 *   - matchStepWithLLM falls back only when rules return a warning
 *   - matchStepWithLLM returns rule binding unchanged when rules win
 *   - candidate-rules.jsonl gets one entry per LLM-success
 *   - LLM error → original warning preserved + decorated
 *   - Budget exhaustion → no LLM call, warning preserved
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { matchStepWithLLM } from "../../src/llm/llmStepMatcher";
import { CandidateRulesWriter } from "../../src/llm/candidateRules";
import {
  parseBindingJson,
  rewriteBareContext,
  detectHallucinatedLocators,
} from "../../src/llm/anthropicClient";
import type {
  GenerateBindingInput,
  GenerateBindingResult,
  LLMClient,
} from "../../src/llm/types";
import type { PageObjectIR, StepBinding, StepIR } from "../../src/types";

// ────────────────────────────────────────────────────────────────────────
// MockLLMClient — scripted responses for tests.
// ────────────────────────────────────────────────────────────────────────

class MockLLMClient implements LLMClient {
  public calls: GenerateBindingInput[] = [];
  private bindings = new Map<string, StepBinding>();
  private errors = new Map<string, string>();
  private maxCalls: number;
  constructor(maxCalls = 50) {
    this.maxCalls = maxCalls;
  }
  scriptBinding(stepText: string, binding: StepBinding) {
    this.bindings.set(stepText, binding);
  }
  scriptError(stepText: string, error: string) {
    this.errors.set(stepText, error);
  }
  async generateBinding(
    input: GenerateBindingInput,
  ): Promise<GenerateBindingResult> {
    this.calls.push(input);
    const err = this.errors.get(input.step.text);
    if (err) {
      return { error: err, fromCache: false };
    }
    const binding = this.bindings.get(input.step.text);
    if (binding) {
      return {
        binding,
        fromCache: false,
        model: "mock-model",
        latencyMs: 5,
      };
    }
    return { error: "no scripted response", fromCache: false };
  }
  budgetExhausted(): boolean {
    return this.calls.length >= this.maxCalls;
  }
  callsMade(): number {
    return this.calls.length;
  }
  async close(): Promise<void> {
    /* no-op */
  }
}

// Reusable fixtures.
const pom: PageObjectIR = {
  className: "LoginPage",
  filePath: "pages/login.page.ts",
  fields: [
    {
      api: "getByLabel",
      args: "'Username'",
      fieldName: "usernameInput",
      source: { tag: "input" },
      confidence: "unique",
    },
    {
      api: "getByLabel",
      args: "'Password'",
      fieldName: "passwordInput",
      source: { tag: "input" },
      confidence: "unique",
    },
  ],
  methods: [],
  exists: false,
};
function step(keyword: StepIR["keyword"], text: string): StepIR {
  return { keyword, text };
}

// ────────────────────────────────────────────────────────────────────────
// parseBindingJson
// ────────────────────────────────────────────────────────────────────────

describe("parseBindingJson", () => {
  const stub: GenerateBindingInput = {
    step: step("When", "I do a thing"),
    pom,
    pageVar: "loginPage",
    scaffoldId: "test-1",
  };

  it("accepts clean JSON with pomCall", () => {
    const out = parseBindingJson(
      JSON.stringify({
        step: { keyword: "When", text: "I do a thing" },
        pomCall: { page: "loginPage", method: "usernameInput.fill", args: ['"x"'] },
      }),
      stub,
    );
    expect(out?.pomCall?.method).toBe("usernameInput.fill");
  });

  it("strips ```json fences and parses", () => {
    const out = parseBindingJson(
      '```json\n{"step":{"keyword":"When","text":"I do a thing"},"pomCall":{"page":"loginPage","method":"usernameInput.fill","args":["\\"x\\""]}}\n```',
      stub,
    );
    expect(out?.pomCall?.method).toBe("usernameInput.fill");
  });

  it("rejects malformed JSON", () => {
    expect(parseBindingJson("not json at all", stub)).toBeUndefined();
  });

  it("rejects empty bindings (no pomCall/assertion/customBody/warning)", () => {
    expect(
      parseBindingJson('{"step":{"keyword":"When","text":"x"}}', stub),
    ).toBeUndefined();
  });

  it("v2.2.2 — rewrites bare context.X to page.context().X in customBody", () => {
    const out = parseBindingJson(
      JSON.stringify({
        step: { keyword: "Given", text: "no session cookies" },
        customBody: "await context.clearCookies();",
      }),
      stub,
    );
    // The test fixture only injects `page`. Bare `context.` is a
    // ReferenceError; rewrite to `page.context().`.
    expect(out?.customBody).toBe("await page.context().clearCookies();");
  });

  it("v2.2.2 — rewriteBareContext handles common cases", () => {
    expect(rewriteBareContext("await context.clearCookies();")).toBe(
      "await page.context().clearCookies();",
    );
    expect(rewriteBareContext("await context.clearPermissions();")).toBe(
      "await page.context().clearPermissions();",
    );
    // Doesn't rewrite word-internal matches (pageContext, someContext, etc.)
    expect(rewriteBareContext("const pageContext = page.context();")).toBe(
      "const pageContext = page.context();",
    );
    // Handles browser. too
    expect(rewriteBareContext("await browser.close();")).toBe(
      "await page.context().browser().close();",
    );
  });

  it("v2.2.3 — detectHallucinatedLocators flags invented page.getBy* methods", () => {
    // Real methods are clean.
    expect(detectHallucinatedLocators("page.getByRole('button')")).toEqual([]);
    expect(detectHallucinatedLocators("page.getByLabel('Username')")).toEqual(
      [],
    );
    expect(detectHallucinatedLocators("page.getByText('Hello').first()")).toEqual(
      [],
    );
    expect(
      detectHallucinatedLocators("page.getByTestId('login-btn')"),
    ).toEqual([]);
    expect(detectHallucinatedLocators("page.getByAltText('logo')")).toEqual([]);
    expect(
      detectHallucinatedLocators("page.getByPlaceholder('Email')"),
    ).toEqual([]);
    expect(detectHallucinatedLocators("page.getByTitle('Submit')")).toEqual([]);

    // Hallucinated — the actual production bug from BUG-6.
    expect(detectHallucinatedLocators("page.getByURL(/dashboard/)")).toEqual([
      "getByURL",
    ]);
    // Other plausible-but-fake variants we've seen the LLM invent.
    expect(detectHallucinatedLocators("page.getByPath('/login')")).toEqual([
      "getByPath",
    ]);
    expect(detectHallucinatedLocators("page.getByHref('/about')")).toEqual([
      "getByHref",
    ]);
    expect(detectHallucinatedLocators("page.getByLink('Home')")).toEqual([
      "getByLink",
    ]);

    // Multiple hits in one string.
    const hits = detectHallucinatedLocators(
      "expect(page.getByURL(/x/)).toBeVisible(); expect(page.getByPath('/y')).toBeVisible();",
    );
    expect(hits.sort()).toEqual(["getByPath", "getByURL"]);

    // Doesn't false-positive on non-page receivers (locator.getByXxx
    // chaining is fine even if the inner method is unusual — Playwright
    // exposes the same factory set on Locator, and we only police `page.*`).
    expect(
      detectHallucinatedLocators("loginPage.usernameInput.getByURL('x')"),
    ).toEqual([]);
  });

  it("v2.2.3 — rejects bindings whose assertion.locator uses page.getByURL", () => {
    // Exact reproduction of BUG-6: LLM emits an assertion with a
    // hallucinated `page.getByURL(...)` locator. The binding must be
    // refused entirely so the step lands as a TODO instead of breaking
    // the spec at runtime with "Cannot read properties of undefined".
    const out = parseBindingJson(
      JSON.stringify({
        step: { keyword: "Then", text: "I see the dashboard URL" },
        assertion: {
          locator: "page.getByURL(/dashboard/)",
          matcher: "toBeVisible",
        },
      }),
      stub,
    );
    expect(out).toBeUndefined();
  });

  it("v2.2.3 — rejects bindings whose customBody contains a hallucinated locator", () => {
    const out = parseBindingJson(
      JSON.stringify({
        step: { keyword: "When", text: "I navigate to the dashboard" },
        customBody:
          "await expect(page.getByURL(/dashboard/)).toBeVisible();",
      }),
      stub,
    );
    expect(out).toBeUndefined();
  });

  it("v2.2.3 — rejects bindings whose pomCall arg references page.getByURL", () => {
    const out = parseBindingJson(
      JSON.stringify({
        step: { keyword: "When", text: "I click the dashboard URL" },
        pomCall: {
          page: "loginPage",
          method: "page.click",
          args: ["page.getByURL('/dashboard')"],
        },
      }),
      stub,
    );
    expect(out).toBeUndefined();
  });

  it("v2.2.3 — accepts bindings with only real page.getBy* methods", () => {
    // Defensive: the rejection logic must NOT trip on valid Playwright
    // methods. Regression-guards that detectHallucinatedLocators's
    // allowlist is wired correctly into parseBindingJson.
    const out = parseBindingJson(
      JSON.stringify({
        step: { keyword: "Then", text: "I see the heading" },
        assertion: {
          locator: "page.getByRole('heading')",
          matcher: "toBeVisible",
        },
      }),
      stub,
    );
    expect(out?.assertion?.matcher).toBe("toBeVisible");
    expect(out?.assertion?.locator).toBe("page.getByRole('heading')");
  });

  it("v2.2.4 — normalises empty locator to 'page' for toHaveURL (BUG-7)", () => {
    // Exact reproduction of BUG-7: LLM follows the v2.2.3 prompt and
    // emits an empty-string locator. Without this normalisation the
    // renderer produces `await expect().toHaveURL(...)` which throws
    // TypeError on every URL-asserting spec.
    const out = parseBindingJson(
      JSON.stringify({
        step: { keyword: "Then", text: "I am on the dashboard" },
        assertion: {
          locator: "",
          matcher: "toHaveURL",
          expected: 'new RegExp("/dashboard")',
        },
      }),
      stub,
    );
    expect(out?.assertion?.locator).toBe("page");
    expect(out?.assertion?.matcher).toBe("toHaveURL");
  });

  it("v2.2.4 — normalises missing locator to 'page' for toHaveURL", () => {
    // The LLM occasionally omits the locator field entirely.
    const out = parseBindingJson(
      JSON.stringify({
        step: { keyword: "Then", text: "I am on the dashboard" },
        assertion: {
          matcher: "toHaveURL",
          expected: 'new RegExp("/dashboard")',
        },
      }),
      stub,
    );
    expect(out?.assertion?.locator).toBe("page");
  });

  it("v2.2.4 — normalises whitespace-only locator to 'page'", () => {
    const out = parseBindingJson(
      JSON.stringify({
        step: { keyword: "Then", text: "title check" },
        assertion: {
          locator: "   ",
          matcher: "toHaveTitle",
          expected: '"Dashboard"',
        },
      }),
      stub,
    );
    expect(out?.assertion?.locator).toBe("page");
    expect(out?.assertion?.matcher).toBe("toHaveTitle");
  });

  it("v2.2.4 — handles not.toHaveURL and not.toHaveTitle", () => {
    const a = parseBindingJson(
      JSON.stringify({
        step: { keyword: "Then", text: "no longer on login" },
        assertion: {
          locator: "",
          matcher: "not.toHaveURL",
          expected: 'new RegExp("/login")',
        },
      }),
      stub,
    );
    expect(a?.assertion?.locator).toBe("page");

    const b = parseBindingJson(
      JSON.stringify({
        step: { keyword: "Then", text: "title is not login" },
        assertion: {
          locator: "",
          matcher: "not.toHaveTitle",
          expected: '"Login"',
        },
      }),
      stub,
    );
    expect(b?.assertion?.locator).toBe("page");
  });

  it("v4.1.0 — rejects assertion when locator defaults to 'page' AND matcher is Locator-only", () => {
    // v2.2.4 originally defaulted locator to "page" and hoped the matcher
    // would fire correctly. In practice, `expect(page).toBeVisible()` /
    // `.toHaveText()` / `.toContainText()` do NOT compile — these are
    // Locator-only matchers. v4.1 Pattern F tightens: if resolved
    // locator is "page" and matcher isn't one of the Page-valid set
    // (toHaveURL, toHaveTitle, toHaveScreenshot), the assertion is
    // dropped and the step lands as TODO.
    const out = parseBindingJson(
      JSON.stringify({
        step: { keyword: "Then", text: "some assertion" },
        assertion: {
          locator: "",
          matcher: "toBeVisible",
        },
      }),
      stub,
    );
    // Assertion dropped → whole binding is empty → returns undefined.
    expect(out).toBeUndefined();
  });

  it("v2.2.4 — leaves non-empty locators unchanged", () => {
    // Regression guard for the normalisation: it must only touch empty/
    // whitespace input. A real locator string passes through verbatim.
    const out = parseBindingJson(
      JSON.stringify({
        step: { keyword: "Then", text: "see heading" },
        assertion: {
          locator: "loginPage.usernameInput",
          matcher: "toBeVisible",
        },
      }),
      stub,
    );
    expect(out?.assertion?.locator).toBe("loginPage.usernameInput");
  });

  it("preserves the input step text rather than the LLM's echo", () => {
    // LLM might capitalise or reword — we always echo the original.
    // Use a Page-valid matcher (toHaveURL) so Pattern F doesn't
    // reject the assertion — this test is checking step echo, not
    // matcher validation.
    const out = parseBindingJson(
      JSON.stringify({
        step: { keyword: "When", text: "I DO A THING" }, // LLM mangled
        assertion: { locator: "page", matcher: "toHaveURL", expected: '"/x"' },
      }),
      stub,
    );
    expect(out?.step.text).toBe("I do a thing");
  });
});

// ────────────────────────────────────────────────────────────────────────
// matchStepWithLLM
// ────────────────────────────────────────────────────────────────────────

describe("matchStepWithLLM", () => {
  let tmpDir: string;
  let writer: CandidateRulesWriter;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bdd2pw-llm-"));
    writer = new CandidateRulesWriter(tmpDir);
  });

  it("returns rule-based binding unchanged when a rule matches", async () => {
    const llm = new MockLLMClient();
    const out = await matchStepWithLLM(
      // Rule 2b matches this — no LLM call expected.
      step("When", 'I enter username "alice"'),
      pom,
      "loginPage",
      { llm, candidates: writer, scaffoldId: "test" },
    );
    expect(out.pomCall?.method).toBe("usernameInput.fill");
    expect(llm.callsMade()).toBe(0);
  });

  it("falls back to LLM when no rule matches", async () => {
    const llm = new MockLLMClient();
    const fakeStep = step("When", "I summon a unicorn from the void");
    llm.scriptBinding(fakeStep.text, {
      step: fakeStep,
      pomCall: {
        page: "loginPage",
        method: "usernameInput.fill",
        args: ['"unicorn"'],
      },
    });
    const out = await matchStepWithLLM(fakeStep, pom, "loginPage", {
      llm,
      candidates: writer,
      scaffoldId: "test",
    });
    expect(out.pomCall?.method).toBe("usernameInput.fill");
    expect(out.warning).toBeUndefined();
    expect(llm.callsMade()).toBe(1);
    const written = await writer.readAll();
    expect(written).toHaveLength(1);
    expect(written[0].stepText).toBe(fakeStep.text);
  });

  it("preserves rule warning when LLM also fails", async () => {
    const llm = new MockLLMClient();
    const fakeStep = step("When", "I summon a unicorn from the void");
    llm.scriptError(fakeStep.text, "model is on fire");
    const out = await matchStepWithLLM(fakeStep, pom, "loginPage", {
      llm,
      candidates: writer,
      scaffoldId: "test",
    });
    expect(out.warning).toContain("LLM fallback also failed");
    expect(out.warning).toContain("model is on fire");
    expect(out.pomCall).toBeUndefined();
    const written = await writer.readAll();
    expect(written).toHaveLength(0);
  });

  it("skips LLM when no client is provided (TODO behaviour)", async () => {
    const out = await matchStepWithLLM(
      step("When", "I summon a unicorn from the void"),
      pom,
      "loginPage",
      { scaffoldId: "test" },
    );
    expect(out.warning).toContain("no rule matched");
    expect(out.pomCall).toBeUndefined();
  });

  it("respects budget exhaustion (no LLM call when budget done)", async () => {
    const llm = new MockLLMClient(0); // budget=0, immediately exhausted
    const fakeStep = step("When", "I summon a unicorn from the void");
    llm.scriptBinding(fakeStep.text, {
      step: fakeStep,
      pomCall: { page: "loginPage", method: "x", args: [] },
    });
    const out = await matchStepWithLLM(fakeStep, pom, "loginPage", {
      llm,
      candidates: writer,
      scaffoldId: "test",
    });
    expect(out.warning).toBeTruthy();
    expect(llm.callsMade()).toBe(0);
  });

  it("v2.0.1 — flattens multi-line LLM errors so the // TODO stays a single comment", async () => {
    // The exact bug from the cloud-jobs report: better-sqlite3 module-mismatch
    // throws a 5-line error message. Without flattening, only the first line
    // gets the // prefix and lines 2-5 become parsed as TypeScript.
    const llm = new MockLLMClient();
    const fakeStep = step("Given", "the user has a valid login token");
    llm.scriptError(
      fakeStep.text,
      "The module './better_sqlite3.node'\nwas compiled against a different Node.js version using\nNODE_MODULE_VERSION 127. This version of Node.js requires\nNODE_MODULE_VERSION 115. Please try re-compiling.",
    );
    const out = await matchStepWithLLM(fakeStep, pom, "loginPage", {
      llm,
      candidates: writer,
      scaffoldId: "test",
    });
    // The warning is a single line — newlines collapsed to ` | ` separators.
    expect(out.warning).toBeTruthy();
    expect(out.warning).not.toContain("\n");
    expect(out.warning).toContain(" | ");
    expect(out.warning).toContain("LLM fallback also failed");
  });

  it("v2.0.1 — flattens multi-line caught exceptions thrown from generateBinding", async () => {
    // When generateBinding itself throws (rather than returning {error}),
    // the catch block also has to flatten. Most likely cause in production:
    // better-sqlite3 throws DURING module load, before the AnthropicLLMClient
    // even gets the chance to return a result object.
    class ThrowingLLM implements LLMClient {
      budgetExhausted() {
        return false;
      }
      callsMade() {
        return 0;
      }
      async generateBinding(): Promise<GenerateBindingResult> {
        throw new Error(
          "line1 of stack\nline2 of stack\nline3 with backticks `npm install`",
        );
      }
    }
    const out = await matchStepWithLLM(
      step("Given", "an unmatched step"),
      pom,
      "loginPage",
      { llm: new ThrowingLLM(), candidates: writer, scaffoldId: "test" },
    );
    expect(out.warning).toBeTruthy();
    expect(out.warning).not.toContain("\n");
    expect(out.warning).toContain("LLM fallback threw");
    expect(out.warning).toContain("line1 of stack");
    expect(out.warning).toContain("line3 with backticks");
  });

  it("v2.2.0 — step deadline fires when LLM generateBinding hangs forever", async () => {
    // Production bug: container hangs 8 minutes when governance sidecar
    // or Anthropic SDK is wedged. The matchStepWithLLM watchdog
    // (Promise.race against ctx.stepDeadlineMs) must abandon the call
    // and let scaffold() proceed.
    class HangingLLM implements LLMClient {
      budgetExhausted() {
        return false;
      }
      callsMade() {
        return 0;
      }
      // Returns a promise that never resolves.
      async generateBinding(): Promise<GenerateBindingResult> {
        return new Promise(() => {
          /* never resolve */
        });
      }
    }
    const start = Date.now();
    const out = await matchStepWithLLM(
      step("When", "an unmatched step"),
      pom,
      "loginPage",
      {
        llm: new HangingLLM(),
        candidates: writer,
        scaffoldId: "test",
        // Aggressive deadline so the test runs fast.
        stepDeadlineMs: 50,
      },
    );
    const elapsed = Date.now() - start;
    // The watchdog must fire within ~50ms (give ourselves a 500ms buffer
    // for slow CI). Without it the await would hang indefinitely.
    expect(elapsed).toBeLessThan(500);
    expect(out.warning).toBeTruthy();
    expect(out.warning).toContain("step deadline exceeded");
    expect(out.pomCall).toBeUndefined();
  });

  it("appends one candidate-rules entry per LLM success", async () => {
    const llm = new MockLLMClient();
    const stepA = step("When", "alpha-step that no rule covers");
    const stepB = step("Then", "beta-step that no rule covers");
    llm.scriptBinding(stepA.text, {
      step: stepA,
      assertion: { locator: "loginPage.page", matcher: "toBeVisible" },
    });
    llm.scriptBinding(stepB.text, {
      step: stepB,
      assertion: { locator: "loginPage.page", matcher: "toBeHidden" },
    });
    await matchStepWithLLM(stepA, pom, "loginPage", {
      llm,
      candidates: writer,
      scaffoldId: "test",
    });
    await matchStepWithLLM(stepB, pom, "loginPage", {
      llm,
      candidates: writer,
      scaffoldId: "test",
    });
    const written = await writer.readAll();
    expect(written).toHaveLength(2);
    expect(written.map((e) => e.stepText).sort()).toEqual([
      stepA.text,
      stepB.text,
    ]);
    // Every entry has the POM signature.
    for (const e of written) {
      expect(e.pomSignature.className).toBe("LoginPage");
      expect(e.pomSignature.fieldNames).toEqual([
        "usernameInput",
        "passwordInput",
      ]);
    }
  });
});
