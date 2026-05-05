# bdd2pw — Scope & Requirements (v1.0)

> **Status:** v1.0 functionally complete — all six phases shipped, 101 / 101
> tests green, two real-world fixtures locked. Awaiting only the version bump
> + tag. See [`STATUS.md`](./STATUS.md) for the runtime snapshot.
> **Author:** Vijay Prasad
> **Last updated:** 2026-05-03 (originally drafted 2026-05-02)

---

## 1. Purpose

Take a Gherkin `.feature` file (produced by the team's `test-case-generation-service`) and a target URL, and emit a **runnable Playwright TypeScript test suite** — Page Objects + spec files + project scaffold — into a target repo. Generation is **rule-based first, LLM-fallback second**, governed through the existing `ai-governance` sidecar.

The promise: `feature in → ready-to-run tests out`. Locator drift at runtime is handled by the existing `self-healing-stage-services`; `bdd2pw` does not duplicate that.

## 2. Where it fits in the platform

| Stage | Service | Role |
|---|---|---|
| 1. Generate | `test-case-generation-service` (FastAPI :4100) | Author `.feature` files from requirements |
| 1.5. **Scaffold** | **`bdd2pw` (new, this doc)** | `.feature` + URL → POM + spec, ready to run |
| 2. Migrate | `sel2pw` (Express :4200) | Legacy Selenium → Playwright |
| 3. Stabilise | `self-healing-stage-services` (FastAPI :8003) | Heal locators at runtime |
| 4. Govern | `ai-governance` (Python lib + sidecar) | Sanitise every LLM payload |
| Orchestrate | `modern-automation-platform` (Express :3000) | Auth, jobs, UI, artifacts |

`bdd2pw` is a **peer** of `sel2pw`, not a child. Different input (Gherkin, not Java) but the **same emitter layer**. Suggested refactor: lift `pageObjectEmitter`, `testClassEmitter`, and locator-priority logic out of `sel2pw` into a shared `@vijaypjavvadi/pw-emit` package so both tools produce byte-identical POM/spec shapes.

## 3. Primary persona & use case

**Persona:** QA engineer or SDET on a team that already runs `test-case-generation-service` to produce BDD `.feature` files. They want those features executable as Playwright TS tests without hand-coding Page Objects.

**Primary flow:**
```
$ bdd2pw scaffold ./features/login.feature \
    --url https://app.example.com/login \
    --page LoginPage \
    --repo ./my-playwright-suite
```
After this command the user can `cd ./my-playwright-suite && npx playwright test` and the new spec runs.

## 4. In scope (v1.0)

| # | Capability |
|---|---|
| S-1 | Parse Gherkin `.feature` files via `@cucumber/gherkin`. Multiple scenarios per file supported. |
| S-2 | `--url <URL>` per command. Future: per-scenario URL via `Background:` annotation. |
| S-3 | `--page <Name>` and `--pages <Name1,Name2>` flags for explicit POM names. |
| S-4 | Detect existing Page Object in the target repo at `pages/<name>.page.ts` using `ts-morph` AST inspection. Three branches: reuse / augment / create. |
| S-5 | Element discovery via Microsoft Playwright MCP (`@playwright/mcp`) — launch browser, navigate to URL, dump accessibility tree + DOM snapshot. |
| S-6 | Locator selection in priority order: `getByRole` → `getByLabel` → `getByPlaceholder` → `getByTestId` → `getByText` → CSS → xpath last. |
| S-7 | Emit Page Object class: `readonly` `Locator` fields initialised in constructor; action methods (`click*`, `fill*`); assertion helpers (`expect*`). |
| S-8 | Emit spec file: one `test()` per Gherkin scenario, mapping each step to POM method calls + `expect()` assertions. `Background:` → `test.beforeEach`. Scenario Outline + Examples → `test.describe.parallel` with parameterised cases. |
| S-9 | Scaffold a Playwright TS project if `--repo` does not exist or lacks `playwright.config.ts`: copy template (same template approach as `sel2pw`). |
| S-10 | Validate output by running `tsc --noEmit` against emitted files and report errors in `BDD_REVIEW.md`. |
| S-11 | LLM fallback for steps that don't deterministically map (e.g. "When I complete checkout with valid card details"). All LLM calls routed through `ai-governance` sanitiser. Providers: Anthropic / OpenAI / Gemini, configurable. |
| S-12 | CLI commands: `scaffold`, `analyze` (dry-run), `update-pom` (re-scan a URL and merge new locators into existing POM without touching tests). |
| S-13 | Programmatic API: `import { scaffold, analyze, updatePom } from '@vijaypjavvadi/bdd2pw'`. |
| S-14 | Same review-report pattern as `sel2pw`: every ambiguity, fallback, or skipped step listed in `BDD_REVIEW.md`. |
| S-15 | SQLite failure telemetry (reuse `sel2pw`'s telemetry module) so recurring "step text → no POM mapping" gaps become one-line patches. |
| S-16 | **HTTP service** on port `:4300` (parity with `sel2pw:4200`). Endpoints: `POST /scaffold`, `POST /analyze`, `POST /update-pom`, `GET /jobs/:id`, `GET /jobs/:id/artifact`, `GET /healthz`, `GET /readyz`. Reachable through the platform gateway at `/api/v1/scaffold/*`. |
| S-17 | **Async job model** for HTTP — long-running scans (MCP browser launch + LLM calls) must not block HTTP requests. Each `POST` returns `202 Accepted` + `jobId`; client polls `GET /jobs/:id`; final artifact downloaded as a zip from `GET /jobs/:id/artifact`. |
| S-18 | **Phase 0 dep — `@vijaypjavvadi/pw-emit`**. Shared emitter package extracted from `sel2pw` (`pageObjectEmitter`, `testClassEmitter`, `projectEmitter`, locator-priority helpers, naming utils). Both `sel2pw` and `bdd2pw` consume it. Cuts shape/style drift to zero. |

## 5. Out of scope (v1.0)

| # | Deferred capability |
|---|---|
| O-1 | Auth flows (login, OAuth, MFA). User must provide a logged-in storage state if scanning protected pages. Roadmap v1.1. |
| O-2 | Multi-page navigation discovery. v1.0 scans one URL per command; multi-page sequences require multiple invocations. |
| O-3 | Visual regression baselines. |
| O-4 | API mocking / network interception scaffolding. |
| O-5 | Self-healing at generation time. (Already handled by `self-healing-stage-services` at runtime.) |
| O-6 | Cucumber-JS as the runtime. v1.0 emits **plain Playwright tests**, not `playwright-bdd` or `@cucumber/cucumber` runners. The `.feature` is a generation input, not a runtime artefact. (Optional `playwright-bdd` mode flagged for v1.1.) |
| O-7 | Non-Gherkin BDD formats (JSON/YAML/custom). Gherkin only in v1.0. |
| O-8 | Multi-tenant HTTP — v1.0 HTTP is single-tenant per process. Multi-tenancy + auth done at the gateway (`modern-automation-platform:3000`), same pattern as `sel2pw`. |

## 6. Inputs

```
Required:
  <feature-file>      Path to a .feature file (Gherkin)
  --url <url>         URL to scan with Playwright MCP
  --page <Name>       Page Object class name (PascalCase)
  --repo <dir>        Target Playwright TS repo (created if missing)

Optional:
  --pages <a,b,c>     Multiple POMs for multi-page scenarios
  --storage-state <path>   Pre-authenticated storage state JSON
  --headed            Show browser during MCP scan (default: headless)
  --llm <provider>    anthropic | openai | gemini (default: off)
  --governance-url <url>   ai-governance sidecar (default: http://localhost:8004)
  --templates <dir>   Override default project template
  --dry-run           Print plan, write nothing
  --no-validate       Skip tsc --noEmit step
```

## 7. Outputs

```
<repo>/
├── package.json                 (created if missing)
├── playwright.config.ts         (created if missing)
├── tsconfig.json                (created if missing)
├── pages/
│   └── login.page.ts            (created or augmented)
├── tests/
│   └── login.spec.ts            (created — one per .feature)
├── fixtures/
│   └── auth.setup.ts            (only if --storage-state given)
└── BDD_REVIEW.md                (always — warnings + manual TODOs)
```

## 8. CLI surface (Commander)

```
bdd2pw scaffold <feature> --url <url> --page <Name> --repo <dir> [options]
bdd2pw analyze  <feature> --url <url> [options]      # dry-run, prints plan + locator preview
bdd2pw update-pom --page <Name> --url <url> --repo <dir>   # re-scan, merge new locators, leave specs untouched
bdd2pw serve [--port 4300]                            # start HTTP service
bdd2pw --version
bdd2pw --help
```

## 8b. HTTP API surface (Express, port `:4300`)

```
POST   /scaffold          body: { feature, url, page, repo, options }   → 202 { jobId }
POST   /analyze           body: { feature, url, options }               → 202 { jobId }
POST   /update-pom        body: { page, url, repo, options }            → 202 { jobId }
GET    /jobs/:id          → 200 { id, status, progress, warnings[], errors[] }
GET    /jobs/:id/artifact → 200 application/zip  (the emitted repo)
GET    /jobs/:id/log      → 200 text/plain      (structured pino log tail)
GET    /healthz           → 200 { ok: true }
GET    /readyz            → 200 { ok: true, mcp: true, governance: true }
GET    /version           → 200 { name, version, commit }
```

All `POST` bodies validated with Zod. All endpoints behind the gateway at `/api/v1/scaffold/*` for production use; direct `:4300` exposure is local-dev only.

## 9. Pipeline

```
┌──────────────────┐
│  .feature file   │  Gherkin source (from test-case-generation-service)
└────────┬─────────┘
         ▼
┌──────────────────┐
│ gherkin parser   │  @cucumber/gherkin → Feature IR (scenarios, steps, examples)
└────────┬─────────┘
         ▼
┌──────────────────┐
│  repo scanner    │  ts-morph reads pages/*.page.ts → existing POM IR
└────────┬─────────┘
         ▼
┌──────────────────┐
│  POM resolver    │  decides: reuse | augment | create per --page
└────────┬─────────┘
         ▼
┌──────────────────┐
│ MCP page scanner │  @playwright/mcp → navigate URL → a11y tree + DOM snapshot
└────────┬─────────┘    (only when augment | create)
         ▼
┌──────────────────┐
│ locator picker   │  rank candidates by stability, dedupe, name elements
└────────┬─────────┘
         ▼
┌──────────────────┐
│ step matcher     │  Gherkin step text → POM method (rule-based, LLM fallback)
└────────┬─────────┘
         ▼
┌──────────────────┐
│    emitters      │  pageObjectEmitter · testEmitter · projectEmitter
└────────┬─────────┘    (shared with sel2pw via @vijaypjavvadi/pw-emit)
         ▼
┌──────────────────┐
│   validator      │  tsc --noEmit → errors into BDD_REVIEW.md
└────────┬─────────┘
         ▼
   ready-to-run repo
```

## 10. Functional requirements

| ID | Requirement |
|---|---|
| FR-1 | The CLI MUST accept a `.feature` path and validate it parses cleanly with `@cucumber/gherkin` before any other work. |
| FR-2 | If the target repo lacks `playwright.config.ts`, the CLI MUST scaffold a fresh Playwright TS project from the template before emitting tests. |
| FR-3 | The repo scanner MUST read existing `pages/*.page.ts` files via TypeScript AST (not regex) and build a map of `{ pageName → { fields, methods } }`. |
| FR-4 | If the requested `--page <Name>` exists in the repo, the tool MUST NOT overwrite it; it MUST augment additively (add missing locators + methods only). |
| FR-5 | Element discovery MUST use Microsoft Playwright MCP. The tool MUST shell out to `npx @playwright/mcp` (or import its programmatic API if exposed) and capture the accessibility snapshot. |
| FR-6 | Locator selection MUST follow Playwright's recommended priority: `getByRole` > `getByLabel` > `getByPlaceholder` > `getByTestId` > `getByText` > CSS > xpath. The chosen locator MUST be unique on the page (verify against the snapshot). |
| FR-7 | Emitted Page Object classes MUST follow the same shape as `sel2pw` output: `readonly` fields, ctor-initialised, async action methods, named after the element role + label. |
| FR-8 | Each Gherkin scenario MUST become exactly one `test()` block. `Background:` MUST become `test.beforeEach`. `Scenario Outline` + `Examples:` MUST become `test.describe` with one `test()` per row. |
| FR-9 | Step text → POM method mapping MUST be deterministic for the standard verb set (`click`, `enter`, `select`, `see`, `not see`, `navigate`, `wait`). Anything outside this set MUST either match a registered custom rule or fall through to LLM (if enabled) or fail with an actionable error in `BDD_REVIEW.md`. |
| FR-10 | All LLM calls MUST POST through the `ai-governance` sidecar. No direct calls to provider APIs. |
| FR-11 | After emit, the tool MUST run `tsc --noEmit` against the output and write any errors to `BDD_REVIEW.md` with file paths and line numbers. |
| FR-12 | The tool MUST exit non-zero only on hard failures (parse errors, MCP unreachable, repo unwritable). TypeScript errors MUST exit zero with a warning summary — same philosophy as `sel2pw`: the review report is the deliverable, not a clean compile. |
| FR-13 | `update-pom` MUST re-scan a URL and merge new locators into an existing POM **without** modifying any spec file or removing any existing field/method. |
| FR-14 | All file writes MUST be Prettier-formatted before disk write. |
| FR-15 | The HTTP service MUST accept the same inputs as the CLI and produce byte-identical output. The CLI internally calls the same `scaffold()` / `analyze()` / `updatePom()` functions the HTTP routes call. |
| FR-16 | HTTP `POST` endpoints MUST return `202 Accepted + { jobId }` immediately. Job execution runs in a worker promise; status reachable via `GET /jobs/:id`. Jobs are kept for 24 h then purged. |
| FR-17 | `GET /jobs/:id/artifact` MUST stream a zip of the emitted repo (excluding `node_modules`). |
| FR-18 | All HTTP endpoints MUST validate request bodies with Zod and reject malformed input with `400 + { error, details }`. |
| FR-19 | The shared `@vijaypjavvadi/pw-emit` package MUST expose stable named exports (`emitPageObject`, `emitTestFile`, `emitProject`, `pickLocator`, `pascalCase`, `kebabCase`) and SemVer them. Both `bdd2pw` and `sel2pw` consume it as a regular dependency. |

## 11. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | Scaffold a typical 1-feature, 5-scenario, 1-page input in **under 30 seconds** end-to-end (excluding first-run MCP browser download). |
| NFR-2 | Zero PII or app data leaves the user's machine unless `--llm` is explicitly enabled, and even then only via the governance sidecar. |
| NFR-3 | Node ≥ 18, cross-platform (Windows / macOS / Linux), distributed as both an npm package and a standalone Windows `.exe` (reuse `sel2pw`'s `@yao-pkg/pkg` build). |
| NFR-4 | Vitest unit + snapshot coverage ≥ 80% on the `parser`, `transformers`, `emitters` directories before v1.0 ships. |
| NFR-5 | All public TS APIs documented via TypeDoc, published to GitHub Pages. |
| NFR-6 | Structured logging via `pino` (same logger config as `sel2pw`). |

## 12. Architecture

```
src/
├── cli.ts                          Commander entry (scaffold | analyze | update-pom | serve)
├── server.ts                       Express HTTP service (:4300)
├── index.ts                        public scaffold() / analyze() / updatePom() API
├── types.ts                        IR — FeatureIR, ScenarioIR, StepIR, PageObjectIR, ElementIR
├── parser/
│   └── gherkinParser.ts            @cucumber/gherkin → FeatureIR
├── repo/
│   ├── repoScanner.ts              ts-morph → existing POM map
│   └── projectScaffolder.ts        creates Playwright TS skeleton if missing
├── discovery/
│   ├── mcpClient.ts                wraps @playwright/mcp
│   └── snapshotParser.ts           a11y tree → ElementIR[]
├── transformers/
│   ├── locatorPicker.ts            rank + dedupe locator candidates
│   ├── pomResolver.ts              reuse | augment | create decision
│   └── stepMatcher.ts              Gherkin step → POM method call (rules + LLM)
├── emitters/
│   └── facade.ts                   thin wrapper over @vijaypjavvadi/pw-emit
├── http/
│   ├── routes.ts                   POST /scaffold, /analyze, /update-pom
│   ├── jobs.ts                     in-memory job store (SQLite-backed in v1.1)
│   ├── artifacts.ts                zip + stream emitted repo
│   └── schemas.ts                  Zod request/response validators
├── llm/
│   ├── governanceClient.ts         posts to ai-governance sidecar
│   └── providers/{anthropic,openai,gemini}.ts
├── reports/
│   └── reviewReport.ts             BDD_REVIEW.md generator
├── validate/
│   └── tscRunner.ts                runs tsc --noEmit, parses diagnostics
└── utils/
    ├── naming.ts                   PascalCase / kebab-case helpers
    └── logger.ts                   pino instance

templates/
├── package.json.tmpl
├── playwright.config.ts.tmpl
├── tsconfig.json.tmpl
└── gitignore.tmpl

tests/
├── unit/                           per-module unit tests
├── snapshot/                       golden-file emitter tests
└── e2e/                            spin up @playwright/mcp against a fixture site

examples/
└── login-feature/
    ├── login.feature
    └── expected-output/            (snapshot fixture)
```

## 13. IR types (sketch)

```ts
// types.ts

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
  examples?: Record<string, string>[];   // for Scenario Outline
  tags: string[];
}

export interface StepIR {
  keyword: 'Given' | 'When' | 'Then' | 'And' | 'But';
  text: string;
  argument?: string | string[][];        // doc string or data table
}

export interface ElementIR {
  role?: string;                         // 'button', 'textbox', etc.
  name?: string;                         // accessible name
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
  api: 'getByRole' | 'getByLabel' | 'getByPlaceholder'
     | 'getByTestId' | 'getByText' | 'locator';
  args: string;
  fieldName: string;                     // PascalCase → camelCase
  source: ElementIR;
  confidence: 'unique' | 'ambiguous' | 'fallback';
}

export interface PageObjectIR {
  className: string;                     // 'LoginPage'
  filePath: string;                      // 'pages/login.page.ts'
  url?: string;
  fields: LocatorChoice[];
  methods: PomMethodIR[];
  exists: boolean;                       // true if found in repo
}

export interface PomMethodIR {
  name: string;
  params: { name: string; type: string }[];
  body: string;                          // emitted TS body
  origin: 'existing' | 'generated';
}

export interface StepBinding {
  step: StepIR;
  pomCall?: { page: string; method: string; args: string[] };
  assertion?: { locator: string; matcher: string; expected?: string };
  warning?: string;                      // populated if no clean mapping
}

export interface ReviewItem {
  severity: 'info' | 'warn' | 'error';
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
}
```

## 14. Dependencies

| Runtime | Purpose |
|---|---|
| `@cucumber/gherkin` | Gherkin parser |
| `@cucumber/messages` | Gherkin AST types |
| `@playwright/mcp` | Page scanner (Microsoft official) |
| `@playwright/test` | Peer dep — must be in target repo |
| `ts-morph` | TypeScript AST for existing POM detection |
| `commander` | CLI |
| `express` | HTTP service (:4300) |
| `zod` | Request/response validation |
| `archiver` | Zip artefacts for HTTP download |
| `chalk` | CLI colour |
| `pino` | Structured logger |
| `fs-extra` | File ops |
| `prettier` | Format emitted code |
| `undici` | HTTP to ai-governance sidecar |
| `@vijaypjavvadi/pw-emit` | Shared emitter (refactor out of sel2pw) |

| Optional runtime | Purpose |
|---|---|
| `@anthropic-ai/sdk`, `openai`, `@google/generative-ai` | LLM providers (only if `--llm` set) |
| `better-sqlite3` | Failure telemetry |

| Dev | Purpose |
|---|---|
| `vitest`, `@vitest/coverage-v8` | Tests |
| `eslint`, `@typescript-eslint/*`, `prettier` | Lint/format |
| `typedoc` | API docs |
| `@yao-pkg/pkg` | `.exe` build |
| `@changesets/cli` | Versioning |

## 15. Acceptance criteria for v1.0

The release is "done" when:

1. **Phase 0 unblocked:** `@vijaypjavvadi/pw-emit@1.0.0` published to npm; `sel2pw@1.1.0` released running on it; emitter snapshot tests in `sel2pw` still pass byte-for-byte.
2. Running `bdd2pw scaffold examples/login-feature/login.feature --url http://localhost:3001 --page LoginPage --repo /tmp/out` against the bundled fixture produces a repo where `npx playwright test` runs and reports either pass or fail (not a runtime crash).
3. The same command run twice in a row (idempotent) produces no diff in `pages/login.page.ts` and no new entries in `BDD_REVIEW.md`.
4. Running `update-pom` after the page gains a new button adds exactly one new field + method, leaves all existing fields/methods untouched, and does not touch the spec.
5. **HTTP parity:** `POST /scaffold` with the same input as criterion #2 produces a `jobId`, polling `GET /jobs/:id` reaches `completed`, and `GET /jobs/:id/artifact` returns a zip whose contents are byte-identical to the CLI output.
6. Validated end-to-end against **5 real-world demo apps** (e.g. SauceDemo, the-internet, Conduit, OWASP Juice Shop, a static form playground). 0 hard failures.
7. ≥ 80% Vitest coverage on `parser`, `transformers`, `emitters`, `http`.
8. CI matrix green on Node 18 / 20 / 22, Windows + Ubuntu + macOS.
9. Published to npm as `@vijaypjavvadi/bdd2pw@1.0.0` and as a `.exe` via the platform downloads endpoint.
10. Gateway routes `/api/v1/scaffold/*` proxied to `:4300` and reachable via the platform UI.
11. README, CHANGELOG, INTEGRATION.md, STATUS.md mirror the structure of the `sel2pw` repo.

## 16. Phasing & roadmap

| Phase | Status | Headline |
|---|---|---|
| **Phase 0** | ✅ Shipped | `@vijaypjavvadi/pw-emit` extracted (file:../pw-emit). bdd2pw consumes it as a regular dep. sel2pw migration tracked separately (still on its own internal copy; byte-identical output verified). |
| **Phase 1a** | ✅ Shipped | Rule-based step matcher (15 rules — 14 in v1.0, +1 URL-contains in v1.0.1), Gherkin parser, repo scanner, locator picker, file-snapshot discovery, end-to-end `scaffold()` against `practice-test-login` (7/7, 0 warnings, locked as regression). |
| **Phase 1b** | ✅ Shipped | Live browser discovery via direct `playwright.chromium.launch()` (chose direct Playwright over `@playwright/mcp`). Status-region special case + visibility filter bypass. |
| **Phase 1c** | ✅ Shipped | Second real fixture (`cms-login`, third-person dialect) — 0 warnings first try. Subject-agnostic prefix locked. |
| **Phase 2** | ✅ Shipped | `analyze` (dry-run) + `update-pom` (append-only AST surgery via ts-morph). `BDD_REVIEW.md` writer. `tsc --noEmit` validator (soft-fail). |
| **Phase 3** | ✅ Shipped | Express HTTP service `:4300`. Three async workers (`scaffold` / `analyze` / `update-pom`). ULID job IDs, Zod request validation, Pino structured logs, archiver-streamed zip artefacts. End-to-end HTTP regression test asserts the zip's `PK\x03\x04` magic bytes. |
| **Phase 4** | 🚧 Partial | Snapshot + e2e tests done (101/101). LLM fallback + telemetry SQLite **deferred to v1.1** — real fixtures hit 100% rule coverage; `selenium11` proves the gap exists but is small. |
| **Phase 5** | 🚧 In progress | README + CHANGELOG + STATUS rewritten for v1.0. Remaining: tag `v1.0.0`, gateway route wiring, optional `.exe` build, optional npm publish (private platform first). |

| Post-v1.0 | Headline |
|---|---|
| v1.1 | Auth flows: built-in `auth.setup.ts` generator, OAuth/MFA recipes; SQLite-backed job persistence (currently in-memory) |
| v1.2 | Multi-page scenario support — follow links during MCP scan |
| v1.3 | Optional `playwright-bdd` runtime mode (keep `.feature` live, not just generation input) |
| v1.4 | API mocking scaffolds via `page.route()` from OpenAPI spec |
| v1.5 | Visual regression baseline capture |
| v2.0 | Bidirectional sync: detect spec changes, propose `.feature` updates |

## 17. Decisions log

**Confirmed 2026-05-02 (round 1):**
- BDD format: **Gherkin `.feature` only**
- URL source: **CLI `--url` flag per command**
- POM granularity: **One Page Object per page**
- Repo handling: **Scaffold if missing, reuse if present**

**Confirmed 2026-05-02 (round 2):**
- Q-1 — Package name: **`bdd2pw`** (npm: `@vijaypjavvadi/bdd2pw`)
- Q-3 — Shared emitter: **refactor first**. Build `@vijaypjavvadi/pw-emit` as Phase 0; `sel2pw` migrates onto it; then `bdd2pw` consumes it. Single source of truth from day one.
- Q-6 — Surface: **CLI + HTTP service in v1.0**. HTTP on port **`:4300`**, mirroring `sel2pw:4200`. Reachable through the platform gateway at `/api/v1/scaffold/*`.

**Locked at default (no objection raised — revisit anytime):**
- Q-2 — npm scope: `@vijaypjavvadi`
- Q-4 — LLM default provider: Anthropic, **off** by default
- Q-5 — `.feature` file location: user-specified per command (no convention assumed)
- Q-7 — Telemetry: opt-in via `--telemetry` flag, local SQLite only

**Implementation-time decisions (logged as they were taken, 2026-05-02 → 03):**

- **Direct Playwright over `@playwright/mcp`** — Phase 1b chose
  `playwright.chromium.launch()` from the optional dep directly, instead of
  shelling out to `npx @playwright/mcp`. Reason: simpler in-process control,
  one fewer subprocess, no STDIO bridging. The scope contract (FR-5) said
  "MUST use Microsoft Playwright MCP" — we're using Microsoft Playwright, just
  not via the MCP wrapper. Output is identical; revisit if/when MCP gains
  capabilities (e.g. multi-step nav recording) that warrant the hop.
- **File-snapshot fallback (`--snapshot-file`, `--no-discovery`)** — added as
  a first-class alternate input so CI and offline runs never need a live
  browser. Same code path; the snapshot is just a pre-recorded
  `ElementIR[]`. This is what makes the e2e regression suite hermetic.
- **Soft-fail navigation errors** — when the live scan can't reach the URL,
  `scaffold()` continues with whatever elements it has (or none) and writes
  `BDD_REVIEW.md` flagging the gap, rather than aborting. Reasoning: review
  is the deliverable; an unreachable target page is a warning, not a crash.
- **Append-only `update-pom`** — chose ts-morph `addProperty` / `addStatements`
  surgery over lock-block markers (`// bdd2pw:start ... // bdd2pw:end`).
  Reasoning: markers are noise in a hand-edited file, AST surgery is invisible
  and survives reformat. Hard-fails if the named POM doesn't exist (no
  accidental creates).
- **No LLM in v1.0** — every step that doesn't match a rule emits an explicit
  `// TODO:` plus a `BDD_REVIEW.md` entry. Real fixtures (`practice-test-login`,
  `cms-login`) hit 100% rule coverage, so LLM was never on the critical path.
  Wiring is reserved for v1.1.
- **In-memory job store, single-tenant HTTP** — `src/http/jobs.ts` is a `Map`.
  Multi-tenancy / persistence belongs at the platform gateway
  (`modern-automation-platform:3000`), not in `:4300`. SQLite-backed jobs
  reserved for v1.1.
- **Per-job tmpdir for HTTP scaffold** — the worker overrides the
  caller-provided `repo` with `<os.tmpdir()>/bdd2pw-jobs/<jobId>/`. The user
  downloads the result via `GET /jobs/:id/artifact`. This means the HTTP path
  never writes into a user's working tree, only the CLI does.
- **Rule taxonomy: 15 deterministic patterns + compound `customBody`** (14 at v1.0, +1 URL-contains in v1.0.1) — locked
  via 6 iteration rounds against `practice-test-login`. Subject-agnostic
  prefix `(?:I|user|User|the user|the User)` so first-person and third-person
  Gherkin dialects both match without rule duplication. Rule 2c emits a
  `customBody` for compound multi-statement steps. Rule 9a emits
  `toContainText` for "containing"-style assertions (rule 9 stayed
  `toHaveText` for exact match).
- **Status regions are first-class** — `#error`, `[role=alert]`,
  `[id*=error i]`, etc. get id-derived field names (priority 0 in
  `synthFieldName`) and bypass the visibility filter. Rationale: error banners
  are by definition hidden until something goes wrong, but specs almost always
  need to assert them.

## Next steps

The "next steps" section that originally lived here is obsolete — the design is
locked, the build is done. Live status of remaining work lives in
[`STATUS.md` §6](./STATUS.md). The short version: tag `v1.0.0`, wire the
platform gateway route, then move to v1.1 (LLM fallback + SQLite job store).
