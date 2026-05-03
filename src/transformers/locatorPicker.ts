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
import { camelCase } from "../utils/naming";

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

  // 6. CSS selector
  if (element.cssSelector) {
    return {
      api: "locator",
      args: JSON.stringify(element.cssSelector),
      fieldName,
      source: element,
      confidence: "fallback",
    };
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

  // Nothing usable — emit a tag-only locator and flag as fallback
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
    return camelCase(cleaned) || "errorRegion";
  }

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

  const suffix = roleToSuffix(element.role, element.tag);
  if (suffix && !fieldName.toLowerCase().endsWith(suffix.toLowerCase())) {
    fieldName += suffix;
  }
  return fieldName;
}

/**
 * Best-effort name extraction from a CSS selector. Handles common shapes:
 *   #username       → "username"
 *   .foo-bar        → "foo bar"
 *   div#main        → "main"
 *   a.wp-block-btn  → "wp block btn"
 * Returns undefined for selectors with no usable id/class.
 */
function cssSelectorToName(selector: string | undefined): string | undefined {
  if (!selector) return undefined;
  // Prefer #id over .class
  const idMatch = selector.match(/#([a-zA-Z][\w-]*)/);
  if (idMatch) return idMatch[1].replace(/-/g, " ");
  const classMatch = selector.match(/\.([a-zA-Z][\w-]*)/);
  if (classMatch) return classMatch[1].replace(/-/g, " ");
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
