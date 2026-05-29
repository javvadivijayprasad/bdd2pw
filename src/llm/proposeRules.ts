/**
 * v3.6.0 — auto-rule proposal pipeline.
 *
 * Reads `<repo>/artefacts/candidate-rules.jsonl` (written by the LLM
 * fallback path on every successful binding) and proposes new
 * deterministic regex rules by clustering similar step texts.
 *
 * Pipeline:
 *
 *   1. Load every JSONL row.
 *   2. Normalise each step text: lowercase + strip quoted literals
 *      and numbers (the natural "variable" parts of a step). What
 *      remains is the step's STRUCTURAL fingerprint — same fingerprint
 *      means same step shape with different data.
 *   3. Group rows by fingerprint. Skip clusters of size 1 (a single
 *      LLM call doesn't justify a deterministic rule).
 *   4. For each cluster: emit a proposal block with the cluster size,
 *      a draft regex with capture groups for the variable parts, a
 *      "representative" binding (taken from the cluster's most-recent
 *      LLM output), and the original step texts so the human reviewer
 *      can audit.
 *
 * Output format: human-readable Markdown at
 * `<repo>/artefacts/propose-rules.md`. The reviewer copy-pastes the
 * proposals (or hand-tweaks them) into `src/transformers/stepMatcher.ts`
 * for a future deterministic-coverage release.
 *
 * Why Markdown not JSON: the proposals require human review. Markdown
 * with code fences is the right shape — it's diff-friendly, easy to
 * paste into PRs, and survives a copy-paste into the codebase.
 */

import * as fs from "fs-extra";
import * as path from "path";
import type { CandidateRuleEntry } from "./types";

export interface ProposeRulesOptions {
  /** Path to candidate-rules.jsonl (or the directory containing it). */
  inputPath: string;
  /** Where to write propose-rules.md. Default: <inputPath dir>/propose-rules.md. */
  outputPath?: string;
  /** Minimum cluster size to emit a proposal. Default 2. */
  minClusterSize?: number;
}

export interface ProposeRulesResult {
  outputPath: string;
  proposalsWritten: number;
  totalCandidates: number;
  /** Step fingerprints + their sizes, sorted descending. */
  clusters: { fingerprint: string; size: number; sampleText: string }[];
}

/**
 * Public entry point used by both the library API and the CLI.
 */
export async function proposeRules(
  opts: ProposeRulesOptions,
): Promise<ProposeRulesResult> {
  const jsonlPath = await resolveJsonlPath(opts.inputPath);
  const entries = await readCandidates(jsonlPath);
  const minSize = opts.minClusterSize ?? 2;

  // Cluster by structural fingerprint.
  const buckets = new Map<string, CandidateRuleEntry[]>();
  for (const entry of entries) {
    const fp = fingerprint(entry.stepText);
    const list = buckets.get(fp);
    if (list) list.push(entry);
    else buckets.set(fp, [entry]);
  }

  // Emit proposals for clusters of size >= minSize, largest first.
  const sortedClusters = Array.from(buckets.entries())
    .map(([fp, list]) => ({
      fingerprint: fp,
      size: list.length,
      list,
    }))
    .sort((a, b) => b.size - a.size);

  const outputPath =
    opts.outputPath ?? path.join(path.dirname(jsonlPath), "propose-rules.md");

  const lines: string[] = [];
  lines.push("# bdd2pw — Rule proposals");
  lines.push("");
  lines.push(`> Auto-generated from \`${path.basename(jsonlPath)}\``);
  lines.push(`> Generated: ${new Date().toISOString()}`);
  lines.push(`> Total candidate-rules entries: ${entries.length}`);
  lines.push("");

  let proposalsWritten = 0;
  for (const { fingerprint: fp, size, list } of sortedClusters) {
    if (size < minSize) continue;
    proposalsWritten += 1;
    const repr = list[list.length - 1]; // most-recent representative
    const sampleTexts = list.slice(0, 5).map((e) => e.stepText);
    const regex = synthesiseRegex(list.map((e) => e.stepText));

    lines.push(`## Proposal ${proposalsWritten} — cluster of ${size}`);
    lines.push("");
    lines.push(`**Fingerprint:** \`${fp}\``);
    lines.push("");
    lines.push(`**Draft pattern:** \`${regex}\``);
    lines.push("");
    lines.push(`**Sample step texts (showing up to 5 of ${size}):**`);
    lines.push("");
    for (const t of sampleTexts) lines.push(`- \`${t}\``);
    lines.push("");
    lines.push("**Representative binding (most recent LLM output):**");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(repr.binding, null, 2));
    lines.push("```");
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  if (proposalsWritten === 0) {
    lines.push(
      `_No clusters of size >= ${minSize} found. Either the cache is fresh or every step is unique._`,
    );
    lines.push("");
  }

  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, lines.join("\n"), "utf8");

  return {
    outputPath,
    proposalsWritten,
    totalCandidates: entries.length,
    clusters: sortedClusters.map((c) => ({
      fingerprint: c.fingerprint,
      size: c.size,
      sampleText: c.list[0].stepText,
    })),
  };
}

