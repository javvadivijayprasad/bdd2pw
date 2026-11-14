# `--target=pomwright` — POMWright integration (v4.7.0 PoC)

This doc covers the POMWright emission target and its design contract.
For the hands-on walkthrough see
[`examples/pomwright-login/README.md`](../examples/pomwright-login/README.md).

**Status:** proof of concept, per the design discussion with @DyHex
(POMWright author) on
[POMWright#63](https://github.com/DyHex/POMWright/issues/63). Shipped
in v4.7.0 as an opt-in flag; classic emission is unchanged.

## Rationale

[POMWright](https://github.com/DyHex/POMWright) is a Playwright helper
library that gives a test suite's locators one place to live —
registered once under typed, dotted paths, with Playwright's own methods;
POMWright builds the chain from the path and returns a plain Playwright
`Locator`. It's small, focused, and independent (no runtime deps beyond
`@playwright/test`).

bdd2pw's classic emission produces class-field POMs (`readonly
usernameInput = page.getByLabel("Username")`), which don't fit POMWright's
`LocatorRegistry` model. `--target=pomwright` is the opt-in path that
emits POMWright-shape output instead, so teams using POMWright can
scaffold from Gherkin without hand-porting.

## What's emitted

Everything the classic target emits, remapped to POMWright shape:

| Classic | POMWright target |
|---|---|
| `readonly usernameInput = this.page.getByLabel("Username");` | `this.add("main.form@login.input@username").getByLabel("Username");` |
| `export class LoginPage { constructor(public page: Page) {} ... }` | `export class LoginPage extends PageObject<Paths> { ... }` |
| `import { test, expect } from "@playwright/test";` | `import { expect } from "@playwright/test"; import { test as base } from "pomwright";` |
| `await loginPage.usernameInput.fill("x");` | `await loginPage.getNestedLocator("main.form@login.input@username").fill("x");` |
| `await loginPage.goto();` | `await loginPage.navigation.goto();` |

The `Paths` TypeScript union includes every path registered — leaves AND
their intermediate ancestors — so `getNestedLocator()` can walk the chain.

## CLI

```
bdd2pw scaffold feature.feature \
  --url https://example.com/login \
  --page LoginPage \
  --target=pomwright \
  --repo ./out
```

`--target` accepts `classic` (default — byte-identical to pre-v4.7.0) or
`pomwright`. Any other value is treated as `classic`.

Via the HTTP API:

```json
{
  "feature": "feature.feature",
  "url": "https://example.com/login",
  "page": "LoginPage",
  "repo": "./out",
  "options": { "target": "pomwright" }
}
```

## Hierarchy inference

The dotted paths are inferred from each scanned element's **xpath**
(preferred) or **CSS selector** (fallback). The walk keeps only stable
ancestor segments:

**Stable (kept):**
- Landmark tags — `main`, `nav`, `header`, `footer`, `aside` — kept bare
- Container tags with a name attribute — `form[@id="login"]`, `section[@aria-label="Checkout"]`, `dialog[@aria-labelledby="h"]`, `fieldset`, `table`

**Unstable (dropped):**
- Positional selectors (`div[2]`, `li[5]`) — not reproducible
- Unnamed `div` / `span` — give no useful anchor
- Any step `bdd2pw` can't match

The leaf segment is named after the picked locator's field name (stripped
of any role suffix the classic picker added — so `usernameInput` becomes
`main.form@login.input@username`, not `main.form@login.input@usernameInput`).

### The fallback

When no stable ancestor is found, the emitter produces a **flat path**
(just the leaf) and records a `warn` review item:

```
[warn] POMWright hierarchy fell back to flat for "heroHeading" — no stable
       ancestor (main/form/nav/section-with-name) was found in the scanned
       xpath/CSS. Consider adding an id, aria-label or role to the container,
       or editing the registered path in the generated POM by hand.
```

This is per the DyHex review on #63:

> Where the DOM doesn't provide enough information to reliably establish
> a hierarchy, I'd much rather see simpler locator paths or something
> flagged for manual review than an unnecessarily complicated or brittle
> chain.

## Runtime dependency

A project scaffolded with `--target=pomwright` requires `pomwright` as a
runtime dev-dependency. The scaffolder does NOT automatically add it to
the emitted `package.json` yet (classic templates still apply). Add it
yourself in the output repo:

```bash
cd out
npm install --save-dev pomwright
```

## What the PoC covers, and what it doesn't

### Covered (v4.7.0)

- ✅ `--target=pomwright` CLI flag and `options.target` HTTP body field
- ✅ POMWright POM class with `LocatorRegistry` paths
- ✅ `getNestedLocator(path)` rewrite in the spec for every field reference
- ✅ Base-class method handoff: `pom.goto()` → `pom.navigation.goto()`
- ✅ Hierarchy inference from xpath + CSS selector
- ✅ Flat-path fallback with review warning
- ✅ Unit tests pin the emitted shape
- ✅ **Auto-adds `pomwright` to the scaffolded `package.json`** — the
  first `npm install` in the output just works. Idempotent on
  re-scaffold.
- ✅ **`@step()` decoration via `--pomwright-step-methods`** — opt-in flag
  that turns each scenario into a `@step()`-decorated POM method the
  test calls. One Playwright report row per scenario, matching
  hand-written POMWright shape. Inside method bodies, references
  become `this.<x>` / `this.getNestedLocator(...)`.
- ✅ **AUGMENT existing POMWright POMs** — new `src/repo/pomwrightScanner.ts`
  parses `defineLocators()` + `@step()` methods back into IR.
  Re-scaffold preserves hand-curated registrations verbatim (new scan
  can't overwrite a user's `getByTestId("custom-username")` with a
  freshly-picked `getByLabel("Username")`). `@step()` methods survive
  byte-for-byte. The attestqa v4.5.x safety nets apply unchanged
  because POMWright POMs now populate `repoState.pageObjects` just
  like classic POMs.

### Not yet covered (feedback welcome at POMWright#63)

- ❌ **Method parameter round-trip.** The POMWright scanner records
  methods' bodies verbatim but currently `params: []`, so
  `loginAs(user: string)` round-trips to `loginAs()` with `user`
  referenced undefined inside. Fix queued — extend the scanner's
  param parser.
- ❌ **Reusable segment deduplication across pages.** Each page is a
  self-contained registry; POMWright's shared-segment and locator-module
  patterns aren't synthesised. Only pays off on multi-page scaffolds.
- ❌ **Session storage seeding via POMWright's `sessionStorage` helper.**
  Tests scaffolded with `--target=pomwright` call Playwright APIs
  directly for storage; the `super(page, baseUrl, path, { sessionStorage
  })` overload isn't synthesised. Blocked on a Gherkin step shape
  motivating it.

## Feedback

Issues, failed-to-compile output, or missing POMWright features — open a
bdd2pw issue with the `pomwright-target` label, or comment on
[POMWright#63](https://github.com/DyHex/POMWright/issues/63) so DyHex
is in the loop.
