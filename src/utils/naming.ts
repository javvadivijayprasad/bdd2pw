/**
 * Naming helpers. Pure functions, fully unit-tested — these stabilise the
 * shape of emitted code and must not change behaviour without a snapshot
 * test bump.
 */

/** Convert any case to PascalCase. */
export function pascalCase(input: string): string {
  return splitWords(input)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

/** Convert any case to camelCase. */
export function camelCase(input: string): string {
  const pascal = pascalCase(input);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * v2.2.5 — coerce an arbitrary string into a valid TypeScript / JavaScript
 * identifier. Used by the POM field-name synthesiser so we never emit
 * code like `this.0Of0 = ...` (juice-shop pagination labels: "0 of 0",
 * "1 - 50 of 0") which makes the .spec.ts file refuse to parse.
 *
 * Rules:
 *   1. Strip any character that isn't `[A-Za-z0-9_$]`. Commas, hyphens,
 *      backticks, quotes, whitespace etc. all go.
 *   2. If what remains starts with a digit, prefix with a single `_`.
 *      JS identifier production: `IdentifierStart` = letter | `$` | `_`.
 *   3. If the result is empty, return a stable fallback "_field" so the
 *      caller never has to handle empty-string corner cases.
 *
 * Reserved-word avoidance is intentionally NOT handled here: at the
 * field-access site `obj.class` is fine (only top-level identifiers are
 * reserved). If we later add free-standing identifier emission (e.g. let
 * <name> = ...), revisit.
 */
export function toJsIdentifier(input: string): string {
  let s = input.replace(/[^A-Za-z0-9_$]/g, "");
  if (s.length > 0 && /^[0-9]/.test(s)) s = "_" + s;
  return s || "_field";
}

/** Convert any case to kebab-case. */
export function kebabCase(input: string): string {
  return splitWords(input).map((w) => w.toLowerCase()).join("-");
}

/** Convert any case to snake_case. */
export function snakeCase(input: string): string {
  return splitWords(input).map((w) => w.toLowerCase()).join("_");
}

/**
 * Convert a Page Object class name to its expected file path stem.
 * `LoginPage` → `login.page`
 */
export function pageObjectFileStem(className: string): string {
  const stripped = className.replace(/Page$/i, "");
  return `${kebabCase(stripped)}.page`;
}

/**
 * Convert a feature name to a spec file stem.
 * `User Login` → `user-login.spec`
 */
export function specFileStem(featureName: string): string {
  return `${kebabCase(featureName)}.spec`;
}

/** Split an arbitrary string into word tokens for case conversion. */
function splitWords(input: string): string[] {
  return input
    .replace(/[_\-\s]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}
