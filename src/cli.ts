#!/usr/bin/env node
/**
 * Commander CLI entry. Thin shell over `src/index.ts`.
 * See docs/SCOPE.md §8.
 */

import { Command } from "commander";
import * as path from "path";
import { scaffold, analyze, updatePom } from "./index";
import { proposeRules } from "./llm";
import { analyseHealStats } from "./reports/healStats";
import { logger } from "./utils/logger";

const program = new Command();

program
  .name("bdd2pw")
  .description(
    "Scaffold runnable Playwright TypeScript tests from Gherkin .feature files.",
  )
  .version(require("../package.json").version);

program
  .command("scaffold")
  .description(
    "Read a .feature file + URL, emit Page Objects + spec into a Playwright TS repo.",
  )
  .argument("<feature>", "Path to a Gherkin .feature file")
  .requiredOption("--url <url>", "URL of the page under test")
  .requiredOption("--page <Name>", "Page Object class name (PascalCase)")
  .requiredOption("--repo <dir>", "Target Playwright TS repo (created if missing)")
  .option("--pages <list>", "Comma-separated list of additional Page Object names")
  .option("--storage-state <path>", "Pre-authenticated storage state JSON")
  .option("--headed", "Show browser during MCP scan", false)
  .option("--snapshot-file <path>", "Read elements from a JSON file instead of launching a browser")
  .option(
    "--no-discovery",
    "Skip page discovery entirely (rule-only probing). Field-referencing rules will fall to TODO.",
  )
  .option("--llm <provider>", "Enable LLM fallback for unmatched steps. v3.12.0: 'anthropic', 'openai', or 'gemini'.")
  .option(
    "--governance-url <url>",
    "ai-governance sidecar URL — every prompt is sanitised here before leaving the perimeter (fail-closed).",
    "http://localhost:4900",
  )
  .option("--llm-model <model>", "Override the LLM model. Defaults: anthropic→claude-sonnet-4-6, openai→gpt-4o-mini, gemini→gemini-2.5-flash.")
  .option("--llm-max-calls <n>", "Max LLM provider calls per scaffold. Default 50. Cache hits don't count.", "50")
  .option("--llm-cache <path>", "SQLite cache path. Default <repo>/.bdd2pw/llm-cache.sqlite. Use ':memory:' for one-shot.")
  .option("--llm-skip-governance", "DO NOT USE in production — bypass the sidecar sanitisation step. Test-only escape hatch.", false)
  .option("--llm-step-timeout-ms <n>", "v2.2.0 — per-step deadline (ms). On expiry the step lands as TODO and the scaffold proceeds. Default 60000.", "60000")
  .option("--llm-provider-timeout-ms <n>", "v2.2.0 — Anthropic SDK per-call timeout (ms). Default 30000.", "30000")
  .option("--llm-governance-timeout-ms <n>", "v2.2.0 — governance /sanitize timeout (ms). Default 15000.", "15000")
  .option("--templates <dir>", "Override default project template directory")
  .option("--dry-run", "Print plan, write nothing", false)
  .option("--no-validate", "Skip tsc --noEmit step")
  .option("--telemetry", "Enable local SQLite failure telemetry", false)
  .option("--force", "Overwrite existing spec files", false)
  .option(
    "--self-healing",
    "Wrap emitted locators in healOrThrow() and generate lib/heal.ts + tsconfig path alias. Locator events are logged to artefacts/heal-events.jsonl for the offline self-heal pipeline. Action-time healing is v1.2.",
    false,
  )
  .option(
    "--llm-stats",
    "v3.9.0 — write <repo>/artefacts/llm-stats.json with per-call latency, token counts, cache hit rate, and estimated cost.",
    false,
  )
  // v4.0.0 — data-driven Examples injection.
  .option(
    "--data <path>",
    "v4.0.0 — load CSV / JSON / XLSX file and inject rows into every Scenario Outline's Examples table. Inline Examples are overridden when this is set. Failures fall back to inline Examples + warn in BDD_REVIEW.md.",
  )
  .option(
    "--gen-data",
    "v4.0.0 — generate synthetic Examples rows via Faker + LLM. Requires --schema. Combine with --rows to set row count.",
    false,
  )
  .option(
    "--schema <path>",
    "v4.0.0 — JSON schema for --gen-data. Object of {column: source} where source is 'faker.X.Y', 'llm:<prompt>', or a literal string.",
  )
  .option(
    "--rows <n>",
    "v4.0.0 — row count for --gen-data. Default 20.",
    "20",
  )
  .option(
    "--seed <n>",
    "v4.0.0 — Faker RNG seed for --gen-data reproducibility. Default 42.",
    "42",
  )
  .action(async (feature: string, opts) => {
    try {
      // v2.0 — wire the actual LLM config when --llm is passed. The legacy
      // top-level `llm` field stays for backwards compat; `llmConfig` is the
      // real one used by scaffold(). v3.11.0 — accept openai too.
      const llmProvider =
        opts.llm === "anthropic" || opts.llm === "openai" || opts.llm === "gemini"
          ? opts.llm
          : null;
      const llmConfig = llmProvider
        ? ({
              provider: llmProvider as "anthropic" | "openai" | "gemini",
              model: opts.llmModel,
              governanceUrl: opts.governanceUrl,
              maxCalls: opts.llmMaxCalls
                ? Number(opts.llmMaxCalls)
                : undefined,
              cachePath: opts.llmCache,
              skipGovernance: opts.llmSkipGovernance,
              // v2.2.0 timeouts.
              stepTimeoutMs: opts.llmStepTimeoutMs
                ? Number(opts.llmStepTimeoutMs)
                : undefined,
              providerTimeoutMs: opts.llmProviderTimeoutMs
                ? Number(opts.llmProviderTimeoutMs)
                : undefined,
              governanceTimeoutMs: opts.llmGovernanceTimeoutMs
                ? Number(opts.llmGovernanceTimeoutMs)
                : undefined,
            })
        : undefined;
      // v4.0.0 — warn if user passed both data sources. --data wins.
      if (opts.data && opts.genData) {
        console.warn(
          "[bdd2pw] both --data and --gen-data passed; --data wins. --gen-data ignored.",
        );
      }
      // v4.0.0 — warn if --gen-data without --schema.
      if (opts.genData && !opts.schema) {
        console.warn(
          "[bdd2pw] --gen-data requires --schema <path>. Ignoring --gen-data.",
        );
      }
      const result = await scaffold({
        feature: path.resolve(feature),
        url: opts.url,
        page: opts.page,
        repo: path.resolve(opts.repo),
        pages: opts.pages?.split(",").map((s: string) => s.trim()),
        storageState: opts.storageState,
        headed: opts.headed,
        llm: opts.llm,
        llmConfig,
        governanceUrl: opts.governanceUrl,
        templates: opts.templates,
        dryRun: opts.dryRun,
        noValidate: opts.noValidate === false,
        telemetry: opts.telemetry,
        force: opts.force,
        snapshotFile: opts.snapshotFile,
        // Commander negates --no-discovery into opts.discovery=false
        noDiscovery: opts.discovery === false,
        selfHealing: opts.selfHealing,
        // v3.9.0 — telemetry sidecar
        llmStats: opts.llmStats === true,
        // v4.0.0 — data-driven Examples injection. --data wins over
        // --gen-data when both are passed (and we warn in stderr so the
        // user sees what happened).
        dataSource: opts.data
          ? { type: "file" as const, path: path.resolve(opts.data) }
          : opts.genData
            ? {
                type: "synthetic" as const,
                schemaPath: opts.schema
                  ? path.resolve(opts.schema)
                  : undefined,
                rows: opts.rows ? Number(opts.rows) : undefined,
                seed: opts.seed ? Number(opts.seed) : undefined,
              }
            : undefined,
      });
      logger.info({ result }, "scaffold complete");
    } catch (err) {
      logger.error({ err }, "scaffold failed");
      process.exit(exitCodeFor(err));
    }
  });

