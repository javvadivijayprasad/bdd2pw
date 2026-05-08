/**
 * Flatten any string for safe embedding inside a single-line TS comment.
 *
 * Why this exists (v2.0.1):
 *   When the LLM fallback throws an error whose `.message` contains
 *   newlines (the classic case is the better-sqlite3 NODE_MODULE_VERSION
 *   mismatch — a 5-line stack trace), and that message gets embedded
 *   into a `// TODO: ...` comment, only the first line gets the `//`
 *   prefix. The remaining lines fall outside the comment and become
 *   parsed as TypeScript, producing `SyntaxError: Missing semicolon`.
 *   The .spec.ts file is unparseable; cucumber/playwright runs collect
 *   zero tests and report a build failure.
 *
 * Apply this anywhere user-supplied error messages, LLM provider
 * strings, or any other text from outside our control gets embedded
 * into emitted source.
 */

/**
 * Collapse newlines (and runs of whitespace around them) into a ` | `
 * separator, normalise CRLF → LF first, trim, return a single-line
 * string safe for embedding inside a `// ...` TS comment.
 *
 * Examples:
 *   "line1\nline2"               → "line1 | line2"
 *   "line1\r\n\r\nline3"         → "line1 | line3"
 *   "  hello  \n  world  "       → "hello   |   world"
 *   undefined                     → ""
 *   { foo: 1 }                    → "[object Object]"
 */
export function flattenForComment(s: unknown): string {
  return String(s ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " | ")
    .trim();
}
