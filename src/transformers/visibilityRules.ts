/**
 * v3.1.0 — catch-all visibility rules.
 *
 * Why this exists: TestForge AI's handoff report (Issue 1, P0) showed
 * that steps like "the user's name or profile indicator is visible in
 * the UI" were falling through every existing visibility rule (which
 * require specific noun-phrase shapes like "a Logout button" or "an
 * error message") and ending up in the URL-slug rules, where the
 * prose was tokenised into a regex that never matches a real URL.
 * Result: silent always-failing tests that look like product bugs.
 *
 * These rules slot in BEFORE all URL-slug rules so any
 * "is visible / displayed / shown / appears" phrasing is intercepted
 * deterministically. The captured noun phrase is matched against the
 * POM's fields (fuzzy / case-insensitive contains); if a field matches,
 * we emit `expect(<pomVar>.<field>).toBeVisible()`. If nothing matches,
 * we emit a clean `// TODO bdd2pw: ambiguous visibility step` warning
 * — never a URL regex.
 *
 * Coverage:
 *   - "<noun> is visible (in <where>)?"
 *   - "<noun> is displayed (in <where>)?"
 *   - "<noun> is shown (in <where>)?"
 *   - "<noun> appears (on screen|in <where>)?"
 *   - "<noun> should be visible / displayed / shown"
 *   - "<noun> is enabled / clickable" → toBeEnabled()
 *
 * The noun can be arbitrary prose (apostrophes, "or", multiple words);
 * we don't try to slugify it into a locator.
 */

import type { PageObjectIR, StepBinding, StepIR } from "../types";

interface Rule {
  pattern: RegExp;
  build(
    m: RegExpMatchArray,
    step: StepIR,
    pom: PageObjectIR,
    pageVar: string,
  ): StepBinding | null;
}

/** Words that, if they appear inside a captured noun, suggest the
 *  step refers to a navigation / URL claim rather than a UI element.
 *  When found, we decline the visibility rule so URL rules can have
 *  another chance. */
const URL_HINT_WORDS = new Set([
  "url",
  "path",
  "endpoint",
  "page",
  "route",
]);

/**
 * Role hints THAT N6 SPECIFICALLY HANDLES. When the captured noun
 * phrase ends with one of these, the existing N6 rule synthesises a
 * cross-role locator ("a Logout button is visible" →
 * `getByRole('button', { name: /Logout/i })` with link fallback). We
 * decline our visibility rule so N6 wins.
 *
 * Kept narrow on purpose: nouns that end in `message`/`banner`/`alert`
 * but DON'T fit N5c's "containing" shape (e.g. "the welcome banner is
 * shown") should still get our TODO treatment, not be left orphaned.
 */
const N6_ROLE_TAIL = /\b(?:button|link|icon|element|tab)$/i;

/**
 * N5c handles "<an? <kind> message|alert|banner> containing '<value>'
 * is displayed/shown" with `toContainText`. Whenever we see a noun that
 * contains the literal word "containing", that's a strong signal it's
 * N5c-shaped and we should decline so N5c can produce the right
 * assertion.
 */
const N5C_LIKE = /\bcontaining\b/i;

/**
 * N7 handles negation-prefixed visibility steps ("No success message is
 * shown", "No 'Log out' button appears", "No errors are displayed").
 * The N7 pattern requires the step to START with "No ", so we decline
 * our visibility rule whenever the captured noun begins with that
 * negation prefix.
 *
 * The case-insensitive match also catches "no errors are displayed"
 * just in case a future test exercises lowercase negation.
 */
const N7_NEGATION_PREFIX = /^no\s+/i;

/**
 * Decline this rule when the noun:
 *   1. is the empty string,
 *   2. contains URL hint words ("url", "page", "route", …),
 *   3. ends with one of N6's role hints (button|link|icon|element|tab),
 *   4. looks like an N5c "containing" phrase,
 *   5. starts with the N7 negation prefix "No ".
 */
function shouldDeclineVisibilityRule(noun: string): boolean {
  const normalised = normaliseNoun(noun);
  if (!normalised) return true;
  const tokens = normalised.split(/\s+/);
  if (tokens.some((t) => URL_HINT_WORDS.has(t))) return true;
  if (N6_ROLE_TAIL.test(normalised)) return true;
  if (N5C_LIKE.test(normalised)) return true;
  if (N7_NEGATION_PREFIX.test(normalised)) return true;
  return false;
}

