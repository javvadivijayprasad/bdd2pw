/**
 * Locator picker — given an `ElementIR` and the full snapshot context,
 * choose the most stable Playwright locator API.
 *
 * Priority chain (FR-6):
 *   getByRole > getByLabel > getByPlaceholder > getByTestId > getByText
 *   > locator(css) > locator(xpath)
 *
 * The output `LocatorChoice` is then handed to `@vijaypjavvadi/pw-emit`
 * which renders it into TS. We never render here.
 */

import type { ElementIR, LocatorChoice } from "../types";
import { camelCase, toJsIdentifier } from "../utils/naming";

/**
 * Pick the highest-priority unique locator for `element`. Uniqueness is
 * checked against `allElements` — if multiple elements would match the
 * candidate locator, we fall down the chain.
 */
export function pickLocator(
  element: ElementIR,
  allElements: ElementIR[],
): LocatorChoice {
  const fieldName = synthFieldName(element);

  // 1. getByRole + accessible name — most stable
  if (element.role && element.name) {
    const rivals = allElements.filter(
      (e) => e !== element && e.role === element.role && e.name === element.name,
    );
    return {
      api: "getByRole",
      args: `${JSON.stringify(element.role)}, { name: ${JSON.stringify(element.name)} }`,
      fieldName,
      source: element,
      confidence: rivals.length === 0 ? "unique" : "ambiguous",
    };
  }

  // 2. getByLabel — for form inputs with associated <label>
  if (element.label) {
    const rivals = allElements.filter((e) => e !== element && e.label === element.label);
    return {
      api: "getByLabel",
      args: JSON.stringify(element.label),
      fieldName,
      source: element,
      confidence: rivals.length === 0 ? "unique" : "ambiguous",
    };
  }

  // 3. getByPlaceholder
  if (element.placeholder) {
    const rivals = allElements.filter(
      (e) => e !== element && e.placeholder === element.placeholder,
    );
    return {
      api: "getByPlaceholder",
      args: JSON.stringify(element.placeholder),
      fieldName,
      source: element,
      confidence: rivals.length === 0 ? "unique" : "ambiguous",
    };
  }

  // 4. getByTestId — when the app uses data-testid (best stability across releases)
  if (element.testId) {
    const rivals = allElements.filter((e) => e !== element && e.testId === element.testId);
    return {
      api: "getByTestId",
      args: JSON.stringify(element.testId),
      fieldName,
      source: element,
      confidence: rivals.length === 0 ? "unique" : "ambiguous",
    };
  }

  // 5. getByText — last semantic choice.
  //    Skipped for status regions (error / alert / notification banners),
  //    where text content is volatile (changes per scenario) but the id
  //    is stable. Without this skip, `<div id="error">{current message}</div>`
  //    becomes `getByText("{current message}")` — which then breaks any
  //    assertion that expects a DIFFERENT error string.
  const isStatusRegion =
    element.cssSelector !== undefined && STATUS_REGION_RE.test(element.cssSelector);
  if (
    !isStatusRegion &&
    element.text &&
    element.text.trim().length > 0 &&
    element.text.length < 80
  ) {
    const rivals = allElements.filter((e) => e !== element && e.text === element.text);
    return {
      api: "getByText",
      args: JSON.stringify(element.text),
      fieldName,
      source: element,
      confidence: rivals.length === 0 ? "unique" : "ambiguous",
    };
  }

  // 6. CSS selector — but reject framework-only class selectors
  //    (Angular's `.ng-untouched`, Material's `.mat-form-field`, etc.).
  //    These are runtime state markers that change as the user
  //    interacts with the page, so locators built on them are flaky.
  //    See BUG-10 / v2.2.6.
  //
  //    v2.2.7 — for MIXED selectors like `.ng-untouched.search-input`,
  //    strip the framework tokens so we emit `.search-input` rather
  //    than the compound selector that requires the state class to
  //    still match. If stripping leaves an empty / whitespace-only
  //    string, fall through to xpath / tag-only.
  if (element.cssSelector && !isFrameworkOnlySelector(element.cssSelector)) {
    const stripped = stripFrameworkClasses(element.cssSelector);
    if (stripped.length > 0) {
      return {
        api: "locator",
        args: JSON.stringify(stripped),
        fieldName,
        source: element,
        confidence: "fallback",
      };
    }
  }

  // 7. xpath — last resort
  if (element.xpath) {
    return {
      api: "locator",
      args: JSON.stringify(`xpath=${element.xpath}`),
      fieldName,
      source: element,
      confidence: "fallback",
    };
  }

  // Nothing usable — emit a tag-only locator and flag as fallback.
  // v2.2.6 — if we got here because the only CSS selector was
  // framework-internal (and there was no role / label / placeholder /
  // testId / text / xpath), the tag-only fallback is the least-bad
  // option. It at least matches a visible DOM element rather than a
  // transient state class.
  return {
    api: "locator",
    args: JSON.stringify(element.tag),
    fieldName,
    source: element,
    confidence: "fallback",
  };
}

