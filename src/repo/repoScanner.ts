/**
 * Repo scanner — reads `pages/*.page.ts` via `ts-morph` and builds a map of
 * existing Page Object classes (fields + methods) so the resolver can
 * decide reuse / augment / create.
 *
 * What it extracts per class:
 *   - className
 *   - field names + their initialiser locator expression (best-effort, so
 *     pomResolver can decide presence; not used for re-emission)
 *   - method names + parameter signatures + raw body
 *
 * Out of scope: detecting decorators, generic constraints, inherited fields.
 * Augment-mode emission preserves whole methods verbatim (origin: 'existing').
 */

import * as fs from "fs-extra";
import * as path from "path";
import { Project } from "ts-morph";
import type { LocatorChoice, PageObjectIR, PomMethodIR } from "../types";

export interface RepoScanResult {
  repoRoot: string;
  hasPlaywrightConfig: boolean;
  pageObjects: Map<string, PageObjectIR>;
  /**
   * v4.5.1 — field names on existing POMs whose initialiser couldn't be
   * parsed into a `LocatorChoice` (wrapped in a custom factory,
   * multi-line, etc.). The resolver should still treat these as
   * "present" (so AUGMENT doesn't try to re-create them), but the
   * emitter MUST NOT regenerate them from the IR — they'd become
   * `page.locator("")`. Keyed by class name.
   */
  unparseableFieldNames: Map<string, string[]>;
}

export async function scanRepo(repoRoot: string): Promise<RepoScanResult> {
  const pageObjects = new Map<string, PageObjectIR>();
  // v4.5.1 — track per-class field names whose initialiser didn't parse.
  const unparseableFieldNames = new Map<string, string[]>();
  const hasPlaywrightConfig = await fs.pathExists(
    path.join(repoRoot, "playwright.config.ts"),
  );

  const pagesDir = path.join(repoRoot, "pages");
  if (!(await fs.pathExists(pagesDir))) {
    return {
      repoRoot,
      hasPlaywrightConfig,
      pageObjects,
      unparseableFieldNames,
    };
  }

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false, noEmit: true, target: 99 /* ESNext */ },
  });
  project.addSourceFilesAtPaths(path.join(pagesDir, "*.page.ts"));

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath().toString();
    for (const cls of sourceFile.getClasses()) {
      const className = cls.getName();
      if (!className) continue;

      // v4.5.1 — parseLocatorField now returns undefined when the field's
      // initialiser doesn't match the expected `page.<api>(...)` shape.
      // We separate parseable fields (into `fields`, which pw-emit
      // regenerates verbatim) from unparseable ones (names only, into
      // `localUnparseable` — the resolver treats them as present but
      // the emitter must NOT regenerate them).
      const localUnparseable: string[] = [];
      const fields: LocatorChoice[] = [];
      for (const p of cls.getProperties()) {
        const t = p.getType().getText();
        if (!t.includes("Locator")) continue;
        const name = p.getName();
        const parsed = parseLocatorField(name, p.getInitializer()?.getText());
        if (parsed) {
          fields.push(parsed);
        } else {
          localUnparseable.push(name);
          // v4.5.1 — add a confidence:"unparseable" placeholder so the
          // resolver's "is this field present?" check still succeeds
          // on AUGMENT. The emitter filters these before handing the
          // IR to pw-emit (which would otherwise regenerate them as
          // `page.locator("")`).
          fields.push({
            api: "locator",
            args: '""',
            fieldName: name,
            source: { tag: "" },
            confidence: "unparseable",
          });
        }
      }
      if (localUnparseable.length > 0) {
        unparseableFieldNames.set(className, localUnparseable);
      }

      const methods: PomMethodIR[] = cls.getMethods().map((m) => {
        const params = m.getParameters().map((p) => ({
          name: p.getName(),
          type: p.getType().getText() || "unknown",
        }));
        const body = m.getBodyText() ?? "";
        return {
          name: m.getName(),
          params,
          body,
          origin: "existing" as const,
        };
      });

      pageObjects.set(className, {
        className,
        filePath,
        fields,
        methods,
        exists: true,
      });
    }
  }

  return {
    repoRoot,
    hasPlaywrightConfig,
    pageObjects,
    unparseableFieldNames,
  };
}

/**
 * Parse a class field initialiser like
 *   `page.getByRole('button', { name: 'Sign in' })`
 * back into a `LocatorChoice`.
 *
 * v4.5.1 — returns `undefined` when the initialiser doesn't match the
 * expected `page.<api>(...)` shape (e.g. the field was wrapped in
 * `withSelfHealing(...)`, `healOrThrow(...)`, or any custom factory).
 * Previously this returned a `LocatorChoice` with `args: '""'` — which,
 * on an AUGMENT re-scaffold, caused pw-emit to re-emit the field as
 * `page.locator("")` (Playwright can't parse an empty selector).
 * attestqa Bug B dated 2026-10-11: Juice Shop lost 41 of 53 hand-
 * maintained locators this way.
 *
 * Callers must handle the `undefined` return by:
 *   (a) still counting the field as "present" for the resolver's
 *       "is this field used?" check (its name is known), and
 *   (b) NOT including it in the IR passed to pw-emit's emitter, OR
 *       passing the raw file text through so emit-time augment
 *       preserves the original line.
 */
function parseLocatorField(
  fieldName: string,
  init?: string,
): LocatorChoice | undefined {
  if (!init) return undefined;
  const m = init.match(
    /(?:this\.)?page\.(getByRole|getByLabel|getByPlaceholder|getByTestId|getByText|locator)\s*\(([\s\S]*)\)\s*;?\s*$/,
  );
  if (!m) return undefined;
  const args = m[2].trim();
  // Even when the regex matched, defend against the degenerate empty
  // or whitespace-only args case. Treat it as unparseable.
  if (args.length === 0 || args === '""' || args === "''") return undefined;
  return {
    api: m[1] as LocatorChoice["api"],
    args,
    fieldName,
    source: { tag: "" },
    confidence: "unique",
  };
}
