# bdd2pw — CHANGELOG

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [3.12.0] — 2026-06-19

> Note: v3.11.0 was tagged in git but never published to npm. v3.12.0
> on npm is the first release that includes BOTH the v3.11.0 OpenAI
> provider AND the v3.12.0 Gemini provider. Anyone who installs
> `@vijaypjavvadi/bdd2pw@latest` after this release gets all three
> providers (Anthropic, OpenAI, Gemini) with full parity in one go.

### Added — Gemini provider, three-provider parity is complete

`LLMClientOptions.provider` now accepts `"gemini"` alongside
`"anthropic"` and `"openai"`. `createLLMClient` factory routes
`"gemini"` to a new `GeminiLLMClient` that matches the surface
area of the other two:

- Single-step `generateBinding(input)`
- Batched `generateBatchBindings(inputs[])` — same per-step cache
  lookup + one batched prompt as the v3.5.0 Anthropic batching
- Cache hit accounting (`callsMade`, `callsAttempted`,
  `cacheBackendPersistent`, `cacheBackendFallbackReason`)
- Budget enforcement via `maxCalls`
- Governance sanitisation through the same sidecar (fail-closed
  if the sidecar is unreachable — identical to Anthropic/OpenAI)
- Provider timeout enforcement — Gemini's SDK has no native
  timeout option, so we wrap the call in a `Promise.race` against
  `setTimeout`; surfaces a clear `Gemini call exceeded Xms timeout`
  error in logs and the result `error` field
- LLMLogEvent stream that feeds the v3.9.0 telemetry sidecar

### Default model: `gemini-2.5-flash`

For bdd2pw's structured-JSON task, Flash is the price/perf sweet
spot. Pricing snapshot: $0.10 per million input tokens, $0.40 per
million output. That is the cheapest model across all three
providers — cheaper than `gpt-4o-mini` ($0.15) and dramatically
cheaper than `claude-sonnet-4-6` ($3.00). Override via
`LLMClientOptions.model` or `--llm-model`.

### Pricing rows added to `DEFAULT_PRICING`

`telemetry.ts` now includes pricing snapshots for: `gemini-2.5-flash`,
`gemini-2.5-pro`, `gemini-2.0-flash`, `gemini-1.5-flash`,
`gemini-1.5-pro`. v3.9.0 `llm-stats.json` cost estimates work
end-to-end for Gemini runs.

### CLI

`bdd2pw scaffold ... --llm gemini` now works. `--llm-model` help
text updated to list all three provider defaults.

### Auth env vars

Reads `GEMINI_API_KEY` first, then falls back to `GOOGLE_API_KEY`
(both are widely used in the Google AI Studio + Vertex ecosystem).

### `optionalDependencies`

`@google/generative-ai ^0.21.0` added alongside `@anthropic-ai/sdk`
and `openai`. Same defensive `require()` loading pattern — teams
that only use Anthropic do not need to install the Gemini SDK,
and vice versa. Missing-package error message points to
`npm install @google/generative-ai`.

### Cache compat

Cache keys include the model name (since v2.0), so a scaffold
cached under `claude-sonnet-4-6` does NOT hit the cache when re-run
under `gemini-2.5-flash` — you get a fresh provider call. Within
the same model, cache hits work identically regardless of how many
times you switch providers across scaffold runs.

### Tests

`tests/unit/v3120Gemini.test.ts`:
- Default model + DEFAULT_PRICING lookup.
- generateBinding succeeds with a well-formed JSON response.
- generateBatchBindings produces N bindings from ONE provider call
  (cache misses → single batched prompt → JSON array → N bindings).
- Budget exhaustion returns an error without making a provider call.
- Missing API key short-circuits before the SDK loads.
- Malformed JSON response surfaces a parse error.
- Provider timeout aborts a hung call (Promise.race against
  setTimeout works as designed).

## [3.11.0] — 2026-06-08

### Added — OpenAI provider parity

`LLMClientOptions.provider` now accepts `"openai"` alongside
`"anthropic"`. The factory wires up `OpenAILLMClient` which matches
the Anthropic client's surface area completely:

- Single-step `generateBinding(input)`
- Batched `generateBatchBindings(inputs[])` — same per-step cache
  lookup + one batched prompt as v3.5.0 batching
- Cache hit accounting (`callsMade`, `callsAttempted`,
  `cacheBackendPersistent`, `cacheBackendFallbackReason`)
- Budget enforcement via `maxCalls`
- Governance sanitisation through the same sidecar
- Step deadlines + provider timeouts
- LLMLogEvent stream that feeds the v3.9.0 telemetry sidecar

What differs is purely the SDK call shape — OpenAI's
`chat.completions.create()` instead of Anthropic's `messages.create()`,
and the response unpacking (`choices[0].message.content` vs
`content[0].text`, `usage.prompt_tokens` vs `usage.input_tokens`).

### Default model: `gpt-4o-mini`

bdd2pw's task is structured JSON output over regex-shaped
deterministic patterns. Mini handles it reliably and runs ~17x
cheaper than gpt-4o ($0.15 vs $2.50 per million input tokens).
Override via `LLMClientOptions.model` or `--llm-model`.

### Pricing rows added to `DEFAULT_PRICING`

`telemetry.ts` now includes pricing snapshots for: `gpt-4o`,
`gpt-4o-mini`, `gpt-4-turbo`, `o1`, `o1-mini`, `o1-preview`. v3.9.0
`llm-stats.json` cost estimates work end-to-end for OpenAI runs.
Prices are Q4 2025 published rates; override via
`new LLMTelemetry(scaffoldId, version, pricingOverride)` if you
have negotiated rates.

### CLI

`bdd2pw scaffold ... --llm openai` now works. The `--llm-model`
help text updated to reflect both providers' defaults.

### `optionalDependencies`

`openai ^4.77.0` added alongside `@anthropic-ai/sdk`. Like the
Anthropic SDK, it's loaded defensively via `require()` so users who
only want Anthropic don't need to install the OpenAI SDK and vice
versa. Missing-package error message points to `npm install openai`.

### Cache compat

Cache keys include the model name (since v2.0), so a scaffold
cached under `claude-sonnet-4-6` will NOT hit the cache when run
under `gpt-4o-mini` — you get a fresh provider call. Within the
same model, cache hits work identically regardless of how many
times you switch providers across scaffold runs.

### Tests

`tests/unit/v3110OpenAI.test.ts`:
- Default model + DEFAULT_PRICING lookup.
- generateBinding succeeds with a well-formed JSON response.
- generateBatchBindings produces N bindings from ONE provider
  call (cache misses → single batched prompt → JSON array → N
  bindings).
- Budget exhaustion returns an error without making a provider call.
- Missing API key short-circuits before the SDK loads.
- Malformed JSON response surfaces a parse error.

## [3.10.0] — 2026-06-06

### Added — self-healing stats sidecar + `bdd2pw heal-stats` CLI

v1.1+ has shipped a runtime `healOrThrow` helper that emits
`register` / `heal_attempt` / `healed` / `heal_unavailable` events
to `<repo>/artefacts/heal-events.jsonl`. Until now those events
sat in a JSONL file with no offline analyzer — operators had to
grep the file themselves to see if healing was working.

v3.10.0 adds:

**1. `bdd2pw heal-stats <repo>` CLI** — reads
`<repo>/artefacts/heal-events.jsonl` and writes
`<repo>/artefacts/heal-stats.json` with:

    {
      "version": "3.10.0",
      "generatedAt": "2026-06-06T...",
      "source": "<events file>",
      "totals": {
        "registrations": 47,
        "healAttempts": 6,
        "healed": 4,
        "healUnavailable": 2,
        "healRate": 0.6667,
        "uniqueFields": 23,
        "uniquePages": 3
      },
      "topFailingFields": [
        { "page": "LoginPage", "name": "submitButton",
          "attempts": 3, "healed": 2 },
        ...
      ],
      "topErrors": [
        { "error": "timeout <n>ms exceeded", "count": 4 },
        ...
      ],
      "topCandidates": [
        { "selector": "[data-testid='submit']", "promotions": 2,
          "averageConfidence": 0.87 },
        ...
      ],
      "retryLatencyMs": { "p50": 1240, "p95": 3010,
                          "min": 880, "max": 3010 },
      "perScenario": [
        { "scenario": "User can log in", "attempts": 1, "healed": 1 },
        ...
      ]
    }

Where v3.9.0's `llm-stats.json` measures the LLM batching ROI per
scaffold, v3.10.0's `heal-stats.json` measures the self-healing
ROI per TEST RUN.

**2. New module `src/reports/healStats.ts`** — pure
`aggregate(events, source, topN)` function plus the wrapper
`analyseHealStats(opts)` that resolves the input path
(file / repo-dir / artefacts-subdir) and writes the sidecar.

**3. Error normalisation.** The aggregator collapses error messages
into stable buckets (lowercase, strip "Error:"/"TimeoutError:"
prefixes, replace runs of 3+ digits with `<n>`) so transient
timestamps / IDs don't fragment the histogram.

**4. Retry latency derivation.** Pairs each `heal_attempt` with its
matching `healed` (by `page+name+method`) and reports the timestamp
delta as the retry latency. Computes p50 / p95 / min / max across
the run.

**5. Graceful empty-input behaviour.** Pointing the CLI at a repo
with no heal-events.jsonl writes a zero-event summary instead of
failing — `bdd2pw heal-stats` is now safe to run unconditionally
in CI after `npx playwright test`.

### Tests

`tests/unit/v3100HealStats.test.ts`:
- Empty input → all-zero summary.
- Mixed register / heal_attempt / healed / heal_unavailable sequence
  aggregates correctly (counts, healRate, topFailingFields,
  topErrors, topCandidates, p50/p95 latency, per-scenario rollup).
- `topN` honored — top-3 returns 3 entries from 5 distinct fields.
- End-to-end: write JSONL → `analyseHealStats(file)` → read JSON
  back and verify shape + version stamp.
- Missing-file safety: pointing at a directory with no
  heal-events.jsonl returns total=0 and writes an empty summary.
- Repo-path resolution: passing a directory finds
  `artefacts/heal-events.jsonl` automatically.

## [3.9.0] — 2026-06-05

### Added — opt-in LLM telemetry sidecar

`scaffold({ llmStats: true })` now writes
`<repo>/artefacts/llm-stats.json` capturing per-scaffold LLM activity:

    {
      "version": "3.9.0",
      "scaffoldId": "scaffold-...",
      "generatedAt": "2026-06-05T...",
      "totals": {
        "callsAttempted": 5,
        "callsSuccessful": 5,
        "bindingsGenerated": 23,
        "cacheHits": 12,
        "cacheMisses": 11,
        "cacheHitRate": 0.522,
        "inputTokens": 24500,
        "outputTokens": 8200,
        "estimatedCostUsd": 0.0735
      },
      "calls": [
        { "index": 1, "model": "...", "inputTokens": 4900,
          "outputTokens": 1820, "latencyMs": 2310,
          "fromCache": false, "batchSize": 5 },
        ...
      ],
      "latencyMs": { "p50": 2100, "p95": 3450, "min": 1200, "max": 3450 },
      "pricing": { "model": "claude-sonnet-4-6",
                   "inputUsdPerMillion": 3, "outputUsdPerMillion": 15 }
    }

**Why it exists.** v3.5.0 introduced per-scenario LLM batching with
the promise of ~75% cost reduction on unmatched-heavy scaffolds.
Until now, the savings were invisible — operators had no per-scaffold
record of cache hit rate, batch size distribution, token counts, or
estimated cost. This sidecar makes the ROI measurable per run.

