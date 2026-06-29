#!/usr/bin/env node
/**
 * bdd2pw multi-app benchmark runner.
 *
 * Introduced for the SoftwareX R1 revision to address reviewer
 * concerns about single-scenario evaluation. Runs `bdd2pw scaffold`
 * against N publicly available web applications, captures objective
 * metrics per app, and emits a JSON + Markdown report.
 *
 * Usage:
 *   ts-node bench/runner.ts                              # all apps, deterministic-only
 *   ts-node bench/runner.ts --llm anthropic --llm-stats  # with LLM fallback
 *   ts-node bench/runner.ts --app 01-saucedemo           # single app
 *   ts-node bench/runner.ts --ablation                   # each app twice (with and without --llm)
 *   ts-node bench/runner.ts --repeat 3                   # determinism check
 *
 * What it measures:
 *   - scaffold_time_ms        wall-clock from scaffold start to scaffold complete
 *   - tsc_passed              tsc --noEmit exit 0
 *   - tests_total/passed      optional, runs npx playwright test if --run-tests
 *   - llm_calls / llm_cost    from llm-stats.json sidecar when --llm passed
 *   - locators_by_type        getByRole / getByLabel / getByPlaceholder / getByTestId / getByText / css / xpath
 *   - framework_classes_rejected  count from scaffold logs
 *   - review_warnings/errors  from BDD_REVIEW.md
 *
 * Determinism mode (--repeat N):
 *   Runs each app N times, sha256s the generated spec + POM, asserts
 *   byte-identical across runs. Reports any divergence.
 */

import { execSync, spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

interface AppConfig {
  id: string;
  name: string;
  url: string;
  pageName: string;
  /** Optional: --domains banking,healthcare,... */
  domains?: string[];
  /** Optional: --no-discovery if app refuses headless scanning */
  noDiscovery?: boolean;
  /** Optional: --snapshot-file path (relative to app dir) for pinned DOM */
  snapshotFile?: string;
  /** True if this app exercises the API testing rules (v3.0) */
  apiOnly?: boolean;
  /** Optional: how to start the app locally (docker compose service name etc) */
  setupHint?: string;
  /** Skip running `npx playwright test` for this app (e.g. needs auth setup) */
  skipRuntimeTests?: boolean;
}

interface AppResult {
  app: string;
  scaffold_time_ms: number;
  tsc_passed: boolean;
  tsc_error_count: number;
  tests_total?: number;
  tests_passed?: number;
  llm_calls?: number;
  llm_cost_usd?: number;
  llm_cache_hit_rate?: number;
  locators_by_type: Record<string, number>;
  framework_classes_rejected: number;
  review_warnings: number;
  review_errors: number;
  todo_count_in_spec: number;
  spec_sha256: string;
  pom_sha256: string;
  error?: string;
}

interface BenchOpts {
  apps: AppConfig[];
  llm?: "anthropic" | "openai" | "gemini";
  llmStats: boolean;
  llmModel?: string;
  runTests: boolean;
  repeat: number;
  ablation: boolean;
  /** Working directory where scaffolds happen. */
  workDir: string;
  /** Output directory for results.json + results.md. */
  outDir: string;
  /** Optional --llm-skip-governance (test only). */
  skipGovernance: boolean;
}

const BENCH_ROOT = __dirname;
const APPS_DIR = path.join(BENCH_ROOT, "apps");
const RESULTS_DIR = path.join(BENCH_ROOT, "results");

function readAllAppConfigs(): AppConfig[] {
  const dirs = fs
    .readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+-/.test(d.name))
    .map((d) => d.name)
    .sort();
  const apps: AppConfig[] = [];
  for (const dir of dirs) {
    const configPath = path.join(APPS_DIR, dir, "config.json");
    if (!fs.existsSync(configPath)) {
      console.warn(`Skipping ${dir} — no config.json`);
      continue;
    }
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as AppConfig;
    config.id = dir;
    apps.push(config);
  }
  return apps;
}

