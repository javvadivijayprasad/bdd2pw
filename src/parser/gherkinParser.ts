/**
 * Gherkin parser — wraps `@cucumber/gherkin` and produces a `FeatureIR`.
 * See docs/ARCHITECTURE.md §2.
 */

import * as fs from "fs-extra";
import {
  Parser,
  AstBuilder,
  GherkinClassicTokenMatcher,
} from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";
import type { FeatureIR, ScenarioIR, StepIR } from "../types";

export class GherkinParseError extends Error {
  constructor(
    message: string,
    public readonly file: string,
    public readonly line?: number,
  ) {
    super(message);
    this.name = "GherkinParseError";
  }
}

export async function parseFeature(filePath: string): Promise<FeatureIR> {
  if (!(await fs.pathExists(filePath))) {
    throw new GherkinParseError(`Feature file not found: ${filePath}`, filePath);
  }
  const source = await fs.readFile(filePath, "utf8");
  return parseFeatureSource(source, filePath);
}

export function parseFeatureSource(source: string, sourceFile: string): FeatureIR {
  const builder = new AstBuilder(IdGenerator.uuid());
  const matcher = new GherkinClassicTokenMatcher();
  const parser = new Parser(builder, matcher);

  let document: any;
  try {
    document = parser.parse(source);
  } catch (err) {
    throw new GherkinParseError(
      `Failed to parse Gherkin: ${(err as Error).message}`,
      sourceFile,
    );
  }

  const feature = document.feature;
  if (!feature) {
    throw new GherkinParseError(
      `No Feature: declaration found in ${sourceFile}`,
      sourceFile,
    );
  }

  const tags: string[] = (feature.tags ?? []).map((t: any) => t.name);
  let background: StepIR[] | undefined;
  const scenarios: ScenarioIR[] = [];

  for (const child of feature.children ?? []) {
    if (child.background) {
      background = child.background.steps.map(toStepIR);
    } else if (child.scenario) {
      scenarios.push(toScenarioIR(child.scenario));
    }
  }

  return {
    name: feature.name ?? "(unnamed feature)",
    description: feature.description?.trim() || undefined,
    background,
    scenarios,
    tags,
    sourceFile,
  };
}

function toScenarioIR(scenario: any): ScenarioIR {
  const steps: StepIR[] = (scenario.steps ?? []).map(toStepIR);
  const tags: string[] = (scenario.tags ?? []).map((t: any) => t.name);
  let examples: Record<string, string>[] | undefined;

  // Scenario Outline → flatten Examples table into row records
  if (scenario.examples && scenario.examples.length > 0) {
    examples = [];
    for (const block of scenario.examples) {
      const headers: string[] = (block.tableHeader?.cells ?? []).map(
        (c: any) => c.value,
      );
      for (const row of block.tableBody ?? []) {
        const record: Record<string, string> = {};
        const cells: any[] = row.cells ?? [];
        headers.forEach((h, i) => {
          record[h] = cells[i]?.value ?? "";
        });
        examples.push(record);
      }
    }
  }

  return {
    name: scenario.name ?? "(unnamed scenario)",
    steps,
    examples,
    tags,
  };
}

function toStepIR(step: any): StepIR {
  const keyword = String(step.keyword ?? "").trim() as StepIR["keyword"];
  const text = String(step.text ?? "").trim();
  let argument: StepIR["argument"];
  if (step.docString) {
    argument = String(step.docString.content ?? "");
  } else if (step.dataTable) {
    argument = (step.dataTable.rows ?? []).map((r: any) =>
      (r.cells ?? []).map((c: any) => String(c.value ?? "")),
    );
  }
  return { keyword, text, argument };
}

/**
 * Substitute `<placeholder>` tokens in a step's text with values from an
 * Examples row. Used by the orchestrator when expanding Scenario Outlines.
 */
export function substituteOutlinePlaceholders(
  text: string,
  row: Record<string, string>,
): string {
  return text.replace(/<([^>]+)>/g, (_m, key: string) => row[key] ?? `<${key}>`);
}
