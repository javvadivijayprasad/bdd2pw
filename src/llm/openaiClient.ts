/**
 * OpenAI LLM client — v3.11.0.
 *
 * Implements the same `LLMClient` interface as `AnthropicLLMClient`:
 * single-step `generateBinding`, batched `generateBatchBindings`,
 * cache hit accounting, budget tracking, governance sanitisation,
 * step deadlines, provider timeouts.
 *
 * Differences from the Anthropic client are minimal and limited to
 * the SDK call shape:
 *
 *   Anthropic                            OpenAI
 *   -------------------------------      -----------------------------
 *   anthropic.messages.create({          openai.chat.completions.create({
 *     system: SYSTEM_PROMPT,               messages: [
 *     messages: [                            { role: 'system',
 *       { role: 'user', content }              content: SYSTEM_PROMPT },
 *     ]                                      { role: 'user', content }
 *   })                                     ]
 *                                        })
 *
 *   resp.content[0].text                 resp.choices[0].message.content
 *   resp.usage.input_tokens              resp.usage.prompt_tokens
 *   resp.usage.output_tokens             resp.usage.completion_tokens
 *
 * The prompt machinery (`SYSTEM_PROMPT`, `buildUserPrompt`,
 * `buildBatchUserPrompt`, `cacheKey`), the parser (`parseBindingJson`),
 * the cache (`openSqliteCache`), and the governance client
 * (`GovernanceClient`) are all shared with the Anthropic path —
 * cache keys interoperate, so a scaffold cached under one provider
 * hits the cache under another (cache keys include the model name,
 * so cross-provider hits only fire when models match).
 *
 * Default model: `gpt-4o-mini`. Reasoning: bdd2pw's task is
 * structured JSON output over a small set of regex-shaped
 * deterministic patterns. Mini handles it reliably and runs ~17x
 * cheaper than gpt-4o ($0.15 vs $2.50 per million input tokens).
 * Override via `LLMClientOptions.model`.
 */

import type { BindingCache } from "./cache";
import { openSqliteCache } from "./cache";
import { GovernanceClient, GovernanceUnreachableError } from "./governanceClient";
import {
  SYSTEM_PROMPT,
  buildBatchUserPrompt,
  buildUserPrompt,
  cacheKey,
} from "./prompt";
import { parseBindingJson } from "./anthropicClient";
import type {
  GenerateBindingInput,
  GenerateBindingResult,
  LLMClient,
  LLMClientOptions,
  LLMLogEvent,
} from "./types";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_MAX_CALLS = 50;
const DEFAULT_GOVERNANCE_URL = "http://localhost:4900";
const DEFAULT_STEP_TIMEOUT_MS = 60_000;
const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_GOVERNANCE_TIMEOUT_MS = 15_000;

export class OpenAILLMClient implements LLMClient {
  private model: string;
  private apiKey: string;
  private maxCalls: number;
  private skipGovernance: boolean;
  private log: (e: LLMLogEvent) => void;
  private governance: GovernanceClient;
  private cache: BindingCache | null = null;
  private cachePath: string;
  private callsCounter = 0;
  private attemptsCounter = 0;
  private openai: any | null = null;
  private cachePersistent: boolean | null = null;
  private cacheFallbackReason: string | undefined;
  private providerTimeoutMs: number;