**How it works.** New `src/llm/telemetry.ts` ships an `LLMTelemetry`
class that subscribes to the existing `LLMLogEvent` stream
(`cache_hit` / `cache_miss` / `provider_call_start` /
`provider_call_done` / `binding_parsed` events that
`AnthropicLLMClient` already emits). The scaffold orchestrator fans
the log callback to BOTH the existing pino logger AND the telemetry
collector. Zero overhead when disabled — no telemetry instance is
constructed and the fan-out is a single `?.` null check.

**Pricing.** Cost is an ESTIMATE — provider prices change. The
sidecar records the per-million rates used (default snapshot for
Claude Sonnet 4.6: $3/M input, $15/M output) so a reviewer can
re-derive the number against current pricing. Override via
`new LLMTelemetry(scaffoldId, version, pricingOverride)` if you
have negotiated rates or a different model.

**New exports** from `@vijaypjavvadi/bdd2pw`:
- `LLMTelemetry` — the collector class.
- `DEFAULT_PRICING` — per-million USD pricing snapshot. Pre-seeded
  for `claude-sonnet-4-6`, `claude-3-7-sonnet-latest`,
  `claude-opus-4-6`, `claude-haiku-4-5-20251001`.
- Types: `TelemetryCall`, `TelemetrySummary`.

### Default behavior

`llmStats` is **off** by default — pure-UI scaffolds and existing
LLM-enabled scaffolds emit the same files as v3.8.x. Operators opt
in when they want to track spend or debug latency.

### Tests

`tests/unit/v390Telemetry.test.ts`:
- Single-batch aggregates correctly (cache misses incremented,
  tokens captured, latency recorded, bindings counted).
- Cache hit rate computed across mixed cached + uncached calls.
- p50 / p95 latency from a 10-element sample.
- Cost estimation against the known Sonnet pricing snapshot.
- Scaffold context (id, version, generated timestamp) stamped
  into the summary.
- Zero-event scaffold produces a clean empty summary (no crash,
  no NaN).

## [3.8.0] — 2026-05-24

### Added — four more opt-in domain rule packs

bdd2pw now ships seven regulated-industry dialect packs total
(banking, healthcare, insurance from v3.4.0 + the four new ones).
Each pack is opt-in via the `domains` config and adds ~20 patterns
to the matcher.

`DomainName` is now the union of all seven; `ScaffoldOptions.domains`
accepts any combination.

#### Retail / e-commerce (`src/transformers/domains/retail.ts`)

20 rules: cart operations (`add to cart`, item count, empty check,
remove), pricing (`the price is "$X"`, subtotal / total / tax with
quoted-currency support), checkout (`I complete the checkout`), SKU,
inventory status (in stock / out of stock / low stock / backordered /
sold out), shipping address, estimated delivery, promo codes,
discounts, product name, ratings, review counts, wishlist, order
status, order number, size/color/variant selection.

#### Gov / civic (`src/transformers/domains/gov.ts`)

20 rules: form submission, form ID, eligibility status, case number
and case status, benefit amounts (monthly / annual), document type,
file upload, FOIA request status, FOIA response (redacted / released /
denied), residency status, agency assignment, program enrollment
(SNAP, Medicaid, etc.), intake date, application status,
WCAG conformance (A / AA / AAA), appeal status, deadlines, appointment
scheduling, audit log entries.

#### Education (`src/transformers/domains/education.ts`)

20 rules: letter grades (with optional subject context), GPA,
attendance rate and per-student status (present/absent/tardy/excused),
course enrollment, assignment status (submitted/graded/late/missing),
due dates, FERPA-protected records, transcripts (credit counts),
instructor/teacher/professor, term/semester/quarter, student ID,
class size, assignment submission, quiz/test/exam scores, course
availability, school/district, parent/guardian contact, grade
entry, classification (Freshman/Sophomore/Junior/Senior/Graduate).

#### Telecom (`src/transformers/domains/telecom.ts`)

20 rules: subscriber status (active/suspended/cancelled/churned),
plan tier, monthly price/bill, MSISDN/phone number, port-in status,
data usage (GB/MB/TB), data allowance, voice usage, SMS count,
billing amount, service status, signal strength, device IMEI,
SIM ICCID, call duration, SIM/device/line activation,
service suspend/cancel/reactivate/resume, roaming on/off, account
number, line addition.

### Fixtures + tests

- `tests/fixtures/v3.8.0/{retail,gov,education,telecom}/input.feature`
  — one fixture per domain, 15-18 representative steps each.
- `tests/unit/v380Fixtures.test.ts` — three assertions per domain
  (activated, not activated, all-four-together cross-cutting).

### Backward compatibility

Default empty `domains` keeps the registry byte-stable. Anyone
upgrading from 3.7.1 sees no behavior change unless they opt in.
The existing 3.4.0 packs (banking/healthcare/insurance) are
unchanged.

## [3.7.1] — 2026-05-24

### Fixed — TestForge regression report (2026-05-22)

Two regressions surfaced after TestForge upgraded from 2.2.7 → 3.7.0.
Both are emitter-side defects with the same one-line repro feature.
Patch bump from 3.6.0 directly to 3.7.1 to skip past the broken 3.7.0
version label TestForge already saw.

#### #R1 (P0) — variable-name shadow in generated specs

A caller passing `page: "repro"` (or any lowercase name) used to
produce:

    import { repro } from "../pages/repro.page";
    const repro = new repro(page);   // ← TDZ: shadows the import

Every test crashed at the first scenario line with
`ReferenceError: Cannot access 'repro' before initialization` —
the `const repro` declaration shadows the `import { repro }` binding
inside the test's block scope, and the not-yet-initialised local
binding wins.

**Fix:** `scaffold()` now PascalCases `opts.page` up-front into a
new `pageClassName` variable used everywhere the class identifier
is emitted (POM file, spec import, `new` expression, POM-resolver
decision message). `pageVar` is still camelCase, so PascalCase
className + camelCase pageVar are guaranteed to differ — the
shadow can never form.

Idempotent: `pascalCase("repro")` → `"Repro"`, `pascalCase("LoginPage")`
→ `"LoginPage"` (no change), `pascalCase("login_page")` →
`"LoginPage"`, `pascalCase("login-page")` → `"LoginPage"`.

#### #R2 (P0) — assertion that `test.step` wrapping survives

The TestForge report flagged emitted specs without `test.step(...)`
wrappers, which would silently break their v3.3.0 hook-API
integration (no `afterStep` → no per-step screenshots, no Visual
Regression manifest).

The current `bindingsToBody` IS still wrapping every step in
`test.step` (see `src/emitters/facade.ts:299`), so the regression
either lived in a different code path or the report's reproduction
was rendered with a different emitter version. Either way, the
contract matters too much to leave un-asserted.

**Defence:** new
`tests/unit/v371Regressions.test.ts` includes a hard assertion:
`#R2 — every Gherkin step is wrapped in 'await test.step(...)'`.
Any future emitter change that drops the wrapper (or any single
step that bypasses `bindingsToBody`) gets flagged immediately.
The same file also asserts that `testInfo` is part of the test
signature (the v3.1.0 contract TestForge worried might have
regressed).

### Tests

`tests/unit/v371Regressions.test.ts`:
- `pascalCase` normalises lowercase / snake / kebab / camel into
  PascalCase (idempotent on already-PascalCase input).
- Emitted spec uses PascalCase class for both import and
  `new ClassName(page)`, never `new repro(page)`.
- Every Gherkin step is wrapped in `await test.step(...)`.
- The test() signature carries `testInfo` as the second arg.

## [3.6.0] — 2026-05-22

### Added — rule-trace diagnostics in BDD_REVIEW.md (opt-in)

When `ScaffoldOptions.diagnostics: true`, every step that ended up
as a warning gets a "Rule trace" sub-section listing the top-3
nearest deterministic rules with their pattern source and whether
each declined because the regex didn't match or because the
build() callback returned null. Helps users see exactly what to
add as a new rule.

`diagnoseStep` and `RuleTraceEntry` are now exported from
`src/transformers/stepMatcher.ts` so external tooling (test
harnesses, the propose-rules pipeline, the VS Code extension) can
consume the trace directly.

`ReviewItem.details?: string[]` carries the rendered trace lines.
Off by default — the diagnostic pass is O(rules × warnings) and
the trace pollutes BDD_REVIEW.md for users who don't need it.

### Added — `bdd2pw propose-rules` CLI subcommand

Reads `<repo>/artefacts/candidate-rules.jsonl` (written on every
successful LLM fallback) and proposes new deterministic regex
rules by clustering similar step texts. Output goes to
`<repo>/artefacts/propose-rules.md`.

How it works:

1. Every step text is reduced to a structural FINGERPRINT — quoted
   literals collapse to `""`, currency to `<MONEY>`, dates to
   `<DATE>`, numbers to `<NUM>`. Steps that share a fingerprint
   share a shape.
2. Clusters of size >= `--min-cluster-size` (default 2) emit a
   proposal.
3. Per proposal: cluster size, draft regex with capture groups,
   representative binding (most-recent LLM output), sample step
   texts for human audit.

CLI:

    npx bdd2pw propose-rules <repo>
    npx bdd2pw propose-rules <repo> --out path/to/output.md
    npx bdd2pw propose-rules <repo> --min-cluster-size 5

Programmatic API (`src/llm/proposeRules.ts`):

    import { proposeRules, fingerprint, synthesiseRegex } from "@vijaypjavvadi/bdd2pw";
    const result = await proposeRules({ inputPath: "./my-repo" });
    console.log(`${result.proposalsWritten} proposals → ${result.outputPath}`);

Closes the loop on the long-standing TODO in
`src/llm/candidateRules.ts` — the JSONL is finally consumable
without a separate offline tool.

### Tests

- `tests/unit/v360Features.test.ts` — diagnoseStep returns the
  expected shape; fingerprint/synthesiseRegex handle the common
  variable shapes; proposeRules clusters multi-entry input,
  skips singletons, emits a "no proposals" message when nothing
  passes the minimum, and accepts either a JSONL file path or a
  repo root.

## [3.5.0] — 2026-05-22

### Added — per-scenario LLM batching

Each scenario with N unmatched steps used to fire N separate Anthropic
calls. Each call paid full round-trip latency plus the system prompt
and POM-context tokens. v3.5.0 folds all unmatched steps in a scenario
into a SINGLE provider call. Cost reduction is roughly proportional
to N when N > 1, and the round-trip latency drops from ~N×3s to ~3s
for a typical scenario.

**How it works.**

`AnthropicLLMClient.generateBatchBindings(inputs[])` now exists as a
peer to `generateBinding(input)`. Given N inputs:

1. Per-step cache lookup runs FIRST. Already-cached inputs short-
   circuit out of the prompt; only cache-misses are folded in.
2. Cache misses go into one prompt via `buildBatchUserPrompt` —
   the POM context block appears once, followed by N numbered
   step blocks.
3. The model returns a JSON array of N binding objects in the
   same order.
4. Per-slot `parseBindingJson` validation (the existing
   hallucination / empty-locator / bare-context defences continue
   to apply per binding).
5. Each successful slot is written to cache with its individual
   key.
6. Results are returned in the original input order so callers
   don't need to know batching happened.

The batch counts as ONE call against the budget. If every input is
a cache hit, no provider call is made at all.

**New orchestrator: `matchScenarioWithLLM`.**

`src/llm/llmStepMatcher.ts` gains a new function for the batched
path. `scaffold()` calls it once per scenario (also once for the
synthetic Background scenario, and once per Scenario Outline row).
The per-step `matchStepWithLLM` is unchanged and still used by
`analyze()` and anywhere a single-step path is more natural.

