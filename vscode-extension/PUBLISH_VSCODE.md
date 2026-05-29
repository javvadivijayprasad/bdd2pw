# Publishing the bdd2pw VS Code extension

End-to-end runbook for the first publish to the [VS Code Marketplace](https://marketplace.visualstudio.com/). Every step is one-time setup unless flagged "every release".

All commands assume you're running from `E:\EB1A_Research\bdd2pw\vscode-extension\` in PowerShell.

## One-time setup

### 1. Create a Marketplace publisher account

Go to https://marketplace.visualstudio.com/manage/publishers/ and sign in with the Microsoft account that owns the publisher identity. Click **Create publisher**.

- **Publisher ID**: `vijaypjavvadi` (must exactly match the `publisher` field in `package.json`). Change it in both places if you want a different name.
- **Display name**: e.g. `Vijay Prasad`.

### 2. Generate an Azure DevOps Personal Access Token (PAT)

The Marketplace authenticates publishes via an Azure DevOps PAT — even though Azure DevOps and the Marketplace are technically separate products.

1. Sign in to https://dev.azure.com/ with the same Microsoft account.
2. If prompted, create an Azure DevOps organisation (any name — it's just a container).
3. Top-right user menu → **Personal access tokens** → **New Token**.
4. Settings:
   - **Name**: `vscode-marketplace-publish`
   - **Organization**: **All accessible organizations** ← important, the default "specific org" won't work for the Marketplace.
   - **Expiration**: 1 year (or your policy).
   - **Scopes**: **Custom defined** → expand **Marketplace** → tick **Manage**.
5. **Create**. Copy the token immediately — it's shown once.

Store the token securely (1Password, a `.env.local` file outside the repo, etc.). Don't commit it.

### 3. Install vsce (the CLI publisher)

`vsce` is already pinned in `devDependencies`, so a normal `npm install` inside `vscode-extension/` makes it available.

```powershell
cd E:\EB1A_Research\bdd2pw\vscode-extension
npm install
```

### 4. Convert the icon to PNG (one-time, regenerate if you change the design)

The Marketplace requires `icon.png` to be a PNG, not SVG. Convert `icon-source.svg`:

```powershell
# Option A — Node-only, no extra installs:
npx --yes svg2png-cli icon-source.svg icon.png --width=128 --height=128

# Option B — ImageMagick if you have it:
magick -background none -density 384 icon-source.svg -resize 128x128 icon.png
```

Verify `icon.png` exists and is 128x128.

## Per-release flow

Every time you publish a new version (bump 0.1.0 → 0.1.1, etc.):

```powershell
cd E:\EB1A_Research\bdd2pw\vscode-extension

# 1. Bump version in package.json (manual edit, or:)
npm version patch   # or minor / major

# 2. Update CHANGELOG.md — add the new version block at the top.

# 3. Build + bundle.
npm run build

# 4. Sanity-check the package contents.
npx vsce ls
# Should show: dist/extension.js, package.json, README.md, CHANGELOG.md,
# LICENSE, icon.png, media/sidebar-icon.svg
# Should NOT show: src/, node_modules/, *.ts, .vscode/

# 5. Login (first run only or after PAT rotation).
npx vsce login vijaypjavvadi
# Paste the PAT when prompted.

# 6. Publish.
npx vsce publish
# Or to release without bumping further: npx vsce publish patch
```

The Marketplace usually takes 1–5 minutes to scan and surface the new version. You can watch the status at https://marketplace.visualstudio.com/manage/publishers/vijaypjavvadi.

## Local install (skip the Marketplace, useful for dev / QA)

Package locally and install the VSIX without going through the Marketplace:

```powershell
npm run build
npx vsce package
# Produces bdd2pw-0.1.0.vsix in the current directory.

code --install-extension bdd2pw-0.1.0.vsix
# Or in VS Code: Extensions panel → "..." menu → Install from VSIX...
```

This is the right loop while you're iterating before the first public publish.

## Pre-flight checklist

Run through these before your first `vsce publish`:

- [ ] `publisher` in `package.json` matches the publisher ID you created on the Marketplace.
- [ ] `version` is `0.1.0` (or whatever you intend).
- [ ] `engines.vscode` is `^1.85.0` — make sure VS Code on your dev machine is at least that version.
- [ ] `icon.png` exists, 128x128, not transparent against a transparent background (Marketplace prefers solid).
- [ ] `LICENSE` is present.
- [ ] `README.md` doesn't reference local file paths or broken images.
- [ ] `CHANGELOG.md` has a 0.1.0 entry.
- [ ] `dist/extension.js` is generated and not gitignored from packaging (`.vscodeignore` excludes `src/` and `node_modules/`, NOT `dist/`).
- [ ] `npm run build` finishes clean.
- [ ] `npx vsce ls` output looks sensible (no `*.map`, no `node_modules/`, no `tests/`).
- [ ] Install the VSIX locally via `code --install-extension bdd2pw-0.1.0.vsix` and verify it activates, the sidebar appears, the status-bar button shows on a `.feature` file, and a scaffold run actually completes end-to-end.

## Troubleshooting

**`Personal Access Token verification failed.`** — Your PAT has the wrong scopes. Regenerate with the **Marketplace > Manage** scope and **All accessible organizations**.

**`A 'repository' field is missing from package.json.`** — Already filled in for you; if you fork, update the URL.

**`Extension validation failed: …icon…`** — The icon file path or dimensions are wrong. Marketplace wants 128x128 PNG. SVG icons are NOT accepted for the main `icon` field (they ARE accepted for activity-bar / view-container icons, which is why `media/sidebar-icon.svg` is fine).

**Extension activates but the sidebar is empty.** — Check the Output channel ("bdd2pw") for activation errors. Most likely cause: `@vijaypjavvadi/bdd2pw` failed to load. The esbuild config marks several native-binding deps as `external`; if you see "Cannot find module 'better-sqlite3'" you can ignore it (it's optional and the library falls back to an in-memory cache).