/** Lowercase the noun phrase and squash whitespace for matching. */
function normaliseNoun(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Try to find a POM field whose name contains the noun phrase (or vice
 * versa). Returns `<pageVar>.<fieldName>` when a match is found,
 * otherwise undefined.
 *
 * Conservative — only matches when one is a substring of the other,
 * case-insensitive. We never invent locators; if nothing matches the
 * caller emits a TODO.
 */
function resolveLocatorFromPom(
  noun: string,
  pom: PageObjectIR,
  pageVar: string,
): string | undefined {
  const target = normaliseNoun(noun).replace(/[^a-z0-9]/g, "");
  if (!target) return undefined;
  for (const field of pom.fields) {
    const fieldKey = field.fieldName.toLowerCase();
    if (fieldKey.includes(target) || target.includes(fieldKey)) {
      return `${pageVar}.${field.fieldName}`;
    }
  }
  return undefined;
}

/**
 * Shared build logic for visibility rules. Drives the matcher decision
 * once the regex has captured the noun phrase and chosen the matcher.
 */
function buildVisibilityBinding(
  step: StepIR,
  pom: PageObjectIR,
  pageVar: string,
  noun: string,
  matcher: "toBeVisible" | "toBeEnabled" | "not.toBeVisible",
): StepBinding | null {
  // Decline the rule when the captured noun is shaped for an existing
  // richer rule — URL rules (URL/path/page hints), or N5/N6/N7
  // cross-role rules (role-hint tail). The visibility rules in this
  // module are only meant to catch PROSE noun phrases that no other
  // rule handles. See `shouldDeclineVisibilityRule` for the full list.
  if (shouldDeclineVisibilityRule(noun)) return null;

  const locator = resolveLocatorFromPom(noun, pom, pageVar);
  if (!locator) {
    // No POM field match — emit a clean TODO. CRUCIALLY, we do NOT
    // fall through to a URL regex; this is the whole point of Issue 1.
    return {
      step,
      warning:
        `ambiguous visibility step: no POM field matched "${noun.trim()}". ` +
        `Add a locator field to the POM, or hand-edit the spec to point at the ` +
        `right element. (bdd2pw will not synthesise a URL regex from a prose ` +
        `noun — that produced always-failing tests in v3.0.0 and earlier.)`,
    };
  }
  return {
    step,
    assertion: { locator, matcher },
  };
}

export const VISIBILITY_RULES: Rule[] = [
  // V:01 — "<noun> is visible (in/on <where>)?"
  // Catches the TestForge reproduction:
  //   "the user's name or profile indicator is visible in the UI"
  //
  // The noun phrase can contain apostrophes, "or", multiple words. We
  // capture greedily up to ` is visible` and then optionally consume
  // a trailing " in/on <something>" clause.
  {
    pattern:
      /^(.+?)\s+is\s+visible(?:\s+(?:in|on)\s+the\s+(?:ui|page|screen))?$/i,
    build: (m, step, pom, pageVar) =>
      buildVisibilityBinding(step, pom, pageVar, m[1], "toBeVisible"),
  },

  // V:02 — "<noun> is displayed (in/on <where>)?"
  {
    pattern:
      /^(.+?)\s+is\s+displayed(?:\s+(?:in|on)\s+the\s+(?:ui|page|screen))?$/i,
    build: (m, step, pom, pageVar) =>
      buildVisibilityBinding(step, pom, pageVar, m[1], "toBeVisible"),
  },

  // V:03 — "<noun> is shown (in/on <where>)?"
  {
    pattern:
      /^(.+?)\s+is\s+shown(?:\s+(?:in|on)\s+the\s+(?:ui|page|screen))?$/i,
    build: (m, step, pom, pageVar) =>
      buildVisibilityBinding(step, pom, pageVar, m[1], "toBeVisible"),
  },

  // V:04 — "<noun> appears (on screen|in/on the ui/page)?"
  {
    pattern:
      /^(.+?)\s+appears(?:\s+(?:on\s+screen|in\s+the\s+(?:ui|page)|on\s+the\s+page))?$/i,
    build: (m, step, pom, pageVar) =>
      buildVisibilityBinding(step, pom, pageVar, m[1], "toBeVisible"),
  },

  // V:05 — "<noun> should be visible / displayed / shown"
  {
    pattern: /^(.+?)\s+should\s+be\s+(?:visible|displayed|shown)$/i,
    build: (m, step, pom, pageVar) =>
      buildVisibilityBinding(step, pom, pageVar, m[1], "toBeVisible"),
  },

  // V:06 — negative: "<noun> is (not visible|hidden|not displayed|not shown)"
  {
    pattern:
      /^(.+?)\s+is\s+(?:not\s+visible|hidden|not\s+displayed|not\s+shown)$/i,
    build: (m, step, pom, pageVar) =>
      buildVisibilityBinding(step, pom, pageVar, m[1], "not.toBeVisible"),
  },

  // V:07 — "<noun> is enabled / clickable"
  {
    pattern: /^(.+?)\s+is\s+(?:enabled|clickable)$/i,
    build: (m, step, pom, pageVar) =>
      buildVisibilityBinding(step, pom, pageVar, m[1], "toBeEnabled"),
  },
];
// (end of visibilityRules.ts — v3.1.0)
