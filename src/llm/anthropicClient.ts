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
import { SYSTEM_PROMPT, buildUserPrompt, cacheKey } from "./prompt";
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
  private anthropic: any | null = null; // lazy-loaded SDK instance

  constructor(opts: LLMClientOptions, cachePathDefault: string) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.maxCalls = opts.maxCalls ?? DEFAULT_MAX_CALLS;
    this.skipGovernance = opts.skipGovernance ?? false;
    this.log = opts.log ?? (() => {});
    this.governance = new GovernanceClient(
      opts.governanceUrl ?? DEFAULT_GOVERNANCE_URL,
    );
    this.cachePath = opts.cachePath ?? cachePathDefault;
  }

  async ensureCache(): Promise<BindingCache> {
    if (!this.cache) {
      this.cache = await openSqliteCache(this.cachePath);
    }
    return this.cache;
  }

  budgetExhausted(): boolean {
    return this.callsCounter >= this.maxCalls;
  }
  callsMade(): number {
    return this.callsCounter;
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
    try {
      this.log({
        kind: "provider_call_start",
        model: this.model,
        promptBytes: sanitisedUserPrompt.length,
      });
      const callStart = Date.now();
      const resp = await anthropic.messages.create({
        model: this.model,
        max_tokens: 1024,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: sanitisedUserPrompt }],
      });
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

  async close(): Promise<void> {
    if (this.cache) {
      await this.cache.close().catch(() => undefined);
      this.cache = null;
    }
  }
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
    if (typeof a.locator === "string" && typeof a.matcher === "string") {
      out.assertion = {
        locator: a.locator,
        matcher: a.matcher,
        expected:
          typeof a.expected === "string" ? a.expected : undefined,
      };
    }
  }
  if (typeof parsed.customBody === "string") {
    out.customBody = parsed.customBody;
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
  return out;
}