program
  .command("analyze")
  .description("Dry-run: parse .feature, scan URL, print locator + binding preview.")
  .argument("<feature>", "Path to a Gherkin .feature file")
  .requiredOption("--url <url>", "URL to scan")
  .option("--storage-state <path>", "Pre-authenticated storage state JSON")
  .option("--headed", "Show browser during MCP scan", false)
  .action(async (feature: string, opts) => {
    try {
      const result = await analyze({
        feature: path.resolve(feature),
        url: opts.url,
        storageState: opts.storageState,
        headed: opts.headed,
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      logger.error({ err }, "analyze failed");
      process.exit(exitCodeFor(err));
    }
  });

program
  .command("update-pom")
  .description("Re-scan a URL and merge new locators into an existing Page Object.")
  .requiredOption("--page <Name>", "Page Object class name")
  .requiredOption("--url <url>", "URL to re-scan")
  .requiredOption("--repo <dir>", "Existing Playwright TS repo")
  .option("--storage-state <path>", "Pre-authenticated storage state JSON")
  .option("--headed", "Show browser during MCP scan", false)
  .option("--templates <dir>", "Override default project template directory")
  .action(async (opts) => {
    try {
      const result = await updatePom({
        page: opts.page,
        url: opts.url,
        repo: path.resolve(opts.repo),
        storageState: opts.storageState,
        headed: opts.headed,
        templates: opts.templates,
      });
      logger.info({ result }, "update-pom complete");
    } catch (err) {
      logger.error({ err }, "update-pom failed");
      process.exit(exitCodeFor(err));
    }
  });

program
  .command("serve")
  .description("Start the bdd2pw HTTP service.")
  .option("--port <port>", "Port to listen on", "4300")
  .action(async (opts) => {
    const { startServer } = await import("./server");
    await startServer({ port: Number(opts.port) });
  });

/**
 * Map error → CLI exit code. See docs/ARCHITECTURE.md §7.
 */
function exitCodeFor(err: unknown): number {
  const name = (err as { name?: string })?.name ?? "";
  switch (name) {
    case "GherkinParseError":
      return 2;
    case "FileSystemError":
      return 3;
    case "McpError":
    case "GovernanceError":
      return 4;
    case "EmitterConsistencyError":
      return 5;
    default:
      return 1;
  }
}

/**
 * v3.6.0 — propose-rules subcommand.
 *
 * Reads the candidate-rules.jsonl that the LLM fallback path writes on
 * every successful binding, clusters similar step texts by structural
 * fingerprint, and emits a Markdown file with draft regex rules
 * suggested for promotion to the deterministic registry.
 */
program
  .command("propose-rules")
  .description(
    "Cluster LLM-generated bindings in <repo>/artefacts/candidate-rules.jsonl and propose draft regex rules.",
  )
  .argument(
    "<input>",
    "Path to candidate-rules.jsonl OR the scaffold repo containing it",
  )
  .option(
    "--out <path>",
    "Where to write propose-rules.md. Defaults to next to the JSONL.",
  )
  .option(
    "--min-cluster-size <n>",
    "Minimum cluster size to emit a proposal. Default 2.",
    "2",
  )
  .action(async (input: string, raw: { out?: string; minClusterSize?: string }) => {
    const result = await proposeRules({
      inputPath: input,
      outputPath: raw.out,
      minClusterSize: raw.minClusterSize
        ? Number(raw.minClusterSize)
        : undefined,
    });
    logger.info(
      {
        outputPath: result.outputPath,
        proposalsWritten: result.proposalsWritten,
        totalCandidates: result.totalCandidates,
      },
      "propose-rules: complete",
    );
    process.stdout.write(
      `\n${result.proposalsWritten} proposal(s) written to ${result.outputPath} ` +
        `(from ${result.totalCandidates} candidate entries).\n`,
    );
  });

/**
 * v3.10.0 — heal-stats subcommand. Reads `<repo>/artefacts/heal-events.jsonl`
 * (produced by the runtime `healOrThrow` helper) and writes
 * `<repo>/artefacts/heal-stats.json` summarising heal attempts,
 * success rate, top failing fields, top error patterns, retry latency,
 * and the candidate selectors that got promoted. Run after
 * `npx playwright test` in CI to track self-healing ROI per test run.
 */
program
  .command("heal-stats")
  .description(
    "Aggregate <repo>/artefacts/heal-events.jsonl into a heal-stats.json sidecar.",
  )
  .argument(
    "<input>",
    "Path to heal-events.jsonl OR the test repo containing artefacts/heal-events.jsonl",
  )
  .option(
    "--out <path>",
    "Where to write heal-stats.json. Defaults to next to the events file.",
  )
  .option(
    "--top <n>",
    "How many entries to keep in each ranked list (failing fields, errors, candidates, scenarios). Default 10.",
    "10",
  )
  .action(async (input: string, raw: { out?: string; top?: string }) => {
    const result = await analyseHealStats({
      inputPath: input,
      outputPath: raw.out,
      topN: raw.top ? Number(raw.top) : undefined,
    });
    logger.info(
      {
        outputPath: result.outputPath,
        totalEvents: result.totalEvents,
      },
      "heal-stats: complete",
    );
    process.stdout.write(
      `\nheal-stats: wrote ${result.outputPath} (parsed ${result.totalEvents} event(s)).\n`,
    );
  });

program.parseAsync(process.argv).catch((err) => {
  logger.error({ err }, "fatal");
  process.exit(1);
});
