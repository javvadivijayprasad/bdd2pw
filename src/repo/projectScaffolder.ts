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
  /**
   * When true, wire runtime locator healing into the emitted repo.
   * v4.3.0+: default emission uses `@vijaypjavvadi/pw-self-heal` —
   * a `tests/fixtures.ts` is written that wraps `@playwright/test`
   * with `withSelfHealing(...)` and the emitted spec files import
   * `test` and `expect` from `../fixtures` instead of directly from
   * `@playwright/test`. No `lib/heal.ts` template, no tsconfig path
   * alias, no external service.
   *
   * When combined with `legacyHealing: true`, the v4.2 behaviour
   * (bundled `lib/heal.ts` template + tsconfig alias + external
   * `SELF_HEALING_URL` service) is emitted instead. Deprecated —
   * removed in v5.0.
   */
  selfHealing?: boolean;
  /**
   * v4.3.0 — ranker mode passed to `withSelfHealing({mode})` in the
   * emitted fixtures. Ignored when `legacyHealing: true`.
   */
  selfHealingMode?: "heuristic" | "ml" | "hybrid";
  /**
   * v4.3.0 — keep emitting the v4.2 `lib/heal.ts` + external service
   * shim. One-release deprecation window; will be removed in v5.0.
   */
  legacyHealing?: boolean;
  /**
   * v3.2.0 — pin emitted devDependency versions when set to `exact`.
   * Default `caret` matches existing behavior. See TestForge handoff
   * Issue 9 and pw-emit v1.3.0.
   */
  dependencyStrategy?: "caret" | "exact";
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
    dependencyStrategy: opts.dependencyStrategy,
  });

  const filesWritten = [...result.filesWritten];
  const warnings = [...result.warnings];

  if (opts.selfHealing) {
    if (opts.legacyHealing) {
      warnings.push({
        severity: "warn",
        message:
          "--legacy-healing emits the v4.2 bundled lib/heal.ts + external SELF_HEALING_URL service shim. This mode is deprecated and will be removed in v5.0.",
        suggestion:
          "Drop --legacy-healing to use the v4.3+ in-process @vijaypjavvadi/pw-self-heal integration (trained ONNX ranker, no server, no API key).",
      });
      await emitLegacyHealingScaffold(opts.repoRoot, filesWritten, warnings);
    } else {
      await emitPwSelfHealScaffold(
        opts.repoRoot,
        opts.selfHealingMode ?? "hybrid",
        filesWritten,
        warnings,
      );
    }
  }

  return {
    filesWritten,
    alreadyExisted,
    warnings,
  };
}

/**
 * v4.3.0+ — emit the pw-self-heal fixture wiring:
 *  - `tests/fixtures.ts` — re-exports `test`/`expect` with
 *    `withSelfHealing()` applied to the base test.
 *  - `.pwheal/.gitkeep` — placeholder so the telemetry directory exists
 *    on fresh clones (heal-events.jsonl is gitignored).
 *  - Append `@vijaypjavvadi/pw-self-heal` + optional `onnxruntime-node`
 *    to the emitted `package.json` devDependencies.
 *
 * All operations are idempotent — re-scaffold rewrites the fixture with
 * the currently-selected mode but never appends duplicates to
 * package.json. Existing `tests/fixtures.ts` is overwritten so mode
 * changes propagate. Downstream consumers that need a custom fixture
 * (extra beforeEach, storage state, etc.) can copy the emitted file
 * to a different path and update spec imports accordingly.
 */
