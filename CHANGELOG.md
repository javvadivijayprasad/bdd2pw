# bdd2pw — CHANGELOG

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [1.0.0] — 2026-05-03

First public npm release. Six phases shipped, two real-world fixtures locked,
101 / 101 tests green. See [`docs/STATUS.md`](./docs/STATUS.md) for the runtime
snapshot and [`docs/SCOPE.md`](./docs/SCOPE.md) §17 for the full
implementation-time decisions log.

### Headline

`feature in → ready-to-run Playwright tests out`. Rule-based
deterministic generation (no LLM in v1.0). CLI + HTTP service. Same code path
through both surfaces.

### Shipped in v1.0

- **Phase 0** — `@vijaypjavvadi/pw-emit@1.0.0` extracted; bdd2pw consumes it as
  a regular dep (`^1.0.0`).
- **Phase 1a** — Gherkin parser (`@cucumber/gherkin`), repo scanner (ts-morph),
  POM resolver (reuse / augment / create), file-snapshot discovery, locator
  picker (priority chain + status-region special case), 14-rule step matcher,
  emitter facade, end-to-end `scaffold()`. Locked against `practice-test-login`
  (7/7 mapped, 0 warnings).
- **Phase 1b** — Live browser discovery via direct `playwright.chromium.launch()`
  (chose direct Playwright over `@playwright/mcp` for simpler in-process control).
  Status-region visibility-filter bypass.
- **Phase 1c** — Second real fixture `cms-login` (third-person dialect),
  0 warnings first try. Subject-agnostic prefix locked.
- **Phase 2** — `analyze` (dry-run) + `update-pom` (append-only AST surgery via
  ts-morph; hard-fails on missing POM). `BDD_REVIEW.md` writer. `tsc --noEmit`
  validator (soft-fail).
- **Phase 3** — Express HTTP service `:4300`. Three async workers, ULID job
  IDs, Zod request validation, Pino structured logs, archiver-streamed zip
  artefacts. Per-job tmpdir contains blast radius for HTTP scaffold runs.

### CLI

```
bdd2pw scaffold   <feature> --url <url> --page <Name> --repo <dir> [opts]
bdd2pw analyze    <feature> --url <url> [opts]
bdd2pw update-pom --page <Name> --url <url> --repo <dir>
bdd2pw serve      [--port 4300]
```

### HTTP

`POST /scaffold | /analyze | /update-pom` → `202 + { jobId, links }`.
`GET /jobs/:id`, `GET /jobs/:id/artifact` (zip), `GET /jobs/:id/log`,
`GET /healthz`, `GET /readyz`, `GET /version`.

### Tests

101 / 101 across 10 Vitest files. Includes a full HTTP regression that asserts
the artefact response body starts with the ZIP magic bytes `PK\x03\x04`.

### Distribution

- npm: `@vijaypjavvadi/bdd2pw@1.0.0` (public, scoped, with provenance).
- GitHub: tag-triggered `release.yml` workflow auto-publishes on `vX.Y.Z` push.
- CI matrix: Ubuntu / macOS / Windows × Node 18 / 20 / 22.

### Deferred to v1.1+

- LLM fallback for vague steps (governance-routed). Real fixtures hit 100%
  rule coverage so this was off the critical path.
- SQLite-backed job persistence (currently in-memory `Map`).
- Built-in `auth.setup.ts` generator. Today: bring your own `--storage-state`.
- Multi-page navigation discovery, `playwright-bdd` runtime mode, API mocking
  scaffolds, visual regression — all post-v1.1.

### Earlier-phase notes (kept for history)

#### Phase 3 — HTTP service is real

The `POST /scaffold`, `POST /analyze`, `POST /update-pom` routes now actually do work. Same code path as the CLI; HTTP is a thin shell.

#### What landed

