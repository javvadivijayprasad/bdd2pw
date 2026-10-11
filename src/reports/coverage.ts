/**
 * v4.4.0 Slice 2 — `bdd2pw coverage <repo>`.
 *
 * Reads the same set of artefacts Slice 1's `quarantine-stats`
 * consumes, plus the healing telemetry, and turns "which rules fired
 * in this repo" into a decision surface:
 *
 *   - rule hit rate       — which rules bound how many steps, ordered
 *                            by use.
 *   - per-pack hit rate   — how much each domain rule pack pulled its
 *                            weight; a pack with no hits is a
 *                            candidate for `domains: [...]` removal.
 *   - dead rules          — every rule the current registry knows about
 *                            that did NOT fire in this repo. Not a
 *                            verdict on the rule — just a repo-scoped
 *                            report.
 *   - promotion trail     — candidate rules proposed from LLM bindings
 *                            → which became real rules → which of
 *                            those now fire. The loop closing is the
 *                            number worth publishing.
 *   - heal pressure       — locators that heal most often (from
 *                            `artefacts/heal-events.jsonl`). A rule
 *                            that binds and then always needs healing
 *                            is worse than no rule.
 *
 * Report shape (both stdout and `<repo>/artefacts/coverage.json`):
 *
 *   {
 *     "version":     "<bdd2pw version>",
 *     "generatedAt": "<ISO-8601>",
 *     "repo":        "<absolute path>",
 *     "sidecars":    <int>,
 *     "totals":      { scenarios: { ... }, steps: { ... } },   // shared with quarantine-stats
 *     "rules": {
 *       "hit":       [{ ruleId, pack?, hitCount, sampleSteps: [ ... ] }, ...],
 *       "dead":      [{ ruleId, pack? }, ...],
 *     },
 *     "packs": {
 *       "hit":  { <packName>: { hitCount, ruleIdsFired: [ ... ] } },
 *       "dead": [ <packName>, ... ]
 *     },
 *     "promotions":  { candidateStepsSurveyed, promoted, promotedStepTexts },   // shared with quarantine-stats
 *     "healPressure": [{ locatorKey, healCount, page?, name? }, ...],
 *     "missingArtefacts": [ "artefacts/heal-events.jsonl", ... ],
 *     "warnings":    [ ... ]
 *   }
 *
 * The reader is best-effort. Missing artefacts are reported, not
 * fatal. Exits non-zero only on a real I/O error against the repo
 * root itself. The output shape is invariant with `quarantine-stats`
 * where the fields overlap (`totals`, `promotions`) so a dashboard
 * can read either without switching schemas.
 */

import * as fs from "fs-extra";
import * as path from "path";
import type { DomainName } from "../transformers/stepMatcher";
import {
  analyseQuarantineStats,
  type QuarantineStats,
} from "./quarantineStats";

export interface RuleHit {
  ruleId: string;
  pack?: string;
  hitCount: number;
  sampleSteps: string[];
}

export interface Coverage {
  version: string;
  generatedAt: string;
  repo: string;
  sidecars: number;
  totals: QuarantineStats["totals"];
  rules: {
    hit: RuleHit[];
    dead: { ruleId: string; pack?: string }[];
  };
  packs: {
    hit: Record<string, { hitCount: number; ruleIdsFired: string[] }>;
    dead: string[];
  };
  promotions: QuarantineStats["promotions"];
  healPressure: { locatorKey: string; healCount: number; page?: string; name?: string }[];
  missingArtefacts: string[];
  warnings: string[];
}

export interface AnalyseCoverageOptions {
  repo: string;
  version: string;
  outputPath?: string;
  /**
   * Ordered list of every ruleId currently in the registry. Callers
   * (`bdd2pw coverage`) pass `listAllRuleIds()` from the step matcher.
   * Every ruleId in this list that does NOT appear in any sidecar is
   * counted as dead.
   */
  registryRuleIds: { ruleId: string; pack?: DomainName }[];
  /**
   * Optional cap on `sampleSteps` per hit. Default 3 — enough to
   * confirm the rule at a glance, not so much that the report bloats.
   */
  sampleStepsPerRule?: number;
  /**
   * Optional cap on the healPressure list. Default 10.
   */
  healPressureTopN?: number;
}

export interface AnalyseCoverageResult {
  coverage: Coverage;
  outputPath: string;
}

interface SidecarStep {
  text: string;
  rule?: null | { ruleId: string; pack?: string };
  llm?: unknown;
}
interface SidecarScenario {
  name: string;
  tags?: string[];
  steps: SidecarStep[];
}
interface Sidecar {
  source?: string;
  scenarios?: SidecarScenario[];
}

interface HealEvent {
  event?: string;
  page?: string;
  name?: string;
}

