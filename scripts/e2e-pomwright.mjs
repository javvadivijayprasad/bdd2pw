#!/usr/bin/env node
/**
 * v4.7.1 — attestqa POMWright review (POMWright#73 close, gate #2).
 *
 * E2E check that `--target=pomwright` produces output that compiles
 * against the real `pomwright` package. The v4.7.0 unit tests only
 * compared emitted strings against expected strings — this script
 * runs the full pipeline end-to-end:
 *
 *   1. Scaffold `examples/pomwright-login/` into a tmp directory
 *      with `--target=pomwright`.
 *   2. `npm install` in the output dir — pulls `pomwright` for real.
 *   3. `npx tsc --noEmit` — proves the emitted POM + spec compile
 *      against the real library's type definitions.
 *
 * Exits non-zero on any failure. Designed to run from `.github/workflows/release.yml`
 * on both Windows and Ubuntu in the `check` job.
 *
 * Intentionally does NOT run `npx playwright test` against a live
 * page — that would need chromium installed in CI and a static page
 * fixture. The TypeScript compile check is the cheapest cutpoint
 * that would have caught the v4.7.0 hierarchy-inference bug
 * (emitted `getByRole("form", { name: "Login" })` wouldn't have
 * MATCHED on a page, but IT DID compile, so this script alone
 * doesn't catch THAT specific bug — the hierarchy-inference unit
 * tests in `tests/unit/pomwrightEmitter.test.ts` do).
 *
 * Catches the bugs this script IS designed to catch:
 *   • Emitted TS doesn't compile because an import name is wrong.
 *   • Emitted TS uses a POMWright API that doesn't exist or changed.
 *   • Scaffolded package.json doesn't include `pomwright`.
 *   • Scaffolded tsconfig excludes the pages/tests dirs.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// v4.7.1 — `.pathname` on a file URL returns `/C:/...` on Windows (leading
// slash from URL encoding), which is NOT a valid Windows filesystem path.
// `fileURLToPath` handles the OS-specific conversion correctly on both
// platforms.
const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = dirname(dirname(__filename));
const FEATURE = join(REPO_ROOT, "examples", "pomwright-login", "login.feature");
const SNAPSHOT = join(REPO_ROOT, "examples", "pomwright-login", "snapshot.json");

const outDir = mkdtempSync(join(tmpdir(), "bdd2pw-e2e-pomwright-"));
console.log(`e2e-pomwright: output dir = ${outDir}`);

function run(cmd, args, opts = {}) {
  const pretty = `${cmd} ${args.join(" ")}`;
  console.log(`\n$ ${pretty}`);
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  if (r.status !== 0) {
    console.error(`e2e-pomwright: FAILED (exit ${r.status}): ${pretty}`);
    rmSync(outDir, { recursive: true, force: true });
    process.exit(r.status ?? 1);
  }
}

try {
  // 1. Scaffold the example with --target=pomwright
  run("node", [
    join(REPO_ROOT, "dist", "cli.js"),
    "scaffold",
    FEATURE,
    "--url",
    "https://practicetestautomation.com/practice-test-login/",
    "--page",
    "LoginPage",
    "--target=pomwright",
    "--snapshot-file",
    SNAPSHOT,
    "--repo",
    outDir,
  ]);

  // 2. Verify the expected files landed
  const mustExist = [
    "pages/login.page.ts",
    "tests/login.spec.ts",
    "package.json",
    "tsconfig.json",
  ];
  for (const rel of mustExist) {
    const full = join(outDir, rel);
    if (!existsSync(full)) {
      console.error(`e2e-pomwright: FAILED — expected file missing: ${rel}`);
      process.exit(1);
    }
  }
  console.log(`\ne2e-pomwright: all ${mustExist.length} expected files present`);

  // 3. Install dependencies (pulls real `pomwright` + `@playwright/test`)
  run("npm", ["install", "--no-audit", "--no-fund"], { cwd: outDir });

  // 4. Patch tsconfig moduleResolution if the scaffolder didn't already.
  //    `"node"` is the removed `node10` alias on TypeScript 5.5+; patch
  //    to `"node16"` (compatible with the template's `module: "commonjs"`
  //    — unlike `"bundler"` which needs `module: "esnext"`/`"preserve"`).
  const tsconfigPath = join(outDir, "tsconfig.json");
  if (existsSync(tsconfigPath)) {
    const raw = readFileSync(tsconfigPath, "utf8");
    if (/"moduleResolution"\s*:\s*"node"(?!(?:16|next))/.test(raw)) {
      const patched = raw.replace(
        /("moduleResolution"\s*:\s*)"node"(?!(?:16|next))/,
        '$1"node16"',
      );
      writeFileSync(tsconfigPath, patched, "utf8");
      console.log("e2e-pomwright: patched tsconfig moduleResolution node → node16");
    }
  }

  // 5. Typecheck — proves the emitted POM + spec compile against real pomwright
  run("npx", ["tsc", "--noEmit"], { cwd: outDir });

  console.log("\ne2e-pomwright: ✓ scaffold → install → tsc --noEmit all green");
} finally {
  // Cleanup — keep the dir on failure (handled by process.exit above
  // before we reach this block), otherwise tidy up.
  rmSync(outDir, { recursive: true, force: true });
}
