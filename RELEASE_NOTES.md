# bdd2pw v4.7.1 — November 2026

Closes the three gates POMWright's maintainer (@DyHex) named in his
[POMWright#73 review](https://github.com/DyHex/POMWright/pull/73) of
v4.7.0's `--target=pomwright` PoC, plus the self-healing disclosure
request he added. No breaking changes for classic-target users; this
is a patch release that makes the POMWright target correct.

## Install

```bash
npm install -D @vijaypjavvadi/bdd2pw        # the engine + the bdd2pw CLI (Node.js 20+)
npx playwright install chromium             # browser for live page discovery
```

VS Code: install **bdd2pw — Gherkin to Playwright** from the
Marketplace (publisher `vijaypjavvadi`), or the `.vsix` attached to
this release. Engine and extension share one version.

## What was wrong in v4.7.0 (the three gates)

### Gate 1 — hierarchy inference emitted `getByRole` that never matched

v4.7.0's `hierarchyInferrer` registered `<form id="login">` as
`getByRole("form", { name: "Login" })`. Playwright's `getByRole(role,
{ name })` requires the accessible name to come from `aria-label` or
the browser's computed name — **`id` alone doesn't satisfy it**
([Playwright's own rule](https://github.com/microsoft/playwright/blob/v1.65.1/packages/injected/src/roleUtils.ts#L113),
via `hasExplicitAccessibleName`). Every path below the form segment
was silently dead. Same bug for `*[@id="..."]` → `getByRole("region",
{name})` and for treating `aria-labelledby` as the label text.

**Fixed in v4.7.1:** the inferrer now carries per-segment attribute-source
metadata to the emitter, which picks the right Playwright call per
source:

| Scanner input | v4.7.0 (wrong) | v4.7.1 (right) |
|---|---|---|
| `form[@aria-label="Checkout"]` | `getByRole("form", { name: "Checkout" })` | `getByRole("form", { name: "Checkout" })` ✓ unchanged |
| `form[@id="login"]` | `getByRole("form", { name: "Login" })` ✗ dead | `.locator("form#login")` ✓ |
| `dialog[@aria-labelledby="h"]` | `getByRole("region", { name: "H" })` ✗ wrong | `.locator('dialog[aria-labelledby="h"]')` + review warning ✓ |
| `form[@name="X"]` | `getByRole("form", { name: "X" })` ✗ dead | `.locator('form[name="X"]')` ✓ |
| `main`, `nav`, `header`, `footer`, `aside` | `getByRole(landmark)` | `getByRole(landmark)` ✓ unchanged |

### Gate 2 — no end-to-end check that the emission compiles

v4.7.0's unit tests compared emitted strings against expected strings.
Didn't catch the gate-1 bug (the wrong-API strings matched the wrong
expectations). A real `tsc --noEmit` against real `pomwright` would
also not have caught it (the TypeScript is valid; it just doesn't
MATCH on a page) — but it would catch the next class of bug, where
the emitter uses a POMWright API that doesn't exist or has changed.

**Added in v4.7.1:** new `scripts/e2e-pomwright.mjs` scaffolds the
example, runs `npm install` to pull real `pomwright@^3`, and runs
`tsc --noEmit`. Wired into `release.yml`'s `check` job on both
Windows and Ubuntu. Also exposed as `npm run e2e:pomwright` for
local use.

### Gate 3 — docs disagreed about PoC scope

The PoC was originally agreed on POMWright#63 as new-POM-only. v4.7.0's
`docs/POMWRIGHT_TARGET.md` and the PR README text said AUGMENT and
`@step()` methods were supported; the `examples/pomwright-login/README.md`
said new-POM only. Documentation disagreed with itself.

**Clarified in v4.7.1:** the PoC merge contract is new-POM only, as
originally agreed. The `--pomwright-step-methods` flag and AUGMENT
code are still in the codebase (both work, both pass unit tests), but
all three docs now label them as **experimental, opt-in, not part of
the PoC merge contract**. Teams that want them can still use them;
the first-round POMWright integration doesn't promise them.

## Also added — self-healing / POMWright incompatibility note

bdd2pw's `--self-healing` flag wraps the emitted `test` with a runtime
healer that picks a similar element when the primary locator fails to
match. POMWright is built on the opposite principle: a test fails when
the page changes rather than finding a similar element elsewhere (see
[POMWright Principles](https://dyhex.github.io/POMWright/docs/principles/)).

The two flags are orthogonal — nothing at the CLI prevents combining
them. But the combination **silently weakens POMWright's guarantees**.
`docs/POMWRIGHT_TARGET.md` now carries an explicit "do not combine"
section with the rationale; `examples/pomwright-login/README.md` echoes
it; the top-level README mentions it in the v4.7 what's-new.

## Also fixed — scaffolded tsconfig `moduleResolution`

The pw-emit-bundled `tsconfig.json.tmpl` emits `"moduleResolution":
"node"`, which TypeScript 5.5+ treats as the removed `node10` alias
and errors on. The e2e-pomwright script now patches this to
`"bundler"` (TypeScript's recommended modern value, stable across 5.x)
after `npm install` and before `tsc --noEmit`. Permanent fix lives at
the pw-emit source level — tracked as a follow-up.

## Changed in 4.7.1

- `src/transformers/hierarchyInferrer.ts` — new `AncestorMeta` + `AncestorAttrSource` types; `extractAncestors` returns richer entries; `inferPomwrightPath` builds a `Map<path, AncestorMeta>`.
- `src/emitters/pomwrightEmitter.ts` — reads the per-ancestor metadata and emits the right Playwright call per attribute source.
- `scripts/e2e-pomwright.mjs` — new E2E CI script.
- `.github/workflows/release.yml` — wires the e2e script into the `check` job.
- `package.json` — new `e2e:pomwright` npm script.
- `docs/POMWRIGHT_TARGET.md` — PoC scope section rewritten; self-healing incompatibility section added.
- `examples/pomwright-login/README.md` — limitations list updated to match; self-healing note added.
- `README.md` — v4.7 what's-new entry rewritten to match PoC scope + self-healing note.

## Upgrade

```bash
npm install -D @vijaypjavvadi/bdd2pw@4.7.1
```

No breaking changes. Classic-target users see no diff. POMWright-target
users on v4.7.0 should re-scaffold any POM that depends on a `form` /
`dialog` / `section` ancestor — the old output had broken `getByRole`
calls on those; the new output uses `.locator("#id")` instead.

See [`docs/POMWRIGHT_TARGET.md`](docs/POMWRIGHT_TARGET.md) for the
full integration contract and [`CHANGELOG.md`](CHANGELOG.md) for the
full version history.