- **Workers in `src/http/routes.ts`** — three async `Promise` workers, one per `POST` endpoint. Each accepts the parsed Zod-validated body, calls the matching `scaffold()` / `analyze()` / `updatePom()` function from `src/index.ts`, and updates the in-memory job state through `running` → `completed` / `failed`.
- **Per-job artifact dir.** `POST /scaffold` overrides the caller-provided `repo` with `<os.tmpdir()>/bdd2pw-jobs/<jobId>/`. This contains the blast radius — the HTTP user can't write outside that sandbox even if they pass an unsafe path.
- **`streamArtifactZip()` in `src/http/artifacts.ts`** — uses `archiver` to zip the artifact dir on the fly, streaming directly to the response. Excludes `node_modules`, `.git`, `test-results`, `playwright-report`. Headers: `application/zip` + `Content-Disposition: attachment; filename="bdd2pw-<jobId>.zip"`.
- **`GET /jobs/:id/log`** — returns a plain-text dump of the job's warnings + errors. Real per-job pino log file tailing deferred to v1.1.
- **`GET /jobs/:id/artifact`** failure modes covered: `404 JobNotFound`, `409 ArtifactNotReady` (job still running or failed), `410 ArtifactExpired` (artifact dir already swept).

#### Tests

- `tests/e2e/httpWorker.test.ts` — spins up the real Express app on a random port, drives it via `fetch()`, polls for completion. 11 assertions across 4 describe blocks:
  - `/healthz`, `/version`, `/readyz` respond correctly.
  - `POST /scaffold` validates the body and returns 400 for malformed input (missing fields, bad URL).
  - End-to-end: POST `/scaffold` with the practice-test-login fixture → poll `/jobs/:id` → reaches `completed` with no warnings → `GET /jobs/:id/artifact` returns a real zip (verified by the ZIP magic bytes `PK\x03\x04` at the start of the response body).
  - `GET /jobs/:id/log` returns a text/plain dump containing the job ID and status.

#### Out of scope for v1.0 (deferred to v1.1+)

- **Multi-tenancy / auth** — handled at the gateway (`modern-automation-platform:3000`), bdd2pw HTTP is single-tenant per process. Same pattern as `sel2pw`.
- **Job queue + worker pool** — current model is one Promise per job, bounded by Node's event loop. SQLite-backed queue with `p-limit` on MCP browsers lands in v1.1.
- **Granular per-stage progress events** — workers emit `parsing` / `emitting` / `completed`, but not the full 9-stage progress chain from the architecture doc. Sufficient for the UI to show "running" → "done"; finer-grained progress is a polish task.
- **Real per-job log file** — `GET /jobs/:id/log` currently returns warnings/errors from the in-memory record. Pino multi-stream routing per job is v1.1.

### Phase 2 — `updatePom` ships, append-only by construction

Replaces the `NotImplementedError` stub. **The third CLI command is now real.** Re-scanning a page that already has a Page Object merges newly-discovered locators in — without ever touching what's already there.

#### Design choice: append-only over lock-blocks

The original SCOPE proposed `// __BDD2PW_LOCK__` markers around generated content. Switched to **append-only via AST surgery** because:

- No visible markers in user code (lock comments are noise in otherwise hand-readable files).
- Stronger guarantee: enforced by construction, not by comments the user could strip.
- No special-casing for hand-edits — if it's already there, it's preserved.
- Smaller blast radius: bugs in updatePom can only ADD wrong things, never destroy existing code.

Trade-off: stale fields (when the live page removes an element) are not auto-deleted. Intentional — staleness is recoverable, deletion is not.

#### Hard rules `updatePom` enforces

1. Never deletes any property, method, or import.
2. Never renames anything.
3. Never modifies any existing method body — hand-edits are preserved byte-identical.
4. Skips field-name collisions (existing field wins).
5. Method synthesis is opt-in and deferred to v1.1.
6. Hard-fails if the POM file doesn't exist (suggests `scaffold` first).
7. Hard-fails if the class name doesn't match `--page`.

#### Implementation

- **`updatePom()` in `src/index.ts`** — replaces the stub. Uses `ts-morph` to read the existing POM AST, computes the new-fields diff against the live scan, and uses `addProperty` + `addStatements` to splice new content into the existing class. Then `save()` writes back. No re-emit, no overwrite.
- **`renderLocatorExpr` imported from `@vijaypjavvadi/pw-emit`** so the appended constructor lines use the same locator format as `scaffold` would.
- Honours `--no-discovery` and `--snapshot-file` flags for offline/CI use, mirroring `scaffold`.
- Surfaces a `BDD_REVIEW.md` with diff stats: existing/discovered/new/skipped-collisions counts.

#### Tests