Soft-fail semantics match the per-step path:
- LLM client doesn't implement `generateBatchBindings`: falls back
  to per-step.
- Single-warning scenarios: routed through per-step (no benefit
  to batching one).
- Batch throws / sidecar unreachable / parse error: every warning
  slot gets an annotated `(LLM batch threw: …)` or
  `(LLM fallback also failed: …)` warning — same shape as the
  per-step path.
- One bad slot in an otherwise-good batch: only that slot
  becomes a warning; the rest succeed.

**Opt-out: `llmConfig.disableBatch: true`.**

Flip back to the pre-v3.5 per-step path if you hit a provider
per-prompt token limit on large batches or need strict 1:1 call
accounting. Default false — batching is on.

**Backwards compatibility.**

- `generateBinding` is unchanged. The per-step path is preserved.
- `LLMClient.generateBatchBindings` is OPTIONAL on the interface,
  so existing custom clients (and the v2.x MockLLMClient if a
  consumer is still using it directly) continue to work — the
  orchestrator falls back to per-step when the method is missing.
- Cache keys are identical to v3.4.x — running with v3.5 against a
  cache populated by v3.4 hits the cache exactly as before.
- `candidate-rules.jsonl` still gets one entry per LLM-generated
  binding, so the offline review pipeline notices no change.

## [3.4.0] — 2026-05-22

### Added — three opt-in domain rule packs

bdd2pw's deterministic rule registry now ships with three new
regulated-industry dialect packs. Each pack is opt-in via the new
`domains` config and adds ~20 patterns to the matcher. When
activated, the pack's rules run BEFORE the generic UI/URL rules so
domain-specific prose intercepts the ambiguous catch-alls first.

#### `ScaffoldOptions.domains?: ("banking" | "healthcare" | "insurance")[]`

Pass any combination — they're additive. Default empty array
keeps the registry byte-stable with v3.3.0 for callers who don't
opt in.

    await scaffold({
      feature: "features/login.feature",
      domains: ["banking", "healthcare"],
      // …
    });

#### Banking (`src/transformers/domains/banking.ts`)

20 rules covering: account balance (`the account balance is
"$1,234.56"`), comparators (`at least`, `at most`, `less than`,
`greater than`, `exactly`), transfers (`I transfer "$X" from "Y" to
"Z"`), transaction fees, statement transaction counts, daily
withdrawal/deposit/transfer limits, account opening/closing,
transaction dates, payment status, Reg E dispute filing windows,
Reg D savings withdrawal counts, KYC and AML statuses, account
number tails, routing numbers, deposits / withdrawals, available
credit, wire transfer status.

#### Healthcare (`src/transformers/domains/healthcare.ts`)

20 rules covering: patient name and MRN, appointment scheduling,
ICD-10 diagnosis codes, medications (prescribed / ordered /
administered), HIPAA consent forms, HL7 v2 message types
(`ADT^A01`), FHIR resource refs (`Patient/123`), encryption
status, vital signs (blood pressure, heart rate), allergies,
provider NPI and DEA, lab results, admit/discharge actions, audit
log entries.

#### Insurance (`src/transformers/domains/insurance.ts`)

20 rules covering: policy numbers, premium amounts, claim status,
deductibles (with comparators), policy effective and renewal
dates, claim filing windows, loss reserves, line of business,
NAIC codes, adjuster assignment, claim filing, coverage limits,
policy status (active / lapsed / cancelled), policyholder name,
cancel / renew actions, subrogation status, premium payment
indicator, claim payout.

### How the rules emit code

Every domain rule emits `customBody` (not pomCall/assertion) so
the spec doesn't depend on the user having a POM field for every
domain concept. Bodies reference standard locator hints
(`[data-testid='...']`, `[aria-label='...']`, `getByLabel(/...)`)
that match most well-built apps. Field shape uncertainty is
acknowledged with multiple selectors in the same `locator(...)`
call (e.g. `"[data-testid='kyc-complete'], [aria-label='KYC verified']"`).

### Fixtures + tests

- `tests/fixtures/v3.4.0/{banking,healthcare,insurance}/input.feature`
  — one fixture per domain, ~15-18 representative steps each.
- `tests/unit/v340Fixtures.test.ts` — three assertions per domain:
  1. Activated → every fixture step matches a rule.
  2. Not activated → most fixture steps fall through (proves
     opt-in is real).
  3. Cross-cutting: all three activated together → all three
     fixtures match cleanly.

### New module organization

`src/transformers/domains/` is the new home for domain rule packs.
Future v3.x releases can drop in additional packs (retail, gov,
education, etc.) without touching `stepMatcher.ts`.

### Cross-cutting

`stepMatcher` now exports `setActiveDomains(domains)` and a
`DomainName` type for callers that need to drive the matcher
directly (e.g. test harnesses). The active set is reset to empty
when `scaffold()` is called without `domains`, so leftover state
from a previous run can't pollute the next.

## [3.3.0] — 2026-05-22

### Changed — TestForge step-hook signature extension (follow-up to v3.1.0 Issue 4)

TestForge follow-up request: the v3.1.0 step hook only received
`(testInfo, title)` — enough for metadata-only consumers, but not
for the most common use case (per-step screenshots, DOM capture,
artefact attachment). All of those need access to `page` (or
`request` / `context` / `browser`).

When `stepHooks: true`, the emitted `test.step(...)` wrapper now
looks like this:

    await test.step("Given …", async () => {
      await (globalThis as any).__bdd2pwHooks?.beforeStep?.(
        testInfo,
        "Given …",
        { page },
      );
      let _bdd2pwStatus: "passed" | "failed" = "passed";
      try {
        // step body
      } catch (_bdd2pwErr) {
        _bdd2pwStatus = "failed";
        throw _bdd2pwErr;
      } finally {
        await (globalThis as any).__bdd2pwHooks?.afterStep?.(
          testInfo,
          "Given …",
          _bdd2pwStatus,
          { page },
        );
      }
    });

Three changes from v3.1.0:

1. **`fixtures` arg.** Both `beforeStep` and `afterStep` now receive
   a `{ page, request?, context?, browser? }` object containing
   whatever fixtures the surrounding `test()` callback
   destructures. Currently always `{ page }` — when bdd2pw starts
   threading multi-fixture signatures through `EmitTestFileInput`,
   the same literal forwards automatically.

2. **`status` arg on `afterStep`.** Reports `"passed"` or
   `"failed"` so consumers can attach failure-only artefacts
   (per-step screenshot only when the step failed, full DOM dump
   only on failure, etc.).

3. **try/catch/finally wrapping.** `afterStep` fires on the
   failure path too — `_bdd2pwStatus` is set to `"failed"`, the
   error is re-thrown, and `finally` runs the hook. Local
   variable, no cross-step shadowing.

### Backward compatibility

Consumers whose hook signature is `(testInfo, title)` /
`(testInfo, title, status)` continue to work — JavaScript silently
drops the extra positional args. Optional chaining throughout
means consumers who don't set `__bdd2pwHooks` see no behaviour
change at all.

### Tests

`tests/unit/v310Fixtures.test.ts` — updated the existing
"stepHooks: true emits …" assertion to also verify the v3.3.0
shape: fixtures arg on both hooks, status arg on afterStep,
try/catch/finally wrapping with `_bdd2pwStatus`. Same fixture file
(`tests/fixtures/v3.1.0/04-step-hooks/input.feature`) — no new
fixture needed; the contract change is in the rendered output, not
the input.

## [3.2.0] — 2026-05-22

### Added — TestForge handoff P2 backlog (Issues 6-10)

Five P2 items from the TestForge handoff. None are bug fixes;
they're feature additions and extension points that close out the
backlog. All five default to "off / existing behavior", so v3.2.0
is byte-stable against v3.1.0 for callers who don't opt in.

#### Issue 6 — `playwright.config.ts` collision marker

The emitted `playwright.config.ts` now ends with a stable
`// bdd2pw:config-end` marker line followed by guidance comments.
Downstream tooling can splice additional code after that line
without risking a duplicate `defineConfig(...)` import. Lives in
`pw-emit@1.3.0`'s `playwright.config.ts.tmpl`.

#### Issue 9 — pin emitted dependency versions

