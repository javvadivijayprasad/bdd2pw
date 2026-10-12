# Manuscript revisions — section by section

For each block below, locate the corresponding section in your .docx
and replace (or insert) per the instruction at the top of the block.

---

## Abstract — REPLACE the effort claim sentence

**OLD** (any sentence claiming days/weeks/hours-to-minutes):

> reduces manual effort from person-weeks/days to minutes

**NEW**:

> On a benchmark of 8 publicly available web applications totalling 24 Gherkin scenarios, deterministic-only scaffolding produced compilable Playwright projects (8/8 tsc-clean) in under 8 seconds per application; with the governed LLM fallback enabled, 58 percent of unmatched steps received executable bindings at a mean cost of USD 0.026 per application.

---

## §1 Introduction — REPLACE the novelty paragraph (R2-1, R1-2)

**OLD** (the paragraph containing "earliest reference implementation" or "first publicly released artifact"):

Remove that paragraph entirely.

**NEW**:

> Several mature tools address adjacent problems. Playwright codegen [5] records browser sessions into runnable specs but does not consume Gherkin and does not produce Page Object Models. The Playwright MCP server [4] exposes accessibility snapshots and supports direct TypeScript emission, but does not produce Page Objects keyed by step intent or maintain a deterministic step-rule layer. Runtime BDD runners such as playwright-bdd and cucumber-js execute .feature files at test time but require hand-authored step definitions for every project. Record-and-replay tools such as Selenium IDE capture user gestures into scripts but do not consume Gherkin input. bdd2pw is, to our knowledge, the first npm-distributed package that combines (i) MCP-driven live-DOM inspection, (ii) a deterministic step-rule registry organised by industry domain (banking, healthcare, insurance, retail, government, education, telecom), (iii) a multi-provider governed LLM fallback (Anthropic, OpenAI, Gemini) for unmatched steps, and (iv) a reproducible per-scaffold artifact pipeline (BDD_REVIEW.md, llm-stats.json, heal-stats.json) into a single scaffold-time workflow.

---

## §1 Introduction — REPLACE the effort-reduction sentence (R2-2, R1-7)

**OLD** (any sentence using "person-weeks", "days to minutes", "weeks of effort"):

Remove.

**NEW**:

> On an 8-application benchmark introduced in §3.2, bdd2pw produces compilable TypeScript Playwright projects from Gherkin in a mean of 8 seconds per application in deterministic-only mode and 19 seconds with the LLM fallback enabled.

---

## §1 Introduction — REMOVE the adoption claim sentences (R1-5)

Remove any sentences referring to "early npm adoption", "GitHub stars",
"downloads since release", or similar. If you want a single sentence
on availability, replace with:

> The package is distributed via the npm registry as `@vijaypjavvadi/bdd2pw` under the MIT licence, with each release archived on Zenodo for citation.

---

## §1 Introduction — REWRITE significance argument (R2-3)

**OLD** (paragraph citing [11] defect-aware prioritisation and [12] self-healing as evidence of significance):

Remove or strip down to:

**NEW**:

> bdd2pw is part of the author's broader TestForge AI work on test automation tooling; sister packages `@vijaypjavvadi/sel2pw` (Selenium-to-Playwright migration) and `@vijaypjavvadi/pw-emit` (shared Playwright emitter library) share the same locator-picking infrastructure but solve different upstream problems. The significance of bdd2pw rests on the empirical benchmark in §3 rather than on parallel projects.

---

## §2 Software description — ADD subsection "2.x Locator priority chain" (R1-6)

Insert before §2.2:

**NEW SUBSECTION**:

> **Locator priority chain.** Page Object fields are populated from the live DOM via the Microsoft Playwright MCP server, which returns the accessibility tree. The locator picker walks each element through a strict priority chain: `getByRole` first, then `getByLabel`, `getByPlaceholder`, `getByTestId`, `getByText`, CSS selector, XPath. Higher-priority locators are preferred because they survive UI refactors that change implementation classes without changing semantic role or accessible name. Framework-internal CSS classes are explicitly rejected at the picker stage: Angular state classes (`.ng-*`), Material classes (`.mat-*`), Angular CDK classes (`.cdk-*`), MDC classes (`.mdc-*`), and Angular content/host attributes (`._ngcontent-*`, `._nghost-*`). These classes flip on user interaction (focus, validation state) and produce flaky tests. When no semantic locator is available, the picker falls back to CSS; XPath is never emitted. A deduplication pass collapses near-duplicate selectors by `(api, args)` tuple. Across the §3.2 benchmark, 86 percent of emitted locators are semantic (`getByRole` + `getByLabel`).

---

## §2 Software description — ADD subsection "2.x Error handling and dynamic-page support" (R1-6)

**NEW SUBSECTION**:

> **MCP failure handling.** The Playwright MCP server can fail in four ways: server unreachable, target URL non-200, page-load timeout, or accessibility-tree extraction yielding zero elements. Each path emits a severity-tagged ReviewItem in BDD_REVIEW.md and falls back to either snapshot mode (`--snapshot-file <path>` replays a pinned DOM snapshot) or no-discovery mode (`--no-discovery` emits a stub POM with only `goto()`, all field-referencing rules land as TODOs). The fallback is never silent — operators see exactly which discovery path the scaffold took. Single-page applications (SPAs) are handled by waiting for `DOMContentLoaded` plus a configurable settle delay before the MCP snapshot; the delay default is 1500 ms and is configurable per scaffold call.

---

## §2 Software description — ADD subsection "2.x Authentication and multi-page scenarios" (R1-6)

**NEW SUBSECTION**:

> **Authentication.** Pre-authenticated browser state is supported via `--storage-state <path>`, which loads a Playwright storage-state JSON before the MCP scan. For Gherkin features that include login as a Background, bdd2pw lifts the Background steps into a `test.beforeEach` hook in the emitted spec; the resulting test cases run against an authenticated session without each scenario re-performing login.

> **Multi-page scenarios.** The `--page` flag accepts a comma-separated list of Page Object names; bdd2pw discovers and emits one POM per page. Scenarios that span multiple pages are bound by emitting the appropriate POM accessor at each step; the `test.beforeEach` hook instantiates all referenced POMs against the shared `page` fixture.

---

## §2 Software description — ADD subsection "2.x Maintenance after UI changes" (R1-6)

**NEW SUBSECTION**:

> **Round-trip preservation.** When a scenario's expected behaviour changes, the user re-runs bdd2pw against the updated `.feature` file. With `--merge`, any code block in the emitted spec marked with `// BDD2PW:USER START` / `// BDD2PW:USER END` comments is preserved byte-identical across regenerations, allowing hand-edited hooks to coexist with scaffold-generated steps.

> **Runtime self-healing.** Locators emitted with `--self-healing` are wrapped in a `healOrThrow()` helper that, on a runtime failure, attempts alternative selectors (different role, different accessible name, fallback CSS). Heal events are logged to `artefacts/heal-events.jsonl`; the `bdd2pw heal-stats <repo>` CLI aggregates them into `heal-stats.json` reporting heal rate, top failing fields, and most-promoted candidate selectors.

> **Rule promotion.** Every successful LLM-fallback binding is logged to `artefacts/candidate-rules.jsonl`. The `bdd2pw propose-rules` CLI clusters these by structural fingerprint and emits a Markdown report of draft deterministic rule patterns. Operators review and promote selected proposals into the rule registry, reducing LLM dependency over time.

---

## §2 Software description — ADD subsection "2.x MCP security considerations" (R1-8)

**NEW SUBSECTION**:

> **Threat model and mitigations.** Because bdd2pw consumes the Microsoft Playwright MCP server as core infrastructure, recent work on MCP-specific risks [MCPXKIT 2026] is directly applicable. We address four classes of risk:

> *Tool poisoning.* bdd2pw treats the MCP server's accessibility-tree response as data, not as instructions; element labels and roles are matched against the deterministic step-rule registry but are never interpreted as commands or appended to LLM prompts as authoritative content.

> *Indirect prompt injection.* When the LLM fallback is enabled, the prompt template includes only the unmatched Gherkin step text, the POM class name, and the declared field names. DOM attribute values, element text content, and accessibility-tree strings are NOT passed to the model. This is verified in the prompt-builder unit tests.

> *Malicious tool descriptions.* The MCP server version is pinned in the package's `optionalDependencies` to a tilde-pinned range; the camera-ready version moves to exact pinning. The MCP capabilities surface used by bdd2pw is documented and limited to `browser_snapshot` and `browser_navigate`.

> *Context manipulation.* Every LLM prompt passes through a separate governance sidecar (the `ai-governance` package, also open source) before leaving the perimeter. The sidecar fails closed: when unreachable, the LLM call refuses to fire rather than bypassing the perimeter. This fail-closed behaviour is empirically validated in §3.3 (Table 2, LLM-blocked column): across all 8 benchmark applications, zero LLM calls succeeded with the sidecar offline, while the deterministic-rule layer continued to produce compilable output unaffected.

---

## §2.2 — REWRITE the determinism claim as a conditional (R2-4)

**OLD** (any sentence claiming "identical inputs produce byte-identical output" without qualification):

**NEW**:

> Under three pinning conditions — pinned DOM input via `--snapshot-file`, pinned LLM model name (e.g. `claude-sonnet-4-6` rather than `claude-sonnet-latest`), and pinned synthetic-data seed (default 42) — bdd2pw produces functionally deterministic output (identical step bindings, identical TODO counts, identical TypeScript compilation outcomes). Byte-identical output across runs additionally requires the cache to be enabled (so repeat scaffolds return cache-hit responses) and the MCP server to return elements in stable order (Juice Shop in §3.5 illustrates the latter caveat). The benchmark in §3.5 measures both functional and byte determinism empirically.

---

## §2.x — ADD a Limitations subsection (R1-6)

**NEW SUBSECTION**:

> **Limitations.** bdd2pw does not currently support: scenarios spanning multiple browser tabs or windows (single-tab assumption), file-upload via OS-native file-picker dialogs (only programmatic uploads via `setInputFiles`), shadow-DOM piercing beyond Playwright's default reach, OAuth flows requiring third-party redirect chains, and mobile-emulation scenarios. The public roadmap (`README.md`) tracks planned features through v4.6.

---

## §3 Evaluation — REPLACE entirely

The previous §3 reported one login scenario timed against one engineer. Replace the entire section with the structure below.

### §3.1 Methodology

> We evaluate bdd2pw on a benchmark of 8 publicly available web applications selected to span complexity (low to high), framework stack (vanilla, React, Angular, server-rendered), and surface (UI versus API). For each application we author 3-4 Gherkin scenarios drawn from common user flows (authentication, search, checkout, comment), totalling 24 scenarios across the benchmark. Each application is scaffolded under three measurement modes:

> *Deterministic-only.* `bdd2pw scaffold` with no `--llm` flag. Measures pure rule coverage.

> *LLM-blocked.* `bdd2pw scaffold --llm anthropic` with the governance sidecar deliberately offline. Measures the fail-closed perimeter behaviour.

> *LLM-governed.* `bdd2pw scaffold --llm anthropic --llm-stats` with the governance sidecar running. Measures the LLM contribution and cost.

> All runs target `claude-sonnet-4-6` at temperature zero, with the SQLite binding cache enabled. Each run records: scaffold wall-clock, TypeScript compilation outcome (`tsc --noEmit`), TODO count in the emitted spec, LLM provider call count, estimated USD cost from the `llm-stats.json` sidecar, and locator-type distribution. The benchmark is reproducible via `npm run bench` from the source distribution; full results are preserved under `bench/results/`.