- `tests/e2e/updatePom.test.ts` — 11 assertions across 3 describe blocks. The critical cases:
  - **Hand-edits survive byte-identical** (the must-not-regress invariant): hand-written comments, `console.log` lines, and entire method bodies stay untouched.
  - **Custom helper methods survive** — anything outside the discovered IR is preserved.
  - **Existing field collisions are skipped** — if the user already declared `usernameInput` with a `#username` selector, updatePom does NOT overwrite with whatever the live snapshot would pick.
  - **Idempotent** — second invocation in a row adds zero fields.
  - **Hard-fail on missing class** — points at `scaffold`.

### Phase 1c — second real-world fixture clean (selenium14/LoginCMS)

**Validated against `selenium14/AutomationFrameworkCucumberTestNG/src/test/resources/features/LoginCMS.feature` — third-party Cucumber dialect from a real OSS Selenium codebase, against `https://cms.anhtester.com/login`.** 0 warnings, 0 errors, every step mapped.

This fixture exercises:
- `User navigate to Login Page for Admin "URL"` — third-person subject + bare-text + quoted URL → `goto()`
- `user enter email "admin@example.com" password "123456"` — **compound input step** (one Gherkin step, two field/value pairs) → two `.fill()` lines emitted
- `click Login button` — no subject prefix → `loginButton.click()`
- `user is redirected to the Dashboard page` — third-person `is redirected to` → `toHaveURL(/Dashboard/)`

#### Bugs fixed this round

- **Step matcher: subject-agnostic rules.** All 13 rules now accept `I | user | User | the user | the User` as the subject prefix (was hard-coded `I`). Verb forms also accept singular AND plural conjugation (`click | clicks`, `enter | enters`, etc.). For rule 3 (click) the subject is now optional entirely (`click Login button` works without any subject).
- **Rule 1 (navigate): handles `navigate to <text> "<URL>"`.** Previous pattern only accepted `navigate to <target>`. New pattern: `(?:.+?\s+)?["']?<target>["']?` — the optional `<text> ` prefix is consumed, the quoted URL becomes the target.
- **Rule 11 (redirect): accepts `is redirected`.** Was `(should be |am )?redirected`; now `(should be |am |is )?redirected`.
- **Compound input rule (2c).** New rule for `SUBJ verb FIELD1 "V1" FIELD2 "V2" [...]` — extracts every (field, value) pair via a global regex pass and emits one `.fill()` per pair. Falls back to `null` (TODO) if any field doesn't resolve, so partial matches don't produce wrong code.

#### Type addition (small)

- **`StepBinding.customBody?: string`** — for compound steps that produce multiple TS statements per Gherkin step. The emitter writes `customBody` verbatim instead of synthesising a single line from `pomCall`/`assertion`. Existing rules unchanged; only the new compound rule uses this path.

#### Orchestrator bug fix

- **Background warnings now flow into `BDD_REVIEW.md`.** Previously only scenario-step warnings were collected; Background-step warnings were silently dropped. Now surfaced under `[Background]`.

### Phase 1b milestone — live discovery 7/7 against the real site

**Same `practice-test-login` feature that needed a hand-authored snapshot in Phase 1a now passes 7/7 with `--url` only — bdd2pw scans the live page itself.** No snapshot file, no hand-tuning, real Chromium against `https://practicetestautomation.com/practice-test-login/`.

#### Iteration arc (live-scan rounds)

| Round | Pass / Fail | Root cause + fix |
|---|---|---|
| 1 | 4 / 3 | Scanner missed `<div id="error">` (no role/testid/aria-label) → broaden selector list to include `[id*=error i]`, `[class*=alert i]`, etc. |
| 2 | 3 / 4 | Scanner picked up error div but field name was text-derived (`yourUsernameIsInvalid`) → step matcher's `findField("error", [...])` couldn't match it. Fix: in `synthFieldName`, when CSS id matches `STATUS_REGION_RE`, prefer id-derived name → field becomes `error`. Plus `isLikelyStatusRegion` bypasses the visibility filter (status banners are intentionally hidden until triggered). Plus implicit roles for `<button>`/`<a>`/`<input type=submit>` so picker emits `getByRole`. Plus dedup-by-locator-value (collapse `username` + `usernameInput` into one). |
| 3 | 3 / 4 | Field name was right (`error`) but locator was wrong: picker emitted `getByText("Your username is invalid!")` not `locator("#error")`. Volatile text content was winning over the stable id. Fix: locator picker skips the `getByText` branch when element matches `STATUS_REGION_RE` — text changes per scenario, id is the stable handle. |
| 4 | **7 / 0** | — |

