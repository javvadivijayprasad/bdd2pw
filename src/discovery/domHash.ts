/**
 * v4.2.0 — DOM snapshot hashing for POM drift detection.
 *
 * Every emitted POM carries a stable sha256 of the accessibility tree it
 * was generated from. On re-scaffold, bdd2pw compares the new snapshot's
 * hash against the one embedded in the existing POM. If they differ, the
 * UI drifted since the last scaffold — and any downstream test failure
 * suddenly has a specific, actionable explanation: "the page shape
 * changed, here are the affected fields."
 *
 * Detection triggers a `DOM DRIFT` entry in `BDD_REVIEW.md`. When
 * `--fail-on-drift` is set (or `failOnDrift: true` programmatically),
 * `scaffold()` returns `driftDetected: true` and the CLI exits with a
 * non-zero code so CI catches silent UI regressions.
 *
 * Why hash the accessibility tree (not the raw DOM):
 *  - The tree is what drives POM field selection — irrelevant DOM shifts
 *    (whitespace, comment nodes, class-name churn) shouldn't trigger a
 *    drift warning.
 *  - Deterministic canonical JSON output means identical trees always
 *    produce identical hashes, regardless of key order.
 */

import { createHash } from "node:crypto";
import type { PageSnapshot } from "./mcpClient";

/**
 * Canonical JSON stringify — sorted keys at every object level so
 * identical accessibility trees always hash to the same value even if
 * MCP delivered them with different property ordering.
 */
function canonicalStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map(
    (k) => JSON.stringify(k) + ":" + canonicalStringify(obj[k]),
  );
  return "{" + parts.join(",") + "}";
}

/**
 * Compute the sha256 hash of a page snapshot's accessibility tree.
 * Returned as lowercase hex (64 chars).
 */
export function computeDomHash(snapshot: PageSnapshot): string {
  const canonical = canonicalStringify(snapshot.accessibilityTree);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Build the POM-header comment that carries the DOM hash. Emitted at the
 * top of every generated POM immediately after any `import` block by
 * `index.ts`.
 *
 * Uses a machine-parseable format so `extractDomHashFromPom` can find
 * the value on re-scaffold. The `bdd2pw:dom-hash` tag is unique enough
 * that a naive substring match works.
 */
export function buildDomHashHeader(
  hash: string,
  url: string,
  generatedAt: Date = new Date(),
): string {
  return [
    "/**",
    " * @bdd2pw generated " + generatedAt.toISOString(),
    " * @bdd2pw dom-hash " + hash,
    " * @bdd2pw url " + url,
    " *",
    " * The dom-hash line is used by bdd2pw to detect DOM drift on",
    " * re-scaffold. Do not edit it by hand — regenerate with `bdd2pw",
    " * scaffold` or `bdd2pw update-pom` to refresh.",
    " */",
    "",
  ].join("\n");
}

/**
 * Extract the DOM hash from an existing POM file's contents. Returns
 * undefined if no hash header is present (older POM files predating
 * v4.2, or files where the header was hand-removed).
 */
export function extractDomHashFromPom(
  pomContents: string,
): string | undefined {
  const match = pomContents.match(/@bdd2pw dom-hash ([a-f0-9]{64})/);
  return match ? match[1] : undefined;
}

/**
 * Prepend the DOM-hash header to a POM file's contents. Placed above
 * any existing text (which typically starts with `import` statements).
 * If a header is already present (idempotent re-emit), it is replaced
 * rather than duplicated.
 */
export function prependDomHashHeader(
  pomContents: string,
  header: string,
): string {
  // Strip any existing @bdd2pw header block first (idempotent).
  const stripped = pomContents.replace(
    /^\/\*\*[\s\S]*?@bdd2pw dom-hash[\s\S]*?\*\/\s*\n*/,
    "",
  );
  return header + stripped;
}
