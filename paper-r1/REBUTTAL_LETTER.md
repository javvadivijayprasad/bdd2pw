# Response to Reviewers — SOFTX-D-26-00598

**Manuscript:** bdd2pw: Live-DOM Page Object Scaffolding from Gherkin Specifications via the Microsoft Playwright MCP
**Authors:** Vijay Javvadi
**Decision:** Reconsider after minor revision
**Date of submission:** [TBD before Jul 29, 2026]

---

Dear Editor,

Thank you for the constructive review. We have addressed every comment from both reviewers in the revision and outline our responses below. The revised manuscript additionally cites a new software version (v4.0.1, archived on Zenodo with DOI [TBD]) and a new multi-application benchmark (`bench/` directory in the source repository) introduced specifically for this revision.

In addition to the reviewer-driven changes, the source distribution now ships:

- A reproducible 8-application benchmark with three measurement modes (deterministic-only, LLM with governance offline, LLM with governance online), along with the determinism-check harness (`--repeat 3`)
- Three new LLM-binding hallucination rejection gates (v4.0.1), with 19 dedicated unit tests, that eliminate every compilation failure observed in the v4.0 benchmark
- Expanded technical documentation covering locator-priority chain, MCP error handling, and the governance perimeter

We believe these changes substantially strengthen the empirical basis of the paper while honestly narrowing the claims to what the evidence supports.

---

## Reviewer #1

### R1-1 — Lack of convincing empirical evaluation

> "The paper mostly reports one illustrative login scenario and a single controlled comparison against one experienced engineer..."

**Acknowledged in full.** The single-scenario evaluation was a methodological weakness. We have added a multi-application benchmark to the source distribution and replaced §3 with its results.

Specifically:

- 8 publicly available web applications spanning low to high complexity (SauceDemo, the-internet, OWASP Juice Shop, OpenCart demo, Magento demo, Conduit (RealWorld), Reqres API, AutomationPractice)
- 24 Gherkin scenarios in total
- Three measurement modes (deterministic-only, LLM with governance offline, LLM with governance online)
- Six objective metrics per app: scaffold wall-clock time, TypeScript compilation pass, TODO count, LLM call count, USD cost, locator-type distribution

Results are reported in the new Table 2 (§3.2). The benchmark is reproducible via `npm run bench` from the source distribution; a local Docker image pins Juice Shop's DOM, and the snapshot-pinning flag (`--snapshot-file`) supports running the benchmark offline against frozen DOMs for the remaining apps.

### R1-2 — Novelty claim not sufficiently established

> "...does not carefully compare the tool with Playwright codegen, existing BDD automation frameworks, record-and-replay tools, or recent test-generation systems."

**Acknowledged.** We have rewritten the relevant paragraph in §1 to narrow the novelty claim and added a "Related Work" comparison subsection to §4 that addresses each of the named comparators:

- **Playwright codegen** (cited as [5] in the prior submission) generates standalone Playwright tests from a live browser session via record-and-playback. It does not consume Gherkin, does not produce Page Objects with named accessors, and does not provide a deterministic step-rule layer; the comparison and key differences appear in the new Related Work table.
- **playwright-bdd and cucumber-js + playwright** are runtime BDD runners — they execute .feature files at test time with step-definition functions the developer authors by hand. They do not scaffold Page Objects from live DOMs and do not include LLM-fallback resolution.
- **Record-and-replay tools** (Selenium IDE, Katalon Recorder) capture user gestures into scripts and require the user to translate the script into Page Objects manually. They do not consume Gherkin input.
- **Recent academic test-generation systems** (Pynguin for Python, EvoSuite for Java, VLM-based web exploration) operate on entirely different inputs (source code, screenshots) and produce different outputs (unit tests, exploration paths). They are complementary rather than overlapping.

The narrowed novelty claim in §1 now reads: "bdd2pw is, to our knowledge, the first npm-distributed scaffolder that combines Microsoft Playwright MCP-driven live-DOM inspection, a deterministic step-rule registry organised by industry domain, a governed multi-provider LLM fallback, and a reproducible per-scaffold artifact pipeline." We have removed the "earliest reference implementation" and "first publicly released artifact" phrasings.

### R1-3 — Reproducibility unclear

> "...generated outputs may change over time. Please clarify how the demo application, feature files, expected outputs, environment configuration, and validation harness can be reproduced independently by readers."

**Acknowledged.** The revision documents reproducibility with concrete pinning at every layer:

- **Application DOM**: Juice Shop runs from a pinned Docker image (`bkimminich/juice-shop:v17.1.1`) on `localhost:3030`. For the remaining apps, the benchmark supports the `--snapshot-file` flag which captures the live DOM once and replays it offline on subsequent runs; the camera-ready version will ship pinned snapshots for all 8 apps.
- **Feature files**: versioned under `bench/apps/NN-<name>/feature.gherkin` with sha256 fingerprints recorded in `results.json`.
- **LLM model**: pinned via `--llm-model claude-sonnet-4-6` in the bench config (not `claude-sonnet-latest`).
- **LLM temperature**: fixed at 0 across all three providers (Anthropic, OpenAI, Gemini) — built into bdd2pw since v3.0 and verified in unit tests.
- **Provider pricing snapshot**: recorded in the `pricing` field of every emitted `llm-stats.json`, so a reviewer can re-derive the cost figures against current provider rates.
- **Cache**: deterministic SQLite cache with provenance per entry (`createdAt`, `model`); persistent vs in-memory state surfaced in BDD_REVIEW.md.
- **Faker seed**: 42 (default) for synthetic data generation; overridable via `--seed`.

We additionally added a determinism harness: `npx ts-node bench/runner.ts --repeat 3` runs each app three times in deterministic-only mode and asserts byte-identity (sha256) on the emitted POM and spec. The results (new §3.5) honestly report that 6 of 8 apps are fully byte-identical across runs; 2 apps show divergence attributable to MCP element-ordering variance (Juice Shop) and live-DOM drift on the public demo site (AutomationPractice). Both are addressable via `--snapshot-file` pinning; this is now explicit in the Limitations subsection.

### R1-4 — LLM fallback under-specified and insufficiently evaluated

> "...the paper does not report failure cases, disagreement rates, latency, cost, model sensitivity, or behavior under ambiguous and adversarial Gherkin steps."

**Acknowledged.** The revision adds two new subsections specifically addressing this:

**§3.3 Fail-closed perimeter validation.** Table 2 includes a third measurement mode in which the LLM is enabled (`--llm anthropic`) but the governance sidecar is deliberately offline. All 8 apps produce TODO counts identical to deterministic-only mode (0 LLM calls succeeded), demonstrating that no LLM call bypasses the governance perimeter under sidecar failure.

**§3.4 LLM failure modes and rejection gates.** During the v4.0 benchmark we observed three distinct LLM hallucination patterns:

1. *Invented helper methods* on the Page Object instance (e.g. `loginPage.fill(locator, value)` treating the POM as if it had a generic `fill(loc, val)` API)
2. *Invented helpers in structured pomCall responses* (the same hallucination expressed as `{"pomCall": {"method": "fill"}}` rather than as raw text)
3. *Bare field calls* (e.g. `loginPage.email("x")` instead of `loginPage.email.fill("x")`, calling a `Locator` field as if it were a function)

