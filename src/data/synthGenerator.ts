/**
 * v4.0.0 — Synthetic data generator.
 *
 * Reads a schema like:
 *
 *   {
 *     "email":       "faker.internet.email",
 *     "password":    "faker.internet.password",
 *     "url_fragment": "inventory.html",                  // literal
 *     "claim_desc":  "llm:auto insurance claim, one sentence"
 *   }
 *
 * Produces N `DataRow`s. Each row's fields are filled by routing the
 * source string:
 *
 *   - "faker.X.Y[.Z]..."  → dynamic dotted-path lookup on faker, called
 *                            with no args. Standard faker fields cover
 *                            >95% of test data needs.
 *   - "llm:<prompt>"      → ONE batched LLM call generates an array of
 *                            N values for the whole column. Cost-optimal:
 *                            three LLM-driven fields = three batched
 *                            calls regardless of row count.
 *   - anything else       → literal string, same value in every row.
 *
 * Determinism: faker is seeded with `opts.seed` (default 42). Same
 * seed + same schema + same row count = byte-identical output across
 * runs. LLM fields are NOT deterministic in the same way (temperature
 * is fixed at 0 but provider sampling has residual nondeterminism),
 * which is intentional — LLM-generated domain data should look
 * varied each time you regenerate.
 *
 * Why batched LLM calls per column instead of one big call for the
 * whole table: the prompt stays simple ("generate N car insurance
 * claim descriptions"), the response stays a flat JSON array (easy
 * to parse), and a column failure doesn't poison the other columns.
 */

import * as fs from "fs";
import * as path from "path";
import type { DataRow } from "./dataLoader";
import type { LLMClient } from "../llm/types";

export interface SynthSchema {
  /** field name → source spec. See module doc for syntax. */
  [columnName: string]: string;
}

export interface SynthOptions {
  /** How many rows to generate. */
  rows: number;
  /** Faker RNG seed for reproducibility. Default 42. */
  seed?: number;
  /**
   * LLM client to use for "llm:..." fields. Optional — if a schema
   * has no LLM fields you can omit this. If a schema HAS LLM fields
   * and this is undefined, those fields will be filled with the
   * source-string literal as a fallback (visible in output so the
   * user notices the gap).
   */
  llm?: LLMClient;
  /** Optional schema-relative model override for LLM calls. */
  llmModel?: string;
}

export class SynthGeneratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SynthGeneratorError";
  }
}

/**
 * Generate N rows. Returns `DataRow[]` with the same shape as
 * `loadDataFile` so downstream Examples injection works identically.
 */
