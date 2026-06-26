/**
 * v4.0.0 — DataLoader.
 *
 * Reads CSV / JSON / XLSX into a normalized `DataRow[]` for injection
 * into Scenario Outline Examples tables.
 *
 * Normalization contract:
 *   - All values are coerced to strings (Gherkin Examples tables are
 *     always string-typed; the test code does the parsing).
 *   - Headers are trimmed; empty headers are rejected up-front so the
 *     placeholder-to-column matching downstream is deterministic.
 *   - Empty rows (all-blank cells) are dropped silently — they're
 *     a frequent artifact of hand-edited CSVs.
 *
 * Format detection is by file extension. .xlsx loading is lazy via
 * the `xlsx` optional dep — if missing, the user gets a clear
 * `npm install xlsx` error instead of a module-resolution crash.
 *
 * Error model: every loader function throws `DataLoaderError` with
 * a human-readable message. The orchestrator in `scaffold()` catches
 * this and surfaces it as a `ReviewItem` so the failure shows up in
 * BDD_REVIEW.md alongside other diagnostics — not just on stderr.
 */

import * as fs from "fs";
import * as path from "path";

/** One row of data. All values are strings (Gherkin convention). */
export type DataRow = Record<string, string>;

export class DataLoaderError extends Error {
  constructor(
    message: string,
    public readonly file?: string,
  ) {
    super(message);
    this.name = "DataLoaderError";
  }
}

/**
 * Entry point. Routes by extension to the right parser.
 *
 * @param filePath  Absolute or relative path to a .csv / .json / .xlsx file.
 * @returns         Array of rows, each a string-keyed dict.
 * @throws DataLoaderError on any read / parse / shape error.
 */
export function loadDataFile(filePath: string): DataRow[] {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new DataLoaderError(`Data file not found: ${filePath}`, filePath);
  }
  const ext = path.extname(abs).toLowerCase();
  switch (ext) {
    case ".csv":
      return parseCsv(fs.readFileSync(abs, "utf-8"), filePath);
    case ".json":
      return parseJson(fs.readFileSync(abs, "utf-8"), filePath);
    case ".xlsx":
    case ".xls":
      return parseXlsx(abs, filePath);
    default:
      throw new DataLoaderError(
        `Unsupported data file extension "${ext}". Supported: .csv, .json, .xlsx`,
        filePath,
      );
  }
}

/**
 * CSV parser — RFC 4180 compliant for the practical subset:
 *   - Quoted fields with embedded commas
 *   - Quoted fields with embedded newlines
 *   - Escaped quotes (`""` inside a quoted field)
 *   - Mixed CRLF / LF line endings
 *
 * Does NOT delegate to papaparse — keeping this dependency-free since
 * the format is small enough to handle inline and we want bdd2pw to
 * scaffold without an `npm install` step on the user's machine.
 */
export function parseCsv(text: string, fileLabel?: string): DataRow[] {
  // Strip UTF-8 BOM if present. PowerShell's `Out-File -Encoding utf8`
  // adds one by default, as do several Windows editors. Without this
  // strip, the first header gets a U+FEFF prefix and downstream column
  // matching silently fails.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // Normalize line endings, drop a trailing newline if present.
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  if (normalized.length === 0) {
    throw new DataLoaderError("CSV file is empty", fileLabel);
  }

  const lines: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < normalized.length) {
    const c = normalized[i];
    if (inQuotes) {
      if (c === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
    } else {
      if (c === '"') {
        inQuotes = true;
        i += 1;
      } else if (c === ",") {
        current.push(field);
        field = "";
        i += 1;
      } else if (c === "\n") {
        current.push(field);
        field = "";
        lines.push(current);
        current = [];
        i += 1;
      } else {
        field += c;
        i += 1;
      }
    }
  }
  // Flush last field + last row.
  current.push(field);
  lines.push(current);

  if (lines.length < 2) {
    throw new DataLoaderError(
      "CSV must have at least a header row and one data row",
      fileLabel,
    );
  }

  const headers = lines[0].map((h) => h.trim());
  validateHeaders(headers, fileLabel);

  const rows: DataRow[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = lines[r];
    if (isBlankRow(cells)) continue;
    const row: DataRow = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = (cells[c] ?? "").trim();
    }
    rows.push(row);
  }
  if (rows.length === 0) {
    throw new DataLoaderError(
      "CSV had a header row but no non-empty data rows",
      fileLabel,
    );
  }
  return rows;
}

/**
 * JSON parser — accepts either:
 *   1. Array of objects: `[{a:1,b:2}, {a:3,b:4}]` — most natural shape.
 *   2. Object with `rows`: `{rows: [{...}, {...}]}` — useful for files
 *      that also carry metadata (generator seed, source URL, etc).
 *
 * Numbers and booleans are stringified for Gherkin Examples compatibility.
 * Null values become empty strings.
 */