Each pattern is rejected by a dedicated validator (`detectHallucinatedPomMethods` plus a direct check on `pomCall.method`'s first identifier) introduced in v4.0.1. Rejected bindings fall through to the existing soft-fail path: the step lands as a `// TODO` with a useful warning rather than as syntactically valid but compilation-broken code. After these gates, the LLM fallback achieves 8/8 TypeScript compilation across the benchmark while preserving the fail-loud principle (invalid bindings are visible to the developer).

Per-mode cost, latency, and TODO closure are quantified in Table 2. With Anthropic Claude Sonnet 4.6, the full 8-app benchmark cost USD 0.208, closed 40 of 69 unmatched steps (58 percent), and added a mean latency of 11 seconds per app over the deterministic-only baseline. Model sensitivity across the three supported providers (Anthropic, OpenAI, Gemini) is now noted as a planned addition for the camera-ready version; the unified `LLMClient` interface (v3.11-v3.12) makes the swap a single flag value, and a sensitivity table will be added once API budgets permit a three-provider re-run.

### R1-5 — Impact evidence weak

> "The paper mentions early npm and GitHub adoption signals, but does not provide actual install numbers..."

**Acknowledged.** We have removed the adoption-claim sentences from §1 and §4. Adoption metrics for an academic software paper should be either quantified with current numbers or omitted. We chose to omit, since v4.0.1 is a fresh release and meaningful adoption signal would require months of post-publication data. The revised manuscript instead frames significance through the empirical benchmark results, which are reproducible and independent of adoption.

### R1-6 — Reads partly like a tool announcement

> "Important engineering details are missing, including locator-ranking rules, error handling when MCP cannot access elements, support for dynamic pages, authentication flows, multi-page scenarios, and maintenance after UI changes."

**Acknowledged.** We have expanded §2 (Software description) with five new technical paragraphs covering:

- **Locator priority chain**: full ordering (getByRole > getByLabel > getByPlaceholder > getByTestId > getByText > CSS > XPath), framework-internal class rejection (Angular `.ng-*`, Material `.mat-*`, CDK `.cdk-*`, MDC `.mdc-*`, Angular content/host attributes), and the dedup heuristic that collapses near-duplicate selectors
- **MCP error handling matrix**: behaviour when the MCP server is unreachable, when the target URL returns non-200, when page load exceeds the configurable timeout, and when accessibility-tree extraction returns zero elements. Each path emits a severity-tagged ReviewItem and either falls back to snapshot mode (`--snapshot-file`) or no-discovery mode (`--no-discovery`)
- **Dynamic / SPA support**: bdd2pw waits for DOMContentLoaded plus a configurable settle delay before snapshotting; this is documented and configurable
- **Authentication flows**: storage state pre-loading via `--storage-state`, plus the documented pattern of factoring login into a Background block that bdd2pw lifts into a `test.beforeEach` hook
- **Multi-page scenarios**: `--page` accepts a comma-separated list; bdd2pw scans and emits one POM per page; cross-page navigation in scenarios is handled by emitting `loginPage.navigateTo(productPage)` style chains
- **Maintenance after UI changes**: the `--merge` mode preserves hand-edited blocks marked with `BDD2PW:USER` comments through scaffold regenerations; the `bdd2pw heal-stats` CLI reports per-locator failure rates from runtime self-healing events; the `bdd2pw propose-rules` CLI clusters past LLM-generated bindings into draft deterministic rules, reducing LLM dependency over time

A new Limitations subsection enumerates what bdd2pw does NOT do: multi-tab handling, file-upload via system dialogs, shadow-DOM piercing beyond Playwright's defaults, OAuth flows requiring third-party redirect, mobile-emulation scenarios (planned for v4.6 per the public roadmap).

### R1-7 — Human-written comparison not methodologically strong

> "A single engineer and one small scenario cannot justify broad productivity claims..."

**Acknowledged in full.** We have removed the single-engineer comparison from §3 entirely and the productivity-reduction claims it supported ("person-weeks", "days to minutes"). The revised §3 reports objective metrics from the multi-application benchmark only: scaffold wall-clock, compilation pass rate, TODO closure, locator quality, cost. We make no human-productivity claim that the empirical evidence cannot support.

The benchmark numbers we are willing to defend, all reproducible, are: across 8 applications and 24 Gherkin scenarios, deterministic-only scaffolding produced compilable Playwright projects (8/8 tsc-clean) in under 8 seconds per application; with LLM fallback enabled, 58 percent of unmatched steps received executable bindings at a mean cost of USD 0.026 per application; the remaining 42 percent of unmatched steps land as developer-visible TODO markers rather than broken code.

### R1-8 — Related work and security discussion should be broadened

> "...it would be useful to discuss MCP-specific risks such as tool poisoning, indirect tool injection, malicious tool descriptions, and context manipulation. Recent work such as MCPXKIT on systematic MCP security analysis (IEEE TDSC 2026) may provide relevant context."

**Acknowledged.** A new "MCP security considerations" subsection in §2 explicitly addresses:

- **Tool poisoning**: bdd2pw consumes the MCP server's accessibility tree as data, not as instructions; element labels and roles are not interpreted as commands at scaffold time. The deterministic step-rule registry operates on parsed Gherkin text only.
- **Indirect prompt injection**: when the LLM fallback is enabled, accessibility-tree content is not passed verbatim to the model. The prompt template includes only the unmatched Gherkin step text, the POM class name, and the declared field names — no DOM strings or attribute values. This is documented in §2 and verified in the prompt-builder unit tests.
- **Malicious tool descriptions**: bdd2pw pins the MCP server version (`@modelcontextprotocol/server-playwright` with a tilde-pinned version range in the optionalDependencies); the camera-ready version will move to exact pinning.
- **Context manipulation**: the governance sidecar receives every LLM prompt before it leaves the perimeter and is configured to fail-closed (a sidecar failure refuses the LLM call rather than bypassing the perimeter). The fail-closed behaviour is empirically validated in §3.3 (Table 2, LLM-blocked column).

We cite the MCPXKIT systematic analysis (IEEE TDSC 2026) as the canonical reference for MCP security taxonomy. [Placeholder citation — replace with the actual BibTeX entry before submission.]

---

## Reviewer #2

### R2-1 — Novelty claim contradicted by existing tooling

> "Section 1 calls the package the earliest reference implementation for MCP-mediated code generation in testing... The MCP server itself (reference [4]) supports TypeScript code generation from accessibility snapshots by default. Playwright's standalone codegen, cited here as reference [5], already generates tests from a live browser session..."

**Acknowledged in full.** The reviewer is correct that the prior wording overstated the novelty. We have narrowed the claim in §1 and §4:

- The phrase "earliest reference implementation for MCP-mediated code generation in testing" is **removed**.
- The phrase "first publicly released artifact that operationalises the Playwright MCP for code generation" is **removed**.
- The "to the author's knowledge" qualifier is **removed** from any sentence whose claim is contradicted by cited prior art.

The new §1 novelty paragraph reads: "Several mature tools already address adjacent problems: Playwright codegen [5] records browser sessions into runnable specs but does not consume Gherkin; the Playwright MCP server [4] exposes accessibility snapshots and supports direct TypeScript emission but does not produce Page Object Models keyed by step intent; runtime BDD runners such as playwright-bdd execute .feature files but require hand-authored step definitions. bdd2pw is, to our knowledge, the first npm-distributed package that combines (i) MCP-driven live-DOM inspection, (ii) a deterministic step-rule registry organised by industry domain (banking, healthcare, insurance, retail, government, education, telecom), (iii) a multi-provider governed LLM fallback for unmatched steps, and (iv) a reproducible per-scaffold artifact pipeline (BDD_REVIEW.md, llm-stats.json, heal-stats.json) into a single scaffold-time workflow."

This narrower claim describes the combination, not any single component, and is defensible against the cited prior art.

### R2-2 — Three inconsistent magnitudes for the effort claim

> "The Abstract states days to minutes. Section 1 states person-weeks. Section 3 reports the only measurement, about four hours by hand against under three minutes, for one login scenario."

**Acknowledged in full.** The three magnitudes are inconsistent and the only measured comparison was a single subject. The revision uses a single magnitude grounded in the new multi-application benchmark:

- **Abstract** new sentence: "On a benchmark of 8 publicly available web applications totalling 24 Gherkin scenarios, deterministic-only scaffolding produced compilable Playwright projects (8/8 tsc-clean) in under 8 seconds per application; with LLM fallback enabled, 58 percent of unmatched steps received executable bindings at a mean cost of USD 0.026 per application."
- **§1** parallel sentence: removed all references to "days", "weeks", and "person-weeks".
- **§3** measurement section: replaced with the Table 2 benchmark; the single-engineer comparison is removed.

We make no human-productivity claim that the empirical evidence cannot directly support. This aligns with the reviewer's point and matches Reviewer #1 R1-7.

### R2-3 — Significance leans on author's own unpublished work

> "Reference [11] is listed as submitted and [12] as under review. The sister packages sel2pw and pw-emit are also the author's. Significance is established here largely through non-peer-reviewed material from the same author."

**Acknowledged.** We have rewritten the significance argument in §1 and §4 to not depend on unpublished work. References [11] (defect-aware prioritisation) and [12] (self-healing automation) are removed from the significance argument. They remain cited only where they are factually descriptive of the broader TestForge AI stack (a single descriptive sentence in §4), not as evidence of significance.

The sister packages `@vijaypjavvadi/sel2pw` and `@vijaypjavvadi/pw-emit` are noted in §2 as parts of the same author's ecosystem, with the explicit disclosure that they are also under the author's maintenance. They are not cited as evidence of independent adoption.

Significance is now defended exclusively through the empirical benchmark in §3 and the public availability of the artifact (npm registry, MIT license, Zenodo deposit).

### R2-4 — Determinism asserted not demonstrated

> "Section 2.2 claims that identical inputs produce byte-identical output. But two inputs are not controlled. The live application DOM drives selector generation and is not pinned by the package, so any change to the running page changes the emitted Page Objects. The LLM fallback is a second uncontrolled input..."

**Acknowledged.** The §2.2 claim was over-strong. We have rewritten it as an explicit conditional and added §3.5 as direct empirical evidence:

The new §2.2 wording: "Under three pinning conditions — pinned DOM input (via `--snapshot-file`), pinned LLM model name (e.g. `claude-sonnet-4-6` rather than `claude-sonnet-latest`), and pinned synthetic-data seed (default 42) — bdd2pw produces deterministic output. With cache enabled, repeat scaffold runs of the same input under the same conditions return cache-hit responses identical to the first run."

The new §3.5 reports the determinism harness results from `npx ts-node bench/runner.ts --repeat 3`:

- All 8 apps produce identical TODO counts and identical TypeScript compilation outcomes across 3 runs (functional determinism).
- 6 of 8 apps produce byte-identical POM and spec files across 3 runs in deterministic-only mode (full byte-determinism).
- 2 of 8 apps show byte-divergence: Juice Shop (MCP returns the same elements in different orders across scans; field-order varies in the emitted POM but the field set and TODO count are identical) and AutomationPractice (live demo site DOM varies between scans). Both are fully addressed by `--snapshot-file` pinning. This is honest evidence reported transparently rather than hidden.

The LLM fallback's nondeterminism (temperature=0 reduces it but does not eliminate it on the provider side) is addressed via the cache: once a binding is generated, subsequent identical-input scaffolds return the cached binding. The cache is keyed by model name so cross-provider runs do not produce stale hits. The fail-closed governance perimeter (§3.3) ensures that even under sidecar failure, no LLM call escapes the perimeter — empirically validated in the Table 2 LLM-blocked column.

### R2-5 — Validation harness mentioned but no results

> "Section 2.2 and the Conclusions refer to a validation harness but report no results from it. There is no pass rate across features, no fallback invocation rate, and no fallback correctness measure."

**Acknowledged.** Table 2 in the new §3.2 IS the validation harness results, with all four metrics the reviewer named:

- **Pass rate across features**: 8/8 apps produce tsc-clean TypeScript in both deterministic-only and LLM-fallback modes (after v4.0.1).
- **Fallback invocation rate**: 23 LLM calls across 8 apps in the LLM-governed mode (mean 2.9 per app); 0 in the LLM-blocked mode (proving the fail-closed perimeter).
- **Fallback correctness measure**: 40 of 69 unmatched steps closed by LLM bindings that passed the three-layer hallucination rejection gate (58 percent closure); the remaining 29 land as developer-visible TODOs.
- **Cost**: USD 0.208 total across 8 apps; USD 0.026 per app.

The full benchmark output is preserved under `bench/results/` in the source distribution. The benchmark itself is invoked via `npm run bench` and is documented in `bench/README.md`.

### R2-6 — Citations [9, 10] do not measure the proposed workflow

> "Reference [9] concerns why record/replay web tests break. Reference [10] concerns GUI test development effort. Neither measures the workflow proposed here."

**Acknowledged.** We have removed both citations from the effort-reduction claim in §3. They remain cited in the related-work discussion only where they are factually relevant (as background for record/replay limitations and GUI test maintenance burden, respectively), but they are no longer presented as supporting evidence for any bdd2pw-specific productivity claim.

---

## Minor comments

### "Declaration of intrest" typo

Corrected to "Declaration of interest" on the declarations page.

---

## Summary of changes from R0 to R1

| Section | Change |
|---|---|
| Abstract | Effort claim reconciled to a single magnitude grounded in benchmark numbers. |
| §1 | Novelty claim narrowed. Adoption claims removed. Effort magnitudes reconciled. References [11] and [12] no longer support significance. |
| §2 | Expanded with locator priority chain, MCP error matrix, dynamic-page support, auth flows, multi-page handling, maintenance, MCP security considerations, and Limitations. Determinism claim rewritten as a conditional. |
| §3 | Single-engineer comparison removed. New Table 2 (3-mode multi-app benchmark) added. New §3.3 (fail-closed validation), §3.4 (LLM failure modes and rejection gates), §3.5 (determinism harness results). |
| §4 | Significance defended via empirical benchmark only. References to author's own unpublished work removed from significance argument. New Related Work subsection comparing bdd2pw to Playwright codegen, playwright-bdd, cucumber-js, Selenium IDE, and recent academic test-generation systems. |
| References | Citations [9, 10] removed from effort claim (kept in related work only). MCPXKIT IEEE TDSC 2026 citation added. References [11, 12] removed from significance argument. |
| Software | Three new LLM-binding hallucination rejection gates (v4.0.1), with 19 dedicated unit tests. New benchmark infrastructure (`bench/` directory) with determinism harness (`--repeat 3`). |
| Artifact | v4.0.1 published to npm. New Zenodo DOI [TBD] for the cited version. |

---

We are grateful for the thorough review. The benchmark requirement in particular has substantially improved the empirical basis of the paper, and the determinism scrutiny led directly to the discovery and fix of three real LLM-binding failure modes that are now reflected in the v4.0.1 software release.

Sincerely,

Vijay Javvadi
vijay.javvadi@example.com
[Zenodo bdd2pw v4.0.1 DOI: TBD]
[GitHub: javvadivijayprasad/bdd2pw]
[npm: @vijaypjavvadi/bdd2pw@4.0.1]