New `dependencyStrategy?: "caret" | "exact"` on `ScaffoldOptions`
(and on pw-emit's `EmitProjectOptions`). Default `"caret"` matches
existing behavior. `"exact"` strips the leading `^` from every
devDependency version in the emitted `package.json`, pinning the
consuming project to exact versions of Playwright et al.

#### Issue 10 — `*.spec.meta.json` sidecar

New `metaSidecar?: boolean` on `ScaffoldOptions`. When true,
`scaffold()` writes `<spec-stem>.spec.meta.json` alongside each
emitted `.spec.ts` describing every step semantically:

    {
      "version": "3.2.0",
      "source": "features/login.feature",
      "scenarios": [{
        "name": "...",
        "tags": ["@positive"],
        "steps": [
          { "id": "0001", "keyword": "Given", "text": "...",
            "intent": "navigation", "locator": "loginPage.goto",
            "assertion": "goto" },
          ...
        ]
      }]
    }

Intent ∈ { navigation | interaction | assertion | api | compound |
todo }, classified from the binding shape. Lets downstream tools
(visual regression, defect analysis, self-healing) consume bdd2pw's
semantic understanding without re-parsing TS.

New module `src/reports/metaSidecar.ts`. IDs match the optional
step-boundary markers (v3.1.0 Issue 5) so post-processors can
correlate the sidecar with in-source markers when both are on.

#### Issue 8 — structured JSON scenarios as input

`scaffold({ feature: "scenarios.json", ... })` now works. The
JSON converter accepts either a single object or an array of
objects with `{ name, kind, preconditions, actions, expected,
data, tags }`. Synthesised Gherkin steps follow standard BDD
convention (`Given` for preconditions, `When/And` for actions,
`Then/And` for expected). `<placeholder>` tokens in step text are
substituted from `data`. Tags can be set explicitly or derived
from `kind` (`"api"` → `@api`, `"mixed"` → `@ui @api`).

New module `src/parser/jsonScenarioParser.ts`. Detected by file
extension; `.feature` continues through `gherkinParser` unchanged.

#### Issue 7 — idempotent regen with user-block preservation

New `merge?: boolean` on `ScaffoldOptions`. When true:

- Each emitted spec gets a `// bdd2pw:generated v=<version>
  source=<feature>` header so a future regen can detect it.
- Users can wrap hand-edited code in
  `// bdd2pw:user-block id="<id>"` ...
  `// bdd2pw:end-user-block` markers anywhere in the spec.
- During regeneration, blocks with matching ids are spliced back
  into the new output. Orphaned blocks (id absent from the new
  output) are appended under a clearly-labeled
  `// ── bdd2pw:stale-user-blocks ──` footer so nothing is lost
  silently.

Without `merge`, the existing overwrite behavior is unchanged.

New module `src/reports/specMerge.ts`.

### pw-emit v1.3.0 (required peer)

- `playwright.config.ts.tmpl` ends with the `// bdd2pw:config-end`
  marker + guidance comments.
- `EmitProjectOptions.dependencyStrategy?: "caret" | "exact"`.

Both additions are additive and default-off. SemVer minor.

## [3.1.0] — 2026-05-22

### Fixed — TestForge handoff report

Five issues from the TestForge AI integration team's handoff report
(2026-05-22). The P0 set (Issues 1-3) unblocks the largest class of
false-positive failures in their cloud-job pipeline; the P1 set
(Issues 4-5) eliminates their fragile 200-line post-process patcher.

#### Issue 1 (P0) — visibility steps no longer slugified into URL regex

Prose like `"the user's name or profile indicator is visible in the UI"`
was falling through every existing visibility rule and ending up in the
URL-slug rules, where it was tokenised into a `toHaveURL(/.../)`
assertion that never matched anything in the real app. Result: silent
always-failing tests that looked like product bugs.

**Fix:**
- New `src/transformers/visibilityRules.ts` with 7 catch-all patterns
  (`<noun> is visible / displayed / shown / appears`,
  `<noun> should be visible / displayed / shown`,
  negative `<noun> is hidden / not visible`,
  enabled `<noun> is enabled / clickable`).
- Wired into the matcher BEFORE all URL-slug rules.
- When the captured noun phrase matches a POM field (fuzzy
  case-insensitive substring), emits `toBeVisible()` against the
  resolved locator. When it doesn't match, emits a clean `// TODO
  bdd2pw: ambiguous visibility step` warning — **never** a URL regex.
- `looksLikeProse` extended to flag any captured slug containing
  `is/are visible/displayed/shown/hidden/appears` so URL-slug rules
  decline these targets defensively even if visibility rules are
  bypassed in a future change.

#### Issue 2 (P0) — `:root` locator rejected

`page.locator(':root')` is syntactically valid CSS but matches
`<html>` — useless for every visibility / click / text assertion.
The LLM occasionally emitted it when it couldn't synthesise a
sensible selector.

**Fix:** `detectHallucinatedLocators` in
`src/llm/anthropicClient.ts` now also flags any
`locator(':root')` / `locator(":root")` reference. Bindings carrying
it are rejected at parse time and the step lands as a clean TODO.

#### Issue 3 (P0) — `testInfo` in every test() callback

Downstream tooling (visual-regression, custom reporters, artefact
uploads) needs `testInfo.titlePath` / `testInfo.attach()` /
`testInfo.testId`. The v3.0.0 generated signature
`async ({ page }) => {...}` forced consumers to regex-rewrite every
spec post-scaffold to inject `testInfo`.

**Fix:** pw-emit v1.2.0's `testEmitter` always emits
`async ({ page }, testInfo) => {...}`. Same for the `test.fixme`
variant. TypeScript allows unused destructured params, so this is
zero-impact for consumers who don't need testInfo.

#### Issue 4 (P1) — opt-in step hook callouts

TestForge maintains a 200-line `inject-vr.js` brace-counting state
machine to wrap every `test.step` body in a VR-capture call.

**Fix:** new `stepHooks?: boolean` on `ScaffoldOptions` and
`EmitTestFileInput`. When true, every emitted `test.step` body opens
with:

    await (globalThis as any).__bdd2pwHooks?.beforeStep?.(testInfo, "<title>");

and closes with:

    await (globalThis as any).__bdd2pwHooks?.afterStep?.(testInfo, "<title>");

Optional-chained throughout — consumers who don't set
`(globalThis as any).__bdd2pwHooks = {...}` see no behaviour change.
Off by default. The post-process patcher can be retired.

#### Issue 5 (P1) — opt-in step boundary markers

**Fix:** new `stepMarkers?: boolean`. When true, each emitted
`test.step` is bracketed by stable comment markers:

    // bdd2pw:step-open id="0001" title="Given I am on the login page"
    await test.step("Given I am on the login page", async () => { ... });
    // bdd2pw:step-close id="0001"

IDs are zero-padded 4 digits, sequential per test in source order.
Lets post-processors slice the source on stable strings instead of
brace counting. Off by default.

### pw-emit v1.2.0 (required peer)

Same release ships pw-emit v1.2.0 — adds `testInfo` to the test
signature in every generated spec. SemVer minor; the additional
destructured argument is harmless for consumers who don't reference it.

### Fixtures

- `tests/fixtures/v3.1.0/01-visibility-prose/` — TestForge's
  reproduction step. Asserts no `toHaveURL`, no `:root`, no URL regex.
- `tests/fixtures/v3.1.0/02-no-root-locator/`
- `tests/fixtures/v3.1.0/03-test-info/`
- `tests/fixtures/v3.1.0/04-step-hooks/`
- `tests/fixtures/v3.1.0/05-step-markers/`
- `tests/unit/v310Fixtures.test.ts` — 9 assertions covering all five
  issues plus `detectHallucinatedLocators` and `looksLikeProse`.

## [3.0.0] — 2026-05-12

### Added — native API testing step patterns (no LLM fallback)

bdd2pw now recognises ~17 API-shaped Gherkin step patterns natively
and emits Playwright `APIRequestContext` (`page.request.*`) code for
them. API-shaped steps NEVER reach the LLM fallback —
cache-effective, deterministic, no per-binding Anthropic cost for
the common patterns.

**Coverage (`src/transformers/apiRules.ts`):**

Setup: `Given the API base URL is "<URL>"`,
`Given the <X> API endpoint is reachable` (marker step).

Requests (verb ∈ {GET, POST, PUT, DELETE, PATCH}):
- `When I send a <VERB> request to "<path>"`
- ` ... with body:` + JSON docstring → embeds as `data:` with
  `content-type: application/json`.
- ` ... with header "<H>" set to "<V>"`.
- `When I send the previous request again with header "<H>" set to "<V>"` →
  re-issues using the in-test `_lastApiReq` record.

Status: `is <N>`, `is in [<list>]`, `is less than <N>`.

Body: `has a non-empty "<field>" field`,
`field "<f>" equals "<v>"` (string), `equals <N>` (numeric),
`field "<f>" matches /<regex>/`, `body contains "<text>"`,
`does NOT contain a "<field>" field`, `is JSON`.

Headers: `equals "<V>"`, `contains "<V>"`, `is set`. Names lowercased.

### Added — scenario-level API state injection

When at least one scenario in the feature has an API-flagged binding,
the emitter (`src/emitters/facade.ts`) automatically:

1. Adds `type APIResponse` to the `@playwright/test` import.
2. Declares describe-scoped state inside `test.describe(...)`:
   ```typescript
   let apiResponse: APIResponse | null = null;
   let baseUrl: string = process.env.CLOUD_JOB_APP_URL ?? "";
   let _lastApiReq: { method: string; path: string; data?: unknown;
                     headers?: Record<string, string> } =
       { method: "", path: "" };
   ```
3. Prepends `apiResponse = null;` to the body of every API-bearing
   test so a leftover from a previous test never bleeds into the next.

Pure-UI features in the same project remain entirely unchanged.

### Added — pw-emit v1.1.0 (required peer)

- `TestSpecIR.playwrightImports?: string[]` — extra named imports
  merged into the `@playwright/test` line.
- `TestSpecIR.describeBodyPrelude?: string` — pre-rendered TS lines
  emitted inside `test.describe(...)` before any hooks.

Both additions are optional and additive — pure-UI emission paths
are byte-stable across the 1.0 → 1.1 upgrade.

### Breaking — peer dependency bump + import line changes

- `@vijaypjavvadi/pw-emit` requirement is now `^1.1.0` (was `^1.0.0`).
- The `import { test, expect } from "@playwright/test";` line in
  emitted specs may now also include `type APIResponse` when the
  feature has any API step. Downstream tooling that grep-matches the
  import line on exact bytes should be updated.

Versioned 3.0.0 (semver-major) to flag the import-shape change,
even though pure-UI runtime behavior is unchanged.

### Tests

- `tests/fixtures/api/` — 9 .feature fixtures (simple-get,
  post-with-body, post-with-headers, chained-calls, status-list,
  body-field-equals, body-regex-match, headers, mixed-ui-api).
- `tests/unit/apiFixtures.test.ts` — drives each fixture through
  parseFeature + matchStep + emitTestFile and asserts byte-equality
  against `tests/expected-output/api/*.spec.ts`. Set
  `BDD2PW_UPDATE_SNAPSHOTS=1` to regenerate after intentional
  emitter changes.
- Same test also asserts that NO API fixture step produces a
  `warning` binding — every API step matches a deterministic rule,
  zero LLM fallback.

## [2.2.7-extension] — 2026-05-11

### Added — VS Code extension subdirectory (separate version line, 0.1.0)

`vscode-extension/` houses the new bdd2pw VS Code extension. Imports
the bdd2pw library in-process, exposes four entry points (Explorer
context menu, command palette, activity-bar sidebar, status bar),
and is intended for publishing to the VS Code Marketplace under the
`vijaypjavvadi` publisher.

The extension tracks its own version + CHANGELOG —
`vscode-extension/CHANGELOG.md` starts at 0.1.0. The bdd2pw library
SemVer remains unaffected; users who only use the CLI / library
should ignore the extension subdir entirely.

Publishing runbook: `vscode-extension/PUBLISH_VSCODE.md`.

## [2.2.7] — 2026-05-11

### Changed — BUG-10 polish: stronger framework-class handling + cleaner fallback names

Two follow-up improvements to the v2.2.6 BUG-10 fix. Each one
addresses a residual rough edge surfaced by the
`pickLocator({ tag: "input", cssSelector: ".ng-untouched.search-input" })`
case.

#### 1. Strip framework class tokens from mixed selectors

v2.2.6 rejected framework-ONLY selectors but left mixed ones intact,
so `.ng-untouched.search-input` still got rendered as
`page.locator('.ng-untouched.search-input')`. Playwright requires
BOTH classes to be present simultaneously, so when the user focuses
the input and Angular flips `.ng-untouched` → `.ng-touched`, the
locator stops matching and the test fails on a should-be-stable
user-named element.

**Fix:** new `stripFrameworkClasses(selector)` export in
`src/transformers/locatorPicker.ts`. Wired into `pickLocator`
step 6 so the emitted selector contains only user-named class
tokens. `.ng-untouched.search-input` → `.search-input`.
`input.ng-untouched[type="search"]` → `input[type="search"]`.
`form.ng-untouched .search-input` → `form .search-input`. Only bare
`.classname` tokens are stripped; element/attribute/id parts and
combinators are preserved.

If stripping leaves an empty / whitespace-only selector (e.g. the
input had a `.ng-untouched.ng-pristine` selector that the
isFrameworkOnlySelector gate happened to miss for some
edge-case reason), the renderer falls through to xpath then to
tag-only — same as the v2.2.6 framework-only path.

#### 2. Skip role-suffix when the base came from the `<tag>Element` fallback

After v2.2.6, an Angular input with `cssSelector: ".ng-untouched"`
and no other handles produced the field name `inputElementInput` —
clean of the framework class but ugly. The redundant suffix was
because the existing `endsWith` check didn't catch `inputElement`
(`"inputelement".endsWith("input")` is `false`).

**Fix:** `synthFieldName` now tracks a `haveExplicitBase` flag —
true when ANY explicit name source (name / label / placeholder /
testId / text / idDerived) was available, false when we fell
through to the `${role ?? tag}Element` last-resort base. The
role-suffix step is skipped on the fallback path. So the same
Angular input now produces `inputElement`. All other shapes
unchanged.

### Tests

`tests/unit/locatorPicker.test.ts`:
- New `stripFrameworkClasses` group — single-class, mixed, tag /
  attribute / descendant preservation, no-op when no framework
  class, and a documented edge-case (`:not(.ng-foo)` strips the
  inner token to `:not()` — acceptable, rare in practice).
- Updated the v2.2.6 BUG-10 tests to reflect v2.2.7 behaviour
  (`expect(c.args).toBe('".search-input"')` not just `.toContain`,
  field name `inputElement` not `inputElementInput`).

## [2.2.6] — 2026-05-11

### Fixed — BUG-10 (P2): locator extractor picks framework-internal CSS classes

Cloud-job report 2026-05-11 20:08 against `https://preview.owasp-juice.shop`:
Angular's runtime-managed form-state classes (`.ng-untouched`,
`.ng-pristine`, `.ng-dirty`) were being picked as both the POM
field-name source AND the locator CSS selector. The POM emitted
`ngUntouchedInput = page.locator('.ng-untouched')` and the LLM then
used `ngUntouchedInput` for "search field has not yet been
interacted with" preconditions. The assertion failed because:

1. `.ng-untouched` flips to `.ng-touched` the moment focus enters
   the input — locators built on it are flaky by construction.
2. Every Angular input shares the same state classes, so the
   selector also fails strict-mode uniqueness.
3. The field name itself is misleading — no test author would call
   the search box "ng untouched input".

Same class of bug applies to anything prefixed `mat-*` (Angular
Material), `cdk-*` (CDK overlays / focus traps), `mdc-*` (Material
Design Components), and `_ngcontent-*` / `_nghost-*` (Angular view
encapsulation markers).

**Fix (two layers in `src/transformers/locatorPicker.ts`):**

1. **Field-name source.** `cssSelectorToName` now skips
   framework-prefix classes when walking a multi-class selector and
   returns the first user-named class instead. For
   `.ng-untouched.search-input` it returns `"search input"`, not
   `"ng untouched"`. If EVERY class on the element is framework-only,
   it returns undefined and the caller falls through to
   `<role|tag>Element` — for an Angular input with no other handles,
   the synthesised field name becomes `inputElement` rather than
   `ngUntouchedInput`.

2. **CSS-fallback gate.** `pickLocator`'s step-6 CSS fallback now
   refuses framework-only selectors via `isFrameworkOnlySelector`.
   When the element has no role / label / placeholder / testId /
   text / xpath and the only CSS handle is something like
   `.ng-untouched.ng-pristine`, we emit a tag-only locator
   (`page.locator("input")`) and flag it `confidence: "fallback"`.
   Tag-only is non-ideal but at least matches a real DOM element
   instead of a transient state class.

New exports (both pure, easy to compose into future emitter rules):
- `isFrameworkClass(cls: string): boolean`
- `isFrameworkOnlySelector(selector: string | undefined): boolean`

Detection covered: `ng-*`, `mat-*`, `cdk-*`, `mdc-*`,
`_ngcontent-*`, `_nghost-*`. Hyphen-after-prefix is required so we
don't accidentally flag user-named classes like `nginx-banner` or
`ngo-button`.

### Tests

`tests/unit/locatorPicker.test.ts` — full coverage for BUG-10:
- `isFrameworkClass` matches every prefix, leaves user classes
  alone (including the deliberate near-misses `nginx-banner`,
  `ngo-button`, `material-card`).
- `isFrameworkOnlySelector` flags pure framework selectors,
  declines mixed selectors, declines `#id`-bearing selectors, declines
  non-class selectors.
- `pickLocator` drops a framework-only CSS selector and falls back
  to tag-only.
- `pickLocator` preserves selectors that have at least one
  user-named class.
- `synthFieldName` skips framework classes and falls through to
  `<role|tag>Element`.
- `synthFieldName` picks the user-named class in a mixed selector.

## [2.2.5] — 2026-05-11

### Fixed — BUG-9 (P0): POM field name starting with a digit broke entire spec

Cloud-job report 2026-05-11 19:46 against `https://preview.owasp-juice.shop`:
every test in `tests/r-0-c934-ddf-001.spec.ts` failed with a
**compile-time** `SyntaxError`, zero tests executed.

Root cause: juice-shop renders pagination labels like `"0 of 0"` and
`"1,500 of 0"` inside status regions. The locator-picker's field-name
synthesiser routed those through `camelCase`, which produced
`0Of0`, `1500Of0`, `0,0Of0`. JavaScript identifiers must start with
a letter / `$` / `_`, never a digit, and cannot contain commas.

The emitted POM and spec looked like:

    this.0Of0 = page.getByText("0 of 0");
    //   ^^^ SyntaxError
    await expect(r0c934ddf001.0Of0).toBeVisible();
    //                       ^^^ SyntaxError

This is worse than a runtime failure: there's no triage signal,
just a hard parse error, and the entire scenario set is skipped.

**Fix (defence in depth — three layers):**

1. **Identifier-safe naming helper.** New `toJsIdentifier(s)` in
   `src/utils/naming.ts`. Strips any character not in `[A-Za-z0-9_$]`,
   prefixes digit-leading identifiers with `_`, falls back to
   `_field` for empty input. Pure function, fully unit-tested.

2. **POM emitter.** `synthFieldName` in
   `src/transformers/locatorPicker.ts` runs the post-camelCase result
   through `toJsIdentifier`. Both the main path and the status-region
   special case are covered. So `"0 of 0"` now becomes `_0Of0`,
   `"1,500 of 0"` becomes `_1500Of0`. The POM declares
   `this._0Of0 = page.getByText("0 of 0")` — valid TS.

3. **Binding renderer safety net.** New `sanitizeLocatorReferences(s)`
   in `src/emitters/facade.ts` rewrites `.<digit-leading>` member
   access and `[<digit-leading>]` bracket access to be `_`-prefixed.
   Applied to `assertion.locator`, `pomCall.method`, every
   `pomCall.args` entry, and every line of `customBody`. This catches
   cached LLM bindings from v2.2.4 or earlier that reference the old
   unsanitized name shape, so users don't have to clear their cache
   to benefit from the fix.

### Tests

- `tests/unit/naming.test.ts`: full coverage for `toJsIdentifier` —
  pass-through of valid identifiers, digit-prefix path
  (`0Of0`/`1500Of0`/`123`), comma stripping (`0,0Of0`,
  `foo,bar`), arbitrary punctuation, empty-input fallback to
  `_field`.
- `tests/unit/locatorPicker.test.ts`: end-to-end reproduction of the
  juice-shop pagination case — `{ text: "0 of 0" }` element produces
  fieldName `_0Of0`; `{ text: "1,500 of 0" }` produces `_1500Of0`;
  valid inputs unchanged.
- `tests/unit/facade.test.ts`: helper coverage for
  `sanitizeLocatorReferences` plus three end-to-end render tests
  (assertion locator / pomCall args / customBody) confirming the
  rewriter fires correctly through the public `emitTestFile` entry
  point.

## [2.2.4] — 2026-05-11

### Fixed — BUG-7: empty `expect()` for URL assertions (regression from 2.2.3)

The 2.2.3 SYSTEM_PROMPT told the LLM, when asserting a URL, to "leave
`locator` as the page itself (omit it / use empty string)". The LLM
took that literally and started emitting

    { "assertion": { "locator": "", "matcher": "toHaveURL", ... } }

which the renderer dutifully turned into

    await expect().toHaveURL(new RegExp("..."));
    //      ^^ TypeError: expected at least one argument

at runtime. v2.2.2 worked because the prompt didn't have that
guidance and the LLM emitted `locator: "page"` naturally. The
regression hit 18+ scenarios in the cloud-jobs run.

**Fix (three layers):**

1. **Renderer (`src/emitters/facade.ts`).** `bindingsToBody` now
   substitutes the literal `page` (always in scope inside spec test
   bodies, because the Playwright fixture is `async ({ page }) =>`)
   whenever `assertion.locator` is empty or whitespace-only. Belt
   guarantee — even if a future cache entry or LLM response sneaks
   through with `locator: ""`, the rendered spec is still valid TS.

2. **Parser (`src/llm/anthropicClient.ts`).** `parseBindingJson`
   normalises empty/missing `assertion.locator` to `"page"` at parse
   time. Catches the bad shape upstream of the renderer (so unit
   tests at the parser layer can assert the binding is well-formed
   without needing to render).

3. **Prompt (`src/llm/prompt.ts`).** The v2.2.3 line that said "use
   empty string" is replaced with: "set `assertion.locator` to the
   literal string `\"page\"` — not an empty string, not a getByURL
   call". Includes an explicit example. Suspenders to the parser's
   belt.

### Tests

`tests/unit/llm.test.ts`:
- `parseBindingJson` normalises `locator: ""` to `"page"` for
  toHaveURL, not.toHaveURL, toHaveTitle, not.toHaveTitle.
- `parseBindingJson` normalises missing `locator` field (LLM
  literally omitted it) to `"page"`.
- `parseBindingJson` defaults any empty locator to `"page"` even for
  non-page matchers (defence — `expect()` is never legal).
- `parseBindingJson` leaves non-empty locators unchanged.

`tests/unit/facade.test.ts` (or whichever module exercises
`bindingsToBody`) — renderer substitutes `expect(page)` when an
assertion arrives with empty/whitespace locator, regardless of
matcher.

## [2.2.3] — 2026-05-11

### Fixed — BUG-6: hallucinated `page.getByURL` locators reach the spec

Cloud-job report `BDD2PW_BUGS_2026-05-11.md` BUG-6: scenario 2TC-008
crashed at the first assertion line with
`Cannot read properties of undefined (reading 'context')`. Root cause:
the LLM fallback emitted

    expect(page.getByURL(/dashboard/)).toBeVisible();

`page.getByURL` does not exist in the Playwright API. The Playwright
`page` exposes only seven `getBy*` factories — `getByAltText`,
`getByLabel`, `getByPlaceholder`, `getByRole`, `getByTestId`,
`getByText`, `getByTitle`. Anything else compiles (because TS doesn't
type-check the LLM-generated string until render time) but evaluates
to `undefined` at runtime, and the first method call against it
throws the now-infamous "context" error.

**Fix (defence in depth):**

1. **Post-parse validator.** New `detectHallucinatedLocators(s)` helper
   in `src/llm/anthropicClient.ts` scans for `page.getBy*` tokens and
   returns any whose method name is not in the allowlist. `parseBindingJson`
   now scans `assertion.locator`, `assertion.expected`, `customBody`,
   `pomCall.method`, and `pomCall.args`. If ANY field contains a
   hallucinated method, the entire binding is rejected (returns
   `undefined`) — the step lands as a clean `// TODO` instead of as
   broken-but-syntactically-valid TS.

2. **Prompt allowlist.** `SYSTEM_PROMPT` in `src/llm/prompt.ts` now
   explicitly enumerates the seven valid `page.getBy*` methods and
   calls out `page.getByURL` by name with "DOES NOT EXIST — for URL
   assertions use `toHaveURL` on the page". Also lists the two valid
   page-level locator factories (`page.locator`, `page.frameLocator`).

Rejecting + warning is strictly better than rendering broken code:
under the old behaviour a single hallucinated step would fail an
entire scenario at runtime with a misleading error. Under the new
behaviour the step shows up as a TODO that the user (or a future LLM
pass) can fix without touching the rest of the spec.

### Tests

`tests/unit/llm.test.ts`:
- `detectHallucinatedLocators` flags `getByURL`, `getByPath`,
  `getByHref`, `getByLink`; passes the seven valid methods unchanged;
  picks up multiple hits in one string; ignores `loginPage.foo.getByURL`
  (we only police `page.*`).
- `parseBindingJson` rejects bindings whose `assertion.locator`,
  `customBody`, or `pomCall.args` reference a hallucinated method.
- `parseBindingJson` still accepts bindings that only use real
  methods (regression-guard against an over-eager allowlist).

## [2.2.2] — 2026-05-09

### Fixed — four cloud-jobs production bugs

Four distinct emitter / LLM-output defects surfaced across
`r-4-f3-a50-d9-*.spec.ts` runs. None block the test suite from running;
each one silently produces wrong-but-passing or wrong-and-crashing code.

#### 1. Bare `context.clearCookies()` → `ReferenceError`

LLM occasionally emits `await context.clearCookies()` (and similar
`browser.*` calls) for "no session cookies" / "in a clean browser"
steps. The Playwright test fixture only injects `page`, so bare
`context`/`browser` is a `ReferenceError` at the first spec line.

**Fix (defence in depth):**
1. New `rewriteBareContext(s)` helper in `src/llm/anthropicClient.ts`
   that maps `\bcontext.X` → `page.context().X` and
   `\bbrowser.X` → `page.context().browser().X`. Applied to
   `customBody` and `assertion.locator` during JSON parse.
2. SYSTEM_PROMPT updated to instruct the LLM to use
   `page.context()` directly. Belt + suspenders.

Conservative rewriter — only matches word-boundary `context.` (so
`pageContext`, `setupContext`, field names with "context" substring
are left alone).

#### 2. English prose slugified into URL regex

Steps like `user remains on login page without any redirect`
were producing `new RegExp("login[-_/]?page[-_/]?without[-_/]?
any[-_/]?redirect")` which never matches a real URL, so the assertion
silently passed (timeout = false-positive pass when running against
the wrong URL).

**Fix:** new `looksLikeProse(target)` heuristic in
`src/transformers/stepNormalizer.ts`. Rules 10 / 11b / N4 / N5e now
call it on the captured page-name target and emit a `// TODO:` with a
clear warning instead of a wrong-but-silent regex when:
- More than 5 whitespace-separated tokens.
- Any of "without", "with", "any", "and", "or", "the", "after",
  "before", "while", "where", "when", "via" appears twice or more.
- Any "redirect" / "redirected" / "redirection" form appears
  anywhere.

The bias is intentionally conservative — when in doubt, abandon the
slug and force the user to supply a real path fragment.

#### 3. `URL contains a path segment 'X'` matched no rule

The LLM dialect "the current URL contains a path segment 'X'"
(verb form of `URL contains 'X'`) didn't match rule 11a's pattern,
which required the quoted value immediately after `contains`. Step
fell through to LLM, LLM then emitted
`page.getByText("X").first().toContainText("X")` — testing the URL
fragment against page TEXT content rather than the browser address
bar. Half-meaningful, totally wrong matcher.

**Fix:** rule 11a's regex extended to accept an optional
`(?:(?:a|the)\s+)?(?:path\s+|url\s+)?(?:segment\s+|fragment\s+|part\s+)?`
between `contains\s+` and the quoted value. All four forms now match:
- `URL contains "X"` (original)
- `Page URL contains the path "X"` (v2.2.2)
- `the current URL contains a path segment "X"` (v2.2.2)
- `URL contains a fragment "X"` (v2.2.2)

All resolve to `expect(page).toHaveURL(new RegExp("X"))`.

#### 4. LLM emitted assertion when the step described user input

Steps like `I enter "MySecret123" as the password` were being emitted
as `expect(...).toBeVisible(...)` instead of `passwordInput.fill(...)`.
Resulting spec asserts the value is visible before any fill happened →
test passes when the value happens to be a substring of any rendered
text on the page.

**Fix:** SYSTEM_PROMPT now explicitly instructs the LLM: when a step's
verb is `enter`, `type`, `fill`, `paste`, `set`, `use`, `supply`,
`provide`, or `login as`, emit a `pomCall` or `customBody` with a
`.fill()`/`.click()` call. Never an assertion.

#### Tests

- `tests/unit/stepMatcher.test.ts` — 6 new tests under
  `v2.2.2 — URL contains 'a path segment X' dialect` and
  `v2.2.2 — prose-as-URL-slug guard`.
- `tests/unit/llm.test.ts` — 2 new tests for `rewriteBareContext` and
  the parser-level `customBody` rewrite.

#### Known limitation (bug #5 from the report — deferred)

`getByText("Congratulations").first()` matched a help-text list item
on the LOGIN page mentioning "Congratulations" rather than the
post-login success banner. This is a locator-scoping problem that's
hard to solve at generation time without knowing the page-state at
runtime. Documented in BDD_REVIEW.md for now; v1.3 roadmap item is
locator scoping via container-aware picker (the locator picker would
prefer a parent scope like `page.locator("main").getByText(...)`
when the field is post-action).

#### Files

- Modified: `src/llm/prompt.ts` (SYSTEM_PROMPT additions),
  `src/llm/anthropicClient.ts` (rewriteBareContext + parser call site),
  `src/transformers/stepNormalizer.ts` (looksLikeProse),
  `src/transformers/stepMatcher.ts` (rule 11a regex extension + prose
  guard in rules 10/11b/N4/N5e),
  `tests/unit/stepMatcher.test.ts` (+6 tests),
  `tests/unit/llm.test.ts` (+2 tests).

#### Migration from 2.2.1

Pure bug fix — no API change. Bump the dep pin to `^2.2.2`.

## [2.2.1] — 2026-05-09

### Fixed — heal Proxy broke `expect(locator).toMatcher(...)` (HIGH, launch-blocker)

bdd2pw 2.2.0's action-time healing wrapped every POM-field Locator in a
`new Proxy(...)` for healable-method interception. Playwright's
`expect(loc).toBeVisible()` (and every other `LocatorMatchers`) does a
private-field probe (`#frame`, `Symbol.toStringTag`, etc.) that doesn't
survive a generic Proxy — so every spec that asserted against a POM
field died synchronously with:

```
Error: toBeVisible can be only used with Locator object
```

100 % test fail rate on any spec calling `expect()` on a POM field.

**Fix:** replaced the Proxy with **direct instance mutation** in
`templates/heal.ts.tmpl` (heal helper bumped to v1.2.1):

```ts
// Before (v1.2): wrap in Proxy → identity check fails
const proxy = new Proxy(original, { get(target, prop) {...} });
return proxy;

// After (v1.2.1): mutate own properties → identity preserved
for (const method of HEALABLE_METHODS) {
  const origFn = (original as any)[method];
  if (typeof origFn !== "function") continue;
  (original as any)[method] = async function (...args) {
    if (healedLocator) {
      return await (healedLocator as any)[method].apply(healedLocator, args);
    }
    try { return await origFn.apply(original, args); }
    catch (err) { /* heal-and-retry, identical to v1.2 */ }
  };
}
return original;
```

The healing logic (POST `/api/v1/heal`, retry with candidate, log
`heal_attempt` / `healed` / `heal_unavailable`) is byte-identical. Only
the wrapping mechanism changed.

#### What this preserves vs v1.2

| Property | v1.2 (Proxy) | v1.2.1 (mutation) |
|---|---|---|
| Action-time healing on `.click`/`.fill`/etc. | ✓ | ✓ |
| Once-cached candidate reused on subsequent calls | ✓ | ✓ |
| `await loc.click()` works | ✓ | ✓ |
| `await expect(loc).toBeVisible()` works | ❌ | ✓ |
| `loc instanceof Locator` | partially | ✓ |
| Private-field probes (`#frame`) | ❌ | ✓ |
| Non-healable methods (`.locator()`, `.first()`) untouched | ✓ | ✓ (prototype delegation) |

