/**
 * Gherkin step text normalizer — belt-and-suspenders canonicalisation
 * applied BEFORE the rule table runs.
 *
 * Why this exists (Block 2 #7, 2026-05-08):
 *   The LLM that produces .feature files is steered toward the canonical
 *   "ALLOWED PHRASINGS" list in test-case-generation-service/prompts.py,
 *   but it occasionally drifts:
 *
 *     • "enter X in the field"      vs  "enter X into the field"
 *     • "click 'Sign In'"            vs  "click the 'Sign In' button"
 *     • smart curly quotes from copy-paste vs straight quotes
 *     • trailing whitespace, double spaces, trailing periods
 *     • "I am on the X page (the login screen)" — parenthetical noise
 *     • "user remains on login page" vs "URL remains on the login page"
 *
 *   When the drift slips through, the rule regex misses → step falls
 *   through to a `// TODO:` no-op → the spec passes silently while
 *   doing nothing. Customers see green tests that exercise nothing.
 *
 *   This normalizer applies a small, conservative set of safe rewrites
 *   that map common drift forms back to their canonical shape so the
 *   existing rule table picks them up. Anything genuinely outside the
 *   ALLOWED list still falls through to the LLM provider / TODO.
 *
 * Design constraints:
 *   - Idempotent: normalise(normalise(x)) === normalise(x).
 *   - Conservative: only rewrite when the replacement is unambiguous.
 *     We don't want to turn a custom domain step into a different action.
 *   - Cheap: pure regex; no NLP.
 */

/* ─── individual rewrite passes ───────────────────────────────────── */

/** Curly/smart quotes → straight quotes. Copy-paste from docs is the
 *  usual source. Single, double, and the prime variants. */
function unifyQuotes(s: string): string {
  return s
    .replace(/[‘’‚′]/g, "'")  // ’ ‘ ‚ ′
    .replace(/[“”„″]/g, '"')  // “ ” „ ″
    .replace(/[–—]/g, "-");             // – —  → -
}

/** Collapse runs of whitespace, drop trailing punctuation that doesn't
 *  carry semantics for the rule regex (period, semicolon at EOL). */
function tidyWhitespace(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/[\.;]\s*$/, "")
    .trim();
}

/** Strip trailing parenthetical clauses ("I am on the login page (Acme app)").
 *  Parenthetical commentary breaks the rule slugs — the prompt says don't,
 *  the LLM still does. We only drop parentheticals at END-OF-STEP because
 *  some assertions legitimately use "(URL contains 'fragment')" mid-step
 *  and the rule regex includes the parenthetical as a capture group.
 *
 *  PROTECTED FORMS (kept verbatim, not stripped):
 *    - Anything starting with "URL ..." — covers "URL contains 'X'",
 *      "URL changes to ...", "URL does not change ...", "URL remains the
 *      same", etc. The previous version enumerated 3 specific verbs and
 *      missed "does not change", which broke v1.1.6's parenthetical-aware
 *      slug rules.
 *    - Anything starting with "e.g." / "i.e." / "for example" / "such
 *      as" / "like" — these introduce the QUOTED VALUE that N5 binds to
 *      `toContainText`. Stripping them defeats N5 and lets N4b's loose-
 *      visibility rule win, producing `toBeVisible` instead of the more
 *      specific text-match assertion.
 */
function stripTrailingParenthetical(s: string): string {
  const m = s.match(/^(.*)\s*\(([^()]*)\)\s*$/);
  if (!m) return s;
  const inner = m[2].trim();
  // Protect ANY URL-related parenthetical (positive or negative). Previous
  // version only kept "contains/changes/remains" — missed "does not change".
  if (/^URL\b/i.test(inner)) return s;
  // Protect text-introducing parentheticals — N5 needs them to find
  // the quoted expected value. Followed-by [\s,] or end-of-string so we
  // don't over-match "likely" / "for examples" — and CRITICALLY we don't
  // use \b after "e.g." because "." is non-word, so \b never matches the
  // following "," (which is also non-word). Use lookahead instead.
  if (
    /^(?:e\.g\.|i\.e\.|for example|such as|like)(?=[\s,]|$)/i.test(inner)
  ) {
    return s;
  }
  return m[1].trimEnd();
}

/** "enter X in the field" → "enter X into the field"
 *  "fill X in the field"  → "fill X into the field"
 *  "type X in the field"  → "type X into the field"
 *
 *  The prompt forbids "in" but the LLM still produces it. The bdd2pw
 *  rule table tolerates both "in" and "into" via an optional 'to', but
 *  ONLY if no other words intervene. Normalising here lets the rule
 *  match cleanly without depending on regex tolerance.
 */
