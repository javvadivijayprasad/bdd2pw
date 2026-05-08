/**
 * Public API of the LLM module — v2.0.
 *
 *   import { createLLMClient, matchStepWithLLM, CandidateRulesWriter }
 *     from "./llm";
 *
 * The bdd2pw orchestrator (src/index.ts) only needs to import these
 * three names. Everything else is internal.
 */

import * as path from "path";
import { AnthropicLLMClient } from "./anthropicClient";
import type { LLMClient, LLMClientOptions } from "./types";

export { AnthropicLLMClient } from "./anthropicClient";
export { CandidateRulesWriter } from "./candidateRules";
export { GovernanceClient, GovernanceUnreachableError } from "./governanceClient";
export {
  matchStepWithLLM,
  matchStepsWithLLM,
  type MatchStepWithLLMContext,
} from "./llmStepMatcher";
export type {
  CandidateRuleEntry,
  GenerateBindingInput,
  GenerateBindingResult,
  LLMClient,
  LLMClientOptions,
  LLMLogEvent,
} from "./types";

/**
 * Construct the right LLMClient for the given options. Today the only
 * provider is "anthropic"; the factory exists so v2.1 (OpenAI/Gemini)
 * can plug in without touching callers.
 *
 * `repoRoot` is used to derive the default cache path:
 *   `<repoRoot>/.bdd2pw/llm-cache.sqlite`.
 *
 * Returns undefined when LLM is disabled (no provider configured) — so
 * callers can pass the result straight into matchStepWithLLM's `llm`
 * field without an explicit null-check.
 */
export function createLLMClient(
  opts: LLMClientOptions | undefined,
  repoRoot: string,
): LLMClient | undefined {
  if (!opts || !opts.provider) return undefined;
  const cachePathDefault = path.join(
    repoRoot,
    ".bdd2pw",
    "llm-cache.sqlite",
  );
  switch (opts.provider) {
    case "anthropic":
      return new AnthropicLLMClient(opts, cachePathDefault);
    default:
      // v2.1 will add openai / gemini.
      return undefined;
  }
}
