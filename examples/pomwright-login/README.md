# pomwright-login — bdd2pw `--target=pomwright` PoC

This example demonstrates the v4.7.0 **POMWright target PoC** (per the
design discussion with @DyHex on
[POMWright#63](https://github.com/DyHex/POMWright/issues/63)).

## What's different from the classic target

The default `--target=classic` emits a Page Object with `readonly fieldName
= page.getBy...` class properties:

```ts
// classic emission
export class LoginPage {
  constructor(public page: Page) {}
  readonly usernameInput = this.page.getByLabel("Username");
  readonly submitButton  = this.page.getByRole("button", { name: "Submit" });
  async goto() { await this.page.goto("https://.../login"); }
}
```

`--target=pomwright` emits a POMWright-shape POM with a `LocatorRegistry`:

```ts
// --target=pomwright emission (what scaffolding this feature produces)
import { type Page } from "@playwright/test";
import { PageObject } from "pomwright";

type Paths =
  | "main"
  | "main.form@login"
  | "main.form@login.input@username"
  | "main.form@login.input@password"
  | "main.form@login.button@submit";

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

And the spec uses POMWright's own `test` fixture + `getNestedLocator(path)`:

```ts
import { expect } from "@playwright/test";
import { test as base } from "pomwright";
import { LoginPage } from "../pages/login.page";

const test = base.extend<{ loginPage: LoginPage }>({
  loginPage: async ({ page }, use) => { await use(new LoginPage(page)); },
});

test("Successful login", async ({ loginPage }) => {
  await loginPage.navigation.goto();
  await loginPage.getNestedLocator("main.form@login.input@username").fill("student");
  await loginPage.getNestedLocator("main.form@login.input@password").fill("Password123");
  await loginPage.getNestedLocator("main.form@login.button@submit").click();
});
```

## Reproduce locally

```bash
cd examples/pomwright-login
npx bdd2pw scaffold ./login.feature \
  --url https://practicetestautomation.com/practice-test-login/ \
  --page LoginPage \
  --target=pomwright \
  --snapshot-file ./snapshot.json \
  --repo ./out

cd out
npm install
npm install --save-dev pomwright         # POMWright is a runtime dep of the output
npx playwright install chromium
npx playwright test
```

## Hierarchy inference — how the paths are picked

bdd2pw walks each scanned element's `xpath` (or CSS selector fallback) and
keeps only stable ancestor containers:

| Container shape | Kept as path segment? |
|---|---|
| `main`, `nav`, `header`, `footer`, `aside` (bare landmarks) | ✅ yes — unique on the page |
| `form[@id="…"]`, `section[@aria-label="…"]`, `dialog[@id="…"]` | ✅ yes — carries an identifying name attribute |
| `div[2]`, `span`, unnamed `section` | ❌ no — positional/unstable |

Leaves (`input`, `button`, `a`, etc.) become the terminal segment named
after the picked locator's field name (e.g. `input@username`).

## Fallback when the DOM doesn't give enough structure

When an element has no stable ancestor (just nested `div`s), the emitter
produces a **flat path** (just the leaf) and records a warning in
`BDD_REVIEW.md`:

```
[warn] POMWright hierarchy fell back to flat for "heroHeading" — no stable
       ancestor (main/form/nav/section-with-name) was found in the scanned
       xpath/CSS. Consider adding an id, aria-label or role to the container,
       or editing the registered path in the generated POM by hand.
```

This is the explicit design choice from the DyHex review on #63:
simpler paths + flag for manual review are preferable to brittle chains.

## Known limitations of the PoC

Per the POMWright#73 design-review follow-up (2026-11-16), the PoC
merge contract is deliberately narrow. These are the limitations:

- **New POMs only.** AUGMENT of existing POMWright POMs exists in the
  code but is marked experimental — not part of the PoC merge
  contract.
- **No `@step()` decoration by default.** `--pomwright-step-methods`
  exists as an opt-in experimental flag; the PoC emits plain
  `test.step(...)` blocks.
- **No reusable segment deduplication across pages.** Each page's
  registry is self-contained; POMWright's locator-module /
  shared-segment patterns aren't synthesised.
- **Mobile dialect is untested** against POMWright shape.
- **`--self-healing` is NOT recommended with `--target=pomwright`.**
  Self-healing conflicts with POMWright's fail-fast principle (a
  POMWright suite is designed to fail when the page changes, not to
  find a similar element elsewhere). See
  [`docs/POMWRIGHT_TARGET.md`](../../docs/POMWRIGHT_TARGET.md) for the
  full note.

See [`docs/POMWRIGHT_TARGET.md`](../../docs/POMWRIGHT_TARGET.md) for
the full integration contract and feedback channel.
