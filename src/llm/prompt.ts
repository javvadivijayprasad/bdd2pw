/**
 * Build the Anthropic prompt used to generate a `StepBinding` from an
 * unmatched Gherkin step.
 *
 * Design principles:
 *
 *   1. **JSON-only output.** The model is instructed to return ONE JSON
 *      object matching the StepBinding type — no prose, no Markdown
 *      fences. We then JSON.parse it; malformed output triggers a soft-fail.
 *
 *   2. **Specific not creative.** Show the model the existing rule
 *      taxonomy (briefly) so it tries to match the same shapes our
 *      deterministic rules produce. Otherwise the LLM invents novel
 *      locator chains that drift from the rest of the codebase.
 *
 *   3. **POM-aware.** Every prompt includes the current POM's field and
 *      method names. The LLM should prefer existing fields over
 *      synthesising raw locators.
 *
 *   4. **Temperature 0** (set at call site) — same input → same output,
 *      paired with caching for true determinism.
 */

import type { GenerateBindingInput } from "./types";

/** System prompt — shared across all generations. */
export const SYSTEM_PROMPT = `You are a deterministic step-binding generator for bdd2pw, a Gherkin → Playwright TypeScript scaffolder.

bdd2pw normally maps each Gherkin step to one of 30+ deterministic regex rules. When no rule matches, you produce the binding instead.

Your output MUST be a single JSON object matching this TypeScript type:

interface StepBinding {
  step: { keyword: "Given"|"When"|"Then"|"And"|"But"; text: string };
  pomCall?: { page: string; method: string; args: string[] };  // for actions
  assertion?: { locator: string; matcher: string; expected?: string };  // for assertions
  customBody?: string;  // pre-rendered TS for compound steps
  warning?: string;  // populated only if you genuinely cannot map the step
}

Rules:
- Output exactly ONE JSON object. No prose, no Markdown, no backticks.
- Echo the step in the "step" field unchanged.
- Choose ONE of: pomCall, assertion, customBody. Never two.
- Prefer existing POM fields over synthesizing locators. Only use page.locator(...) / page.getByText(...) / page.getByRole(...) when no POM field matches.
- For assertions, set "matcher" to one of: toBeVisible, toBeHidden, toContainText, toHaveText, toHaveURL, toHaveAttribute, not.toBeVisible, not.toHaveURL.
- For toContainText/toHaveText, "expected" must be a JS-quoted string like "\\"X\\"".
- For toHaveURL, "expected" should be: new RegExp("...") (a JS expression as a STRING).
- For toHaveAttribute, "expected" should be: "name", "value" (two args, as a single string).
- Always end synthesised locators with .first() to avoid Playwright strict-mode violations when text appears in multiple elements.
- If the step has no quoted value AND no resolvable POM field, set "warning" to a clear single-sentence explanation of what's ambiguous and emit no pomCall/assertion. The user will hand-edit the spec.`;

/**
 * Build the user-side message for one step. Includes:
 *   - The step keyword + text.
 *   - The POM IR (className, field names with their locator API+args, methods).
 *   - The target URL (gives the model context about what page).
 *   - The pageVar variable name to use in pomCall.page.
 */
export function buildUserPrompt(input: GenerateBindingInput): string {
  const { step, pom, pageVar, url } = input;

  const fieldsBlock = pom.fields.length
    ? pom.fields
        .map(
          (f) =>
            `  - ${f.fieldName}: ${pageVar}.${f.fieldName} (page.${f.api}(${f.args}))`,
        )
        .join("\n")
    : "  (no fields discovered yet)";

  const methodsBlock = pom.methods.length
    ? pom.methods
        .map(
          (m) =>
            `  - ${m.name}(${m.params.map((p) => `${p.name}: ${p.type}`).join(", ")})`,
        )
        .join("\n")
    : "  (no methods)";

  const stepArg = step.argument
    ? typeof step.argument === "string"
      ? `\nDoc string:\n${step.argument}`
      : `\nData table:\n${JSON.stringify(step.argument)}`
    : "";

  return `Step that didn't match any rule:
  ${step.keyword} ${step.text}${stepArg}

POM context:
  className: ${pom.className}
  pageVar: ${pageVar}
  url: ${url ?? "(none)"}

POM fields:
${fieldsBlock}

POM methods:
${methodsBlock}

Return the JSON binding now.`;
}

/**
 * Cache key — stable across runs given identical inputs. Determinism plus
 * cost control: the same step text + POM signature returns the same binding
 * forever (until the user explicitly clears the cache or upgrades bdd2pw).
 */
export function cacheKey(input: GenerateBindingInput, model: string): string {
  const fieldNames = input.pom.fields.map((f) => f.fieldName).sort().join(",");
  const methodNames = input.pom.methods.map((m) => m.name).sort().join(",");
  // Include the model so a model upgrade invalidates old cache entries.
  return [
    "v2",
    model,
    input.step.keyword,
    input.step.text,
    input.pom.className,
    fieldNames,
    methodNames,
  ].join("|");
}
