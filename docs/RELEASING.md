# Releasing

One engine version, one extension version, one workflow, one tag. Written so it
can be followed without remembering anything.

A release is the tag `vX.Y.Z`. It ships `@vijaypjavvadi/bdd2pw` to npm, the
`vijaypjavvadi.bdd2pw` extension to the VS Code Marketplace, and a GitHub
release (which Zenodo archives), all from `.github/workflows/release.yml`.
The tag, `package.json` (engine) and `vscode-extension/package.json`
(extension) must carry the same number (ADR of 2026-11-03 — locked
versioning); the workflow refuses a tag that does not match both.

## Each release

From the repository root (`E:\EB1A_Research\Application\bdd2pw`):

```
npm run preflight                       1. exactly what CI checks: format:check, lint, typecheck, build, test
npm run smoke                           2. vitest-independent regression guards (attestqa Bug A/B, provenance)
npm version patch                       3. bumps engine version in package.json + tags locally
                                           by hand: CITATION.cff version + date, RELEASE_NOTES.md,
                                           vscode-extension/package.json if the extension also changes
git add package.json package-lock.json CITATION.cff RELEASE_NOTES.md CHANGELOG.md
git commit -m "bdd2pw X.Y.Z: ..."
git push                                4. CI runs the checks on main (Windows + Ubuntu); wait for green
git push origin vX.Y.Z                  5. CI publishes npm, Marketplace (if extension version changed), GitHub release
```

Verify: `npm view @vijaypjavvadi/bdd2pw version` shows `X.Y.Z`; the Marketplace
page shows the new extension version if you bumped it; the GitHub release
exists; Zenodo has minted a DOI for it (after the first auto-archive, update
`CITATION.cff` with the **concept DOI** and the README badge).

Keep the CHANGELOG section and `RELEASE_NOTES.md` saying the same thing.

## Rules that save a release

- **Run `preflight` before every commit to main.** It is the same list CI runs,
  in the same order. If it is green here it is green there. In particular
  `format:check` is part of it: the code must be formatted with the package's
  own Prettier (`npm run format` at the root). Do not run a bare `npx prettier`
  — the root resolves an older Prettier 2 pulled in by another dependency, and
  it formats differently.
- **A tag is only pushed after the commit it points at is green on main.** If
  the tag has to move, delete it on both sides first: `git tag -d vX.Y.Z; git
  push origin :refs/tags/vX.Y.Z`.
- **Re-running a failed release is always safe.** Every publish step checks
  first and skips if that version is already out ("already on npm – skipping",
  and the same for the Marketplace and the GitHub release). So when a run
  fails at step N, fix the cause and *Re-run failed jobs*; steps before N do
  not repeat their side effects.
- **A published npm version cannot be replaced.** If a release is broken,
  publish a fixed PATCH and
  `npm deprecate @vijaypjavvadi/bdd2pw@X.Y.Z "broken; use X.Y.Z+1"`.
- **Extension version is locked to the engine version** (from v4.6.6 onwards).
  Bump both `package.json` AND `vscode-extension/package.json` in the same
  commit, every release. The workflow refuses a tag that does not match
  both. Pre-v4.6.6 drift (engine on 4.6.5 while the Marketplace sat on 0.3.0
  for two months) is what this rule stops.
- **`git add -A` stages junk.** Add release files by name. `.gitignore` covers
  `bench/.work`, `.pwheal/`, `artefacts/`, VSIX build output; don't fight it.
- **`npm ci` lock mismatch.** Any version bump must be followed by `npm install
  --package-lock-only` and the lock committed with the bump.

## Credentials (set once, never in the repo)

- **npm: trusted publishing, no token.** On npmjs.com, package
  `@vijaypjavvadi/bdd2pw` → Settings → Trusted Publisher → GitHub Actions:
  owner `javvadivijayprasad`, repository `bdd2pw`, workflow `release.yml`,
  environment blank. Under *Allowed actions* tick **Allow npm publish**
  (leave dist-tag unticked). Under *Publishing access* choose **Require
  two-factor authentication and disallow bypass 2fa tokens**. The workflow
  then publishes through OIDC with provenance. No `NPM_TOKEN` secret, no
  one-time password.
- **Marketplace: trusted publishing, no token.** On
  marketplace.visualstudio.com/manage, publisher `vijaypjavvadi` (owner
  account `vijay@vijayjavvadiresearch.ai`) → *Trusted Publishing* → Create:
  policy name `bdd2pwReleaseWorkflow`, provider GitHub Actions, repository
  owner `javvadivijayprasad`, repository `bdd2pw`, workflow `release.yml`,
  environment blank. The workflow runs `vsce publish --oidc` (vsce 4.1+),
  which exchanges the job's GitHub OIDC token for a short-lived Marketplace
  credential. No `VSCE_PAT`, and the 1 Dec 2026 retirement of
  all-organisations PATs does not apply.
- **Zenodo:** zenodo.org → GitHub (account menu) → flip the switch on for
  `javvadivijayprasad/bdd2pw`. Nothing else. From then on every GitHub
  release becomes a Zenodo version. The first one creates the concept DOI;
  it is the number shown under "Cite all versions?" on any version's record
  page. Replace the `<CONCEPT_DOI_TBD>` placeholder in `CITATION.cff` with
  that number.
- **GitHub release:** the workflow's own token; nothing to set.
- **Delete old secrets** on the repo (Settings → Secrets → Actions):
  `NPM_TOKEN`, `VSCE_PAT`. Nothing uses them any more and they expire.

If a publish step fails on credentials, the manual fallback is the same
command from the package folder (`npm publish --access public` at the repo
root with your own login; `npx @vscode/vsce publish --no-dependencies` in
`vscode-extension/` after `npx @vscode/vsce login vijaypjavvadi` with a PAT
of the owner account, scope Marketplace → Manage), then *Re-run failed jobs*
so the remaining steps complete.

## Version bumps

Semantic versioning. In this project:

- **MAJOR** — breaking change to the emitted POM/spec shape, the CLI flag
  grammar, or the HTTP body schema. (v5.0 is the next planned major —
  pw-emit will teach the scanner to parse constructor-assigned locators.)
- **MINOR** — a new rule, a new CLI flag with a default, a new HTTP option.
  Backward-compatible by construction.
- **PATCH** — a rule tightening, a bug fix, docs, tests, release-pipeline
  changes.

Record each user-visible change in `CHANGELOG.md` under `[Unreleased]` as it
is made, not at release time. At release time, promote `[Unreleased]` to
`[X.Y.Z] — YYYY-MM-DD`.

## Before the first Marketplace release of a new MAJOR version

The extension's manifest declares which VS Code APIs it uses. If a new MAJOR
changes the manifest (new `activationEvents`, new `contributes.*`), bump
`vscode-extension/package.json` and refresh the icon + README + CHANGELOG
inside `vscode-extension/` to match before pushing the tag.
