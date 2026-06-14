/**
 * v3.11.0 — OpenAILLMClient tests.
 *
 * The openai SDK is in optionalDependencies — install isn't guaranteed
 * in CI, so we don't rely on the real package. Instead we stub
 * `require("openai")` so the client's `lazyClient()` path resolves to
 * a controllable mock that returns canned responses.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Module from "module";
import { OpenAILLMClient } from "../../src/llm/openaiClient";
import { DEFAULT_PRICING } from "../../src/llm/telemetry";
import type { GenerateBindingInput } from "../../src/llm/types";
import type { PageObjectIR, StepIR } from "../../src/types";

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
  scaffoldId: "scaffold-test-1",
};

/**
 * Patch the global require cache so `require("openai")` returns our
 * stub instead of attempting to load the real SDK. Restore afterwards.
 */
function withOpenAIStub<T>(
  stub: { chatCompletions: any },
  fn: () => Promise<T>,
): Promise<T> {
  const moduleProto = Module.prototype as unknown as {
    require: (id: string) => unknown;
  };
  const original = moduleProto.require;
  moduleProto.require = function (id: string) {
    if (id === "openai") {
      return {
        OpenAI: class {
          chat = { completions: { create: stub.chatCompletions } };
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

describe("v3.11.0 — OpenAILLMClient", () => {
  it("defaults to gpt-4o-mini and uses pre-seeded pricing", () => {
    const client = new OpenAILLMClient(
      { provider: "openai", apiKey: "sk-test" },
      ":memory:",
    );
    expect((client as any).model).toBe("gpt-4o-mini");
    expect(DEFAULT_PRICING["gpt-4o-mini"]).toBeDefined();
    expect(DEFAULT_PRICING["gpt-4o-mini"].inputUsdPerMillion).toBe(0.15);
  });

  it("generateBinding succeeds with a well-formed JSON response", async () => {
    const stubCreate = async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              step: { keyword: "When", text: "I do a thing" },
              pomCall: {
                page: "loginPage",
                method: "usernameInput.fill",
                args: ['"x"'],
              },
            }),
          },
        },
      ],
      usage: { prompt_tokens: 1234, completion_tokens: 56 },
    });
    const result = await withOpenAIStub(
      { chatCompletions: stubCreate },
      async () => {
        const client = new OpenAILLMClient(
          {
            provider: "openai",
            apiKey: "sk-test",
            skipGovernance: true,
            cachePath: ":memory:",
          },
          ":memory:",
        );
        return client.generateBinding(STEP_INPUT);
      },
    );
    expect(result.binding?.pomCall?.method).toBe("usernameInput.fill");
    expect(result.fromCache).toBe(false);
    expect(result.model).toBe("gpt-4o-mini");
  });

  it("generateBatchBindings produces N bindings from one provider call", async () => {
    const fakeResponse = JSON.stringify([
      {
        step: { keyword: "When", text: "I do thing one" },
        pomCall: { page: "loginPage", method: "usernameInput.fill", args: ['"a"'] },
      },
      {
        step: { keyword: "When", text: "I do thing two" },
        pomCall: { page: "loginPage", method: "usernameInput.fill", args: ['"b"'] },
      },
      {
        step: { keyword: "When", text: "I do thing three" },
        pomCall: { page: "loginPage", method: "usernameInput.fill", args: ['"c"'] },
      },
    ]);
    let providerCalls = 0;
    const stubCreate = async () => {
      providerCalls += 1;
      return {
        choices: [{ message: { content: fakeResponse } }],
        usage: { prompt_tokens: 4321, completion_tokens: 210 },
      };
    };
    const inputs: GenerateBindingInput[] = [
      { ...STEP_INPUT, step: { keyword: "When", text: "I do thing one" } },
      { ...STEP_INPUT, step: { keyword: "When", text: "I do thing two" } },
      { ...STEP_INPUT, step: { keyword: "When", text: "I do thing three" } },
    ];
    const results = await withOpenAIStub(
      { chatCompletions: stubCreate },
      async () => {
        const client = new OpenAILLMClient(
          {
            provider: "openai",
            apiKey: "sk-test",
            skipGovernance: true,
            cachePath: ":memory:",
          },
          ":memory:",
        );
        return client.generateBatchBindings(inputs);
      },
    );
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.binding?.pomCall?.args[0])).toEqual([
      '"a"',
      '"b"',
      '"c"',
    ]);
    // Critical assertion — 3 unmatched steps = 1 OpenAI call (batched).
    expect(providerCalls).toBe(1);
  });

  it("budget exhaustion returns an error without calling the provider", async () => {
    let providerCalls = 0;
    const stubCreate = async () => {
      providerCalls += 1;
      return { choices: [], usage: {} };
    };
    const result = await withOpenAIStub(
      { chatCompletions: stubCreate },
      async () => {
        const client = new OpenAILLMClient(
          {
            provider: "openai",
            apiKey: "sk-test",
            maxCalls: 0, // budget=0 → exhausted immediately
            skipGovernance: true,
            cachePath: ":memory:",
          },
          ":memory:",
        );
        return client.generateBinding(STEP_INPUT);
      },
    );
    expect(result.error).toMatch(/budget exhausted/);
    expect(providerCalls).toBe(0);
  });

  it("missing API key short-circuits before any SDK load", async () => {
    delete process.env.OPENAI_API_KEY;
    const client = new OpenAILLMClient(
      {
        provider: "openai",
        skipGovernance: true,
        cachePath: ":memory:",
      },
      ":memory:",
    );
    const result = await client.generateBinding(STEP_INPUT);
    expect(result.error).toMatch(/OPENAI_API_KEY/);
  });

  it("malformed JSON response surfaces a parse error", async () => {
    const stubCreate = async () => ({
      choices: [{ message: { content: "this is not JSON" } }],
      usage: { prompt_tokens: 100, completion_tokens: 10 },
    });
    const result = await withOpenAIStub(
      { chatCompletions: stubCreate },
      async () => {
        const client = new OpenAILLMClient(
          {
            provider: "openai",
            apiKey: "sk-test",
            skipGovernance: true,
            cachePath: ":memory:",
          },
          ":memory:",
        );
        return client.generateBinding(STEP_INPUT);
      },
    );
    expect(result.error).toMatch(/Could not parse/);
  });
});
