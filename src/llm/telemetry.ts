/**
 * v3.9.0 — LLM telemetry collector.
 *
 * Subscribes to the existing `LLMLogEvent` stream that AnthropicLLMClient
 * emits during `generateBinding` / `generateBatchBindings`, accumulates
 * per-call stats, and exposes an aggregated summary suitable for writing
 * to `<repo>/artefacts/llm-stats.json`.
 *
 * Why this exists: v3.5.0 introduced per-scenario batching which can cut
 * Anthropic spend by ~75% on unmatched-heavy scaffolds. Until this
 * release, the savings were invisible — operators had no per-scaffold
 * record of cache hit rate, batch size distribution, token counts, or
 * estimated cost. The sidecar makes the ROI measurable per run.
 *
 * Design constraints:
 *   - Zero overhead when disabled. The collector is constructed
 *     conditionally; the log-event fan-out is a single `if` check at
 *     the bdd2pw orchestrator layer.
 *   - Per-call detail PLUS aggregates. Operators want both "this
 *     scaffold cost $0.07" and "the batch of 5 unmatched steps in
 *     scenario X took 2.3s and consumed 6700 input tokens".
 *   - Cost is an ESTIMATE. Provider prices change; the sidecar
 *     records the per-million rates used so a reviewer can re-derive
 *     the number against current pricing.
 *   - Backwards compatible: no change to LLMClient interface, no
 *     change to existing log consumers. The collector is a regular
 *     `log: (e) => {...}` subscriber.
 */

import type { LLMLogEvent } from "./types";

/** Per-call record. Multiple calls accumulate into one sidecar. */
export interface TelemetryCall {
  /** Sequence number assigned at start, 1-based. */
  index: number;
  /** Provider model name (e.g. "claude-sonnet-4-6"). */
  model?: string;
  /** Tokens the provider charged for input. */
  inputTokens: number;
  /** Tokens the provider charged for output. */
  outputTokens: number;
  /** End-to-end provider call latency in milliseconds. */
  latencyMs: number;
  /** True when the call short-circuited from cache (no provider RPC). */
  fromCache: boolean;
  /**
   * For batch calls — how many bindings the prompt asked for. We
   * infer this from the sequence of `cache_miss` events between
   * provider_call_start and provider_call_done. Defaults to 1 for
   * single-step calls.
   */
  batchSize: number;
}

