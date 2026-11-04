# bdd2pw v4.6.7 — November 2026

A one-fix patch on 4.6.6. attestqa reported (finding F-0095, Juice
Shop run `20261023T173121Z-2fc20316`) that `I navigate to "<path>"`
was silently binding to the POM's no-arg `goto()` helper, discarding
the captured path. The test ran against the home page instead of the
page the step named, and passed green because the assertion happened
to hold on both pages.

**Fix in rule 1 (navigation):** when the captured target looks like
a path — starts with `/`, `#`, `http://`, `https://`, or contains
`?` — bdd2pw now emits `<pageVar>.page.goto("<path>")` directly via
`customBody`, bypassing the no-arg POM helper and preserving the
step's intent. Narrative targets like "the login page" still route
to `pageObject.goto()` so the POM's baked-in default URL continues
to work. The v4.6.1 pagination veto on "page 2" / "next page" is
unchanged.

## Install

```bash
npm install -D @vijaypjavvadi/bdd2pw        # the engine + the bdd2pw CLI (Node.js 20+)
npx playwright install chromium             # browser for live page discovery
```

VS Code: install **bdd2pw — Gherkin to Playwright** from the
Marketplace (publisher `vijaypjavvadi`), or the `.vsix` attached to
this release. From v4.6.6 onwards the extension version is locked to
the engine version — this release ships v4.6.7 of both.

## Changed in 4.6.7

- **Rule 1 (navigation):** quoted and bare path targets now land on
  `pageVar.page.goto("<path>")` instead of the no-arg POM helper.
  Fixes attestqa F-0095.

## Known-good from 4.6.6 (unchanged)

- Unified release pipeline — one tag push publishes to npm + VS Code
  Marketplace + GitHub release + Zenodo.
- Engine + extension share one version number per release; workflow
  refuses a tag that doesn't match both.
- `preflight`, `format:check`, `typecheck`, `smoke` npm scripts.

## How to upgrade

```bash
npm install -D @vijaypjavvadi/bdd2pw@4.6.7
```

No breaking changes. The fix is pure rule-1 behaviour: a previously
green-but-wrong test (step named a path, test ran on the home page)
now runs on the named page and either stays green (correct), fails
on the assertion (surfacing a real gap the old behaviour hid), or
produces a different observed outcome if the assertion was pre-tuned
for the home page by mistake. Re-run your suite after upgrading.

See [`docs/RELEASING.md`](docs/RELEASING.md) for the release routine
and [`CHANGELOG.md`](CHANGELOG.md) for the full version history.
