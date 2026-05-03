/**
 * Intermediate representation (IR) shared across parser, transformers, and emitters.
 * See docs/SCOPE.md §13 for the canonical shape.
 */

// --- Gherkin source --------------------------------------------------------

export interface FeatureIR {
  name: string;
  description?: string;
  background?: StepIR[];
  scenarios: ScenarioIR[];
  tags: string[];
  sourceFile: string;
}

export interface ScenarioIR {
  name: string;
  steps: StepIR[];
  /** Populated for `Scenario Outline` — one row per `Examples:` entry. */
  examples?: Record<string, string>[];
  tags: string[];
}

export interface StepIR {
  keyword: "Given" | "When" | "Then" | "And" | "But";
  text: string;
  /** Doc string or data table argument when present. */
  argument?: string | string[][];
}

// --- Page / element discovery ---------------------------------------------

export interface ElementIR {
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  testId?: string;
  text?: string;
  cssSelector?: string;
  xpath?: string;
  tag: string;
  bounds?: { x: number; y: number; w: number; h: number };
}

export interface LocatorChoice {
  api:
    | "getByRole"
    | "getByLabel"
    | "getByPlaceholder"
    | "getByTestId"
    | "getByText"
    | "locator";
  args: string;
  /** camelCase TS field name (e.g. `submitButton`). */
  fieldName: string;
  source: ElementIR;
  confidence: "unique" | "ambiguous" | "fallback";
}

// --- Page Object IR --------------------------------------------------------

export interface PageObjectIR {
  className: string;
  filePath: string;
  url?: string;
  fields: LocatorChoice[];
  methods: PomMethodIR[];
  /** True when the file already exists on disk and we're augmenting. */
  exists: boolean;
}

export interface PomMethodIR {
  name: string;
  params: { name: string; type: string }[];
  /** Pre-rendered TS body. */
  body: string;
  origin: "existing" | "generated";
}

// --- Step → POM binding ----------------------------------------------------

export interface StepBinding {
  step: StepIR;
  pomCall?: { page: string; method: string; args: string[] };
  assertion?: { locator: string; matcher: string; expected?: string };
  /**
   * Pre-rendered body for compound steps (one Gherkin step → multiple TS
   * statements). When present, the emitter writes `customBody` verbatim
   * instead of synthesising lines from `pomCall` / `assertion`.
   * Example: `When user enter email "x" password "y"` → two `.fill()` lines.
   */
  customBody?: string;
  /** Populated when no clean mapping was found. */
  warning?: string;
}

// --- Reporting -------------------------------------------------------------

export interface ReviewItem {
  severity: "info" | "warn" | "error";
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
}

// --- Top-level results -----------------------------------------------------

export interface ScaffoldOptions {
  feature: string;
  url: string;
  page: string;
  repo: string;
  pages?: string[];
  storageState?: string;
  headed?: boolean;
  llm?: "anthropic" | "openai" | "gemini";
  governanceUrl?: string;
  templates?: string;
  dryRun?: boolean;
  noValidate?: boolean;
  telemetry?: boolean;
  force?: boolean;
  /**
   * Skip page discovery entirely — use an empty element list. Useful for
   * rule-only probing (CI, offline analysis, "what does the matcher do
   * with this feature?" investigations). Synthesised goto() still works
   * because it uses `--url` directly. Field-referencing rules will fall
   * to TODO since the POM has no fields.
   */
  noDiscovery?: boolean;
  /**
   * If set, read snapshot from this JSON file instead of launching a
   * browser. Phase 1a fallback; also used by regression tests for
   * offline runs.
   */
  snapshotFile?: string;
}

export interface ScaffoldResult {
  filesWritten: string[];
  reviewItems: ReviewItem[];
  tscErrorCount: number;
  reviewReportPath: string;
}

export interface AnalyzeOptions {
  feature: string;
  url: string;
  storageState?: string;
  headed?: boolean;
}

export interface AnalyzeResult {
  feature: FeatureIR;
  discoveredLocators: LocatorChoice[];
  bindings: StepBinding[];
  warnings: ReviewItem[];
}

export interface UpdatePomOptions {
  page: string;
  url: string;
  repo: string;
  storageState?: string;
  headed?: boolean;
  templates?: string;
}

export interface UpdatePomResult {
  added: { fields: number; methods: number };
  preserved: { fields: number; methods: number };
  filePath: string;
  reviewItems: ReviewItem[];
}
