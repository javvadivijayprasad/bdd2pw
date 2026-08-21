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
 * v4.0.1 — reject hallucinated POM methods.
 *
 * The LLM occasionally emits patterns like:
 *
 *   await loginPage.fill(page.getByLabel("Email"), "x");
 *   await loginPage.click(page.getByRole("button"));
 *
 * inventing `fill(locator, value)` / `click(locator)` as if they were
 * generic helpers on every Page Object. They are not. `fill` and
 * `click` live on `Locator`, not on POM instances. Without this check,
 * the spec compiles only when the LLM happens to remember bdd2pw's POM
 * shape — `loginPage.usernameInput.fill("x")` works; `loginPage.fill(...)`
 * does not. The pattern broke 2/8 apps in the v4.0 bench (Conduit and
 * AutomationPractice).
 *
 * Validation rule: every `<pomVar>.<token>` access in the emitted text
 * must reference either a known POM identifier (`goto`, `page`, or a
 * field discovered by the locator picker) or NOT be followed by `(` —
 * if it's a field access being chained further (`loginPage.usernameInput.fill`),
 * the next `.fill` lives on the Locator type which is fine.
 *
 * Returns the list of unrecognised accesses; empty list = clean binding.
 */
export function detectHallucinatedPomMethods(
  text: string,
  pomVar: string,
  knownIdentifiers: Set<string>,
): string[] {
  const hits: string[] = [];
  // Match `<pomVar>.<identifier>` and capture the identifier. We don't
  // require it to be followed by `(` because field chains like
  // `loginPage.usernameInput.fill` start with a valid field access that
  // must still be a known identifier.
  const escaped = pomVar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\.([a-zA-Z_$][\\w$]*)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = m[1];
    if (!knownIdentifiers.has(id)) hits.push(`${pomVar}.${id}`);
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
      // v4.1.0 — Page-matcher validation gate.
      // `expect(page).<matcher>` only supports a small set (toHaveURL,
      // toHaveTitle, toHaveScreenshot, plus their .not variants). The
      // LLM occasionally emits `toHaveText` / `toContainText` /
      // `toBeVisible` on `page`, which are Locator matchers and TS
      // rejects them. When locator resolves to `page` AND the matcher
      // is Locator-only, drop the assertion. It lands as TODO instead
      // of shipping a spec that fails to compile.
      const isPageResolved = resolvedLoc === "page";
      const strippedMatcher = matcher.replace(/^not\./, "");
      const pageValidMatchers = new Set([
        "toHaveURL",
        "toHaveTitle",
        "toHaveScreenshot",
      ]);
      if (isPageResolved && !pageValidMatchers.has(strippedMatcher)) {
        // Skip assignment — falls through to the "empty binding" check
        // below and lands as TODO with a `warning` if the LLM provided
        // one, or bare undefined otherwise.
      } else {
        out.assertion = {
          locator: resolvedLoc,
          matcher,
          expected:
            typeof a.expected === "string" ? a.expected : undefined,
        };
      }
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

  // v4.0.1 — reject hallucinated POM-instance methods.
  //
  // The POM has two surfaces:
  //   - METHODS  (pom.methods, e.g. "goto"): directly callable
  //   - FIELDS   (pom.fields, e.g. "email"): Locator instances; NOT
  //              callable directly, must be chained (`email.fill(...)`)
  //
  // So an emitted call `<pomVar>.<name>(...)` is valid iff `<name>` is
  // a known METHOD, OR a chain whose first token is a known FIELD or
  // "page". Bare field calls like `loginPage.email("x")` and bare
  // hallucinations like `loginPage.fill(loc)` are both rejected.
  const knownMethods = new Set<string>(["goto"]);
  for (const meth of input.pom.methods) knownMethods.add(meth.name);
  const knownFields = new Set<string>(["page"]);
  for (const f of input.pom.fields) knownFields.add(f.fieldName);
  // For text-scan we still want the union — chains like
  // `loginPage.email.fill(...)` start with the field name, which must
  // resolve to either a method or a field.
  const knownIds = new Set<string>([...knownMethods, ...knownFields]);

  // Text-scan path — catches hallucinations baked into free-form
  // customBody or assertion locator strings.
  const pomHits = new Set<string>();
  for (const field of checkFields) {
    for (const hit of detectHallucinatedPomMethods(
      field,
      input.pageVar,
      knownIds,
    )) {
      pomHits.add(hit);
    }
  }

  // v4.1.0 — invented-helper rewriter.
  //
  // The OpenAI gpt-4o-mini provider emits `pomCall` shapes like:
  //   {"page":"loginPage","method":"fill","args":["loginPage.usernameInput","\"x\""]}
  // treating the POM as if it had a generic `fill(locator, value)` helper.
  // Real POMs don't; `fill` lives on `Locator`. Before v4.1 this landed as
  // TODO via the v4.0.1 rejector. But the LLM's INTENT is unambiguous —
  // it wants `loginPage.usernameInput.fill("x")` — and we can mechanically
  // rewrite to that form without asking the LLM again.
  //
  // The rewriter is fail-safe by construction: if the pattern doesn't
  // match, `out.pomCall` is untouched and execution falls through to the
  // v4.0.1 rejector, preserving the fail-closed guarantee. In the v4.0
  // bench this pattern accounted for 100% of OpenAI's 0% closure rate;
  // the rewriter should lift it to the ~60% Anthropic already achieves.
  if (out.pomCall) {
    tryRewriteInventedHelper(out.pomCall, input.pageVar, knownFields, knownMethods);
  }

  // v4.1.0 — Pattern C: CSS selector emitted as first arg.
  //   {method:"fill", args:["input[name='email']", "\"x\""]}
  // The LLM knew a selector but didn't route through the POM. Convert
  // to a customBody using `pomVar.page.locator(<sel>)` chain, which
  // always compiles. Only fires if Pattern A/B rewrite didn't already
  // land the binding on a POM field.
  if (out.pomCall) {
    const promoted = tryPromotePomCallCssSelectorToCustomBody(
      out.pomCall,
      input.pageVar,
      knownMethods,
    );
    if (promoted) {
      out.customBody = promoted;
      out.pomCall = undefined;
    }
  }

  // v4.1.0 — Pattern D: customBody containing `page.<method>(pomVar.<field>, ...)`.
  // The LLM occasionally expands a compound step by inventing
  //   await page.fill(pomVar.field, "x");
  // which is NOT valid Playwright (page.fill takes a string selector,
  // not a Locator). Rewrite inline to `pomVar.field.<method>("x")`.
  if (out.customBody) {
    out.customBody = rewriteCustomBodyPageMethods(
      out.customBody,
      input.pageVar,
      knownFields,
    );
  }

  // v4.1.0 — Pattern G: bare-identifier assertion locator.
  // Conduit bench: LLM emitted `{assertion:{locator:"commentsList", ...}}`
  // producing `expect(commentsList).toContainText(...)` — but
  // `commentsList` isn't declared in the spec (should be
  // `loginPage.commentsList`). If the bare identifier IS a known POM
  // field, prepend `pomVar.` to fix. If it's NOT a known field, drop
  // the assertion so the step lands as TODO instead of shipping code
  // with an undefined reference.
  if (out.assertion && out.assertion.locator) {
    const loc = out.assertion.locator.trim();
    // Bare identifier check — no dots, no parens, just [a-zA-Z_$]+
    if (/^[a-zA-Z_$][\w$]*$/.test(loc) && loc !== "page") {
      if (knownFields.has(loc)) {
        out.assertion.locator = `${input.pageVar}.${loc}`;
      } else {
        // Unknown field — reject the assertion. Falls through to the
        // empty-binding check; step will land as TODO.
        out.assertion = undefined;
      }
    }
  }

  // v4.0.1.1 — structured-pomCall path. The pomCall.method shape is
  // either "<method>" (calling a method directly) or "<field>.<...>"
  // (chain through a Locator field). Bare "<field>" is invalid — a
  // Locator instance is not callable, TypeScript rejects with
  // "This expression is not callable".
  if (out.pomCall) {
    const tokens = out.pomCall.method.split(".");
    const first = tokens[0];
    if (!first) {
      pomHits.add(`${input.pageVar}.<empty>`);
    } else if (tokens.length === 1) {
      // Bare call: must be a known method, NOT a field.
      if (!knownMethods.has(first)) {
        pomHits.add(`${input.pageVar}.${first}`);
      }
    } else {
      // Chain: first token must be a known field (or "page").
      if (!knownFields.has(first)) {
        pomHits.add(`${input.pageVar}.${first}`);
      }
    }
  }

  if (pomHits.size > 0) {
    return undefined;
  }

  // v4.1.0 — final empty-binding check. The v4.1 rewriters (Pattern G
  // in particular) can nuke the last surviving field. If after all
  // rewrites there's nothing to emit, drop the binding so the step
  // lands as TODO.
  if (
    !out.pomCall &&
    !out.assertion &&
    !out.customBody &&
    !out.warning
  ) {
    return undefined;
  }

  return out;
}

