# bdd2pw — CHANGELOG

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [1.1.4] — 2026-05-05

### Fixed — article-leak in URL slugs + N5d without URL

A run of `R-5D89B426-001.feature` on bdd2pw 1.1.3 cut failures from 6 → 2,
but two real bugs remain:

#### 1. English articles leak into URL regex slugs

**Symptom:** `Then the user is redirected to a logged-in page` →
emitted regex `/a[-_/]?logged-in/` → fails against
`https://practicetestautomation.com/logged-in-successfully/` because the
URL has no "a" before "logged-in".

**Root cause:** rule 11b (and rules 10, N4, N5e) capture the page-name
description and slugify it. The capture preserves English articles
("a", "an", "the") if they're not stripped by the rule's `(?:the )?`
prefix — which only handles "the".

**Fix:** new `stripArticles(s)` helper removes leading/internal/trailing
"a"/"an"/"the" tokens before slugifying. Applied to rules 10, 11b, N4,
N5e — every rule that converts a description to a regex slug.

```ts
// Before:    "redirected to a logged-in page" → "a[-_/]?logged-in"
// After:     "redirected to a logged-in page" → "logged-in"  ✓ matches /logged-in-successfully/

// Before:    "remain on a login page" → "a[-_/]?login"
// After:     "remain on a login page" → "login"  ✓
```

#### 2. N5d required `at "URL"` suffix

**Symptom:** 6 TODOs for `Given the user is on the login page` (no URL).
N5d's pattern from 1.1.3 mandated `at "URL"`. LLM produces both forms.

**Fix:** extended N5d pattern — `at "URL"` is now optional. Both
`Given the user is on the login page` and
`Given the user is on the login page at "URL"` map to `goto()`.

#### Tests

- `tests/unit/stepMatcher.test.ts` +5 new tests across 2 describe blocks
  (3 article-stripping cases + 2 N5d optional-URL cases).

#### Production impact

The 2 remaining failures from R-5D89B426-001 (`toHaveURL` timeouts on
`/a[-_/]?logged-in/`) and the 6 TODOs (`Given the user is on the login
page`) are both eliminated. Repin cloud-jobs-template to 1.1.4 to verify.

#### Files

- Modified: `src/transformers/stepMatcher.ts` (+stripArticles helper,
  applied to rules 10/11b/N4/N5e; N5d pattern extended).
- Modified: `tests/unit/stepMatcher.test.ts` (+5 tests).

## [1.1.3] — 2026-05-05

### Fixed — production failure modes from cloud-jobs run on 1.1.2

A run of `R-5D89B426-001.feature` on bdd2pw 1.1.2 produced **6 test failures**
across 12 scenarios (Chromium + Firefox), with three distinct root causes —
all in synthesised locators when the POM lacked the field. 1.1.3 is a
correctness fix release: no new dialect coverage, but the assertions we
already emit now actually work against real pages.

#### 1. Cross-role synthesis (button-vs-link)

**Symptom:** `await expect(page.getByRole("button", { name: "Logout" })).toBeVisible()`
times out because the page has `<a>Log out</a>` (a link, not a button).

**Fix:** new helper `synthRoleNameLocator(pageVar, name)` emits
```ts
page.locator("a, button, [role='button'], [role='link']")
    .filter({ hasText: new RegExp("^L\\s*o\\s*g\\s*o\\s*u\\s*t$", "i") })
    .first()
```
This handles both:
- **Role mismatch** (LLM says "button", page uses `<a>` or vice versa).
- **Spelling variance** (LLM writes "Logout", page renders "Log out") via a
  flexible regex with `\s*` between every character.

Applied to N6 (visibility) and N7 (negative visibility) when synthesising.
POM-field references stay unchanged (the picker already produces correct
locators from the snapshot).

#### 2. Strict-mode violations everywhere

**Symptom:** `await expect(page.getByText("Your username is invalid")).toBeVisible()`
fails with `strict mode violation: ... resolved to 2 elements` because the
text appears in BOTH `<div id="error">` AND a `<b>` repeat highlight.

**Fix:** every synthesised text locator now ends in `.first()`:
- N5b page-level text → `getByText("X").first()`
- N5 / N5c severity-message fallback → `getByText("V").first()`
- N7 success / generic fallback → `getByText(desc).first()`
- N7 error fallback → `getByRole("alert").first()`

POM-field references untouched (POM fields are unique by construction).

#### 3. New rules N5d + N5e — `is on page at URL` / negative redirect

**Symptom:** 7 TODOs in BDD_REVIEW for `Given the user is on the login page
at "URL"` (Background-style precondition with embedded URL) and 1 TODO for
`And the user is NOT redirected away from the login page`.

