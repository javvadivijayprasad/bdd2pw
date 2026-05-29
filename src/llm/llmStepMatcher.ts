/**
 * Async overlay over the deterministic stepMatcher — when the rule table
 * fails to match a step AND an LLM client is provided, fall back to the
 * LLM. Every successful LLM-generated binding is appended to
 * `<repo>/artefacts/candidate-rules.jsonl` for offline review.
 *
 * Why a wrapper, not modifying matchStep:
 *   - Keeps the rule-based matcher pure-sync, so unit tests stay fast.
 *   - LLM fallback is opt-in and orthogonal — easier to reason about
 *     and to disable in CI where determinism matters.
 *   - The wrapper is the natural integration point for the candidate-
 *     rules JSONL writer; the deterministic matcher doesn't need to
 *     know that pipeline exists.
 */

import { matchStep } from "../transformers/stepMatcher";
import type { PageObjectIR, StepBinding, StepIR } from "../types";
import { flattenForComment } from "../utils/commentSafe";
import { CandidateRulesWriter } from "./candidateRules";
import type { LLMClient } from "./types";

export interface MatchStepWithLLMContext {
  /** When provided AND the rule matcher returns a warning, ask the LLM. */
  llm?: LLMClient;
  /** Where to log every successful LLM binding for offline review. */
  candidates?: CandidateRulesWriter;
  /** Stable scaffold-run identifier — written into each candidate row. */
  scaffoldId: string;
  /** Target URL — passed to LLM for additional context. */
  url?: string;
  /**
   * v2.2.0 — per-step deadline for the LLM fallback path. If
   * `llm.generateBinding()` doesn't resolve within this many ms, we
   * abandon the step (TODO + warning) and proceed to the next. Default:
   * 60_000 (60 s). Independent from the AnthropicLLMClient's own
   * `stepTimeoutMs` — this is the OUTER guard at the orchestration
   * layer; the client's is the INNER guard around the SDK call. Both
   * exist because either layer alone could deadlock (e.g. cache lookup
   * stalled on disk, governance fetch stalled below the SDK).
   */
  stepDeadlineMs?: number;
  /**
   * v3.5.0 — opt out of per-scenario batching. When true,
   * `matchScenarioWithLLM` walks step-by-step through
   * `matchStepWithLLM` instead of folding unmatched steps into a
   * single batch call. Use only if you've hit a provider per-prompt
   * token limit on large batches, or want strict 1:1 call accounting
   * for audit reasons.
   */
  disableBatch?: boolean;
}