// ============================================================
// v4.1.0 — invented-helper rewriter (OpenAI compat)
// ============================================================

/**
 * Playwright Locator methods that the LLM sometimes calls as if they
 * were POM-level helpers. Each is a method that lives on `Locator`,
 * takes a value argument (or none), and can be legitimately rewritten
 * from `pomVar.<method>(pomVar.field, ...args)` to `field.<method>(...args)`.
 *
 * Kept small on purpose — a method must be in this set AND the caller's
 * first arg must resolve to a known field for the rewrite to fire. This
 * is intentionally more conservative than the full Playwright surface;
 * expanding it later is safe, contracting it is not.
 */
const LOCATOR_METHOD_ALLOWLIST: ReadonlySet<string> = new Set([
  "fill",
  "click",
  "check",
  "uncheck",
  "type",
  "press",
  "hover",
  "focus",
  "blur",
  "dblclick",
  "tap",
  "clear",
  "selectOption",
  "setInputFiles",
  "scrollIntoViewIfNeeded",
  "dispatchEvent",
  "screenshot",
]);

/**
 * v4.1.0 — wrap a raw arg value in JS string quotes if it looks like a
 * bare string literal the LLM forgot to quote. Used when rewriting
 * Pattern B where args come through unquoted.
 *
 * Returns the value in a form safe to concatenate into TypeScript. Rules:
 *  - Already quoted (`"..."`, `'...'`, backtick) → return as-is.
 *  - Reserved literals (`true`, `false`, `null`, `undefined`, numbers) → as-is.
 *  - Property-access chain of two or more parts (`data.email`, `env.USER`)
 *    → as-is; almost always a legit variable reference.
 *  - Everything else — including single bare identifiers like
 *    `locked_out_user`, `secret_sauce`, `standard_user` — wrap in double
 *    quotes.
 *
 * Rationale for the aggressive single-identifier wrapping: LLM-emitted
 * `fill(someBareWord)` calls are, in practice, ALWAYS meant as string
 * literals the model forgot to quote (see SauceDemo v4.1 bench: the LLM
 * emitted `fill(locked_out_user)` when the Gherkin step was `I enter
 * "locked_out_user" as my username` — the string content lost its
 * quotes during JSON emission). Being wrong in the over-quoting
 * direction just creates a string (safe); being wrong in the
 * under-quoting direction leaves an undefined reference (TS compile
 * fail). We optimise for the failure mode that actually shows up.
 */