#### Bugs fixed this round

- **`src/discovery/mcpClient.ts`:** broader selector list (`[id*=error]`, `[class*=alert]`, …); `implicitRole()` for native HTML form controls; `isLikelyStatusRegion()` visibility-filter bypass; `isVisible()` zero-size + display:none filter; tsconfig `/// <reference lib="dom" />` so the `page.evaluate()` callback type-checks.
- **`src/transformers/locatorPicker.ts`:** new `STATUS_REGION_RE`; `synthFieldName` priority 0 = id-derived for status regions (so `<div id="error">` → `error`, not `yourUsernameIsInvalid`); `getByText` branch skipped for status regions; `dedupeLocators` now collapses by `(api, args)` identity, keeping the longer field name.

#### What this proves

Three of the original Phase 1a iteration rounds were **snapshot accuracy** bugs (fictional ARIA roles, fictional placeholders). With Phase 1b they're gone — the scanner sees what's actually there. The four Phase 1b rounds were rule/picker bugs surfaced by real DOM data, all fixed. Net result: a **single CLI invocation** with `--url` produces a runnable spec from a Cucumber `.feature` file with zero hand-edits, zero snapshot authoring.

### Phase 1b — real browser-based page discovery (initial implementation, earlier this round)

Replaces the file-snapshot-only discovery with a real Chromium-launching scanner. Hand-authoring `snapshot.json` is no longer required for the common case; pass `--url` and bdd2pw scans the live page itself.

#### What landed

- **`scanPageWithBrowser()`** in `src/discovery/mcpClient.ts` — uses `playwright.chromium.launch()` directly. Walks the DOM with a curated selector list (inputs, buttons, links, selects, headings, anything with `[role]` / `[data-testid]` / `[aria-label]`), extracts per-element role / accessible name / label / placeholder / testId / text / best CSS selector, and returns a flat `ElementIR[]`-shaped list. Snapshot parser handles it without changes.
- **`playwright`** added as an `optionalDependencies` entry. Dynamic-imported in the scanner with a clear install-hint error if missing (`"npm install -D playwright && npx playwright install chromium"`).
- **Storage state support** — pass `--storage-state <path.json>` to scan an authenticated page; passed through to `browser.newContext({ storageState })`.
- **Headed mode** — `--headed` shows the browser window, useful for debugging snapshot accuracy.
- **Network-idle wait with fallback** — first attempt waits 5s for network idle (catches SPAs that finish loading lazily); falls back to `domcontentloaded` if idle never settles.

#### Removed framing

- Dropped `@playwright/mcp` from optional dependencies. **AQ-2 resolved:** MCP is an LLM-control protocol, not a programmatic browser API. We just need one URL → one snapshot, so direct `playwright` is one fewer process and one fewer protocol layer. The file `src/discovery/mcpClient.ts` keeps its name for now (rename is cosmetic, deferred).

#### Backward compatibility

- `--snapshot-file <path>` still works exactly as before. The orchestrator dispatches: snapshot file present → file path; otherwise → real browser. CI runs that don't want network access keep using pinned snapshot files (e.g. `examples/practice-test-login/snapshot.json`).
- `practiceTestLogin.test.ts` still uses the file-snapshot path so the regression test runs without network.

#### What this fixes

The 3-of-6 iteration rounds in Phase 1a milestone that were "snapshot accuracy" bugs (fictional ARIA roles, fictional placeholders, etc.) — those scenarios should now Just Work because the scanner sees the actual DOM.

### Phase 1a milestone — first end-to-end green run (earlier this round)

**The full rule-based pipeline produced a runnable Playwright spec from a real-world Cucumber `.feature` file, with zero hand-edits.** Validated against `https://practicetestautomation.com/practice-test-login/` — `npx playwright test --project=chromium` reports **7 passed (4.2s)**.

#### Scope

