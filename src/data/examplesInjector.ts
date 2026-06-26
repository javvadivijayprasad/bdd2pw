/**
 * v4.0.0 — ExamplesInjector.
 *
 * Mutates a parsed `FeatureIR` in place by replacing the `examples`
 * array on every Scenario Outline with externally-sourced rows
 * (from a CSV/JSON/XLSX file via DataLoader, or from a synthetic
 * generator via SynthGenerator).
 *
 * Design decisions (locked in during v4.0.0 planning):
 *
 * 1. External rows OVERRIDE inline Examples entirely. Inline Examples
 *    in the .feature file become the no-data fallback. When --data is
 *    passed, every Scenario Outline gets its examples swapped.
 *
 * 2. Scenarios without Outline syntax (no <placeholder>) are skipped.
 *    A vanilla Scenario doesn't care about data injection.
 *
 * 3. If a scenario's placeholders reference columns NOT present in
 *    the data, that scenario is LEFT ALONE (keeps inline Examples)
 *    and the gap is logged as a `ReviewItem` so BDD_REVIEW.md surfaces
 *    the mismatch. Partial column overrides are not supported on
 *    purpose — they produce confusing test output.
 *
 * 4. On synth-generator failure (LLM down, schema invalid, Faker
 *    missing), we leave inline Examples in place and surface a
 *    `ReviewItem` warning. Same graceful-degradation philosophy as
 *    the LLM-fallback failure mode.
 */

import type { FeatureIR, ReviewItem, ScenarioIR } from "../types";
import type { DataRow } from "./dataLoader";

/**
 * Discover the placeholder names referenced anywhere in a scenario's
 * step text. Gherkin syntax: `<name>` substitutes a value from the
 * row keyed by `name`.
 *
 * Returns a deduped, sorted list. Empty list = vanilla Scenario, not
 * an Outline.
 */
export function extractPlaceholders(scenario: ScenarioIR): string[] {
  const found = new Set<string>();
  const re = /<([A-Za-z_][\w-]*)>/g;
  for (const step of scenario.steps) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(step.text)) !== null) found.add(m[1]);
    // Also scan doc-string and data-table arguments.
    if (typeof step.argument === "string") {
      while ((m = re.exec(step.argument)) !== null) found.add(m[1]);
    } else if (Array.isArray(step.argument)) {
      for (const row of step.argument) {
        for (const cell of row) {
          while ((m = re.exec(cell)) !== null) found.add(m[1]);
        }
      }
    }
  }
  // Also walk the existing examples table headers, since some
  // scenarios reference a placeholder only via the row title and not
  // in step text. (Rare, but legal Gherkin.)
  if (scenario.examples && scenario.examples.length > 0) {
    for (const k of Object.keys(scenario.examples[0])) {
      // Headers don't need a `< >` wrapper in the parsed IR — we
      // include them so column matching is symmetric with whatever
      // the .feature file declared.
      found.add(k);
    }
  }
  return Array.from(found).sort();
}

/**
 * Inject `rows` into every Scenario Outline of `feature`. Returns
 * a report describing what was swapped and what was skipped (so the
 * caller can emit `ReviewItem`s and pino logs).
 *
 * Mutates `feature` in place — the caller passes the already-parsed
 * IR and gets back a mutation summary.
 */
export interface InjectionReport {
  totalScenarios: number;
  swappedScenarios: number;
  skippedScenarios: Array<{
    name: string;
    reason: string;
  }>;
  rowsPerSwap: number;
}

export function injectExamples(
  feature: FeatureIR,
  rows: DataRow[],
): InjectionReport {
  const report: InjectionReport = {
    totalScenarios: feature.scenarios.length,
    swappedScenarios: 0,
    skippedScenarios: [],
    rowsPerSwap: rows.length,
  };

  if (rows.length === 0) {
    // Nothing to inject — leave inline Examples untouched.
    for (const s of feature.scenarios) {
      report.skippedScenarios.push({
        name: s.name,
        reason: "data file had zero rows",
      });
    }
    return report;
  }

  const dataColumns = new Set(Object.keys(rows[0]));

  for (const scenario of feature.scenarios) {
    const placeholders = extractPlaceholders(scenario);
    if (placeholders.length === 0) {
      // Vanilla Scenario — no placeholders, no injection needed.
      report.skippedScenarios.push({
        name: scenario.name,
        reason: "vanilla Scenario (no <placeholders>)",
      });
      continue;
    }
    const missing = placeholders.filter((p) => !dataColumns.has(p));
    if (missing.length > 0) {
      report.skippedScenarios.push({
        name: scenario.name,
        reason: `data file is missing column(s): ${missing.join(", ")}`,
      });
      continue;
    }
    // Swap. Keep only the columns the scenario actually references —
    // extra columns in the data file are silently dropped per
    // scenario, so a single 50-column data file can feed many narrow
    // scenarios without each one pulling in noise.
    scenario.examples = rows.map((row) => {
      const filtered: DataRow = {};
      for (const p of placeholders) filtered[p] = row[p];
      return filtered;
    });
    report.swappedScenarios += 1;
  }

  return report;
}

/**
 * Convert an `InjectionReport` into `ReviewItem`s ready to push onto
 * the scaffold's review queue. One info line per swap, one warning
 * per skip whose reason indicates a real misconfiguration (missing
 * columns) — skips for "vanilla Scenario" or "zero rows" are info-only.
 */
export function reportToReviewItems(
  report: InjectionReport,
  source: string,
): ReviewItem[] {
  const items: ReviewItem[] = [];
  if (report.swappedScenarios > 0) {
    items.push({
      severity: "info",
      message: `Data injection from ${source}: swapped Examples in ${report.swappedScenarios}/${report.totalScenarios} scenario(s), ${report.rowsPerSwap} rows each.`,
    });
  }
  for (const skip of report.skippedScenarios) {
    const isMisconfig = skip.reason.startsWith("data file is missing");
    items.push({
      severity: isMisconfig ? "warn" : "info",
      message: `Data injection skipped scenario "${skip.name}": ${skip.reason}`,
    });
  }
  return items;
}
