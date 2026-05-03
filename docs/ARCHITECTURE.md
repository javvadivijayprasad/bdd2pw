# bdd2pw — Architecture Review (Draft v0.1)

> Companion to `bdd2pw-SCOPE.md`. Locks the runtime shape, sequence flows, public contracts, and failure modes before code is written.
> **Last updated:** 2026-05-02

---

## 1. Component view

```
                 ┌─────────────────────────────────────────────┐
                 │       modern-automation-platform :3000      │  (gateway)
                 │       /api/v1/scaffold/* → bdd2pw :4300     │
                 └──────────────────┬──────────────────────────┘
                                    │ HTTP
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          bdd2pw process                              │
│                                                                      │
│  ┌──────────┐      ┌─────────────────────────────────────────────┐  │
│  │  cli.ts  │──┐   │             core (index.ts)                 │  │
│  └──────────┘  │   │  scaffold() · analyze() · updatePom()       │  │
│                ├──▶│                                             │  │
│  ┌──────────┐  │   │  ┌─────────┐ ┌─────────┐ ┌──────────────┐  │  │
│  │server.ts │──┘   │  │ parser  │ │  repo   │ │  discovery   │  │  │
│  └──────────┘      │  │(gherkin)│ │(ts-morph│ │  (mcp scan)  │  │  │
│       │            │  └────┬────┘ └────┬────┘ └──────┬───────┘  │  │
│       │            │       └───────────┼─────────────┘          │  │
│       │            │                   ▼                        │  │
│       │            │  ┌─────────────────────────────────────┐   │  │
│       │            │  │           transformers              │   │  │
│       │            │  │  locatorPicker · pomResolver        │   │  │
│       │            │  │  stepMatcher (rules + LLM)          │   │  │
│       │            │  └────────────────┬────────────────────┘   │  │
│       │            │                   ▼                        │  │
│       │            │     ┌──────────────────────────┐           │  │
│       │            │     │  emitters/facade.ts      │───────────┼──┼──▶ @vijaypjavvadi/pw-emit
│       │            │     └────────────┬─────────────┘           │  │   (shared package)
│       │            │                  ▼                         │  │
│       │            │      ┌────────────────────┐                │  │
│       │            │      │   validate (tsc)   │                │  │
│       │            │      └────────────────────┘                │  │
│       │            └─────────────────────────────────────────────┘  │
│       │                                                              │
│       ▼ (HTTP only)                                                  │
│  ┌──────────────┐    ┌──────────────┐                               │
│  │  http/jobs   │    │ http/        │                               │
│  │  (in-memory) │    │ artifacts    │                               │
│  └──────────────┘    └──────────────┘                               │
└──────────┬───────────────────────────────────┬──────────────────────┘
           │                                   │
           ▼                                   ▼
  ┌────────────────┐                ┌─────────────────────┐
  │ ai-governance  │                │ @playwright/mcp     │
  │  sidecar :8004 │                │ (subprocess)        │
  └────────────────┘                └─────────────────────┘
                                              │
                                              ▼
                                      target web app
```

Key principle: **CLI and HTTP are thin shells around the same `core` API.** The HTTP service does not duplicate any business logic; it adds (1) request validation, (2) job tracking, (3) artifact zipping. CLI adds (1) flag parsing, (2) terminal output. Everything else lives in `index.ts` and the modules below it.

---

## 2. Sequence — CLI `scaffold` (happy path)