### §3.2 Multi-application results

> Table 2 reports per-application outcomes across all three modes. All 8 applications produce TypeScript that passes `tsc --noEmit` in every mode after the v4.0.1 hallucination-rejection patches (§3.4 discusses the failure modes that motivated those patches). Mean scaffold time is 8 seconds in deterministic-only mode and 19 seconds in the LLM-governed mode. The LLM fallback closes 40 of 69 unmatched steps (58 percent) at a total cost of USD 0.208 across the benchmark (mean USD 0.026 per application). The 86 percent of emitted locators that are semantic (`getByRole` plus `getByLabel`; Table 3) reflect the locator priority chain's preference for accessibility-driven over CSS-driven selectors.

(*Paste Table 2 here. See `BENCHMARK_TABLES.md`.*)

(*Paste Table 3 here. See `BENCHMARK_TABLES.md`.*)

### §3.3 Fail-closed perimeter validation

> The LLM-blocked column of Table 2 reports the benchmark outcome with `--llm anthropic` enabled but the governance sidecar offline. Across all 8 applications, the LLM call count is zero and the TODO counts match deterministic-only mode within rounding, demonstrating that no LLM call escapes the governance perimeter under sidecar failure. The deterministic step-rule layer continues to produce compilable output independently of the LLM layer's availability. This validates the fail-closed design described in §2.x (MCP security considerations).

### §3.4 LLM failure modes and rejection gates

> During development of the benchmark we observed three distinct LLM-binding hallucination patterns. Each pattern would produce TypeScript that does not compile if written to the emitted spec; each is rejected by a dedicated validator in the v4.0.1 release. The rejected binding falls through to the existing soft-fail path: the step lands as a `// TODO` comment with a useful warning rather than as broken code.

> *Invented helper methods.* The LLM emitted patterns like `await loginPage.fill(page.getByLabel('Email'), 'x')`, treating the Page Object as if it had a generic `fill(locator, value)` API. Real POMs only expose `goto`, `page`, and locator-typed fields discovered by the picker; `fill` lives on `Locator`, not on POM instances. The `detectHallucinatedPomMethods` validator rejects any `<pomVar>.<token>` text whose `<token>` is not in the POM's known identifier set.

> *Structured pomCall hallucinations.* The same hallucination pattern also appears in structured LLM responses like `{"pomCall": {"method": "fill", "args": [...]}}`. The text-scan validator cannot see this because the literal `loginPage.fill` does not appear in the response payload. A direct check on `pomCall.method`'s first identifier against the known set rejects these.

> *Bare field calls.* The LLM occasionally selected the correct field but invoked it as a function: `await loginPage.email("x")` instead of `await loginPage.email.fill("x")`. The field is a `Locator` instance which is not callable; TypeScript flags "This expression is not callable". The validator distinguishes known methods (callable) from known fields (chainable only), and rejects bare field calls.

> After all three gates, 8 of 8 applications in the LLM-governed mode produce tsc-clean output. The 19-test unit suite (`tests/unit/v401PomHallucination.test.ts`) pins this behaviour against regression.

### §3.5 Determinism

> Determinism is evaluated by running each application three times in deterministic-only mode and asserting (i) identical TODO counts and identical compilation outcomes (functional determinism), and (ii) identical SHA-256 hashes of emitted POM and spec files (byte determinism). The harness is invoked via `npx ts-node bench/runner.ts --repeat 3`. Results are reported in Table 4.

(*Paste Table 4 here. See `BENCHMARK_TABLES.md`.*)

