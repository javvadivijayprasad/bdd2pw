/**
 * LLM fallback types — v2.0.
 *
 * The LLM is invoked ONLY when bdd2pw's deterministic rule table
 * (`src/transformers/stepMatcher.ts`) fails to match a step. The LLM's
 * job is to produce a single `StepBinding` matching the existing IR
 * shape. This is identical to what a hand-written rule would produce, so
 * downstream emitters don't need to know an LLM was involved.
 *
 * Every LLM-generated binding is also appended to
 * `<repo>/artefacts/candidate-rules.jsonl` so a separate offline pipeline
 * can review and propose new deterministic rules. Auto-writing rules
 * back into `stepMatcher.ts` is deferred to v2.1+ (see docs/SCOPE.md).
 */

import type { PageObjectIR, StepIR, StepBinding } from "../types";

export interface LLMClientOptions {
  /** Provider identifier — "anthropic" in v2.0; OpenAI/Gemini in v2.1+. */
  provider: "anthropic";
  /** Anthropic model. Default: claude-sonnet-4-6. */
  model?: string;
  /** API key. Resolved from env var (ANTHROPIC_API_KEY) when omitted. */
  apiKey?: string;
  /**
   * ai-governance sidecar base URL — default http://localhost:4900.
   * EVERY prompt is POSTed to `${governanceUrl}/sanitize` before being
   * sent to the provider. If the sidecar is unreachable, generation fails
   * (fail-closed) — we don't leak unsanitised payloads.
   */
  governanceUrl?: string;
  /** Max LLM calls per scaffold(). Default 50. */
  maxCalls?: number;
  /** Cache database path. Default <repo>/.bdd2pw/llm-cache.sqlite. */
  cachePath?: string;
  /**
   * Disable governance sanitisation. NOT for production — only useful in
   * unit tests where the sidecar isn't running and the test prompts
   * contain no real user data.
   */
  skipGovernance?: boolean;
  /**
   * Optional logger callback (defaults to no-op). Useful in tests to
   * capture prompts/responses without polluting stdout. v2.2.0 — the
   * scaffold orchestrator wires bdd2pw's pino logger here so cache
   * fallbacks, governance latencies, and provider-call timings show up
   * in the standard JSON-formatted scaffold log without operators
   * having to parse review items.
   */
  log?: (event: LLMLogEvent) => void;
  /**
   * v2.2.0 — per-step deadline for the WHOLE LLM fallback path
   * (cache lookup → governance sanitise → Anthropic call → parse).
   * On expiry, generateBinding() returns `{ error: "deadline exceeded" }`
   * so the step lands as `// TODO:` instead of hanging the scaffold.
   * Default: 60_000 (60 s).
   */
  stepTimeoutMs?: number;
  /**
   * v2.2.0 — per-call timeout passed to the Anthropic SDK. Independent
   * from `stepTimeoutMs` — a single Anthropic call must finish in
   * `providerTimeoutMs`, while the entire step (including governance
   * sanitisation, cache, parse) must finish in `stepTimeoutMs`.
   * Default: 30_000 (30 s).
   */
  providerTimeoutMs?: number;
  /**
   * v2.2.0 — per-call timeout for governance sidecar `/sanitize`.
   * Default: 15_000 (15 s).
   */
  governanceTimeoutMs?: number;
  /**
   * v3.5.0 — disable the batch fallback path. When true, every
   * unmatched step fires its own provider call (the pre-v3.5 default).
   * Use only if a customer hits a provider-side per-prompt token
   * limit on large batches, or wants strict 1:1 call accounting for
   * audit reasons.
   */
  disableBatch?: boolean;
}

export type LLMLogEvent =
  | { kind: "cache_hit"; key: string }
  | { kind: "cache_miss"; key: string }
  | { kind: "cache_fallback"; reason: string }
  | { kind: "sanitise_start"; bytes: number }
  | { kind: "sanitise_done"; bytes: number; findings: number }
  | { kind: "provider_call_start"; model: string; promptBytes: number }
  | {
      kind: "provider_call_done";
      model: string;
      latencyMs: number;
      inputTokens: number;
      outputTokens: number;
    }
  | { kind: "binding_parsed"; binding: StepBinding }
  | { kind: "step_deadline_exceeded"; stepText: string; deadlineMs: number }
  | { kind: "error"; phase: string; message: string };