#### Files

- Modified: `templates/heal.ts.tmpl` (the `wrapLocatorForHealing`
  function + doc comments at top + version bump v1.2 → v1.2.1).

#### Migration from 2.2.0

Pure bug fix — no API change. Just bump the dep pin to `^2.2.1`.

Cloud-jobs-template runs that were failing 100% on
`expect.toBeVisible can be only used with Locator object` will now go
green (or fail honestly on real test logic). Action-time healing
continues to work the same way for failed `.click()` / `.fill()` /
etc.

## [2.2.0] — 2026-05-08

### Fixed — LLM fallback hung 8+ minutes in cloud-job containers (HIGH, launch-blocker)

A cloud-jobs run with `--llm anthropic` would emit one `scaffold start`
log line and then hang silently until the 8-minute container timeout
killed it. **No diagnostics, no governance hits, no Anthropic completions.**
Disabling `--llm` restored function but reverted every unmatched step to
silent `// TODO:` no-ops — defeating the entire 2.0+ feature.

**Four root causes, all fixed in this release:**

1. **Cache fallback was silent.** When `better-sqlite3`'s native binding
   couldn't load and we degraded to in-memory cache (the v2.0.2 fix
   path), the `error` log event was emitted but the LLM client's `log`
   callback was hard-coded to `() => {}` no-op. Operators couldn't see
   that the cache fell back. **Fix:** scaffold() now wires bdd2pw's
   pino logger into the LLM client's `log` callback. New
   `cache_fallback` LLMLogEvent kind fires once when the SQLite load
   fails. Plus every other event (sanitise start/done, provider call
   start/done, binding parsed, step deadline) now appears in the
   structured scaffold log.

