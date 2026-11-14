/**
 * v4.7.0 — POMWright POM scanner (PoC gap #1 close-out). Parses an
 * existing POMWright-shape Page Object file into the same
 * `PageObjectIR` shape the classic repo scanner produces, so the
 * AUGMENT path treats POMWright POMs as first-class input and doesn't
 * destroy them on re-scaffold.
 *
 * What we parse out of a POMWright POM:
 *   - the class name (`export class LoginPage extends PageObject<Paths>`)
 *   - the super(...) call args: baseUrl + urlPath
 *   - every `this.add("<path>").<api>(<args>);` registration from the
 *     `defineLocators()` body, mapped back to a `LocatorChoice` with
 *     the dotted path encoded in `fieldName`.
 *   - every `@step()`-decorated async method on the class (preserved
 *     verbatim via `PomMethodIR`).
 *
 * What we DON'T parse yet (deferred — flagged as unparseable):
 *   - `getLocatorSchema(path).filter(...)` chains inside method bodies —
 *     these are preserved verbatim as method `body` but not round-tripped.
 *   - Shared-locator imports (`import { registerMain } from './_shared/main'`).
 *   - Session-storage schema arguments to `super(...)`.
 *
 * Mirrors `src/repo/repoScanner.ts` in its contract (returns the same
 * `RepoScanResult.unparseableFieldNames` for anything the regex
 * couldn't decode, so the attestqa v4.5.x safety nets (P0-1 REUSE
 * no-op, P0-3 unparseable → missing, P0-4 spec-reference guard) all
 * apply unchanged.
 */

import type { LocatorChoice, PageObjectIR, PomMethodIR } from "../types";

/**
 * Parse a POMWright POM file's source text into IR.
 *
 * Returns `undefined` when the file doesn't look like a POMWright POM
 * at all (no `extends PageObject<` substring); the caller then falls
 * back to the classic scanner.
 */
export function parsePomwrightSource(
  source: string,
  filePath: string,
): { pom: PageObjectIR; unparseableFieldNames: string[] } | undefined {
  if (!/extends\s+PageObject\s*</.test(source)) return undefined;

  // 1. Class name
  const classMatch = source.match(
    /export\s+class\s+([A-Z][A-Za-z0-9_$]*)\s+extends\s+PageObject</,
  );
  if (!classMatch) return undefined;
  const className = classMatch[1];

  // 2. super(page, baseUrl, path [, options]) arguments
  //    `super(page, "https://example.com", "/login")` or with { sessionStorage }.
  const superMatch = source.match(
    /super\s*\(\s*page\s*,\s*(["'])([^"']+)\1\s*,\s*(["'])([^"']+)\3/,
  );
  const baseUrl = superMatch?.[2];
  const urlPath = superMatch?.[4];
  const url = baseUrl && urlPath ? baseUrl.replace(/\/$/, "") + urlPath : undefined;

  // 3. Parse every `this.add("<path>").<api>(<args>);` line inside
  //    defineLocators(). We scope the search to just that method body
  //    so stray `.add(` calls elsewhere (unlikely but possible) are
  //    ignored.
  const defineMatch = source.match(
    /protected\s+defineLocators\s*\(\s*\)\s*:\s*void\s*\{([\s\S]*?)\n\s*\}/,
  );
  const defineBody = defineMatch?.[1] ?? "";

  const fields: LocatorChoice[] = [];
  const unparseable: string[] = [];

  // Match `this.add("<path>").<api>(<args>);` — tolerant of multi-line
  // args by taking everything up to the terminating `);\n`.
  const addRe =
    /this\.add\s*\(\s*(["'])([^"']+)\1\s*\)\s*\.([A-Za-z_$][\w$]*)\s*\(([\s\S]*?)\)\s*;/g;
  let m: RegExpExecArray | null;
  const seenPaths = new Set<string>();
  while ((m = addRe.exec(defineBody)) !== null) {
    const path = m[2];
    const api = m[3];
    const args = m[4].trim();
    if (seenPaths.has(path)) continue;
    seenPaths.add(path);

    const allowedApis = new Set([
      "getByRole",
      "getByLabel",
      "getByPlaceholder",
      "getByTestId",
      "getByText",
      "getByAltText",
      "getByTitle",
      "locator",
    ]);
    const confidence: LocatorChoice["confidence"] = allowedApis.has(api)
      ? "unique"
      : "unparseable";
    if (confidence === "unparseable") unparseable.push(path);

    fields.push({
      api: api as LocatorChoice["api"],
      args,
      // The POMWright path IS the field identity for this scanner; the
      // emitter's rendering step names Paths by the path string directly.
      // `fieldName` here is the full dotted path so the AUGMENT
      // comparison ("is this path referenced by any step?") works
      // against the POMWright path vocabulary.
      fieldName: path,
      source: { tag: "" },
      confidence,
    });
  }

  // 4. Extract each `@step()`-decorated async method body. Preserved as
  //    an opaque `PomMethodIR` so re-emit doesn't lose hand-written
  //    helper code. Matches:
  //      @step()
  //      async scenarioX(): Promise<void> { ... }
  const methods: PomMethodIR[] = [];
  const methodRe =
    /@step\s*\(\s*\)\s*\n?\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(([\s\S]*?)\)\s*:\s*Promise\s*<\s*[^>]+>\s*\{([\s\S]*?)\n\s*\}/g;
  let mm: RegExpExecArray | null;
  while ((mm = methodRe.exec(source)) !== null) {
    methods.push({
      name: mm[1],
      params: [], // param parsing is best-effort; preserve the body verbatim
      body: mm[3].trim(),
      // "existing" marks a method we scanned from disk — the AUGMENT
      // path preserves it verbatim rather than re-synthesising.
      origin: "existing",
    });
  }

  const pom: PageObjectIR = {
    className,
    filePath,
    url,
    fields,
    methods,
    exists: true,
  };

  return { pom, unparseableFieldNames: unparseable };
}