```
user        cli.ts      core         parser     repoScanner  pomResolver  mcpClient    locatorPicker  stepMatcher  pw-emit   tscRunner    fs
 │            │           │            │             │             │            │             │             │           │          │         │
 │ bdd2pw    │            │            │             │             │            │             │             │           │          │         │
 │ scaffold  │            │            │             │             │            │             │             │           │          │         │
 ├──────────▶│            │            │             │             │            │             │             │           │          │         │
 │           │ scaffold() │            │             │             │            │             │             │           │          │         │
 │           ├───────────▶│            │             │             │            │             │             │           │          │         │
 │           │            │parseFeature│             │             │            │             │             │           │          │         │
 │           │            ├───────────▶│             │             │            │             │             │           │          │         │
 │           │            │  FeatureIR │             │             │            │             │             │           │          │         │
 │           │            │◀───────────┤             │             │            │             │             │           │          │         │
 │           │            │ scanRepo   │             │             │            │             │             │           │          │         │
 │           │            ├──────────────────────────▶             │            │             │             │           │          │         │
 │           │            │ existing POM map         │             │            │             │             │           │          │         │
 │           │            │◀──────────────────────────             │            │             │             │           │          │         │
 │           │            │ resolve(page, existingMap)             │            │             │             │           │          │         │
 │           │            ├────────────────────────────────────────▶            │             │             │           │          │         │
 │           │            │ decision: CREATE | AUGMENT | REUSE     │            │             │             │           │          │         │
 │           │            │◀────────────────────────────────────────            │             │             │           │          │         │
 │           │            │                                                                                                                  │
 │           │            │ if CREATE or AUGMENT:                                                                                            │
 │           │            │     scanPage(url)                      │            │             │             │           │          │         │
 │           │            ├──────────────────────────────────────────────────────▶            │             │           │          │         │
 │           │            │     a11yTree + DOM snapshot            │            │             │             │           │          │         │
 │           │            │◀──────────────────────────────────────────────────────            │             │           │          │         │
 │           │            │     pickLocators(snapshot)             │            │             │             │           │          │         │
 │           │            ├───────────────────────────────────────────────────────────────────▶             │           │          │         │
 │           │            │     LocatorChoice[]                    │            │             │             │           │          │         │
 │           │            │◀───────────────────────────────────────────────────────────────────             │           │          │         │
 │           │            │                                                                                                                  │
 │           │            │ matchSteps(scenarios, pom)                                                                                       │
 │           │            ├──────────────────────────────────────────────────────────────────────────────────▶           │          │         │
 │           │            │ StepBinding[]                                                                                                    │
 │           │            │◀──────────────────────────────────────────────────────────────────────────────────           │          │         │
 │           │            │                                                                                                                  │
 │           │            │ emitProject(pom, bindings)                                                                                       │
 │           │            ├──────────────────────────────────────────────────────────────────────────────────────────────▶          │         │
 │           │            │ files written to <repo>                                                                                          │
 │           │            │◀──────────────────────────────────────────────────────────────────────────────────────────────          │         │
 │           │            │                                                                                                                  │
 │           │            │ tsc --noEmit                                                                                                     │
 │           │            ├─────────────────────────────────────────────────────────────────────────────────────────────────────────▶        │
 │           │            │ diagnostics                                                                                                      │
 │           │            │◀─────────────────────────────────────────────────────────────────────────────────────────────────────────        │
 │           │            │                                                                                                                  │
 │           │            │ writeReviewReport(BDD_REVIEW.md)                                                                                 │
 │           │            ├───────────────────────────────────────────────────────────────────────────────────────────────────────────▶      │
 │           │  Result    │                                                                                                                  │
 │           │◀───────────┤                                                                                                                  │
 │ exit 0    │            │                                                                                                                  │
 │◀──────────┤            │                                                                                                                  │
```

Branches:

- **REUSE** (POM already covers all referenced elements): skip `mcpClient.scanPage`, `locatorPicker`, and POM emission. Only emit the spec.
- **AUGMENT**: scan, but `pomResolver` provides the existing field map; `locatorPicker` adds only NEW choices, deduped by element accessible-name.
- **stepMatcher LLM fallback**: rules-only first; if any step has no rule match AND `--llm` is enabled, batch the unmatched steps into one governance-routed call. If `--llm` off, the step is bound to a `// TODO` skeleton + warning in `BDD_REVIEW.md`.

## 3. Sequence — HTTP `POST /scaffold` (async job lifecycle)

