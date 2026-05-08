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
  try {
    const result = await ctx.llm.generateBinding({
      step,
      pom,
      pageVar,
      url: ctx.url,
      scaffoldId: ctx.scaffoldId,
    });
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
