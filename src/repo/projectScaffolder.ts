/**
 * Project scaffolder — when the target repo lacks `playwright.config.ts`,
 * delegates to `@vijaypjavvadi/pw-emit`'s `emitProject()` to copy templates
 * into place so the emitted spec has a runnable home.
 *
 * `emitProject()` is itself idempotent — files that already exist are
 * left untouched. So calling this on a repo that already has a config
 * is a no-op + warnings.
 *
 * When `selfHealing` is enabled, additionally:
 *   - Copies `templates/heal.ts.tmpl` to `<repo>/lib/heal.ts`.
 *   - Patches `<repo>/tsconfig.json` to add a `paths` mapping
 *     `"@platform/sdk-self-healing": ["./lib/heal"]` so the POM's
 *     `import { healOrThrow } from "@platform/sdk-self-healing"` resolves
 *     to the local helper at compile and run time.
 *   - Ensures `<repo>/artefacts/.gitkeep` exists so the JSONL output
 *     directory is committable as an empty placeholder.
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
  /** When true, also write lib/heal.ts and patch tsconfig paths. */
  selfHealing?: boolean;
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

  const filesWritten = [...result.filesWritten];
  const warnings = [...result.warnings];

  if (opts.selfHealing) {
    await emitSelfHealingScaffold(opts.repoRoot, filesWritten, warnings);
  }

  return {
    filesWritten,
    alreadyExisted,
    warnings,
  };
}

/**
 * Add lib/heal.ts + tsconfig path alias + artefacts/.gitkeep when the
 * scaffold is run with --self-healing. All three operations are idempotent.
 */
async function emitSelfHealingScaffold(
  repoRoot: string,
  filesWritten: string[],
  warnings: ReviewItem[],
): Promise<void> {
  // 1) Copy heal.ts template -> lib/heal.ts
  // We resolve the template relative to this compiled module so it works
  // both in dev (src/repo/projectScaffolder.ts -> ../../templates) and in
  // the published package (dist/repo/projectScaffolder.js -> ../../templates).
  const candidates = [
    path.resolve(__dirname, "..", "..", "templates", "heal.ts.tmpl"),
    path.resolve(__dirname, "..", "..", "..", "templates", "heal.ts.tmpl"),
  ];
  let templatePath: string | undefined;
  for (const c of candidates) {
    if (await fs.pathExists(c)) {
      templatePath = c;
      break;
    }
  }
  const libDir = path.join(repoRoot, "lib");
  const healPath = path.join(libDir, "heal.ts");
  await fs.ensureDir(libDir);
  if (templatePath) {
    const contents = await fs.readFile(templatePath, "utf8");
    await fs.writeFile(healPath, contents, "utf8");
    filesWritten.push(healPath);
  } else {
    warnings.push({
      severity: "warn",
      message:
        "Could not locate heal.ts.tmpl in the package. " +
        "Generated POMs will fail to compile until lib/heal.ts is provided manually.",
      suggestion:
        "Reinstall @vijaypjavvadi/bdd2pw or copy templates/heal.ts.tmpl from the source repo.",
    });
  }

  // 2) Patch tsconfig.json — add paths mapping for @platform/sdk-self-healing
  const tsconfigPath = path.join(repoRoot, "tsconfig.json");
  if (await fs.pathExists(tsconfigPath)) {
    try {
      const raw = await fs.readFile(tsconfigPath, "utf8");
      // Naive JSON parse — the template doesn't use comments. If users have
      // hand-edited their tsconfig with comments, this loses them; for v1.1
      // that's an acceptable tradeoff (we only run on freshly-scaffolded
      // projects in the canonical flow).
      const tsconfig = JSON.parse(raw);
      tsconfig.compilerOptions = tsconfig.compilerOptions ?? {};
      tsconfig.compilerOptions.baseUrl = tsconfig.compilerOptions.baseUrl ?? ".";
      tsconfig.compilerOptions.paths = tsconfig.compilerOptions.paths ?? {};
      const existingMapping = tsconfig.compilerOptions.paths["@platform/sdk-self-healing"];
      if (
        !existingMapping ||
        !Array.isArray(existingMapping) ||
        !existingMapping.includes("./lib/heal")
      ) {
        tsconfig.compilerOptions.paths["@platform/sdk-self-healing"] = [
          "./lib/heal",
        ];
        // Make sure lib/ is included in compilation
        if (Array.isArray(tsconfig.include)) {
          if (!tsconfig.include.some((p: string) => p.startsWith("lib/"))) {
            tsconfig.include.push("lib/**/*.ts");
          }
        }
        await fs.writeFile(
          tsconfigPath,
          JSON.stringify(tsconfig, null, 2) + "\n",
          "utf8",
        );
      }
    } catch (err) {
      warnings.push({
        severity: "warn",
        message: `Failed to patch tsconfig.json with @platform/sdk-self-healing path alias: ${(err as Error).message}.`,
        suggestion:
          'Add "paths": { "@platform/sdk-self-healing": ["./lib/heal"] } to tsconfig.compilerOptions manually.',
      });
    }
  }

  // 3) artefacts/.gitkeep — so JSONL output dir lands as committable empty
  const artefactsDir = path.join(repoRoot, "artefacts");
  const gitkeep = path.join(artefactsDir, ".gitkeep");
  await fs.ensureDir(artefactsDir);
  if (!(await fs.pathExists(gitkeep))) {
    await fs.writeFile(
      gitkeep,
      "# This directory holds heal-events.jsonl, written by lib/heal.ts at\n" +
        "# test runtime. Files in this directory are intentionally excluded\n" +
        "# from version control via the project's .gitignore — only this\n" +
        "# placeholder is tracked so the directory exists on a fresh checkout.\n",
      "utf8",
    );
    filesWritten.push(gitkeep);
  }
}