```
client       routes       jobs        worker       core         artifacts     fs
  │             │            │            │            │             │           │
  │ POST /scaffold           │            │            │             │           │
  │ {feature,url,page,repo}  │            │            │             │           │
  ├────────────▶│            │            │            │             │           │
  │             │ validate(zod)           │            │             │           │
  │             │ create(jobId)           │            │             │           │
  │             ├───────────▶│            │            │             │           │
  │             │ jobId      │            │            │             │           │
  │             │◀───────────┤            │            │             │           │
  │             │ spawn worker            │            │             │           │
  │             ├────────────────────────▶│            │             │           │
  │ 202 {jobId} │            │            │            │             │           │
  │◀────────────┤            │            │            │             │           │
  │             │            │            │ scaffold() │             │           │
  │             │            │            ├───────────▶│             │           │
  │             │            │ progress events         │             │           │
  │             │            │◀────────────────────────│             │           │
  │             │            │            │ files emitted to /tmp/jobs/<id>/     │
  │             │            │            │            ├───────────────────────▶│
  │             │            │            │ Result     │             │           │
  │             │            │            │◀───────────┤             │           │
  │             │            │ status: completed       │             │           │
  │             │            │◀────────────────────────┤             │           │
  │ GET /jobs/:id            │            │            │             │           │
  ├────────────▶│            │            │            │             │           │
  │             │ get(jobId) │            │            │             │           │
  │             ├───────────▶│            │            │             │           │
  │             │ {status,progress,...}   │            │             │           │
  │             │◀───────────┤            │            │             │           │
  │ 200 {...}   │            │            │            │             │           │
  │◀────────────┤            │            │            │             │           │
  │ GET /jobs/:id/artifact   │            │            │             │           │
  ├────────────▶│            │            │            │             │           │
  │             │ zip(/tmp/jobs/<id>)     │            │             │           │
  │             ├───────────────────────────────────────────────────▶│           │
  │             │                          stream zip                │           │
  │             │◀───────────────────────────────────────────────────┤           │
  │ 200 zip     │            │            │            │             │           │
  │◀════════════┤ (streamed) │            │            │            │            │
```

Worker concurrency: one Node `Promise` per job. v1.0 has no queue — job throughput is process concurrency. v1.1 introduces a SQLite-backed queue + worker pool (already on roadmap).

Job lifecycle states: `queued` → `running` → `completed` | `failed`. Progress events emitted on a per-stage basis (parsed, scanned, matched, emitted, validated).

## 4. Sequence — `update-pom` (POM-only, specs untouched)

```
cli.ts         core            repoScanner    pomResolver    mcpClient      locatorPicker     pw-emit       fs
  │               │                  │              │              │              │              │             │
  │ updatePom()   │                  │              │              │              │              │             │
  ├──────────────▶│                  │              │              │              │              │             │
  │               │ scanRepo         │              │              │              │              │             │
  │               ├─────────────────▶│              │              │              │              │             │
  │               │ existing POM     │              │              │              │              │             │
  │               │◀─────────────────┤              │              │              │              │             │
  │               │ resolve(page, existing)         │              │              │              │             │
  │               ├────────────────────────────────▶│              │              │              │             │
  │               │ decision: AUGMENT (always — no CREATE here)    │              │              │             │
  │               │◀────────────────────────────────┤              │              │              │             │
  │               │ scanPage(url)                   │              │              │              │             │
  │               ├──────────────────────────────────────────────▶│              │              │              │
  │               │ snapshot                        │              │              │              │             │
  │               │◀──────────────────────────────────────────────┤              │              │              │
  │               │ pickLocators(snapshot)                                       │              │              │
  │               ├──────────────────────────────────────────────────────────────▶│              │              │
  │               │ new LocatorChoice[] (dedup vs existing)                      │              │              │
  │               │◀──────────────────────────────────────────────────────────────│              │              │
  │               │ emitPageObject(merged pom)                                                  │              │
  │               ├──────────────────────────────────────────────────────────────────────────────▶              │
  │               │ written: pages/<name>.page.ts (DIFF preserves existing fields/methods)                    │
  │               ├──────────────────────────────────────────────────────────────────────────────────────────▶│
  │               │ writeReviewReport(BDD_REVIEW.md)                                                          │
  │               ├──────────────────────────────────────────────────────────────────────────────────────────▶│
  │ Result        │                                                                                            │
  │◀──────────────┤                                                                                            │
```

