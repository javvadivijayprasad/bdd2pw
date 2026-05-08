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
  /**
   * LLM fallback (v2.0+) — when a Gherkin step doesn't match any
   * deterministic rule, defer to an LLM to produce the binding. Off by
   * default. Every successful binding is appended to
   * `<repo>/artefacts/candidate-rules.jsonl` for offline review (v2.0)
   * or auto-rule-write (v2.1+, deferred).
   *
   * - `provider`: "anthropic" (only provider in v2.0). v2.1+ will add
   *   "openai" and "gemini". The legacy `llm` flag in scaffold options
   *   already accepts these strings; pass it through.
   * - `model`: override the default model. Default for Anthropic is
   *   claude-sonnet-4-6.
   * - `apiKey`: API key for the provider. Defaults to
   *   `process.env.ANTHROPIC_API_KEY` when omitted.
   * - `governanceUrl`: ai-governance sidecar URL. Default
   *   http://localhost:4900. The sidecar's /sanitize endpoint scrubs
   *   every prompt before it leaves the perimeter (fail-closed).
   * - `maxCalls`: max LLM calls per scaffold. Default 50.
   * - `cachePath`: SQLite cache file. Default
   *   `<repo>/.bdd2pw/llm-cache.sqlite`. Pass ":memory:" for tests.
   * - `skipGovernance`: ONLY for tests. When true, prompts skip the
   *   sidecar. Production runs MUST keep this off.
   */
  llmConfig?: {
    provider: "anthropic";
    model?: string;
    apiKey?: string;
    governanceUrl?: string;
    maxCalls?: number;
    cachePath?: string;
    skipGovernance?: boolean;
  };
  /**
   * Enable self-healing locator integration (v1.1+).
   *
   * When true:
   *   1. Emitted POM imports `healOrThrow` from `@platform/sdk-self-healing`
   *      and wraps every locator initialiser in it.
   *   2. The scaffolder generates `lib/heal.ts` (a local TypeScript helper
   *      providing `healOrThrow`) and a `tsconfig.json` path alias mapping
   *      `@platform/sdk-self-healing` -> `./lib/heal`. Result: generated
   *      repo compiles + runs without any external SDK dependency.
   *   3. At runtime, `lib/heal.ts` registers every locator creation event
   *      to `artefacts/heal-events.jsonl` for the offline self-heal
   *      pipeline (`E:\EB1A_Research\self_healing_stage_services`) to
   *      consume.
   *
   * v1.1 scope: registration + JSONL logging only. Action-time healing
   * (catch failed `.click()` / `.fill()`, POST to /api/v1/heal, retry
   * with suggested locator) is deferred to v1.2 — pw-emit's POM uses
   * Locator objects rather than string selectors, so the existing
   * Playwright SDK's wrap-the-page approach doesn't compose; the v1.2
   * adapter wraps Locator action methods instead.
   *
   * Default: false (purely additive minor bump).
   */
  selfHealing?: boolean;
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