export async function matchStepWithLLM(
  step: StepIR,
  pom: PageObjectIR,
  pageVar: string,
  ctx: MatchStepWithLLMContext,
): Promise<StepBinding> {
  // 1) Always try rule-based first.
  const ruleBased = matchStep(step, pom, pageVar);

  // 2) If the rule matcher produced a real binding (no warning), use it.
  if (!ruleBased.warning) return ruleBased;

  // 3) No LLM client → return the warning binding (TODO behaviour).
  if (!ctx.llm) return ruleBased;

  // 4) Budget exhausted → return the warning binding (caller already
  //    notified at startup; this just keeps scaffolding moving).
  if (ctx.llm.budgetExhausted()) return ruleBased;

  // 5) Try the LLM. Soft-fail back to rule-based on any error.
  // v2.2.0 — Promise.race against a step-level deadline so a wedged
  // call doesn't hang the entire scaffold loop. Default 60s; override
  // via ctx.stepDeadlineMs. Returning a synthetic error result on
  // timeout means the original rule warning gets the
  // "(LLM fallback also failed: step deadline exceeded)" annotation
  // and execution continues.
  const deadlineMs = ctx.stepDeadlineMs ?? 60_000;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const generation = ctx.llm.generateBinding({
      step,
      pom,
      pageVar,
      url: ctx.url,
      scaffoldId: ctx.scaffoldId,
    });
    const deadline = new Promise<{
      error: string;
      fromCache: false;
      binding?: undefined;
    }>((resolve) => {
      timeoutId = setTimeout(
        () =>
          resolve({
            error: `step deadline exceeded after ${deadlineMs}ms`,
            fromCache: false,
          }),
        deadlineMs,
      );
      // Don't keep the process alive just for a pending watchdog; the
      // scaffold's HTTP server (when used) needs to exit on SIGINT even
      // if a step is mid-flight.
      timeoutId.unref?.();
    });
    const result = await Promise.race([generation, deadline]);
    // Cancel the watchdog if the LLM resolved first — otherwise we'd
    // leak one timer per step until the deadline fires.
    if (timeoutId) clearTimeout(timeoutId);
    if (!result.binding) {
      // Annotate the warning with the LLM error so BDD_REVIEW shows why
      // the LLM didn't help. The step still falls through to TODO.
      // v2.0.1: flattenForComment collapses any newlines in the error so
      // the resulting `// TODO: ...` line stays a single comment.
      // Multi-line stack traces (e.g. native-module load failures) used
      // to bleed past the `//` and break the .spec.ts parse.
      return {
        ...ruleBased,
        warning: result.error
          ? `${ruleBased.warning} (LLM fallback also failed: ${flattenForComment(result.error)})`
          : ruleBased.warning,
      };
    }
    // Append to candidate-rules.jsonl for offline review. Best-effort.
    if (ctx.candidates) {
      await ctx.candidates.append({
        ts: new Date().toISOString(),
        scaffoldId: ctx.scaffoldId,
        stepText: step.text,
        stepKeyword: step.keyword,
        binding: result.binding,
        pomSignature: {
          className: pom.className,
          fieldNames: pom.fields.map((f) => f.fieldName),
          methodNames: pom.methods.map((m) => m.name),
        },
        provider: "anthropic",
        model: result.model ?? "(unknown)",
        fromCache: result.fromCache,
      });
    }
    return result.binding;
  } catch (err) {
    // v2.0.1: flattenForComment so multi-line error messages (the classic
    // case: better-sqlite3 NODE_MODULE_VERSION mismatch — a 5-line stack
    // trace) don't bleed past the `//` in the emitted spec.
    if (timeoutId) clearTimeout(timeoutId);
    const message = flattenForComment(
      err instanceof Error ? err.message : err,
    );
    return {
      ...ruleBased,
      warning: `${ruleBased.warning} (LLM fallback threw: ${message})`,
    };
  }
}

/**
 * Convenience: match a list of steps with LLM overlay, sequentially. We
 * deliberately don't parallelise — the cache means repeated step text
 * within a feature returns instantly, but parallel calls would all miss
 * the cache and pay for the same step twice.
 */
export async function matchStepsWithLLM(
  steps: StepIR[],
  pom: PageObjectIR,
  pageVar: string,
  ctx: MatchStepWithLLMContext,
): Promise<StepBinding[]> {
  const out: StepBinding[] = [];
  for (const step of steps) {
    out.push(await matchStepWithLLM(step, pom, pageVar, ctx));
  }
  return out;
}

/**
 * v3.5.0 — batch the LLM fallback per scenario.
 *
 * Per-scenario, this is significantly cheaper than per-step:
 *   - Each unmatched step is ONE entry in a single batch prompt.
 *   - Shared POM context is sent ONCE per batch (not per step).
 *   - One round-trip latency, not N.
 *   - One budget tick, not N.
 *
 * The cache still works exactly as before — each step has the same
 * cache key it would have in the per-step path. AnthropicLLMClient's
 * `generateBatchBindings` checks the cache per-step first; only
 * cache-misses go into the batch prompt.
 *
 * Failure modes:
 *   - LLM client doesn't implement `generateBatchBindings` (e.g.
 *     custom client, older MockLLMClient): falls back to per-step
 *     `matchStepWithLLM` for every unmatched step.
 *   - Batch parse error: every slot in the batch comes back with an
 *     `error` result, which we then annotate as a per-step warning.
 *   - One bad slot in an otherwise-good batch: only that slot's
 *     step gets the warning annotation; the rest succeed.
 *
 * The candidate-rules.jsonl writer still receives one entry per
 * successful LLM binding (same as per-step) so the offline review
 * pipeline doesn't notice the batching change.
 */