function inToInto(s: string): string {
  return s.replace(/\b(enter|fill|type)\b(.+?)\bin the\b/gi, "$1$2into the");
}

/** "click 'X'" / 'click "X"' (with no "button"/"link" word) →
 *  "click the 'X' button". Conservative: only when the quoted token
 *  looks like a button label (no spaces or short with capitalised words).
 *  We DON'T rewrite "click 'X' link" or "click the 'X' icon" — those
 *  are legitimate distinct shapes the rule table handles. */
function quotedTargetToButton(s: string): string {
  const m = s.match(/^\s*(?:I\s+)?(?:click|press|tap)\s+(['"])([^'"]+?)\1\s*$/i);
  if (!m) return s;
  // Wrap with "the … button" so the canonical click rule fires.
  return s.replace(m[0], `Click the ${m[1]}${m[2]}${m[1]} button`);
}

/** "<subject> stays on <X> page" / "is still on <X> page" →
 *  "<subject> remains on <X> page". Rule 10 (v1.1.4+) accepts the
 *  canonical "remains on" form with subject prefix; we only rewrite the
 *  ALTERNATIVE verbs ("stays", "is still") to "remains".
 *
 *  v2.2.0 bug fix: the previous version rewrote ANY of those verbs PLUS
 *  the subject itself to "URL remains on", but no rule actually matches
 *  "URL remains on ..." (rule 10's SUBJ pattern is restricted to I /
 *  user / User / the user / the User). The over-rewrite turned a working
 *  rule-10 input into TODO. We now only normalize the VERB; subject is
 *  preserved so rule 10 still binds.
 */
function staysOnPage(s: string): string {
  return s.replace(
    /^((?:I|user|the user|User|the User|page|the page)\s+)(?:stays|is still)\s+on\b/i,
    "$1remains on",
  );
}

/** "I'm on" → "I am on" (so the navigation rule matches). */
function expandImOn(s: string): string {
  return s.replace(/\bI'm\s+on\b/gi, "I am on");
}

/**
 * v2.2.2 — return true when the target string reads like English prose
 * rather than a URL fragment. The slugifier in rules 10/11b/N4/N5e would
 * otherwise produce regexes like `new RegExp("login[-_/]?page[-_/]?
 * without[-_/]?any[-_/]?redirect")` which never match a real URL but
 * silently pass strict-mode-less assertions for the wrong reason.
 *
 * Heuristics:
 *   - Contains a "stop word" that's NEVER in a URL path (with, without,
 *     any, the, and, or, but, after, before, while, where, when, redirect,
 *     redirection).
 *   - More than 5 whitespace-separated tokens — real URL paths use slashes
 *     and dashes, not spaces.
 *   - Mentions "redirect"/"redirection" anywhere (that's a verb describing
 *     navigation behaviour, not a path segment).
 *
 * Callers should treat true as "abandon slug, emit warning instead".
 */
const URL_PROSE_STOP_WORDS = new Set([
  "with", "without", "any", "the", "a", "an",
  "and", "or", "but", "if", "after", "before", "while",
  "where", "when", "since", "until", "via",
  "redirect", "redirection", "redirected", "redirects",
]);

export function looksLikeProse(target: string): boolean {
  const tokens = target.trim().split(/\s+/).filter(Boolean);
  if (tokens.length > 5) return true;
  if (/\bredirect/i.test(target)) return true;
  // v3.1.0 — visibility verbs anywhere in the captured slug are a
  // strong signal that the step is about a UI element, not a URL.
  // TestForge Issue 1: "the user's name or profile indicator is
  // visible in the UI" was being slugified into a URL regex because
  // none of the existing stop-word heuristics fired on this exact
  // shape. Decline visibility-shaped captures outright.
  if (/\b(?:is|are)\s+(?:visible|displayed|shown|hidden|not\s+(?:visible|displayed|shown))\b/i.test(target)) {
    return true;
  }
  if (/\b(?:appears|appear)\b/i.test(target)) return true;
  let stopHits = 0;
  for (const t of tokens) {
    if (URL_PROSE_STOP_WORDS.has(t.toLowerCase())) stopHits += 1;
    if (stopHits >= 2) return true;
  }
  return false;
}

/* ─── public API ──────────────────────────────────────────────────── */

const PASSES: Array<(s: string) => string> = [
  unifyQuotes,
  expandImOn,
  inToInto,
  staysOnPage,
  quotedTargetToButton,
  stripTrailingParenthetical,
  tidyWhitespace,
];

/**
 * Apply every rewrite pass once. Each pass is independently idempotent
 * and order-insensitive (apart from `tidyWhitespace`, which runs last).
 */
export function normalizeStepText(raw: string): string {
  let cur = raw ?? "";
  for (const pass of PASSES) cur = pass(cur);
  return cur;
}