export function parseJson(text: string, fileLabel?: string): DataRow[] {
  // Strip UTF-8 BOM (see parseCsv for rationale).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DataLoaderError(`JSON parse error: ${msg}`, fileLabel);
  }
  let raw: unknown[];
  if (Array.isArray(parsed)) {
    raw = parsed;
  } else if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { rows?: unknown }).rows)
  ) {
    raw = (parsed as { rows: unknown[] }).rows;
  } else {
    throw new DataLoaderError(
      'JSON must be an array of objects OR an object with a "rows" array',
      fileLabel,
    );
  }
  if (raw.length === 0) {
    throw new DataLoaderError(
      "JSON contained zero rows",
      fileLabel,
    );
  }
  const rows: DataRow[] = [];
  let headersSeen: Set<string> | null = null;
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new DataLoaderError(
        `Every JSON row must be a plain object; got: ${JSON.stringify(item)?.slice(0, 80)}`,
        fileLabel,
      );
    }
    const obj = item as Record<string, unknown>;
    const row: DataRow = {};
    for (const [k, v] of Object.entries(obj)) {
      row[k] = v === null || v === undefined ? "" : String(v);
    }
    if (!headersSeen) {
      headersSeen = new Set(Object.keys(row));
      validateHeaders(Array.from(headersSeen), fileLabel);
    }
    rows.push(row);
  }
  return rows;
}

/**
 * XLSX parser — uses the optional `xlsx` dep. Reads the FIRST sheet
 * only; users with multi-sheet workbooks should export the sheet they
 * want to CSV.
 *
 * Lazy-loaded so users who never use XLSX don't need the dep installed.
 */
export function parseXlsx(absPath: string, fileLabel?: string): DataRow[] {
  let xlsx: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    xlsx = require("xlsx");
  } catch {
    throw new DataLoaderError(
      "xlsx package not installed. Run: npm install xlsx",
      fileLabel,
    );
  }
  const wb = xlsx.readFile(absPath);
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) {
    throw new DataLoaderError("XLSX has no sheets", fileLabel);
  }
  const sheet = wb.Sheets[firstSheetName];
  // sheet_to_json with header:1 returns array of arrays — we then
  // promote first row to headers ourselves so the validation flow
  // matches the CSV path exactly.
  const aoa: unknown[][] = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  });
  if (aoa.length < 2) {
    throw new DataLoaderError(
      "XLSX must have at least a header row and one data row",
      fileLabel,
    );
  }
  const headers = aoa[0].map((h) => String(h ?? "").trim());
  validateHeaders(headers, fileLabel);
  const rows: DataRow[] = [];
  for (let r = 1; r < aoa.length; r++) {
    const cells = aoa[r];
    if (isBlankRow(cells.map((c) => String(c ?? "")))) continue;
    const row: DataRow = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = String(cells[c] ?? "").trim();
    }
    rows.push(row);
  }
  if (rows.length === 0) {
    throw new DataLoaderError(
      "XLSX had a header row but no non-empty data rows",
      fileLabel,
    );
  }
  return rows;
}

// --- helpers ----------------------------------------------------------------

function validateHeaders(headers: string[], fileLabel?: string): void {
  if (headers.length === 0) {
    throw new DataLoaderError("No headers found", fileLabel);
  }
  const blanks = headers
    .map((h, i) => (h.length === 0 ? i : -1))
    .filter((i) => i >= 0);
  if (blanks.length > 0) {
    throw new DataLoaderError(
      `Header row has blank column(s) at index: ${blanks.join(", ")}`,
      fileLabel,
    );
  }
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const h of headers) {
    if (seen.has(h)) dupes.push(h);
    seen.add(h);
  }
  if (dupes.length > 0) {
    throw new DataLoaderError(
      `Duplicate header(s): ${[...new Set(dupes)].join(", ")}`,
      fileLabel,
    );
  }
}

function isBlankRow(cells: string[]): boolean {
  return cells.every((c) => (c ?? "").toString().trim() === "");
}

/**
 * Validates that the loaded data rows have every column the Scenario
 * Outline placeholders reference. Returns the list of missing column
 * names; empty array means OK.
 *
 * Called by the scaffold orchestrator after parsing the .feature file.
 * If anything is missing, the orchestrator surfaces it as a
 * `ReviewItem` and skips Examples injection for that scenario rather
 * than producing a broken spec.
 */
export function validateColumnsForPlaceholders(
  rows: DataRow[],
  placeholders: string[],
): string[] {
  if (rows.length === 0) return placeholders;
  const presentColumns = new Set(Object.keys(rows[0]));
  return placeholders.filter((p) => !presentColumns.has(p));
}
