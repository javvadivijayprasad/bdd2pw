/**
 * Anthropic-backed LLMClient.
 *
 * Flow per generateBinding():
 *   1. Cache lookup — if hit, return immediately, no provider call.
 *   2. Build prompt (system + user) via `src/llm/prompt.ts`.
 *   3. Sanitise user prompt via the governance sidecar (kind="code").
 *      Fail-closed if the sidecar is unreachable.
 *   4. Call Anthropic API with temperature=0, JSON response, the model
 *      from options (default claude-sonnet-4-6).
 *   5. Parse the response as JSON. Validate it as a StepBinding
 *      (echoes step text, has at most one of pomCall/assertion/customBody).
 *   6. Cache the result, return.
 *
 * Soft-fail: any error in steps 3–5 returns `{ error: "<reason>" }`. The
 * caller (matchStep wrapper) falls through to the existing TODO + warning
 * binding. The scaffold still completes; just the affected step lands as
 * a TODO instead of LLM-generated code.
 */

import type { StepBinding } from "../types";
import type {
  GenerateBindingInput,
  GenerateBindingResult,
  LLMClient,
  LLMClientOptions,
  LLMLogEvent,
} from "./types";
import {
  SYSTEM_PROMPT,
  buildBatchUserPrompt,
  buildUserPrompt,
  cacheKey,
} from "./prompt";
import {
  GovernanceClient,
  GovernanceUnreachableError,
} from "./governanceClient";
import {
  type BindingCache,
  InMemoryCache,
  openSqliteCache,
} from "./cache";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_GOVERNANCE_URL = "http://localhost:4900";
const DEFAULT_MAX_CALLS = 50;
// v2.2.0 — explicit timeouts. Without these, a wedged sidecar / slow
// Anthropic response stalls the scaffold for 8+ minutes (cloud-jobs
// container hang). Defaults aren't conservative — production usually
// completes in <5s; if a single step exceeds these, the operator
// almost certainly wants to bail out and look at it.
const DEFAULT_STEP_TIMEOUT_MS = 60_000;
const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_GOVERNANCE_TIMEOUT_MS = 15_000;

export class AnthropicLLMClient implements LLMClient {
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
  private anthropic: any | null = null; // lazy-loaded SDK instance
  /**
   * v2.0.2 — when SQLite cache fails to load, we fall back to an
   * in-memory cache and surface this once. `cacheFallbackReason` carries
   * the load error so callers can log it.
   */
  private cachePersistent: boolean | null = null;
  private cacheFallbackReason: string | undefined;
  // v2.2.0 timeouts.
  private stepTimeoutMs: number;
  private providerTimeoutMs: number;

  constructor(opts: LLMClientOptions, cachePathDefault: string) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.maxCalls = opts.maxCalls ?? DEFAULT_MAX_CALLS;
    this.skipGovernance = opts.skipGovernance ?? false;
    this.log = opts.log ?? (() => {});
    this.stepTimeoutMs = opts.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
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
      // v2.0.2: openSqliteCache no longer throws — on any failure it
      // falls back to in-memory and surfaces the reason. We stash the
      // result so callers / scaffold() can log a single warning instead
      // of one per LLM call.
      const result = await openSqliteCache(this.cachePath);
      this.cache = result.cache;
      this.cachePersistent = result.persistent;
      this.cacheFallbackReason = result.fallbackReason;
      if (!result.persistent && result.fallbackReason) {
        // v2.2.0 — emit BOTH a structured cache_fallback event (for the
        // wired pino logger to surface visibly in the scaffold log) AND
        // the legacy `error` event (for backwards-compat with callers
        // already consuming the LLMLogEvent stream). The scaffold log
        // gets a one-line warning at the moment the fallback fires —
        // operators no longer have to grep BDD_REVIEW.md to know.
        this.log({
          kind: "cache_fallback",
          reason: result.fallbackReason,
        });
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
    // Budget is enforced against ATTEMPTS, not just successes — otherwise a
    // run that hits 50 consecutive failures would loop forever trying.
    return this.attemptsCounter >= this.maxCalls;
  }
  /** Successful provider responses (parseable bindings). */
  callsMade(): number {
    return this.callsCounter;
  }
  /** All provider call attempts, including failures. */
  callsAttempted(): number {
    return this.attemptsCounter;
  }
  /**
   * v2.0.2 — true when the SQLite cache loaded successfully, false when
   * we degraded to in-memory. `null` until ensureCache() is called for
   * the first time. Callers can use this to print a one-time warning at
   * the end of a scaffold run.
   */
  cacheBackendPersistent(): boolean | null {
    return this.cachePersistent;
  }
  /** v2.0.2 — when persistent is false, the underlying load error string. */
  cacheBackendFallbackReason(): string | undefined {
    return this.cacheFallbackReason;
  }

