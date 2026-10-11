/**
 * v4.4.0 Slice 1 — `bdd2pw quarantine-stats <repo>`.
 *
 * Aggregates the LLM-provenance data written by v4.4.0's scaffold path
 * (`*.spec.meta.json` sidecars + `artefacts/candidate-rules.jsonl`)
 * into a per-feature / per-pack report. The point is to make the two
 * lanes measurable:
 *
 *   trusted lane   — scenarios with NO `@llm-generated` tag; every
 *                    step bound by the deterministic rule table.
 *   review lane    — scenarios with the `@llm-generated` tag; at
 *                    least one step bound by the LLM fallback.
 *
 * Report shape (both stdout and `artefacts/quarantine-stats.json`):
 *
 *   {
 *     "version":           "<bdd2pw version>",
 *     "generatedAt":       "<ISO-8601>",
 *     "repo":              "<absolute path>",
 *     "totals": {
 *       "sidecars":        <int>,
 *       "scenarios":       { "total": N, "llmGenerated": N, "deterministic": N },
 *       "steps":           { "total": N, "byRule": N, "byLlm": N },
 *       "llmCacheHitShare": <0..1 | null>
 *     },
 *     "byFeature":         [{ source, scenarios, steps }, ...],
 *     "promotions": {
 *       "candidateStepsSurveyed": <int>,
 *       "promoted":               <int>,
 *       "promotedStepTexts":      [ ... ]
 *     },
 *     "sidecarsScanned":   ["<path>", ...]
 *   }
 *
 * The reader is best-effort — a malformed sidecar is skipped with a
 * warning and does not crash the run. Only I/O failures on the repo
 * root itself surface as non-zero exit codes; the report is not a gate.
 */

import * as fs from "fs-extra";
import * as path from "path";

/** Top-level per-repo summary. */
export interface QuarantineStats {
  version: string;
  generatedAt: string;
  repo: string;
  totals: {
    sidecars: number;
    scenarios: {
      total: number;
      llmGenerated: number;
      deterministic: number;
    };
    steps: {
      total: number;
      byRule: number;
      byLlm: number;
    };
    /** null when no LLM steps were recorded (avoids fake precision). */
    llmCacheHitShare: number | null;
  };
  byFeature: {
    source: string;
    scenarios: { total: number; llmGenerated: number; deterministic: number };
    steps: { total: number; byRule: number; byLlm: number };
  }[];
  promotions: {
    candidateStepsSurveyed: number;
    promoted: number;
    promotedStepTexts: string[];
  };
  sidecarsScanned: string[];
  warnings: string[];
}

/** A slim view of the sidecar shape we actually read here. */
interface SidecarStep {
  keyword: string;
  text: string;
  /** v4.4.0 Slice 2 — object form when rule-bound (`{ ruleId, pack? }`),
   *  `null` when LLM-bound, absent when the sidecar predates v4.4. */
  rule?: null | { ruleId: string; pack?: string };
  llm?: {
    provider: string;
    model: string;
    cached: boolean;
    governance: string;
    at: string;
  };
}
interface SidecarScenario {
  name: string;
  tags?: string[];
  steps: SidecarStep[];
}
interface Sidecar {
  version?: string;
  source?: string;
  scenarios?: SidecarScenario[];
}

/** A slim view of a candidate-rules.jsonl entry we actually read here. */
interface CandidateEntry {
  ts?: string;
  stepText?: string;
}

export interface AnalyseQuarantineStatsOptions {
  /** Repo root containing tests/, artefacts/. */
  repo: string;
  /** Package version to embed. Propagated from the CLI. */
  version: string;
  /** Optional override for the output path. Default: <repo>/artefacts/quarantine-stats.json. */
  outputPath?: string;
}

export interface AnalyseQuarantineStatsResult {
  stats: QuarantineStats;
  outputPath: string;
}