/**
 * Pattern for "status region" elements — error / alert / notification banners.
 * When the CSS id (or class) matches this, we prefer the id-derived field
 * name over the text-derived one, because:
 *   1. The text content is incidental — `<div id="error">` shows different
 *      copy depending on what failed, but it's still "the error region".
 *   2. Field names like `yourUsernameIsInvalid` (text-derived) defeat the
 *      step matcher's "I should see an error message" rule, which looks
 *      for fields with `Alert`/`Error`/`Message` suffixes.
 * Naming a status region after its id (`error`, `errorMessage`,
 * `notificationBanner`) is what a test author would write by hand.
 */
const STATUS_REGION_RE = /(error|alert|message|warning|success|notification|status)/i;

/**
 * v2.2.6 — BUG-10. CSS class prefixes that frameworks generate at runtime
 * for their own bookkeeping (form-state, view-encapsulation, theming,
 * etc.). These classes:
 *
 *   - Change at runtime (`.ng-untouched` → `.ng-touched` the moment the
 *     user types), so selecting by them gives flaky locators.
 *   - Are not user-facing — no test author would write
 *     `await expect(page.locator('.ng-untouched')).toBeVisible()` by hand.
 *   - Mass-collide across the DOM (every Angular input has the same
 *     state classes), so locator-by-class is non-unique anyway.
 *
 * Covered prefixes:
 *   - `ng-*`         Angular core (ng-untouched, ng-pristine, ng-dirty, …)
 *   - `mat-*`        Angular Material
 *   - `cdk-*`        Angular CDK (overlay, focus-trap, etc.)
 *   - `mdc-*`        Material Design Components (web)
 *   - `_ngcontent-*` Angular view encapsulation attribute-like classes
 *   - `_nghost-*`    Angular view encapsulation host markers
 *
 * Hyphen is required after the prefix so we don't accidentally exclude
 * legitimate classes like `ngo-button` (user-named) or `cdkit` (rare but
 * possible). The `_ngcontent-` / `_nghost-` patterns are handled with an
 * explicit underscore prefix.
 */
const FRAMEWORK_CLASS_RE =
  /^(?:ng-|mat-|cdk-|mdc-|_ngcontent-|_nghost-)/i;

/** True when `cls` looks like a framework-internal class. */
export function isFrameworkClass(cls: string): boolean {
  return FRAMEWORK_CLASS_RE.test(cls);
}

/**
 * Extract all bare class names from a CSS selector. Tolerant of compound
 * selectors like `div.foo.bar#main` (returns `["foo", "bar"]`).
 */
function extractClasses(selector: string): string[] {
  const out: string[] = [];
  const re = /\.([a-zA-Z_][\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(selector)) !== null) out.push(m[1]);
  return out;
}

/**
 * True when `selector` reduces to *only* framework-internal classes
 * (e.g. `.ng-untouched.ng-pristine`). Such selectors are unstable
 * runtime markers and must not be used as Playwright locators.
 *
 * Selectors with at least one non-framework class
 * (`.ng-untouched.search-input`) are NOT flagged — the non-framework
 * class can still drive a useful locator.
 */
