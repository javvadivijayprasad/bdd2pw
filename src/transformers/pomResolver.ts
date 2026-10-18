/**
 * POM resolver — given a requested page name and the existing POM map from
 * the repo scanner, decide reuse / augment / create. See docs/ARCHITECTURE.md §2.
 *
 * Decision table (referenced fields = field names the matched steps need):
 *   ┌────────────┬──────────────────────────────┬──────────┐
 *   │ POM exists │ all referenced fields present│ decision │
 *   ├────────────┼──────────────────────────────┼──────────┤
 *   │     no     │      n/a                     │ CREATE   │
 *   │     yes    │      yes                     │ REUSE    │
 *   │     yes    │      no                      │ AUGMENT  │
 *   └────────────┴──────────────────────────────┴──────────┘
 */

import type { PageObjectIR } from "../types";

export type PomDecision = "REUSE" | "AUGMENT" | "CREATE";

export interface ResolvePomInput {
  requestedName: string;
  existing: Map<string, PageObjectIR>;
  /** Element field names referenced by the matched steps. */
  referencedFields: string[];
}

export interface ResolvePomResult {
  decision: PomDecision;
  existing?: PageObjectIR;
  /** Field names referenced but not yet present on the existing POM. */
  missingFields: string[];
}

export function resolvePom(input: ResolvePomInput): ResolvePomResult {
  const { requestedName, existing, referencedFields } = input;
  const found = existing.get(requestedName);

  if (!found) {
    return {
      decision: "CREATE",
      missingFields: [...new Set(referencedFields)],
    };
  }

  // v4.5.5 — attestqa 2026-10-16 P0-3. Fields the scanner couldn't parse
  // (confidence === "unparseable") are placeholder entries, not real
  // locators the resolver can route steps to. Treating them as "present"
  // was what pushed the all-constructor-assigned LoginPage case into
  // REUSE instead of AUGMENT, which then dodged the overwrite guard
  // (fixed in v4.5.4) and the resulting empty-filter POM write (now
  // blocked unconditionally for REUSE at the emit site). Excluding them
  // here is the structural fix: REUSE now only happens when every
  // referenced field is REALLY present on the existing POM.
  const presentFieldNames = new Set(
    found.fields
      .filter((f) => f.confidence !== "unparseable")
      .map((f) => f.fieldName),
  );
  const missingFields = [
    ...new Set(referencedFields.filter((f) => !presentFieldNames.has(f))),
  ];

  if (missingFields.length === 0) {
    return { decision: "REUSE", existing: found, missingFields: [] };
  }

  return { decision: "AUGMENT", existing: found, missingFields };
}
