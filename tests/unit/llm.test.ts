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
import { parseBindingJson } from "../../src/llm/anthropicClient";
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

  it("preserves the input step text rather than the LLM's echo", () => {
    // LLM might capitalise or reword — we always echo the original.
    const out = parseBindingJson(
      JSON.stringify({
        step: { keyword: "When", text: "I DO A THING" }, // LLM mangled
        assertion: { locator: "page", matcher: "toBeVisible" },
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