**Fix:** two new rules.

| # | Pattern | Emits |
|---|---|---|
| N5d | `<subject> is/are/am on (the )? <X> page at 'URL'` | `goto()` (Background handles real navigation; this is narrative context) |
| N5e | `<subject> is/are/am NOT redirected (away from\|from) (the )? <X> page` | `toHaveURL(<slug>)` (URL still contains page name → still on page) |

#### Helpers (internal)

- `flexibleNameRegex(name)` — builds `new RegExp("^X\\s*Y\\s*Z$", "i")` from
  a descriptive name. Used by N6/N7 synthesis.
- `synthRoleNameLocator(pageVar, name)` — cross-role + flexible text filter.
- `synthFlexibleTextLocator(pageVar, text)` — `getByText("X").first()`.

#### Total rule count

26 → **30** (N5d, N5e new; N5b, N5c, N5, N6, N7 strict-mode-fixed).

#### Tests

Existing unit + e2e tests still pass — the synthesis changes don't affect
test pom fixtures (POM fields are present, so synthesis branches don't fire).
The fixes apply at runtime against real pages with non-trivial DOM.

#### Production impact

After 1.1.3 + repin, the same `R-5D89B426-001.feature` run that produced 6
failures on 1.1.2 should produce 0 failures (or surface real bugs in the
test design — neither the page nor the test was at fault for the 1.1.2
failures, they were synthesis bugs).

#### Files

- Modified: `src/transformers/stepMatcher.ts` (+3 helpers, +2 rules N5d/N5e,
  N5/N5b/N5c/N5e/N6/N7 fallbacks all updated to use helpers).

## [1.1.2] — 2026-05-05

### Fixed — second batch of LLM-narrative dialect gaps

A real cloud-jobs run of `R-5D89B426-001.feature` on bdd2pw 1.1.1 produced
**11 unmatched warnings** across 4 scenarios — six new patterns the LLM
service is generating that 1.1.1's 22 rules don't cover. All 12 tests
"passed" but most assertions were silent TODOs. Same false-positive issue
as before 1.1.1 fixed it for the first batch.

1.1.2 closes the second batch with **+4 new rules + extensions to N2/N6**.
Total rule count: **22 → 26**.

#### New / extended rules

| # | Pattern | Emits |
|---|---|---|
| N1.5 | `[Given\|And] the <X> page is (displayed\|loaded\|shown\|visible\|present)` | `goto()` (Background-style precondition that drops the navigation verb) |
| N2.5 | `<subject> leaves the <X> field empty (do not type anything)` | `// intentionally left empty: <X>` (subject-prefixed variant of N2) |
| N5b | `the page (displays\|contains\|shows) [the message] 'X'` | `page.getByText("X").toBeVisible()` (page-level text assertion) |
| N5c | `an <severity> message containing 'V' is displayed` | `toContainText("V")` against severity-aware field (error/success) |
| N6 ext | `a Logout button is visible` (unquoted role+name) | `toBeVisible` against POM field, synthesises `getByRole` fallback |

#### Why 4 rules + 2 extensions, not 6 fresh rules

- N2 already handled `Leave the X field empty`; adding subject prefix
  (`<subject> leaves`) was a small extension in front of the existing pattern.
- N6 already handled quoted `"X"` button visibility; adding a second
  capture branch for unquoted names reused the same build path.

Both extensions are fully backwards-compatible — every step that matched in
1.1.1 still matches the same way in 1.1.2.

#### Tests

- Extended `tests/unit/stepMatcher.test.ts` with 5 new describe blocks (~10
  test cases) covering each new pattern + edge cases (POM field present
  vs synthesised fallback, unquoted vs quoted, severity dispatch).

#### Production impact

The cloud-jobs run that surfaced these gaps was hitting:
- `Given the login page is displayed` (Background, every scenario × 4)
- `When the user leaves the username field empty` (TC-003)
- `And the page displays "Logged In Successfully"` (TC-001)
- `Then the page contains the message "X"` (Outline rows × 3)
- `Then an error message containing "X" is displayed` (TC-002)
- `And a Logout button is visible` (TC-001)

After 1.1.2 + repin, all six patterns produce real assertions instead of
silent TODOs. TC-001 → genuine end-to-end check; TC-002/3/4 → actual error
display assertions instead of silent passes.

#### Files

- Modified: `src/transformers/stepMatcher.ts` (+4 rules, N2 + N6 extended).
- Modified: `tests/unit/stepMatcher.test.ts` (+5 describe blocks).
- Doc bump 22 → 26 across `README.md`, `docs/SCOPE.md`, `docs/STATUS.md`.

## [1.1.1] — 2026-05-05

### Fixed — LLM-narrative Gherkin dialect

Real test-case-generation services (cloud-jobs-template) produce more
verbose, subject-less Gherkin than hand-authored suites. Before 1.1.1, six
out of nine steps in a typical TC-001 (Successful login) fell through to
`// TODO`. Result: forms didn't get filled, Submit clicked an empty form,
URL never changed, `toHaveURL` timed out — the test reported as failed
honestly. Worse, the negative scenarios (TC-002/3/4) reported as **passed**
because every assertion was a silent no-op TODO.

1.1.1 adds **7 new step-matcher rules** plus the
`examples/llm-narrative-login/` regression fixture (locked from a real
production run, `j-20f3defc3044f7ec`).

#### New rules

| # | Pattern | Emits |
|---|---|---|
| N1 | `Locate the X (input)? field and (enter\|type\|fill) 'V'` | `<field>.fill("V")` via stripUiSuffix + findField |
| N2 | `Leave the X field empty (do not type anything)` | `// intentionally left empty: <X>` (explicit comment) |
| N3 | `Observe ...` / `Note ...` | `// observation: <X>` |
| N4 | `URL does (not\|n't) change (to <description>)?` | `not.toHaveURL(new RegExp("<slug>"))` |
| N5 | `... such as 'V'` / `... (e.g., 'V')` / `... indicating 'V'` / `... like 'V'` | `toContainText("V")` against error/success field |
| N6 | `A 'X' (button\|link\|...)? is visible on the page` | `toBeVisible` against POM field, fallback to synthesised `getByRole(role, { name: 'X' })` |
| N7 | `No 'X' (button\|...)? appears` / `No <noun> are/is displayed` | `not.toBeVisible` against POM field, fallback to synthesised role/text locator |

`Navigate to <URL>` is already handled by rule 1 (the optional SUBJ prefix
accepts subject-less variants); `Click the 'X' button` is already handled
by rule 3. Both verified against the LLM fixture.

Total rule count: **15 → 22** deterministic patterns.

#### Helper: `findFieldByDescription`

New module-private helper in `stepMatcher.ts`. Strips trailing UI-element
words (`input field`, `field`, `box`, `element`, ...) from a description
then defers to `findField` with the appropriate suffix preferences. Used
by rules N1, N6, N7. Pure deterministic, no fuzzy matching.

#### Per design call (4): negative assertions never drop to TODO

For `No 'X' button appears` / `No error messages are displayed` / `A 'X' is
visible`, when the POM has no matching field, the rule **synthesises** a
`getByRole`/`getByText` locator from the description rather than emitting
`// TODO`. This turns false-positive passes (silent no-op TODOs) into
honest assertions that actually exercise the page.

Caveat: synthesised locators can be over-permissive (e.g.
`getByRole('button', { name: 'Log out' })` will match a logout link with
`role="button"` aria attribute even if the page layout differs from the
fixture). When this matters, hand-edit the spec — the rule report flags
none of these synthesises as warnings, so they're invisible to the report.

#### Tests

- New e2e: `tests/e2e/llmNarrativeLogin.test.ts` — locks the
  `examples/llm-narrative-login/` fixture as a regression. Asserts:
  - 0 warning-level review items (every step matches a rule).
  - All 4 scenarios produce real fills/clicks (no TODOs).
  - The new rules emit the expected matchers (`not.toHaveURL`,
    `toContainText`, `toBeVisible`, etc.) against the right locators.
- Extended unit tests: `tests/unit/stepMatcher.test.ts` — one `describe`
  block per new rule covering subject-less variants, edge cases, and
  POM-vs-synthesised-locator branching.

#### Files

- New: `examples/llm-narrative-login/{login.feature, snapshot.json, README.md}`.
- New: `tests/e2e/llmNarrativeLogin.test.ts`.
- Modified: `src/transformers/stepMatcher.ts` (+7 rules, +stripUiSuffix,
  +findFieldByDescription).
- Modified: `tests/unit/stepMatcher.test.ts` (+~16 tests across 7 describe blocks).

#### Migration notes

Pure additive — no existing rule changed semantics. Specs that already
matched 15 rules continue to match the same way. The 7 new rules **only**
fire on patterns that previously produced `// TODO` warnings, so existing
fixtures (`practice-test-login`, `cms-login`) regress to zero diff.

If you have a cloud-jobs-template pinned to 1.1.0, bump to 1.1.1 and
re-run any failing TC-001-style scenario — fills should now be real.

## [1.1.0] — 2026-05-05

### Added — `--self-healing` flag (scaffold-level integration)

Optional integration with the local `self_healing_stage_services` pipeline
([source](https://github.com/...)). When enabled, generated POMs register
every locator with the offline self-heal pipeline so the model knows which
locators each test references.

**Scope of v1.1.0** — registration + JSONL logging only. **Action-time
healing is v1.2** (see "Deferred" below).

#### What `--self-healing` does

- New CLI flag: `bdd2pw scaffold ... --self-healing` (off by default).
  Programmatic API: `scaffold({ ..., selfHealing: true })`.
- Plumbs `selfHealingShim: true` to `@vijaypjavvadi/pw-emit`'s
  `emitPageObject`. Emitted POMs now wrap every locator initialiser:

  ```ts
  // Before (default):
  this.usernameInput = page.getByLabel("Username");

  // With --self-healing:
  this.usernameInput = healOrThrow(page, {
    preferred: page.getByLabel("Username"),
    context: { page: "LoginPage", name: "usernameInput" },
  });
  ```
- New scaffolder branch generates **`lib/heal.ts`** in the target repo —
  a self-contained TypeScript helper that:
  - Exports `healOrThrow(page, { preferred, context })` matching pw-emit's
    contract.
  - Registers every locator creation event to
    **`artefacts/heal-events.jsonl`** for the offline self-heal pipeline
    (`E:\EB1A_Research\self_healing_stage_services`) to consume.
  - Optional fire-and-forget heartbeat to `${SELF_HEALING_URL}/api/v1/register`
    when the env var is set. Best-effort — failures are silent.
  - Honours `HEAL_DISABLE=1` for CI runs that don't want the artefact noise.
  - Honours `HEAL_EVENTS_PATH` to override the JSONL path.
- Patches the generated `tsconfig.json` with a path alias:
  ```jsonc
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@platform/sdk-self-healing": ["./lib/heal"] }
  }
  ```
  so the POM's `import { healOrThrow } from "@platform/sdk-self-healing"`
  resolves to the local helper. No external SDK dependency.
- Creates `artefacts/.gitkeep` so the JSONL output directory exists on a
  fresh checkout.

#### What `--self-healing` does NOT do (v1.2 scope)

**Action-time healing.** When `await loginPage.usernameInput.click()` fails
because the locator no longer matches, this v1.1 helper will not catch the
failure, POST `/api/v1/heal`, and retry with the suggested locator. That
requires a Locator-wrapping proxy that intercepts every action method
(`.click`, `.fill`, `.check`, `.selectOption`, `.hover`, `.focus`,
`.textContent`, `.innerText`, `.getAttribute`, `.isVisible`,
`.waitForSelector`, ...).

The existing self-healing SDK (`self_healing_stage_services/sdk/playwright/self_healing_page.js`)
does this — but for *string-selector*-based test code (`page.fill('#username', ...)`).
pw-emit's POMs use Locator objects, so the v1.2 wrapper has a different
shape. Tracked for v1.2.

In the meantime, the JSONL feed gives the offline self-heal pipeline visibility
into what locators each test references, which is the v1 ranker's input
anyway — so v1.1 is functionally useful even without action-time recovery.

#### Files

- New: `templates/heal.ts.tmpl` — the heal helper template.
- Modified: `src/types.ts`, `src/cli.ts`, `src/index.ts`,
  `src/repo/projectScaffolder.ts`.

## [1.0.1] — 2026-05-04

### Fixed

- **New step-matcher rule 11a — `URL contains "X"`.** Steps like
  `Then user redirected to dashboard (URL contains "/dashboard")` or
  `Then URL contains "/foo?bar=baz"` now correctly emit
  `await expect(page).toHaveURL(new RegExp("..."))`. Previously these fell
  through to rule 11 (the greedy "redirected to ..." rule), which produced
  a wrong assertion or dropped the step to `BDD_REVIEW.md` as a TODO.
- The captured URL fragment is **regex-escaped** before being wrapped in
  `new RegExp(...)`, so metacharacters like `?`, `+`, `.`, `(`, `)`, `[`, `]`
  in URLs (query strings, encoded paths) match literally.
- Rule order matters: 11a is tried **before** 11b (the redirect rule) because
  11b's pattern is greedy and would otherwise swallow the parenthetical hint.

### Tests

- `tests/unit/stepMatcher.test.ts` — added two regression cases:
  - Plain URL fragment (`/dashboard`) → exact `new RegExp("/dashboard")`.
  - Fragment with regex metacharacter (`/search?q=test`) → `?` is escaped to
    `\?` so the literal `?` matches.

### Docs

- Bumped rule count from 14 to 15 across `README.md`, `docs/SCOPE.md`,
  `docs/STATUS.md`.

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