- Source feature: `examples/practice-test-login/login.feature` — 5 scenarios + 1 Scenario Outline (2 example rows) + Background = 7 generated `test()` blocks
- Discovery source: hand-authored `examples/practice-test-login/snapshot.json` (Phase 1a fallback; real `@playwright/mcp` lands in Phase 1b)
- Output target: `pages/login.page.ts`, `tests/login.spec.ts`, `playwright.config.ts`, `package.json`, `tsconfig.json`, `.gitignore`, `BDD_REVIEW.md`

#### Iteration arc that got us there

| Round | Pass / Fail | Root cause |
|---|---|---|
| 1 | 0 / 7 | Undeclared `loginPage` (facade emitted POM calls without instantiation) |
| 2 | 4 / 3 | Rule 3 lost role hint; rule 8 required "the" not "an"; word-order mismatch in rule 2 |
| 3 | 2 / 5 | Snapshot fictional ARIA roles (`role: "alert"` not on page) |
| 4 | 1 / 6 | Snapshot fictional placeholders (`placeholder: "Username"` not on page) |
| 5 | 6 / 1 | Rule 9 emitted `toHaveText` (exact); step said "containing" |
| 6 | **7 / 0** | (none) |

3 of 6 rounds were rule/code bugs. 3 were snapshot accuracy — exactly what real `@playwright/mcp` integration will eliminate (Phase 1b).

#### Bugs fixed this round (rule + code)

- **`emitTestFile` facade (`src/emitters/facade.ts`):** prepend `const <pageVar> = new <Class>(page);` to every test body and every hook body. Previously the spec emitted `await loginPage.goto()` without ever declaring `loginPage`.
- **`scaffold()` orchestrator (`src/index.ts`):** synthesise a `goto(): Promise<void>` POM method that calls `await this.page.goto(<url>)` when no goto exists. Without it, rule 1 emitted `await loginPage.goto()` against a method with no body.
- **POM file naming (`src/index.ts`):** use `pageObjectFileName` from `@vijaypjavvadi/pw-emit` instead of `${camelCase(opts.page)}.page.ts`. Was emitting `loginPage.page.ts`; now emits `login.page.ts`.
- **Reserved field-name filter (`src/index.ts`):** `page`, `context`, `browser` are now excluded from the "missing fields" set. Previously `loginPage.page.toHaveURL(...)` made `page` look like a missing field.
- **Step matcher rule 2b (`src/transformers/stepMatcher.ts`):** new — handles reversed word order `I enter <field> "<value>"`. Original rule expected `I enter "<value>" into <field>`.
- **Step matcher rule 3:** captures the explicit role suffix (`button` / `link` / `icon` / `tab`) and passes only that to `findField` so "click the login button" doesn't match `testLoginHeading`.
- **Step matcher rule 8:** accepts `the | an | a error message`, prefers `Alert > Error > Message`-suffixed fields.
- **Step matcher rule 9a:** new — `toContainText` semantics for `containing | that contains | with text`. Must run before rule 9b (exact text equality) which now also accepts `the | an | a`.
- **Step matcher rules 11–13:** new — redirect (`toHaveURL` regex), attribute check (`toHaveAttribute`), URL prefix/contains (`toHaveURL` anchored regex).
- **`findField` resolution order (`src/transformers/stepMatcher.ts`):** added a suffix-constrained pass — when preferredSuffixes are provided, only consider fields with those suffixes; if exactly one matches, use it. Stops "login" from matching `testLoginHeading` when there's a `submitButton` on the same page.
- **`synthFieldName` (`src/transformers/locatorPicker.ts`):** added `cssSelectorToName()` fallback. When no name/label/placeholder/text is available, derive the field name from the CSS id (`#username` → `usernameInput`) instead of the ugly `inputElement` placeholder.

#### Added

- `examples/practice-test-login/` — pinned regression fixture (login.feature + snapshot.json + README)
- `tests/e2e/practiceTestLogin.test.ts` — 22-assertion regression test for the full pipeline. Calls `scaffold()`, reads back POM + spec, asserts every binding pattern that should have landed.
- `vitest.config.ts` — `hookTimeout: 30_000` for E2E test cold-start reads.

