# bdd2pw — Current Status

> **Point-in-time snapshot.** This file describes what *actually works today* in
> the working tree, not the long-term roadmap. For the design contract see
> [`SCOPE.md`](./SCOPE.md); for the runtime topology see
> [`ARCHITECTURE.md`](./ARCHITECTURE.md); for the change log see
> [`../CHANGELOG.md`](../CHANGELOG.md).
>
> **Updated:** 2026-05-03
> **Branch:** `main`
> **Headline:** v1.0 functionally complete. Pending only the version bump + tag.

---

## 1. Validation matrix — real-world fixtures

Two live web apps, both end-to-end through the full pipeline (parser → repo
scanner → live browser scan → locator picker → step matcher → emit → tsc
validate). Both fixtures are checked into `examples/` and replayed in CI via the
`tests/e2e/*` regression suite.

| Fixture                    | Site                                                  | Scenarios | Steps mapped | Warnings | Outcome |
|----------------------------|--------------------------------------------------------|-----------|--------------|----------|---------|
| `practice-test-login`      | https://practicetestautomation.com/practice-test-login/ | 5 + outline + Background | **7 / 7** | **0**    | ✅ Clean — locked as regression |
| `cms-login`                | https://cms.anhtester.com (third-person dialect)       | 3         | **3 / 3**    | **0**    | ✅ Clean |
| `selenium11` (vague verbs) | (offline fixture, intentionally underspecified)        | 3         | 1 / 3        | 2        | ⚠️ Expected — flags LLM-fallback gap, kept as v1.1 motivator |

The first two are byte-stable across reruns: snapshot files are committed, so
the e2e tests don't depend on the live site being up.

---

## 2. What ships today

### Pipeline
- **Gherkin parser** (`src/parser/gherkinParser.ts`) — `@cucumber/gherkin` →
  `FeatureIR`. Handles `Background`, `Scenario`, `Scenario Outline` + `Examples`,
  `Given/When/Then/And/But`, doc strings, data tables, tags.
- **Repo scanner** (`src/repo/repoScanner.ts`) — `ts-morph` AST walk over
  `pages/*.page.ts`. Extracts `{ className, fields, methods }` per file. POSIX
  paths normalised on Windows.
- **Project scaffolder** (`src/repo/projectScaffolder.ts`) — copies template
  (`templates/`) when the target repo lacks `playwright.config.ts`. Idempotent.
- **POM resolver** (`src/transformers/pomResolver.ts`) — three-way decision:
  `reuse | augment | create` per `--page` name.
- **Live browser discovery** (`src/discovery/mcpClient.ts`) — direct
  `playwright.chromium.launch()` (chose direct Playwright over `@playwright/mcp`
  for simpler in-process control). Broad selector net including
  `[id*=error i]`, `[role=alert]`, etc. for status regions.
- **Snapshot fallback** (`--snapshot-file`, `--no-discovery`) — same code path
  consumes a checked-in JSON snapshot, so CI and offline use never need a live
  browser. Soft-fail on network errors so `BDD_REVIEW.md` always lands.
- **Locator picker** (`src/transformers/locatorPicker.ts`) — priority chain
  `getByRole` > `getByLabel` > `getByPlaceholder` > `getByTestId` > `getByText`
  > CSS > xpath. `dedupeLocators()` collapses by `(api, args)` identity,
  preferring longer field names. Status-region special case: id-derived field
  names + bypass visibility filter.
- **Step matcher** (`src/transformers/stepMatcher.ts`) — 15 deterministic
  rules. Subject-agnostic prefix `(?:I|user|User|the user|the User)`. Rule 2c
  emits `customBody` for compound multi-statement steps. Rule 9a → `toContainText`
  for "containing" assertions. No LLM in v1.0 — explicit `// TODO:` comment is
  emitted when no rule matches, and the gap is logged to `BDD_REVIEW.md`.
- **Emitter facade** (`src/emitters/facade.ts`) — adapter from bdd2pw IR to the
  shared `@vijaypjavvadi/pw-emit` IR. Prepends
  `const loginPage = new LoginPage(page);` to every test/hook body so generated
  specs compile out-of-the-box.
- **updatePom** (in `src/index.ts`) — append-only AST surgery via ts-morph
  `addProperty` / `addStatements`. Hard-fails if the named POM doesn't exist
  (no accidental creates). Reserved field names `{page, context, browser}` never
  participate.
- **tsc validator** — `tsc --noEmit` over emitted output; diagnostics rolled
  into `BDD_REVIEW.md`. Soft-fail (exit 0) — review is the deliverable.