/**
 * Structural fingerprint — what's the same about steps in a cluster.
 *
 * Strip quoted strings (single or double), numbers, and dates. What's
 * left is the SHAPE of the step. Steps that look the same after this
 * substitution belong in the same cluster.
 *
 *   `I enter "alice" in the username field`     → `i enter "" in the username field`
 *   `I enter "bob" in the username field`       → `i enter "" in the username field`
 *   `the balance is "$1,234.56"`                → `the balance is ""`
 *   `the appointment is on 2026-05-22`          → `the appointment is on `
 */
export function fingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, "''")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "<DATE>")
    .replace(/\$\d[\d,.]*/g, "<MONEY>")
    .replace(/\b\d+(?:\.\d+)?\b/g, "<NUM>")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Synthesise a draft regex from a cluster of step texts. Tokenise
 * each text; for each token position, if all cluster members agree
 * use the literal token, otherwise emit a capture group `([^"']+)`.
 * Quoted literals and numbers always become captures.
 *
 * The output is a draft — the human reviewer is expected to refine
 * (anchor with `^…$`, add case-insensitivity, choose better capture
 * names, etc.).
 */
export function synthesiseRegex(texts: string[]): string {
  if (texts.length === 0) return "";
  const tokenised = texts.map((t) => tokenise(t));
  // If lengths differ across members, the cluster's tokens don't
  // align — emit a more permissive `.*?` placeholder pattern.
  const length = tokenised[0].length;
  if (!tokenised.every((tok) => tok.length === length)) {
    return "^" + escapeForRegex(texts[0]).replace(/\\?\\?"[^"]*"/g, '"([^"]+)"').replace(/<NUM>/g, "(\\d+)") + "$";
  }
  const out: string[] = [];
  for (let i = 0; i < length; i++) {
    const samples = tokenised.map((tok) => tok[i]);
    const first = samples[0];
    if (samples.every((s) => s === first)) {
      // All cluster members agree — emit the literal (escaped).
      out.push(escapeForRegex(first));
    } else {
      // Tokens vary — capture group. Use a forgiving character class
      // since varies usually = a quoted value or a number.
      out.push("(.+?)");
    }
  }
  return "^" + out.join("\\s+") + "$";
}

function tokenise(s: string): string[] {
  // Quoted strings stay as one token; everything else splits on
  // whitespace.
  const tokens: string[] = [];
  const re = /"[^"]*"|'[^']*'|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) tokens.push(m[0]);
  return tokens;
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Resolve the input arg to a concrete .jsonl path. */
async function resolveJsonlPath(inputPath: string): Promise<string> {
  const stat = await fs.stat(inputPath).catch(() => undefined);
  if (stat?.isFile()) return inputPath;
  if (stat?.isDirectory()) {
    const direct = path.join(inputPath, "candidate-rules.jsonl");
    if (await fs.pathExists(direct)) return direct;
    // Common bdd2pw layout — repo root passed in, candidate file
    // lives under `artefacts/`.
    const nested = path.join(inputPath, "artefacts", "candidate-rules.jsonl");
    if (await fs.pathExists(nested)) return nested;
  }
  throw new Error(
    `Could not find candidate-rules.jsonl at or under: ${inputPath}`,
  );
}

async function readCandidates(jsonlPath: string): Promise<CandidateRuleEntry[]> {
  const raw = await fs.readFile(jsonlPath, "utf8");
  const out: CandidateRuleEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as CandidateRuleEntry);
    } catch {
      // Skip malformed lines — they shouldn't happen, but a
      // corrupted append shouldn't kill the whole proposal run.
    }
  }
  return out;
}