Hard rule: `update-pom` MUST NOT touch `tests/*.spec.ts`. The `emitPageObject` call is given a flag `mode: 'augment'` that wraps every existing field/method with a `// __BDD2PW_LOCK__` marker — `pw-emit` refuses to delete or rename anything inside a lock block.

## 5. Public contract — `@vijaypjavvadi/pw-emit`

```ts
// @vijaypjavvadi/pw-emit/src/index.ts

export interface EmitPageObjectInput {
  className: string;                      // 'LoginPage'
  fields: LocatorChoice[];
  methods: PomMethodIR[];
  mode: 'create' | 'augment';
  existing?: string;                      // file contents if mode === 'augment'
}

export interface EmitTestFileInput {
  describeName: string;                   // feature name
  beforeEach?: StepBinding[];             // from Background
  scenarios: { name: string; bindings: StepBinding[] }[];
  pomImports: { className: string; fromPath: string }[];
}

export interface EmitProjectInput {
  outDir: string;
  hasExisting: boolean;                   // skip scaffold if true
  templates?: string;                     // override path
}

export function emitPageObject(input: EmitPageObjectInput): { contents: string; warnings: ReviewItem[] };
export function emitTestFile(input: EmitTestFileInput): { contents: string; warnings: ReviewItem[] };
export function emitProject(input: EmitProjectInput): Promise<{ filesWritten: string[]; warnings: ReviewItem[] }>;

// Helpers (also exported)
export function pickLocator(element: ElementIR, snapshot: ElementIR[]): LocatorChoice;
export function pascalCase(s: string): string;
export function kebabCase(s: string): string;

// Shared types re-exported for consumers
export type { ElementIR, LocatorChoice, PomMethodIR, StepBinding, ReviewItem };
```

SemVer commitments:

- **Patch:** bug fixes, additive warnings, formatting tweaks.
- **Minor:** new exported helpers, new optional input fields (defaulted).
- **Major:** any change to the **emitted file shape** (POM/spec format), required input fields, or removed exports.

Both `sel2pw` and `bdd2pw` pin to `^1.0.0` in v1.0; major bumps coordinated.

## 6. HTTP API — full contract

### `POST /scaffold`

**Request**
```json
{
  "feature": "/abs/path/to/login.feature",
  "url": "https://app.example.com/login",
  "page": "LoginPage",
  "repo": "/abs/path/to/target-repo",
  "options": {
    "pages": ["LoginPage", "DashboardPage"],
    "storageState": "/abs/path/to/state.json",
    "headed": false,
    "llm": "anthropic",
    "telemetry": true,
    "noValidate": false
  }
}
```

**Response — 202**
```json
{ "jobId": "01HXYZ...", "links": { "self": "/jobs/01HXYZ...", "artifact": "/jobs/01HXYZ.../artifact" } }
```

**Response — 400** (Zod validation)
```json
{ "error": "ValidationError", "details": [ { "path": "url", "message": "Required" } ] }
```

### `GET /jobs/:id`

**Response — 200**
```json
{
  "id": "01HXYZ...",
  "status": "running",
  "stage": "scanning",
  "progress": 0.4,
  "warnings": [],
  "errors": [],
  "createdAt": "2026-05-02T10:00:00Z",
  "updatedAt": "2026-05-02T10:00:14Z"
}
```

Stages emitted in order: `queued` → `parsing` → `scanning_repo` → `discovering_page` → `picking_locators` → `matching_steps` → `emitting` → `validating` → `completed` | `failed`.