function wrapAsStringLiteralIfNeeded(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return raw;
  // Already quoted?
  const firstCh = trimmed[0];
  const lastCh = trimmed[trimmed.length - 1];
  if (
    (firstCh === '"' && lastCh === '"') ||
    (firstCh === "'" && lastCh === "'") ||
    (firstCh === "`" && lastCh === "`")
  ) {
    return raw;
  }
  // Reserved literals / numbers — don't wrap.
  if (/^(true|false|null|undefined)$/.test(trimmed)) return raw;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return raw;
  // Property-access CHAIN (two+ parts: foo.bar, env.USER, data.field.sub)
  // — leave; almost always a legit variable reference.
  if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(trimmed)) return raw;
  // Everything else — including bare single identifiers, text with
  // spaces, email addresses, punctuation — wrap in double quotes,
  // escaping internal " and \.
  const escaped = trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * v4.1.0 — mutate `pomCall` in place when the LLM's shape matches an
 * invented-helper pattern. Two patterns supported:
 *
 * Pattern A — pomVar-prefixed field, already-quoted value (OpenAI style):
 *   {method:"fill", args:["loginPage.usernameInput", "\"x\""]}
 *   → {method:"usernameInput.fill", args:["\"x\""]}
 *
 * Pattern B — bare-identifier field, unquoted value (AutomationPractice
 * style seen in the v4.0 bench; the LLM emitted the JSON shorthand
 * assuming the caller would resolve `email` → `pomVar.email` and
 * quote `bench@example.com` as a string):
 *   {method:"fill", args:["email", "bench@example.com"]}
 *   → {method:"email.fill", args:["\"bench@example.com\""]}
 *
 * Fail-safe rules — if ANY fail, `pomCall` is untouched and the caller's
 * v4.0.1 gate rejects as before:
 *  1. `method` must be a bare identifier in LOCATOR_METHOD_ALLOWLIST.
 *  2. Method must NOT already be a known POM method (e.g. `goto`) —
 *     the LLM meant something else; we don't rewrite valid calls.
 *  3. `args[0]` must resolve to a known POM field (via `pomVar.<field>`
 *     for Pattern A, or a bare `<field>` reference for Pattern B).
 *  4. `page` is never a valid rewrite target (built-in, not a POM field).
 *
 * Returns true if a rewrite happened, false otherwise.
 */
