/**
 * v3.10.0 — heal-events.jsonl → heal-stats.json analyzer.
 *
 * Same flavor as v3.9.0's `LLMTelemetry` sidecar but for the
 * self-healing pipeline. Where v3.9.0 measures the LLM batching ROI
 * per scaffold, v3.10.0 measures the self-healing ROI per TEST RUN.
 *
 * Input:  `<repo>/artefacts/heal-events.jsonl` — one JSON event per
 *         line, written by the runtime `healOrThrow` helper from
 *         `templates/heal.ts.tmpl`. Event kinds:
 *           - `register`            — locator constructed
 *           - `heal_attempt`        — action failed; asking the heal
 *                                     service for a candidate
 *           - `healed`              — candidate worked; subsequent
 *                                     calls use it transparently
 *           - `heal_unavailable`    — no candidate / candidate failed
 *
 * Output: `<repo>/artefacts/heal-stats.json` — stable shape:
 *
 *   {
 *     "version": "3.10.0",
 *     "generatedAt": "2026-...",
 *     "source": "<events file>",
 *     "totals": {
 *       "registrations": 47,
 *       "healAttempts": 6,
 *       "healed": 4,
 *       "healUnavailable": 2,
 *       "healRate": 0.6667,         // healed / healAttempts
 *       "uniqueFields": 23,
 *       "uniquePages": 3
 *     },
 *     "topFailingFields": [
 *       { "page": "LoginPage", "name": "submitButton", "attempts": 3, "healed": 2 },
 *       ...
 *     ],
 *     "topErrors": [
 *       { "error": "Timeout 30000ms exceeded", "count": 4 },
 *       ...
 *     ],
 *     "topCandidates": [
 *       { "selector": "[data-testid='submit']", "promotions": 2,
 *         "averageConfidence": 0.87 },
 *       ...
 *     ],
 *     "retryLatencyMs": { "p50": 1240, "p95": 3010, "min": 880, "max": 3010 },
 *     "perScenario": [
 *       { "scenario": "User can log in", "attempts": 1, "healed": 1 },
 *       ...
 *     ]
 *   }
 *
 * Why a separate command (not part of scaffold): scaffold GENERATES the
 * test repo; the heal events are produced when the user RUNS the
 * generated tests. So this analyzer is a post-test command, run from
 * CI after `npx playwright test`. Same pattern as `bdd2pw propose-rules`
 * which runs after the LLM has populated `candidate-rules.jsonl`.
 */

import * as fs from "fs-extra";
import * as path from "path";

export interface HealStatsOptions {
  /** Path to heal-events.jsonl OR a repo dir containing it. */
  inputPath: string;
  /** Override output path. Default: <input dir>/heal-stats.json. */
  outputPath?: string;
  /** How many top entries to keep in each ranked list. Default 10. */
  topN?: number;
}

export interface HealStatsResult {
  outputPath: string;
  totalEvents: number;
}

/** One event line in heal-events.jsonl. Shape tracks `templates/heal.ts.tmpl`. */
interface HealEvent {
  ts: string;
  event:
    | "register"
    | "heal_attempt"
    | "healed"
    | "heal_unavailable";
  page: string;
  name: string;
  scenario_name?: string | null;
  method?: string;
  original?: string | null;
  healed?: string | null;
  confidence?: number | null;
  error?: string | null;
}

export interface HealStats {
  version: string;
  generatedAt: string;
  source: string;
  totals: {
    registrations: number;
    healAttempts: number;
    healed: number;
    healUnavailable: number;
    healRate: number;
    uniqueFields: number;
    uniquePages: number;
  };
  topFailingFields: {
    page: string;
    name: string;
    attempts: number;
    healed: number;
  }[];
  topErrors: { error: string; count: number }[];
  topCandidates: {
    selector: string;
    promotions: number;
    averageConfidence: number | null;
  }[];
  retryLatencyMs: { p50: number; p95: number; min: number; max: number };
  perScenario: { scenario: string; attempts: number; healed: number }[];
}