### `GET /jobs/:id/artifact`

Streams `application/zip`. Headers:
```
Content-Type: application/zip
Content-Disposition: attachment; filename="bdd2pw-<jobId>.zip"
```
Zip contents = `<repo>/` minus `node_modules/`, plus `BDD_REVIEW.md` at root.

### `GET /healthz` / `/readyz` / `/version`

Standard. `/readyz` reports MCP browser availability and governance reachability.

## 7. Error model & recovery

| Failure | Where | Surface | Behaviour |
|---|---|---|---|
| Bad `.feature` syntax | `parser/gherkinParser` | CLI: stderr + exit 2. HTTP: job → `failed`. | Hard fail. Show parse error with line:col. |
| Repo path unwritable | `repo/projectScaffolder` | CLI: stderr + exit 3. HTTP: 400 if pre-flight, else `failed`. | Hard fail. |
| MCP browser launch failed | `discovery/mcpClient` | CLI: stderr + exit 4. HTTP: job → `failed`. | Hard fail. Suggest `npx playwright install`. |
| URL unreachable / 5xx | `discovery/mcpClient` | Warning + retry x3 (exp backoff). | Retry; on final fail, hard fail. |
| Locator ambiguous (multiple matches) | `locatorPicker` | Warning in `BDD_REVIEW.md`. | Pick highest-confidence + emit `// REVIEW: locator may be ambiguous`. Continue. |
| Step has no rule match, no LLM | `stepMatcher` | Warning + skeleton TODO. | Continue. Spec compiles but skipped step is `test.fixme` with explanation. |
| LLM call fails | `llm/governanceClient` | Warning. | Fall back to skeleton-TODO behaviour. Continue. |
| `tsc --noEmit` errors | `validate/tscRunner` | Warning in `BDD_REVIEW.md`. | Continue. Exit 0 with summary count. |
| Existing POM lock-block tampered | `emitters/facade` | Hard fail. | Refuse to write. Tell user to revert or use `--force`. |
| `update-pom` would delete an existing field | `emitters/facade` | Hard fail. | Refuse. Surface diff for manual review. |

CLI exit codes:
- `0` — success (warnings allowed)
- `1` — generic error
- `2` — input parse failure
- `3` — file system / permission failure
- `4` — external dependency failure (MCP, governance)
- `5` — emitter consistency failure (lock block tampered, would-delete)

## 8. Concurrency model (v1.0)

- **CLI:** single-threaded per invocation. One MCP scan, one tsc run, sequentially.
- **HTTP:** one Node process, multi-job in-flight via `Promise` worker per job. No queue. Bounded by Node event loop + spawned subprocesses (MCP, tsc).
- **MCP subprocess:** one browser per active job. Caller is responsible for `--max-concurrent-jobs` flag (default 4). Beyond limit, jobs queue via `p-limit`.
- **Job store:** `Map<jobId, JobRecord>` in-memory. Lost on restart. v1.1 promotes to SQLite.
- **Artifact storage:** `<os.tmpdir()>/bdd2pw-jobs/<jobId>/`. Cron sweep via `setInterval` deletes anything older than 24h.

## 9. Cross-service contracts

### `ai-governance` sidecar

- Endpoint: `POST {governance-url}/sanitize`
- Body: `{ payload: string, context: { app: 'bdd2pw', feature: 'step-match' } }`
- Response: `{ sanitized: string, redactions: number }`
- All LLM provider calls are POSTs to `{governance-url}/route`, body: `{ provider, model, messages, sanitizedContext }`. No direct provider SDKs — provider plugins live inside the sidecar. Same pattern `sel2pw` already uses.

### `self-healing-stage-services`

- **No build-time integration.** `bdd2pw` emits standard Playwright tests with stable locators. The healing service operates at runtime via the platform's test-runner integration. This is by design: keeps bdd2pw single-purpose.

