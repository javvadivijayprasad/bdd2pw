# bdd2pw benchmark — reproducibility package

Multi-application benchmark introduced for SoftwareX R1 revision.
Addresses reviewer concerns about single-scenario evaluation by
running bdd2pw scaffold against 8 publicly available web applications
and recording objective metrics per app.

## What this measures

For each application:

| Metric | Definition |
|---|---|
| `scaffold_time_ms` | Wall-clock from `bdd2pw scaffold` start to `scaffold complete` log line |
| `tsc_passed` | True iff `tsc --noEmit` exits 0 on the generated spec + POM |
| `tests_total` / `tests_passed` | Optional — runs `npx playwright test` and counts |
| `llm_calls` | Provider calls (cache hits not counted) |
| `llm_cost_usd` | Estimated cost from llm-stats.json sidecar |
| `locators_by_type` | Distribution: getByRole / getByLabel / getByPlaceholder / getByTestId / getByText / css / xpath |
| `framework_classes_rejected` | Count of `.ng-*`, `.mat-*`, `.cdk-*` rejections from locator picker |
| `review_warnings` | Count of severity=warn ReviewItems in BDD_REVIEW.md |
| `review_errors` | Count of severity=error ReviewItems in BDD_REVIEW.md |

## Applications evaluated

| # | App | URL | Complexity | Why included |
|---|---|---|---|---|
| 01 | SauceDemo | https://www.saucedemo.com | Low | Canonical login flow, clean semantic markup |
| 02 | the-internet | https://the-internet.herokuapp.com | Medium | Heterogeneous controls (auth, dynamic loading, drag/drop, frames) |
| 03 | Juice Shop | http://localhost:3000 (Docker) | High | Modern SPA, complex DOM, Angular/Material |
| 04 | OpenCart | https://demo.opencart.com | Medium | Traditional MPA e-commerce |
| 05 | Magento | https://magento.softwaretestingboard.com | High | Heavyweight e-commerce, complex checkout |
| 06 | Conduit (RealWorld) | https://demo.realworld.io | Medium | Modern SPA, semantic markup, blog-style |
| 07 | Reqres (API) | https://reqres.in | Low | Pure API testing — exercises v3.0 API scenario rules |
| 08 | AutomationPractice | http://automationpractice.pl | Medium | Legacy demo site, mixed semantic + CSS locators |

Apps are chosen to span: complexity (low/medium/high), framework
(vanilla/React/Angular/server-rendered), and surface (UI/API).

## Reproducing the benchmark

### Prerequisites

```powershell
# Node 18+, npm 10+
node --version
npm --version

# Docker Desktop running (for Juice Shop local instance)
docker --version

# Install bench dependencies (one-time)
# This installs @playwright/test alongside ts-node so that bdd2pw's
# internal tsc validation can resolve types correctly when scaffolds
# run in isolated work directories. The runner junction-links
# bench/node_modules into each work dir at scaffold time.
cd E:\EB1A_Research\Application\bdd2pw\bench
npm install
```

### Optional — set LLM provider key

The benchmark runs in two modes:
- **Deterministic-only mode (no LLM)**: unmatched steps land as `// TODO`. Measures pure-rule coverage.
- **LLM-fallback mode**: requires an API key for one of the three providers.

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
# OR
$env:OPENAI_API_KEY = "sk-..."
# OR
$env:GEMINI_API_KEY = "AI..."
```

### Start local Juice Shop (for app 03)

```powershell
cd bench
docker compose up -d juice-shop
# wait ~30s for it to boot
```

### Run the benchmark

```powershell
# Full benchmark — 8 apps, deterministic-only
npm run bench

# Full benchmark — 8 apps, with LLM fallback (Anthropic)
npm run bench -- --llm anthropic --llm-stats

# Run a single app for debugging
npm run bench -- --app 01-saucedemo

# Run with the ablation (each app both with and without --llm)
npm run bench:ablation
```

### Output

- `bench/results/results.json` — full per-app data
- `bench/results/results.md` — markdown table ready to paste into Section 3.2 of the manuscript
- `bench/results/per-app/<app>/` — preserved scaffold output for inspection

## Determinism guarantees

To address Reviewer #2 Major Comment 4 (determinism asserted not shown),
this benchmark runs each application THREE TIMES under both modes and
asserts byte-identical output across runs. The determinism conditions:

| Input | How it is pinned |
|---|---|
| .feature file | Versioned in `apps/NN-name/feature.gherkin`, sha256 recorded |
| DOM | Captured once via `--snapshot-file apps/NN-name/snapshot.json`; runs use the snapshot, not the live URL |
| LLM model | Pinned via `--llm-model` in config (e.g. `claude-sonnet-4-6`, not `claude-sonnet-latest`) |
| LLM temperature | 0 across all 3 providers (built into bdd2pw clients since v3.0) |
| LLM cache | Cache from first run is preserved across runs 2-3 (cache hits, no provider calls) |
| Faker seed | 42 (default) for synthetic data scenarios |
| Pricing snapshot | Recorded in llm-stats.json |

Discrepancies across runs are reported in `bench/results/determinism.md`.

## Adversarial Gherkin corpus (subset of bench/adversarial)

A separate harness, `bench/adversarial/`, evaluates the LLM fallback
on deliberately tricky Gherkin steps. Output: per-provider success
rate, hallucination rate, latency, cost. See `bench/adversarial/README.md`.

## What this benchmark does NOT measure

Honest limitations to surface in the manuscript:

- **Maintenance over time** — apps change; this is a snapshot benchmark.
- **Multi-user concurrency** — scaffolds are sequential.
- **Production-scale codebases** — apps are demo sites, not enterprise apps.
- **Human productivity** — see Section 3.3 for the controlled comparison; this benchmark is purely about tool output quality.
