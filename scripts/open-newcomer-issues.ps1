# open-newcomer-issues.ps1
#
# Opens three deliberately-small bdd2pw issues labeled "good first issue"
# so the repo has a landing surface for newcomer contributors (the gap
# vs sel2pw identified on 2026-10-28). Each one is intentionally scoped
# to be finishable in a single afternoon.
#
# Prereq: `gh auth status` logged in.

$ErrorActionPreference = "Stop"
$repo = "javvadivijayprasad/bdd2pw"

# -------- Issue 1 --------
$title1 = "docs(README): add before/after `.feature` → `.spec.ts` code block to the Examples section"
$body1 = @"
### What

The ``## Examples`` section (near the top of ``README.md``, after Quick start) names the two example fixtures and the file layout bdd2pw emits, but doesn't show a concrete before/after.

### Add

A short code block that renders roughly:

**Input `.feature`:**
``````gherkin
Feature: Login
  Scenario: Successful login
    Given I am on the login page
    When I enter "alice" into the username field
    And I enter "p@ss" into the password field
    And I click Submit
    Then I should see the dashboard
``````

**Emitted ``pages/login.page.ts`` (abridged):**
``````ts
export class LoginPage {
  constructor(public page: Page) {}
  readonly usernameInput = this.page.locator("#username");
  readonly passwordInput = this.page.locator("#password");
  readonly submitButton  = this.page.getByRole("button", { name: "Submit" });
  async goto() { await this.page.goto("https://practicetestautomation.com/practice-test-login/"); }
}
``````

**Emitted ``tests/login.spec.ts`` (abridged):**
``````ts
test("Successful login", async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.usernameInput.fill("alice");
  await loginPage.passwordInput.fill("p@ss");
  await loginPage.submitButton.click();
  await expect(loginPage.page.getByText("Dashboard").first()).toBeVisible();
});
``````

### Why

A reader asked (vitalets/playwright-bdd#405) for "an example of the generated POM"; the Examples section now links to the fixtures, but a reader who doesn't click through sees no code at all.

### Where

``README.md``, inside the existing ``## Examples`` section, between the ``### What bdd2pw emits`` paragraph and the ``### Note on Phase 1a vs 1b`` block.

### Done when

- The code block appears in the rendered README on GitHub.
- The example matches ``examples/practice-test-login/`` output byte-for-byte on the salient lines (no fabricated locators).
- CHANGELOG ``[Unreleased]`` picks up a one-line docs entry.
"@
Write-Host "Opening Issue 1 (docs README before/after)..."
gh issue create --repo $repo --title $title1 --body $body1 --label "good first issue" --label "docs"

# -------- Issue 2 --------
$title2 = "rule: add 'I go back' / 'I navigate back' → page.goBack()"
$body2 = @"
### What

Common step shape bdd2pw doesn't currently bind:

``````gherkin
When I go back
When I navigate back
When I click the back button
``````

All three fall to TODO because the navigation rule (rule 1) only matches ``navigate to <URL>``.

### Add

A new rule in ``src/transformers/stepMatcher.ts`` that matches these three variants and emits:

``````ts
await productCataloguePage.page.goBack();
``````

### Pattern

``````
/^(?:I\s+)?(?:go|navigate|click|press|tap)\s+(?:the\s+)?back(?:\s+button)?\s*$/i
``````

### Why

Browser-back is a very common UX assertion ("after cancel, user is back on the previous page"). Currently bdd2pw either forces the LLM lane or drops to TODO.

### Done when

- Rule added to ``defaultRules`` in ``src/transformers/stepMatcher.ts``.
- Test case added to ``tests/snapshot/stepMatcher.test.ts`` covering all three step shapes.
- ``docs/STEP_RULES.md`` entry (one row in the rule table).
- CHANGELOG ``[Unreleased]`` picks up a one-line ``feat:`` entry.

### Hint

The pagination veto added to rule 1 in v4.6.1 is a good template — same file, similar scope. ~30 lines total including the test.
"@
Write-Host "Opening Issue 2 (rule: go back)..."
gh issue create --repo $repo --title $title2 --body $body2 --label "good first issue" --label "enhancement"

# -------- Issue 3 --------
$title3 = "ci: add a `smoke` npm script that runs the standalone node smoke tests under scripts/*.mjs"
$body3 = @"
### What

The repo has several node smoke tests under ``scripts/``:

- ``scripts/smoke-v441-provenance.mjs``
- ``scripts/smoke-v451-attestqa-bugs.mjs``

They exist because vitest can't run in some sandbox environments (rollup native binary mismatch), but they're invoked ad-hoc. CI doesn't run them.

### Add

A ``scripts/run-smokes.mjs`` runner that iterates every ``scripts/smoke-*.mjs``, invokes each with ``node``, and exits non-zero if any one fails. Then expose it as:

``````json
"scripts": {
  "smoke": "node scripts/run-smokes.mjs"
}
``````

And add a ``smoke`` step to ``.github/workflows/ci.yml`` right after ``npm test``.

### Why

Smoke tests catch things vitest can't (ESM import shapes of the published dist, cross-package integration), and we lose that signal when CI only runs ``npm test``.

### Done when

- ``npm run smoke`` works locally and prints one line per smoke script with pass/fail.
- CI runs it after ``npm test`` on all three OS × three Node matrix cells.
- Adding a new ``scripts/smoke-*.mjs`` file automatically gets picked up.
- CHANGELOG ``[Unreleased]`` picks up a one-line ``chore(ci):`` entry.

### Hint

``glob('./scripts/smoke-*.mjs')`` + ``child_process.spawnSync('node', [file], { stdio: 'inherit' })`` — small file, maybe 40 lines.
"@
Write-Host "Opening Issue 3 (ci: smoke script)..."
gh issue create --repo $repo --title $title3 --body $body3 --label "good first issue" --label "chore"

Write-Host "`nAll three opened. Verify:"
Write-Host "   https://github.com/$repo/labels/good%20first%20issue"