export async function generateSyntheticRows(
  schema: SynthSchema,
  opts: SynthOptions,
): Promise<DataRow[]> {
  if (opts.rows <= 0) {
    throw new SynthGeneratorError(`rows must be >= 1, got ${opts.rows}`);
  }
  const seed = opts.seed ?? 42;

  // Faker is in optionalDependencies. Lazy-load so users who use only
  // literal + LLM fields don't need the dep installed. If they DO have
  // a faker.* field and the dep is missing, we throw a clean install
  // hint rather than crashing in the resolver.
  let faker: any = null;
  const hasFakerField = Object.values(schema).some((s) => s.startsWith("faker."));
  if (hasFakerField) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      faker = require("@faker-js/faker").faker;
      faker.seed(seed);
    } catch {
      throw new SynthGeneratorError(
        "@faker-js/faker not installed. Run: npm install @faker-js/faker",
      );
    }
  }

  // Pre-compute LLM column values in one batch per column.
  const llmColumns: Record<string, string[]> = {};
  for (const [col, source] of Object.entries(schema)) {
    if (source.startsWith("llm:")) {
      const prompt = source.slice(4).trim();
      if (!opts.llm) {
        // Fallback: same literal in every row, visible so the user
        // sees the gap and adds --llm to the next run.
        llmColumns[col] = Array.from(
          { length: opts.rows },
          () => `<llm-skipped: ${prompt.slice(0, 40)}>`,
        );
        continue;
      }
      llmColumns[col] = await generateLlmColumn(
        opts.llm,
        prompt,
        opts.rows,
        col,
      );
    }
  }

  // Build rows. Faker calls happen here so seeded order is stable.
  const rows: DataRow[] = [];
  for (let r = 0; r < opts.rows; r++) {
    const row: DataRow = {};
    for (const [col, source] of Object.entries(schema)) {
      if (source.startsWith("faker.")) {
        row[col] = String(callFakerPath(faker, source));
      } else if (source.startsWith("llm:")) {
        row[col] = llmColumns[col][r] ?? "";
      } else {
        // Literal string.
        row[col] = source;
      }
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Resolve a "faker.X.Y" path against the faker object and invoke the
 * leaf with no arguments. We don't currently support arg passing —
 * if a user needs `faker.internet.password({length: 32})` they can
 * generate the data offline and use --data instead. Keeping the
 * schema syntax simple is more valuable than feature parity here.
 */
function callFakerPath(faker: any, source: string): unknown {
  const segments = source.split(".").slice(1); // drop the leading "faker"
  let cursor: any = faker;
  for (let i = 0; i < segments.length; i++) {
    if (cursor == null) {
      throw new SynthGeneratorError(
        `Faker path resolved to null/undefined at segment "${segments
          .slice(0, i + 1)
          .join(".")}" of "${source}"`,
      );
    }
    cursor = cursor[segments[i]];
  }
  if (typeof cursor !== "function") {
    throw new SynthGeneratorError(
      `Faker path "${source}" does not resolve to a function (got ${typeof cursor}). ` +
        `Did you mean to add () or use a different method? See https://fakerjs.dev/api/`,
    );
  }
  return cursor();
}

/**
 * Generate N values for one column via a single LLM call.
 *
 * Uses `LLMClient.generateText()` (v4.0.0+). The method routes
 * through the same governance sanitisation, budget, timeout, and
 * telemetry pipeline as binding generation — no SDK calls escape
 * the perimeter.
 *
 * Older LLMClient implementations that don't yet ship generateText
 * (only the binding API) cause this to throw a clear hint. All three
 * built-in providers (Anthropic, OpenAI, Gemini) have generateText
 * since v4.0.
 */
async function generateLlmColumn(
  llm: LLMClient,
  prompt: string,
  count: number,
  columnName: string,
): Promise<string[]> {
  if (typeof llm.generateText !== "function") {
    throw new SynthGeneratorError(
      `LLM client does not implement generateText(). v4.0+ providers (Anthropic, OpenAI, Gemini) do. Custom LLM clients must add this method to support synthetic-data fields.`,
    );
  }

  const instruction =
    `You are generating synthetic test data for a column named "${columnName}". ` +
    `Field description: ${prompt}. Generate exactly ${count} plausible distinct values. ` +
    `Respond with ONLY a JSON array of ${count} strings, no commentary. ` +
    `Example: ["value1", "value2", "value3"]`;

  const result = await llm.generateText(instruction);

  if (result.error || !result.text) {
    throw new SynthGeneratorError(
      `LLM column generation failed for "${columnName}": ${result.error ?? "empty text response"}`,
    );
  }

  const arr = tryExtractJsonArray(result.text);
  if (!arr || arr.length === 0) {
    throw new SynthGeneratorError(
      `LLM column generation for "${columnName}" returned no parseable JSON array. ` +
        `Schema source: "${prompt}". First 200 chars of response: ${result.text.slice(0, 200)}`,
    );
  }
  return padOrTruncate(arr.map(String), count);
}

function tryExtractJsonArray(text: string): unknown[] | null {
  // Strip fenced code blocks first.
  let body = text.trim();
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) body = fence[1].trim();
  // Find first '[' and last ']' for tolerant extraction.
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function padOrTruncate(arr: string[], n: number): string[] {
  if (arr.length === n) return arr;
  if (arr.length > n) return arr.slice(0, n);
  // Pad by cycling through what we have — better than empty strings.
  const out = [...arr];
  while (out.length < n) out.push(arr[out.length % arr.length]);
  return out;
}

/**
 * Convenience: load a schema JSON from disk and validate it has at
 * least one column. Throws SynthGeneratorError on any read/parse error.
 */
export function loadSchema(schemaPath: string): SynthSchema {
  const abs = path.resolve(schemaPath);
  if (!fs.existsSync(abs)) {
    throw new SynthGeneratorError(`Schema file not found: ${schemaPath}`);
  }
  let parsed: unknown;
  try {
    let raw = fs.readFileSync(abs, "utf-8");
    // Strip UTF-8 BOM. PowerShell's `Out-File -Encoding utf8` adds one
    // by default; without this strip JSON.parse errors on the first byte.
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SynthGeneratorError(
      `Schema JSON parse error in ${schemaPath}: ${msg}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SynthGeneratorError(
      `Schema must be a JSON object of {column: source}, got: ${typeof parsed}`,
    );
  }
  const obj = parsed as Record<string, unknown>;
  if (Object.keys(obj).length === 0) {
    throw new SynthGeneratorError("Schema has zero columns");
  }
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "string") {
      throw new SynthGeneratorError(
        `Schema field "${k}" must map to a string source, got ${typeof v}`,
      );
    }
  }
  return obj as SynthSchema;
}
