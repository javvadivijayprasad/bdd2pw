# Release Runbook — v1.0.0

> Copy-paste these blocks into **PowerShell** in order. Each block stops at a
> natural verification point; don't skip the verification commands. Estimated
> time: ~15 min from cold start, assuming `gh auth login` and `npm login` are
> already done.
>
> **Order matters.** `pw-emit` ships first because `bdd2pw@1.0.0` depends on
> `@vijaypjavvadi/pw-emit@^1.0.0` from the npm registry. If you publish bdd2pw
> first, the install will fail.

---

## 0. One-time prerequisites

Run once per machine, then forget about them.

```powershell
# GitHub CLI auth (browser flow)
gh auth status
# If not logged in:
gh auth login --web --scopes "repo,workflow,write:packages"

# npm auth — needs to land you on https://registry.npmjs.org
npm whoami
# If not logged in:
npm login
# After login, confirm scope access:
npm access list packages @vijaypjavvadi
```

You should see `@vijaypjavvadi/sel2pw` already published (proof your scope is
active).

---

## 0.5. Create the GitHub repos (first-time only)

If `javvadivijayprasad/pw-emit` and `javvadivijayprasad/bdd2pw` don't exist on
GitHub yet, create them now. Both are MIT-licensed public repos.

```powershell
# Create both repos as PUBLIC (so npm provenance works) with no auto-init —
# we want our local main as the first commit, no README/LICENSE conflicts.
gh repo create javvadivijayprasad/pw-emit `
  --public `
  --description "Shared emitter library that renders Playwright TypeScript Page Objects, spec files, and project scaffolds from a generic IR. Powers @vijaypjavvadi/sel2pw and @vijaypjavvadi/bdd2pw." `
  --homepage "https://github.com/javvadivijayprasad/pw-emit"

gh repo create javvadivijayprasad/bdd2pw `
  --public `
  --description "Scaffold runnable Playwright TypeScript tests from Gherkin .feature files. CLI + HTTP service. Detects existing Page Objects, scans live pages, emits POMs + specs ready to run." `
  --homepage "https://github.com/javvadivijayprasad/bdd2pw"
```

Verify both exist and are empty:
```powershell
gh repo view javvadivijayprasad/pw-emit  --json name,visibility,isEmpty
gh repo view javvadivijayprasad/bdd2pw   --json name,visibility,isEmpty
# Expect: {"name":"...","visibility":"PUBLIC","isEmpty":true}
```

> **Why public?** `npm publish --provenance` requires public GitHub repos. If
> you want them private, you must drop `--provenance` from `release.yml`. For a
> v1.0 launch, public is the right default — provenance attestations let
> downstream users verify the tarball came from this exact commit.

### NPM_TOKEN for GitHub Actions auto-publish

The `.github/workflows/release.yml` in **both** repos uses `secrets.NPM_TOKEN`
to publish on tag push. Generate one **automation** token and add it to both
repos' secrets:

```powershell
# 1. Generate token in browser:
Start-Process "https://www.npmjs.com/settings/$(npm whoami)/tokens/new"
# Select: Granular Access Token → expiry 90d → packages "@vijaypjavvadi/*" → permissions Read+Write
# Copy the token (shown ONCE).

# 2. Add it to both GitHub repos:
$tok = Read-Host -AsSecureString "Paste npm token"
$plain = (New-Object System.Net.NetworkCredential("", $tok)).Password
gh secret set NPM_TOKEN --repo javvadivijayprasad/pw-emit --body $plain
gh secret set NPM_TOKEN --repo javvadivijayprasad/bdd2pw  --body $plain
Remove-Variable plain
```

Verify:
```powershell
gh secret list --repo javvadivijayprasad/pw-emit
gh secret list --repo javvadivijayprasad/bdd2pw
```
You should see `NPM_TOKEN` in both lists with a recent `Updated` timestamp.

---

## 1. Ship `pw-emit@1.0.0`