  constructor(opts: LLMClientOptions, cachePathDefault: string) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.maxCalls = opts.maxCalls ?? DEFAULT_MAX_CALLS;
    this.skipGovernance = opts.skipGovernance ?? false;
    this.log = opts.log ?? (() => {});
    this.providerTimeoutMs =
      opts.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    this.governance = new GovernanceClient(
      opts.governanceUrl ?? DEFAULT_GOVERNANCE_URL,
      opts.governanceTimeoutMs ?? DEFAULT_GOVERNANCE_TIMEOUT_MS,
    );
    this.cachePath = opts.cachePath ?? cachePathDefault;
  }

  async ensureCache(): Promise<BindingCache> {
    if (!this.cache) {
      const result = await openSqliteCache(this.cachePath);
      this.cache = result.cache;
      this.cachePersistent = result.persistent;
      this.cacheFallbackReason = result.fallbackReason;
      if (!result.persistent && result.fallbackReason) {
        this.log({ kind: "cache_fallback", reason: result.fallbackReason });
        this.log({
          kind: "error",
          phase: "cache_load",
          message: `Cache backend unavailable, falling back to in-memory for this run. Reason: ${result.fallbackReason}`,
        });
      }
    }
    return this.cache;
  }

  budgetExhausted(): boolean {
    return this.attemptsCounter >= this.maxCalls;
  }
  callsMade(): number {
    return this.callsCounter;
  }
  callsAttempted(): number {
    return this.attemptsCounter;
  }
  cacheBackendPersistent(): boolean | null {
    return this.cachePersistent;
  }
  cacheBackendFallbackReason(): string | undefined {
    return this.cacheFallbackReason;
  }

  /**
   * Single-step generation. Cache → governance → OpenAI → parse.
   * Mirrors `AnthropicLLMClient.generateBinding` end-to-end.
   */
  async generateBinding(
    input: GenerateBindingInput,
  ): Promise<GenerateBindingResult> {
    const start = Date.now();
    const key = cacheKey(input, this.model);
    const cache = await this.ensureCache();

    const hit = await cache.get(key);
    if (hit) {
      this.log({ kind: "cache_hit", key });
      return {
        binding: hit.binding,
        fromCache: true,
        model: hit.model,
        latencyMs: Date.now() - start,
      };
    }
    this.log({ kind: "cache_miss", key });

    if (this.budgetExhausted()) {
      return {
        error: `LLM budget exhausted (${this.callsCounter}/${this.maxCalls} calls). Increase via --llm-max-calls.`,
        fromCache: false,
      };
    }

    const userPrompt = buildUserPrompt(input);

    let sanitisedUserPrompt = userPrompt;
    if (!this.skipGovernance) {
      try {
        this.log({ kind: "sanitise_start", bytes: userPrompt.length });
        const result = await this.governance.sanitiseCode(userPrompt);
        sanitisedUserPrompt = result.sanitised;
        this.log({
          kind: "sanitise_done",
          bytes: sanitisedUserPrompt.length,
          findings: result.findings.length,
        });
      } catch (err) {
        const isUnreachable = err instanceof GovernanceUnreachableError;
        const message = err instanceof Error ? err.message : String(err);
        this.log({ kind: "error", phase: "governance", message });
        return {
          error: isUnreachable
            ? `Governance sidecar unreachable; refusing to call LLM (fail-closed). ${message}`
            : `Governance sanitise failed: ${message}`,
          fromCache: false,
        };
      }
    }

    if (!this.apiKey) {
      return {
        error: "OPENAI_API_KEY is not set; pass apiKey or set the env var.",
        fromCache: false,
      };
    }
    const openai = await this.lazyClient();
    if (!openai) {
      return {
        error: "openai SDK not installed. Run: npm install openai",
        fromCache: false,
      };
    }

    let responseText = "";
    let inputTokens = 0;
    let outputTokens = 0;
    this.attemptsCounter += 1;
    try {
      this.log({
        kind: "provider_call_start",
        model: this.model,
        promptBytes: sanitisedUserPrompt.length,
      });
      const callStart = Date.now();
      const resp = await openai.chat.completions.create(
        {
          model: this.model,
          max_tokens: 1024,
          temperature: 0,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: sanitisedUserPrompt },
          ],
        },
        { timeout: this.providerTimeoutMs },
      );
      this.callsCounter += 1;
      const callLatency = Date.now() - callStart;
      responseText = resp.choices?.[0]?.message?.content ?? "";
      inputTokens = resp.usage?.prompt_tokens ?? 0;
      outputTokens = resp.usage?.completion_tokens ?? 0;
      this.log({
        kind: "provider_call_done",
        model: this.model,
        latencyMs: callLatency,
        inputTokens,
        outputTokens,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log({ kind: "error", phase: "openai", message });
      return {
        error: `OpenAI API call failed: ${message}`,
        fromCache: false,
      };
    }

    const binding = parseBindingJson(responseText, input);
    if (!binding) {
      this.log({
        kind: "error",
        phase: "parse",
        message: `Could not parse JSON binding from LLM output: ${responseText.slice(0, 200)}`,
      });
      return {
        error: `Could not parse JSON binding from LLM output (first 200 chars): ${responseText.slice(0, 200)}`,
        fromCache: false,
      };
    }
    this.log({ kind: "binding_parsed", binding });

    await cache.set(key, {
      binding,
      model: this.model,
      createdAt: new Date().toISOString(),
    });

    return {
      binding,
      fromCache: false,
      model: this.model,
      latencyMs: Date.now() - start,
    };
  }

  /**
   * Batched generation — same per-step cache lookup + single batched
   * prompt as `AnthropicLLMClient.generateBatchBindings`. The JSON array
   * response is parsed slot by slot through `parseBindingJson`.
   */
  async generateBatchBindings(
    inputs: GenerateBindingInput[],
  ): Promise<GenerateBindingResult[]> {
    if (inputs.length === 0) return [];
    const start = Date.now();
    const cache = await this.ensureCache();

    const results: (GenerateBindingResult | undefined)[] = new Array(
      inputs.length,
    );
    const missIndexes: number[] = [];
    const missInputs: GenerateBindingInput[] = [];
    const missKeys: string[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const key = cacheKey(inputs[i], this.model);
      const hit = await cache.get(key);
      if (hit) {
        this.log({ kind: "cache_hit", key });
        results[i] = {
          binding: hit.binding,
          fromCache: true,
          model: hit.model,
          latencyMs: Date.now() - start,
        };
      } else {
        this.log({ kind: "cache_miss", key });
        missIndexes.push(i);
        missInputs.push(inputs[i]);
        missKeys.push(key);
      }
    }

    if (missInputs.length === 0) {
      return results.map((r) => r!);
    }

    if (this.budgetExhausted()) {
      const err = {
        error: `LLM budget exhausted (${this.callsCounter}/${this.maxCalls} calls). Increase via --llm-max-calls.`,
        fromCache: false as const,
      };
      for (const i of missIndexes) results[i] = err;
      return results.map((r) => r!);
    }

    const userPrompt = buildBatchUserPrompt(missInputs);
    let sanitisedUserPrompt = userPrompt;
    if (!this.skipGovernance) {
      try {
        this.log({ kind: "sanitise_start", bytes: userPrompt.length });
        const sr = await this.governance.sanitiseCode(userPrompt);
        sanitisedUserPrompt = sr.sanitised;
        this.log({
          kind: "sanitise_done",
          bytes: sanitisedUserPrompt.length,
          findings: sr.findings.length,
        });
      } catch (err) {
        const isUnreachable = err instanceof GovernanceUnreachableError;
        const message = err instanceof Error ? err.message : String(err);
        this.log({ kind: "error", phase: "governance", message });
        const errResult = {
          error: isUnreachable
            ? `Governance sidecar unreachable; refusing to call LLM (fail-closed). ${message}`
            : `Governance sanitise failed: ${message}`,
          fromCache: false as const,
        };
        for (const i of missIndexes) results[i] = errResult;
        return results.map((r) => r!);
      }
    }

    if (!this.apiKey) {
      const err = {
        error: "OPENAI_API_KEY is not set; pass apiKey or set the env var.",
        fromCache: false as const,
      };
      for (const i of missIndexes) results[i] = err;
      return results.map((r) => r!);
    }
    const openai = await this.lazyClient();
    if (!openai) {
      const err = {
        error: "openai SDK not installed. Run: npm install openai",
        fromCache: false as const,
      };
      for (const i of missIndexes) results[i] = err;
      return results.map((r) => r!);
    }

    let responseText = "";
    this.attemptsCounter += 1;
    try {
      this.log({
        kind: "provider_call_start",
        model: this.model,
        promptBytes: sanitisedUserPrompt.length,
      });
      const callStart = Date.now();
      const maxTokens = Math.min(8192, 1024 + missInputs.length * 512);
      const resp = await openai.chat.completions.create(
        {
          model: this.model,
          max_tokens: maxTokens,
          temperature: 0,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: sanitisedUserPrompt },
          ],
        },
        { timeout: this.providerTimeoutMs },
      );
      this.callsCounter += 1;
      const callLatency = Date.now() - callStart;
      responseText = resp.choices?.[0]?.message?.content ?? "";
      this.log({
        kind: "provider_call_done",
        model: this.model,
        latencyMs: callLatency,
        inputTokens: resp.usage?.prompt_tokens ?? 0,
        outputTokens: resp.usage?.completion_tokens ?? 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log({ kind: "error", phase: "openai", message });
      const errResult = {
        error: `OpenAI API call failed: ${message}`,
        fromCache: false as const,
      };
      for (const i of missIndexes) results[i] = errResult;
      return results.map((r) => r!);
    }

    let parsedArray: unknown[];
    try {
      let body = responseText.trim();
      const fence = body.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
      if (fence) body = fence[1].trim();
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
      parsedArray = parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log({ kind: "error", phase: "parse", message });
      const errResult = {
        error: `Could not parse JSON array from batch LLM output (first 200 chars): ${responseText.slice(0, 200)}`,
        fromCache: false as const,
      };
      for (const i of missIndexes) results[i] = errResult;
      return results.map((r) => r!);
    }

    for (let j = 0; j < missInputs.length; j++) {
      const slotInput = missInputs[j];
      const slotKey = missKeys[j];
      const slotRaw = parsedArray[j];
      const originalIdx = missIndexes[j];
      if (slotRaw === undefined) {
        results[originalIdx] = {
          error: `Batch response missing entry for step ${j}: "${slotInput.step.text}"`,
          fromCache: false,
        };
        continue;
      }
      const slotJson = JSON.stringify(slotRaw);
      const binding = parseBindingJson(slotJson, slotInput);
      if (!binding) {
        results[originalIdx] = {
          error: `Could not parse binding for step ${j} ("${slotInput.step.text}"); slot was: ${slotJson.slice(0, 200)}`,
          fromCache: false,
        };
        continue;
      }
      this.log({ kind: "binding_parsed", binding });
      await cache.set(slotKey, {
        binding,
        model: this.model,
        createdAt: new Date().toISOString(),
      });
      results[originalIdx] = {
        binding,
        fromCache: false,
        model: this.model,
        latencyMs: Date.now() - start,
      };
    }

    return results.map((r) => r!);
  }

  private async lazyClient(): Promise<any | null> {
    if (this.openai) return this.openai;
    try {
      // openai is in optionalDependencies. require() defensively so a
      // teammate without the SDK installed gets a clean error instead
      // of a module-load crash.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require("openai");
      const OpenAI = mod.OpenAI ?? mod.default ?? mod;
      this.openai = new OpenAI({ apiKey: this.apiKey });
      return this.openai;
    } catch {
      return null;
    }
  }

  /**
   * v4.0.0 — generic single-prompt text generation. Mirrors
   * AnthropicLLMClient.generateText. Cache intentionally skipped;
   * see that method for rationale.
   */
  async generateText(prompt: string): Promise<import("./types").GenerateTextResult> {
    const start = Date.now();

    if (this.budgetExhausted()) {
      return {
        error: `LLM budget exhausted (${this.callsCounter}/${this.maxCalls} calls). Increase via --llm-max-calls.`,
      };
    }

    let sanitisedPrompt = prompt;
    if (!this.skipGovernance) {
      try {
        this.log({ kind: "sanitise_start", bytes: prompt.length });
        const result = await this.governance.sanitiseCode(prompt);
        sanitisedPrompt = result.sanitised;
        this.log({
          kind: "sanitise_done",
          bytes: sanitisedPrompt.length,
          findings: result.findings.length,
        });
      } catch (err) {
        const isUnreachable = err instanceof GovernanceUnreachableError;
        const message = err instanceof Error ? err.message : String(err);
        this.log({ kind: "error", phase: "governance", message });
        return {
          error: isUnreachable
            ? `Governance sidecar unreachable; refusing to call LLM (fail-closed). ${message}`
            : `Governance sanitise failed: ${message}`,
        };
      }
    }

    if (!this.apiKey) {
      return { error: "OPENAI_API_KEY is not set; pass apiKey or set the env var." };
    }
    const openai = await this.lazyClient();
    if (!openai) {
      return { error: "openai SDK not installed. Run: npm install openai" };
    }

    this.attemptsCounter += 1;
    try {
      this.log({
        kind: "provider_call_start",
        model: this.model,
        promptBytes: sanitisedPrompt.length,
      });
      const callStart = Date.now();
      const resp = await openai.chat.completions.create(
        {
          model: this.model,
          max_tokens: 2048,
          temperature: 0,
          messages: [{ role: "user", content: sanitisedPrompt }],
        },
        { timeout: this.providerTimeoutMs },
      );
      this.callsCounter += 1;
      const callLatency = Date.now() - callStart;
      const text = resp.choices?.[0]?.message?.content ?? "";
      const inputTokens = resp.usage?.prompt_tokens ?? 0;
      const outputTokens = resp.usage?.completion_tokens ?? 0;
      this.log({
        kind: "provider_call_done",
        model: this.model,
        latencyMs: callLatency,
        inputTokens,
        outputTokens,
      });
      return {
        text,
        model: this.model,
        latencyMs: Date.now() - start,
        inputTokens,
        outputTokens,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log({ kind: "error", phase: "openai", message });
      return { error: `OpenAI API call failed: ${message}` };
    }
  }

  async close(): Promise<void> {
    if (this.cache) {
      await this.cache.close().catch(() => undefined);
      this.cache = null;
    }
  }
}
