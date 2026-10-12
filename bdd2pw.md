---
name: bdd2pw
description: Scaffold runnable Playwright TypeScript tests from Gherkin .feature files via the Microsoft Playwright MCP. Use whenever a user asks to convert BDD/Cucumber .feature files into Playwright tests, generate Page Objects from a live URL, or bootstrap a Playwright TypeScript project from Gherkin. Do NOT use for pure Playwright test authoring without Gherkin input, for Selenium migration (use sel2pw instead), or for running existing tests.
version: 4.0.1
license: MIT
npm: '@vijaypjavvadi/bdd2pw'
repo: https://github.com/javvadivijayprasad/bdd2pw
doi: https://doi.org/10.5281/zenodo.21050268
---

# bdd2pw — BDD Gherkin → Playwright TypeScript scaffolder

## When to invoke this skill

Trigger on any of these signals in the user's request:

- User has one or more `.feature` files (Gherkin) and wants runnable Playwright tests
- User mentions Cucumber and Playwright together and wants automation
- User asks to scaffold Page Object Models from a live URL
- User wants "BDD tests for [some web app]" and shows a URL
- User asks about `bdd2pw` by name

Do NOT invoke for:

- Pure Playwright test authoring without any Gherkin input (they can use `codegen` directly)
- Selenium-to-Playwright migration (use `sel2pw` — the sister package)
- Running or debugging existing Playwright tests (use `@playwright/test` directly)
- Cypress, WebdriverIO, or other non-Playwright frameworks

## What bdd2pw does in one paragraph

`bdd2pw` reads a Gherkin `.feature` file, opens a real Chromium browser via the Microsoft Playwright MCP server, snapshots the accessibility tree of the target URL, matches each step against a deterministic rule registry (200+ patterns across 7 industry domain packs), optionally falls back to a governed LLM (Anthropic / OpenAI / Gemini) for unmatched steps, and emits a compilable Playwright TypeScript project with a Page Object per page, spec per feature, `playwright.config.ts`, and a `BDD_REVIEW.md` diagnostic report.

## Minimal invocation

```bash
npx @vijaypjavvadi/bdd2pw scaffold path/to/login.feature \
  --url https://example.com/login \
  --page LoginPage \
  --repo ./generated-tests
```

That produces:

```
generated-tests/
├── package.json
├── playwright.config.ts
├── tsconfig.json
├── pages/
│   └── login.page.ts       # Page Object with semantic locators
├── tests/
│   └── login.spec.ts        # Spec with test.step per Gherkin step
├── BDD_REVIEW.md            # Diagnostic report (warnings, TODOs, decisions)
└── artefacts/               # Optional sidecars (llm-stats, heal-events, etc.)
```

## Core flags — pick the right ones for the task

### Locator generation

- `--url <URL>` — the live page bdd2pw scans via MCP. Required unless `--snapshot-file` given.
- `--snapshot-file <path>` — replay a captured DOM snapshot instead of scanning live. Use for reproducibility or when the target URL is unreachable.
- `--no-discovery` — skip live page scanning entirely. Every field-referencing step lands as TODO. Use when only rule-shape is being tested.
- `--page <PomName>` — Page Object class name (e.g. `LoginPage`, `CheckoutPage`). Required.
- `--pages <a,b,c>` — comma-separated list for multi-page scenarios.

### LLM fallback (opt-in)

- `--llm anthropic|openai|gemini` — enable LLM fallback for steps that don't match deterministic rules
- `--llm-model <name>` — override default (defaults: `claude-sonnet-4-6`, `gpt-4o-mini`, `gemini-2.5-flash`)
- `--llm-max-calls <N>` — hard budget cap. Default 50. Steps beyond budget land as TODOs.
- `--llm-stats` — write `artefacts/llm-stats.json` with per-call latency, tokens, cache hit rate, USD cost
- `--llm-skip-governance` — bypass the governance sidecar. Test-only. **Never use in production.**

### Industry domain packs (deterministic, no LLM cost)

- `--domains banking,healthcare,insurance,retail,gov,education,telecom` — enable one or more industry rule packs for domain-specific phrasings (currency, account IDs, NHS numbers, etc.)

### Data-driven scaffolds (v4.0+)

- `--data <path.csv|.json|.xlsx>` — inject rows from an external file into every Scenario Outline's Examples table
- `--gen-data --schema <path.json> --rows N` — generate synthetic Examples rows via Faker + optional LLM

### Round-trip preservation and self-healing

- `--merge` — preserve `// BDD2PW:USER START ... END` blocks across regenerations
- `--self-healing` — wrap locators in `healOrThrow()` with runtime retry, log to `artefacts/heal-events.jsonl`