/**
 * Walk `<repo>/tests/**\/*.spec.meta.json` and produce the aggregate
 * report. Writes the JSON payload alongside the artefacts directory.
 */
export async function analyseQuarantineStats(
  opts: AnalyseQuarantineStatsOptions,
): Promise<AnalyseQuarantineStatsResult> {
  const repo = path.resolve(opts.repo);
  const testsDir = path.join(repo, "tests");
  const warnings: string[] = [];
  const sidecarsScanned: string[] = [];

  const files: string[] = [];
  if (await fs.pathExists(testsDir)) {
    await walkForSidecars(testsDir, files);
  }

  let scenariosTotal = 0;
  let scenariosLlm = 0;
  let stepsTotal = 0;
  let stepsByRule = 0;
  let stepsByLlm = 0;
  let cachedLlmSteps = 0;
  const byFeature: QuarantineStats["byFeature"] = [];

  for (const file of files) {
    let sidecar: Sidecar | undefined;
    try {
      sidecar = JSON.parse(await fs.readFile(file, "utf8")) as Sidecar;
    } catch (e) {
      warnings.push(
        `Malformed sidecar (skipped): ${path.relative(repo, file)} — ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      continue;
    }
    if (!sidecar.scenarios || sidecar.scenarios.length === 0) continue;
    sidecarsScanned.push(path.relative(repo, file));

    let featureScenariosLlm = 0;
    let featureStepsByRule = 0;
    let featureStepsByLlm = 0;
    let featureStepsTotal = 0;

    for (const scenario of sidecar.scenarios) {
      const scenarioIsLlm = (scenario.tags ?? []).includes("@llm-generated");
      scenariosTotal += 1;
      if (scenarioIsLlm) {
        scenariosLlm += 1;
        featureScenariosLlm += 1;
      }
      for (const step of scenario.steps ?? []) {
        stepsTotal += 1;
        featureStepsTotal += 1;
        if (step.llm) {
          stepsByLlm += 1;
          featureStepsByLlm += 1;
          if (step.llm.cached) cachedLlmSteps += 1;
        } else {
          stepsByRule += 1;
          featureStepsByRule += 1;
        }
      }
    }

    const scenarioCount = sidecar.scenarios.length;
    byFeature.push({
      source: sidecar.source ?? path.relative(repo, file),
      scenarios: {
        total: scenarioCount,
        llmGenerated: featureScenariosLlm,
        deterministic: scenarioCount - featureScenariosLlm,
      },
      steps: {
        total: featureStepsTotal,
        byRule: featureStepsByRule,
        byLlm: featureStepsByLlm,
      },
    });
  }

  const promotions = await computePromotions(repo, warnings);

  const llmCacheHitShare =
    stepsByLlm > 0 ? cachedLlmSteps / stepsByLlm : null;

  const stats: QuarantineStats = {
    version: opts.version,
    generatedAt: new Date().toISOString(),
    repo,
    totals: {
      sidecars: sidecarsScanned.length,
      scenarios: {
        total: scenariosTotal,
        llmGenerated: scenariosLlm,
        deterministic: scenariosTotal - scenariosLlm,
      },
      steps: {
        total: stepsTotal,
        byRule: stepsByRule,
        byLlm: stepsByLlm,
      },
      llmCacheHitShare,
    },
    byFeature,
    promotions,
    sidecarsScanned,
    warnings,
  };

  const outputPath =
    opts.outputPath ?? path.join(repo, "artefacts", "quarantine-stats.json");
  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, JSON.stringify(stats, null, 2) + "\n", "utf8");

  return { stats, outputPath };
}

/**
 * Depth-first walk of `dir`, appending every path ending in
 * `.spec.meta.json`. Node's built-in `fs.readdir` is enough; we don't
 * take a dep on glob for one pattern.
 */
async function walkForSidecars(dir: string, out: string[]): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkForSidecars(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".spec.meta.json")) {
      out.push(full);
    }
  }
}

/**
 * Load `artefacts/candidate-rules.jsonl` and figure out which LLM-
 * emitted step texts are NO LONGER present as `@llm-generated`
 * scenarios in the current sidecars — i.e. the rule table caught up
 * and the promotion completed.
 *
 * The measure is intentionally coarse (unique step-text intersection);
 * a finer version lives in Slice 2's coverage analyzer, which joins
 * step text against the rule table's regex patterns.
 */
async function computePromotions(
  repo: string,
  warnings: string[],
): Promise<QuarantineStats["promotions"]> {
  const candidatesPath = path.join(repo, "artefacts", "candidate-rules.jsonl");
  const surveyedStepTexts = new Set<string>();
  if (await fs.pathExists(candidatesPath)) {
    let raw: string;
    try {
      raw = await fs.readFile(candidatesPath, "utf8");
    } catch (e) {
      warnings.push(
        `Could not read artefacts/candidate-rules.jsonl: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return { candidateStepsSurveyed: 0, promoted: 0, promotedStepTexts: [] };
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as CandidateEntry;
        if (typeof entry.stepText === "string" && entry.stepText.length > 0) {
          surveyedStepTexts.add(entry.stepText);
        }
      } catch {
        // Ignore one malformed line — the JSONL is best-effort telemetry.
      }
    }
  }

  // Any step-text in the candidates log whose current sidecar entry
  // no longer has an `llm` block is a promotion. Collect them.
  const stillLlmStepTexts = new Set<string>();
  const testsDir = path.join(repo, "tests");
  if (await fs.pathExists(testsDir)) {
    const files: string[] = [];
    await walkForSidecars(testsDir, files);
    for (const file of files) {
      try {
        const sidecar = JSON.parse(
          await fs.readFile(file, "utf8"),
        ) as Sidecar;
        for (const scenario of sidecar.scenarios ?? []) {
          for (const step of scenario.steps ?? []) {
            if (step.llm && typeof step.text === "string") {
              stillLlmStepTexts.add(step.text);
            }
          }
        }
      } catch {
        // Already warned above during the main scan.
      }
    }
  }

  const promoted: string[] = [];
  for (const t of surveyedStepTexts) {
    if (!stillLlmStepTexts.has(t)) promoted.push(t);
  }
  return {
    candidateStepsSurveyed: surveyedStepTexts.size,
    promoted: promoted.length,
    promotedStepTexts: promoted.sort(),
  };
}

