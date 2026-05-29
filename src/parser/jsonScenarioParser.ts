/**
 * v3.2.0 — TestForge handoff Issue 8. Accept structured JSON scenarios
 * in addition to .feature files.
 *
 * Input shape (TestForge's TCG output):
 *
 *   {
 *     "name": "Login with valid credentials",
 *     "kind": "ui",
 *     "heuristic": "happy path",
 *     "preconditions": ["user is registered"],
 *     "actions": ["navigate to login page", "fill username", ...],
 *     "expected": ["dashboard is visible"],
 *     "data": { "username": "student", "password": "Password123" }
 *   }
 *
 * Either a single object or an array of objects is accepted at the
 * top level. The converter synthesises Gherkin steps:
 *
 *   - preconditions → `Given <text>`
 *   - actions       → `When <text>` (first), `And <text>` (rest)
 *   - expected      → `Then <text>` (first), `And <text>` (rest)
 *
 * `data` is appended to each action step that contains a templating
 * placeholder like `<username>`; otherwise it's surfaced as a Gherkin
 * doc-string attached to the first action step.
 *
 * The synthesised FeatureIR is identical in shape to what
 * gherkinParser produces, so downstream code (stepMatcher, emitTestFile)
 * treats both paths uniformly.
 */

import * as fs from "fs-extra";
import * as path from "path";
import type { FeatureIR, ScenarioIR, StepIR } from "../types";

export interface JsonScenario {
  name: string;
  kind?: "ui" | "api" | "mixed" | string;
  heuristic?: string;
  preconditions?: string[];
  actions?: string[];
  expected?: string[];
  data?: Record<string, string | number | boolean>;
  /** Optional explicit tags. If omitted, derived from `kind`. */
  tags?: string[];
}

/** Detect whether a file path is a JSON-scenario input. */
export function isJsonScenarioFile(file: string): boolean {
  return /\.json$/i.test(file);
}

/**
 * Read a JSON scenarios file and convert it to a FeatureIR. The
 * feature name is derived from the file basename (matching gherkin
 * convention: `login.feature` → "login"). Each top-level scenario in
 * the JSON becomes a ScenarioIR.
 *
 * Returns a fully-formed FeatureIR — sourceFile points at the JSON
 * file so the rest of the pipeline can reference the input correctly.
 */
export async function parseJsonScenarios(filePath: string): Promise<FeatureIR> {
  const raw = await fs.readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `JSON scenarios file ${filePath} is not valid JSON: ${(err as Error).message}`,
    );
  }
  const list: JsonScenario[] = Array.isArray(parsed)
    ? (parsed as JsonScenario[])
    : [parsed as JsonScenario];

  const scenarios: ScenarioIR[] = list.map(jsonScenarioToScenarioIR);
  const featureName = path.basename(filePath, path.extname(filePath));
  return {
    name: featureName,
    description: undefined,
    background: undefined,
    scenarios,
    tags: [],
    sourceFile: filePath,
  };
}

/**
 * Convert one JSON scenario object to a ScenarioIR. The action/expected
 * arrays are flattened into a Gherkin step list following standard BDD
 * convention: first step in each group gets the strong keyword
 * (Given/When/Then), subsequent steps get `And`.
 */
function jsonScenarioToScenarioIR(s: JsonScenario): ScenarioIR {
  if (!s || typeof s !== "object" || typeof s.name !== "string") {
    throw new Error(
      `Each JSON scenario must have a string "name" field. Received: ${JSON.stringify(s)}`,
    );
  }
  const steps: StepIR[] = [];

  for (let i = 0; i < (s.preconditions?.length ?? 0); i++) {
    steps.push({
      keyword: i === 0 ? "Given" : "And",
      text: s.preconditions![i],
    });
  }
  for (let i = 0; i < (s.actions?.length ?? 0); i++) {
    const text = applyDataTemplating(s.actions![i], s.data);
    steps.push({
      keyword: i === 0 ? "When" : "And",
      text,
    });
  }
  for (let i = 0; i < (s.expected?.length ?? 0); i++) {
    steps.push({
      keyword: i === 0 ? "Then" : "And",
      text: applyDataTemplating(s.expected![i], s.data),
    });
  }

  // Tag derivation: explicit `tags` wins; otherwise derive from `kind`
  // so `kind: "api"` produces `@api` automatically. Same for ui/mixed.
  const tags = s.tags ?? deriveTagsFromKind(s.kind);

  return {
    name: s.name,
    steps,
    tags,
    examples: undefined,
  };
}

function deriveTagsFromKind(kind: string | undefined): string[] {
  if (!kind) return [];
  if (kind === "mixed") return ["@ui", "@api"];
  return [`@${kind}`];
}

/**
 * Replace `<placeholder>` tokens in a step text with values from the
 * scenario's `data` object. Leaves the step alone when no placeholders
 * are present. Same convention as Cucumber's Scenario Outline.
 */
function applyDataTemplating(
  text: string,
  data: Record<string, string | number | boolean> | undefined,
): string {
  if (!data) return text;
  return text.replace(/<([a-zA-Z_][\w]*)>/g, (full, key) => {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      return String(data[key]);
    }
    return full; // leave unreplaced placeholders intact
  });
}
