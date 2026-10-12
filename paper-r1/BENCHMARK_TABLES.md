# Tables for the revised manuscript

Paste each table into the manuscript at the indicated section.

---

## Table 2 — Multi-application benchmark (paste in new §3.2)

bdd2pw scaffolding outcomes across 8 web applications, three measurement modes. All numbers from `bench/results/` in the v4.0.1 source distribution; reproducible via `npm run bench`.

| # | Application | URL / source | Complexity | Scenarios | Det TODOs | LLM-blocked TODOs | LLM-governed TODOs | LLM calls | Cost USD | tsc (D / B / G) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | SauceDemo | saucedemo.com | Low | 3 | 4 | 4 | **0** | 2 | 0.013 | PASS / PASS / PASS |
| 2 | the-internet | the-internet.herokuapp.com | Medium | 4 | 5 | 5 | **0** | 3 | 0.021 | PASS / PASS / PASS |
| 3 | OWASP Juice Shop | local Docker (pinned v17.1.1) | High | 3 | 11 | 11 | **0** | 3 | 0.038 | PASS / PASS / PASS |
| 4 | OpenCart demo | demo.opencart.com | Medium | 3 | 9 | 9 | **6** | 3 | 0.024 | PASS / PASS / PASS |
| 5 | Magento demo | magento.softwaretestingboard.com | High | 3 | 8 | 8 | **1** | 3 | 0.030 | PASS / PASS / PASS |
| 6 | Conduit (RealWorld) | demo.realworld.io | Medium | 3 | 13 | 13 | **10** | 3 | 0.032 | PASS / PASS / PASS |
| 7 | Reqres (API) | reqres.in | Low | 3 | 10 | 10 | **7** | 3 | 0.027 | PASS / PASS / PASS |
| 8 | AutomationPractice | automationpractice.pl | Medium | 3 | 9 | 8 | **5** | 3 | 0.024 | PASS / PASS / PASS |
|   | **Total** |  |  | **24** | **69** | **68** | **29** | **23** | **0.208** | **8 / 8 / 8** |

Columns:
- **Det TODOs**: TODO count in deterministic-only mode (no LLM)
- **LLM-blocked TODOs**: TODO count with `--llm anthropic` but governance sidecar offline (proves fail-closed perimeter)
- **LLM-governed TODOs**: TODO count with `--llm anthropic` and governance sidecar online
- **LLM calls**: provider call attempts in governed mode (batched per-scenario, cache hits not counted)
- **Cost USD**: estimated cost in governed mode, from `llm-stats.json` sidecar against Anthropic published pricing
- **tsc (D / B / G)**: TypeScript compilation pass status in Deterministic / Blocked / Governed modes

LLM closure rate: 40 of 69 unmatched steps closed in governed mode (58 percent). All 8 applications compile in all 3 modes. Configured LLM model: claude-sonnet-4-6 at temperature=0.

---

## Table 3 — Locator quality distribution (paste in §3.2)

Distribution of emitted locator types across the benchmark (LLM-governed mode, 8 applications combined).

| Locator type | Count | Share | Stability characteristic |
|---|---|---|---|
| `getByRole` | 61 | 67% | Semantic, ARIA-driven, survives styling changes |
| `getByLabel` | 17 | 19% | Semantic, label-driven, survives most refactors |
| `getByPlaceholder` | not separately classified | — | Semantic, fragile to UX copy changes |
| `getByTestId` | 0 | 0% | (no benchmark app uses `data-testid` consistently) |
| `getByText` | included in Role/Label | — | Semantic, text-content dependent |
| CSS selector | 13 | 14% | Fallback only; framework-internal classes rejected by picker |
| XPath | 0 | 0% | Never emitted by bdd2pw (rejected by the locator priority chain) |

86 percent of emitted locators are semantic (`getByRole` + `getByLabel`); 14 percent CSS fallback; 0 percent XPath. The locator picker explicitly rejects framework-internal classes (Angular `.ng-*`, Material `.mat-*`, CDK `.cdk-*`, MDC `.mdc-*`, Angular content/host attributes); rejected candidates count is recorded in `bench/results/results.json` per app.

---

## Table 4 — Determinism check (paste in new §3.5)

Three repeated scaffolds per application in deterministic-only mode (no LLM). Functional determinism (identical TODO count and identical tsc outcome) and byte determinism (identical sha256 of emitted POM and spec files) reported separately.

| # | Application | Functional (TODO count across 3 runs) | Byte (sha256 across 3 runs) | Divergence reason |
|---|---|---|---|---|
| 1 | SauceDemo | 4 / 4 / 4 | identical | — |
| 2 | the-internet | 5 / 5 / 5 | identical | — |
| 3 | Juice Shop | 11 / 11 / 11 | **page.ts differs** | MCP returns same element set in different order across scans |
| 4 | OpenCart | 9 / 9 / 9 | identical | — |
| 5 | Magento | 8 / 8 / 8 | identical | — |
| 6 | Conduit | 13 / 13 / 13 | identical | — |
| 7 | Reqres | 10 / 10 / 10 | identical | — |
| 8 | AutomationPractice | **9 / 8 / 9** | **page.ts + spec.ts differ** | Live demo site DOM varies between scans |

**Functional determinism**: 7 of 8 apps stable across runs. AutomationPractice's TODO count varies because the live demo's DOM changes between scans, exposing different rule matches.

**Byte determinism**: 6 of 8 apps produce byte-identical output across runs. Juice Shop emits the same field set in different orders (MCP-side nondeterminism). AutomationPractice diverges because the upstream DOM is unstable.

Both divergent cases are fully addressed by `--snapshot-file` pinning, which captures the live DOM once and replays it offline on subsequent runs. The camera-ready version will ship pinned snapshots for all 8 apps and re-run the determinism check; we expect 8/8 byte-identical under snapshot mode.

---

## Inline statistics for prose (paste in §3 prose)

For quick reference when writing or revising:

- **Total benchmark scenarios**: 24 across 8 applications
- **Compilation pass rate**: 8 of 8 apps (100%) in all three modes after v4.0.1
- **Deterministic-only unmatched steps**: 69 (mean 8.6 per app)
- **LLM-closed unmatched steps**: 40 of 69 (58% closure)
- **Total LLM provider calls (governed mode)**: 23 (mean 2.9 per app — per-scenario batching from v3.5)
- **Total cost (governed mode, Anthropic Sonnet 4.6)**: USD 0.208 (mean USD 0.026 per app)
- **Mean scaffold wall-clock**: 8 seconds in deterministic-only mode; 19 seconds with LLM
- **Functional determinism**: 7 of 8 apps stable across 3-repeat
- **Byte determinism without snapshot pinning**: 6 of 8 apps stable
- **LLM hallucination patterns rejected by v4.0.1 gates**: 3 distinct patterns, 19 dedicated unit tests
- **Fail-closed perimeter verified**: 0 LLM calls succeeded in LLM-blocked mode across all 8 apps

---

## How to render in Word

These tables are pipe-delimited Markdown. To paste cleanly into Word:

1. Copy the table block from this file.
2. In Word, **Insert → Table → Convert Text to Table**.
3. Separator: **Other** → enter `|`.
4. Delete the first and last empty columns Word creates (the leading and trailing pipes).
5. Apply the journal's table style (typically "Plain Table" or "List Table").

For the LaTeX-typeset version, the same data is available as CSV in `bench/results/results-llm-v401-final.json` (parse the `results` array).
