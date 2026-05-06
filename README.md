# bdd2pw — Gherkin `.feature` → Playwright TypeScript scaffold

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen?logo=node.js)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-101%20passing-brightgreen)](./tests)
[![Real-world fixtures](https://img.shields.io/badge/real--world%20fixtures-2-brightgreen)](./examples)

Most teams writing BDD test cases (via Cucumber `.feature` files, possibly authored by an LLM) face the same gap: the `.feature` describes the test, but **someone still has to write the Page Objects and the Playwright spec by hand**. That's the work `bdd2pw` does for you.

Point it at a `.feature` file and a URL. It parses the Gherkin, scans the live page with Chromium, picks the most stable locator for every interactive element, matches each step to a POM method call, and emits a runnable Playwright TypeScript repo — including `playwright.config.ts`, `pages/login.page.ts`, `tests/login.spec.ts`, and a `BDD_REVIEW.md` listing anything a human still needs to look at.

## What `bdd2pw` is and isn't

`bdd2pw` is a **scaffolder**, not an oracle. The output is honest about its limits:

- **Specific `.feature` files** — quoted credentials, concrete assertion targets, standard verb forms — convert to **runnable specs with zero hand-edits**. Validated end-to-end against a real public site (`https://practicetestautomation.com/practice-test-login/`): 7/7 scenarios green.
- **Vague `.feature` files** — "Enter valid username and password and click login button" with no quoted values — get partial coverage. Steps that can't be unambiguously mapped land as `// TODO` comments in the spec, and warnings in `BDD_REVIEW.md`. The user finishes the 1-3 ambiguous steps; the locators, POM scaffold, project config, and Background `goto()` are already done.
- **No LLM in the v1.0 hot path.** The 30-rule matcher (14 in v1.0, +1 URL-contains in v1.0.1, +7 LLM-narrative in v1.1.1, +4 in v1.1.2, +2 in v1.1.3 with cross-role synthesis + strict-mode-safe fallbacks) covers three Cucumber dialects (first-person, third-person, no-subject) plus compound input steps. Genuinely vague steps are inherently ambiguous and get `// TODO` — better than an LLM guessing.
- **`updatePom` is append-only by construction.** Re-scanning a page that already has a Page Object adds new locators only. Hand-edited method bodies, custom helper methods, custom imports are all preserved byte-identical. Never deletes, never renames, never modifies.

> **The pitch.** Run `bdd2pw scaffold` and you get a Playwright TS repo where `npx playwright test` runs against the real site. For specific fixtures, all green. For vague ones, the 60-90% you'd otherwise hand-write is done; you finish the rest.

## Where this fits in the platform

| Stage | Service | Role |
|---|---|---|
| 1. Generate | `test-case-generation-service` (FastAPI :4100) | Author `.feature` files from requirements |
| **1.5. Scaffold** | **`bdd2pw` (this repo) — Express :4300 + CLI** | `.feature` + URL → POM + spec, ready to run |
| 2. Migrate | [`@vijaypjavvadi/sel2pw`](https://github.com/javvadivijayprasad/sel2pw) (Express :4200) | Legacy Selenium → Playwright |
| 3. Stabilise | `self-healing-stage-services` (FastAPI :8003) | Heal locators at runtime |
| 4. Govern | `ai-governance` (Python lib + sidecar :8004) | Sanitise every LLM payload (when v1.1 LLM fallback ships) |
| Orchestrate | `modern-automation-platform` (Express :3000) | Auth, jobs, UI, artifacts |

`bdd2pw` and `sel2pw` are siblings. Both consume **`@vijaypjavvadi/pw-emit`** (the shared emitter library), so the Page Objects produced by one are byte-identical in shape to those produced by the other.

## Install

```bash
npm install -D @vijaypjavvadi/bdd2pw
npx playwright install chromium    # browser for live page discovery
```

Node ≥ 18. Cross-platform (Linux / macOS / Windows). `playwright` is an optional dep — if you don't install browsers, pass `--snapshot-file <path.json>` instead.

## Quick start

```bash
# Scaffold a runnable Playwright TS project from a .feature file
npx bdd2pw scaffold path/to/login.feature \
  --url https://your-app.example.com/login \
  --page LoginPage \
  --repo ./my-tests

cd ./my-tests
npm install
npx playwright test
```

That's it. `./my-tests` now has `pages/login.page.ts`, `tests/login.spec.ts`, `playwright.config.ts`, `package.json`, `tsconfig.json`, `.gitignore`, and `BDD_REVIEW.md`.

## CLI surface — three commands

### `scaffold` — generate a fresh repo

```bash
bdd2pw scaffold <feature> --url <url> --page <Name> --repo <dir> [options]
```

Reads the `.feature`, scans the URL with Chromium, picks locators, matches steps, emits the project. Flags:

```
--snapshot-file <path>       Use a captured JSON snapshot instead of launching a browser
--no-discovery               Skip page discovery entirely (rule-only probing)
--storage-state <path>       Pre-authenticated storage state JSON
--headed                     Show browser during scan
--templates <dir>            Override default project templates
--dry-run                    Print plan, write nothing
--no-validate                Skip tsc --noEmit step
--force                      Overwrite existing spec files
```

### `analyze` — dry-run the matcher

```bash
bdd2pw analyze <feature> --url <url> [options]
```

Same pipeline but writes nothing — prints the parsed feature, the discovered locators, and the planned step bindings as JSON. Useful for "what would scaffold do?" probing.

### `update-pom` — merge new locators into an existing POM

```bash
bdd2pw update-pom --page <Name> --url <url> --repo <dir> [options]
```

Re-scan the page and **append** any newly-discovered locators to the existing Page Object. Never touches existing fields, methods, or specs. Hand-edited method bodies survive byte-identical.

## HTTP service

`bdd2pw serve` starts an Express service on `:4300` with the same three commands as REST endpoints. Mirror of the CLI; HTTP is a thin shell.

```bash
bdd2pw serve --port 4300

# In another terminal:
curl -X POST http://localhost:4300/scaffold \
  -H 'content-type: application/json' \
  -d '{"feature":"/abs/path/to/login.feature","url":"https://...","page":"LoginPage","repo":"unused","options":{"snapshotFile":"/abs/snapshot.json","noValidate":true}}'
# → 202 Accepted: {"jobId":"01HX...","links":{"self":"/jobs/01HX...","artifact":"/jobs/01HX.../artifact"}}

curl http://localhost:4300/jobs/01HX...           # poll for completion
curl -O http://localhost:4300/jobs/01HX.../artifact   # download zip
```

| Endpoint | Purpose |
|---|---|
| `GET /healthz`, `/version`, `/readyz` | Liveness probes |
| `POST /scaffold`, `/analyze`, `/update-pom` | Async job — returns `202` + `jobId` |
| `GET /jobs/:id` | Job status / progress / result |
| `GET /jobs/:id/artifact` | Stream zip of the scaffolded repo |
| `GET /jobs/:id/log` | Plain-text dump of warnings + errors |

In production, the platform gateway proxies `/api/v1/scaffold/*` to `:4300`. Direct port exposure is local-dev only.

## Pipeline

```
.feature file
     │
     ▼
┌──────────────┐
│ gherkinParser│  @cucumber/gherkin → FeatureIR (scenarios, background, examples)
└──────┬───────┘
       ▼
┌──────────────┐
│  repoScanner │  ts-morph → existing pages/*.page.ts → Map<class, IR>
└──────┬───────┘
       ▼
┌──────────────┐
│ pomResolver  │  CREATE / AUGMENT / REUSE decision
└──────┬───────┘
       ▼
┌──────────────┐
│ scanPage     │  playwright chromium → DOM walk → ElementIR[]
│              │  (or --snapshot-file / --no-discovery fallbacks)
└──────┬───────┘
       ▼
┌──────────────┐
│ locatorPicker│  getByRole > getByLabel > getByPlaceholder > getByTestId
│              │  > getByText > css > xpath
│              │  Status-region special case + dedup by (api, args)
└──────┬───────┘
       ▼
┌──────────────┐
│ stepMatcher  │  30 rules — subject-agnostic, dialect-tolerant,
│              │  compound-input via customBody
└──────┬───────┘
       ▼
┌──────────────┐
│ pw-emit      │  @vijaypjavvadi/pw-emit → POM TS + spec TS + project scaffold
└──────┬───────┘
       ▼
┌──────────────┐
│ tscRunner    │  Optional tsc --noEmit → diagnostics into BDD_REVIEW.md
└──────┬───────┘
       ▼
output/
  pages/<name>.page.ts
  tests/<name>.spec.ts
  playwright.config.ts
  package.json, tsconfig.json, .gitignore
  BDD_REVIEW.md   ← warnings + manual TODOs
```

## What `bdd2pw` covers

### Step matcher rules (14)

| # | Pattern | Emits |
|---|---|---|
| 1 | `(I/user) am on/navigate to/visit/open <X>` (with or without quoted URL) | `goto()` |
| 2a | `(I/user) enter "<value>" into <field>` | `<field>.fill("<value>")` |
| 2b | `(I/user) enter <field> "<value>"` | `<field>.fill("<value>")` |
| 2c | **Compound:** `(I/user) enter <f1> "<v1>" <f2> "<v2>" ...` | N `.fill()` lines |
| 3 | `(I/user/-) click/press/tap <X> button/link/icon/tab` | `<field>.click()` (or POM method if defined) |
| 4 | `(I/user) select "<opt>" from <dropdown>` | `<field>.selectOption(...)` |
| 5 | `(I/user) check/uncheck <checkbox>` | `<field>.check()` / `.uncheck()` |
| 6 | `(I/user) (should) see <X>` | `expect(<X>).toBeVisible()` |
| 7 | `(I/user) should not see <X>` | `expect(<X>).toBeHidden()` |
| 8 | `(I/user) should see (the/an/a) error message "<X>"` | `expect(<errorField>).toContainText("<X>")` |
| 9a | `(I/user) should see <X> containing/with text "<Y>"` | `expect(<X>).toContainText("<Y>")` |
| 9b | `(I/user) should see <X> "<Y>"` (exact equality) | `expect(<X>).toHaveText("<Y>")` |
| 10 | `(I/user) should remain on <page>` | `expect(page).toHaveURL(/<page>/)` |
| 11 | `(I/user) (should be/is) redirected to <page>` | `expect(page).toHaveURL(/<page>/)` |
| 12 | `the <field> field should be of type "<type>"` | `expect(<field>).toHaveAttribute("type", "<type>")` |
| 13 | `the (current) URL should start with/contain "<X>"` | `expect(page).toHaveURL(/^<X>/)` |

### Cucumber features

- `Background:` → `test.beforeEach`
- `Scenario Outline:` + `Examples:` → one `test()` per row, with placeholder substitution
- `Tags` → emitted as `// @tag` comments above each test
- Doc strings + data tables — preserved on `StepIR.argument`

### Locator priority

`getByRole` (with accessible name) > `getByLabel` > `getByPlaceholder` > `getByTestId` > `getByText` > CSS > xpath. **Status regions** (`<div id="error">`, `[role=alert]`, `[class*=notification]`) bypass the visibility filter (they're hidden until triggered) and use their `id` for both field name and locator (text content is volatile, id is stable).

## Verification

| Check | Status |
|---|---|
| `npm run lint` | ✅ clean |
| `tsc --noEmit` | ✅ clean |
| `npm test` (vitest) | ✅ **101/101 green** across 10 test files |
| `practice-test-login` end-to-end vs the live site | ✅ **7/7** scenarios green via `npx playwright test` |
| `cms-login` (selenium14 dialect) regression | ✅ 12 assertions green, third-person + compound input + `is redirected` |
| HTTP worker zip download | ✅ end-to-end test verifies real ZIP magic bytes |
| `update-pom` preserves hand-edited method bodies | ✅ 5 byte-identical-survival assertions |

## Roadmap

| Phase | Status | Headline |
|---|---|---|
| Phase 0 | ✅ Shipped | `@vijaypjavvadi/pw-emit` extracted; sibling package consumed by both `bdd2pw` and (planned) `sel2pw v1.2` |
| Phase 1a | ✅ Shipped | Gherkin parser, step matcher rules, locator picker, POM resolver, repo scanner, file-snapshot discovery, scaffold orchestration |
| Phase 1b | ✅ Shipped | Real Chromium-based page discovery via `playwright`, dialect-agnostic rules |
| Phase 1c | ✅ Shipped | Third-person + compound-input dialect coverage; second real-world fixture pinned |
| Phase 2 | ✅ Shipped | `update-pom` with append-only AST surgery — preserves hand-edits byte-identical |
| Phase 3 | ✅ Shipped | HTTP service `:4300` with three real workers + zip artifact download |
| **v1.0 (this release)** | **Ready to tag** | All of the above |
| v1.1 | Roadmap | LLM fallback for genuinely-vague steps, governance-routed |
| v1.2 | Roadmap | sel2pw migration onto `pw-emit`; multi-page scenario discovery |
| v1.3 | Roadmap | Optional `playwright-bdd` runtime mode |

## Documents

| Doc | Purpose |
|---|---|
| [`docs/SCOPE.md`](./docs/SCOPE.md) | What's in / out of v1.0, FR/NFR, CLI + HTTP surface, decisions log |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Component diagram, sequence diagrams, `pw-emit` contract, HTTP API contract, error model |
| [`docs/PHASE_0_PLAN.md`](./docs/PHASE_0_PLAN.md) | The pw-emit extraction plan (mostly historical now — it shipped) |
| [`docs/STATUS.md`](./docs/STATUS.md) | Verified state right now — what works, what's pending, what's deferred |
| [`CHANGELOG.md`](./CHANGELOG.md) | Full version history |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Local dev, branching, PR conventions |

## Examples

- [`examples/practice-test-login/`](./examples/practice-test-login/) — first-person dialect, `Scenario Outline + Examples`, security scenarios. Validated 7/7 green against a live public site.
- [`examples/cms-login/`](./examples/cms-login/) — third-person dialect, compound input, `is redirected`. From a real OSS Selenium codebase.

## License

MIT