```powershell
cd E:\EB1A_Research\pw-emit

# Sanity — manifest already says 1.0.0?
node -e "console.log(require('./package.json').version)"
# → 1.0.0

# Clean install (no symlinks)
Remove-Item -Recurse -Force node_modules, package-lock.json -ErrorAction SilentlyContinue
npm install

# Build + test must be green
npm run build
npm test

# Dry-run the publish — confirms what tarball will go up
npm publish --dry-run --access public
# Look for: "name: @vijaypjavvadi/pw-emit", "version: 1.0.0",
# tarball includes dist/, templates/, README.md, CHANGELOG.md, LICENSE, package.json
# tarball EXCLUDES src/, tests/, node_modules/

# Initialise git + push
git init -b main
git add .
git commit -m "chore(release): pw-emit v1.0.0"
git remote add origin https://github.com/javvadivijayprasad/pw-emit.git
git push -u origin main

# Tag — this is what triggers the auto-publish workflow on GitHub
git tag -a v1.0.0 -m "pw-emit v1.0.0 — first public release"
git push origin v1.0.0
```

**Watch the release workflow:**
```powershell
gh run watch --repo javvadivijayprasad/pw-emit
```

When the workflow finishes green, verify:
```powershell
# npm registry sees it:
npm view @vijaypjavvadi/pw-emit version
# → 1.0.0

# Provenance attestation present:
npm view @vijaypjavvadi/pw-emit dist.signatures
# → array with at least one signature
```

> **If the workflow fails on `npm publish`** with `EOTP` or `E403`, your
> `NPM_TOKEN` is likely a *legacy* token (not granular) without
> publish permission for the scope. Regenerate as described in section 0.

> **If the workflow fails on provenance** (`unable to attest`), the most
> common cause is the workflow not having `id-token: write` permission. The
> ours does, but if you copied it elsewhere, double-check.

---

## 2. Ship `bdd2pw@1.0.0`

Now that `pw-emit@1.0.0` resolves from the npm registry, bdd2pw can install it
properly.

```powershell
cd E:\EB1A_Research\bdd2pw

# Sanity — manifest is on 1.0.0 and the dep is "^1.0.0" not "file:../pw-emit"?
node -e "const p = require('./package.json'); console.log(p.version, p.dependencies['@vijaypjavvadi/pw-emit'])"
# → 1.0.0 ^1.0.0

# Clean install — pulls @vijaypjavvadi/pw-emit@1.0.0 from npm
Remove-Item -Recurse -Force node_modules, package-lock.json -ErrorAction SilentlyContinue
npm install

# Build + full test suite must be green
npm run build
npm test
# → 101 / 101

# Dry-run the publish
npm publish --dry-run --access public
# Look for: "name: @vijaypjavvadi/bdd2pw", "version: 1.0.0",
# tarball includes dist/, templates/, README.md, CHANGELOG.md, LICENSE, package.json
# tarball EXCLUDES src/, tests/, examples/, docs/, node_modules/

# Initialise git + push
git init -b main
git add .
git commit -m "chore(release): bdd2pw v1.0.0"
git remote add origin https://github.com/javvadivijayprasad/bdd2pw.git
git push -u origin main

# Tag
git tag -a v1.0.0 -m "bdd2pw v1.0.0 — first public release"
git push origin v1.0.0
```

**Watch the release workflow:**
```powershell
gh run watch --repo javvadivijayprasad/bdd2pw
```

When it finishes green, verify:
```powershell
npm view @vijaypjavvadi/bdd2pw version
# → 1.0.0

npm view @vijaypjavvadi/bdd2pw dependencies
# → @vijaypjavvadi/pw-emit: ^1.0.0   (NOT "file:../pw-emit")

# Smoke install in a throwaway dir
$tmp = New-Item -ItemType Directory -Path "$env:TEMP\bdd2pw-smoke-$(Get-Random)"
cd $tmp
npm init -y > $null
npm install @vijaypjavvadi/bdd2pw
.\node_modules\.bin\bdd2pw --version
# → 1.0.0
.\node_modules\.bin\bdd2pw --help
# → shows scaffold | analyze | update-pom | serve
cd E:\EB1A_Research\bdd2pw
Remove-Item -Recurse -Force $tmp
```