### Added — Phase 1a (initial implementation, earlier this round)
- **Real Gherkin parser** — `src/parser/gherkinParser.ts`. Uses `@cucumber/gherkin`. Handles Background, Scenario, Scenario Outline + Examples, doc strings, data tables.
- **Step matcher rules** — `src/transformers/stepMatcher.ts`. 10 rules covering navigation, input, click, select, check/uncheck, visibility (positive + negative), text equality, URL, error message. Falls through to a warning when no rule matches.
- **Locator picker** — `src/transformers/locatorPicker.ts`. Priority chain `getByRole > getByLabel > getByPlaceholder > getByTestId > getByText > css > xpath`. Ambiguity flagged when rivals exist. Field-name synthesis with role-based suffixes (`usernameInput`, `signInButton`).
- **POM resolver** — `src/transformers/pomResolver.ts`. Pure decision: REUSE / AUGMENT / CREATE based on existing fields vs referenced fields.
- **Repo scanner** — `src/repo/repoScanner.ts`. `ts-morph`-based AST scan of `pages/*.page.ts`. Extracts class name, locator fields, methods (preserves bodies for AUGMENT mode).
- **Project scaffolder** — `src/repo/projectScaffolder.ts`. Delegates to `@vijaypjavvadi/pw-emit`'s `emitProject()`. Idempotent.
- **Page discovery (file-snapshot fallback)** — `src/discovery/mcpClient.ts`. Phase 1a reads a pre-captured JSON snapshot via `--snapshot-file`. Real `@playwright/mcp` integration scheduled for Phase 1b.
- **Snapshot parser** — `src/discovery/snapshotParser.ts`. Accepts both flat-array and tree-shaped snapshots; flattens to `ElementIR[]`.
- **Review report** — `src/reports/reviewReport.ts`. Writes `BDD_REVIEW.md` with severity sections (Errors / Warnings / Info).
- **TSC validator** — `src/validate/tscRunner.ts`. Runs `tsc --noEmit` in the target repo, parses diagnostics into `ReviewItem`s. Soft-fails with a warning if `tsc` isn't installed.
- **`scaffold()` end-to-end wired** — `src/index.ts`. Orchestrates: parse → scan repo → scaffold → discover → pick locators → match steps (provisional) → resolve POM → re-match against final POM → expand Scenario Outlines → emit POM + spec → tsc validate → review report.
- **`analyze()` working** — same pipeline minus emit/validate. Returns the plan.
- **CLI `--snapshot-file` flag** for the file-based discovery path.
- **Example fixture** `examples/login-feature/snapshot.json` — hand-authored a11y tree for end-to-end testing.
- **3 new unit test files**: `stepMatcher.test.ts`, `locatorPicker.test.ts`, `pomResolver.test.ts`.

### Still stubbed (next phases)
- `updatePom()` — needs lock-block enforcement (Phase 2)
- Real Playwright MCP integration (Phase 1b)
- HTTP worker that calls `scaffold()` (Phase 3)
- LLM fallback in stepMatcher (Phase 4)

### Added — Phase 0 (previous round)
- Repository scaffold: package.json, tsconfig, ESLint, Prettier, Vitest, TypeDoc, MIT LICENSE
- CI workflow (Node 18/20/22 × Ubuntu/macOS/Windows), Release workflow (tag-triggered npm publish with provenance)
- `.changeset` config for versioning
- `src/` skeleton: `cli.ts`, `server.ts`, `index.ts`, `types.ts`, `utils/{naming,logger}.ts`
- Module stubs (now most replaced by Phase 1a implementations)
- Project templates: `package.json.tmpl`, `playwright.config.ts.tmpl`, `tsconfig.json.tmpl`, `gitignore.tmpl`
- Example fixture: `examples/login-feature/login.feature`
- First passing unit test: `tests/unit/naming.test.ts`
- `@vijaypjavvadi/pw-emit` consumed via `file:../pw-emit`
- `src/emitters/facade.ts` rewritten to delegate to `pw-emit`

### Documents
- `README.md` — project orientation, decisions log, phasing
- `docs/SCOPE.md` — v1.0 scope, FR/NFR, CLI + HTTP surface
- `docs/ARCHITECTURE.md` — component diagram, sequence flows, contracts, error model

## [0.1.0] — TBD

Initial published placeholder. **No runtime functionality yet.** Phase 0 (extracting `@vijaypjavvadi/pw-emit` from `sel2pw`) blocks Phase 1 of this package.