> 7 of 8 applications are functionally deterministic across three repeats. AutomationPractice diverges because the upstream demo site's DOM changes between scans, producing different rule matches; this is a property of the live DOM rather than of bdd2pw. 6 of 8 applications are additionally byte-deterministic. Juice Shop diverges because the MCP server returns the same element set in different orders across scans; the emitted POM lists the same fields but in different positions. Both divergent cases are addressed by `--snapshot-file` pinning, which captures the live DOM once and replays it offline on subsequent runs. The camera-ready version of this paper will ship pinned snapshots for all 8 benchmark applications and report determinism under snapshot mode.

---

## §4 Conclusion — REPLACE the impact paragraph (R1-5, R2-3)

**OLD** (paragraph citing adoption metrics or unpublished sister work as evidence of impact):

**NEW**:

> bdd2pw provides a reproducible scaffold-time workflow that combines deterministic Gherkin-to-Playwright rule matching with a governed LLM fallback for novel phrasings. On an 8-application benchmark, the deterministic layer covers 32 of 69 unmatched steps (47 percent) for free, the LLM layer closes a further 40 (an additional 58 percent of remaining unmatched steps) at USD 0.026 per application, and three runtime hallucination-rejection gates ensure that any binding the LLM produces in error lands as a developer-visible TODO rather than as broken code. The package is published on npm under MIT licence with each release archived on Zenodo for citation. Source, benchmark, and reproduction instructions are available at https://github.com/javvadivijayprasad/bdd2pw.

---

## §4 Conclusion — ADD a "Related work" subsection (R1-2)

If §4 does not already have a Related Work subsection, add one before the closing paragraph:

**NEW SUBSECTION**:

> **Related work.** Playwright codegen [5] generates standalone Playwright tests from a live recorded browser session. It does not consume Gherkin, does not produce named Page Object accessors, and does not provide a deterministic step-rule layer or governance perimeter. Runtime BDD test runners — playwright-bdd, cucumber-js paired with Playwright — execute .feature files at test time but require hand-authored step definition functions for every project, and do not scaffold Page Objects from live DOMs. Record-and-replay tools (Selenium IDE, Katalon Recorder) capture user gestures but do not consume Gherkin and require manual POM extraction. Academic test-generation systems (Pynguin for Python unit tests, EvoSuite for Java unit tests, recent vision-language-model-based web explorers) operate on different inputs (source code, screenshots) and produce different outputs (unit tests, exploration paths); they are complementary rather than overlapping with the bdd2pw workflow.

---

## References — REMOVE [9] and [10] from §3 (R2-6)

The two references concerning record-replay test breakage and GUI test development effort were cited as evidence for the prior single-engineer effort claim. With the new §3 reporting empirical benchmark data, neither citation supports the workflow under measurement. Remove from §3 inline citations. They MAY be kept in the Related Work section if they remain relevant as background context — verify the surrounding sentence still makes sense before keeping.

---

## References — REMOVE [11] and [12] from §1 / §4 significance argument (R2-3)

References [11] (defect-aware prioritisation, submitted) and [12] (self-healing automation, under review) cannot support the significance claim. Remove from significance-claim sentences. They MAY be kept as a single descriptive citation if the manuscript needs to acknowledge the broader TestForge AI ecosystem — recommended sentence: "bdd2pw is one component of the broader TestForge AI ecosystem [11, 12]." That is descriptive, not significance-supporting.

---

## References — ADD MCPXKIT citation (R1-8)

Add to the references list (replace placeholder with the actual BibTeX entry):

```bibtex
@article{mcpxkit2026,
  title = {{MCPXKit: Systematic Security Analysis of the Model Context Protocol}},
  author = {[authors as listed on the actual paper]},
  journal = {IEEE Transactions on Dependable and Secure Computing},
  year = {2026},
  doi = {[DOI from IEEE Xplore]},
  note = {Cited in \S2.x MCP security considerations}
}
```

Cited in the §2.x MCP security considerations subsection.

---

## Declarations page — FIX typo (Reviewer #2 minor)

**OLD**:

> Declaration of intrest

**NEW**:

> Declaration of interest