/**
 * Human-readable one-page render. Kept separate from the report
 * generation so tests can assert on the JSON shape without parsing
 * text.
 */
export function renderQuarantineStatsTable(stats: QuarantineStats): string {
  const lines: string[] = [];
  lines.push("bdd2pw quarantine-stats (v" + stats.version + ")");
  lines.push("repo: " + stats.repo);
  lines.push("generated: " + stats.generatedAt);
  lines.push("");
  lines.push(
    "scenarios: " +
      stats.totals.scenarios.total +
      " total · " +
      stats.totals.scenarios.deterministic +
      " deterministic · " +
      stats.totals.scenarios.llmGenerated +
      " @llm-generated",
  );
  lines.push(
    "steps:     " +
      stats.totals.steps.total +
      " total · " +
      stats.totals.steps.byRule +
      " by rule · " +
      stats.totals.steps.byLlm +
      " by LLM",
  );
  if (stats.totals.llmCacheHitShare !== null) {
    lines.push(
      "LLM cache hit share: " +
        (stats.totals.llmCacheHitShare * 100).toFixed(1) +
        "%",
    );
  }
  lines.push("");
  lines.push(
    "promotions: " +
      stats.promotions.promoted +
      "/" +
      stats.promotions.candidateStepsSurveyed +
      " candidate step(s) now rule-bound",
  );
  if (stats.warnings.length > 0) {
    lines.push("");
    lines.push("warnings:");
    for (const w of stats.warnings) lines.push("  - " + w);
  }
  return lines.join("\n") + "\n";
}