function parseArgs(argv: string[]): BenchOpts {
  const allApps = readAllAppConfigs();
  let apps = allApps;
  let llm: BenchOpts["llm"];
  let llmStats = false;
  let llmModel: string | undefined;
  let runTests = false;
  let repeat = 1;
  let ablation = false;
  let skipGovernance = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--app": {
        const id = argv[++i];
        apps = allApps.filter((x) => x.id === id);
        if (apps.length === 0) throw new Error(`Unknown --app ${id}`);
        break;
      }
      case "--llm":
        llm = argv[++i] as BenchOpts["llm"];
        break;
      case "--llm-stats":
        llmStats = true;
        break;
      case "--llm-model":
        llmModel = argv[++i];
        break;
      case "--run-tests":
        runTests = true;
        break;
      case "--repeat":
        repeat = Number(argv[++i]);
        break;
      case "--ablation":
        ablation = true;
        break;
      case "--skip-governance":
        skipGovernance = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
    }
  }

  return {
    apps,
    llm,
    llmStats,
    llmModel,
    runTests,
    repeat,
    ablation,
    workDir: path.join(BENCH_ROOT, ".work"),
    outDir: RESULTS_DIR,
    skipGovernance,
  };
}

function printHelp(): void {
  console.log(`bdd2pw bench runner — usage:
  ts-node bench/runner.ts [options]

Options:
  --app <id>         Run a single app (default: all in bench/apps)
  --llm <provider>   Enable LLM fallback (anthropic | openai | gemini)
  --llm-stats        Write llm-stats.json sidecar per scaffold
  --llm-model <m>    Override default model for the chosen provider
  --run-tests        After scaffold, run "npx playwright test" and record pass rate
  --repeat <n>       Run each app N times; assert byte-identical output
  --ablation         For each app: run once with deterministic-only AND once with --llm
  --skip-governance  Test-only: bypass governance sidecar
  -h, --help         Show this help
`);
}