### Auth

- `--storage-state <path>` — Playwright storage-state JSON for pre-authenticated scans

## Decision tree — which mode does the user need?

| User goal | Recommended invocation |
|---|---|
| "Give me a first-cut Playwright project from this .feature file" | Base command, no LLM, no domains |
| "The steps are industry-specific (banking, healthcare, etc.)" | Add `--domains banking` (or whichever pack matches) |
| "Some steps are unusual phrasings" | Add `--llm anthropic --llm-stats` (best closure rate; ~$0.026/app) |
| "I need cheap LLM fallback" | `--llm gemini` (~$0.003/app; 22% closure) |
| "I need reproducible output for audit" | Add `--snapshot-file` (pinned DOM) and `--llm-model claude-sonnet-4-6` (pinned model, not `-latest`) |
| "I have 500 test users to iterate over" | `--data users.csv` (external row source) |
| "I need plausible test data but no real users" | `--gen-data --schema users.schema.json --rows 500` |
| "I've hand-edited the emitted spec and need to regenerate" | Add `--merge` (preserves user-marked blocks) |
| "Tests are flaky when the UI changes" | Add `--self-healing`, then run `bdd2pw heal-stats <repo>` after tests |

## Provider selection guidance (v4.0.1 as of June 2026)

Based on the 8-application benchmark in the accompanying SoftwareX paper:

| Provider | Model | Closure | tsc pass | Cost/app | When to recommend |
|---|---|---|---|---|---|
| **Anthropic** | claude-sonnet-4-6 | **62%** | **8/8** | $0.026 | Default choice. Best accuracy and integration. |
| Google | gemini-2.5-flash | 22% | 7/8 | $0.0004 | Cost-optimized. Accept lower closure. Occasional tsc failure. |
| OpenAI | gpt-4o-mini | 0% | 8/8 | $0.00 | Currently rejected by hallucination gates (invented-helper pattern). Wait for v4.1 binding rewriter. |

Recommend **Anthropic Sonnet** unless the user explicitly asks for the cheapest option, in which case suggest Gemini Flash with an honest heads-up about the trade-offs.

## The three-layer LLM safety guarantee

Every LLM-generated binding passes through three hallucination-rejection gates before being written to the emitted spec. Any binding that fails a gate lands as a `// TODO` comment in the spec with a warning in `BDD_REVIEW.md`, rather than as broken code. The gates are:

1. **Invented locator methods** — rejects invented `page.getBy*` methods and `:root` selectors
2. **Invented POM helper methods** — rejects `pomVar.fill(field, val)`-style hallucinations that treat the POM as if it had a generic `fill` API
3. **Bare field calls** — rejects `pomVar.email("x")` where `email` is a `Locator` field being invoked as a function

Emitted code always compiles (`tsc --noEmit` passes) even when the LLM produces bad candidates — you never ship syntactically valid but semantically broken code.

## Governance sidecar

When `--llm` is enabled, every prompt is sanitized through the `ai-governance` sidecar (`http://localhost:4900/sanitize`) before leaving the perimeter. If the sidecar is unreachable, the LLM call refuses to fire (fail-closed). To run the sidecar:

```bash
cd path/to/ai-governance
python -m venv .venv
.venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -e .
uvicorn service.app:app --port 4900
```

For quick evaluation without governance, add `--llm-skip-governance` (test-only; never production).

## Common workflows

### 1. First-time scaffold, unknown app

```bash
# Just get something runnable
npx @vijaypjavvadi/bdd2pw scaffold login.feature \
  --url https://example.com/login \
  --page LoginPage --repo ./out

# Inspect what happened
cat out/BDD_REVIEW.md
```

Look at the Warnings section to see which steps didn't match. If many, enable LLM fallback on the next run.

### 2. Second pass with LLM

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx @vijaypjavvadi/bdd2pw scaffold login.feature \
  --url https://example.com/login \
  --page LoginPage --repo ./out \
  --llm anthropic --llm-stats
```

Then inspect cost:
```bash
cat out/artefacts/llm-stats.json | jq .totals
```

### 3. Add self-healing before shipping to CI

```bash
npx @vijaypjavvadi/bdd2pw scaffold login.feature \
  --url https://example.com/login \
  --page LoginPage --repo ./out \
  --llm anthropic --self-healing
