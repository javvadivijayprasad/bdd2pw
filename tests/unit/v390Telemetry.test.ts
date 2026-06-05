/**
 * v3.9.0 — LLM telemetry collector tests.
 *
 * Drives synthetic event sequences through `LLMTelemetry.handleEvent`
 * and asserts the aggregated summary numbers. No real Anthropic calls.
 */

import { describe, it, expect } from "vitest";
import { LLMTelemetry, DEFAULT_PRICING } from "../../src/llm/telemetry";
import type { LLMLogEvent } from "../../src/llm/types";

const MODEL = "claude-sonnet-4-6";

function fireBatchCall(
  t: LLMTelemetry,
  opts: { batchSize: number; inputTokens: number; outputTokens: number; latencyMs: number },
): void {
  // Simulate the AnthropicLLMClient.generateBatchBindings event flow:
  // N cache_miss events, then provider_call_start, then provider_call_done.
  for (let i = 0; i < opts.batchSize; i++) {
    t.handleEvent({ kind: "cache_miss", key: `k-${i}` });
  }
  t.handleEvent({ kind: "provider_call_start", model: MODEL, promptBytes: 1000 });
  t.handleEvent({
    kind: "provider_call_done",
    model: MODEL,
    latencyMs: opts.latencyMs,
    inputTokens: opts.inputTokens,
    outputTokens: opts.outputTokens,
  });
  // Each binding parsed contributes to bindingsGenerated.
  for (let i = 0; i < opts.batchSize; i++) {
    t.handleEvent({ kind: "binding_parsed" } as LLMLogEvent);
  }
}

describe("v3.9.0 — LLMTelemetry", () => {
  it("aggregates one batch call correctly", () => {
    const t = new LLMTelemetry("scaffold-001", "3.9.0");
    fireBatchCall(t, {
      batchSize: 3,
      inputTokens: 4500,
      outputTokens: 1200,
      latencyMs: 2100,
    });
    const summary = t.toSummary();
    expect(summary.totals.callsAttempted).toBe(1);
    expect(summary.totals.callsSuccessful).toBe(1);
    expect(summary.totals.bindingsGenerated).toBe(3);
    expect(summary.totals.cacheMisses).toBe(3);
    expect(summary.totals.cacheHits).toBe(0);
    expect(summary.totals.cacheHitRate).toBe(0);
    expect(summary.totals.inputTokens).toBe(4500);
    expect(summary.totals.outputTokens).toBe(1200);
    expect(summary.calls[0].batchSize).toBe(3);
    expect(summary.calls[0].latencyMs).toBe(2100);
  });

  it("computes cache hit rate across cached + uncached scenarios", () => {
    const t = new LLMTelemetry("scaffold-002", "3.9.0");
    // 6 cache hits (no provider call).
    for (let i = 0; i < 6; i++) {
      t.handleEvent({ kind: "cache_hit", key: `h-${i}` });
    }
    // 2 cache misses → one batch call producing 2 bindings.
    fireBatchCall(t, {
      batchSize: 2,
      inputTokens: 2000,
      outputTokens: 500,
      latencyMs: 1500,
    });
    const summary = t.toSummary();
    expect(summary.totals.cacheHits).toBe(6);
    expect(summary.totals.cacheMisses).toBe(2);
    expect(summary.totals.cacheHitRate).toBeCloseTo(6 / 8, 3);
    expect(summary.totals.bindingsGenerated).toBe(6 + 2);
    expect(summary.totals.callsAttempted).toBe(1);
  });

  it("computes p50 / p95 latency across multiple calls", () => {
    const t = new LLMTelemetry("scaffold-003", "3.9.0");
    const latencies = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    for (const ms of latencies) {
      fireBatchCall(t, {
        batchSize: 1,
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: ms,
      });
    }
    const summary = t.toSummary();
    expect(summary.latencyMs.min).toBe(100);
    expect(summary.latencyMs.max).toBe(1000);
    // p50: ceil(10 * 0.5) - 1 = 4 → sortedAsc[4] = 500.
    expect(summary.latencyMs.p50).toBe(500);
    // p95: ceil(10 * 0.95) - 1 = 9 → sortedAsc[9] = 1000.
    expect(summary.latencyMs.p95).toBe(1000);
  });

  it("estimates cost from per-million pricing snapshot", () => {
    const t = new LLMTelemetry("scaffold-004", "3.9.0");
    // 1 million input + 1 million output tokens through one batch.
    fireBatchCall(t, {
      batchSize: 10,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      latencyMs: 5000,
    });
    const summary = t.toSummary();
    // Sonnet pricing: $3/M input + $15/M output = $18 total.
    expect(summary.totals.estimatedCostUsd).toBeCloseTo(18, 3);
    expect(summary.pricing.model).toBe(MODEL);
    expect(summary.pricing.inputUsdPerMillion).toBe(
      DEFAULT_PRICING[MODEL].inputUsdPerMillion,
    );
  });

  it("scaffold context is stamped into the summary", () => {
    const t = new LLMTelemetry("scaffold-CUSTOM-123", "3.9.0");
    const summary = t.toSummary();
    expect(summary.scaffoldId).toBe("scaffold-CUSTOM-123");
    expect(summary.version).toBe("3.9.0");
    expect(summary.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("handles zero events gracefully (empty scaffold)", () => {
    const t = new LLMTelemetry("scaffold-empty", "3.9.0");
    const summary = t.toSummary();
    expect(summary.totals.callsAttempted).toBe(0);
    expect(summary.totals.cacheHitRate).toBe(0);
    expect(summary.calls).toEqual([]);
    expect(summary.latencyMs.p50).toBe(0);
    expect(summary.latencyMs.p95).toBe(0);
  });
});