export function isFrameworkOnlySelector(selector: string | undefined): boolean {
  if (!selector) return false;
  // If there's an #id, we can't claim "framework only" — id is independent.
  if (/#[a-zA-Z][\w-]*/.test(selector)) return false;
  const classes = extractClasses(selector);
  if (classes.length === 0) return false; // not a class-based selector
  return classes.every(isFrameworkClass);
}

/**
 * v2.2.7 — BUG-10 follow-up. Strip framework-internal `.classname`
 * tokens from a CSS selector string, leaving everything else intact.
 *
 * The v2.2.6 fix prevented framework-ONLY selectors from being picked,
 * but a mixed selector like `.ng-untouched.search-input` still made it
 * through with the `.ng-untouched` token in place. Playwright's
 * `page.locator('.ng-untouched.search-input')` requires BOTH classes
 * simultaneously — so when the user types and Angular flips
 * `.ng-untouched` → `.ng-touched`, the locator stops matching. The
 * test fails on what should have been a stable user-named element.
 *
 * After stripping, callers should treat the result as the new selector
 * to emit. If stripping leaves nothing useful (`""` or just whitespace
 * combinators), the caller should fall through to the next priority
 * (xpath / tag-only).
 *
 * Implementation notes:
 *   - Only strips bare `.classname` tokens. `:not(.ng-foo)` and
 *     attribute selectors are left alone — they're rare and risky to
 *     rewrite.
 *   - Trims redundant whitespace introduced by the strip.
 */
export function stripFrameworkClasses(selector: string): string {
  // Replace `.ng-foo` (and the rest) with empty string. The class-token
  // regex matches `.` followed by an identifier, terminated by anything
  // that isn't a class-name char (so `.foo.bar` is two matches, not one).
  const out = selector.replace(
    /\.([a-zA-Z_][\w-]*)/g,
    (full, cls) => (isFrameworkClass(cls) ? "" : full),
  );
  // Collapse any whitespace produced by stripping.
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Synthesise a camelCase TS field name for an element.
 *
 * Priority order for the *base name*:
 *   0. CSS id when it matches STATUS_REGION_RE — special case so error
 *      banners get stable names regardless of their current text content.
 *   1. element.name (accessible name)
 *   2. element.label
 *   3. element.placeholder
 *   4. element.testId
 *   5. element.text (first 40 chars)
 *   6. CSS id from element.cssSelector (`#username` → `username`)
 *   7. CSS class from element.cssSelector (`.foo-bar` → `fooBar`)
 *   8. `<role|tag>Element` last resort
 *
 * Then appends a role-derived suffix if it's not already there:
 *   "username" + role:textbox → "usernameInput"
 *   "submit"   + role:button  → "submitButton"
 */
function synthFieldName(element: ElementIR): string {
  // 0. Status region special case
  const idDerived = cssSelectorToName(element.cssSelector);
  if (idDerived && STATUS_REGION_RE.test(idDerived)) {
    const cleaned = idDerived.replace(/[^a-zA-Z0-9 ]/g, " ").trim();
    return toJsIdentifier(camelCase(cleaned) || "errorRegion");
  }

  // v2.2.7 — track whether we had to fall through to the
  // `<role|tag>Element` last-resort base. If so, the base ALREADY
  // carries `Element` and we don't want to also append the role-suffix
  // ("inputElement" + "Input" = "inputElementInput" — ugly and
  // redundant). The previous endsWith check missed this because
  // `"inputelement".endsWith("input")` is false.
  const haveExplicitBase =
    element.name !== undefined ||
    element.label !== undefined ||
    element.placeholder !== undefined ||
    element.testId !== undefined ||
    element.text !== undefined ||
    idDerived !== undefined;

  const baseName =
    element.name ??
    element.label ??
    element.placeholder ??
    element.testId ??
    element.text?.slice(0, 40) ??
    idDerived ??
    `${element.role ?? element.tag}Element`;

  const cleaned = baseName.replace(/[^a-zA-Z0-9 ]/g, " ").trim();
  let fieldName = camelCase(cleaned) || "element";

  if (haveExplicitBase) {
    const suffix = roleToSuffix(element.role, element.tag);
    if (suffix && !fieldName.toLowerCase().endsWith(suffix.toLowerCase())) {
      fieldName += suffix;
    }
  }
  // v2.2.5 — BUG-9 guard: ensure the name is a valid JS identifier.
  // `camelCase("0 of 0")` returns "0Of0", which is not a legal
  // identifier and breaks the .spec.ts parse. Prefix digit-leading
  // names with `_` and strip any stray punctuation that survived
  // upstream normalisation (commas, etc.).
  return toJsIdentifier(fieldName);
}

/**
 * Best-effort name extraction from a CSS selector. Handles common shapes:
 *   #username                       → "username"
 *   .foo-bar                        → "foo bar"
 *   div#main                        → "main"
 *   a.wp-block-btn                  → "wp block btn"
 *   input.ng-untouched.search-input → "search input"   (v2.2.6)
 *
 * v2.2.6 — BUG-10. When the selector has multiple classes, skip
 * framework-internal classes (`ng-*`, `mat-*`, `cdk-*`, `mdc-*`,
 * `_ngcontent-*`, `_nghost-*`) and pick the first user-named class.
 * Without this filter, juice-shop's `.ng-untouched.search-input` gets
 * named "ng untouched" → `ngUntouchedInput`, which is a flaky state
 * locator and a confusing field name.
 *
 * If EVERY class is framework-internal, returns undefined so the caller
 * falls through to `<role|tag>Element` rather than naming the field
 * after a transient state class.
 *
 * Returns undefined for selectors with no usable id/class.
 */
function cssSelectorToName(selector: string | undefined): string | undefined {
  if (!selector) return undefined;
  // Prefer #id over .class
  const idMatch = selector.match(/#([a-zA-Z][\w-]*)/);
  if (idMatch) return idMatch[1].replace(/-/g, " ");
  // Walk all classes, return the first non-framework one.
  const classes = extractClasses(selector);
  for (const cls of classes) {
    if (!isFrameworkClass(cls)) return cls.replace(/-/g, " ");
  }
  // All classes were framework-internal — fall through to the caller's
  // next priority (typically `<role|tag>Element`).
  return undefined;
}

function roleToSuffix(role?: string, tag?: string): string {
  switch (role) {
    case "button":
      return "Button";
    case "link":
      return "Link";
    case "textbox":
    case "searchbox":
      return "Input";
    case "checkbox":
      return "Checkbox";
    case "radio":
      return "Radio";
    case "combobox":
    case "listbox":
      return "Select";
    case "heading":
      return "Heading";
    case "alert":
      return "Alert";
    case "img":
      return "Image";
    default:
      break;
  }
  switch (tag) {
    case "input":
      return "Input";
    case "select":
      return "Select";
    case "textarea":
      return "Textarea";
    case "a":
      return "Link";
    case "button":
      return "Button";
    default:
      return "";
  }
}

/**
 * Dedupe a list of locator choices.
 *
 *   1. **By locator identity (api + args).** When two `LocatorChoice`s
 *      resolve to the same Playwright call (e.g. a `<label>` and the
 *      `<input>` it labels both produce `getByLabel('Username')`), keep
 *      only the FIRST. Without this, the live scanner emits
 *      `username = page.getByLabel('Username')` AND
 *      `usernameInput = page.getByLabel('Username')` — two fields, one
 *      element, confusing for tests and noisy in the POM.
 *      The kept entry uses the LONGER fieldName when names differ —
 *      `usernameInput` is more useful than `username` because the
 *      step-matcher's preferredSuffix logic looks for `*Input`.
 *
 *   2. **By field name collision.** If two elements legitimately deserve
 *      different `LocatorChoice`s but happen to synthesise the same
 *      fieldName, suffix the later one with `2`, `3`, … so emitted TS
 *      stays valid.
 *
 * Stable-sorted by input order otherwise.
 */
export function dedupeLocators(choices: LocatorChoice[]): LocatorChoice[] {
  // Pass 1: collapse by locator identity. Picks the better field name.
  const byLocator = new Map<string, LocatorChoice>();
  for (const c of choices) {
    const key = `${c.api}::${c.args}`;
    const existing = byLocator.get(key);
    if (!existing) {
      byLocator.set(key, c);
      continue;
    }
    // Prefer the longer / more descriptive field name (usernameInput > username)
    if (c.fieldName.length > existing.fieldName.length) {
      byLocator.set(key, c);
    }
  }
  const collapsed = Array.from(byLocator.values());

  // Pass 2: resolve any remaining fieldName collisions with a numeric suffix.
  const seen = new Map<string, number>();
  const out: LocatorChoice[] = [];
  for (const c of collapsed) {
    const count = seen.get(c.fieldName) ?? 0;
    seen.set(c.fieldName, count + 1);
    if (count === 0) {
      out.push(c);
    } else {
      out.push({ ...c, fieldName: `${c.fieldName}${count + 1}` });
    }
  }
  return out;
}
