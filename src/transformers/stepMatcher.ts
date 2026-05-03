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
  for (const rule of RULES) {
    const m = step.text.match(rule.pattern);
    if (m) {
      const result = rule.build(m, step, pom, pageVar);
      if (result) return result;
    }
  }
  return {
    step,
    warning: `no rule matched: "${step.keyword} ${step.text}"`,
  };
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
  {
    pattern: new RegExp(`^${SUBJ} (?:enter|enters|type|types|fill|fills) ["']([^"']*)["'] (?:in|into|in to) (?:the )?(.+?)(?: field| input| box)?$`, "i"),
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
  //     Common in real-world Cucumber suites (e.g. test/test/login.feature).
  //     Also handles empty values: `I enter username ""`.
  {
    pattern: new RegExp(`^${SUBJ} (?:enter|enters|type|types|fill|fills) (?:the )?(.+?) ["']([^"']*)["']$`, "i"),
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

  // 10. Remain on page: "I should remain on the login page"
  {
    pattern: new RegExp(`^${SUBJ} should remain on (?:the )?(.+?)(?: page)?$`, "i"),
    build: (m, step, _pom, pageVar) => {
      const target = m[1].trim();
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

  // 11. Redirect: "I should be redirected to the logged-in page" / "to /dashboard"
  //     Asserts URL changed away from the previous page. Best-effort: regex matches
  //     the target token in the URL.
  {
    pattern: new RegExp(`^${SUBJ} (?:should be |am |is )?redirected to (?:the )?(.+?)(?: page)?$`, "i"),
    build: (m, step, _pom, pageVar) => {
      const target = m[1].trim();
      const slug = target.replace(/\s+/g, "[-_/]?");
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
    // 3b. exactly one suffix-matched field on the whole page → use it
    if (suffixMatched.length === 1) return suffixMatched[0];
  }

  // 4. Generic substring match (last resort, may hit cross-role fields)
  f = pom.fields.find((x) => x.fieldName.toLowerCase().includes(lower));
  if (f) return f;
  f = pom.fields.find((x) => lower.includes(x.fieldName.toLowerCase()));
  return f;
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