2. **Governance `/sanitize` POST had no timeout.** A wedged sidecar
   would block the entire scaffold indefinitely. **Fix:** undici
   `bodyTimeout` + `headersTimeout` set to 15_000 ms (configurable via
   `--llm-governance-timeout-ms`). On expiry, governance throws and
   the LLM call is REFUSED (fail-closed); the step lands as TODO with
   "(LLM fallback also failed: governance unreachable)".

3. **Anthropic SDK call had no per-call timeout.** The SDK's default
   timeout is 10 minutes — far too long for a scaffold loop with
   dozens of steps. **Fix:** pass `{ timeout: 30_000 }` to
   `anthropic.messages.create(...)` (configurable via
   `--llm-provider-timeout-ms`).

4. **No step-level watchdog around the whole LLM fallback path.** Even
   with #2 and #3 in place, a hang anywhere else (cache lookup stalled
   on disk, governance fetch stalled below the SDK, JSON parse
   pathology) would still deadlock. **Fix:** `matchStepWithLLM` now
   wraps `llm.generateBinding()` in `Promise.race` against a 60_000 ms
   deadline (configurable via `--llm-step-timeout-ms`). On expiry, the
   step lands as TODO with "(LLM fallback also failed: step deadline
   exceeded after Nms)" and the scaffold proceeds to the next step.

#### Acceptance test (production scenario)

A scaffold of a 10-step feature where the governance sidecar deliberately
returns 200 OK after 5 minutes (or never) now finishes in ≤90 seconds
with all 10 steps marked TODO. No 8-minute hangs.

#### New CLI flags

