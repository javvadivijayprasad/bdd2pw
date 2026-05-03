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
}

export async function scanRepo(repoRoot: string): Promise<RepoScanResult> {
  const pageObjects = new Map<string, PageObjectIR>();
  const hasPlaywrightConfig = await fs.pathExists(
    path.join(repoRoot, "playwright.config.ts"),
  );

  const pagesDir = path.join(repoRoot, "pages");
  if (!(await fs.pathExists(pagesDir))) {
    return { repoRoot, hasPlaywrightConfig, pageObjects };
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

      const fields: LocatorChoice[] = cls
        .getProperties()
        .filter((p) => {
          const t = p.getType().getText();
          // Heuristic: keep `Locator` typed fields; skip `Page`, `string`, etc.
          return t.includes("Locator");
        })
        .map((p) => parseLocatorField(p.getName(), p.getInitializer()?.getText()));

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

  return { repoRoot, hasPlaywrightConfig, pageObjects };
}

/**
 * Parse a class field initialiser like
 *   `page.getByRole('button', { name: 'Sign in' })`
 * back into a `LocatorChoice`. Best-effort — we mainly need the
 * `fieldName` for the resolver's "is this field present?" check; the
 * `api`/`args` are advisory.
 */
function parseLocatorField(fieldName: string, init?: string): LocatorChoice {
  const fallback: LocatorChoice = {
    api: "locator",
    args: '""',
    fieldName,
    source: { tag: "" },
    confidence: "fallback",
  };
  if (!init) return fallback;

  const m = init.match(
    /(?:this\.)?page\.(getByRole|getByLabel|getByPlaceholder|getByTestId|getByText|locator)\s*\(([\s\S]*)\)\s*;?\s*$/,
  );
  if (!m) return fallback;

  return {
    api: m[1] as LocatorChoice["api"],
    args: m[2].trim(),
    fieldName,
    source: { tag: "" },
    confidence: "unique",
  };
}