  async generateBinding(
    input: GenerateBindingInput,
  ): Promise<GenerateBindingResult> {
    const start = Date.now();
    const key = cacheKey(input, this.model);
    const cache = await this.ensureCache();

    // 1) Cache lookup
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

    // Budget check — refuse if exhausted (caller will fall back to TODO).
    if (this.budgetExhausted()) {
      return {
        error: `LLM budget exhausted (${this.callsCounter}/${this.maxCalls} calls). Increase via --llm-max-calls.`,
        fromCache: false,
      };
    }

    // 2) Build prompt
    const userPrompt = buildUserPrompt(input);

    // 3) Sanitise via governance sidecar (unless skipped for tests).
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
        const message =
          err instanceof Error ? err.message : String(err);
        this.log({
          kind: "error",
          phase: "governance",
          message,
        });
        return {
          error: isUnreachable
            ? `Governance sidecar unreachable; refusing to call LLM (fail-closed). ${message}`
            : `Governance sanitise failed: ${message}`,
          fromCache: false,
        };
      }
    }

    // 4) Anthropic call
    if (!this.apiKey) {
      return {
        error:
          "ANTHROPIC_API_KEY is not set; pass apiKey or set the env var.",
        fromCache: false,
      };
    }
    const anthropic = await this.lazyClient();
    if (!anthropic) {
      return {
        error:
          "@anthropic-ai/sdk not installed. Run: npm install @anthropic-ai/sdk",
        fromCache: false,
      };
    }

    let responseText = "";
    let inputTokens = 0;
    let outputTokens = 0;
    // v2.0.1 — count the ATTEMPT before the await. A failed call still cost
    // a round-trip + tokens at the provider; operators need to see them in
    // the scaffold log to debug "LLM fallback: 0 successful / N attempted".
    this.attemptsCounter += 1;
    try {
      this.log({
        kind: "provider_call_start",
        model: this.model,
        promptBytes: sanitisedUserPrompt.length,
      });
      const callStart = Date.now();
      // v2.2.0 — explicit per-call timeout. The Anthropic SDK accepts a
      // `timeout` option (milliseconds). Without it, a stalled response
      // would wait the SDK's default (10 minutes) which is far too long
      // for a scaffold loop; cloud-jobs runs hit the 8-minute container
      // limit before bdd2pw printed any diagnostic.
      const resp = await anthropic.messages.create(
        {
          model: this.model,
          max_tokens: 1024,
          temperature: 0,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: sanitisedUserPrompt }],
        },
        { timeout: this.providerTimeoutMs },
      );
      this.callsCounter += 1;
      const callLatency = Date.now() - callStart;
      // The SDK returns content as an array of blocks; first block is text.
      const firstBlock = (resp.content ?? [])[0];
      if (firstBlock && firstBlock.type === "text") {
        responseText = firstBlock.text;
      }
      inputTokens = resp.usage?.input_tokens ?? 0;
      outputTokens = resp.usage?.output_tokens ?? 0;
      this.log({
        kind: "provider_call_done",
        model: this.model,
        latencyMs: callLatency,
        inputTokens,
        outputTokens,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log({ kind: "error", phase: "anthropic", message });
      return {
        error: `Anthropic API call failed: ${message}`,
        fromCache: false,
      };
    }

    // 5) Parse + validate
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

    // 6) Cache + return
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
   * v3.5.0 — generate N bindings in one provider call.
   *
   * Per-step cache lookup runs FIRST — already-cached inputs short-
   * circuit out of the prompt. Only the cache-misses are folded into
   * the batch. If every input is a cache hit, no provider call is
   * made (and `budgetExhausted` isn't bumped).
   *
   * Soft-fail per slot: a malformed JSON array, a missing entry, or
   * a binding that fails `parseBindingJson` returns an error result
   * for THAT slot only. The caller decides whether to fall back to
   * a per-step warning or the rule-based TODO.
   */
  async generateBatchBindings(
    inputs: GenerateBindingInput[],
  ): Promise<GenerateBindingResult[]> {
    if (inputs.length === 0) return [];
    const start = Date.now();
    const cache = await this.ensureCache();

    // 1) Per-step cache lookup. Collect hits at their original
    //    indexes; queue misses for the batch prompt.
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

    // Everything cached — no provider call needed.
    if (missInputs.length === 0) {
      return results.map((r) => r!);
    }

    // 2) Budget check.
    if (this.budgetExhausted()) {
      const err = {
        error: `LLM budget exhausted (${this.callsCounter}/${this.maxCalls} calls). Increase via --llm-max-calls.`,
        fromCache: false as const,
      };
      for (const i of missIndexes) results[i] = err;
      return results.map((r) => r!);
    }

    // 3) Build batch prompt + sanitise.
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

    // 4) Provider call. One batch = one budget tick.
    if (!this.apiKey) {
      const err = {
        error: "ANTHROPIC_API_KEY is not set; pass apiKey or set the env var.",
        fromCache: false as const,
      };
      for (const i of missIndexes) results[i] = err;
      return results.map((r) => r!);
    }
    const anthropic = await this.lazyClient();
    if (!anthropic) {
      const err = {
        error: "@anthropic-ai/sdk not installed. Run: npm install @anthropic-ai/sdk",
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
      // Bigger max_tokens than the single-step path — N bindings of
      // ~1024 tokens each. Cap at 8K to stay well inside provider
      // limits while comfortably fitting 5-10 step batches.
      const maxTokens = Math.min(8192, 1024 + missInputs.length * 512);
      const resp = await anthropic.messages.create(
        {
          model: this.model,
          max_tokens: maxTokens,
          temperature: 0,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: sanitisedUserPrompt }],
        },
        { timeout: this.providerTimeoutMs },
      );
      this.callsCounter += 1;
      const callLatency = Date.now() - callStart;
      const firstBlock = (resp.content ?? [])[0];
      if (firstBlock && firstBlock.type === "text") {
        responseText = firstBlock.text;
      }
      this.log({
        kind: "provider_call_done",
        model: this.model,
        latencyMs: callLatency,
        inputTokens: resp.usage?.input_tokens ?? 0,
        outputTokens: resp.usage?.output_tokens ?? 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log({ kind: "error", phase: "anthropic", message });
      const errResult = {
        error: `Anthropic API call failed: ${message}`,
        fromCache: false as const,
      };
      for (const i of missIndexes) results[i] = errResult;
      return results.map((r) => r!);
    }

    // 5) Parse response as a JSON array of N bindings.
    let parsedArray: unknown[];
    try {
      // Strip ```json fences if present.
      let body = responseText.trim();
      const fence = body.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
      if (fence) body = fence[1].trim();
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed)) {
        throw new Error("expected a JSON array");
      }
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

    // 6) Per-slot parse + validate. Write cache + populate results.
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
      // Reuse parseBindingJson by stringifying the slot back. This
      // keeps the same hallucination / empty-locator / context-rewrite
      // logic in one place rather than duplicating the validators.
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
    if (this.anthropic) return this.anthropic;
    try {
      // @anthropic-ai/sdk is in optionalDependencies. require() defensively.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require("@anthropic-ai/sdk");
      const Anthropic = mod.Anthropic ?? mod.default ?? mod;
      this.anthropic = new Anthropic({ apiKey: this.apiKey });
      return this.anthropic;
    } catch {
      return null;
    }
  }

  /**
   * v4.0.0 — generic single-prompt text generation. Routes through the
   * same governance + budget + timeout pipeline as `generateBinding`,
   * but returns raw model text rather than a parsed StepBinding.
   *
   * Cache is intentionally NOT consulted here. Synthetic data calls
   * typically want fresh variation per scaffold; binding calls want
   * cache hits. Separating the cache concern keeps the synth flow
   * predictable.
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
      return { error: "ANTHROPIC_API_KEY is not set; pass apiKey or set the env var." };
    }
    const anthropic = await this.lazyClient();
    if (!anthropic) {
      return { error: "@anthropic-ai/sdk not installed. Run: npm install @anthropic-ai/sdk" };
    }

    this.attemptsCounter += 1;
    try {
      this.log({
        kind: "provider_call_start",
        model: this.model,
        promptBytes: sanitisedPrompt.length,
      });
      const callStart = Date.now();
      const resp = await anthropic.messages.create(
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
      const text =
        Array.isArray(resp.content) && resp.content[0]?.type === "text"
          ? (resp.content[0] as { text: string }).text
          : "";
      const inputTokens = resp.usage?.input_tokens ?? 0;
      const outputTokens = resp.usage?.output_tokens ?? 0;
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
      this.log({ kind: "error", phase: "anthropic", message });
      return { error: `Anthropic API call failed: ${message}` };
    }
  }

  async close(): Promise<void> {
    if (this.cache) {
      await this.cache.close().catch(() => undefined);
      this.cache = null;
    }
  }
}

/**
 * v2.2.2 — LLM-emitted spec code occasionally references bare `context.`
 * (the Playwright BrowserContext) or `browser.` even though the test
 * fixture only injects `page`. Rewrite to the canonical accessor so the
 * generated spec compiles instead of throwing ReferenceError at runtime.
 *
 * Conservative — only rewrites identifiers at word boundaries followed
 * by a dot, so legitimate uses like `pageContext` / `someContext` /
 * field names containing "context" are left alone.
 */
export function rewriteBareContext(s: string): string {
  return s
    .replace(/\bcontext\./g, "page.context().")
    .replace(/\bbrowser\./g, "page.context().browser().");
}

/**
 * v2.2.3 — the LLM occasionally invents Playwright locator methods that
 * don't exist (`page.getByURL`, `page.getByPath`, `page.getByLink`, etc.).
 * These render to syntactically valid TS that throws at runtime with
 * useless errors like "Cannot read properties of undefined (reading
 * 'context')". We refuse the binding entirely so the step lands as TODO
 * with a clear explanation, instead of letting the bad code into the spec.
 *
 * Real Playwright page.getBy* methods (Playwright 1.40+):
 *   getByAltText, getByLabel, getByPlaceholder, getByRole, getByTestId,
 *   getByText, getByTitle
 *
 * Anything else after `page.getBy` is hallucinated.
 *
 * Returns the list of bad method names found (empty when clean).
 */
const VALID_PAGE_GETBY = new Set([
  "getByAltText",
  "getByLabel",
  "getByPlaceholder",
  "getByRole",
  "getByTestId",
  "getByText",
  "getByTitle",
]);
export function detectHallucinatedLocators(s: string): string[] {
  const hits: string[] = [];
  const re = /\bpage\.(getBy[A-Z][A-Za-z]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (!VALID_PAGE_GETBY.has(m[1])) hits.push(m[1]);
  }
  // v3.1.0 — also reject `:root` as a locator argument. It's
  // syntactically valid CSS but matches `<html>`, which is useless for
  // every visibility / click / text assertion. The LLM occasionally
  // emits it when it can't synthesise a sensible selector — better to
  // reject and land the step as a TODO than to ship code that targets
  // the whole document and produces always-failing visibility checks.
  if (/\blocator\(\s*["']:root["']\s*\)/.test(s)) {
    hits.push("locator(':root')");
  }
  return hits;
}

/**
 * Parse the LLM's text response as JSON and validate it has the expected
 * StepBinding shape. Returns undefined on any failure (caller soft-fails).
 *
 * The LLM occasionally wraps JSON in ```json ... ``` fences despite the
 * system prompt — strip those before parsing.
 */
export function parseBindingJson(
  text: string,
  input: GenerateBindingInput,
): StepBinding | undefined {
  let trimmed = text.trim();
  // Strip ```json ... ``` fences if present.
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) trimmed = fenceMatch[1].trim();
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;

  // Echo the step from the input — the LLM's "step" field is sometimes
  // slightly different (it normalises whitespace, capitalises, etc.). Use
  // ours so downstream comments stay consistent.
  const out: StepBinding = {
    step: { ...input.step },
  };

  if (parsed.pomCall && typeof parsed.pomCall === "object") {
    const pc = parsed.pomCall;
    if (typeof pc.page === "string" && typeof pc.method === "string") {
      out.pomCall = {
        page: pc.page,
        method: pc.method,
        args: Array.isArray(pc.args) ? pc.args.map(String) : [],
      };
    }
  }
  if (parsed.assertion && typeof parsed.assertion === "object") {
    const a = parsed.assertion;
    // v2.2.4 — accept missing or empty locator. The v2.2.3 prompt told
    // the LLM to "leave locator as the page itself / use empty string"
    // for toHaveURL, which it took literally and emitted `locator: ""`.
    // We default empty/missing → "page" here so downstream rendering
    // always produces `expect(page).toHaveURL(...)` instead of the
    // illegal `expect().toHaveURL(...)`.
    const matcher = typeof a.matcher === "string" ? a.matcher : undefined;
    if (matcher) {
      const rawLoc = typeof a.locator === "string" ? a.locator : "";
      const trimmedLoc = rawLoc.trim();
      // Empty/missing locator always becomes "page" — `expect()` is never
      // legal, and for page-level matchers (toHaveURL / toHaveTitle and
      // their .not variants) `expect(page)` is the right call anyway.
      const resolvedLoc =
        trimmedLoc === "" ? "page" : rewriteBareContext(rawLoc);
      out.assertion = {
        locator: resolvedLoc,
        matcher,
        expected:
          typeof a.expected === "string" ? a.expected : undefined,
      };
    }
  }
  if (typeof parsed.customBody === "string") {
    // v2.2.2 — LLM occasionally emits bare `context.` (e.g. `await
    // context.clearCookies()`). Test fixtures only inject `page`; bare
    // `context` is a ReferenceError. Rewrite to `page.context().` here
    // so the spec compiles.
    out.customBody = rewriteBareContext(parsed.customBody);
  }
  if (typeof parsed.warning === "string") {
    out.warning = parsed.warning;
  }

  // At least one of the four must be set; otherwise the LLM produced an
  // empty binding which we reject.
  if (
    !out.pomCall &&
    !out.assertion &&
    !out.customBody &&
    !out.warning
  ) {
    return undefined;
  }

  // v2.2.3 — reject any binding that uses a hallucinated `page.getBy*`
  // method. Better to land as TODO with a useful warning than to ship
  // syntactically-valid-but-runtime-broken code like `page.getByURL(...)`.
  const checkFields: string[] = [];
  if (out.assertion?.locator) checkFields.push(out.assertion.locator);
  if (out.assertion?.expected) checkFields.push(out.assertion.expected);
  if (out.customBody) checkFields.push(out.customBody);
  if (out.pomCall) checkFields.push(out.pomCall.method, ...out.pomCall.args);
  const allHits = new Set<string>();
  for (const field of checkFields) {
    for (const hit of detectHallucinatedLocators(field)) allHits.add(hit);
  }
  if (allHits.size > 0) {
    return undefined;
  }

  return out;
}