/** Input to the step-binding generator. */
export interface GenerateBindingInput {
  /** The Gherkin step that didn't match any rule. */
  step: StepIR;
  /** The current Page Object — fields, methods, class name. */
  pom: PageObjectIR;
  /** camelCase variable name used in the spec (e.g. `loginPage`). */
  pageVar: string;
  /** URL the scaffold targets — gives the LLM additional context. */
  url?: string;
  /** Stable scaffold-run identifier. Logged into candidate-rules.jsonl. */
  scaffoldId: string;
}

/** Result of an LLM-generation attempt. */
export interface GenerateBindingResult {
  /** When generation succeeds. */
  binding?: StepBinding;
  /** When generation fails — soft-fail, caller falls back to TODO warning. */
  error?: string;
  /** True if the binding came from cache (no provider call made). */
  fromCache: boolean;
  /** Provider model name (for audit). */
  model?: string;
  /** Total latency including governance + provider + parsing, ms. */
  latencyMs?: number;
}

/**
 * Pluggable LLM client. v2.0 ships AnthropicLLMClient (provider=anthropic)
 * and MockLLMClient (for tests). v2.1 adds OpenAI/Gemini.
 */
export interface LLMClient {
  /** Generate a StepBinding for an unmatched step. */
  generateBinding(input: GenerateBindingInput): Promise<GenerateBindingResult>;
  /**
   * v3.5.0 — generate bindings for MULTIPLE unmatched steps in one
   * provider call. The implementation must:
   *   1. Honour cache per-step (skip steps already cached, return their
   *      cached results in order, fold the rest into a batch prompt).
   *   2. Count the batch as ONE call against `budgetExhausted`.
   *   3. Return results in the same order as `inputs`.
   *   4. Soft-fail per-step on parse error (one bad slot doesn't kill
   *      the whole batch).
   *
   * Optional — older clients (or test stubs) that don't implement it
   * make `matchScenarioWithLLM` fall back to per-step `generateBinding`.
   */
  generateBatchBindings?(
    inputs: GenerateBindingInput[],
  ): Promise<GenerateBindingResult[]>;
  /** Have we hit the max-calls budget for this scaffold? */
  budgetExhausted(): boolean;
  /** Successful provider responses (parsed bindings). */
  callsMade(): number;
  /**
   * All provider call attempts including failures (v2.0.1+). Optional
   * for backwards compat — older clients return undefined and callers
   * should fall back to `callsMade()` for their stats line.
   */
  callsAttempted?(): number;
  /**
   * v2.0.2+ — null until first generateBinding(), then true if the
   * persistent SQLite cache loaded, false if we fell back to in-memory
   * (native binding mismatch, missing module, fs error, etc.). Callers
   * surface this in the scaffold review report so operators know cache
   * isn't durable across runs.
   */
  cacheBackendPersistent?(): boolean | null;
  /** v2.0.2+ — when persistent is false, the underlying load reason. */
  cacheBackendFallbackReason?(): string | undefined;
  /** Close any underlying resources (cache db handle, etc.). */
  close?(): Promise<void>;
}

/**
 * Single line written to artefacts/candidate-rules.jsonl. The offline
 * review pipeline ingests these to propose new deterministic rules.
 */
export interface CandidateRuleEntry {
  /** ISO-8601 timestamp of when the LLM produced this binding. */
  ts: string;
  /** Stable scaffold-run identifier. */
  scaffoldId: string;
  /** Original Gherkin step text — input to any future regex. */
  stepText: string;
  /** Step keyword (Given/When/Then/And/But) — for context. */
  stepKeyword: string;
  /** The binding the LLM produced. */
  binding: StepBinding;
  /** POM signature — class name + field names + method names. */
  pomSignature: {
    className: string;
    fieldNames: string[];
    methodNames: string[];
  };
  /** LLM provider + model. */
  provider: string;
  model: string;
  /** Whether this binding came from cache (LLM not actually called). */
  fromCache: boolean;
}
