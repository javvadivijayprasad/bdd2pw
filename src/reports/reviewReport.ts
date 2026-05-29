/**
 * Generate `BDD_REVIEW.md` — every warning, fallback, ambiguity, and
 * `tsc --noEmit` diagnostic for human review. See docs/ARCHITECTURE.md §10.
 *
 * The report is the deliverable, not a clean compile (FR-12). Sections:
 *   1. Summary  (counts by severity)
 *   2. Errors   (block testing — fix first)
 *   3. Warnings (likely correct but worth a glance)
 *   4. Info     (FYI, ambiguous locators, fallback steps, etc.)
 *   5. Manual TODOs — every step that fell through to a TODO comment
 */

import * as fs from "fs-extra";
import * as path from "path";
import type { ReviewItem } from "../types";

export interface WriteReviewInput {
  repoRoot: string;
  items: ReviewItem[];
  feature: string;
  url: string;
}

export async function writeReviewReport(input: WriteReviewInput): Promise<string> {
  const lines: string[] = [];
  const counts = {
    error: input.items.filter((i) => i.severity === "error").length,
    warn: input.items.filter((i) => i.severity === "warn").length,
    info: input.items.filter((i) => i.severity === "info").length,
  };

  lines.push("# bdd2pw — Conversion Review");
  lines.push("");
  lines.push(`> **Source feature:** \`${input.feature}\``);
  lines.push(`> **Target URL:** ${input.url}`);
  lines.push(`> **Generated:** ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(
    `${counts.error} error${counts.error === 1 ? "" : "s"} · ${counts.warn} warning${counts.warn === 1 ? "" : "s"} · ${counts.info} info`,
  );
  lines.push("");

  emitSection(lines, "Errors", "error", input.items);
  emitSection(lines, "Warnings", "warn", input.items);
  emitSection(lines, "Info", "info", input.items);

  if (input.items.length === 0) {
    lines.push("Nothing to review — everything mapped cleanly. Run `npx playwright test` to verify.");
    lines.push("");
  }

  const outPath = path.join(input.repoRoot, "BDD_REVIEW.md");
  await fs.ensureDir(input.repoRoot);
  await fs.writeFile(outPath, lines.join("\n"), "utf8");
  return outPath;
}

function emitSection(
  lines: string[],
  heading: string,
  severity: ReviewItem["severity"],
  items: ReviewItem[],
): void {
  const filtered = items.filter((i) => i.severity === severity);
  if (filtered.length === 0) return;
  lines.push(`## ${heading}`);
  lines.push("");
  for (const item of filtered) {
    const loc =
      item.file !== undefined
        ? `\`${item.file}${item.line ? `:${item.line}` : ""}\` — `
        : "";
    lines.push(`- ${loc}${item.message}`);
    if (item.suggestion) {
      lines.push(`  - Suggestion: ${item.suggestion}`);
    }
    // v3.6.0 — render the optional diagnostics block as indented
    // bullets so the rule-trace stays nested under its parent warning.
    if (item.details && item.details.length > 0) {
      lines.push(`  - Rule trace:`);
      for (const d of item.details) {
        lines.push(`    - ${d}`);
      }
    }
  }
  lines.push("");
}