export async function matchScenarioWithLLM(
  steps: StepIR[],
  pom: PageObjectIR,
  pageVar: string,
  ctx: MatchStepWithLLMContext,
): Promise<StepBinding[]> {
  // 1) Rule pass for every step. Cheap; pure-sync inside.
  const ruleBindings: StepBinding[] = steps.map((s) =>
    matchStep(s, pom, pageVar),
  );

  // 2) Identify warning slots. If no LLM client or budget exhausted,
  //    bail out with the rule bindings — same as the per-step path.
  if (!ctx.llm) return ruleBindings;
  const warningIndexes = ruleBindings
    .map((b, i) => (b.warning ? i : -1))
    .filter((i) => i >= 0);
  if (warningIndexes.length === 0) return ruleBindings;
  if (ctx.llm.budgetExhausted()) return ruleBindings;

  // 3) Choose the path: batch when the client supports it, otherwise
  //    fall back to per-step. Single-warning batches also fall through
  //    to the per-step path so the existing watchdog / deadline /
  //    candidate-rules-writer machinery handles them.
  const batchCapable = typeof ctx.llm.generateBatchBindings === "function";
  if (!batchCapable || warningIndexes.length === 1 || ctx.disableBatch) {
    const out: StepBinding[] = [...ruleBindings];
    for (const idx of warningIndexes) {
      out[idx] = await matchStepWithLLM(steps[idx], pom, pageVar, ctx);
    }
    return out;
  }

  // 4) Batch path. Build inputs in the same order as warningIndexes.
  const inputs = warningIndexes.map((idx) => ({
    step: steps[idx],
    pom,
    pageVar,
    url: ctx.url,
    scaffoldId: ctx.scaffoldId,
  }));

  let batchResults;
  try {
    batchResults = await ctx.llm.generateBatchBindings!(inputs);
  } catch (err) {
    // Wrap-failure: annotate every warning slot with the throw message
    // and continue. Matches the per-step path's `LLM fallback threw`
    // annotation.
    const message = flattenForComment(
      err instanceof Error ? err.message : err,
    );
    const out = [...ruleBindings];
    for (const idx of warningIndexes) {
      out[idx] = {
        ...ruleBindings[idx],
        warning: `${ruleBindings[idx].warning} (LLM batch threw: ${message})`,
      };
    }
    return out;
  }

  // 5) Distribute results back to their original positions. Write
  //    candidate-rules.jsonl for every success; annotate warnings
  //    for every failure.
  const out = [...ruleBindings];
  for (let j = 0; j < warningIndexes.length; j++) {
    const idx = warningIndexes[j];
    const result = batchResults[j];
    if (!result || !result.binding) {
      out[idx] = {
        ...ruleBindings[idx],
        warning: result?.error
          ? `${ruleBindings[idx].warning} (LLM fallback also failed: ${flattenForComment(result.error)})`
          : ruleBindings[idx].warning,
      };
      continue;
    }
    if (ctx.candidates) {
      await ctx.candidates.append({
        ts: new Date().toISOString(),
        scaffoldId: ctx.scaffoldId,
        stepText: steps[idx].text,
        stepKeyword: steps[idx].keyword,
        binding: result.binding,
        pomSignature: {
          className: pom.className,
          fieldNames: pom.fields.map((f) => f.fieldName),
          methodNames: pom.methods.map((m) => m.name),
        },
        provider: "anthropic",
        model: result.model ?? "(unknown)",
        fromCache: result.fromCache,
      });
    }
    out[idx] = result.binding;
  }
  return out;
}
