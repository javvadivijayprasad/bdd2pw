/**
 * Step matcher — Gherkin step text → POM method call / expect() assertion.
 *
 * Phase 1: rule-based only. The rule table covers the standard verb set:
 *   - navigation:  "I am on / navigate to / open / visit / go to"
 *   - input:       "I enter / type / fill X (in)to <field>"
 *   - selection:   "I select <option> from <select>"
 *   - clicking:    "I click / press / tap <button>"
 *   - check/uncheck: "I check / uncheck <checkbox>"
 *   - visibility:  "I (should) see / I should NOT see"
 *   - text equals: "I should see <X> in <field>" / "<field> should contain <X>"
 *   - URL:         "the URL should be / contain"
 *
 * LLM fallback for unmatched steps is wired but defaults to off; falls
 * through to a `// TODO` warning. See docs/ARCHITECTURE.md §2 (LLM branch).
 */

import type {
  PageObjectIR,
  ScenarioIR,
  StepBinding,
  StepIR,
} from "../types";
import { camelCase } from "../utils/naming";
import { looksLikeProse } from "./stepNormalizer";
import { normalizeStepText } from "./stepNormalizer";
import { API_RULES } from "./apiRules";
import { VISIBILITY_RULES } from "./visibilityRules";
import { BANKING_RULES } from "./domains/banking";
import { HEALTHCARE_RULES } from "./domains/healthcare";
import { INSURANCE_RULES } from "./domains/insurance";
import { RETAIL_RULES } from "./domains/retail";
import { GOV_RULES } from "./domains/gov";
import { EDUCATION_RULES } from "./domains/education";
import { TELECOM_RULES } from "./domains/telecom";

/**
 * v3.4.0 — opt-in domain rule packs. ScaffoldOptions.domains is read
 * once at the top of scaffold() and forwarded here via
 * setActiveDomains(). Domain rules are spliced into the registry
 * after the API + visibility rules but BEFORE the UI/URL-slug rules,
 * so domain-specific patterns intercept ambiguous prose first.
 *
 * Domains are additive: passing ["banking", "healthcare"] activates
 * both. Passing nothing keeps the registry byte-stable with v3.3.0.
 */
export type DomainName =
  | "banking"
  | "healthcare"
  | "insurance"
  | "retail"
  | "gov"
  | "education"
  | "telecom";

const DOMAIN_RULES: Record<DomainName, Rule[]> = {
  banking: BANKING_RULES,
  healthcare: HEALTHCARE_RULES,
  insurance: INSURANCE_RULES,
  retail: RETAIL_RULES,
  gov: GOV_RULES,
  education: EDUCATION_RULES,
  telecom: TELECOM_RULES,
};

let activeDomainRules: Rule[] = [];

export function setActiveDomains(domains: readonly DomainName[] | undefined): void {
  if (!domains || domains.length === 0) {
    activeDomainRules = [];
    return;
  }
  const seen = new Set<DomainName>();
  const out: Rule[] = [];
  for (const d of domains) {
    if (seen.has(d)) continue;
    seen.add(d);
    const pack = DOMAIN_RULES[d];
    if (pack) out.push(...pack);
  }
  activeDomainRules = out;
}

export interface MatchStepsInput {
  scenarios: ScenarioIR[];
  pom: PageObjectIR;
  /** camelCase variable name for the POM in the spec (e.g. `loginPage`). */
  pageVar: string;
  llmProvider?: "anthropic" | "openai" | "gemini";
  governanceUrl?: string;
}

/**
 * Match every step in every scenario to a POM call / assertion / TODO.
 * Background steps are also threaded through if the orchestrator passes
 * them as a synthetic scenario.
 */
export async function matchSteps(input: MatchStepsInput): Promise<StepBinding[][]> {
  const out: StepBinding[][] = [];
  for (const scenario of input.scenarios) {
    out.push(scenario.steps.map((step) => matchStep(step, input.pom, input.pageVar)));
  }
  return out;
}

/**
 * Try every rule in priority order; return the first match.
 * Falls through to a warning binding when nothing matches.
 */
export function matchStep(
  step: StepIR,
  pom: PageObjectIR,
  pageVar: string,
): StepBinding {
  // Belt-and-suspenders normalisation (Block 2 #7). Apply BEFORE the rule
  // table runs so common LLM phrasing drift ("in the field" vs "into the
  // field", smart curly quotes from copy-paste, trailing parentheticals,
  // "user remains on login page" vs canonical "URL remains on the login
  // page") all map back to the canonical forms the rule regexes expect.
  // The `step` object itself is treated as immutable — we work off a
  // local copy so the original Gherkin text is preserved for warnings,
  // test.step labels, and downstream review reports.
  const normalisedText = normalizeStepText(step.text);
  const normalisedStep: StepIR = normalisedText === step.text
    ? step
    : { ...step, text: normalisedText };

  // v3.4.0 — domain rule packs run after API + visibility but BEFORE
  // the UI/URL-slug rules. Built as [domain, then registry] so the
  // domain patterns intercept ambiguous prose first when active.
  const effectiveRules =
    activeDomainRules.length > 0
      ? [...activeDomainRules, ...RULES]
      : RULES;
  for (const rule of effectiveRules) {
    const m = normalisedStep.text.match(rule.pattern);
    if (m) {
      const result = rule.build(m, normalisedStep, pom, pageVar);
      if (result) return result;
    }
  }
  return {
    step,
    warning: `no rule matched: "${step.keyword} ${step.text}"`,
  };
}

// ───────────────────────────────────────────────────────────────────
// v3.6.0 — rule-trace diagnostics.
//
// `diagnoseStep` runs every rule in the registry against a step (with
// the same normalisation as matchStep) and reports, per rule:
//
//   - whether the regex matched at all,
//   - if it matched, whether the build() callback returned a binding
//     or declined (null/undefined),
//   - the pattern source (so the review report can show the user
//     exactly what failed and which captures, if any, fired).
//
// This is opt-in (ScaffoldOptions.diagnostics) because it's
// O(rules × warnings) work. For a typical scaffold with <20 warnings
// and ~60 rules, that's still <1ms total — but the convention is
// "default off, surface explicitly".
// ───────────────────────────────────────────────────────────────────

export interface RuleTraceEntry {
  /** Stable label for the rule (e.g. "rule-2a", "api-04", "visibility-V01"). */
  ruleId: string;
  /** Raw regex source, useful for the user reading the report. */
  patternSource: string;
  /** True if the regex matched but build() returned null/undefined. */
  matchedButDeclined: boolean;
  /** True if the regex didn't match at all. */
  noMatch: boolean;
  /** Captures from the match, when matched. */
  captures?: string[];
}

/**
 * Run every rule against the step and return a trace. Up to `topN`
 * "nearest" entries are returned in priority order:
 *   1. Rules whose regex matched but build declined (they got close).
 *   2. Rules whose regex didn't match — sorted by token-overlap proxy
 *      so the user sees the most-similar-shaped patterns first.
 *
 * Default `topN = 3`. The first bucket is rare in practice; usually
 * the trace is dominated by no-match rules.
 */
