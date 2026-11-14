# bdd2pw v4.7.0 — November 2026

A minor release that lands the **POMWright integration**: a new
`--target=pomwright` flag that emits Page Objects compatible with
[POMWright](https://github.com/DyHex/POMWright), DyHex's typed-path
`LocatorRegistry` library for Playwright. Classic emission is
byte-identical to v4.6.x — zero diff for existing users.

Per the design discussion with POMWright's author on
[POMWright#63](https://github.com/DyHex/POMWright/issues/63).

## Install

```bash
npm install -D @vijaypjavvadi/bdd2pw        # the engine + the bdd2pw CLI (Node.js 20+)
npx playwright install chromium             # browser for live page discovery
```

VS Code: install **bdd2pw — Gherkin to Playwright** from the
Marketplace (publisher `vijaypjavvadi`), or the `.vsix` attached to
this release. Engine and extension share one version (locked from
v4.6.6 onwards) — this release ships v4.7.0 of both.

## The POMWright target, by example

**Input** — any `.feature` file, e.g. `examples/pomwright-login/login.feature`:

```gherkin
Scenario: Successful login
  Given I am on the login page
  When I enter "student" into the username field
  And I enter "Password123" into the password field
  And I click the Submit button
```

**Scaffold** — opt in via `--target=pomwright`:

```bash
npx bdd2pw scaffold login.feature \
  --url https://practicetestautomation.com/practice-test-login/ \
  --page LoginPage \
  --target=pomwright \
  --repo ./out
```

**Emitted `pages/login.page.ts`** — POMWright-shape with hierarchical
`LocatorRegistry` paths inferred from the scanned xpath/CSS:

```ts
import { type Page } from "@playwright/test";
import { PageObject } from "pomwright";

type Paths =
  | "main"
  | "main.form@login"
  | "main.form@login.button@submit"
  | "main.form@login.input@password"
  | "main.form@login.input@username";

export class LoginPage extends PageObject<Paths> {
  constructor(page: Page) {
    super(page, "https://practicetestautomation.com", "/practice-test-login/");
  }

  protected defineLocators(): void {
    this.add("main").getByRole("main");
    this.add("main.form@login").getByRole("form", { name: "Login" });
    this.add("main.form@login.input@username").getByLabel("Username");
    this.add("main.form@login.input@password").getByLabel("Password");
    this.add("main.form@login.button@submit").getByRole("button", { name: "Submit" });
  }
}
```

**Emitted `tests/login.spec.ts`** — uses POMWright's own `test`
fixture; every step references the registered path via
`getNestedLocator`:

```ts
import { expect } from "@playwright/test";
import { test as base } from "pomwright";
import { LoginPage } from "../pages/login.page";

const test = base.extend<{ loginPage: LoginPage }>({
  loginPage: async ({ page }, use) => { await use(new LoginPage(page)); },
});

test("Successful login", async ({ loginPage }) => {
  await test.step("Given I am on the login page", async () => {
    await loginPage.navigation.goto();
  });
  await test.step("When I enter \"student\" into the username field", async () => {
    await loginPage.getNestedLocator("main.form@login.input@username").fill("student");
  });
  await test.step("When I enter \"Password123\" into the password field", async () => {
    await loginPage.getNestedLocator("main.form@login.input@password").fill("Password123");
  });
  await test.step("When I click the Submit button", async () => {
    await loginPage.getNestedLocator("main.form@login.button@submit").click();
  });
});
```

`pomwright` is added to the scaffolded repo's `devDependencies`
automatically — `npm install` just works. `npx tsc --noEmit` in the
emitted project passes against real `pomwright@^3.0.0`, verified
end-to-end on Windows.

## Hierarchy inference — how the paths are picked

bdd2pw walks each scanned element's `xpath` (or CSS selector fallback)
and keeps only stable ancestor containers:

| Container shape | Kept as path segment? |
|---|---|
| `main`, `nav`, `header`, `footer`, `aside` (bare landmarks) | ✅ yes — unique on the page |
| `form[@id="…"]`, `section[@aria-label="…"]`, `dialog[@id="…"]` | ✅ yes — carries an identifying name |
| `div[2]`, `span`, unnamed `section` | ❌ no — positional/unstable |

When an element has no stable ancestor, the path falls back to the
leaf alone and `BDD_REVIEW.md` records a warning:

```
[warn] POMWright hierarchy fell back to flat for "heroHeading" — no stable
       ancestor (main/form/nav/section-with-name) was found in the scanned
       xpath/CSS. Consider adding an id, aria-label or role to the container,
       or editing the registered path in the generated POM by hand.
```

This is the explicit design call from DyHex's review: simpler paths +
manual-review marker over brittle chains.

## Opt-in `@step()` methods for POMWright-idiomatic suites

Add `--pomwright-step-methods` and each scenario becomes a
`@step()`-decorated method on the POM; the test calls that method
instead of inlining `test.step(...)`. Matches a hand-written POMWright
suite's shape — Playwright's report viewer shows one row per scenario.

```ts
// Emitted with --pomwright-step-methods:
test("Successful login", async ({ loginPage }) => {
  await loginPage.scenarioSuccessfulLogin();
});
```

```ts
// …and inside LoginPage (appended by the emitter):
@step()
async scenarioSuccessfulLogin(): Promise<void> {
  await this.navigation.goto();
  await this.getNestedLocator("main.form@login.input@username").fill("student");
  await this.getNestedLocator("main.form@login.input@password").fill("Password123");
  await this.getNestedLocator("main.form@login.button@submit").click();
}
```

Inside the method body, every `pom.<x>` reference becomes `this.<x>` /
`this.getNestedLocator(...)` (not `pom.…`) — valid TypeScript inside
the class.

## AUGMENT — re-scaffold preserves hand-curated work

Running the scaffolder again against a repo that already has a
POMWright POM preserves every existing registration and
`@step()`-decorated method verbatim. The new scan only adds
genuinely-missing paths. The classic bdd2pw AUGMENT contract:
hand-curated locator tuning (e.g. `getByTestId("custom-username")`
that the user wrote by hand) is never overwritten by what the fresh
scan picked.

The attestqa v4.5.x safety nets (P0-1 REUSE no-op, P0-3 unparseable-fields
counted as missing, P0-4 spec-reference guard) apply unchanged because
POMWright POMs now populate `repoState.pageObjects` via the new
`src/repo/pomwrightScanner.ts`, just like classic POMs.

## Unbound-step defence (v4.6.4 parity)

If a step fails to match any rule, the emitted test gets
`test.fixme(true, "bdd2pw: N step(s) not bound: …")` at the top.
Playwright reports it as **skipped** with the reason, not a silent
pass. Same default behaviour as the classic target since v4.6.4.

## Changed in 4.7.0

- **NEW `--target=pomwright`** — POMWright-shape POM + spec emission.
  `classic` is the default and byte-identical to v4.6.x.
- **NEW `--pomwright-step-methods`** — scenario-per-method emission
  with `@step()` decoration.
- **NEW `src/transformers/hierarchyInferrer.ts`** — walks xpath/CSS
  for stable ancestor chains; flat fallback with review marker.
- **NEW `src/emitters/pomwrightEmitter.ts`** — produces the POMWright
  POM class, spec, and the `@step()` method block.
- **NEW `src/repo/pomwrightScanner.ts`** — parses an existing
  POMWright POM into IR for the AUGMENT path.
- **NEW `tests/unit/pomwrightEmitter.test.ts`** — 8 cases pinning the
  emitted shape.
- **NEW `examples/pomwright-login/`** — runnable fixture with feature
  + snapshot + README walkthrough.
- **NEW `docs/POMWRIGHT_TARGET.md`** — full integration contract,
  CLI/HTTP surface, inference rules, PoC-covered-vs-deferred list.
- **Scaffolded `package.json`** — auto-adds `"pomwright": "^3.0.0"`
  to `devDependencies` when `--target=pomwright` is set.

### Docs tidy

- README `What bdd2pw is and isn't (as of v4.7.0)` — version tag
  advanced from v4.4.0.
- README `What's new in v4.0.0` section rewritten as `What's new in
  v4.7.0` with a compact history of recent minors.
- README Verification table — test count updated from `101/101 green
  across 10 test files` to `455+ passing across 34+ test files` plus a
  new POMWright verification row.
- Citation section now references the SoftwareX paper (DOI
  `10.1016/j.softx.2026.102933`) as the preferred cite; v4.0.1 Zenodo
  artifact kept as the reproducibility pin.

### CI quiet

- All 13 pre-existing unused-import/unused-var lint warnings cleaned up.
  CI output is now `0 errors, 0 warnings`.

## Known POMWright-target limitations (deferred)

- **Method parameter round-trip** — AUGMENT preserves method bodies
  verbatim but the scanner currently uses `params: []`, so
  `loginAs(user: string)` round-trips to `loginAs()` with `user`
  referenced-undefined inside. Fix is ~20 lines in the scanner.
- **Shared-segment deduplication across pages** — POMWright's
  locator-module patterns aren't synthesised; each page's registry is
  self-contained.
- **Session-storage overload** — `super(page, baseUrl, path, {
  sessionStorage })` isn't parsed or emitted; needs a Gherkin step
  shape to motivate it.

## How to upgrade

```bash
npm install -D @vijaypjavvadi/bdd2pw@4.7.0
```

Existing users on v4.6.x: no breaking change, no flag change, no
output-shape change. Classic target is byte-identical.

POMWright users: run `bdd2pw scaffold feature.feature --target=pomwright`
and you get a POMWright POM + spec ready to run. `npm install` in the
scaffolded repo adds `pomwright` automatically.

See [`docs/POMWRIGHT_TARGET.md`](docs/POMWRIGHT_TARGET.md) for the
full integration contract, [`examples/pomwright-login/`](examples/pomwright-login/)
for a hands-on walkthrough, and [`CHANGELOG.md`](CHANGELOG.md) for the
full version history.