export function tryRewriteInventedHelper(
  pomCall: { page: string; method: string; args: string[] },
  pomVar: string,
  knownFields: ReadonlySet<string>,
  knownMethods: ReadonlySet<string>,
): boolean {
  const method = pomCall.method;
  // Rule 1 — method must be a Locator method in the allowlist.
  if (!LOCATOR_METHOD_ALLOWLIST.has(method)) return false;
  // Rule 2 — don't rewrite calls that already resolve to a POM method.
  if (knownMethods.has(method)) return false;
  const args = pomCall.args;
  if (!args || args.length === 0) return false;
  const first = args[0];
  if (typeof first !== "string") return false;

  // Determine which pattern this is by parsing the first arg.
  let fieldName: string | undefined;
  const escaped = pomVar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Pattern A: <pomVar>.<field>
  const patA = first.match(new RegExp(`^\\s*${escaped}\\.([a-zA-Z_$][\\w$]*)\\s*$`));
  if (patA) {
    fieldName = patA[1];
  } else {
    // Pattern B: bare <field> identifier.
    const patB = first.match(/^\s*([a-zA-Z_$][\w$]*)\s*$/);
    if (patB) fieldName = patB[1];
  }
  if (!fieldName) return false;
  // Rule 3 — field must be a known POM field.
  if (!knownFields.has(fieldName)) return false;
  // Rule 4 — `page` is off-limits.
  if (fieldName === "page") return false;

  // All rules pass. Mutate in place. For Pattern B, also auto-quote any
  // trailing args that look like bare string literals (e.g. email
  // addresses, human-readable text).
  pomCall.method = `${fieldName}.${method}`;
  const rest = args.slice(1);
  if (patA) {
    // Pattern A — args are already quoted by convention; pass through.
    pomCall.args = rest;
  } else {
    // Pattern B — value(s) probably need quoting.
    pomCall.args = rest.map(wrapAsStringLiteralIfNeeded);
  }
  return true;
}

/**
 * v4.1.0 — Pattern C. Detect a `pomCall` where the first arg is a raw
 * CSS selector rather than a POM field. Convert to a `customBody`
 * expression using `pomVar.page.locator("<selector>").<method>(...)`.
 *
 * Returns the customBody string if promotion happened, or undefined if
 * no rewrite applies. Callers set `out.customBody = <result>` and clear
 * `out.pomCall` when a value is returned.
 *
 * Heuristic for "looks like a CSS selector": contains any of `[ ] # . > ~ + :`
 * OR whitespace (typical of compound selectors), AND is NOT already a
 * bare JS identifier / property chain. This is conservative — bare
 * identifiers like "email" are handled by Pattern B, not here.
 */