export function diagnoseStep(
  step: StepIR,
  pom: PageObjectIR,
  pageVar: string,
  topN = 3,
): RuleTraceEntry[] {
  const normalised = normalizeStepText(step.text);
  const normalisedStep: StepIR =
    normalised === step.text ? step : { ...step, text: normalised };

  const effectiveRules =
    activeDomainRules.length > 0
      ? [...activeDomainRules, ...RULES]
      : RULES;

  const stepTokens = new Set(
    normalised.toLowerCase().split(/\s+/).filter(Boolean),
  );

  const declined: RuleTraceEntry[] = [];
  const noMatchEntries: { entry: RuleTraceEntry; score: number }[] = [];

  effectiveRules.forEach((rule, idx) => {
    const id = ruleIdFor(rule, idx);
    const patternSource = rule.pattern.source;
    const m = normalisedStep.text.match(rule.pattern);
    if (m) {
      const built = rule.build(m, normalisedStep, pom, pageVar);
      if (built) return; // hit; matchStep would have returned this — caller never sees diagnoseStep when a real binding exists
      declined.push({
        ruleId: id,
        patternSource,
        matchedButDeclined: true,
        noMatch: false,
        captures: m.slice(1).map((c) => (c == null ? "" : c)),
      });
      return;
    }
    // No match — score by how many step tokens appear in the pattern
    // source (cheap proxy for "this rule was looking for something
    // similar"). Higher = more relevant.
    const patternLower = patternSource.toLowerCase();
    let overlap = 0;
    for (const t of stepTokens) {
      if (patternLower.includes(t)) overlap += 1;
    }
    noMatchEntries.push({
      entry: {
        ruleId: id,
        patternSource,
        matchedButDeclined: false,
        noMatch: true,
      },
      score: overlap,
    });
  });

  noMatchEntries.sort((a, b) => b.score - a.score);
  return [
    ...declined,
    ...noMatchEntries.slice(0, Math.max(0, topN - declined.length)).map(
      (x) => x.entry,
    ),
  ].slice(0, topN);
}

/**
 * Best-effort stable id for a rule in the registry. We don't carry
 * an explicit id field on Rule (yet) — the position in the merged
 * registry is the stable id. Domain rules get a `domain-NN` prefix
 * for clarity; the rest are `rule-NN`.
 */
function ruleIdFor(_rule: Rule, idx: number): string {
  const domainCount = activeDomainRules.length;
  if (idx < domainCount) {
    return `domain-${String(idx + 1).padStart(2, "0")}`;
  }
  return `rule-${String(idx - domainCount + 1).padStart(2, "0")}`;
}

// --- Rule registry ---------------------------------------------------------

/**
 * Subject prefix accepted at the start of a step. Real-world Cucumber suites
 * mix several conventions:
 *   "I click the login button"           — first-person (most common)
 *   "user clicks the login button"       — third-person (selenium14, etc.)
 *   "User clicks the login button"       — capitalised
 *   "the user clicks the login button"   — definite article
 *
 * All rules use this prefix instead of a hard-coded `^I ` so the same rule
 * matches all four shapes. Verbs are normalised on the rule side (no need
 * to also accept "clicks" + "click" — the regex below has both).
 */
const SUBJ = "(?:I|user|User|the user|the User)";

interface Rule {
  pattern: RegExp;
  build(
    m: RegExpMatchArray,
    step: StepIR,
    pom: PageObjectIR,
    pageVar: string,
  ): StepBinding | null;
}