### Platform gateway (`modern-automation-platform:3000`)

- Routes prefix: `/api/v1/scaffold/*` → proxied to `:4300`
- Auth: handled at gateway (JWT). bdd2pw assumes pre-authenticated requests.
- Provenance: gateway adds `X-Request-Id`, `X-User-Id`, `X-Job-Owner` headers. bdd2pw stamps these into the job record.

## 10. File system contracts

Inputs (read):
- `<feature-file>` — must exist, `.feature` extension.
- `<repo>/playwright.config.ts` — if exists, scaffolder skips.
- `<repo>/pages/*.page.ts` — read by `repoScanner` via `ts-morph`.
- `<storage-state>` (optional) — JSON, passed to MCP browser context.

Outputs (write):
- `<repo>/package.json` — created if missing; never modified if exists (warning instead).
- `<repo>/playwright.config.ts` — created if missing; never modified if exists.
- `<repo>/tsconfig.json` — created if missing; never modified if exists.
- `<repo>/pages/<name>.page.ts` — created or augmented.
- `<repo>/tests/<name>.spec.ts` — created (overwritten on re-`scaffold` only if `--force`).
- `<repo>/BDD_REVIEW.md` — always overwritten.
- `<os.tmpdir()>/bdd2pw-jobs/<jobId>/` — HTTP only; ephemeral.

Hard guarantee: **no file outside `<repo>` and `<os.tmpdir()>/bdd2pw-jobs` is ever written.**

## 11. Observability

- **Logs:** `pino` JSON to stdout. Fields: `time`, `level`, `jobId?`, `stage?`, `msg`. Pretty-print only when TTY + `--debug`.
- **Tracing:** OpenTelemetry-ready (Phase 4). Spans per stage, propagation from gateway via `X-Request-Id`.
- **Metrics:** `/metrics` Prometheus endpoint (Phase 4). Counters: `bdd2pw_jobs_total{status}`, `bdd2pw_steps_unmatched_total`, `bdd2pw_locator_fallback_total`. Histograms: `bdd2pw_stage_duration_seconds{stage}`.

## 12. Open architectural questions

| # | Question | Lean |
|---|---|---|
| AQ-1 | Should `pw-emit` ship its own templates (`playwright.config.ts.tmpl` etc.) or do we keep templates inside each consumer? | `pw-emit` ships them. Single source of truth. Override path supported. |
| AQ-2 | MCP integration — programmatic API or shell out to `npx @playwright/mcp`? | Programmatic if exposed; else shell out and parse JSON-RPC over stdio. Validate before Phase 1 starts. |
| AQ-3 | `tsc --noEmit` — invoke the user's local `typescript` from `node_modules`, or bundle one? | Use the user's. Falls back to bundled if missing. Avoids version drift. |
| AQ-4 | Job IDs — ULID, UUID, or short nanoid? | ULID (sortable by time, URL-safe). |
| AQ-5 | Should the HTTP service serve a tiny built-in UI for browsing jobs, or rely entirely on the platform UI? | Tiny built-in UI for local dev; platform UI for prod. Same as `sel2pw`. |
| AQ-6 | `BDD_REVIEW.md` location — repo root or `docs/`? | Repo root. Visible immediately on clone. |

---

## Sign-off checklist

Before we start scaffolding the `bdd2pw` repo:

- [ ] Component diagram approved
- [ ] Sequence flows for `scaffold` (CLI + HTTP) approved
- [ ] `update-pom` lock-block strategy approved (FR-19 enforcement)
- [ ] `pw-emit` package contract approved (named exports + SemVer)
- [ ] HTTP API contract approved (endpoints, payloads, status codes)
- [ ] Error model + exit codes approved
- [ ] AQ-1 through AQ-6 answered

Once these are checked, **Phase 0 starts**: extract `pw-emit` from `sel2pw` and ship `sel2pw@1.1.0` running on it. Then Phase 1 of `bdd2pw` begins.
