# Example: practice-test-login

End-to-end fixture proven against the live site. Used by:

- `tests/e2e/practiceTestLogin.test.ts` — regression guard: this exact pipeline must keep emitting a runnable spec.
- The "first green run" snapshot pinned in `CHANGELOG.md`.

## Files

```
practice-test-login/
├── login.feature       ← 6 scenarios (positive + negative + outline + security)
├── snapshot.json       ← hand-authored a11y/DOM snapshot for the live page
└── README.md
```

## Reproducing the green run

```bash
# From the bdd2pw repo root
npm run build

bdd2pw scaffold examples/practice-test-login/login.feature \
  --url https://practicetestautomation.com/practice-test-login/ \
  --page LoginPage \
  --repo /tmp/practice-test-login-out \
  --snapshot-file examples/practice-test-login/snapshot.json \
  --no-validate

cd /tmp/practice-test-login-out
npm install
npx playwright install chromium
npx playwright test --project=chromium
```

Expected: **7 passed** (against `https://practicetestautomation.com/practice-test-login/`).

## What this fixture proves

Every layer of the rule-based pipeline:

| Layer | Exercised by |
|---|---|
| Gherkin parser (`@cucumber/gherkin`) | All 6 scenarios |
| `Background:` → `test.beforeEach` | The `Given I am on the login page` background |
| `Scenario Outline + Examples` | The "credentials are empty" outline (2 rows) |
| Step matcher rule 1 (navigate) | `Given I am on the login page` |
| Step matcher rule 2b (input, reversed word order) | `When I enter username "student"` |
| Step matcher rule 3 (click with explicit role suffix) | `And I click the login button` |
| Step matcher rule 8 (error message) | `Then I should see an error message "..."` |
| Step matcher rule 9a (text containing) | `And I should see a welcome message containing "Congratulations"` |
| Step matcher rule 10 (remain on page) | `And I should remain on the login page` |
| Step matcher rule 11 (redirect) | `Then I should be redirected to the logged-in page` |
| Step matcher rule 12 (attribute check) | `Then the password field should be of type "password"` |
| Step matcher rule 13 (URL prefix) | `Then the current URL should start with "https"` |
| Locator picker (CSS-id field-name derivation) | `<input id="username">` → `usernameInput` field |
| Synthesised `goto()` method | Required by Background's `Given I am on the login page` |
| POM instantiation per scope | Both `beforeEach` and each `test()` get `const loginPage = new LoginPage(page)` |
| `findField()` suffix-constrained matching | "login button" → `submitButton` (only `*Button` field) |

## Iteration record (Phase 1a hardening)

The first run produced 0/7 passing. Six rounds of bug fixes — three rule/code, three snapshot-accuracy — got it to 7/7. Full trace in `CHANGELOG.md` under "Phase 1a milestone".

The snapshot-accuracy rounds are the strongest motivator for **Phase 1b** (real `@playwright/mcp` integration), which captures the live DOM and eliminates hand-authoring entirely.