const RULES: Rule[] = [
  // v3.0.0 — API rules go FIRST. API step text ("the response status is
  // 200", "I send a POST request to ...") is shape-distinct from UI step
  // text, so the API rules don't false-positive UI steps; but putting them
  // at the top guarantees deterministic interception before any UI rule
  // accidentally chews on an API-ish phrase. See src/transformers/apiRules.ts.
  ...API_RULES,

  // v3.1.0 — visibility rules go SECOND. TestForge handoff Issue 1:
  // steps like "the user's name or profile indicator is visible in the
  // UI" were falling through to the URL-slug rules and producing
  // always-failing `toHaveURL(/.../)` assertions. These rules intercept
  // anything matching "<noun> is visible/displayed/shown/appears" and
  // either resolve a POM locator or land a clean TODO — never a URL
  // regex. See src/transformers/visibilityRules.ts.
  ...VISIBILITY_RULES,

  // 1. Navigation: "I am on the login page" / "I navigate to /foo"
  {
    pattern: new RegExp(`^(?:${SUBJ} )?(?:am on|navigate to|navigates? to|open|opens?|visit|visits?|go to|goes? to|am at|is at) (?:the )?(?:.+?\\s+)?["']?([^"']+?)["']?(?: page)?$`, "i"),
    build: (m, step, pom, pageVar) => {
      // The non-greedy `(?:.+?\s+)?` before the captured target lets us
      // handle both shapes:
      //   "I navigate to the login page"        → m[1] = "login"
      //   "User navigate to Login Page for Admin \"https://x.com/login\"" → m[1] = "https://x.com/login"
      const target = m[1].trim();
      const hasGoto = pom.methods.some((mm) => mm.name === "goto");
      if (hasGoto) {
        return {
          step,
          pomCall: { page: pageVar, method: "goto", args: [] },
        };
      }
      return {
        step,
        pomCall: { page: pageVar, method: "goto", args: [JSON.stringify(target)] },
      };
    },
  },

  // 2a. Input with explicit value + field: 'I enter "alice" in(to) the username field'
  //     v1.1.6 — SUBJ is optional. Real-world LLM output drops the subject
  //     freely: `Enter 'student' in the username field` (no subject) is just
  //     as common as `I enter 'student' into the username field`. Without
  //     `(?:${SUBJ}\s+)?` the subject-less form fell to TODO and the test
  //     silently passed without filling the field.
  //
  //     Both prepositions accepted: `in`, `into`, `in to`. The user-facing
  //     prompt now says "into" is canonical, but the rule stays tolerant.
  {
    pattern: new RegExp(`^(?:${SUBJ}\\s+)?(?:enter|enters|type|types|fill|fills) ["']([^"']*)["'] (?:in|into|in to) (?:the )?(.+?)(?: field| input| box)?$`, "i"),
    build: (m, step, pom, pageVar) => fillFieldBinding(step, pom, pageVar, m[2].trim(), m[1]),
  },

  // 2c. Compound input: 'user enter email "X" password "Y"'.
  //     Common in real-world Cucumber suites (e.g. selenium14/LoginCMS).
  //     Emits a `customBody` with one fill() per (field, value) pair.
  //     Pattern: SUBJ verb FIELD1 "VAL1" FIELD2 "VAL2" [FIELD3 "VAL3" ...]
  //     The `(?:and )?` between pairs is optional ("email X password Y" or
  //     "email X and password Y").
  {
    pattern: new RegExp(
      `^${SUBJ} (?:enter|enters|type|types|fill|fills) (?:(?:the )?(\\w+) ["']([^"']*)["'](?: and| and the| ,)?\\s*){2,}$`,
      "i",
    ),
    build: (_m, step, pom, pageVar) => {
      // Re-extract all (field, value) pairs from the step text — the regex
      // above only captures the LAST match in the iteration, so we need a
      // second pass with `g` flag to get all of them.
      const pairRe = /(?:the )?(\w+)\s+["']([^"']*)["']/g;
      const pairs: { field: string; value: string }[] = [];
      let pm: RegExpExecArray | null;
      // Strip the leading subject + verb to avoid false matches
      const tail = step.text.replace(
        new RegExp(`^${SUBJ} (?:enter|enters|type|types|fill|fills) `, "i"),
        "",
      );
      while ((pm = pairRe.exec(tail)) !== null) {
        pairs.push({ field: pm[1], value: pm[2] });
      }
      if (pairs.length < 2) return null;

      const lines: string[] = [];
      for (const { field, value } of pairs) {
        const f = findField(pom, field, ["Input", "Field", "Box", "Textbox"]);
        if (!f) {
          // Couldn't resolve one of the fields — bail out so the step
          // becomes a TODO instead of a half-correct emission.
          return null;
        }
        lines.push(`await ${pageVar}.${f.fieldName}.fill(${JSON.stringify(value)});`);
      }
      return { step, customBody: lines.join("\n") };
    },
  },

  // 2b. Reversed word order: 'I enter username "alice"' / 'I type password "secret"'
  //     v1.1.5 — also matches subject-less compact form: 'enters password "X"' /
  //     'And enters username "Y"'. The LLM produces these freely. SUBJ is
  //     optional via `(?:${SUBJ}\s+)?` so all three forms work:
  //       'I enter username "alice"'           ← original
  //       'User enters username "alice"'        ← original third-person
  //       'enters password "Password123"'       ← v1.1.5 subject-less
  //     Also handles empty values: `I enter username ""` / `enters password ""`.
  {
    pattern: new RegExp(`^(?:${SUBJ}\\s+)?(?:enter|enters|type|types|fill|fills) (?:the )?(.+?) ["']([^"']*)["']$`, "i"),
    build: (m, step, pom, pageVar) => {
      // If the captured "field" is itself a quoted value already handled by 2a,
      // skip — but 2a's pattern wouldn't end here so 2b is safe.
      return fillFieldBinding(step, pom, pageVar, m[1].trim(), m[2]);
    },
  },

  // 3. Click: "I click the login button" / "I press 'Sign in'"
  //    Captures the explicit role suffix (button/link/icon) so findField
  //    can restrict to fields with the matching suffix. Without this,
  //    "click the login button" would match `testLoginHeading` via the
  //    generic substring fallback.
  {
    pattern: new RegExp(`^(?:${SUBJ} )?(?:click|clicks|press|presses|tap|taps)(?: on)? (?:the )?["']?([^"']+?)["']?(?:\\s+(button|link|icon|tab))?$`, "i"),
    build: (m, step, pom, pageVar) => {
      const hint = m[1].trim();
      const explicitRole = m[2]; // 'button' | 'link' | 'icon' | 'tab' | undefined
      const suffixes = explicitRole
        ? [capitalize(explicitRole)]
        : ["Button", "Link"];
      const field = findField(pom, hint, suffixes);
      if (!field) return null;
      const method = findOrSynthMethod(pom, `click${capitalize(field.fieldName)}`, []);
      if (method && method.kind === "existing") {
        return { step, pomCall: { page: pageVar, method: method.name, args: [] } };
      }
      return {
        step,
        pomCall: { page: pageVar, method: `${field.fieldName}.click`, args: [] },
      };
    },
  },

  // 4. Selection: 'I select "USA" from (the) country dropdown'
  {
    pattern: new RegExp(`^${SUBJ} (?:select|selects) ["']([^"']+)["'] from (?:the )?(.+?)(?: dropdown| select)?$`, "i"),
    build: (m, step, pom, pageVar) => {
      const value = m[1];
      const hint = m[2].trim();
      const field = findField(pom, hint, ["Select", "Dropdown"]);
      if (!field) return null;
      return {
        step,
        pomCall: {
          page: pageVar,
          method: `${field.fieldName}.selectOption`,
          args: [JSON.stringify(value)],
        },
      };
    },
  },

  // 5. Check / uncheck checkbox
  {
    pattern: new RegExp(`^${SUBJ} (check|checks|uncheck|unchecks) (?:the )?(.+?)(?: checkbox)?$`, "i"),
    build: (m, step, pom, pageVar) => {
      const verb = m[1].toLowerCase() === "check" ? "check" : "uncheck";
      const hint = m[2].trim();
      const field = findField(pom, hint, ["Checkbox", "Toggle"]);
      if (!field) return null;
      return {
        step,
        pomCall: { page: pageVar, method: `${field.fieldName}.${verb}`, args: [] },
      };
    },
  },

  // 6. Visibility: "I (should) see <X>" — assertion
  {
    pattern: new RegExp(`^${SUBJ} (?:should )?(?:see|sees) (?:the )?["']?([^"']+?)["']?$`, "i"),
    build: (m, step, pom, pageVar) => {
      const hint = m[1].trim();
      const field = findField(pom, hint, []);
      const locatorExpr = field
        ? `${pageVar}.${field.fieldName}`
        : `${pageVar}.page.getByText(${JSON.stringify(hint)})`;
      return {
        step,
        assertion: { locator: locatorExpr, matcher: "toBeVisible" },
      };
    },
  },

  // 7. Negative visibility: "I should NOT see <X>"
  {
    pattern: new RegExp(`^${SUBJ} should not see (?:the )?["']?([^"']+?)["']?$`, "i"),
    build: (m, step, pom, pageVar) => {
      const hint = m[1].trim();
      const field = findField(pom, hint, []);
      const locatorExpr = field
        ? `${pageVar}.${field.fieldName}`
        : `${pageVar}.page.getByText(${JSON.stringify(hint)})`;
      return {
        step,
        assertion: { locator: locatorExpr, matcher: "toBeHidden" },
      };
    },
  },

  // 8. Error message catch-all (must run BEFORE the generic text-equality
  //    rule, otherwise rule 9 below would consume "I should see the/an error
  //    message X" with a toHaveText matcher and a non-unique getByText fallback.
  //    Accepts both "the error message" and "an error message" wordings.
  //    The locator preference order goes Alert > Error > Message — when the
  //    page has a dedicated alert/error field, use it instead of generic text.
  {
    pattern: new RegExp(`^${SUBJ} should see (?:the|an|a) error(?: message)? ["']([^"']+)["']$`, "i"),
    build: (m, step, pom, pageVar) => {
      const expected = m[1];
      const field =
        findField(pom, "errorMessage", ["Alert", "Error", "Message"]) ??
        findField(pom, "error", ["Alert", "Error"]);
      const locatorExpr = field
        ? `${pageVar}.${field.fieldName}`
        : `${pageVar}.page.getByText(${JSON.stringify(expected)})`;
      return {
        step,
        assertion: {
          locator: locatorExpr,
          matcher: "toContainText",
          expected: JSON.stringify(expected),
        },
      };
    },
  },

  // 9a. Text "containing" / "with text" — substring match.
  //     MUST run before rule 9b (exact text), otherwise:
  //       "I should see a welcome message containing 'Congratulations'"
  //     would match rule 9b with hint="a welcome message containing" and
  //     emit toHaveText("Congratulations") — which fails when the actual
  //     element text is "Congratulations student. You successfully logged in!".
  {
    pattern: new RegExp(
      `^${SUBJ} should see (?:the |a |an )?(.+?) (?:containing|that contains?|with(?: the)? text|having text) ["']([^"']+)["']$`,
      "i",
    ),
    build: (m, step, pom, pageVar) => {
      const hint = m[1].trim();
      const expected = m[2];
      const field = findField(pom, hint, ["Message", "Heading", "Text", "Label"]);
      const locatorExpr = field
        ? `${pageVar}.${field.fieldName}`
        : `${pageVar}.page.getByText(${JSON.stringify(expected)})`;
      return {
        step,
        assertion: {
          locator: locatorExpr,
          matcher: "toContainText",
          expected: JSON.stringify(expected),
        },
      };
    },
  },

  // 9b. Text equality: 'I should see the welcome message "Welcome, Alice"'
  //     Strict toHaveText — the entire element text must equal the expected
  //     value. Use rule 9a above for substring semantics.
  {
    pattern: new RegExp(`^${SUBJ} should see (?:the |a |an )?(.+?) ["']([^"']+)["']$`, "i"),
    build: (m, step, pom, pageVar) => {
      const hint = m[1].trim();
      const expected = m[2];
      const field = findField(pom, hint, ["Message", "Heading", "Text", "Label"]);
      const locatorExpr = field
        ? `${pageVar}.${field.fieldName}`
        : `${pageVar}.page.getByText(${JSON.stringify(expected)})`;
      return {
        step,
        assertion: {
          locator: locatorExpr,
          matcher: "toHaveText",
          expected: JSON.stringify(expected),
        },
      };
    },
  },

  // 10. Remain on page: "I should remain on the login page" / "User remains on the login page"
  //     Both forms — "should remain" (modal) and "remains" (present-tense narrative,
  //     common in LLM-generated Gherkin) match.
  {
    pattern: new RegExp(`^${SUBJ} (?:should remain|remain|remains) on (?:the )?(.+?)(?: page)?$`, "i"),
    build: (m, step, _pom, pageVar) => {
      // v1.1.4: strip articles so "remain on a login page" → slug "login",
      // not "a[-_/]?login" which wouldn't match real URLs.
      // v1.1.6: also strip parentheticals — production hits
      //   "user remains on login page (URL does not change away from login page)"
      // The end-anchor `(?: page)?$` doesn't fire when the string ends in `)`,
      // so without cleanSlugTarget the slug includes the parenthetical and
      // never matches a real URL.
      const target = cleanSlugTarget(m[1]);
      // v2.2.2: prose guard — see N5e for the rationale.
      if (looksLikeProse(target)) {
        return {
          step,
          warning:
            `URL slug target "${target}" reads like prose, not a path; emitting TODO so the user can supply a real URL fragment.`,
        };
      }
      return {
        step,
        assertion: {
          locator: `${pageVar}.page`,
          matcher: "toHaveURL",
          expected: `new RegExp(${JSON.stringify(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))})`,
        },
      };
    },
  },

  // 11a. URL contains: "<subj> redirected to <description> (URL contains 'X')"
  //      / "URL contains 'X'" / "Page URL contains 'X'" /
  //      "the current URL contains a path segment 'X'" (v2.2.2).
  //      The quoted 'X' is the AUTHORITATIVE URL fragment — use it directly
  //      and ignore the descriptive prose. This must come before rule 11b which is
  //      greedy and would otherwise swallow the parenthetical.
  //      Prefix is `.*?\b` (any chars + word boundary) so `(URL contains "X")`,
  //      `URL contains "X"`, `Page URL contains "X"` all match — `(?:.+?\s)?` was
  //      too strict because it required whitespace immediately before URL.
  //      v2.2.2: optional `(?:(?:a|the) )?(?:path |url )?(?:segment |fragment |part )?`
  //      between "contains" and the quote handles the LLM dialect
  //      "current URL contains a path segment 'X'" — production bug
  //      where bdd2pw emitted toContainText on getByText instead of toHaveURL.
  {
    pattern: /^.*?\b(?:URL|url)\s+contains\s+(?:(?:a|the)\s+)?(?:path\s+|url\s+)?(?:segment\s+|fragment\s+|part\s+)?["']([^"']+)["']/i,
    build: (m, step, _pom, pageVar) => {
      const fragment = m[1];
      // Escape regex metacharacters so the URL fragment matches literally.
      const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return {
        step,
        assertion: {
          locator: `${pageVar}.page`,
          matcher: "toHaveURL",
          expected: `new RegExp(${JSON.stringify(escaped)})`,
        },
      };
    },
  },

  // 11b. Redirect: "I should be redirected to the logged-in page" / "to /dashboard"
  //      / "redirected to a logged-in page" — articles stripped from the slug.
  //      Asserts URL changed away from the previous page. Best-effort: regex
  //      matches the target token in the URL.
  {
    pattern: new RegExp(`^${SUBJ} (?:should be |am |is )?redirected to (?:the )?(.+?)(?: page)?$`, "i"),
    build: (m, step, _pom, pageVar) => {
      // v1.1.4: stripArticles fixes "redirected to a logged-in page" — without
      // this, slug becomes "a[-_/]?logged-in" which fails to match
      // /logged-in-successfully/ (URL has no "a" before "logged-in").
      // v1.1.6: also strip parentheticals — production hits
      //   "User is redirected to logged-in page (URL changes away from login page)"
      // 11a (URL contains 'X') would catch authoritative parentheticals; this
      // one is descriptive prose and falls through to 11b. cleanSlugTarget
      // handles both the parenthetical and the lingering inner ` page`.
      const target = cleanSlugTarget(m[1]);
      // v2.2.2: prose guard — see N5e for the rationale.
      if (looksLikeProse(target)) {
        return {
          step,
          warning:
            `URL slug target "${target}" reads like prose, not a path; emitting TODO so the user can supply a real URL fragment.`,
        };
      }
      const slug = target
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\s+/g, "[-_/]?");
      return {
        step,
        assertion: {
          locator: `${pageVar}.page`,
          matcher: "toHaveURL",
          expected: `new RegExp(${JSON.stringify(slug)})`,
        },
      };
    },
  },

  // 12. Attribute check: 'the password field should be of type "password"'
  {
    pattern: /^the (.+?) field should (?:be of type|have type) ["']([^"']+)["']$/i,
    build: (m, step, pom, pageVar) => {
      const fieldHint = m[1].trim();
      const expected = m[2];
      const field = findField(pom, fieldHint, ["Input", "Field", "Box", "Textbox"]);
      const locatorExpr = field
        ? `${pageVar}.${field.fieldName}`
        : `${pageVar}.page.locator(${JSON.stringify(`[name="${fieldHint}"]`)})`;
      return {
        step,
        assertion: {
          locator: locatorExpr,
          matcher: "toHaveAttribute",
          expected: `"type", ${JSON.stringify(expected)}`,
        },
      };
    },
  },

  // 13. URL prefix/contains: 'the current URL should start with "https"'
  {
    pattern: /^the (?:current )?URL should (?:start with|begin with|contain|include) ["']([^"']+)["']$/i,
    build: (m, step, _pom, pageVar) => {
      const expected = m[1];
      // start-with → anchored regex; contain → unanchored
      const verb = step.text.toLowerCase();
      const isPrefix = verb.includes("start with") || verb.includes("begin with");
      const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return {
        step,
        assertion: {
          locator: `${pageVar}.page`,
          matcher: "toHaveURL",
          expected: `new RegExp(${JSON.stringify(isPrefix ? "^" + escaped : escaped)})`,
        },
      };
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // LLM-narrative dialect rules — v1.1.2 (second batch — Background steps,
  // page-level assertions, subject-prefixed leaves, unquoted role+name)
  // ────────────────────────────────────────────────────────────────────────

  // N1.5. "[Given|And] (the )? <X> page is displayed/loaded/shown/visible"
  //       Background-style precondition that asserts we're on a page.
  //       Treated as goto() + toHaveURL(<X>) — same as rule 1 + rule 10
  //       but for the LLM dialect that drops the navigation verb.
  {
    pattern:
      /^(?:the )?(.+?) page (?:is|are) (?:displayed|shown|loaded|visible|present|open(?:ed)?)$/i,
    build: (m, step, pom, pageVar) => {
      const target = m[1].trim();
      // Prefer the synthesised goto() if the POM has one; otherwise
      // emit a goto(target) call.
      const hasGoto = pom.methods.some((mm) => mm.name === "goto");
      return {
        step,
        pomCall: hasGoto
          ? { page: pageVar, method: "goto", args: [] }
          : { page: pageVar, method: "goto", args: [JSON.stringify(target)] },
      };
    },
  },

  // N2.5. "[the user|user|I|...] leaves the X field empty (do not type anything)"
  //       Subject-prefixed variant of N2. Same emit (comment), different
  //       starting tokens. The original N2 (`^Leave ...`) doesn't accept a
  //       subject prefix.
  {
    pattern: new RegExp(
      `^${SUBJ}\\s+leaves?\\s+(?:the )?(.+?)\\s+(?:empty|blank|untouched|unchanged|alone)(?:\\s*\\([^)]+\\))?$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: `// intentionally left empty: ${stripUiSuffix(m[1])}`,
    }),
  },

  // N5b. Page-level text assertion — "the page (displays|contains|shows) [the message] 'X'"
  //      Asserts the page body contains the given text. Uses
  //      `.getByText("X").first()` to avoid Playwright strict-mode violations
  //      when the same text appears in multiple elements (e.g. an error div
  //      AND a `<b>` highlight repeat).
  {
    pattern:
      /^(?:the )?page\s+(?:displays?|shows?|contains?)(?:\s+the\s+(?:message|text|content))?\s+["']([^"']+)["']/i,
    build: (m, step, _pom, pageVar) => {
      const expected = m[1];
      return {
        step,
        assertion: {
          locator: synthFlexibleTextLocator(pageVar, expected),
          matcher: "toBeVisible",
        },
      };
    },
  },

  // N5d. "<subject> is on (the)? <X> page" / "... at 'URL'" / "... 'URL'" —
  //      Background-style precondition. URL suffix is OPTIONAL, and within
  //      the URL suffix the word "at" is also optional (v1.1.7). Three forms
  //      observed in production:
  //        "is on the login page"                 — narrative only
  //        "is on the login page at 'URL'"        — with explicit "at"
  //        "is on the login page 'URL'"           — quoted URL appended directly
  //      All three resolve to goto() since Background usually handles the
  //      actual navigation; the page name and URL are narrative context.
  //      Per design call (3): match it, don't fail.
  {
    pattern: new RegExp(
      `^${SUBJ}\\s+(?:is|are|am)\\s+on\\s+(?:the\\s+)?(?:.+?)\\s+page(?:\\s+(?:at\\s+)?["']([^"']+)["'])?\\s*$`,
      "i",
    ),
    build: (_m, step, pom, pageVar) => {
      const hasGoto = pom.methods.some((mm) => mm.name === "goto");
      return {
        step,
        pomCall: hasGoto
          ? { page: pageVar, method: "goto", args: [] }
          : { page: pageVar, method: "goto", args: [] },
      };
    },
  },

  // N5e. "<subject> is/are NOT redirected away from (the )? <X> page"
  //      Negative redirect — assert URL still contains the page name. Soft
  //      assertion: matches by slug. Surfaced from R-5D89B426-001.
  {
    pattern: new RegExp(
      `^${SUBJ}\\s+(?:is|are|am)\\s+(?:not|NOT)\\s+redirected\\s+(?:away\\s+from|from)\\s+(?:the\\s+)?(.+?)(?:\\s+page)?$`,
      "i",
    ),
    build: (m, step, _pom, pageVar) => {
      // v1.1.4: stripArticles. v1.1.6: also stripParentheticals via cleanSlugTarget.
      const target = cleanSlugTarget(m[1]);
      // v2.2.2: refuse to slugify English prose — produces regexes that
      // never match real URLs and silently pass for the wrong reason
      // (e.g. "login page without any redirect" → /login[-_/]?page[-_/]?
      // without[-_/]?any[-_/]?redirect/). Fall back to TODO warning.
      if (looksLikeProse(target)) {
        return {
          step,
          warning:
            `URL slug target "${target}" reads like prose, not a path; emitting TODO so the user can supply a real URL fragment.`,
        };
      }
      const slug = target
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\s+/g, "[-_/]?");
      return {
        step,
        assertion: {
          locator: `${pageVar}.page`,
          matcher: "toHaveURL",
          expected: `new RegExp(${JSON.stringify(slug)})`,
        },
      };
    },
  },

  // N5c. Subject-less specific-message visibility — "An <severity> message containing 'V' is displayed"
  //      Captures both the severity (error/validation/warning/success) AND
  //      the expected text. Picks an appropriate POM field for the severity;
  //      asserts toContainText against that field. More specific than N5
  //      (which doesn't require "containing").
  //
  //      Must come BEFORE N5 so the severity-aware field selection wins.
  {
    pattern:
      /^(?:An?|the)\s+(error|validation|warning|alert|success)\s+message\s+containing\s+["']([^"']+)["']\s+(?:is|are)\s+(?:displayed|shown|visible)/i,
    build: (m, step, pom, pageVar) => {
      const severity = m[1].toLowerCase();
      const expected = m[2];
      let field;
      if (severity === "success") {
        field =
          findField(pom, "successMessage", ["Heading", "Message", "Banner"]) ??
          findField(pom, "success", ["Heading", "Message"]) ??
          findField(pom, "welcome", ["Heading", "Message"]);
      } else {
        field =
          findField(pom, "errorMessage", ["Alert", "Error", "Message"]) ??
          findField(pom, "error", ["Alert", "Error"]);
      }
      const locatorExpr = field
        ? `${pageVar}.${field.fieldName}`
        : synthFlexibleTextLocator(pageVar, expected);
      return {
        step,
        assertion: {
          locator: locatorExpr,
          matcher: "toContainText",
          expected: JSON.stringify(expected),
        },
      };
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // LLM-narrative dialect rules (v1.1.1)
  //
  // Real LLM test-case-generation services produce more narrative,
  // subject-less Gherkin than hand-authored suites. The rules below cover
  // the patterns observed on actual cloud-jobs-template runs against the
  // `R-8BE659B5-001` fixture (saved at examples/llm-narrative-login/).
  // Each rule has a regression test in tests/unit/stepMatcher.test.ts.
  //
  // Note: "Navigate to <URL>" is already handled by rule 1 (the optional
  // SUBJ prefix accepts subject-less variants). "Click the 'X' button" is
  // already handled by rule 3. Both verified against the LLM fixture.
  // ────────────────────────────────────────────────────────────────────────

  // N1. "Locate the X (input field|input|field|box|...) and (enter|type|fill) 'V'"
  //     Compound locate-and-fill — splits into a single .fill() against the
  //     POM field that best matches X. If the POM has no matching field,
  //     falls through to TODO so the gap shows up in BDD_REVIEW.md.
  {
    pattern:
      /^(?:Locate|Find) (?:the )?(.+?) and (?:enter|enters|type|types|input|inputs|fill|fills) ["']([^"']*)["']$/i,
    build: (m, step, pom, pageVar) => {
      const desc = stripUiSuffix(m[1]);
      return fillFieldBinding(step, pom, pageVar, desc, m[2]);
    },
  },

  // N2. "Leave the X (input)? field empty (do not type anything)"
  //     Intentional skip — emit a comment so the spec is honest about what
  //     the scenario asks for. Per design call (3): explicit comment so
  //     reviewers see the intent in the spec.
  {
    pattern:
      /^Leave (?:the )?(.+?)\s+(?:empty|blank|untouched|unchanged|alone)(?:\s*\([^)]+\))?$/i,
    build: (m, step) => ({
      step,
      customBody: `// intentionally left empty: ${stripUiSuffix(m[1])}`,
    }),
  },

  // N3. "Observe ..." / "Note ..." — annotation steps with no real action.
  //     Same treatment as N2 — emit a comment so the spec preserves the
  //     scenario's narrative without producing TODO noise.
  {
    pattern:
      /^(?:Observe|Note|Watch|See visually|Verify(?: that)?(?: visually)?)\s+(?:the )?(.+)$/i,
    build: (m, step) => ({
      step,
      customBody: `// observation: ${m[1].trim()}`,
    }),
  },

  // N4. "URL does(?:n't| not) change(?:\s+to (?:the )?<description> page)?"
  //     Negative URL assertion. The captured description (e.g. "the success
  //     page" → "success") is used as a regex slug; the assertion fires
  //     `not.toHaveURL`. Soft assertion — meaningful when the step describes
  //     a known forbidden destination.
  {
    pattern:
      /^(?:the )?URL does(?:n't| not) change(?:\s+to\s+(?:the )?(.+?))?(?:\s+page)?$/i,
    build: (m, step, _pom, pageVar) => {
      // v1.1.4: stripArticles. v1.1.6: also stripParentheticals via cleanSlugTarget
      // for parity with rules 10/11b. Default "success" when the description is
      // omitted entirely.
      const target = cleanSlugTarget(m[1] ?? "success");
      // v2.2.2: prose guard — see N5e for the rationale.
      if (looksLikeProse(target)) {
        return {
          step,
          warning:
            `URL slug target "${target}" reads like prose, not a path; emitting TODO so the user can supply a real URL fragment.`,
        };
      }
      const slug = target
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\s+/g, "[-_/]?");
      return {
        step,
        assertion: {
          locator: `${pageVar}.page`,
          matcher: "not.toHaveURL",
          expected: `new RegExp(${JSON.stringify(slug)})`,
        },
      };
    },
  },

  // N4b. Narrative error/validation visibility — no quoted value.
  //      "An error message is displayed indicating that credentials are required"
  //      "A validation message appears"
  //      "A warning is shown"
  //      Asserts the error/alert region is visible. Less specific than N5
  //      (which captures a quoted expected value) but still honest. Must run
  //      BEFORE N5 only if the step has no quote — N5's pattern requires a
  //      quote, so they don't conflict; N5 wins when the quote is present.
  {
    pattern:
      /^An?\s+(error|validation|warning|alert)(?:\s+\w+)*\s+(?:is|are)\s+(?:displayed|shown|visible|present)/i,
    build: (m, step, pom, pageVar) => {
      // Only fire if the step has NO quoted value — otherwise let N5 handle it.
      if (/["'][^"']+["']/.test(step.text)) return null;
      void m;
      const field =
        findField(pom, "errorMessage", ["Alert", "Error", "Message"]) ??
        findField(pom, "error", ["Alert", "Error"]);
      const locatorExpr = field
        ? `${pageVar}.${field.fieldName}`
        : `${pageVar}.page.getByRole("alert").first()`;
      return {
        step,
        assertion: { locator: locatorExpr, matcher: "toBeVisible" },
      };
    },
  },

  // N5. Narrative text-contains — quoted V revealed by "such as 'V'",
  //     "(e.g., 'V')", "(for example, 'V')", "indicating 'V'", "like 'V'".
  //     Picks an error/alert/success field from the POM if the description
  //     hints at one; otherwise falls back to `getByText(V)`.
  {
    pattern:
      /^.+?(?:\s+such as\s+|\s*\(\s*e\.g\.,?\s*|\s*\(\s*for example,?\s*|\s+for example\s+|\s+indicating\s+|\s+like\s+)["']([^"']+)["']/i,
    build: (m, step, pom, pageVar) => {
      const expected = m[1];
      const description = step.text.toLowerCase();
      let field;
      if (/\b(error|invalid|fail|forbidden|unauthor)/i.test(description)) {
        field =
          findField(pom, "errorMessage", ["Alert", "Error", "Message"]) ??
          findField(pom, "error", ["Alert", "Error"]);
      } else if (
        /\b(success|congrat|welcome|logged.?in|logged.?on)/i.test(description)
      ) {
        field =
          findField(pom, "successMessage", ["Heading", "Message", "Banner"]) ??
          findField(pom, "success", ["Heading", "Message"]) ??
          findField(pom, "welcome", ["Heading", "Message"]);
      }
      const locatorExpr = field
        ? `${pageVar}.${field.fieldName}`
        : synthFlexibleTextLocator(pageVar, expected);
      return {
        step,
        assertion: {
          locator: locatorExpr,
          matcher: "toContainText",
          expected: JSON.stringify(expected),
        },
      };
    },
  },

  // N6. "A 'X' (button|link|...)? is visible on the page" / "a Logout button is visible"
  //     Subject-less visibility. Both QUOTED ("'Log out'") and UNQUOTED
  //     ("Logout") name forms are accepted. Per design call (4): when the
  //     POM has no matching field, synthesize a `getByRole(role, { name })`
  //     locator rather than dropping to TODO — turns false-positive passes
  //     into honest assertions.
  //
  //     Two-branch capture:
  //       m[1] = quoted name (with quotes stripped) — when present
  //       m[2] = unquoted name — when present
  //       m[3] = optional role (button|link|icon|element|tab)
  {
    pattern:
      /^A\s+(?:["']([^"']+)["']|([A-Za-z][A-Za-z0-9 _-]*?))\s+(button|link|icon|element|tab)\s*(?:is visible|appears|is shown|is displayed)(?:\s+on\s+(?:the )?page)?$/i,
    build: (m, step, pom, pageVar) => {
      const name = (m[1] ?? m[2] ?? "").trim();
      if (!name) return null;
      const role = m[3].toLowerCase();
      const field = findFieldByDescription(name, pom, [
        capitalize(role),
        "Button",
        "Link",
      ]);
      // v1.1.3: when synthesising, use a cross-role locator (a + button +
      // role=button + role=link) with a flexible text regex so "Logout"
      // matches a `<a>Log out</a>` on the page. Resolves the
      // button-vs-link mismatch from cloud-jobs runs.
      const locatorExpr = field
        ? `${pageVar}.${field.fieldName}`
        : synthRoleNameLocator(pageVar, name);
      return {
        step,
        assertion: { locator: locatorExpr, matcher: "toBeVisible" },
      };
    },
  },

  // N7. "No 'X' (button|...)? appears" / "No <noun> are/is displayed"
  //     Subject-less negative visibility. Two cases:
  //       - quoted: 'No \"Log out\" button appears' → POM lookup, fallback
  //         to getByRole synthesis.
  //       - unquoted plural: 'No error messages are displayed' →
  //         findField(error/alert) fallback to getByRole('alert').
  //     Per design call (4): always emit a real assertion, never a TODO.
  {
    pattern:
      /^No\s+(.+?)\s+(?:appear(?:s)?|are visible|is visible|is displayed|are displayed|is shown|are shown)(?:\s+on\s+(?:the )?page)?$/i,
    build: (m, step, pom, pageVar) => {
      const desc = m[1].trim();
      const quoted = desc.match(
        /^["']([^"']+)["']\s*(button|link|icon|element|tab)?$/i,
      );
      let locatorExpr: string;
      // Dispatcher order matters: check success/congrat BEFORE error/message,
      // because "success message" contains both keywords and we want the
      // success branch to win. Word boundaries (\b) prevent spurious matches
      // (e.g. "alert" inside "alerted" — though unlikely in practice).
      const lowered = desc.toLowerCase();
      // v1.1.3: every synthesised fallback ends in `.first()` to avoid
      // strict-mode violations when the same text/role appears multiple
      // times on the page (very common with error messages echoed in
      // <div id="error"> AND <b> highlight repeats).
      if (quoted) {
        const name = quoted[1];
        const role = (quoted[2] ?? "button").toLowerCase();
        const field = findFieldByDescription(name, pom, [
          capitalize(role),
          "Button",
          "Link",
        ]);
        locatorExpr = field
          ? `${pageVar}.${field.fieldName}`
          : synthRoleNameLocator(pageVar, name);
      } else if (/\b(success|congrat|welcome)\b/.test(lowered)) {
        const field =
          findField(pom, "successMessage", ["Heading", "Message", "Banner"]) ??
          findField(pom, "success", ["Heading", "Message"]) ??
          findField(pom, "welcome", ["Heading", "Message"]);
        locatorExpr = field
          ? `${pageVar}.${field.fieldName}`
          : synthFlexibleTextLocator(pageVar, desc);
      } else if (/\b(error|invalid|fail|forbidden|unauthor|alert|warning)\b/.test(lowered)) {
        const field =
          findField(pom, "errorMessage", ["Alert", "Error", "Message"]) ??
          findField(pom, "error", ["Alert", "Error"]);
        locatorExpr = field
          ? `${pageVar}.${field.fieldName}`
          : `${pageVar}.page.getByRole("alert").first()`;
      } else if (/\bmessage(s)?\b/.test(lowered)) {
        const field =
          findField(pom, "errorMessage", ["Alert", "Error", "Message"]) ??
          findField(pom, "error", ["Alert", "Error"]);
        locatorExpr = field
          ? `${pageVar}.${field.fieldName}`
          : `${pageVar}.page.getByRole("alert").first()`;
      } else {
        const field = findFieldByDescription(desc, pom, []);
        locatorExpr = field
          ? `${pageVar}.${field.fieldName}`
          : synthFlexibleTextLocator(pageVar, desc);
      }
      return {
        step,
        assertion: { locator: locatorExpr, matcher: "not.toBeVisible" },
      };
    },
  },
];

/**
 * Shared helper for both word orders of the input-into-field rule.
 * Picks an existing `fill<Field>` method if defined, else uses a direct locator call.
 */
function fillFieldBinding(
  step: StepIR,
  pom: PageObjectIR,
  pageVar: string,
  fieldHint: string,
  value: string,
): StepBinding | null {
  const field = findField(pom, fieldHint, ["Input", "Field", "Box", "Textbox"]);
  if (!field) return null;
  const method = findOrSynthMethod(pom, `fill${capitalize(field.fieldName)}`, [
    { name: "v", type: "string" },
  ]);
  if (method && method.kind === "existing") {
    return {
      step,
      pomCall: { page: pageVar, method: method.name, args: [JSON.stringify(value)] },
    };
  }
  return {
    step,
    pomCall: {
      page: pageVar,
      method: `${field.fieldName}.fill`,
      args: [JSON.stringify(value)],
    },
  };
}

// --- Helpers ---------------------------------------------------------------

/**
 * Find a POM field whose name reasonably matches `hint`.
 *
 * Resolution order:
 *   1. Exact case-insensitive match.
 *   2. norm + each preferred suffix (so "login" + ["Button"] → "loginButton").
 *   3. If preferredSuffixes is non-empty: ONLY consider fields whose name
 *      ends with one of those suffixes. Within that subset:
 *      a. Substring match (hint inside fieldName, or vice versa)
 *      b. If exactly one field matches the suffix at all, return it
 *         (e.g. "I click the login button" with one *Button on the page →
 *         that button, regardless of name)
 *   4. Generic substring match across all fields (last resort).
 *
 * Fixes the bug where "login button" matched `testLoginHeading` because
 * "login" is a substring of "testloginheading" — even though there was a
 * perfectly good `submitButton` on the same page.
 */
function findField(
  pom: PageObjectIR,
  hint: string,
  preferredSuffixes: string[],
  opts: { strict?: boolean } = {},
) {
  const norm = camelCase(hint.replace(/[^a-zA-Z0-9 ]/g, ""));
  const lower = norm.toLowerCase();

  // 1. Exact match
  let f = pom.fields.find((x) => x.fieldName.toLowerCase() === lower);
  if (f) return f;

  // 2. norm + each preferred suffix
  for (const suf of preferredSuffixes) {
    const target = (norm + suf).toLowerCase();
    f = pom.fields.find((x) => x.fieldName.toLowerCase() === target);
    if (f) return f;
  }

  // 3. Suffix-constrained matching — prefer same-role fields
  if (preferredSuffixes.length > 0) {
    const suffixMatched = pom.fields.filter((x) =>
      preferredSuffixes.some((s) => x.fieldName.toLowerCase().endsWith(s.toLowerCase())),
    );
    // 3a. substring match within the suffix-matched subset
    f = suffixMatched.find(
      (x) => x.fieldName.toLowerCase().includes(lower) || lower.includes(x.fieldName.toLowerCase()),
    );
    if (f) return f;
    // 3b. exactly one suffix-matched field on the whole page → use it.
    //     SKIPPED in strict mode: LLM-narrative rules (N6/N7) call
    //     `findFieldByDescription({strict: true})` because "Log out" with
    //     a POM that has only `loginButton` should NOT silently resolve
    //     to that wrong button — it should fall to synthesis.
    if (!opts.strict && suffixMatched.length === 1) return suffixMatched[0];
  }

  // 4. Generic substring match (last resort, may hit cross-role fields).
  //     Also skipped in strict mode for the same reason as 3b.
  if (!opts.strict) {
    f = pom.fields.find((x) => x.fieldName.toLowerCase().includes(lower));
    if (f) return f;
    f = pom.fields.find((x) => lower.includes(x.fieldName.toLowerCase()));
    return f;
  }
  return undefined;
}

function findOrSynthMethod(
  pom: PageObjectIR,
  desiredName: string,
  _params: { name: string; type: string }[],
): { kind: "existing"; name: string } | { kind: "synth"; name: string } | null {
  const existing = pom.methods.find((m) => m.name === desiredName);
  if (existing) return { kind: "existing", name: existing.name };
  return { kind: "synth", name: desiredName };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Strip trailing UI-element words from a description so findField sees the
 * core noun. "username input field" → "username", "Log out button" → "Log out",
 * "error message" → "error message" (we leave compound nouns alone — the
 * caller's `preferredSuffixes` will resolve them).
 *
 * Order matters — multi-word suffixes (e.g. "input field") must be tried
 * before single-word ones so "username input field" → "username" rather than
 * "username input".
 */
function stripUiSuffix(desc: string): string {
  return desc
    .replace(
      /\s+(?:input\s+field|text\s+box|input|field|box|element|control|textbox)\s*$/i,
      "",
    )
    .trim();
}

/**
 * Look up a POM field given a descriptive phrase like "username input field"
 * or "Log out button". Strips trailing UI-element words then defers to
 * `findField` with sensible suffix preferences.
 *
 * Used by the LLM-narrative dialect rules (N1, N6, N7). Exposed at module
 * scope (not exported) so future rules can share the same field-lookup
 * semantics without duplicating the strip-and-normalize dance.
 */
function findFieldByDescription(
  desc: string,
  pom: PageObjectIR,
  preferredSuffixes: string[] = ["Input", "Field", "Box", "Textbox"],
) {
  // Strict mode: skip 3b ("exactly one suffix-matched on the page") and the
  // generic substring fallback (4). LLM rules synthesise a `getByRole` /
  // `getByText` locator when no real match is found, which is more honest
  // than wrong-element heuristics.
  return findField(pom, stripUiSuffix(desc), preferredSuffixes, { strict: true });
}

/**
 * Strip English articles ("a", "an", "the") from a description so they
 * don't leak into URL regex slugs as literal characters.
 *
 * Without this, "redirected to a logged-in page" → slug "a[-_/]?logged-in",
 * which fails to match URL "/logged-in-successfully/" because the actual
 * URL has no "a" before "logged-in".
 *
 * Applied to rule 10, 11b, N4, N5e — every rule that slugifies a captured
 * page-name description. Rules that just emit goto(<URL>) don't need this
 * (URLs don't contain English articles as path segments).
 */
function stripArticles(s: string): string {
  return s
    .replace(/^\s*(?:a|an|the)\s+/i, "")
    .replace(/\s+(?:a|an|the)\s+/gi, " ")
    .replace(/\s+(?:a|an|the)\s*$/i, "")
    .trim();
}

/**
 * Strip parenthetical commentary like `(URL changes away from login page)`
 * from a description before slugifying it. v1.1.6 — production runs hit
 * steps shaped like:
 *   "Then User is redirected to logged-in page (URL changes away from login page)"
 *   "And user remains on login page (URL does not change away from login page)"
 * Without this strip, the parenthetical leaks into the URL regex slug as
 *   /logged-in[-_/]?page[-_/]?\(URL[-_/]?changes[-_/]?away.../
 * which never matches a real URL.
 *
 * Note: rule 11a (URL contains 'X') extracts the AUTHORITATIVE fragment from
 * the parenthetical and runs first — descriptive parentheticals only reach
 * rules 10/11b/N4/N5e via this strip.
 */
function stripParentheticals(s: string): string {
  return s.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Combined strip — articles + parentheticals + a trailing " page" word that
 * survives because the rule's `(?: page)?$` end-anchor only matches at the
 * end-of-string. After parentheticals are stripped, an inner ` page` may be
 * left dangling. Used by every slugifying rule (10, 11b, N4, N5e).
 */
function cleanSlugTarget(s: string): string {
  return stripArticles(
    stripParentheticals(s).replace(/\s+page$/i, "").trim(),
  );
}

/**
 * Build a regex literal expression that matches a name flexibly:
 *   - case-insensitive
 *   - whitespace-tolerant ("Logout" matches both "Logout" and "Log out")
 *   - anchored start/end to avoid partial matches
 *
 * "Logout" → `new RegExp("^L\\s*o\\s*g\\s*o\\s*u\\s*t$", "i")`
 *
 * Used by the synthesised cross-role locators (v1.1.3) so the LLM's spelling
 * variant doesn't cause `expect.toBeVisible()` failures against pages that
 * use a different spelling/spacing.
 */
function flexibleNameRegex(name: string): string {
  const cleaned = name.replace(/\s+/g, "").trim();
  const escaped = cleaned
    .split("")
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*");
  // JSON.stringify wraps in quotes and escapes embedded backslashes/quotes —
  // perfect for embedding the pattern into the emitted TypeScript source.
  return `new RegExp(${JSON.stringify("^" + escaped + "$")}, "i")`;
}

/**
 * Synthesise a cross-role locator that matches both `<a>` and `<button>`
 * (and ARIA role variants) by visible text — flexible to spelling
 * differences. Used by N6/N7 when the POM has no field for the named
 * element. Resolves the "LLM says button but page has link" mismatch.
 */
function synthRoleNameLocator(pageVar: string, name: string): string {
  const flex = flexibleNameRegex(name);
  // The selector covers the common cases. Filter by hasText with the
  // flexible regex to handle "Logout" vs "Log out" etc. `.first()` is
  // mandatory because Playwright's expect runs in strict mode and the
  // text could appear in a parent + child.
  return `${pageVar}.page.locator("a, button, [role='button'], [role='link']").filter({ hasText: ${flex} }).first()`;
}

/**
 * Synthesise a flexible getByText locator with `.first()`. Used by N5b and
 * any rule that asserts "page contains text X" — text often appears in
 * multiple elements (heading + bold copy + paragraph) and strict mode would
 * fail otherwise.
 */
function synthFlexibleTextLocator(pageVar: string, text: string): string {
  return `${pageVar}.page.getByText(${JSON.stringify(text)}).first()`;
}