### CLI (Commander, all real)
```
bdd2pw scaffold   <feature> --url <url> --page <Name> --repo <dir> [opts]
bdd2pw analyze    <feature> --url <url> [opts]            # dry-run, prints plan
bdd2pw update-pom --page <Name> --url <url> --repo <dir>  # additive POM merge
bdd2pw serve      [--port 4300]                           # start HTTP service
```

Useful flags wired: `--snapshot-file`, `--no-discovery`, `--no-validate`,
`--storage-state`, `--headed`, `--templates`, `--telemetry`, `--force`,
`--pages a,b,c`.

### HTTP service (Express :4300, all real)
- `POST /scaffold | /analyze | /update-pom` → `202 + { jobId, links }`.
- `GET  /jobs/:id` → live status (`queued | running | completed | failed`),
  stage (`parsing | discovering | emitting | completed | …`), `progress`,
  `warnings[]`, `errors[]`, `result`.
- `GET  /jobs/:id/artifact` → streamed `application/zip` of the per-job tmpdir
  (excludes `node_modules`, `.git`, `test-results`, `playwright-report`).
- `GET  /jobs/:id/log` → flat text dump of the job record (warnings + errors).
- `GET  /healthz | /readyz | /version` — operational probes.
- Async worker model — every `POST` is fire-and-forget into a Promise worker;
  request returns instantly with the job ID. Per-job artefacts land under
  `<os.tmpdir()>/bdd2pw-jobs/<jobId>/` so the user's `--repo` is never written
  through the HTTP path.
- Zod request validation, Pino structured logging, ULID job IDs.

### Templates
`templates/` ships a minimal Playwright TS project skeleton: `package.json`,
`playwright.config.ts`, `tsconfig.json`, `.gitignore`. Used whenever the target
`--repo` lacks a `playwright.config.ts`.

### Tests
**101 / 101 green** across 10 Vitest files:

| File                                             | Assertions | What it covers |
|--------------------------------------------------|------------|----------------|
| `tests/unit/gherkinParser.test.ts`               | 8          | Parser smoke + edge cases |
| `tests/unit/locatorPicker.test.ts`               | 11         | Priority + dedupe |
| `tests/unit/stepMatcher.test.ts`                 | 20         | All 15 rules + subject variants + regex-escape regression |
| `tests/unit/pomResolver.test.ts`                 | 6          | reuse / augment / create |
| `tests/unit/repoScanner.test.ts`                 | 5          | ts-morph extraction |
| `tests/snapshot/emitter.test.ts`                 | 6          | Golden POM + spec output |
| `tests/e2e/practiceTestLogin.test.ts`            | 24         | Real fixture #1, snapshot mode |
| `tests/e2e/cmsLogin.test.ts`                     | 12         | Real fixture #2, snapshot mode |
| `tests/e2e/updatePom.test.ts`                    | 10         | Append-only AST surgery |
| `tests/e2e/httpWorker.test.ts`                   | 11         | Full HTTP path including zip stream |

`tests/e2e/httpWorker.test.ts` boots the real Express app on a random port,
drives it via `fetch`, polls `GET /jobs/:id` to completion, and verifies the zip
artefact starts with the `PK\x03\x04` magic bytes.

---

## 3. Verification matrix

| Check                                                | Status | Notes |
|------------------------------------------------------|--------|-------|
| `tsc` clean over `src/**`                            | ✅      | `npm run verify` |
| Vitest suite green                                   | ✅      | 101 / 101 |
| `practice-test-login` regression — 7/7, 0 warnings   | ✅      | locked snapshot |
| `cms-login` regression — 3/3, 0 warnings             | ✅      | locked snapshot |
| HTTP zip artefact magic bytes                        | ✅      | `0x50 0x4B 0x03 0x04`, > 500 B |
| HTTP `/healthz`, `/readyz`, `/version` reachable     | ✅      | covered in e2e |
| `update-pom` is append-only (no field/method removed)| ✅      | covered in e2e |
| `update-pom` hard-fails on missing POM               | ✅      | covered in e2e |
| Soft-fail on network error during scan               | ✅      | review report still lands |
| Idempotent rerun (no diff)                           | ✅      | manual + e2e |
| Cross-platform path handling (Windows ↔ POSIX)       | ✅      | `path.normalize()` in tests |

Pending verifications **before tagging v1.0.0**:
- Fresh `npm install` → `npm run verify` on a clean checkout (no symlinked
  `node_modules`).
- `bdd2pw serve` smoke from the platform gateway (`/api/v1/scaffold/*`).

---

## 4. Recently shipped (chronological)

