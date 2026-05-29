# bdd2pw — Gherkin to Playwright

Scaffold runnable Playwright TypeScript tests from your Gherkin `.feature` files. Right-click a feature, get Page Objects + specs ready to run.

## Features

- **Right-click any `.feature` file** in the Explorer → *bdd2pw: Scaffold Playwright tests from this feature*. The extension parses the Gherkin, scans the live page for elements, picks the most stable Playwright locators (`getByRole` > `getByLabel` > `getByTestId` > `locator(css)`), and writes a Playwright project — `playwright.config.ts`, the POM, the spec, and a `BDD_REVIEW.md` report — into a sibling folder next to your feature.
- **30+ deterministic step rules** cover the common BDD dialects: `I enter "X" as username`, `I should see "Welcome"`, `URL contains "/dashboard"`, `the login page is displayed`, and many more. Steps that don't match a rule can optionally fall through to a governed LLM (Anthropic Claude) — every prompt is sanitized through a local sidecar before it leaves your machine.
- **Activity-bar panel** showing recent runs, quick actions, and config shortcuts.
- **Status-bar button** when a `.feature` file is open — one click to scaffold.
- **Command palette** entries (`Ctrl+Shift+P` → "bdd2pw").
- **In-process** — no subprocess, no global install. The extension imports [`@vijaypjavvadi/bdd2pw`](https://www.npmjs.com/package/@vijaypjavvadi/bdd2pw) directly, so failures land as actionable errors instead of opaque exit codes.

## Quick start

1. Install the extension (you're presumably reading this from the Marketplace listing — click *Install*).
2. Open a workspace containing at least one `.feature` file.
3. Open VS Code Settings (`Ctrl+,` → search `bdd2pw`) and set:
   - **Base URL** — the live URL the scaffolder visits to discover form fields / buttons / etc. Required.
   - **POM class name** — defaults to `LoginPage`. Override per-project.
   - **Anthropic API key** — optional. Leave blank to run rule-only.
4. Right-click your `.feature` file in the Explorer → *bdd2pw: Scaffold Playwright tests from this feature*.
5. Watch the progress notification. When it finishes, open `BDD_REVIEW.md` to see what was matched, what fell to TODO, and any tsc warnings.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `bdd2pw.baseUrl` | empty | Base URL for page discovery. Prompted at scaffold time if empty. |
| `bdd2pw.pomClassName` | `LoginPage` | Page Object class name to generate. |
| `bdd2pw.outputRepo` | empty | Absolute path to write the scaffolded project. Defaults to a `playwright-out/` folder next to the `.feature`. |
| `bdd2pw.anthropicApiKey` | empty | Anthropic API key for LLM fallback. Leave empty to disable. **Store in user settings, not workspace settings — don't commit it.** |
| `bdd2pw.governanceUrl` | `http://localhost:4900` | ai-governance sidecar URL — every prompt routes through `/sanitize` before reaching Anthropic. |
| `bdd2pw.skipGovernance` | `false` | Dev-only escape hatch. Never enable in production. |
| `bdd2pw.maxLlmCalls` | `50` | Per-scaffold LLM call budget. |
| `bdd2pw.selfHealing` | `false` | Wrap emitted locators in `healOrThrow()` for runtime self-healing. |
| `bdd2pw.noDiscovery` | `false` | Skip live element scan. Use when the target URL is unreachable. |
| `bdd2pw.domains` | `[]` | Opt-in domain rule packs. Pick any combination of `banking`, `healthcare`, `insurance`, `retail`, `gov`, `education`, `telecom`. Each pack adds ~20 regex rules covering that industry's common Gherkin dialects (v3.4.0 + v3.8.0). |
| `bdd2pw.useBatching` | `true` | Per-scenario LLM batching (v3.5.0). One Anthropic call per scenario instead of N. Flip to `false` for strict 1:1 call accounting. |
| `bdd2pw.diagnostics` | `false` | Rule-trace diagnostics (v3.6.0). When `true`, every warning step in `BDD_REVIEW.md` lists the top-3 nearest rules + their patterns. |
| `bdd2pw.merge` | `false` | Idempotent regen (v3.2.0). Preserves `// bdd2pw:user-block id="..."` sections across re-runs. |
| `bdd2pw.dependencyStrategy` | `caret` | `caret` emits `^1.45.0`; `exact` pins to exact versions (v3.2.0). |
| `bdd2pw.metaSidecar` | `false` | Write `<spec>.spec.meta.json` describing step intent / locator / assertion (v3.2.0). |
| `bdd2pw.stepHooks` | `false` | Wrap each `test.step` body in `__bdd2pwHooks?.beforeStep / afterStep` calls (v3.1.0 + v3.3.0). |
| `bdd2pw.stepMarkers` | `false` | Bracket each step with `// bdd2pw:step-open id="NNNN"` markers (v3.1.0). |

## Commands

Open the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type `bdd2pw`:

| Command | What it does |
| --- | --- |
| **Scaffold Playwright tests from this feature** | Right-click on a `.feature` file OR keep one open and invoke from the palette. |
| **Scaffold all .feature files in folder** | Right-click a folder. Non-recursive. |
| **Propose deterministic rules from LLM candidates** | Runs bdd2pw v3.6.0's clustering pipeline against `<repo>/artefacts/candidate-rules.jsonl` and opens the resulting `propose-rules.md`. Defaults to the most recent run's repo. |
| **Toggle a domain rule pack** | Multi-select picker for banking / healthcare / insurance / retail / gov / education / telecom. Updates `bdd2pw.domains` in workspace settings. |
| **Show output channel** | Brings up the bdd2pw output log. |
| **Open BDD_REVIEW.md from last run** | Quick re-open of the review report. |
| **Open settings** | Jumps to the bdd2pw settings panel. |

## Requirements

- VS Code 1.85 or newer.
- Node 18+ (matches the bdd2pw library requirement). The extension bundles bdd2pw, so you don't need it installed globally.
- Optional: `@playwright/test` in the project where the scaffold lands, if you intend to run the generated tests immediately.

## Known limitations

- The folder-scaffold action is non-recursive — it walks the immediate children of the chosen folder. Recurse manually if you need deeper coverage.
- The LLM fallback is Anthropic-only in this release. OpenAI / Gemini providers are on the bdd2pw library roadmap (v2.1+).
- The extension trusts the workspace it's running in — it writes files to disk via the bdd2pw library. Do not run it in untrusted workspaces.

## Issues & feedback

Bugs, feature requests, and step-pattern reports go to the [bdd2pw GitHub issues](https://github.com/javvadivijayprasad/bdd2pw/issues). Reports that include the offending `.feature` step + the generated TS snippet make the fastest fixes.

## License

MIT — see [LICENSE](LICENSE).
