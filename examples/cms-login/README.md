# Example: cms-login

Second pinned regression fixture. Validated against `https://cms.anhtester.com/login` (a real OSS CMS demo). Used by `tests/e2e/cmsLogin.test.ts`.

## What this fixture proves

A different Cucumber dialect from the `practice-test-login` fixture:

| Aspect | practice-test-login | cms-login |
|---|---|---|
| Step subject | `I` (first-person) | `user` / `User` (third-person) |
| Click step | `I click the login button` | `click Login button` (no subject) |
| Input style | one field per step | **compound: `email "X" password "Y"` in one step** |
| Redirect verb | `I should be redirected` | `user is redirected` |

Steps exercised:

| Gherkin step | Rule | Generated TS |
|---|---|---|
| `Given User navigate to Login Page for Admin "URL"` | rule 1 (subject-agnostic + tail-text + quoted URL) | `await loginPage.goto();` |
| `When user enter email "admin@example.com" password "123456"` | **rule 2c (compound)** | `await loginPage.emailInput.fill("admin@example.com");`<br>`await loginPage.passwordInput.fill("123456");` |
| `And click Login button` | rule 3 (no subject required) | `await loginPage.loginButton.click();` |
| `Then user is redirected to the Dashboard page` | rule 11 (third-person) | `await expect(loginPage.page).toHaveURL(new RegExp("Dashboard"));` |

## Reproducing

```bash
# Live (network required)
bdd2pw scaffold examples/cms-login/login.feature \
  --url https://cms.anhtester.com/login \
  --page LoginPage \
  --repo /tmp/cms-login-out \
  --no-validate

# Offline (uses the pinned snapshot)
bdd2pw scaffold examples/cms-login/login.feature \
  --url https://cms.anhtester.com/login \
  --page LoginPage \
  --repo /tmp/cms-login-out \
  --snapshot-file examples/cms-login/snapshot.json \
  --no-validate
```

Both should produce the same spec, with **0 warnings**. The regression test uses the offline path so it doesn't depend on cms.anhtester.com being reachable.
