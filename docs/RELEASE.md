# Release Runbook

> **Status as of 2026-05-03:** v1.0.0 of both packages **shipped**.
> [`@vijaypjavvadi/pw-emit@1.0.0`](https://www.npmjs.com/package/@vijaypjavvadi/pw-emit) ·
> [`@vijaypjavvadi/bdd2pw@1.0.0`](https://www.npmjs.com/package/@vijaypjavvadi/bdd2pw) ·
> source on [`javvadivijayprasad/pw-emit`](https://github.com/javvadivijayprasad/pw-emit) +
> [`javvadivijayprasad/bdd2pw`](https://github.com/javvadivijayprasad/bdd2pw),
> tagged `v1.0.0` on both.
>
> **Current release model: manual `npm publish` from your local machine.**
> Auto-publish via GitHub Actions is wired but disabled (see §5).

---

## TL;DR — cutting a new release

For any future `vX.Y.Z` of either package, run this from PowerShell:

```powershell
cd E:\EB1A_Research\<pkg>            # pw-emit or bdd2pw
npm version <patch|minor|major>      # bumps package.json + creates a vX.Y.Z git commit + tag
npm install                          # refresh lockfile
npm run build
npm test
npm publish --access public          # Windows Hello prompt — tap PIN/fingerprint
git push --follow-tags               # pushes commit + tag to GitHub
```

That's it. The publish step is the only one that needs your physical
authentication (security key 2FA). Total time per package: ~2 minutes.

If you're releasing both packages and bdd2pw needs the new pw-emit, do
**pw-emit first**, then in bdd2pw run `npm install @vijaypjavvadi/pw-emit@^X.Y.Z`
to bump the dep, commit, then `npm version ...` and ship.

---

## Detailed flow (per package)

### 1. Bump the version

```powershell
cd E:\EB1A_Research\<pkg>

# Pick one — npm version will reject if working tree isn't clean
npm version patch    # 1.0.0 → 1.0.1   bug fix only
npm version minor    # 1.0.0 → 1.1.0   new features, backwards-compatible
npm version major    # 1.0.0 → 2.0.0   breaking changes
```

`npm version` does three things in one command:
1. Edits `package.json` to the new version.
2. Creates a git commit with message `<new-version>` (e.g. `1.1.0`).
3. Creates an annotated git tag `v<new-version>`.

If you want a different commit message, pass `-m`:
```powershell
npm version minor -m "release: %s — adds X, Y, Z"
```

### 2. Update CHANGELOG.md

```powershell
notepad CHANGELOG.md      # or your editor of choice
```

Add a new entry at the top of `[Unreleased]` describing what's in this version,
then move it under a new `## [X.Y.Z] — YYYY-MM-DD` heading.

After saving, amend the version commit to include the changelog:
```powershell
git add CHANGELOG.md
git commit --amend --no-edit
git tag -d v<new-version>      # delete the old tag (it points to the wrong commit now)
git tag -a v<new-version> -m "<pkg> v<new-version>"   # re-tag the amended commit
```

### 3. Sanity install + verify

```powershell
Remove-Item -Recurse -Force node_modules, package-lock.json -ErrorAction SilentlyContinue
npm install
npm run build
npm test
```

Tests must be green. If they fail, fix and amend the commit.

### 4. Dry-run the publish

Always do this first — confirms what will go up to npm:

```powershell
npm publish --dry-run --access public
```

Read the `Tarball Contents` section. It should list files under `dist/`,
`templates/`, plus `README.md`, `CHANGELOG.md`, `LICENSE`, `package.json`. It
should **NOT** list `src/`, `tests/`, `examples/`, `docs/`, or `node_modules/`.
If it does, check the `files` array in `package.json` and `.npmignore`.

### 5. Publish for real

```powershell
npm publish --access public
```

What you see depends on your npm 2FA mode. Today (2026-05-03) the account uses
**security key 2FA only**, so npm prompts:

```
This operation requires a one-time password.
Press ENTER to open in the browser...
```

→ Press Enter → browser opens npm's auth page → Windows Hello prompts for your
PIN/fingerprint → tap → page says "Authenticated, return to your terminal" →
the CLI continues and prints:

```
+ @vijaypjavvadi/<pkg>@<new-version>
```

That `+` line is the success signal. Anything else (especially `npm error E403`)
means the publish failed; see §7.

### 6. Push the source + tag to GitHub

```powershell
git push --follow-tags
```

The `--follow-tags` flag pushes both the new commit on `main` *and* the
`v<new-version>` tag in one go. This triggers two GitHub Actions workflows:

- **CI** (matrix build + test on Ubuntu/macOS/Windows × Node 18/20/22) → goes green.
- **Release** (the auto-publish one) → goes red at the `npm publish` step. This
  is **expected and harmless** because `NPM_TOKEN` is currently a revoked
  granular token. We've already published manually in step 5. See §5 of the
  "Why auto-publish is off" section below.

### 7. Verify

```powershell
# Wait ~30 seconds for npm CDN to propagate, then:
npm view @vijaypjavvadi/<pkg> version
# → should match what you just published

# Visually confirm
Start-Process "https://www.npmjs.com/package/@vijaypjavvadi/<pkg>"
```

The npm website's package banner should show the new version with "Published a
few seconds ago." If the website lags but `npm view` shows the new version,
that's fine — the install path uses the API directly.

### 8. Smoke test from a stranger's perspective

For meaningful releases (anything more than a typo fix), prove the published
package works end-to-end with a fresh install:

```powershell
$tmp = New-Item -ItemType Directory -Path "$env:TEMP\<pkg>-smoke-$(Get-Random)"
cd $tmp
npm init -y > $null
npm install @vijaypjavvadi/<pkg>
.\node_modules\.bin\<pkg> --version    # should match new version
.\node_modules\.bin\<pkg> --help
cd E:\EB1A_Research\<pkg>
Remove-Item -Recurse -Force $tmp
```

For bdd2pw specifically, the canonical end-to-end smoke is in §6 below.

---

## Coordinated bump — releasing pw-emit + bdd2pw together

When a change touches both packages:

```powershell
# 1. Ship pw-emit first (so its new version is on the registry)
cd E:\EB1A_Research\pw-emit
npm version <patch|minor|major>
# ... update CHANGELOG, amend, retag ...
npm install
npm run build
npm test
npm publish --access public           # tap Windows Hello
git push --follow-tags

# Wait 30s for npm CDN
Start-Sleep 30
npm view @vijaypjavvadi/pw-emit version

# 2. Bump pw-emit dep in bdd2pw
cd E:\EB1A_Research\bdd2pw
npm install @vijaypjavvadi/pw-emit@^<new-version>
git add package.json package-lock.json
git commit -m "chore: bump pw-emit to <new-version>"

# 3. Now bump bdd2pw itself
npm version <patch|minor|major>
# ... update CHANGELOG, amend, retag ...
npm install
npm run build
npm test
npm publish --access public           # tap Windows Hello
git push --follow-tags
```

Order matters: bdd2pw can't `npm install` a pw-emit version that isn't on the
registry yet, so always publish pw-emit first.

---

## End-to-end smoke test for bdd2pw

Beyond `--version` / `--help`, prove a real scaffold run works. Uses snapshot
mode so no live browser or network needed:

```powershell
$test = "$env:TEMP\bdd2pw-smoke"
Remove-Item -Recurse -Force $test -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $test | Out-Null
cd $test
npm init -y > $null
npm install @vijaypjavvadi/bdd2pw

@'
Feature: Login
  Scenario: Successful login
    Given I am on the login page
    When I enter "admin" in the username field
    And I enter "password" in the password field
    And I click the Sign in button
    Then I should see the welcome message
'@ | Out-File -Encoding utf8 login.feature

@'
{
  "url": "https://example.com/login",
  "title": "Login",
  "elements": [
    { "tag": "input",  "label": "Username", "cssSelector": "#username" },
    { "tag": "input",  "label": "Password", "cssSelector": "#password" },
    { "tag": "button", "role": "button", "name": "Sign in", "cssSelector": "button[type=submit]" },
    { "tag": "div",    "text": "Welcome", "cssSelector": ".welcome-msg" }
  ]
}
'@ | Out-File -Encoding utf8 snapshot.json

.\node_modules\.bin\bdd2pw scaffold .\login.feature `
  --url https://example.com/login `
  --page LoginPage `
  --repo .\generated `
  --snapshot-file .\snapshot.json `
  --no-discovery `
  --no-validate

cd .\generated
npm install
npx tsc --noEmit
echo "tsc exit: $LASTEXITCODE"
cd ..
```

Pass criteria: `tsc exit: 0` and the `generated/` directory contains
`pages/login.page.ts`, `tests/login.spec.ts`, `BDD_REVIEW.md`, plus the
project skeleton (`package.json`, `playwright.config.ts`, `tsconfig.json`,
`.gitignore`).

---

## Why auto-publish is off (the NPM_TOKEN story)

Both repos have `.github/workflows/release.yml` configured to run on tag push,
which would `npm publish --provenance --access public` automatically. **It
doesn't work right now**, by design. Background:

- npm enforces 2FA-on-publish for the `@vijaypjavvadi` scope (rolled out
  ~2024 to combat supply-chain attacks).
- Granular Access Tokens cannot bypass this unless the account has 2FA
  enabled in **"Authorization only"** mode (not "Authorization and writes").
- During v1.0 setup, account 2FA was enabled in security-key-only mode (no
  TOTP). Security keys can't be tapped from a CI runner, so the granular
  token kept getting `403 Forbidden ... Two-factor authentication or
  granular access token with bypass 2fa enabled is required to publish`.
- We revoked the broken token but left `NPM_TOKEN` set in both repos to the
  revoked value. The release workflow runs on every tag push, gets through
  lint+build+test, and fails at the publish step. Build/test signal still
  works; the failure is loud but harmless.

**This is fine.** Manual publish from local PowerShell takes ~2 minutes per
release (steps 1–7 above), and it gives you a physical 2FA tap as the last
gate before code goes public — arguably *better* than fully-automated
publishing for a small package with infrequent releases.

### Upgrade path: enabling auto-publish later

If release cadence ever becomes high enough that the 2-minute manual ritual
hurts, here's the path back to auto-publish:

1. Add a TOTP authenticator app (Google Authenticator, Authy, 1Password TOTP)
   to your npm 2FA — npm allows multiple methods. Settings → Account
   → Two-Factor Authentication → "Add another method".
2. Switch 2FA mode from "Authorization and writes" (current implicit default)
   to **"Authorization only"** in the same panel.
3. Generate a fresh Granular Access Token at
   <https://www.npmjs.com/settings/vijaypjavvadi/tokens/new>:
   - Type: Granular Access Token
   - Name: `gh-actions-publish-vijaypjavvadi`
   - Expiration: 90 or 365 days
   - Permissions → Packages and scopes: **Read and write**
   - Select packages and scopes: scope `@vijaypjavvadi`
4. Update both GitHub repos:
   ```powershell
   $tok = Read-Host -AsSecureString "Paste new token (input hidden)"
   $plain = (New-Object System.Net.NetworkCredential("", $tok)).Password
   gh secret set NPM_TOKEN --repo javvadivijayprasad/pw-emit --body $plain
   gh secret set NPM_TOKEN --repo javvadivijayprasad/bdd2pw  --body $plain
   Remove-Variable plain, tok
   ```
5. Re-run the most recent failed Release workflow on each repo to confirm
   the token works:
   ```powershell
   gh run list --repo javvadivijayprasad/pw-emit --workflow=release.yml --limit 1
   gh run rerun <run-id> --repo javvadivijayprasad/pw-emit
   gh run watch --repo javvadivijayprasad/pw-emit
   ```

After that, the cadence becomes:

```powershell
npm version <patch|minor|major> && git push --follow-tags
```

Workflow takes over from there. You don't even need to be at a computer.

---

## Auto-deployment recap — what each push triggers today

| Trigger              | Workflow              | Status today | Notes |
|----------------------|-----------------------|--------------|-------|
| Push to `main` / PR  | `ci.yml`              | ✅ Green     | Matrix build + test on Ubuntu/macOS/Windows × Node 18/20/22 |
| Push tag `vX.Y.Z`    | `release.yml`         | ❌ Red       | Stops at `npm publish` due to broken NPM_TOKEN. Build/test pass first. |
| Daily (Dependabot)   | `dependabot.yml`      | ✅ Active    | Opens PRs for outdated npm + actions versions, gated by ci.yml |

The red Release runs are expected. They mean "lint/build/test passed but I
couldn't publish for you" — which is correct; you publish manually.

---

## Rollback

If a bad version went up, you have two options. **Prefer deprecate over
unpublish** — unpublish breaks anyone's lockfile that pinned the bad version,
deprecate just adds a warning.

```powershell
# DEPRECATE — package stays installable but warns on every install:
npm deprecate "@vijaypjavvadi/<pkg>@X.Y.Z" "Critical bug, use X.Y.Z+1 instead"

# UNPUBLISH — only allowed within 72h of publish, only for that exact version:
npm unpublish @vijaypjavvadi/<pkg>@X.Y.Z
```

For GitHub:
```powershell
gh release delete vX.Y.Z --repo javvadivijayprasad/<repo> --yes
git push origin :refs/tags/vX.Y.Z
git tag -d vX.Y.Z
```

Then ship a real fix with `npm version patch` etc.

---

## Failure modes — quick reference

| Symptom | Likely cause | Fix |
|---|---|---|
| `403 Forbidden ... Two-factor authentication or granular access token with bypass 2fa enabled is required` | npm requires 2FA-on-publish; your CLI session expired or token doesn't bypass | Re-run `npm publish` and complete the security-key prompt; for CI, follow the upgrade path above |
| `npm publish` says "You cannot publish over the previously published versions" | Version not bumped — npm rejects re-publishing the same version | `npm version patch` and re-tag |
| `npm error code E404 ... '@vijaypjavvadi/X@^Y' is not in this registry` after publishing X | npm CDN propagation lag (~30-60s) | Wait 30s, retry; or `npm install --prefer-online` to skip cache |
| Release workflow `403 Forbidden` on npm publish | Expected — `NPM_TOKEN` is the revoked granular token | Ignore; or follow the upgrade path |
| `npm install` fails with `'@vijaypjavvadi/pw-emit@^X.Y.Z' not in registry` from bdd2pw | You bumped bdd2pw before publishing pw-emit | Publish pw-emit first, then retry |
| `vitest` not recognized after `npm install` | `NODE_ENV=production` is set, npm skipped devDependencies | `$env:NODE_ENV = "development"; npm install --include=dev` |
| Release workflow can't find tag | Tag didn't reach GitHub | Used `git push --follow-tags`? Otherwise: `git push origin v<version>` |

---

## v1.0.0 release log (for posterity)

The original v1.0.0 cut, 2026-05-03:

- pw-emit: published from local PowerShell with security-key 2FA at ~22:11 UTC.
- bdd2pw: published from local PowerShell with security-key 2FA at ~22:23 UTC.
- Both source pushes + `v1.0.0` tags landed on GitHub immediately after.
- Smoke test run in `$env:TEMP\bdd2pw-real-test`: scaffolded a synthetic Login
  feature, generated TS compiled clean (`tsc exit: 0`).
- Release workflows on tag push: red on publish step (expected, see §5
  above), green on CI workflow.
- npm registry confirmation:
  - <https://www.npmjs.com/package/@vijaypjavvadi/pw-emit>
  - <https://www.npmjs.com/package/@vijaypjavvadi/bdd2pw>

Future versions follow the TL;DR at the top.