async function emitPwSelfHealScaffold(
  repoRoot: string,
  mode: "heuristic" | "ml" | "hybrid",
  filesWritten: string[],
  warnings: ReviewItem[],
): Promise<void> {
  // 1) tests/fixtures.ts — the minimal wrapper.
  const testsDir = path.join(repoRoot, "tests");
  await fs.ensureDir(testsDir);
  const fixturesPath = path.join(testsDir, "fixtures.ts");
  const fixturesContent = renderPwSelfHealFixtures(mode);
  await fs.writeFile(fixturesPath, fixturesContent, "utf8");
  if (!filesWritten.includes(fixturesPath)) filesWritten.push(fixturesPath);

  // 2) .pwheal/.gitkeep so telemetry directory is committable.
  const pwhealDir = path.join(repoRoot, ".pwheal");
  await fs.ensureDir(pwhealDir);
  const gitkeep = path.join(pwhealDir, ".gitkeep");
  if (!(await fs.pathExists(gitkeep))) {
    await fs.writeFile(
      gitkeep,
      "# @vijaypjavvadi/pw-self-heal writes heal-events.jsonl here at test\n" +
        "# runtime. Files in this directory are intentionally excluded from\n" +
        "# version control via the project's .gitignore — only this\n" +
        "# placeholder is tracked so the directory exists on a fresh checkout.\n",
      "utf8",
    );
    filesWritten.push(gitkeep);
  }

  // 3) Append pw-self-heal + optional onnxruntime-node to package.json.
  const pkgPath = path.join(repoRoot, "package.json");
  if (await fs.pathExists(pkgPath)) {
    try {
      const pkgRaw = await fs.readFile(pkgPath, "utf8");
      const pkg = JSON.parse(pkgRaw);
      pkg.devDependencies ??= {};
      let mutated = false;
      if (!pkg.devDependencies["@vijaypjavvadi/pw-self-heal"]) {
        pkg.devDependencies["@vijaypjavvadi/pw-self-heal"] = "^1.1.2";
        mutated = true;
      }
      // onnxruntime-node is required only for `ml` and `hybrid` modes.
      // Emit it as optional so `mode: heuristic` users can drop it.
      if (
        (mode === "ml" || mode === "hybrid") &&
        !pkg.devDependencies["onnxruntime-node"]
      ) {
        pkg.devDependencies["onnxruntime-node"] = "^1.18.0";
        mutated = true;
      }
      if (mutated) {
        // Preserve trailing newline convention.
        const trailer = pkgRaw.endsWith("\n") ? "\n" : "";
        await fs.writeFile(
          pkgPath,
          JSON.stringify(pkg, null, 2) + trailer,
          "utf8",
        );
      }
    } catch {
      warnings.push({
        severity: "warn",
        message:
          "Could not append @vijaypjavvadi/pw-self-heal to package.json — file was malformed. Add it manually: `npm i -D @vijaypjavvadi/pw-self-heal onnxruntime-node`.",
      });
    }
  }
}

/**
 * Build the fixtures.ts contents.
 */
function renderPwSelfHealFixtures(
  mode: "heuristic" | "ml" | "hybrid",
): string {
  return [
    "/**",
    " * Generated by bdd2pw v4.3.0+ — self-healing test fixtures.",
    " *",
    " * Every scaffolded spec imports `test` and `expect` from this file",
    " * instead of `@playwright/test` directly. `withSelfHealing()` wraps",
    " * the base `test` so the `page` fixture heals broken locators at",
    " * runtime — POM classes need zero changes.",
    " *",
    " * Ranker mode: " + JSON.stringify(mode) + " — override via",
    " * `bdd2pw scaffold --self-healing-mode {heuristic|ml|hybrid}`.",
    " *",
    " * See https://www.npmjs.com/package/@vijaypjavvadi/pw-self-heal",
    " */",
    'import { test as base } from "@playwright/test";',
    'import { withSelfHealing } from "@vijaypjavvadi/pw-self-heal";',
    "",
    "export const test = withSelfHealing(base, { mode: " +
      JSON.stringify(mode) +
      " });",
    'export { expect } from "@playwright/test";',
    "",
  ].join("\n");
}

/**
 * v4.2 — legacy healing scaffold. Deprecated in v4.3, removed in v5.0.
 *
 * Add lib/heal.ts + tsconfig path alias + artefacts/.gitkeep when the
 * scaffold is run with --self-healing --legacy-healing. All three
 * operations are idempotent.
 */
async function emitLegacyHealingScaffold(
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