export function tryPromotePomCallCssSelectorToCustomBody(
  pomCall: { page: string; method: string; args: string[] },
  pomVar: string,
  knownMethods: ReadonlySet<string>,
): string | undefined {
  const method = pomCall.method;
  if (!LOCATOR_METHOD_ALLOWLIST.has(method)) return undefined;
  if (knownMethods.has(method)) return undefined;
  const args = pomCall.args;
  if (!args || args.length === 0) return undefined;
  const first = args[0];
  if (typeof first !== "string") return undefined;
  const trimmed = first.trim();
  if (trimmed.length === 0) return undefined;
  // Exclude JS-identifier-shaped strings (Pattern A/B territory).
  if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(trimmed)) return undefined;
  // Exclude JS function calls and template literals (`page.getByLabel("x")`,
  // `data.foo()`, backtick strings) — those are Playwright / JS code
  // the LLM produced by mistake, not CSS selectors. Legitimate CSS
  // like `input[name='email']` has quotes inside brackets but never
  // parentheses at top level.
  if (/[()`]/.test(trimmed)) return undefined;
  // Require actual CSS-selector syntax. Whitespace alone is NOT enough
  // (button text like "Sign in" has spaces but isn't a selector). The
  // characters below only appear in CSS selectors or the syntax that
  // qualifies a bare tag like `div>span`, `#id`, `.class`, `[attr=x]`,
  // `:hover`, `*`, `+ sibling`, `~ general-sibling`.
  const looksLikeSelector = /[\[\]#>~+*]|\.[A-Za-z_]|:[a-z]/.test(trimmed);
  if (!looksLikeSelector) return undefined;
  // Strip surrounding quotes if already quoted (LLM sometimes emits
  // `"input[name='email']"`, sometimes bare `input[name='email']`).
  let sel = trimmed;
  if ((sel.startsWith('"') && sel.endsWith('"')) || (sel.startsWith("'") && sel.endsWith("'"))) {
    sel = sel.slice(1, -1);
  }
  const restArgs = args.slice(1).map(wrapAsStringLiteralIfNeeded);
  const argList = restArgs.join(", ");
  const selLiteral = JSON.stringify(sel);
  return `await ${pomVar}.page.locator(${selLiteral}).${method}(${argList});`;
}

/**
 * v4.1.0 — Pattern D. Rewrite `page.<method>(<pomVar>.<field>, <value>)`
 * patterns inside a customBody string, since `page.<method>(locator, ...)`
 * is not valid Playwright — `page.fill/click/etc.` take string selectors,
 * not Locator instances. The correct form is `<pomVar>.<field>.<method>(<value>)`.
 *
 * Only rewrites methods in LOCATOR_METHOD_ALLOWLIST and only when the
 * arg is `<pomVar>.<field>` where <field> is a known POM field. All
 * other `page.<method>(...)` calls (including legit ones like
 * `page.goto("/url")` or `page.locator("...")`) are left untouched.
 */
export function rewriteCustomBodyPageMethods(
  body: string,
  pomVar: string,
  knownFields: ReadonlySet<string>,
): string {
  const escapedPomVar = pomVar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match: page.<method>(<pomVar>.<field>[, <rest>]);
  // Capture the method, field, and (optionally) rest of args.
  const methodAlt = Array.from(LOCATOR_METHOD_ALLOWLIST).join("|");
  const re = new RegExp(
    `\\bpage\\.(${methodAlt})\\(\\s*${escapedPomVar}\\.([a-zA-Z_$][\\w$]*)\\s*(?:,\\s*([^;]*?))?\\)`,
    "g",
  );
  return body.replace(re, (whole, method, fieldName, rest) => {
    if (!knownFields.has(fieldName)) return whole; // Unknown field — leave alone.
    if (fieldName === "page") return whole; // `pomVar.page` never rewrites.
    const restTrimmed = (rest ?? "").trim();
    return restTrimmed.length > 0
      ? `${pomVar}.${fieldName}.${method}(${restTrimmed})`
      : `${pomVar}.${fieldName}.${method}()`;
  });
}
