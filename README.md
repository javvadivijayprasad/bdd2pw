[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.20450278.svg)](https://doi.org/10.5281/zenodo.20450278)


# bdd2pw — Gherkin `.feature` → Playwright TypeScript scaffold

# @vijaypjavvadi/bdd2pw

[![npm version](https://img.shields.io/npm/v/@vijaypjavvadi/bdd2pw.svg)](https://www.npmjs.com/package/@vijaypjavvadi/bdd2pw)
[![npm downloads](https://img.shields.io/npm/dm/@vijaypjavvadi/bdd2pw.svg)](https://www.npmjs.com/package/@vijaypjavvadi/bdd2pw)
[![npm total downloads](https://img.shields.io/npm/dt/@vijaypjavvadi/bdd2pw.svg)](https://www.npmjs.com/package/@vijaypjavvadi/bdd2pw)
[![license](https://img.shields.io/npm/l/@vijaypjavvadi/bdd2pw.svg)](https://github.com/javvadivijayprasad/bdd2pw/blob/main/LICENSE)
[![Listed in Awesome Playwright](https://awesome.re/mentioned-badge.svg)](https://github.com/mxschmitt/awesome-playwright)

> Scaffold runnable Playwright TypeScript tests from Gherkin `.feature` files. Auto-detects existing Page Objects, scans live pages via Microsoft Playwright MCP, emits POMs and specs ready for execution. CLI + HTTP service.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen?logo=node.js)](https://nodejs.org/)
[![npm](https://img.shields.io/npm/v/@vijaypjavvadi/bdd2pw.svg?label=npm)](https://www.npmjs.com/package/@vijaypjavvadi/bdd2pw)
[![Tests](https://img.shields.io/badge/tests-290%2B%20passing-brightgreen)](./tests)
[![Rules](https://img.shields.io/badge/rules-200%2B%20deterministic-brightgreen)](./src/transformers)
[![Domain packs](https://img.shields.io/badge/domain%20packs-7-blue)](./src/transformers/domains)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/vijaypjavvadi.bdd2pw?label=vscode-extension)](https://marketplace.visualstudio.com/items?itemName=vijaypjavvadi.bdd2pw)

Most teams writing BDD test cases (via Cucumber `.feature` files, possibly authored by an LLM) face the same gap: the `.feature` describes the test, but **someone still has to write the Page Objects and the Playwright spec by hand**. That's the work `bdd2pw` does for you.

Point it at a `.feature` file and a URL. It parses the Gherkin, scans the live page with Chromium, picks the most stable locator for every interactive element, matches each step to a POM method call, and emits a runnable Playwright TypeScript repo — including `playwright.config.ts`, `pages/login.page.ts`, `tests/login.spec.ts`, and a `BDD_REVIEW.md` listing anything a human still needs to look at.

## What `bdd2pw` is and isn't (as of v4.2.0)

`bdd2pw` is a **deterministic scaffolder with an optional governed LLM fallback across three providers**. The output is honest about its limits:

- **Specific `.feature` files** — quoted credentials, concrete assertion targets, standard verb forms — convert to **runnable specs with zero hand-edits**. Validated end-to-end against 8 public benchmark applications (`practicetestautomation.com`, `owasp-juice-shop`, SauceDemo, the-internet, OpenCart, Magento, Conduit, Reqres): 8/8 compilation across deterministic and LLM-governed modes.
- **Vague `.feature` files** — "Enter valid username and password and click login button" with no quoted values — get partial coverage. Unmatched steps either route to the LLM fallback (when an Anthropic / OpenAI / Gemini key is configured) or land as `// TODO` comments + warnings in `BDD_REVIEW.md`.
- **200+ deterministic rules**, organised across three layers:
  - **API rules** (v3.0+) — `page.request.*` patterns for GET / POST / PUT / DELETE / PATCH, body / header / status assertions.
  - **Visibility rules** (v3.1+) — `<noun> is visible / displayed / shown / appears` intercepts before URL-slug heuristics, so prose like "the user's name or profile indicator is visible in the UI" never gets slugified into a URL regex.
  - **UI + URL rules** (v1.x lineage, refined through v3.7.1) — 30+ rules covering first-person, third-person, no-subject Cucumber dialects + compound input steps.
- **7 opt-in domain rule packs** (v3.4 + v3.8) — banking, healthcare, insurance, retail, gov, education, telecom. Each adds ~20 industry-specific patterns. Activated via `domains: ["banking"]`; empty by default for byte-stable existing behaviour.
- **Three-provider LLM fallback, batched per scenario** (v3.5 + v3.11 + v3.12) — one Anthropic Claude Sonnet 4.6, OpenAI gpt-4o-mini, or Google Gemini 2.5 Flash call per scenario instead of one per unmatched step. ~75% cost reduction on unmatched-heavy scaffolds. Every prompt goes through the `ai-governance` sidecar's `/sanitize` endpoint (fail-closed on 4xx/5xx/timeout — the run terminates rather than emit ungoverned code).
- **Three hallucination-rejection gates on LLM output** (v4.0.1) — invented-helper detection, structured-pomCall guard, and bare-field-call trap. Bindings the LLM emits that would compile-fail land as `// TODO` comments with `BDD_REVIEW.md` entries instead of broken code. Locked by 19 dedicated unit tests.
- **Six-pattern LLM-binding rewriter** (v4.1) — mechanically transforms common LLM emission mistakes (invented-helper shapes, bare-field args, unquoted string values, CSS-selector args, `page.<method>` invented-helpers in customBody, Locator-only matchers hallucinated on `page`, bare-identifier assertion locators) into valid Playwright-idiomatic code. Runs *before* the v4.0.1 gates; if a rewrite would still produce broken code, the binding is rejected and lands as TODO. Bench result: 3/8 → **8/8 apps produce specs that pass `tsc --noEmit`**. Locked by 35 unit tests.
- **DOM-drift detection via POM header hash** (v4.2) — every emitted POM carries a `@bdd2pw dom-hash` comment with a stable sha256 of the page's accessibility tree. On re-scaffold, bdd2pw diffs the new snapshot against the stored hash. Silent UI changes surface as a `DOM DRIFT` warning in `BDD_REVIEW.md` with both hashes and a suggested triage path. `--fail-on-drift` turns it into a non-zero exit code so CI can gate merges on silent UI regressions.
- **Data-driven scaffolds** (v4.0.0) — `--data <path>` injects CSV / JSON / XLSX rows into every Scenario Outline's `Examples:` table; `--gen-data --schema <path> --rows N` generates synthetic rows via Faker + optional per-column LLM calls (`llm:auto insurance claim description`); seeded (`--seed 42`) for reproducibility.
- **`updatePom` is append-only by construction.** Re-scanning a page that already has a Page Object adds new locators only. Hand-edited method bodies, custom helper methods, custom imports are all preserved byte-identical.
- **`--merge` mode** (v3.2) preserves `// bdd2pw:user-block id="..."` sections across regenerations so iterative locator tuning doesn't lose work.
- **Reproducible benchmark harness** (v4.0.0) — `bench/runner.ts` scaffolds all 8 benchmark apps in three modes (deterministic-only, LLM-blocked, LLM-governed) with per-app sha256 verification. Public artifact accompanying the SoftwareX manuscript.

> **The pitch.** Run `bdd2pw scaffold` and you get a Playwright TS repo where `npx playwright test` runs against the real site. For specific fixtures, all green. For vague ones, the 60-90% you'd otherwise hand-write is done; you finish the rest — or you let the governed LLM finish them.

## What's new in v4.0.0

- **NEW** `--data <path>` — load CSV / JSON / XLSX file and inject rows into every Scenario Outline's Examples table. Drop in a 500-row dataset without touching the .feature file.
- **NEW** `--gen-data --schema <path> --rows N` — generate synthetic Examples rows. Schema picks per-column source: `faker.internet.email` for common fields, `llm:auto insurance claim description` for context-aware domain data. Seeded for reproducibility (`--seed 42`).
- **NEW** `LLMClient.generateText()` — generic single-prompt API on all three providers (Anthropic, OpenAI, Gemini). Same governance + budget + timeout + telemetry pipeline as binding generation.
- Gemini provider — three-provider parity complete. `--llm gemini` defaults to `gemini-2.5-flash` ($0.10/M input — cheapest across all three providers). (v3.12.0)
- OpenAI provider with full parity. `--llm openai` defaults to `gpt-4o-mini`. (v3.11.0)
- `bdd2pw heal-stats <repo>` CLI reads `<repo>/artefacts/heal-events.jsonl` and writes a heal-stats.json sidecar with heal rate, top failing fields, retry latency, candidate-selector promotions (v3.10.0).
- `llmStats: true` writes `<repo>/artefacts/llm-stats.json` with per-call latency, token counts, cache hit rate, and an estimated cost in USD (v3.9.0).
- Seven domain rule packs (banking, healthcare, insurance, retail, gov, education, telecom) — ~140 industry-specific patterns total.
- Per-scenario LLM batching cuts Anthropic spend by ~75% on unmatched-heavy scaffolds.
- `bdd2pw propose-rules` CLI clusters past LLM bindings into draft regex proposals — turning the offline-review pipeline into one command.
- `diagnostics: true` adds a "Rule trace" block to `BDD_REVIEW.md` showing exactly which rules declined a step and why.
- `merge: true` preserves user-edited blocks across regenerations.
- `metaSidecar: true` writes `<spec>.spec.meta.json` describing every step's semantic intent for downstream tools.
- VS Code extension (`vijaypjavvadi.bdd2pw`) v0.2.0 surfaces all the above as settings + commands.

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

## LLM fallback (v2.0+)

When a Gherkin step doesn't match any of bdd2pw's 30 deterministic rules, you can opt-in to an Anthropic-backed LLM fallback that produces the binding instead of dropping to `// TODO`. Off by default.

```bash
# Anthropic API key — required when --llm anthropic is set
export ANTHROPIC_API_KEY=sk-ant-api03-...

bdd2pw scaffold ./my.feature \
  --url https://app.example.com \
  --page LoginPage \
  --repo ./out \
  --llm anthropic \
  --governance-url http://localhost:4900
```

Every successful LLM-binding is appended to `<repo>/artefacts/candidate-rules.jsonl` so an offline review pipeline can propose new deterministic rules. Auto-write back to `stepMatcher.ts` is deferred to v2.1+ — for v2.0 the LLM is a runtime overlay, never a code generator for the matcher itself.

### Governance sanitization (mandatory by default)

Per the platform contract, **every prompt passes through the `ai-governance` sidecar's `/sanitize` endpoint** before reaching Anthropic. This scrubs API keys, JWTs, AWS creds, and other secrets that might leak via test data in the `.feature` file. **Fail-closed** — if the sidecar is unreachable, the LLM call is REFUSED and the step falls back to TODO.

Two ways to satisfy this:

**(a) Internal platform users:** the `ai-governance` service is part of your platform service mesh. Just point bdd2pw at it (`--governance-url http://ai-governance:4900` or wherever).

**(b) External users:** run your own sidecar.

```bash
# Clone and run the sidecar
git clone https://github.com/javvadivijayprasad/ai-governance
cd ai-governance
python -m venv .venv && .\.venv\Scripts\Activate.ps1   # or `source .venv/bin/activate` on Mac/Linux
pip install fastapi uvicorn pydantic pyyaml
PYTHONPATH=src uvicorn service.app:app --port 4900
```

Or there's a Docker image once it's published: `docker run -p 4900:4900 ghcr.io/javvadivijayprasad/ai-governance:latest`.

**Test-only escape hatch:** `--llm-skip-governance` bypasses the sidecar entirely. Use only when your `.feature` data is synthetic (no real credentials, no PII). For production, **always** keep governance on.

```bash
# UNSAFE for real test data — use only with synthetic fixtures
bdd2pw scaffold ./my.feature ... --llm anthropic --llm-skip-governance
```

### Cost + determinism guardrails

| Flag | Default | Purpose |
|---|---|---|
| `--llm-max-calls <n>` | `50` | Hard cap on provider calls per scaffold. Cache hits don't count. |
| `--llm-cache <path>` | `<repo>/.bdd2pw/llm-cache.sqlite` | SQLite cache keyed by step text + POM signature + model. Same inputs across runs return the same binding — cost goes to zero on re-runs. Pass `:memory:` for one-shot use. |
| `--llm-model <model>` | `claude-sonnet-4-6` | Override the Anthropic model. |

Re-runs of the same `.feature` (after a code edit, retry, etc.) will hit the cache and make zero provider calls. A typical per-scaffold cost on first run: ~$0.005–0.02 USD with Sonnet, depending on how many steps need LLM fallback.

### Cloud-jobs deployment recipe

If you're running bdd2pw in an automation pipeline (cloud-jobs-template, GitHub Actions, etc.):

```yaml
env:
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}    # platform secrets store

steps:
  - name: Run scaffold with LLM fallback
    run: |
      bdd2pw scaffold "$FEATURE_FILE" \
        --url "$TARGET_URL" \
        --page "$PAGE_NAME" \
        --repo /work \
        --self-healing \
        --llm anthropic \
        --governance-url http://ai-governance:4900
```

Make sure the `ai-governance` sidecar is co-located (k8s sidecar pattern) or reachable on the platform service mesh.

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

### Shipped (Aug 2025 → May 2026)

| Version | Theme | Highlight |
|---|---|---|
| v1.0 | Foundation | Gherkin → Playwright TS scaffolding, POM resolver, file-snapshot discovery, HTTP worker service on `:4300`, `update-pom` AST surgery |
| v1.1 | Self-healing | `--self-healing` flag, `lib/heal.ts` template, JSONL event logging |
| v2.0 | LLM fallback | Anthropic SDK integration, governance sidecar `/sanitize`, SQLite step-binding cache, opt-in via `--llm anthropic` |
| v2.2 | Reliability | Promise.race watchdogs, ai-governance fail-closed, structured pino logging end-to-end |
| v3.0 | API testing | Native `page.request.*` patterns (~17 rules), tag-driven `@api` / `@ui` scenario state injection |
| v3.1 | TestForge P0+P1 | Visibility-prose intercept, `:root` locator rejection, `testInfo` in test signature, opt-in step hooks + boundary markers |
| v3.2 | Iteration UX | `playwright.config.ts` end-marker, exact-dep pinning, `*.spec.meta.json` sidecar, JSON scenarios input, `--merge` mode preserving `// bdd2pw:user-block` sections |
| v3.3 | Hook signature | `fixtures` arg + `status` + try/catch/finally wrapping for `beforeStep` / `afterStep` |
| v3.4 | Domain packs | Banking / healthcare / insurance opt-in rule packs (~60 new patterns) |
| v3.5 | LLM batching | One Anthropic call per scenario instead of N — ~75% cost reduction on unmatched-heavy scaffolds |
| v3.6 | Diagnostics + auto-rules | Rule-trace block in `BDD_REVIEW.md`; new `bdd2pw propose-rules` CLI clustering candidate-rules.jsonl into draft regex |
| v3.7.1 | Regression fixes | PascalCase className shadow fix; `test.step` wrapping regression-asserted |
| v3.8.1 | More domain packs | Retail / gov / education / telecom packs added — seven total (~140 industry-specific rules) |
| v3.9.0 | Telemetry | `artefacts/llm-stats.json` sidecar — per-call latency + tokens + cache hit rate + estimated cost. Makes v3.5 batching ROI measurable per scaffold. |
| v3.10.0 | Heal stats | `bdd2pw heal-stats <repo>` CLI consumes `artefacts/heal-events.jsonl` and writes `heal-stats.json` with heal rate, top failing fields, top error patterns, retry latency, candidate-selector promotions. Self-healing ROI per test run. |
| v3.11.0 | OpenAI provider | `LLMClientOptions.provider: "openai"` lands with cache + governance + batching + telemetry parity. Default model `gpt-4o-mini` (~17x cheaper than `gpt-4o` for structured-JSON tasks). |
| v3.12.0 | Gemini provider | `LLMClientOptions.provider: "gemini"` lands with full parity. Default model `gemini-2.5-flash` ($0.10/M input — cheapest across all three providers). Three-provider parity complete. |
| v4.0.0 | Data-driven scaffolds | `--data <path>` (CSV/JSON/XLSX) and `--gen-data --schema <path>` (Faker + LLM) inject Examples rows into Scenario Outlines. `LLMClient.generateText()` added to all three providers. **Additive only — no breaking changes.** |
| v4.0.1 | LLM hallucination gates | Three-layer rejector for invented POM helpers — bindings that would compile-fail land as TODO instead of broken code. 19 unit tests lock the behaviour. |
| v4.1.0 | LLM binding rewriter | Six-pattern rewriter that mechanically fixes common LLM emission mistakes (invented helpers, bare-field args, CSS-selector args, `page.<method>` in customBody, hallucinated Page matchers, bare-identifier assertion locators). Bench result: 3/8 → **8/8 apps produce specs that pass `tsc --noEmit`**. Peer-reviewed publication in Elsevier SoftwareX. |
| **v4.2.0 (current)** | DOM-drift detection | Every emitted POM carries a `@bdd2pw dom-hash` header (sha256 of the accessibility tree). Re-scaffold diffs against the stored hash and surfaces silent UI changes in `BDD_REVIEW.md`. `--fail-on-drift` CLI flag exits non-zero when drift is detected (CI merge gate). |

### Next 6 months (Sep 2026 → Feb 2027, ~1 release/month)

| Target | Version | Theme | Headline |
|---|---|---|---|
| Sep 2026 | **v4.3.0** | LLM quarantine lane | `@llm-generated` Playwright tag on every LLM-derived scenario + `bdd2pw quarantine-stats` CLI that reports pass rate for the LLM-fallback lane separately from the deterministic lane. Teams can filter runs with `--grep-invert @llm-generated` for a "trusted only" execution. |
| Oct 2026 | **v4.4.0** | sel2pw merge | sel2pw migrated onto `@vijaypjavvadi/pw-emit` — three packages share one emitter. All future emitter improvements automatically flow to Selenium users. |
| Oct 2026 | **v4.5.0** | Auto-rules | `bdd2pw apply-proposals --interactive` — walks the human through each v3.6 proposal, validates the regex compiles + matches the sample texts, optionally appends to `stepMatcher.ts`. Closes the propose-rules loop. |
| Nov 2026 | **v4.6.0** | Domain packs | Three more opt-in packs: **fintech** (KYC, AML, trading desks), **real-estate** (MLS, listings, escrow), **hospitality** (PMS, reservations, OTA). ~60 more rules. |
| Nov 2026 | **v4.7.0** | API v2 | WebSocket assertion rules, multipart file-upload patterns, GraphQL query / mutation / subscription rules. Extends v3.0's API testing surface. |
| Dec 2026 | **v4.8.0** | Coverage analyzer | `bdd2pw coverage` CLI: which deterministic rules fired on which features across a fleet, per-pack hit rate, dead-rule report, suggestion to retire unused rules. |
| Jan 2027 | **v4.9.0** | CI/CD templates | Optional scaffolder output: GitHub Actions / GitLab CI / Azure Pipelines / CircleCI starter workflows wired to run the generated specs. Opt-in via `--ci <provider>`. |
| Feb 2027 | **v5.0.0** | Mobile dialect | Touch / swipe / scroll-into-view rules + responsive viewport assertions. Reuses the same emitter pipeline; opt-in via `domains: ["mobile"]`. Bumps to v5 alongside a small set of default flips (llm-stats + healing become opt-out). Migration guide ships alongside. |

Each release is shaped to be self-contained, ship in ~2 weeks, and keep `domains: []` byte-stable for existing users so the upgrade path stays painless.

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
## Citation

If you use `@vijaypjavvadi/bdd2pw` in academic work, please cite:

> Javvadi, V. P. (2026). *@vijaypjavvadi/bdd2pw: Live-DOM Page Object Scaffolding from Gherkin Specifications via the Microsoft Playwright MCP* (Version 4.0.1) [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.21050268

(v4.0.2 is a documentation-only patch on top of the v4.0.1 artifact; cite v4.0.1 for reproducibility.)

A machine-readable [`CITATION.cff`](CITATION.cff) file is included in the repository root.

## License

MIT
