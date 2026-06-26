/**
 * v4.0.0 — DataLoader + SynthGenerator + ExamplesInjector tests.
 *
 * Three logical groups in one file (kept together because they share
 * fixture data and the injector test depends on both loader and
 * generator producing the same DataRow[] shape).
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  loadDataFile,
  parseCsv,
  parseJson,
  DataLoaderError,
  validateColumnsForPlaceholders,
  type DataRow,
} from "../../src/data/dataLoader";
import {
  generateSyntheticRows,
  loadSchema,
  SynthGeneratorError,
  type SynthSchema,
} from "../../src/data/synthGenerator";
import {
  extractPlaceholders,
  injectExamples,
  reportToReviewItems,
} from "../../src/data/examplesInjector";
import type { FeatureIR, ScenarioIR } from "../../src/types";
import type {
  GenerateBindingInput,
  GenerateBindingResult,
  GenerateTextResult,
  LLMClient,
} from "../../src/llm/types";

function tmpFile(name: string, contents: string): string {
  const p = path.join(os.tmpdir(), `bdd2pw-v400-${Date.now()}-${name}`);
  fs.writeFileSync(p, contents);
  return p;
}

// --- DataLoader -------------------------------------------------------------

describe("v4.0.0 — DataLoader CSV", () => {
  it("parses a basic CSV with headers and rows", () => {
    const rows = parseCsv("a,b,c\n1,2,3\n4,5,6");
    expect(rows).toEqual([
      { a: "1", b: "2", c: "3" },
      { a: "4", b: "5", c: "6" },
    ]);
  });

  it("handles quoted fields with commas and escaped quotes", () => {
    const rows = parseCsv('name,quote\n"Smith, John","He said ""hi"""');
    expect(rows).toEqual([{ name: "Smith, John", quote: 'He said "hi"' }]);
  });

  it("handles CRLF and trailing newline", () => {
    const rows = parseCsv("a,b\r\n1,2\r\n3,4\r\n");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ a: "3", b: "4" });
  });

  it("drops blank rows", () => {
    const rows = parseCsv("a,b\n1,2\n,\n3,4");
    expect(rows).toHaveLength(2);
  });

  it("throws on empty file", () => {
    expect(() => parseCsv("")).toThrow(DataLoaderError);
  });

  it("throws on header-only", () => {
    expect(() => parseCsv("a,b")).toThrow(/header row and one data row/);
  });

  it("throws on duplicate headers", () => {
    expect(() => parseCsv("a,b,a\n1,2,3")).toThrow(/Duplicate header/);
  });

  it("throws on blank header", () => {
    expect(() => parseCsv("a,,c\n1,2,3")).toThrow(/blank column/);
  });

  it("strips UTF-8 BOM (PowerShell Out-File default)", () => {
    // ﻿ is the UTF-8 BOM as a string literal.
    const rows = parseCsv("﻿name,email\nAlice,a@x.io");
    expect(rows).toEqual([{ name: "Alice", email: "a@x.io" }]);
    // Header must NOT include the BOM character.
    expect(Object.keys(rows[0])).toEqual(["name", "email"]);
  });
});

describe("v4.0.0 — DataLoader JSON", () => {
  it("parses array-of-objects", () => {
    const rows = parseJson('[{"a":1,"b":"x"},{"a":2,"b":"y"}]');
    expect(rows).toEqual([
      { a: "1", b: "x" },
      { a: "2", b: "y" },
    ]);
  });

  it("parses {rows: [...]} envelope", () => {
    const rows = parseJson('{"rows":[{"a":1},{"a":2}]}');
    expect(rows).toEqual([{ a: "1" }, { a: "2" }]);
  });

  it("throws on bare object (not array or {rows})", () => {
    expect(() => parseJson('{"a":1}')).toThrow(/array of objects/);
  });

  it("coerces null to empty string", () => {
    const rows = parseJson('[{"a":null,"b":1}]');
    expect(rows[0]).toEqual({ a: "", b: "1" });
  });

  it("throws on malformed JSON", () => {
    expect(() => parseJson("{not json")).toThrow(/JSON parse error/);
  });

  it("strips UTF-8 BOM", () => {
    const rows = parseJson('﻿[{"a":1}]');
    expect(rows).toEqual([{ a: "1" }]);
  });
});

describe("v4.0.0 — DataLoader file routing", () => {
  it("routes .csv to parseCsv", () => {
    const p = tmpFile("users.csv", "name,email\nAlice,a@x.io");
    const rows = loadDataFile(p);
    expect(rows).toEqual([{ name: "Alice", email: "a@x.io" }]);
  });

  it("routes .json to parseJson", () => {
    const p = tmpFile("users.json", '[{"name":"Bob"}]');
    const rows = loadDataFile(p);
    expect(rows).toEqual([{ name: "Bob" }]);
  });

  it("throws on unknown extension", () => {
    const p = tmpFile("users.xml", "<x />");
    expect(() => loadDataFile(p)).toThrow(/Unsupported.*\.xml/);
  });

  it("throws on missing file", () => {
    expect(() => loadDataFile("/no/such/file.csv")).toThrow(/not found/);
  });
});

describe("v4.0.0 — DataLoader validateColumnsForPlaceholders", () => {
  it("returns empty list when all placeholders present", () => {
    const rows: DataRow[] = [{ a: "1", b: "2", c: "3" }];
    expect(validateColumnsForPlaceholders(rows, ["a", "b"])).toEqual([]);
  });

  it("returns missing names", () => {
    const rows: DataRow[] = [{ a: "1" }];
    expect(validateColumnsForPlaceholders(rows, ["a", "b", "c"])).toEqual([
      "b",
      "c",
    ]);
  });

  it("returns all placeholders when rows is empty", () => {
    expect(validateColumnsForPlaceholders([], ["a"])).toEqual(["a"]);
  });
});

// --- SynthGenerator ---------------------------------------------------------

describe("v4.0.0 — SynthGenerator", () => {
  it("loadSchema validates JSON object shape", () => {
    const p = tmpFile("schema.json", '{"email":"faker.internet.email"}');
    expect(loadSchema(p)).toEqual({ email: "faker.internet.email" });
  });

  it("loadSchema rejects array", () => {
    const p = tmpFile("schema.json", "[]");
    expect(() => loadSchema(p)).toThrow(/JSON object/);
  });

  it("loadSchema rejects non-string field source", () => {
    const p = tmpFile("schema.json", '{"x":123}');
    expect(() => loadSchema(p)).toThrow(/must map to a string/);
  });

  it("generates literal-only rows with no faker, no LLM", async () => {
    const schema: SynthSchema = {
      env: "production",
      url_fragment: "/inventory",
    };
    const rows = await generateSyntheticRows(schema, { rows: 3 });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.env === "production")).toBe(true);
    expect(rows.every((r) => r.url_fragment === "/inventory")).toBe(true);
  });

  it("LLM-driven field calls generateText with batched prompt", async () => {
    let capturedPrompt = "";
    const mockLlm: LLMClient = {
      generateBinding: async () => ({ fromCache: false }) as GenerateBindingResult,
      budgetExhausted: () => false,
      callsMade: () => 0,
      generateText: async (prompt: string): Promise<GenerateTextResult> => {
        capturedPrompt = prompt;
        return {
          text: JSON.stringify([
            "Battery degradation 18%",
            "Engine knock 2nd gear",
            "Trunk latch broken",
          ]),
        };
      },
    };
    const schema: SynthSchema = { description: "llm:auto claim description" };
    const rows = await generateSyntheticRows(schema, {
      rows: 3,
      llm: mockLlm,
    });
    expect(rows.map((r) => r.description)).toEqual([
      "Battery degradation 18%",
      "Engine knock 2nd gear",
      "Trunk latch broken",
    ]);
    expect(capturedPrompt).toMatch(/description/);
    expect(capturedPrompt).toMatch(/exactly 3/);
  });

  it("LLM column with no llm client falls back to skip-marker", async () => {
    const schema: SynthSchema = { x: "llm:something" };
    const rows = await generateSyntheticRows(schema, { rows: 2 });
    expect(rows).toHaveLength(2);
    expect(rows[0].x).toMatch(/llm-skipped/);
  });

  it("throws on rows <= 0", async () => {
    await expect(
      generateSyntheticRows({ a: "x" }, { rows: 0 }),
    ).rejects.toThrow(/rows must be >= 1/);
  });
});

// --- ExamplesInjector -------------------------------------------------------

function makeOutlineScenario(stepText: string): ScenarioIR {
  return {
    name: "Outline scenario",
    steps: [{ keyword: "When", text: stepText }],
    tags: [],
    examples: [{ username: "inline_user", password: "inline_pass" }],
  };
}

function makeVanillaScenario(): ScenarioIR {
  return {
    name: "Vanilla scenario",
    steps: [{ keyword: "Given", text: "I am on the login page" }],
    tags: [],
  };
}

function makeFeature(scenarios: ScenarioIR[]): FeatureIR {
  return {
    name: "Test feature",
    scenarios,
    tags: [],
    sourceFile: "test.feature",
  };
}

describe("v4.0.0 — ExamplesInjector extractPlaceholders", () => {
  it("finds <name> placeholders in step text", () => {
    const s = makeOutlineScenario(
      "login with <username> and <password>",
    );
    s.examples = undefined;
    expect(extractPlaceholders(s)).toEqual(["password", "username"]);
  });

  it("returns example header columns even when step has no placeholders", () => {
    const s = makeVanillaScenario();
    s.examples = [{ x: "1", y: "2" }];
    expect(extractPlaceholders(s)).toEqual(["x", "y"]);
  });

  it("returns empty list for vanilla scenario with no examples", () => {
    expect(extractPlaceholders(makeVanillaScenario())).toEqual([]);
  });
});

describe("v4.0.0 — ExamplesInjector.injectExamples", () => {
  it("swaps examples on matching Scenario Outlines", () => {
    const feature = makeFeature([
      makeOutlineScenario(
        "login as <username> with <password>",
      ),
    ]);
    const rows: DataRow[] = [
      { username: "alice", password: "p1" },
      { username: "bob", password: "p2" },
    ];
    const report = injectExamples(feature, rows);
    expect(report.swappedScenarios).toBe(1);
    expect(report.skippedScenarios).toHaveLength(0);
    expect(feature.scenarios[0].examples).toEqual(rows);
  });

  it("skips vanilla scenarios", () => {
    const feature = makeFeature([makeVanillaScenario()]);
    const report = injectExamples(feature, [{ x: "1" }]);
    expect(report.swappedScenarios).toBe(0);
    expect(report.skippedScenarios[0].reason).toMatch(/vanilla Scenario/);
  });

  it("keeps inline Examples and warns when columns are missing", () => {
    const feature = makeFeature([
      makeOutlineScenario(
        "login as <username> with <password>",
      ),
    ]);
    const rows: DataRow[] = [{ username: "alice" }]; // password missing
    const report = injectExamples(feature, rows);
    expect(report.swappedScenarios).toBe(0);
    expect(report.skippedScenarios[0].reason).toMatch(
      /missing column.*password/,
    );
    // Inline examples MUST survive.
    expect(feature.scenarios[0].examples).toEqual([
      { username: "inline_user", password: "inline_pass" },
    ]);
  });

  it("filters columns per scenario — extra data columns dropped silently", () => {
    // Clear the helper's default inline Examples so the placeholder set
    // is determined purely by step text (otherwise inline columns like
    // `password` would also count as placeholders and get preserved —
    // see extractPlaceholders for the rationale on including inline
    // Examples headers as placeholders).
    const scenario = makeOutlineScenario("login as <username>");
    scenario.examples = undefined;
    const feature = makeFeature([scenario]);
    const rows: DataRow[] = [
      { username: "alice", password: "ignored", extra: "ignored too" },
    ];
    const report = injectExamples(feature, rows);
    expect(report.swappedScenarios).toBe(1);
    expect(feature.scenarios[0].examples).toEqual([{ username: "alice" }]);
  });

  it("handles zero rows gracefully", () => {
    const feature = makeFeature([
      makeOutlineScenario("login as <username>"),
    ]);
    const report = injectExamples(feature, []);
    expect(report.swappedScenarios).toBe(0);
    expect(report.skippedScenarios[0].reason).toMatch(/zero rows/);
  });
});

describe("v4.0.0 — ExamplesInjector.reportToReviewItems", () => {
  it("emits info for swaps, warning for missing-column skips", () => {
    const items = reportToReviewItems(
      {
        totalScenarios: 2,
        swappedScenarios: 1,
        rowsPerSwap: 5,
        skippedScenarios: [
          { name: "X", reason: "data file is missing column(s): zip" },
          { name: "Y", reason: "vanilla Scenario (no <placeholders>)" },
        ],
      },
      "data/users.csv",
    );
    const severities = items.map((i) => i.severity);
    expect(severities).toEqual(["info", "warn", "info"]);
  });
});