| Flag | Default | Bug-report mapping |
|---|---|---|
| `--llm-step-timeout-ms <n>` | `60000` | Outer step-level watchdog (#4) |
| `--llm-provider-timeout-ms <n>` | `30000` | Anthropic SDK per-call timeout (#3) |
| `--llm-governance-timeout-ms <n>` | `15000` | Governance `/sanitize` timeout (#2) |

### Added — action-time self-healing (Proxy-wrapped Locator) — heal.ts.tmpl v1.2

`healOrThrow(page, opts)` now returns a `Proxy`-wrapped Playwright Locator
instead of the bare `opts.preferred`. The Proxy intercepts every
healable action method (click, fill, check, selectOption, hover, focus,
waitFor, textContent, isVisible, …) and on the FIRST failure for a
given Locator instance:

  1. Logs `heal_attempt` to `artefacts/heal-events.jsonl`.
  2. POSTs `/api/v1/heal` to the configured `SELF_HEALING_URL` with the
     original selector + truncated error message.
  3. If the service returns `{selector, confidence}`, retries the same
     action on `page.locator(selector)`.
  4. On success, logs `healed` and caches the candidate so subsequent
     calls on the SAME Locator instance use it transparently.
  5. On failure (no service, no candidate, or candidate fails too),
     logs `heal_unavailable` and re-throws the ORIGINAL error so the
     test fails honestly.

The proxy adds zero overhead on the happy path — every method call
forwards unchanged; the try/catch only fires when Playwright rejects.

### Added — `scenario_name` on every heal-event JSONL line (P2 Issue 3)

`healOrThrow` now records the current scenario via Playwright's
`test.info().title` whenever it's available (best-effort — falls back
to `null` outside the test lifecycle, e.g. fixture setup). Replaces
the previous "<unknown scenario>" buckets in the TestForge AI
Healings tab.

## [2.1.0] — 2026-05-08

### Changed — wrap every Gherkin step in `await test.step(...)`

bdd2pw used to render each Gherkin step as a leading `// keyword text`
comment followed by a single statement (POM call, assertion, or
`// TODO:` for unmatched). Playwright's JSON reporter could only see the
test as a whole, so the downstream Scenarios tab in TestForge AI showed
a single PASS/FAIL pill per scenario — and cheerfully reported PASS for
scenarios where 4 of 6 steps had silently degraded to TODO no-ops.

Starting with 2.1.0 every binding is emitted as

```ts
await test.step("Given user is on login page", async () => {
  await loginPage.goto();
});
```

Playwright's JSON reporter now emits one entry per step inside
`results[].steps[]`, with `error` populated on failure. This is the
foundation of the **Scenarios tab honesty** feature: the platform UI
can render an expandable per-step table with passed/failed/skipped
pills, and customers see truthful per-step outcomes.

### Added — `[SKIPPED]` prefix on unmatched steps

When no rule, snapshot match, or LLM provider produces a binding for a
Gherkin step (the classic `// TODO: no rule matched` case), the test.step
name is now prefixed with `[SKIPPED] ` and the body remains a no-op
`// TODO:` comment. Playwright sees the step run and pass (the body
does nothing); `pw-to-cucumber.js` detects the `[SKIPPED] ` prefix and
rewrites the cucumber.json status to `skipped` so the Scenarios tab
shows the step in grey instead of green.

### Migration notes

- POM instantiation (`const loginPage = new LoginPage(page);`) stays
  OUTSIDE any test.step wrapper — it's scaffolding, not part of the
  Gherkin scenario.
- Existing `// keyword text` comment lines are GONE. Tools/CI checks
  that grep for `// When user enter ...` should look for
  `await test.step("When user enter ..."` instead.
- Test rendering is otherwise byte-identical post-dedent: each
  binding's existing TS line(s) are now indented one extra level
  inside the `async () => { ... }` arrow.

## [2.0.2] — 2026-05-08

### Fixed — cache-load failure aborted entire LLM fallback (HIGH, launch-blocker)

When `better-sqlite3`'s native binding failed to load (the classic
`NODE_MODULE_VERSION` mismatch in cloud-jobs runs — Playwright base
image with Node 18 trying to use a Node 22-prebuilt binary), bdd2pw
2.0.0 / 2.0.1 silently aborted **the entire `--llm` feature**:

- LLM provider was never called.
- Counter showed `0 successful / 0 attempted`.
- Every unmatched step landed as a `// TODO:` with the cache-load
  error in the warning text.

**Root cause:** `openSqliteCache` only wrapped `require("better-sqlite3")`
in try/catch. The actual native binding loads when the SQLite
constructor runs (`sqlite(cachePath)`), and THAT call's failure escaped
the catch, propagated up through `ensureCache()` → `generateBinding()`
→ `matchStepWithLLM`, and was caught only by the outer "LLM fallback
threw" annotation. The fallback in-memory cache never got installed.

**Fix:** the try/catch in `src/llm/cache.ts` now wraps the FULL SQLite
setup — `require`, `ensureDir`, constructor call, pragma, schema, all
prepared statements. ANY failure falls back to `InMemoryCache`. The
function now returns `{ cache, persistent, fallbackReason }` so callers
can surface the degradation once per scaffold instead of once per step.

```ts
// Before (2.0.0/2.0.1):
let sqlite: any;
try { sqlite = require("better-sqlite3"); } catch { return new InMemoryCache(); }
const db = sqlite(cachePath);  // ← ESCAPED THE CATCH ON NATIVE BINDING FAILURE

// After (2.0.2):
try {
  const sqlite = require("better-sqlite3");
  await fs.ensureDir(...);
  const db = sqlite(cachePath);
  db.pragma(...); db.exec(...);
  // ... full setup ...
  return { cache: realCache, persistent: true };
} catch (err) {
  return { cache: new InMemoryCache(), persistent: false, fallbackReason: err.message };
}
```

### Added — cache-fallback warning surfaced in BDD_REVIEW.md

When the SQLite cache falls back to in-memory, scaffold() now adds a
`[warn]` review item with the underlying reason and a remediation
suggestion (`npm rebuild better-sqlite3 --build-from-source`).
Operators can see at a glance that the cache isn't durable for this
run, instead of silently re-paying full LLM cost on every retry.

```
[warn] LLM cache backend unavailable — fell back to in-memory cache
       for this run. Underlying reason: The module ... was compiled
       against a different Node.js version using NODE_MODULE_VERSION
       127. This version of Node.js requires NODE_MODULE_VERSION 115.
       Bindings won't persist across runs; every scaffold pays full
       LLM cost.
       [suggestion] Run `npm rebuild better-sqlite3 --build-from-source`
       in the consumer repo, OR ensure the prebuild matches the
       runtime Node version (NODE_MODULE_VERSION).
```

The warning fires ONCE per scaffold (not per LLM call) — `cachePersistent`
is cached on the AnthropicLLMClient after the first `ensureCache()` call.

### Added — `LLMClient.cacheBackendPersistent()` and `cacheBackendFallbackReason()`

Two new optional methods on the `LLMClient` interface. The scaffold
review-item generator uses them to drive the warning above. Mock LLM
clients in user tests don't need to implement them (optional).

### Tests

- New: `tests/unit/cacheGracefulDegradation.test.ts` — three cases:
  - `better-sqlite3` mocked to throw the exact NODE_MODULE_VERSION
    error from production. Asserts: openSqliteCache returns
    `persistent: false`, the cache is `InMemoryCache`, fallbackReason
    is populated and is a single line.
  - The fallback InMemoryCache supports get/set/size/close normally.
  - `:memory:` short-circuit still works (no SQLite load attempt).

### Files

- Modified: `src/llm/cache.ts` (try/catch broadened; new `OpenCacheResult`
  return shape), `src/llm/anthropicClient.ts` (cache fallback state
  tracking + new accessors), `src/llm/types.ts` (interface additions),
  `src/index.ts` (review-item warning).
- New: `tests/unit/cacheGracefulDegradation.test.ts`.

### Production impact

Before 2.0.2, any environment where `better-sqlite3` couldn't load the
native binding got **0% LLM coverage** despite paying for the API key,
the governance sidecar, and the deployment plumbing. After 2.0.2, the
LLM works in the same environment with bindings stored in-memory for
the duration of the scaffold run. Cache durability across runs is the
only thing lost; cost goes up but nothing breaks.

### Migration from 2.0.x

Pure bug fix — no API change. Just bump the dep pin.

After 2.0.2 lands, cloud-jobs-template can drop the `npm rebuild
better-sqlite3 --build-from-source` workaround (still useful for
performance — re-running the same .feature gets free cache hits — but
no longer required for correctness).

## [2.0.1] — 2026-05-08

### Fixed — multi-line LLM errors broke `.spec.ts` parse (HIGH)

A multi-line error message bubbling up from the LLM fallback was being
embedded into a `// TODO: ...` single-line comment without escaping, so
only the first line carried the `//` prefix and lines 2-N became parsed
as TypeScript. Result: `SyntaxError: Missing semicolon`, zero tests
collected.

**Reproduction (from cloud-jobs-template):**

1. Playwright base image with Node 18 (`NODE_MODULE_VERSION` 115).
2. `better-sqlite3@^11.0.0`'s npm-published prebuild targets Node 22
   (`NODE_MODULE_VERSION` 127) — incompatible.
3. The cache backend throws on load with a 5-line error.
4. That error string flows into a `// TODO:` comment.
5. The 4 trailing lines fall outside the comment → spec is unparseable.

**Fix:** new `flattenForComment(s: unknown): string` helper in
`src/utils/commentSafe.ts`. Collapses CR/LF runs into ` | ` separators,
trims, returns a single-line string safe for embedding inside a
`// ...` TS comment.

Applied at three sites:

1. `src/llm/llmStepMatcher.ts` — when LLM `result.error` is non-null.
2. `src/llm/llmStepMatcher.ts` — when `generateBinding()` itself throws.
3. `src/emitters/facade.ts` — defensively, before EVERY `// TODO:` line
   gets emitted. This is the belt-and-suspenders catch — any future code
   path that ever puts a multi-line warning into `StepBinding.warning`
   is also covered.

```ts
// Before:
out.push(`// TODO: ${b.warning ?? "no rule matched this step"}`);
// After:
const safeWarning = flattenForComment(b.warning ?? "no rule matched this step");
out.push(`// TODO: ${safeWarning}`);
```

### Fixed — LLM call counter only counted successes

`LLM fallback: 0 provider call(s) made` was being logged even when the
fallback attempted (and failed) on every step. Counter only incremented
on a parsed binding. Operators couldn't tell from the scaffold log
whether the LLM was being called at all.

**Fix:** new `attemptsCounter` increments BEFORE the `await` to provider.
Budget enforcement now runs against attempts (so a run hitting 50
consecutive failures stops, instead of looping forever). The scaffold
review-item line now reads:

```
LLM fallback: 7 successful / 9 attempted (2 failed), max 50. Cache hits counted as 0.
```

`LLMClient.callsAttempted()` is a new optional method on the interface;
older callers keep working unchanged.

### Tests

- New: `tests/unit/commentSafe.test.ts` — 8 cases including the exact
  better-sqlite3 mismatch error from the cloud-jobs report.
- Extended: `tests/unit/llm.test.ts` — two new cases that script
  multi-line errors through both the `result.error` path and the
  `throw` path; assert the resulting `StepBinding.warning` has zero
  newlines.

### Files

- New: `src/utils/commentSafe.ts`, `tests/unit/commentSafe.test.ts`.
- Modified: `src/llm/llmStepMatcher.ts`, `src/llm/anthropicClient.ts`,
  `src/llm/types.ts`, `src/emitters/facade.ts`, `src/index.ts`,
  `tests/unit/llm.test.ts`.

### Migration from 2.0.0

Pure bug fix — no API change. Just bump the dep pin.

## [2.0.0] — 2026-05-08

### Added — LLM fallback for unmatched steps

When a Gherkin step doesn't match any of bdd2pw's 30 deterministic rules,
v2.0 can defer to an LLM (Anthropic Claude) to produce the binding instead
of dropping to TODO. Off by default — opt in with `--llm anthropic`.

#### Why a major version bump

This is the largest feature shipped since v1.0.0. Existing flags and
emitter shapes are unchanged (no breaking API), but adding LLM coverage
fundamentally changes what bdd2pw is: a deterministic scaffolder with an
optional probabilistic safety net. The semver impact is more honest as a
major bump than as 1.2.0.

Existing rule-based behaviour is **identical** when `--llm` is off, so
upgrading from 1.1.7 → 2.0.0 without `--llm` is a true no-op.

#### How it works

```
                   matchStep (rules) ─┐
                                      ├─→ binding ✓ (no LLM call)
                                      │
unmatched step ────────────────────────┤
                                      │
                   matchStepWithLLM ──┴─→ cache lookup
                                              │
                                              ├─→ hit  → cached binding ✓
                                              │
                                              └─→ miss → governance /sanitize
                                                            │
                                                            ├─→ Anthropic API
                                                            │     (temp=0,
                                                            │      JSON output)
                                                            │
                                                            ├─→ parse → StepBinding ✓
                                                            │
                                                            ├─→ cache
                                                            │
                                                            └─→ append to
                                                                artefacts/
                                                                candidate-rules.jsonl
```

Every successful LLM-binding is logged to
`<repo>/artefacts/candidate-rules.jsonl` so a separate offline review
pipeline can propose new deterministic rules. **Auto-write back into
`stepMatcher.ts` is deferred to v2.1** — for v2.0 the LLM is a runtime
overlay, never a code generator for the matcher itself. The review queue
keeps a human in the loop on regex changes.

#### New CLI flags

| Flag | Purpose | Default |
|---|---|---|
| `--llm anthropic` | Enable LLM fallback (provider). v2.0 ships only Anthropic; OpenAI/Gemini in v2.1+. | off |
| `--governance-url <url>` | ai-governance sidecar — sanitises prompts before they leave the perimeter. Fail-closed. | http://localhost:4900 |
| `--llm-model <model>` | Override Anthropic model. | claude-sonnet-4-6 |
| `--llm-max-calls <n>` | Cost guardrail per scaffold. Cache hits don't count. | 50 |
| `--llm-cache <path>` | SQLite cache file. Pass `:memory:` for one-shot. | `<repo>/.bdd2pw/llm-cache.sqlite` |
| `--llm-skip-governance` | Test-only escape hatch. Production runs MUST keep this off. | false |

The `--governance-url` default changed from `http://localhost:8004` (the
SCOPE.md guess) to `http://localhost:4900` (the actual port the sidecar
runs on per `ai-governance/service/app.py`).