export async function analyseCoverage(
  opts: AnalyseCoverageOptions,
): Promise<AnalyseCoverageResult> {
  const repo = path.resolve(opts.repo);
  const missingArtefacts: string[] = [];
  const warnings: string[] = [];
  const sampleCap = opts.sampleStepsPerRule ?? 3;
  const healTopN = opts.healPressureTopN ?? 10;

  // 1) Shared totals + promotions — re-use Slice 1's aggregator so
  // this and quarantine-stats always agree on the shared numbers.
  // Write to a scratch path we discard; only the returned stats
  // object matters here.
  const scratch = path.join(repo, "artefacts", ".coverage-scratch.json");
  const { stats } = await analyseQuarantineStats({
    repo,
    version: opts.version,
    outputPath: scratch,
  });
  await fs.remove(scratch).catch(() => {});
  for (const w of stats.warnings) warnings.push(w);

  // 2) Walk sidecars for rule hits.
  const hitByRule = new Map<string, RuleHit>();
  const testsDir = path.join(repo, "tests");
  const sidecarFiles: string[] = [];
  if (await fs.pathExists(testsDir)) {
    await walkForSidecars(testsDir, sidecarFiles);
  } else {
    missingArtefacts.push("tests/");
  }
  for (const file of sidecarFiles) {
    let sidecar: Sidecar;
    try {
      sidecar = JSON.parse(await fs.readFile(file, "utf8")) as Sidecar;
    } catch {
      continue; // Already warned in Slice 1's pass.
    }
    for (const scenario of sidecar.scenarios ?? []) {
      for (const step of scenario.steps ?? []) {
        if (step.rule && typeof step.rule === "object") {
          const ruleId = step.rule.ruleId;
          if (!ruleId) continue;
          let hit = hitByRule.get(ruleId);
          if (!hit) {
            hit = {
              ruleId,
              pack: step.rule.pack,
              hitCount: 0,
              sampleSteps: [],
            };
            hitByRule.set(ruleId, hit);
          }
          hit.hitCount += 1;
          if (hit.sampleSteps.length < sampleCap && step.text) {
            hit.sampleSteps.push(step.text);
          }
        }
      }
    }
  }

  // 3) Dead rules = every registry ruleId NOT in hitByRule.
  const hitRuleIds = new Set(hitByRule.keys());
  const deadRules: { ruleId: string; pack?: string }[] = [];
  for (const r of opts.registryRuleIds) {
    if (!hitRuleIds.has(r.ruleId)) {
      deadRules.push(r.pack ? { ruleId: r.ruleId, pack: r.pack } : { ruleId: r.ruleId });
    }
  }

  // 4) Per-pack roll-up.
  const packHits: Record<string, { hitCount: number; ruleIdsFired: string[] }> = {};
  const packsSeen = new Set<string>();
  for (const r of opts.registryRuleIds) {
    if (r.pack) packsSeen.add(r.pack);
  }
  for (const [, hit] of hitByRule) {
    if (!hit.pack) continue;
    const acc = (packHits[hit.pack] ??= { hitCount: 0, ruleIdsFired: [] });
    acc.hitCount += hit.hitCount;
    if (!acc.ruleIdsFired.includes(hit.ruleId)) {
      acc.ruleIdsFired.push(hit.ruleId);
    }
  }
  const deadPacks: string[] = [];
  for (const p of packsSeen) {
    if (!packHits[p]) deadPacks.push(p);
  }
  deadPacks.sort();

  // 5) Heal pressure — read artefacts/heal-events.jsonl and count
  // `healed` / `heal_attempt` events per locator.
  const healPath = path.join(repo, "artefacts", "heal-events.jsonl");
  const pwHealPath = path.join(repo, ".pwheal", "heal-events.jsonl");
  const healPressureMap = new Map<
    string,
    { healCount: number; page?: string; name?: string }
  >();
  const activeHealPath = (await fs.pathExists(healPath))
    ? healPath
    : (await fs.pathExists(pwHealPath))
      ? pwHealPath
      : undefined;
  if (!activeHealPath) {
    // Not an error — many repos don't run --self-healing. Note it.
    missingArtefacts.push(
      "artefacts/heal-events.jsonl (or .pwheal/heal-events.jsonl)",
    );
  } else {
    try {
      const raw = await fs.readFile(activeHealPath, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let ev: HealEvent;
        try {
          ev = JSON.parse(trimmed) as HealEvent;
        } catch {
          continue;
        }
        if (ev.event !== "healed" && ev.event !== "heal_attempt") continue;
        const key = `${ev.page ?? "?"}.${ev.name ?? "?"}`;
        let bucket = healPressureMap.get(key);
        if (!bucket) {
          bucket = { healCount: 0, page: ev.page, name: ev.name };
          healPressureMap.set(key, bucket);
        }
        bucket.healCount += 1;
      }
    } catch (e) {
      warnings.push(
        `Could not read heal-events log: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
  const healPressure = Array.from(healPressureMap.entries())
    .map(([locatorKey, v]) => ({ locatorKey, ...v }))
    .sort((a, b) => b.healCount - a.healCount)
    .slice(0, healTopN);

  // 6) candidate-rules.jsonl awareness — record its absence as a
  // missing artefact when nothing to promote and no file present.
  const candidatesPath = path.join(repo, "artefacts", "candidate-rules.jsonl");
  if (!(await fs.pathExists(candidatesPath))) {
    missingArtefacts.push("artefacts/candidate-rules.jsonl");
  }

  const coverage: Coverage = {
    version: opts.version,
    generatedAt: new Date().toISOString(),
    repo,
    sidecars: stats.totals.sidecars,
    totals: stats.totals,
    rules: {
      hit: Array.from(hitByRule.values()).sort(
        (a, b) => b.hitCount - a.hitCount,
      ),
      dead: deadRules,
    },
    packs: {
      hit: packHits,
      dead: deadPacks,
    },
    promotions: stats.promotions,
    healPressure,
    missingArtefacts,
    warnings,
  };

  const outputPath =
    opts.outputPath ?? path.join(repo, "artefacts", "coverage.json");
  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, JSON.stringify(coverage, null, 2) + "\n", "utf8");
  return { coverage, outputPath };
}

/** Depth-first walk for `.spec.meta.json` files. */
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
 * Human-readable one-page render. Separate from the JSON generator so
 * tests can assert on the JSON shape without parsing text, and callers
 * that want raw JSON pass `--json` at the CLI layer.
 */
export function renderCoverageTable(cov: Coverage): string {
  const lines: string[] = [];
  lines.push(`bdd2pw coverage (v${cov.version})`);
  lines.push(`repo: ${cov.repo}`);
  lines.push(`generated: ${cov.generatedAt}`);
  lines.push("");
  lines.push(
    `sidecars: ${cov.sidecars}  scenarios: ${cov.totals.scenarios.total}  steps: ${cov.totals.steps.total}`,
  );
  lines.push("");
  lines.push(`rules fired: ${cov.rules.hit.length}   dead: ${cov.rules.dead.length}`);
  const topRules = cov.rules.hit.slice(0, 10);
  if (topRules.length > 0) {
    lines.push("");
    lines.push("top firing rules:");
    for (const r of topRules) {
      lines.push(
        `  ${r.ruleId.padEnd(12)} ${String(r.hitCount).padStart(4)}  ${r.pack ?? "core"}`,
      );
    }
  }
  const deadPacks = cov.packs.dead;
  if (deadPacks.length > 0) {
    lines.push("");
    lines.push(
      `dead packs (no rule fired in this repo): ${deadPacks.join(", ")}`,
    );
    lines.push(
      `  → drop from your domains: [...] to shrink the rule table (--suggest-retire prints the stanza).`,
    );
  }
  if (cov.healPressure.length > 0) {
    lines.push("");
    lines.push("heal pressure (most healed locators):");
    for (const h of cov.healPressure) {
      lines.push(`  ${h.locatorKey.padEnd(40)} ${h.healCount}`);
    }
  }
  lines.push("");
  lines.push(
    `promotions: ${cov.promotions.promoted}/${cov.promotions.candidateStepsSurveyed} candidate step(s) now rule-bound`,
  );
  if (cov.missingArtefacts.length > 0) {
    lines.push("");
    lines.push("missing artefacts (report continued with what was present):");
    for (const m of cov.missingArtefacts) lines.push(`  - ${m}`);
  }
  if (cov.warnings.length > 0) {
    lines.push("");
    lines.push("warnings:");
    for (const w of cov.warnings) lines.push(`  - ${w}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Render the `--suggest-retire` stanza — a copyable block the user can
 * paste into their bdd2pw config (or bench harness) to shrink the
 * active rule table. Never edits anything itself.
 */
export function renderSuggestRetire(cov: Coverage): string {
  const lines: string[] = [];
  lines.push(
    "# `bdd2pw coverage --suggest-retire` — copy the block(s) you want to apply.",
  );
  lines.push(
    "# Each entry is a rule or pack that did NOT fire in this repo. Removing",
  );
  lines.push(
    "# them is safe here; it may not be safe across all your repos.",
  );
  lines.push("");
  if (cov.packs.dead.length > 0) {
    lines.push("# Domain packs to drop from ScaffoldOptions.domains:");
    for (const p of cov.packs.dead) {
      lines.push(`#   - "${p}"`);
    }
    lines.push("");
  }
  if (cov.rules.dead.length > 0) {
    lines.push("# Rules that never fired here (repo-scoped only; NOT a global verdict):");
    for (const r of cov.rules.dead) {
      lines.push(`#   - ${r.ruleId}${r.pack ? ` (pack: ${r.pack})` : ""}`);
    }
  }
  return lines.join("\n") + "\n";
}