| Phase  | Headline | State |
|--------|----------|-------|
| 0      | `@vijaypjavvadi/pw-emit` extracted; sel2pw migrated; both produce byte-identical POM/spec shapes | ✅ Shipped |
| 1a     | Rule-based matcher + file-snapshot mode + 14-rule taxonomy locked via `practice-test-login` (6 iteration rounds, 0→7 mapped); URL-contains rule added as 11a in v1.0.1 (15 rules total) | ✅ Shipped |
| 1b     | Live `playwright.chromium.launch()` discovery; status-region special case; 4 iteration rounds against the live site, snapshot now stable | ✅ Shipped |
| 1c     | Second real fixture (`cms-login`, third-person dialect from selenium14) — 0 warnings first try | ✅ Shipped |
| 2      | `analyze` (dry-run) + `update-pom` (append-only AST surgery via ts-morph) | ✅ Shipped |
| 3      | Express HTTP service `:4300` — three async workers, ULID job IDs, zip artefact streaming, Zod validation, Pino logs | ✅ Shipped |
| Docs   | README rewritten from "pre-code, in design phase" stub to full v1.0; CHANGELOG, STATUS, SCOPE updates | 🚧 In progress (this pass) |

---

## 5. Known deferred items

Tracked for v1.1+, **not** blocking v1.0:

| Item                                                 | Target | Why deferred |
|------------------------------------------------------|--------|--------------|
| LLM fallback for vague steps (governance-routed)     | v1.1   | Real fixtures don't need it; `selenium11` proves the gap exists but is small. |
| SQLite-backed job persistence (currently in-memory)  | v1.1   | In-process Map is fine for single-tenant local runs and gateway proxy use. |
| Auth flows — built-in `auth.setup.ts` generator      | v1.1   | Today: user provides `--storage-state` if scanning protected pages. |
| Multi-page navigation discovery                      | v1.2   | Today: one URL per command; multi-page = multiple invocations. |
| `playwright-bdd` runtime mode (keep `.feature` live) | v1.3   | Today: `.feature` is generation input only, output is plain Playwright. |
| API mocking scaffolds via `page.route()`             | v1.4   | Out of scope for first cut. |
| Visual regression baselines                          | v1.5   | Out of scope for first cut. |
| Bidirectional sync (spec → `.feature`)               | v2.0   | Long-term. |
| `.exe` build via `@yao-pkg/pkg`                      | post-1.0 | Same toolchain as sel2pw; uncomplicated, just hasn't been wired. |
| Telemetry SQLite + recurring-gap report              | post-1.0 | Optional dep already declared; harness not yet wired. |

---

## 6. What's next

In order:

1. **Finish the docs pass** (this one): STATUS ✅, SCOPE phasing/decisions
   update next.
2. **Tag `v1.0.0`** — bump `package.json`, write release notes from CHANGELOG,
   `git tag v1.0.0`. No publish to npm yet (private platform first).
3. **Gateway integration** — wire `/api/v1/scaffold/*` in
   `modern-automation-platform` to proxy `:4300`.
4. **v1.1 LLM fallback** — wire `governanceClient` + Anthropic provider, gate
   behind `--llm`. Re-run `selenium11` fixture; target 3/3 mapped.
5. **sel2pw consumer parity check** — rerun sel2pw's snapshot suite against the
   shipped `pw-emit` to confirm zero drift.

---

## 7. Files of interest

| Area                | Path |
|---------------------|------|
| Public API          | `src/index.ts` |
| CLI entry           | `src/cli.ts` |
| HTTP entry          | `src/server.ts` |
| HTTP routes         | `src/http/routes.ts` |
| HTTP zip stream     | `src/http/artifacts.ts` |
| HTTP request schemas| `src/http/schemas.ts` |
| In-memory job store | `src/http/jobs.ts` |
| Gherkin parser      | `src/parser/gherkinParser.ts` |
| Repo AST scanner    | `src/repo/repoScanner.ts` |
| Project scaffolder  | `src/repo/projectScaffolder.ts` |
| Live browser scan   | `src/discovery/mcpClient.ts` |
| Locator priority    | `src/transformers/locatorPicker.ts` |
| Step → POM rules    | `src/transformers/stepMatcher.ts` |
| reuse/augment/create| `src/transformers/pomResolver.ts` |
| Emitter adapter     | `src/emitters/facade.ts` |
| Shared emitter lib  | `../pw-emit/src/*` |
| Real fixture #1     | `examples/practice-test-login/` |
| Real fixture #2     | `examples/cms-login/` |
| HTTP e2e            | `tests/e2e/httpWorker.test.ts` |
| Scope contract      | `docs/SCOPE.md` |
| Architecture        | `docs/ARCHITECTURE.md` |
| Phase-0 plan        | `docs/PHASE_0_PLAN.md` |
