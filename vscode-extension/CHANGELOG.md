# bdd2pw VS Code extension — CHANGELOG

All notable changes to this extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [0.3.0] — 2026-09-09

### Theme: refreshed logo + bumps peer dependency through 10 library releases

Between v0.2.0 (May) and v0.3.0, the underlying library
`@vijaypjavvadi/bdd2pw` shipped ten releases:

- **v3.9.0** — LLM telemetry sidecar (`artefacts/llm-stats.json`)
- **v3.10.0** — Self-healing statistics CLI + sidecar
- **v3.11.0** — OpenAI provider (`gpt-4o-mini`) at full parity
- **v3.12.0** — Google Gemini provider (`gemini-2.5-flash`)
- **v4.0.0** — Data-driven scaffolds (`--data` / `--gen-data`)
- **v4.0.1** — Three-layer LLM hallucination-rejection gate
- **v4.0.2** — Documentation refresh (npm storefront)
- **v4.1.0** — Six-pattern LLM binding rewriter (bench: 3/8 → 8/8 apps compile)
- **v4.2.0** — DOM-drift detection via POM header sha256

Bumping the peer dependency to `^4.2.0` makes all of these behaviours
available to every scaffold run through the extension — with no
change to the extension's own settings or commands. The library's
new features are transparent to existing users: cached bindings
continue to work, `updatePom` remains append-only, deterministic
scaffolds are byte-identical to earlier versions, and the emitted
POMs simply pick up the new v4.2 `@bdd2pw dom-hash` header block
at the top.

New settings surfacing the OpenAI / Gemini providers, the
data-driven pipeline, and drift-aware sidebar entries are
scheduled for **v0.4.0**. This release is deliberately narrow —
a fresh logo + a library bump — so users can adopt v4.2 today
without waiting on the fuller UI catch-up.

### Changed

- **Peer dependency**: `@vijaypjavvadi/bdd2pw` `^3.8.0` → `^4.2.0`.
  Scaffolds through the extension now execute against library
  v4.2 or newer. The v4.1 binding rewriter and v4.2 DOM-hash
  header emission fire automatically — no configuration change
  required from users.
- **Extension logo**: refreshed to a higher-contrast two-document
  composition showing the Gherkin `.feature` → transformation arrow
  → Playwright `.spec.ts` pipeline on a deep-Playwright-green
  rounded-square backdrop. Readable at 16px in the sidebar and
  128px on the marketplace tile.

### Not yet in this release

The following library features work through the extension but
don't yet have dedicated UI surface (settings, commands, sidebar
entries) — they're planned for v0.4.0:

- Explicit `llmProvider` picker (currently defaults to Anthropic
  when an `apiKey` is set; users needing OpenAI or Gemini can pass
  the appropriate env var at the workspace level).
- Data-driven Examples injection (`--data` / `--gen-data`) — no
  dedicated setting yet; workaround: invoke the CLI directly.
- Drift-aware sidebar entry showing POMs whose `@bdd2pw dom-hash`
  header hasn't been refreshed recently.
- `bdd2pw.showLlmStats` / `bdd2pw.showHealStats` /
  `bdd2pw.showDomHash` inspector commands.

Existing v0.2.0 users can upgrade to v0.3.0 safely — the peer
dependency bump is additive and won't change existing scaffold
behaviour unless the workspace was already opting into v4.x
features via manual configuration.

## [0.2.0] — 2026-05-24

### Added

Surfaces eight releases of bdd2pw library work (v3.0.0 → v3.8.0)
in the extension UI.

**Eight new settings:**
- `bdd2pw.domains` — multi-select of `banking` / `healthcare` /
  `insurance` / `retail` / `gov` / `education` / `telecom`. Each
  pack adds ~20 regex rules for that industry's common Gherkin
  dialects. Empty = no packs (default; byte-stable).
- `bdd2pw.useBatching` — v3.5.0 per-scenario LLM batching toggle.
  Default `true` (one Anthropic call per scenario instead of N).
- `bdd2pw.diagnostics` — v3.6.0 rule-trace block in BDD_REVIEW.md.
- `bdd2pw.merge` — v3.2.0 idempotent regeneration with user-block
  preservation.
- `bdd2pw.dependencyStrategy` — v3.2.0 `caret` (default) or `exact`.
- `bdd2pw.metaSidecar` — v3.2.0 write `<spec>.spec.meta.json`.
- `bdd2pw.stepHooks` — v3.1.0 + v3.3.0 wrap each `test.step`
  with `__bdd2pwHooks?.beforeStep / afterStep` calls.
- `bdd2pw.stepMarkers` — v3.1.0 bracket each step with
  `// bdd2pw:step-open id="NNNN"` comments.

**Two new commands:**
- `bdd2pw.proposeRules` — runs the v3.6.0 propose-rules clustering
  pipeline against the most recent scaffold's repo (or a folder
  the user picks) and opens the resulting `propose-rules.md`.
- `bdd2pw.toggleDomain` — quick multi-select picker for the seven
  domain packs. Updates `bdd2pw.domains` in workspace settings.

**Output channel:**
- Each scaffold's header now lists active domains and active
  feature toggles so the user sees what's on without scrolling.

### Changed

- Peer dependency bumped: `@vijaypjavvadi/bdd2pw` `^2.2.7` →
  `^3.8.0`.

## [0.1.0] — 2026-05-11

Initial release.

### Added

- Right-click any `.feature` file in the Explorer → *bdd2pw: Scaffold Playwright tests from this feature*.
- Right-click a folder → *bdd2pw: Scaffold all .feature files in folder*. Non-recursive.
- Command palette commands under the `bdd2pw:` prefix.
- Activity-bar panel ("bdd2pw") with three sections: Actions, Recent runs (last 10, click to open the run's `BDD_REVIEW.md`), and Configuration shortcuts.
- Status-bar button visible while a `.feature` file is the active editor.
- Settings for base URL, POM class name, output repo, Anthropic API key, governance sidecar URL, LLM call budget, self-healing, and discovery-skip mode.
- Output channel ("bdd2pw") streams every library event in real time during a scaffold.
- Run history persisted across VS Code restarts (capped at 50 entries).

### Architecture

- In-process integration with [`@vijaypjavvadi/bdd2pw`](https://www.npmjs.com/package/@vijaypjavvadi/bdd2pw) v2.2.7. No subprocess, no global install required.
- Bundled with esbuild — single CJS output (`dist/extension.js`).
