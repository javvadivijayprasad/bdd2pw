# bdd2pw VS Code extension — CHANGELOG

All notable changes to this extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

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
