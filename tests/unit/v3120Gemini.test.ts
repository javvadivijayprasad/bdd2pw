/**
 * v3.12.0 — GeminiLLMClient tests.
 *
 * @google/generative-ai is in optionalDependencies — install is not
 * guaranteed in CI, so we stub `require("@google/generative-ai")` and
 * return a controllable mock. Same pattern as the OpenAI test in
 * v3110OpenAI.test.ts.
 */

import { describe, it, expect } from "vitest";
import Module from "module";
import { GeminiLLMClient } from "../../src/llm/geminiClient";
import { DEFAULT_PRICING } from "../../src/llm/telemetry";
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
  ],
  methods: [{ name: "goto", params: [], body: "", origin: "generated" }],
  exists: false,
};

const STEP_INPUT: GenerateBindingInput = {
  step: { keyword: "When", text: "I do a thing" },
  pom: POM,
  pageVar: "loginPage",
  scaffoldId: "scaffold-test-gemini-1",
};

/**
 * Patch Module.prototype.require so the client's lazyModel() finds
 * our mocked SDK instead of trying to load the real package.
 */
function withGeminiStub<T>(
  generateContent: (req: unknown) => Promise<unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const moduleProto = Module.prototype as unknown as {
    require: (id: string) => unknown;
  };
  const original = moduleProto.require;
  moduleProto.require = function (id: string) {
    if (id === "@google/generative-ai") {
      return {
        GoogleGenerativeAI: class {
          getGenerativeModel() {
            return { generateContent };
          }
        },
      };
    }
    // eslint-disable-next-line prefer-rest-params
    return original.apply(this, arguments as unknown as [string]);
  };
  return fn().finally(() => {
    moduleProto.require = original;
  });
}

describe("v3.12.0 — GeminiLLMClient", () => {
  it("defaults to gemini-2.5-flash and uses pre-seeded pricing", () => {
    const client = new GeminiLLMClient(
      { provider: "gemini", apiKey: "key-test" },
      ":memory:",
    );
    expect((client as any).model).toBe("gemini-2.5-flash");
    expect(DEFAULT_PRICING["gemini-2.5-flash"]).toBeDefined();
    expect(DEFAULT_PRICING["gemini-2.5-flash"].inputUsdPerMillion).toBe(0.1);
    expect(DEFAULT_PRICING["gemini-2.5-flash"].outputUsdPerMillion).toBe(0.4);
  });

  it("generateBinding succeeds with a well-formed JSON response", async () => {
    const generateContent = async () => ({
      response: {
        text: () =>
          JSON.stringify({
            step: { keyword: "When", text: "I do a thing" },
            pomCall: {
              page: "loginPage",
              method: "usernameInput.fill",
              args: ['"x"'],
            },
          }),
        usageMetadata: { promptTokenCount: 2345, candidatesTokenCount: 67 },
      },
    });
    const result = await withGeminiStub(generateContent, async () => {
      const client = new GeminiLLMClient(
        {
          provider: "gemini",
          apiKey: "key-test",
          skipGovernance: true,
          cachePath: ":memory:",
        },
        ":memory:",
      );
      return client.generateBinding(STEP_INPUT);
    });
    expect(result.binding?.pomCall?.method).toBe("usernameInput.fill");
    expect(result.fromCache).toBe(false);
    expect(result.model).toBe("gemini-2.5-flash");
  });

  it("generateBatchBindings produces N bindings from ONE provider call", async () => {
    const fakeResponse = JSON.stringify([
      {
        step: { keyword: "When", text: "I do thing one" },
        pomCall: {
          page: "loginPage",
          method: "usernameInput.fill",
          args: ['"a"'],
        },
      },
      {
        step: { keyword: "When", text: "I do thing two" },
        pomCall: {
          page: "loginPage",
          method: "usernameInput.fill",
          args: ['"b"'],
        },
      },
      {
        step: { keyword: "When", text: "I do thing three" },
        pomCall: {
          page: "loginPage",
          method: "usernameInput.fill",
          args: ['"c"'],
        },
      },
    ]);
    let providerCalls = 0;
    const generateContent = async () => {
      providerCalls += 1;
      return {
        response: {
          text: () => fakeResponse,
          usageMetadata: { promptTokenCount: 5432, candidatesTokenCount: 234 },
        },
      };
    };
    const inputs: GenerateBindingInput[] = [
      { ...STEP_INPUT, step: { keyword: "When", text: "I do thing one" } },
      { ...STEP_INPUT, step: { keyword: "When", text: "I do thing two" } },
      { ...STEP_INPUT, step: { keyword: "When", text: "I do thing three" } },
    ];
    const results = await withGeminiStub(generateContent, async () => {
      const client = new GeminiLLMClient(
        {
          provider: "gemini",
          apiKey: "key-test",
          skipGovernance: true,
          cachePath: ":memory:",
        },
        ":memory:",
      );
      return client.generateBatchBindings(inputs);
    });
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.binding?.pomCall?.args[0])).toEqual([
      '"a"',
      '"b"',
      '"c"',
    ]);
    // Critical: 3 unmatched steps = 1 Gemini call (batched).
    expect(providerCalls).toBe(1);
  });

  it("budget exhaustion returns an error without calling the provider", async () => {
    let providerCalls = 0;
    const generateContent = async () => {
      providerCalls += 1;
      return { response: { text: () => "", usageMetadata: {} } };
    };
    const result = await withGeminiStub(generateContent, async () => {
      const client = new GeminiLLMClient(
        {
          provider: "gemini",
          apiKey: "key-test",
          maxCalls: 0,
          skipGovernance: true,
          cachePath: ":memory:",
        },
        ":memory:",
      );
      return client.generateBinding(STEP_INPUT);
    });
    expect(result.error).toMatch(/budget exhausted/);
    expect(providerCalls).toBe(0);
  });

  it("missing API key short-circuits before SDK load", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    const client = new GeminiLLMClient(
      {
        provider: "gemini",
        skipGovernance: true,
        cachePath: ":memory:",
      },
      ":memory:",
    );
    const result = await client.generateBinding(STEP_INPUT);
    expect(result.error).toMatch(/GEMINI_API_KEY/);
  });

  it("malformed JSON response surfaces a parse error", async () => {
    const generateContent = async () => ({
      response: {
        text: () => "this is not JSON",
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
      },
    });
    const result = await withGeminiStub(generateContent, async () => {
      const client = new GeminiLLMClient(
        {
          provider: "gemini",
          apiKey: "key-test",
          skipGovernance: true,
          cachePath: ":memory:",
        },
        ":memory:",
      );
      return client.generateBinding(STEP_INPUT);
    });
    expect(result.error).toMatch(/Could not parse/);
  });

  it("provider timeout aborts the call", async () => {
    // generateContent never resolves → withTimeout must kill it.
    const generateContent = () => new Promise<never>(() => {});
    const result = await withGeminiStub(generateContent, async () => {
      const client = new GeminiLLMClient(
        {
          provider: "gemini",
          apiKey: "key-test",
          skipGovernance: true,
          cachePath: ":memory:",
          providerTimeoutMs: 50,
        },
        ":memory:",
      );
      return client.generateBinding(STEP_INPUT);
    });
    expect(result.error).toMatch(/timeout/i);
  });
});
