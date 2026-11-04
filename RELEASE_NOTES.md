# bdd2pw v4.6.6 — November 2026

A small patch on 4.6.5 that unifies the release pipeline **and** the
version numbers. One tag push runs one GitHub Actions workflow that
publishes to npm, to the VS Code Marketplace, and creates the GitHub
release (which Zenodo archives on its own). Every publish step is
idempotent, so re-running a failed run is always safe. No tokens
anywhere — npm and the Marketplace both use trusted publishing against
the job's GitHub OIDC identity.

**Version-lock change — important for Marketplace users.** The VS Code
extension version jumps from **0.3.0 → 4.6.6** in this release. From
v4.6.6 onwards the engine (`@vijaypjavvadi/bdd2pw` on npm) and the
extension (`vijaypjavvadi.bdd2pw` on the Marketplace) always share the
same version number per release. The workflow refuses any tag that
doesn't match both. The pre-v4.6.6 drift that let the Marketplace sit
at 0.3.0 while the engine moved through v4.1 → v4.6.5 can't happen
again. Marketplace users on 0.3.0 will see "4.6.6" as the next update —
it IS the next update; semver allows the jump and installed
functionality is a strict superset.

bdd2pw is a deterministic scaffolder with an optional governed LLM
fallback across three providers. It parses a Gherkin `.feature`,
scans the live page via Playwright MCP, picks the most stable
locator for every interactive element, matches each step to a POM
method call (via 200+ deterministic rules organised in three
layers), and emits a runnable Playwright TypeScript repo.

## Install

```bash
npm install -D @vijaypjavvadi/bdd2pw        # the engine + the bdd2pw CLI (Node.js 20+)
npx playwright install chromium             # browser for live page discovery
```

VS Code: install **bdd2pw — Gherkin to Playwright** from the
Marketplace (publisher `vijaypjavvadi`), or the `.vsix` attached to
this release.

## Changed in 4.6.6

- **Version-lock**: engine and extension now share one version number
  per release; `release.yml` refuses a tag that doesn't match both
  `package.json` and `vscode-extension/package.json`.
- **Extension bump 0.3.0 → 4.6.6**: aligns with the engine; no code
  changes in the extension itself (feature catch-up is tracked in
  Issue #31, scheduled for the next minor).
- `CITATION.cff` restructured to the concept-DOI shape so the
  reference resolves to the latest archived version automatically
  (per the 2026-11-03 release-pipeline handoff).
- One release workflow — `.github/workflows/release.yml` — covers
  check (Windows + Ubuntu) and publish (npm, Marketplace, GitHub
  release). Replaces the separate `ci.yml` + partial `release.yml`.
- `preflight` npm script runs exactly what CI's check job runs, in
  the same order: `format:check && lint && typecheck && build && test`.
- `smoke` npm script iterates every `scripts/smoke-*.mjs` so the
  vitest-independent regression guards (attestqa Bug A + Bug B,
  v4.4.1 provenance comments) run on both OSes in CI.
- `docs/RELEASING.md` is the four-step routine; obsoletes
  `docs/RELEASE.md` (kept as a backup for one release).
- `.prettierignore` extended to skip `tests/expected-output/`,
  `examples/`, `bench/` — fixtures the generator must match
  byte-for-byte and shouldn't be reformatted.

## Fixed before 4.6.6

The engine itself is unchanged from 4.6.5 (attestqa handoff items on
unbound steps, list-field detection, N4d-neg, N4e, N4f already shipped
in 4.6.5). The complete history for the current minor:

- **4.6.5** — unbound steps emit `test.fixme` by default; `dedupeLocators`
  detects list fields (plural naming + `multiplicity`); rules N4e / N4f
  list assertions; rule N4d-neg negative active-page assertion.
- **4.6.3** — rule N4d review: `expect.poll` race fix, bare-N label,
  `.first()` on `.or()`, two new step shapes, regex escape fix.
- **4.6.2** — rule N4d active-page assertion.
- **4.6.1** — pagination veto on rule 1, axe rule N4c, LLM prompt
  tightening (no fabricated locators, no LLM axe bindings, no `goto()`
  for pagination phrases).
- **4.6.0** — attestqa continuity: `--browser-channel`, spec-reference
  safety net (P0-4), `--rollback-on-tsc-errors` (P1-1).

## How to upgrade

```bash
npm install -D @vijaypjavvadi/bdd2pw@4.6.6
```

No breaking changes on the engine. The release pipeline change affects
contributors only; existing users get the same CLI and output as 4.6.5.

## Known limitations

- Scanner does not yet parse constructor-assigned locators (planned
  for v5.0; v4.5.5's P0-1 + P0-3 + v4.6.0's P0-4 together remove the
  damage caused by this limitation).

See [`docs/RELEASING.md`](docs/RELEASING.md) for the release routine
and [`CHANGELOG.md`](CHANGELOG.md) for the full version history.
