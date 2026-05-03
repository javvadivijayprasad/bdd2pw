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
