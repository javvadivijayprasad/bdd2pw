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
- If the step has no quoted value AND no resolvable POM field, set "warning" to a clear single-sentence explanation of what's ambiguous and emit no pomCall/assertion. The user will hand-edit the spec.

v2.2.2 — additional constraints from production:
- NEVER reference a bare \`context\` variable; the test fixture only injects \`page\`. To clear cookies / storage / etc., use \`page.context().clearCookies()\`, \`page.context().clearPermissions()\`, etc. Same for \`browser\` — go through \`page.context().browser()\`.
- When the step DESCRIBES USER INPUT (verbs: enter, type, fill, paste, set, use, supply, provide, with credentials, login as), emit a pomCall or customBody with the .fill()/.click() call, NEVER an assertion. "I enter MySecret123 as the password" → fill the password field, do not assert it is visible.
- For URL-related steps ("URL is", "URL contains", "URL ends with", "page is at", "redirected to", "current path is"), emit assertion.matcher = toHaveURL with a RegExp, never toContainText on a getByText. The URL is checked against the browser's address bar, not against page contents.
- If you must synthesize getByText, KEEP IT SCOPED — prefer page.getByText(X).first() over a plain getByText. Multiple matches across the DOM are common (instructions text, breadcrumbs, success banners) and strict-mode failures + wrong-element matches are the dominant production failure mode.

v2.2.3 — Playwright API allowlist (STRICT):
- The ONLY valid \`page.getBy*\` methods are: getByAltText, getByLabel, getByPlaceholder, getByRole, getByTestId, getByText, getByTitle. NEVER invent others. In particular, \`page.getByURL\` DOES NOT EXIST — for URL assertions use toHaveURL on the page, not a getByURL locator.
- Other valid page-level locator factories: page.locator(...), page.frameLocator(...). Anything else (page.getByURL, page.getByPath, page.getByHref, page.findByText, etc.) is HALLUCINATED — do not emit it.
- For URL assertions (toHaveURL / not.toHaveURL) and title assertions (toHaveTitle), set assertion.locator to the literal string "page" — not an empty string, not a getByURL call. The renderer emits expect(page).toHaveURL(...). Example assertion JSON: {"locator": "page", "matcher": "toHaveURL", "expected": "new RegExp('/dashboard')"}.`;

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
 * v3.5.0 — batch prompt builder for `generateBatchBindings`.
 *
 * Why batching exists: a single scenario with N unmatched steps used to
 * fire N separate Anthropic calls. Each call paid full round-trip
 * latency + system-prompt tokens + POM-context tokens. Batching folds
 * all N into one call. Cost reduction is roughly proportional to N when
 * N > 1.
 *
 * The shared POM context (className, fields, methods, URL) is emitted
 * ONCE at the top of the prompt — same as the single-step builder.
 * Each step appears as a numbered entry:
 *
 *   STEP 0001:
 *     <keyword> <text>
 *     <doc string / data table when present>
 *
 *   STEP 0002:
 *     ...
 *
 * The model is instructed to return a JSON ARRAY of N binding objects,
 * one per step, in the SAME ORDER. IDs are 4-digit zero-padded so the
 * model can echo them back for sanity (we don't require it; callers
 * parse by position).
 */
export function buildBatchUserPrompt(inputs: GenerateBindingInput[]): string {
  if (inputs.length === 0) {
    throw new Error("buildBatchUserPrompt: inputs must be non-empty");
  }
  // POM context is the same across all inputs in a batch (same scaffold,
  // same scenario, same POM). Use the first input as the source of
  // truth.
  const head = inputs[0];
  const { pom, pageVar, url } = head;

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

  const stepBlocks = inputs
    .map((input, idx) => {
      const id = String(idx + 1).padStart(4, "0");
      const arg = input.step.argument
        ? typeof input.step.argument === "string"
          ? `\n  Doc string:\n  ${input.step.argument.replace(/\n/g, "\n  ")}`
          : `\n  Data table:\n  ${JSON.stringify(input.step.argument)}`
        : "";
      return `STEP ${id}:\n  ${input.step.keyword} ${input.step.text}${arg}`;
    })
    .join("\n\n");

  return `Multiple Gherkin steps from the same scenario didn't match any rule. Produce one StepBinding per step.

POM context (shared across all steps):
  className: ${pom.className}
  pageVar: ${pageVar}
  url: ${url ?? "(none)"}

POM fields:
${fieldsBlock}

POM methods:
${methodsBlock}

Steps:

${stepBlocks}

Return a JSON ARRAY of ${inputs.length} StepBinding object(s) — one per step, IN THE SAME ORDER as the STEP ${String(1).padStart(4, "0")}..STEP ${String(inputs.length).padStart(4, "0")} list above. Same per-binding shape and rules as the single-step prompt. Do NOT wrap the array in any other object; the response must be a bare \`[...]\`.`;
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