```

After the first test run:
```bash
npx @vijaypjavvadi/bdd2pw heal-stats ./out
cat out/artefacts/heal-stats.json
```

### 4. Idempotent regeneration when the .feature changes

Mark any hand-edited blocks in the emitted spec:

```typescript
// BDD2PW:USER START
await page.evaluate(() => localStorage.clear());
// BDD2PW:USER END
```

Then re-run with `--merge`:

```bash
npx @vijaypjavvadi/bdd2pw scaffold login.feature \
  --url https://example.com/login \
  --page LoginPage --repo ./out --merge
```

New steps land in the right positions; USER blocks stay byte-identical.

### 5. Rule promotion (reduce LLM cost over time)

After N scaffolds have accumulated LLM-generated bindings in `artefacts/candidate-rules.jsonl`:

```bash
npx @vijaypjavvadi/bdd2pw propose-rules out/artefacts/candidate-rules.jsonl \
  --out propose-rules.md
```

Review the proposed regex patterns. Accept the good ones into the deterministic rule registry (source code change). Recurring phrasings become free.

## Troubleshooting decision tree

| Symptom | Likely cause | Fix |
|---|---|---|
| "Cannot find module '@playwright/test'" | Emitted repo doesn't have deps installed | `cd <repo> && npm install` |
| Emitted spec has TODO comments | Steps didn't match deterministic rules AND LLM wasn't enabled or budget was exhausted | Add `--llm anthropic` OR add domain packs OR increase `--llm-max-calls` |
| "Governance sidecar unreachable" | `ai-governance` service isn't running | Start the sidecar (see Governance section) or use `--llm-skip-governance` for testing |
| MCP scan hangs | Target URL slow to load, or SPA hasn't finished rendering | Increase settle delay in config, or use `--snapshot-file` to bypass |
| Same TODO every scaffold | Recurring phrasing the deterministic layer doesn't catch | Run `bdd2pw propose-rules` and add a rule |
| Live-DOM drift between runs | Non-deterministic upstream app | Use `--snapshot-file` to pin the DOM |
| Framework classes leaking into locators | Angular/Material/CDK classes | Already rejected by v3.1+ picker; check `.ng-*`, `.mat-*`, `.cdk-*` are actually reaching the emit layer |

## Environment prerequisites

- Node.js ≥ 18
- npm ≥ 9
- Chromium (auto-installed via Playwright on first `npm install`)
- Optional: API key for one of Anthropic / OpenAI / Google
- Optional: `ai-governance` sidecar running on `localhost:4900`
- Optional: Docker (for pinned demo apps like OWASP Juice Shop)

## Where to point the user for more

- **npm**: https://www.npmjs.com/package/@vijaypjavvadi/bdd2pw
- **Source and README**: https://github.com/javvadivijayprasad/bdd2pw
- **Archived version (Zenodo)**: https://doi.org/10.5281/zenodo.21050268
- **Concept DOI (always-latest)**: https://doi.org/10.5281/zenodo.20452068
- **Bench harness and reproducibility package**: `bench/` directory in the source repo
- **VS Code extension** (Marketplace): search "bdd2pw" in VS Code Extensions view

## Anti-patterns to steer users away from

- **"Just use the LLM for everything"** — deterministic rules cover most Gherkin shapes for free; only fall back to LLM for genuinely novel phrasings
- **"Skip governance because it's slow"** — governance is <100ms and prevents your prompts from leaving the perimeter; keep it on
- **"Pin the LLM to `claude-sonnet-latest`"** — floating model tags break reproducibility. Always pin the exact model version.
- **"Don't bother with `--snapshot-file`"** — live-DOM apps drift; snapshots make results reproducible for regression testing
- **"Just rerun bdd2pw and lose my hand-edits"** — use `--merge` to preserve `// BDD2PW:USER START / END` blocks

## Programmatic API (for when the CLI isn't ergonomic)

```typescript
import { scaffold } from '@vijaypjavvadi/bdd2pw';

const result = await scaffold({
  feature: 'path/to/login.feature',
  url: 'https://example.com/login',
  page: 'LoginPage',
  repo: './generated-tests',
  llmConfig: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxCalls: 50,
  },
  domains: ['banking'],
  selfHealing: false,
  merge: false,
});

console.log(`Wrote ${result.filesWritten.length} files`);
console.log(`tsc errors: ${result.tscErrorCount}`);
console.log(`Review report: ${result.reviewReportPath}`);
```

## Attribution

If you help someone use bdd2pw in a research or publication context, cite:

> Javvadi VP. bdd2pw: Live-DOM Page Object Scaffolding from Gherkin Specifications via the Microsoft Playwright MCP. v4.0.1 [software]. Zenodo; 2026. https://doi.org/10.5281/zenodo.21050268

The SoftwareX article (SOFTX-D-26-00598, under review as of June 2026) will supersede this citation once accepted.