const PACKAGE_VERSION = "3.10.0";

/** Public entry point. */
export async function analyseHealStats(
  opts: HealStatsOptions,
): Promise<HealStatsResult> {
  const jsonlPath = await resolveJsonlPath(opts.inputPath);
  const events = await readEvents(jsonlPath);
  const summary = aggregate(events, jsonlPath, opts.topN ?? 10);

  const outputPath =
    opts.outputPath ?? path.join(path.dirname(jsonlPath), "heal-stats.json");
  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, JSON.stringify(summary, null, 2), "utf8");

  return { outputPath, totalEvents: events.length };
}

/* ─── pure aggregation (testable without fs) ──────────────────────── */

/**
 * Compute a HealStats summary from an in-memory event list. Pure
 * function — no I/O. Used both by the public CLI entry and the unit
 * tests.
 */
export function aggregate(
  events: HealEvent[],
  source: string,
  topN: number,
): HealStats {
  const fieldKey = (e: HealEvent) => `${e.page}::${e.name}`;
  const fieldAttempts = new Map<
    string,
    { page: string; name: string; attempts: number; healed: number }
  >();
  const errorCounts = new Map<string, number>();
  const candidateStats = new Map<
    string,
    { promotions: number; confidenceSum: number; confidenceCount: number }
  >();
  const scenarioStats = new Map<
    string,
    { attempts: number; healed: number }
  >();
  const uniquePages = new Set<string>();
  const uniqueFields = new Set<string>();
  const retryLatencies: number[] = [];
  /**
   * Match heal_attempt events with their matching `healed` /
   * `heal_unavailable` outcome by (page, name, method). The keying
   * assumes a heal attempt resolves before another one fires for the
   * same field+method combo, which holds in practice — actions run
   * serially per test.
   */
  const openAttempts = new Map<string, number>();
  const attemptKey = (e: HealEvent) =>
    `${e.page}::${e.name}::${e.method ?? ""}`;

  let registrations = 0;
  let healAttempts = 0;
  let healed = 0;
  let healUnavailable = 0;

  for (const e of events) {
    uniquePages.add(e.page);
    uniqueFields.add(fieldKey(e));

    if (e.event === "register") {
      registrations += 1;
      continue;
    }
    if (e.event === "heal_attempt") {
      healAttempts += 1;
      const field = fieldAttempts.get(fieldKey(e)) ?? {
        page: e.page,
        name: e.name,
        attempts: 0,
        healed: 0,
      };
      field.attempts += 1;
      fieldAttempts.set(fieldKey(e), field);
      if (e.error) {
        const msg = truncateError(e.error);
        errorCounts.set(msg, (errorCounts.get(msg) ?? 0) + 1);
      }
      const scenario = e.scenario_name ?? "(no scenario context)";
      const ss = scenarioStats.get(scenario) ?? { attempts: 0, healed: 0 };
      ss.attempts += 1;
      scenarioStats.set(scenario, ss);
      openAttempts.set(attemptKey(e), Date.parse(e.ts));
      continue;
    }
    if (e.event === "healed") {
      healed += 1;
      const field = fieldAttempts.get(fieldKey(e)) ?? {
        page: e.page,
        name: e.name,
        attempts: 0,
        healed: 0,
      };
      field.healed += 1;
      fieldAttempts.set(fieldKey(e), field);
      if (e.healed) {
        const cs = candidateStats.get(e.healed) ?? {
          promotions: 0,
          confidenceSum: 0,
          confidenceCount: 0,
        };
        cs.promotions += 1;
        if (typeof e.confidence === "number") {
          cs.confidenceSum += e.confidence;
          cs.confidenceCount += 1;
        }
        candidateStats.set(e.healed, cs);
      }
      const scenario = e.scenario_name ?? "(no scenario context)";
      const ss = scenarioStats.get(scenario) ?? { attempts: 0, healed: 0 };
      ss.healed += 1;
      scenarioStats.set(scenario, ss);
      const startTs = openAttempts.get(attemptKey(e));
      if (startTs !== undefined) {
        retryLatencies.push(Date.parse(e.ts) - startTs);
        openAttempts.delete(attemptKey(e));
      }
      continue;
    }
    if (e.event === "heal_unavailable") {
      healUnavailable += 1;
      openAttempts.delete(attemptKey(e));
      continue;
    }
  }

  const sortedFailingFields = Array.from(fieldAttempts.values())
    .sort((a, b) => b.attempts - a.attempts)
    .slice(0, topN);

  const sortedErrors = Array.from(errorCounts.entries())
    .map(([error, count]) => ({ error, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);

  const sortedCandidates = Array.from(candidateStats.entries())
    .map(([selector, s]) => ({
      selector,
      promotions: s.promotions,
      averageConfidence:
        s.confidenceCount > 0 ? s.confidenceSum / s.confidenceCount : null,
    }))
    .sort((a, b) => b.promotions - a.promotions)
    .slice(0, topN);

  const sortedScenarios = Array.from(scenarioStats.entries())
    .map(([scenario, s]) => ({ scenario, ...s }))
    .sort((a, b) => b.attempts - a.attempts)
    .slice(0, topN);

  const latenciesSorted = [...retryLatencies].sort((a, b) => a - b);

  return {
    version: PACKAGE_VERSION,
    generatedAt: new Date().toISOString(),
    source,
    totals: {
      registrations,
      healAttempts,
      healed,
      healUnavailable,
      healRate: healAttempts === 0 ? 0 : healed / healAttempts,
      uniqueFields: uniqueFields.size,
      uniquePages: uniquePages.size,
    },
    topFailingFields: sortedFailingFields,
    topErrors: sortedErrors,
    topCandidates: sortedCandidates,
    retryLatencyMs: {
      p50: percentile(latenciesSorted, 0.5),
      p95: percentile(latenciesSorted, 0.95),
      min: latenciesSorted.length ? latenciesSorted[0] : 0,
      max: latenciesSorted.length
        ? latenciesSorted[latenciesSorted.length - 1]
        : 0,
    },
    perScenario: sortedScenarios,
  };
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.ceil(sortedAsc.length * p) - 1;
  return sortedAsc[Math.max(0, Math.min(idx, sortedAsc.length - 1))];
}

/**
 * Normalise an error message so different timestamps / IDs collapse to
 * the same bucket: lowercase, strip leading "Error: " / "TimeoutError",
 * collapse runs of digits.
 */
function truncateError(s: string): string {
  return s
    .toLowerCase()
    .replace(/^(?:error|timeouterror|protocolerror):\s*/i, "")
    .replace(/\b\d{3,}\b/g, "<n>")
    .slice(0, 120);
}

/* ─── filesystem glue ─────────────────────────────────────────────── */

async function resolveJsonlPath(inputPath: string): Promise<string> {
  const stat = await fs.stat(inputPath).catch(() => undefined);
  if (stat?.isFile()) return inputPath;
  if (stat?.isDirectory()) {
    const direct = path.join(inputPath, "heal-events.jsonl");
    if (await fs.pathExists(direct)) return direct;
    const nested = path.join(inputPath, "artefacts", "heal-events.jsonl");
    if (await fs.pathExists(nested)) return nested;
    return nested; // analyser will handle 'no events' gracefully
  }
  return path.join(inputPath, "artefacts", "heal-events.jsonl");
}

async function readEvents(jsonlPath: string): Promise<HealEvent[]> {
  if (!(await fs.pathExists(jsonlPath))) return [];
  const raw = await fs.readFile(jsonlPath, "utf8");
  const out: HealEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as HealEvent);
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}
