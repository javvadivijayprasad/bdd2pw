/**
 * Project scaffolder — when the target repo lacks `playwright.config.ts`,
 * delegates to `@vijaypjavvadi/pw-emit`'s `emitProject()` to copy templates
 * into place so the emitted spec has a runnable home.
 *
 * `emitProject()` is itself idempotent — files that already exist are
 * left untouched. So calling this on a repo that already has a config
 * is a no-op + warnings.
 */

import * as fs from "fs-extra";
import * as path from "path";
import { emitProject } from "@vijaypjavvadi/pw-emit";
import type { ReviewItem } from "../types";

export interface ScaffoldProjectOptions {
  repoRoot: string;
  templatesDir?: string;
  /** Injected as `baseURL` in playwright.config.ts. */
  baseUrl?: string;
  /** Injected as `name` in package.json. */
  projectName?: string;
}

export interface ScaffoldProjectResult {
  filesWritten: string[];
  alreadyExisted: boolean;
  warnings: ReviewItem[];
}

export async function scaffoldProject(
  opts: ScaffoldProjectOptions,
): Promise<ScaffoldProjectResult> {
  const configPath = path.join(opts.repoRoot, "playwright.config.ts");
  const alreadyExisted = await fs.pathExists(configPath);

  const result = await emitProject({
    outDir: opts.repoRoot,
    templatesDir: opts.templatesDir,
    baseUrl: opts.baseUrl,
    projectName: opts.projectName,
  });

  return {
    filesWritten: result.filesWritten,
    alreadyExisted,
    warnings: result.warnings,
  };
}