#### Cost / determinism guardrails (must-have)

- **SQLite cache** keyed by `hash(model + step text + POM signature)`. Same
  inputs across runs return the same binding — cost goes to zero on
  re-runs, plus determinism is restored despite the LLM being
  non-deterministic by nature.
- **Max-calls guard** stops a single scaffold from spending more than the
  configured budget. Default 50.
- **Temperature 0** at the provider call site — same input → same output
  within Anthropic's deterministic guarantee.
- **Soft-fail.** Any LLM error (rate limit, network, malformed JSON,
  governance unreachable) returns the original rule-matcher warning with
  the LLM error appended. The scaffold completes; the affected step lands
  as `// TODO` in the spec.

#### Governance integration

Per SCOPE FR-10, the `ai-governance` sidecar's `/sanitize` endpoint
scrubs every LLM prompt before it leaves the perimeter. v2.0
**fail-closed** — if the sidecar is unreachable, the LLM call is REFUSED
and the step falls back to TODO. We don't leak unsanitised payloads.

A test-only `--llm-skip-governance` flag exists for unit tests where the
prompt is synthetic and the sidecar isn't running. Production must NEVER
use it.

#### What `candidate-rules.jsonl` looks like

```jsonl
{"ts":"2026-05-08T11:42:00Z","scaffoldId":"scaffold-1715169720000-x7k2","stepText":"the user activates the boost mode","stepKeyword":"When","binding":{"step":{"keyword":"When","text":"the user activates the boost mode"},"pomCall":{"page":"loginPage","method":"boostButton.click","args":[]}},"pomSignature":{"className":"LoginPage","fieldNames":["usernameInput","passwordInput","boostButton"],"methodNames":[]},"provider":"anthropic","model":"claude-sonnet-4-6","fromCache":false}
```

The offline review pipeline (separate repo, not part of bdd2pw) consumes
these to propose new rules via PR.

#### What's NOT in v2.0

- **OpenAI / Gemini providers** — v2.1.
- **Auto-write rules back to `stepMatcher.ts`** — v2.1+. Risk of regex
  collisions with existing rules; needs a corpus and a regression-test
  framework first. Review queue is the safe interim.
- **LLM streaming responses** — bindings are tiny (a few hundred tokens),
  no need.
- **Multi-tenant key management** — single API key per process via
  `ANTHROPIC_API_KEY` env var.
- **Auto-promote frequently-cached entries to deterministic rules** —
  v2.1 stretch.

#### Files

- New: `src/llm/types.ts`, `src/llm/prompt.ts`, `src/llm/cache.ts`,
  `src/llm/candidateRules.ts`, `src/llm/governanceClient.ts` (replaces
  Phase-4 stub), `src/llm/anthropicClient.ts`,
  `src/llm/llmStepMatcher.ts`, `src/llm/index.ts`.
- New: `tests/unit/llm.test.ts` — MockLLMClient + parseBindingJson +
  matchStepWithLLM coverage.
- Modified: `src/types.ts` (`ScaffoldOptions.llmConfig`), `src/cli.ts`
  (5 new flags + actual wiring), `src/index.ts` (scaffold() now async-iterates
  steps when an LLM client is present).

#### Migration from 1.1.x

Upgrade is no-op when `--llm` is unset. The legacy top-level `llm` field
on `ScaffoldOptions` is kept for backwards compatibility — passing
`{ llm: "anthropic" }` to the programmatic API now wires up a real LLM
client (it was previously a no-op).

To enable in cloud-jobs-template:

```bash
bdd2pw scaffold ./feature.feature \
  --url https://app.example.com \
  --page LoginPage \
  --repo ./out \
  --llm anthropic \
  --governance-url http://localhost:4900
```

Make sure `ANTHROPIC_API_KEY` is set in the runner's environment.

## [1.1.7] — 2026-05-07

### Fixed — N5d 'is on page "URL"' (no 'at') fell through to TODO

LLM produces three variants of the same Background-style precondition:

```
Given the user is on the login page                                   ← matched (N5d, 1.1.4)
Given the user is on the login page at "https://example.com/login"    ← matched (N5d, 1.1.3)
Given the user is on the login page "https://example.com/login"       ← TODO (1.1.6)
```

The third form — quoted URL appended directly without the word "at" — was
dropping to TODO. No correctness impact in practice (cloud-jobs-template
injects a clean `Given I am on the login page` Background at the top of
every feature, which matched rule 1 → goto), but it filled
`BDD_REVIEW.md` with noise that obscured real issues.

Fix: inside N5d's optional URL group, the word "at" is now also optional:

- Before: `(?:\s+at\s+["']([^"']+)["'])?`
- After:  `(?:\s+(?:at\s+)?["']([^"']+)["'])?`

All three forms above resolve to `goto()`.

### Tests

- `tests/unit/stepMatcher.test.ts` +1 test:
  `the user is on the login page "URL"` → goto.
  Existing `at "URL"` and bare-page tests still pass (regression).

## [1.1.6] — 2026-05-07

### Fixed — subject-less 'Enter "X" in the field' fell through to TODO

Rule 2a (Input with explicit value + field) required a `${SUBJ}` prefix
(`I` / `User` / `the user`). Cloud-jobs-template runs against the LLM
stack with cache OFF surfaced subject-less variants like:

```
When Enter 'student' in the username field
And  Enter 'Password123' into the password field
```

These hit no rule and silently passed (no fill, no failure). Same fix
shape as v1.1.5 applied to rule 2b — wrap `${SUBJ}` in
`(?:${SUBJ}\s+)?` so all four shapes match equivalently.

| Form | Status before 1.1.6 | Status after 1.1.6 |
|---|---|---|
| `I enter "alice" into the username field`   | ✅ rule 2a | ✅ rule 2a |
| `User enters "alice" into the username field` | ✅ rule 2a | ✅ rule 2a |
| `Enter 'alice' in the username field`         | ❌ TODO    | ✅ rule 2a |
| `Enter "alice" into the password field`       | ❌ TODO    | ✅ rule 2a |

### Fixed — descriptive parentheticals leaked into URL slug regexes

Rules 10 (remains-on), 11b (redirected-to), N4 (URL doesn't change),
and N5e (NOT redirected away) all slugify a captured page-name
description into a URL regex. Production runs hit:

```
Then User is redirected to logged-in page (URL changes away from login page)
And  user remains on login page (URL does not change away from login page)
```

The end-anchor `(?: page)?$` in those rules doesn't fire when the string
ends in `)`, so the entire parenthetical was being captured as part of
the description. Slug became
`/logged-in[-_/]?page[-_/]?\(URL[-_/]?changes[-_/]?away.../`
which never matches a real URL — assertion silently failed in a way that
cucumber reported as pass-with-warning rather than actionable failure.

Added `stripParentheticals()` helper and `cleanSlugTarget()` combiner
that strips parentheticals + articles + trailing ` page`, applied to
all four affected rules. Rule 11a (`(URL contains 'X')`) still runs
first and still extracts authoritative URL fragments — only descriptive
parentheticals fall through to the cleaned slugifier.

### Tests

- `tests/unit/stepMatcher.test.ts` +7 new tests under
  `v1.1.6 — subject-less 'Enter ...'` and
  `v1.1.6 — parenthetical prose in URL slug rules`:
  - subject-less `Enter 'X' in the username field`
  - subject-less `Enter "X" into the password field`
  - regression: subject-prefixed `I enter "X" in ...` still matches
  - rule 11b: parenthetical stripped, slug = `logged-in`
  - rule 10: parenthetical stripped, slug = `login`
  - rule N5e: parenthetical stripped, slug = `login`
  - regression: rule 11a still wins for authoritative parentheticals

### Why this matters

Today's cloud-jobs-template runs went 14/14 → 2/8 between two
consecutive runs of the same job because the LLM picked different
phrasings (`in` vs `into`) and added descriptive parentheticals to
redirect assertions. Pairing this release with TCG temperature=0 and
re-enabled response cache should stabilise pass-rate run-to-run.

## [1.1.5] — 2026-05-05

### Fixed — subject-less compact 'enters password "X"' form

LLM produces compact verb-first input forms freely:
```
And enters password "Password123"
When enters username "alice"
And types the password "secret"
```

Rule 2b previously required a `${SUBJ}` prefix (`I` / `User` / `the user`).
The compact form was hitting TODO. Rule 2b's SUBJ is now optional via
`(?:${SUBJ}\s+)?`, so all four shapes match the same way:

| Form | Status before 1.1.5 | Status after 1.1.5 |
|---|---|---|
| `I enter username "alice"` | ✅ rule 2b | ✅ rule 2b |
| `User enters username "alice"` | ✅ rule 2b | ✅ rule 2b |
| `the user enters username "alice"` | ✅ rule 2b | ✅ rule 2b |
| `enters password "Password123"` | ❌ TODO | ✅ rule 2b |
| `And enters username "alice"` | ❌ TODO | ✅ rule 2b |

#### Why this is a one-line change

The fix is purely the regex prefix:
- Before: `^${SUBJ} (?:enter|enters|...) (?:the )?(.+?) ["']([^"']*)["']$`
- After:  `^(?:${SUBJ}\s+)?(?:enter|enters|...) (?:the )?(.+?) ["']([^"']*)["']$`

The build function is unchanged — same `fillFieldBinding(...)` flow.
Existing rule 2a (`I enter "X" into the field`) still claims its territory
because its pattern has `["']<value>["']` early; the subject-less compact
form ends with the value, which only matches rule 2b's structure.

#### Known limitation (deferred)

The vague form `user enters valid password` (no quoted value) is still a
TODO. Without a value, we can't generate a working `.fill()` call. A human
has to provide the credentials. This is a generation-input gap, not a rule
gap — adding a TODO with explanatory comment would be misleading.

#### Tests

- `tests/unit/stepMatcher.test.ts` +4 new tests under
  `v1.1.5 — subject-less 'enters <field> "V"'`:
  - subject-less `enters password "X"`
  - subject-less `enters username "X"`
  - regression: subject-prefixed `User enters username "X"` still matches
  - subject-less `types the password "X"` (alt verb + article)

#### Files

- Modified: `src/transformers/stepMatcher.ts` (rule 2b regex prefix only).
- Modified: `tests/unit/stepMatcher.test.ts` (+4 tests).

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
