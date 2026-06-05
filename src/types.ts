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
  /**
   * v3.0.0 — flag set by API-pattern rules (page.request.*). When ANY
   * binding in a scenario is API-flagged, the renderer:
   *   1. Adds `type APIResponse` to the @playwright/test import.
   *   2. Injects `let apiResponse: APIResponse | null = null;` and
   *      `let baseUrl: string = process.env.CLOUD_JOB_APP_URL ?? "";`
   *      inside the describe block.
   *   3. Prepends `apiResponse = null;` to the test body (per-test reset).
   *
   * UI-only scenarios in the same feature don't get any of that — the
   * flag is per-binding, the emitter aggregates per-scenario.
   */
  apiContext?: true;
}

// --- Reporting -------------------------------------------------------------

export interface ReviewItem {
  severity: "info" | "warn" | "error";
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
  /**
   * v3.6.0 — optional multi-line diagnostic block. When set, the review
   * report renders each line as an indented bullet under the item.
   * Used by the rule-trace diagnostics (`ScaffoldOptions.diagnostics`)
   * to show, per unmatched step, which deterministic rules were checked
   * and why they declined.
   */
  details?: string[];
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
    /** v2.2.0 — per-step deadline (ms). Default 60_000. */
    stepTimeoutMs?: number;
    /** v2.2.0 — Anthropic SDK per-call timeout (ms). Default 30_000. */
    providerTimeoutMs?: number;
    /** v2.2.0 — governance /sanitize timeout (ms). Default 15_000. */
    governanceTimeoutMs?: number;
    /**
     * v3.5.0 — disable per-scenario LLM batching. When false (default),
     * a scenario with N unmatched steps fires ONE provider call
     * (cache-misses only). When true, each unmatched step fires its
     * own call (pre-v3.5 behavior). Flip this only if you've hit a
     * provider per-prompt token limit on large batches or need
     * strict 1:1 call accounting for audit reasons.
     */
    disableBatch?: boolean;
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
  /**
   * v3.1.0 — opt-in instrumentation. See TestForge handoff Issue 4 and
   * Issue 5.
   *
   * - `stepHooks`: every emitted `test.step` body calls
   *   `(globalThis as any).__bdd2pwHooks?.beforeStep?.(testInfo, title)`
   *   and `?.afterStep?.(...)`. Consumers wire the hook to do per-step
   *   screenshots, custom reporters, artefact uploads, etc.
   * - `stepMarkers`: each `test.step` is bracketed by stable
   *   `// bdd2pw:step-open id="NNNN" title="..."` /
   *   `// bdd2pw:step-close id="NNNN"` comments. Lets post-processors
   *   slice the source without brace counting.
   *
   * Both default to false. Existing UI / API emission paths are
   * byte-stable when these are off.
   */
  stepHooks?: boolean;
  stepMarkers?: boolean;
  /**
   * v3.2.0 — TestForge handoff Issue 9. Pin emitted devDependency
   * versions when set to `"exact"`. Default `"caret"` matches existing
   * behavior (`^1.45.0` style ranges).
   */
  dependencyStrategy?: "caret" | "exact";
  /**
   * v3.2.0 — TestForge handoff Issue 10. When true, scaffold() writes
   * `<spec-stem>.spec.meta.json` alongside each emitted spec, describing
   * every scenario's steps as { id, text, intent, locator, assertion }.
   * Lets downstream tools (visual regression, defect analysis,
   * self-healing) consume bdd2pw's semantic understanding of each step
   * without re-parsing the TS output. Off by default.
   */
  metaSidecar?: boolean;
  /**
   * v3.2.0 — TestForge handoff Issue 7. When true, scaffold() preserves
   * `// bdd2pw:user-block id="..."` ... `// bdd2pw:end-user-block`
   * sections from any existing target spec. Without merge: existing
   * specs are overwritten unconditionally (existing behavior). With
   * merge: user edits inside the named blocks survive regeneration.
   * Useful for iterative locator refinement workflows.
   */
  merge?: boolean;
  /**
   * v3.4.0 — opt-in domain rule packs. When provided, additional
   * regex rules covering domain-specific dialects are spliced into
   * the matcher BEFORE the generic UI/URL rules. Domains are additive
   * — `["banking", "healthcare"]` activates both. Each pack adds
   * ~20 patterns. See `src/transformers/domains/*.ts`.
   *
   * Default empty array — byte-stable behavior for callers that don't
   * opt in.
   */
  domains?: readonly (
    | "banking"
    | "healthcare"
    | "insurance"
    | "retail"
    | "gov"
    | "education"
    | "telecom"
  )[];
  /**
   * v3.6.0 — opt-in rule-trace diagnostics. When true, every step
   * that ends up as a warning (no rule matched + LLM either declined
   * or wasn't configured) gets a "Rule trace" block in BDD_REVIEW.md
   * listing the top-3 nearest rules with their pattern source and
   * whether each declined because it didn't match or because build()
   * declined. Helps users figure out exactly what to add as a rule.
   *
   * Default false — diagnostics are O(rules × warnings) work and
   * pollute BDD_REVIEW.md for users who don't need it.
   */
  diagnostics?: boolean;
  /**
   * v3.9.0 — opt-in LLM telemetry sidecar. When true, scaffold()
   * writes `<repo>/artefacts/llm-stats.json` with per-call detail
   * (batch size, latency, token counts, cache state) and aggregates
   * (cache hit rate, latency p50/p95, estimated cost). Makes the
   * v3.5 batching ROI measurable per scaffold.
   *
   * Off by default — operators opt in when they want to track spend
   * or debug latency issues.
   */
  llmStats?: boolean;
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