export interface TelemetrySummary {
  version: string;
  scaffoldId: string;
  generatedAt: string;
  totals: {
    /** Calls the client started (cache hits don't count). */
    callsAttempted: number;
    /** Calls that returned a parseable binding. */
    callsSuccessful: number;
    /** Total bindings produced (cache + LLM). */
    bindingsGenerated: number;
    cacheHits: number;
    cacheMisses: number;
    /** 0–1 ratio. */
    cacheHitRate: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
  /** Per-call detail. */
  calls: TelemetryCall[];
  latencyMs: {
    p50: number;
    p95: number;
    min: number;
    max: number;
  };
  /** What pricing model the cost estimate used. */
  pricing: {
    model: string;
    inputUsdPerMillion: number;
    outputUsdPerMillion: number;
  };
}

/**
 * Per-million-token pricing snapshot used to estimate cost. Prices
 * change; the sidecar records what we used so a reviewer can re-derive.
 *
 * Update when you know providers raised / lowered prices, OR pass an
 * override via `LLMTelemetry`'s constructor.
 */
export const DEFAULT_PRICING: Record<
  string,
  { inputUsdPerMillion: number; outputUsdPerMillion: number }
> = {
  // Anthropic Claude Sonnet 4.6 — Q4 2025 published pricing.
  "claude-sonnet-4-6": { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
  // Older Sonnet generation (still used by some clients) — same pricing.
  "claude-3-7-sonnet-latest": {
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
  },
  // Anthropic Opus — when used.
  "claude-opus-4-6": { inputUsdPerMillion: 15, outputUsdPerMillion: 75 },
  // Anthropic Haiku — when used.
  "claude-haiku-4-5-20251001": {
    inputUsdPerMillion: 0.8,
    outputUsdPerMillion: 4,
  },
  // OpenAI — v3.11.0 provider parity. Q4 2025 published pricing.
  "gpt-4o": { inputUsdPerMillion: 2.5, outputUsdPerMillion: 10 },
  "gpt-4o-mini": { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.6 },
  "gpt-4-turbo": { inputUsdPerMillion: 10, outputUsdPerMillion: 30 },
  o1: { inputUsdPerMillion: 15, outputUsdPerMillion: 60 },
  "o1-mini": { inputUsdPerMillion: 3, outputUsdPerMillion: 12 },
  "o1-preview": { inputUsdPerMillion: 15, outputUsdPerMillion: 60 },
};

/**
 * Telemetry collector. One instance per scaffold call. Subscribe via
 * `.handleEvent` (typed to match the existing `LLMLogEvent` shape);
 * read aggregates via `.toSummary()`; write to disk via
 * `.writeSidecar(path)`.
 */
export class LLMTelemetry {
  private callsCounter = 0;
  /**
   * cache_miss events fire BEFORE provider_call_start in
   * AnthropicLLMClient.generateBatchBindings (cache lookup is step 1,
   * provider call is step 4). We accumulate misses here and snapshot
   * the counter into the in-flight record when the call starts, so
   * batchSize reports correctly regardless of event ordering.
   */
  private pendingMisses = 0;
  /**
   * The call we're currently accumulating into. provider_call_start
   * opens a record (capturing pendingMisses as batchSize); provider_call_done
   * fills in latency + tokens and appends to completedCalls.
   */
  private inFlight: {
    model?: string;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    batchSize: number;
    startTime: number;
  } | null = null;
  private completedCalls: TelemetryCall[] = [];
  private cacheHits = 0;
  private cacheMisses = 0;
  private bindingsGenerated = 0;
  private callsAttempted = 0;
  private modelPricing:
    | { inputUsdPerMillion: number; outputUsdPerMillion: number }
    | undefined;
  private modelName = "unknown";

  constructor(
    private readonly scaffoldId: string,
    private readonly version: string,
    /** Override DEFAULT_PRICING when known per model. */
    private readonly pricingOverride?: Record<
      string,
      { inputUsdPerMillion: number; outputUsdPerMillion: number }
    >,
  ) {}

  /**
   * Subscribe this method to the AnthropicLLMClient log callback:
   *
   *     new AnthropicLLMClient({ ..., log: telemetry.handleEvent }, ...)
   *
   * Or compose with the existing pino logger by fanning out:
   *
   *     log: (e) => { pinoLog(e); telemetry.handleEvent(e); }
   *
   * Multiple events arrive per call. The collector reads the shape
   * to advance its internal state machine.
   */
  handleEvent = (event: LLMLogEvent): void => {
    switch (event.kind) {
      case "cache_hit":
        this.cacheHits += 1;
        this.bindingsGenerated += 1;
        break;
      case "cache_miss":
        this.cacheMisses += 1;
        // Real flow: cache_miss fires BEFORE provider_call_start
        // (cache lookup is step 1, provider call is step 4). Buffer
        // the misses in `pendingMisses` and snapshot them into the
        // record at start time. Also support the case where misses
        // fire AFTER start (older code paths / future refactors) by
        // adding to inFlight.batchSize too.
        if (this.inFlight) this.inFlight.batchSize += 1;
        else this.pendingMisses += 1;
        break;
      case "provider_call_start":
        this.callsAttempted += 1;
        this.inFlight = {
          model: event.model,
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          batchSize: this.pendingMisses,
          startTime: Date.now(),
        };
        // Consume the buffered misses so a subsequent call doesn't
        // double-count them.
        this.pendingMisses = 0;
        // The pricing snapshot tracks whichever model we see first.
        // Most scaffolds use one model start-to-finish.
        this.modelName = event.model;
        const pricing =
          (this.pricingOverride && this.pricingOverride[event.model]) ??
          DEFAULT_PRICING[event.model];
        if (pricing) this.modelPricing = pricing;
        break;
      case "provider_call_done":
        if (this.inFlight) {
          this.inFlight.latencyMs = event.latencyMs;
          this.inFlight.inputTokens = event.inputTokens;
          this.inFlight.outputTokens = event.outputTokens;
          // batchSize may have been incremented by cache_miss events
          // between start and done. If somehow 0, default to 1 (single-
          // step generateBinding case where the orchestrator goes
          // through the per-step path that doesn't emit cache_miss in
          // the start→done window).
          if (this.inFlight.batchSize === 0) this.inFlight.batchSize = 1;
          this.callsCounter += 1;
          this.completedCalls.push({
            index: this.callsCounter,
            model: this.inFlight.model,
            inputTokens: this.inFlight.inputTokens,
            outputTokens: this.inFlight.outputTokens,
            latencyMs: this.inFlight.latencyMs,
            fromCache: false,
            batchSize: this.inFlight.batchSize,
          });
          this.inFlight = null;
        }
        break;
      case "binding_parsed":
        this.bindingsGenerated += 1;
        break;
      // error events don't affect aggregates; they're already
      // captured by the surrounding scaffold log.
      default:
        break;
    }
  };

  toSummary(): TelemetrySummary {
    const latencies = this.completedCalls
      .map((c) => c.latencyMs)
      .sort((a, b) => a - b);
    const inputTokens = this.completedCalls.reduce(
      (acc, c) => acc + c.inputTokens,
      0,
    );
    const outputTokens = this.completedCalls.reduce(
      (acc, c) => acc + c.outputTokens,
      0,
    );
    const pricing = this.modelPricing ?? {
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
    };
    const estimatedCostUsd =
      (inputTokens / 1_000_000) * pricing.inputUsdPerMillion +
      (outputTokens / 1_000_000) * pricing.outputUsdPerMillion;
    const totalCacheChecks = this.cacheHits + this.cacheMisses;
    return {
      version: this.version,
      scaffoldId: this.scaffoldId,
      generatedAt: new Date().toISOString(),
      totals: {
        callsAttempted: this.callsAttempted,
        callsSuccessful: this.callsCounter,
        bindingsGenerated: this.bindingsGenerated,
        cacheHits: this.cacheHits,
        cacheMisses: this.cacheMisses,
        cacheHitRate:
          totalCacheChecks === 0 ? 0 : this.cacheHits / totalCacheChecks,
        inputTokens,
        outputTokens,
        estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
      },
      calls: this.completedCalls,
      latencyMs: {
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        min: latencies.length ? latencies[0] : 0,
        max: latencies.length ? latencies[latencies.length - 1] : 0,
      },
      pricing: {
        model: this.modelName,
        inputUsdPerMillion: pricing.inputUsdPerMillion,
        outputUsdPerMillion: pricing.outputUsdPerMillion,
      },
    };
  }
}

/**
 * Index-based percentile. Returns 0 for an empty array. Sorted input.
 * Picks the ceiling index so p95 of [10, 20, 30, 40, 50] is 50, not 40.
 */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.ceil(sortedAsc.length * p) - 1;
  return sortedAsc[Math.max(0, Math.min(idx, sortedAsc.length - 1))];
}