---

## 3. Post-release housekeeping

```powershell
# Mark the GitHub releases as "latest" if needed (release.yml already does this,
# but if you tag manually later, run:)
gh release edit v1.0.0 --repo javvadivijayprasad/bdd2pw  --latest
gh release edit v1.0.0 --repo javvadivijayprasad/pw-emit --latest

# Branch protection for main (optional but strongly recommended)
gh api -X PUT repos/javvadivijayprasad/bdd2pw/branches/main/protection `
  --input .github/branch-protection.json
# (only if you want to lock main behind PRs + green CI; skip for solo dev)

# Pre-bump versions for next dev cycle
cd E:\EB1A_Research\pw-emit
npm version 1.0.1 --no-git-tag-version    # or 1.1.0-dev.0 if you prefer pre-release
cd E:\EB1A_Research\bdd2pw
npm version 1.0.1 --no-git-tag-version
# Commit + push to main; the release workflow won't fire (no tag pushed).
```

---

## 4. Auto-deployment recap — what happens on each push from here on

| Trigger                    | Workflow                  | What it does |
|----------------------------|---------------------------|--------------|
| Push to `main` / open PR   | `.github/workflows/ci.yml`| Matrix build + test on Ubuntu/macOS/Windows × Node 18/20/22. Uploads coverage artefact (non-blocking). |
| Push tag `vX.Y.Z`          | `.github/workflows/release.yml` | `npm ci` → `npm run lint` → `npm run build` → `npm test` → `npm publish --provenance --access public` → create a GitHub Release with auto-generated notes. |
| Daily (Dependabot)         | `.github/dependabot.yml`  | Opens PRs for outdated npm + actions versions. Falls into the CI gate above. |

So the steady-state release ritual reduces to:

```powershell
# In whichever repo:
git switch main
git pull
# bump version (or use changesets if you adopt them later)
npm version minor    # creates a v1.1.0 commit + tag
git push --follow-tags
```

`--follow-tags` is the magic — it pushes the tag in the same `git push`, which
fires the release workflow, which publishes to npm. End-to-end you do nothing
beyond `npm version` + `git push --follow-tags`.

---

## 5. Rollback

```powershell
# If a bad version went up within 72h, you can deprecate (preferred) or unpublish.
# DEPRECATE — the package stays installable but warns:
npm deprecate "@vijaypjavvadi/bdd2pw@1.0.0" "Critical bug, use 1.0.1+"

# UNPUBLISH — only within 72h, only for that exact version:
npm unpublish @vijaypjavvadi/bdd2pw@1.0.0
# (npm policy: after 72h, unpublish requires support intervention.)
```

For GitHub:
```powershell
gh release delete v1.0.0 --repo javvadivijayprasad/bdd2pw --yes
git push origin :refs/tags/v1.0.0
```

---

## Failure modes — quick reference

| Symptom | Likely cause | Fix |
|---|---|---|
| `npm install` complains about `file:../pw-emit` | You didn't run section 1 first, or the bdd2pw manifest still has the local path | Confirm `package.json` shows `"^1.0.0"`, not `"file:../pw-emit"`, then `npm install` again |
| Release workflow `403 Forbidden` on npm publish | `NPM_TOKEN` missing/expired or token doesn't cover the `@vijaypjavvadi` scope | Regenerate per section 0; `gh secret set NPM_TOKEN ...` |
| `npm publish` says "You cannot publish over the previously published versions" | Version not bumped — npm rejects re-publishing the same version | `npm version patch` and re-tag |
| `gh run watch` says workflow not found | Tag hasn't reached GitHub yet | `git push origin v1.0.0` (or check `git push --follow-tags` was used) |
| Release workflow green but `npm view` returns old version | Caching — npm CDN can lag ~30s | Wait 60s and retry, or `npm view --registry https://registry.npmjs.org/` |

---

**That's the runbook.** Once you've ridden it through once, the v1.1.0 release
is just `npm version minor` + `git push --follow-tags` in each repo.