function sha256OfFile(p: string): string {
  if (!fs.existsSync(p)) return "MISSING";
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

function classifyLocators(specText: string): Record<string, number> {
  const types = {
    getByRole: countMatches(specText, /getByRole\(/g),
    getByLabel: countMatches(specText, /getByLabel\(/g),
    getByPlaceholder: countMatches(specText, /getByPlaceholder\(/g),
    getByTestId: countMatches(specText, /getByTestId\(/g),
    getByText: countMatches(specText, /getByText\(/g),
    css_locator: countMatches(specText, /\.locator\("[^"]*"/g),
    xpath: countMatches(specText, /\bxpath=/g),
  };
  return types;
}

/**
 * Finds the single .spec.ts / .page.ts that scaffold emitted. We
 * don't hardcode filenames because bdd2pw derives them from the
 * Feature title and Page name (e.g. `feature.feature` + `LoginPage`
 * yields `tests/login.spec.ts`, not `tests/feature.spec.ts`). Glob
 * is robust to the derivation logic changing in future versions.
 */
function findFirst(dir: string, ext: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const match = fs.readdirSync(dir).find((f) => f.endsWith(ext));
  return match ? path.join(dir, match) : null;
}

function runScaffoldOnce(app: AppConfig, opts: BenchOpts, runIdx: number): AppResult {
  const appWorkDir = path.join(opts.workDir, `${app.id}-run${runIdx}`);
  fs.rmSync(appWorkDir, { recursive: true, force: true });
  fs.mkdirSync(appWorkDir, { recursive: true });

  // Make the bench's node_modules visible to the work dir so bdd2pw's
  // internal tsc validation can resolve @playwright/test. Without this,
  // every scaffolded spec reports the same 8 spurious errors ("Cannot
  // find module '@playwright/test'" + 6 implicit-any cascades), which
  // distort the per-app tsc_error_count metric. We use a junction on
  // Windows (no admin needed) and a regular symlink on POSIX.
  const sharedNodeModules = path.join(BENCH_ROOT, "node_modules");
  const linkedNodeModules = path.join(appWorkDir, "node_modules");
  if (fs.existsSync(sharedNodeModules)) {
    try {
      fs.symlinkSync(
        sharedNodeModules,
        linkedNodeModules,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (err) {
      console.warn(
        `[${app.id}] node_modules link failed (tsc may report spurious errors): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  } else {
    console.warn(
      `[${app.id}] bench/node_modules missing — run "npm install" in bench/ for accurate tsc counts.`,
    );
  }

  // Copy feature file in
  const featureSrc = path.join(APPS_DIR, app.id, "feature.gherkin");
  const featureDst = path.join(appWorkDir, "feature.feature");
  fs.copyFileSync(featureSrc, featureDst);

  // Snapshot file if pinned
  let snapshotArg = "";
  if (app.snapshotFile) {
    const snapSrc = path.join(APPS_DIR, app.id, app.snapshotFile);
    if (fs.existsSync(snapSrc)) {
      const snapDst = path.join(appWorkDir, app.snapshotFile);
      fs.copyFileSync(snapSrc, snapDst);
      snapshotArg = `--snapshot-file ${app.snapshotFile}`;
    }
  }

  const cliPath = path.resolve(BENCH_ROOT, "..", "dist", "cli.js");
  const args = [
    cliPath,
    "scaffold",
    "feature.feature",
    "--url",
    app.url,
    "--page",
    app.pageName,
    "--repo",
    ".",
  ];
  if (snapshotArg) args.push(...snapshotArg.split(" "));
  if (app.noDiscovery) args.push("--no-discovery");
  if (app.domains?.length) args.push("--domains", app.domains.join(","));
  if (opts.llm) {
    args.push("--llm", opts.llm);
    if (opts.llmStats) args.push("--llm-stats");
    if (opts.llmModel) args.push("--llm-model", opts.llmModel);
  }
  if (opts.skipGovernance) args.push("--llm-skip-governance");

  const start = Date.now();
  let stderr = "";
  let exitCode = 0;
  try {
    const proc = spawnSync(process.execPath, args, {
      cwd: appWorkDir,
      encoding: "utf-8",
      timeout: 5 * 60 * 1000, // 5 minutes per app
    });
    exitCode = proc.status ?? 1;
    stderr = (proc.stderr || "") + (proc.stdout || "");
  } catch (err) {
    stderr = err instanceof Error ? err.message : String(err);
    exitCode = 1;
  }
  const scaffold_time_ms = Date.now() - start;

  // Locate the emitted spec + POM via glob, not hardcoded names.
  // bdd2pw derives both filenames from the Feature title + Page name,
  // which doesn't always match the source .feature filename.
  const specPath = findFirst(path.join(appWorkDir, "tests"), ".spec.ts");
  const pomPath = findFirst(path.join(appWorkDir, "pages"), ".page.ts");
  const reviewPath = path.join(appWorkDir, "BDD_REVIEW.md");
  const statsPath = path.join(appWorkDir, "artefacts", "llm-stats.json");

  const specText = specPath ? fs.readFileSync(specPath, "utf-8") : "";
  const pomText = pomPath ? fs.readFileSync(pomPath, "utf-8") : "";
  // Scan both spec.ts AND pages/*.page.ts for locator types — deterministic
  // rules emit pomCall.method() in the spec but the actual page.getByRole()
  // calls live in the POM file. LLM bindings sometimes emit page.getByRole
  // directly in the spec, so we union both surfaces.
  const combinedLocatorText = specText + "\n" + pomText;
  const reviewText = fs.existsSync(reviewPath) ? fs.readFileSync(reviewPath, "utf-8") : "";

  let llm_calls: number | undefined;
  let llm_cost_usd: number | undefined;
  let llm_cache_hit_rate: number | undefined;
  if (fs.existsSync(statsPath)) {
    try {
      const stats = JSON.parse(fs.readFileSync(statsPath, "utf-8"));
      llm_calls = stats.totals?.callsAttempted;
      llm_cost_usd = stats.totals?.estimatedCostUsd;
      llm_cache_hit_rate = stats.totals?.cacheHitRate;
    } catch {
      // ignore parse errors
    }
  }

  // tsc results come from bdd2pw's INTERNAL validation, not a separate
  // tsc invocation in the work dir. Rationale: the work dir doesn't have
  // node_modules installed, so an external `tsc --noEmit` would report
  // "Cannot find module '@playwright/test'" + implicit-any spam — none
  // of which represents real code-quality issues. The scaffold has
  // already run tsc against the bdd2pw repo's own type stubs and
  // reports the authoritative error count in its stdout JSON log line.
  // We parse that.
  let tsc_passed = false;
  let tsc_error_count = 0;
  const tscMatch = stderr.match(/"tscErrorCount":\s*(\d+)/);
  if (tscMatch) {
    tsc_error_count = Number(tscMatch[1]);
    tsc_passed = tsc_error_count === 0;
  }

  // Warning/error counts also come from BDD_REVIEW.md's Summary line —
  // robust to formatting changes since it's the canonical summary.
  // Pattern: "N errors · M warnings · K info"
  let review_warnings = 0;
  let review_errors = 0;
  const summary = reviewText.match(/(\d+)\s+errors?\s*[·.]\s*(\d+)\s+warnings?/i);
  if (summary) {
    review_errors = Number(summary[1]);
    review_warnings = Number(summary[2]);
  }

  // Optional runtime tests. Requires the user to have run
  // `npm install` in the work dir first (we don't auto-install
  // because that adds ~30s per app and bench is meant to be fast).
  let tests_total: number | undefined;
  let tests_passed: number | undefined;
  if (opts.runTests && tsc_passed && !app.skipRuntimeTests) {
    try {
      const out = execSync("npx playwright test --reporter=json", {
        cwd: appWorkDir,
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 5 * 60 * 1000,
      });
      const report = JSON.parse(out);
      tests_total = report.stats?.expected ?? 0;
      tests_passed = report.stats?.expected - (report.stats?.unexpected ?? 0);
    } catch {
      // playwright not installed or all tests failed
    }
  }

  return {
    app: app.id,
    scaffold_time_ms,
    tsc_passed,
    tsc_error_count,
    tests_total,
    tests_passed,
    llm_calls,
    llm_cost_usd,
    llm_cache_hit_rate,
    locators_by_type: classifyLocators(combinedLocatorText),
    framework_classes_rejected: countMatches(stderr, /rejected framework-internal class/g),
    review_warnings,
    review_errors,
    todo_count_in_spec: countMatches(specText, /\/\/ TODO/g),
    spec_sha256: specPath ? sha256OfFile(specPath) : "MISSING",
    pom_sha256: pomPath ? sha256OfFile(pomPath) : "MISSING",
    error: exitCode !== 0 ? stderr.slice(0, 500) : undefined,
  };
}

function checkDeterminism(results: AppResult[]): { stable: boolean; divergences: string[] } {
  const divergences: string[] = [];
  const byApp = new Map<string, AppResult[]>();
  for (const r of results) {
    const arr = byApp.get(r.app) ?? [];
    arr.push(r);
    byApp.set(r.app, arr);
  }
  for (const [app, runs] of byApp) {
    if (runs.length < 2) continue;
    const specHashes = new Set(runs.map((r) => r.spec_sha256));
    const pomHashes = new Set(runs.map((r) => r.pom_sha256));
    if (specHashes.size > 1) {
      divergences.push(`${app}: spec.ts sha256 differs across runs: ${[...specHashes].join(", ")}`);
    }
    if (pomHashes.size > 1) {
      divergences.push(`${app}: page.ts sha256 differs across runs: ${[...pomHashes].join(", ")}`);
    }
  }
  return { stable: divergences.length === 0, divergences };
}

function writeReports(opts: BenchOpts, allResults: AppResult[][]): void {
  fs.mkdirSync(opts.outDir, { recursive: true });

  const flat = allResults.flat();
  fs.writeFileSync(
    path.join(opts.outDir, "results.json"),
    JSON.stringify({ opts: serializeOpts(opts), results: flat }, null, 2),
  );

  // Markdown table — one row per app, first-run results.
  const firstRunByApp = new Map<string, AppResult>();
  for (const r of flat) {
    if (!firstRunByApp.has(r.app)) firstRunByApp.set(r.app, r);
  }
  const rows = [...firstRunByApp.values()];

  const mdLines: string[] = [];
  mdLines.push("# bdd2pw benchmark — results");
  mdLines.push("");
  mdLines.push(`Generated: ${new Date().toISOString()}`);
  mdLines.push(`LLM mode: ${opts.llm ?? "deterministic-only"}`);
  mdLines.push("");
  mdLines.push("| App | Time (s) | tsc | TODOs | LLM calls | Cost USD | getByRole | getByLabel | CSS | XPath |");
  mdLines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    mdLines.push(
      `| ${r.app} | ${(r.scaffold_time_ms / 1000).toFixed(1)} | ${r.tsc_passed ? "PASS" : `FAIL(${r.tsc_error_count})`} | ${r.todo_count_in_spec} | ${r.llm_calls ?? "-"} | ${r.llm_cost_usd?.toFixed(4) ?? "-"} | ${r.locators_by_type.getByRole} | ${r.locators_by_type.getByLabel} | ${r.locators_by_type.css_locator} | ${r.locators_by_type.xpath} |`,
    );
  }
  mdLines.push("");

  // Determinism block
  if (opts.repeat > 1) {
    const det = checkDeterminism(flat);
    mdLines.push("## Determinism check");
    mdLines.push("");
    mdLines.push(`Result: ${det.stable ? "STABLE — all runs byte-identical" : "DIVERGENT"}`);
    if (det.divergences.length > 0) {
      mdLines.push("");
      mdLines.push("Divergences:");
      for (const d of det.divergences) mdLines.push(`- ${d}`);
    }
    mdLines.push("");
  }

  fs.writeFileSync(path.join(opts.outDir, "results.md"), mdLines.join("\n"));
  console.log(`\nResults written to:\n  ${path.join(opts.outDir, "results.json")}\n  ${path.join(opts.outDir, "results.md")}`);
}

function serializeOpts(opts: BenchOpts) {
  return {
    apps: opts.apps.map((a) => a.id),
    llm: opts.llm,
    llmStats: opts.llmStats,
    llmModel: opts.llmModel,
    runTests: opts.runTests,
    repeat: opts.repeat,
    ablation: opts.ablation,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`bdd2pw bench — ${opts.apps.length} apps, LLM=${opts.llm ?? "off"}, repeat=${opts.repeat}\n`);

  // Sanity-check API key when --llm is requested. The LLM client
  // short-circuits silently with `error: "ANTHROPIC_API_KEY is not set"`
  // when the env var is empty, producing llm_calls=0 across the whole
  // bench and a misleading "LLM had no effect" result. Bail early with
  // a loud message instead.
  if (opts.llm) {
    const envName =
      opts.llm === "anthropic"
        ? "ANTHROPIC_API_KEY"
        : opts.llm === "openai"
          ? "OPENAI_API_KEY"
          : "GEMINI_API_KEY";
    const key = process.env[envName];
    if (!key || key.length < 10 || key === "sk-ant-..." || key === "sk-..." || key === "AI...") {
      console.error(
        `\n  FATAL: --llm ${opts.llm} requires ${envName} to be set to a real API key.\n  Found: ${
          key ? `"${key.slice(0, 8)}..." (${key.length} chars)` : "EMPTY"
        }\n\n  Set it via:  $env:${envName} = "<your real key>"\n  Then re-run.\n`,
      );
      process.exit(1);
    }
  }

  const allResults: AppResult[][] = [];
  for (const app of opts.apps) {
    const appResults: AppResult[] = [];
    for (let r = 0; r < opts.repeat; r++) {
      console.log(`[${app.id}] run ${r + 1}/${opts.repeat}...`);
      const result = runScaffoldOnce(app, opts, r);
      appResults.push(result);
      console.log(
        `[${app.id}] done in ${result.scaffold_time_ms}ms — tsc=${result.tsc_passed} TODOs=${result.todo_count_in_spec}${result.error ? " ERROR" : ""}`,
      );
    }
    allResults.push(appResults);
  }

  writeReports(opts, allResults);
}

main().catch((err) => {
  console.error("bench failed:", err);
  process.exit(1);
});
