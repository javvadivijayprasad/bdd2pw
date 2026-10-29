# apply-contributor-labels.ps1
#
# One-shot script to bring bdd2pw's issue tracker to parity with sel2pw's
# labelling convention — the main reason contributors found sel2pw and
# haven't found bdd2pw.
#
# What it does:
#   1. Creates the `good first issue` and `help wanted` labels if absent.
#   2. Adds those labels to the existing roadmap issues that match the
#      scope (small chores → good first issue; mid-size features →
#      help wanted).
#   3. Prints a short summary of what changed.
#
# Prereqs:
#   - `gh` CLI logged in (`gh auth status` should show the user).
#   - Run from a clone of javvadivijayprasad/bdd2pw.
#
# Idempotent: `gh label create ... --force` and `gh issue edit --add-label`
# both tolerate repeat invocations.

$ErrorActionPreference = "Stop"

$repo = "javvadivijayprasad/bdd2pw"

Write-Host "== Ensuring labels exist =="
gh label create "good first issue" --color "7057ff" --description "Scoped work a newcomer can land in a single session" --repo $repo --force
gh label create "help wanted"       --color "008672" --description "Maintainer welcomes outside contributions on this" --repo $repo --force
gh label create "docs"              --color "0075ca" --description "Documentation only"                             --repo $repo --force
gh label create "chore"             --color "cfd3d7" --description "Repo plumbing — no behaviour change"             --repo $repo --force

# ---- good first issue candidates (small, scoped, closable in one PR) ----
# These correspond to the v4.6+ hygiene issues in open-bdd2pw-issues.ps1.
# Adjust the issue numbers to match what's actually open on the repo.
$goodFirst = @(
  # Issue #4 — npm Trusted Publishing (OIDC)
  # Issue #5 — .gitattributes (already shipped — may be closed by now)
  # Issue #6 — .gitignore bench/.work (already shipped — may be closed)
  # Issue #7 — Dependabot setup-node PR #15
  # Issue 29 (per our earlier audit) — "chore(deps): resolve Dependabot PR #15"
  29
)

# ---- help wanted candidates (mid-size features, maintainer welcomes PRs) ----
$helpWanted = @(
  # Issue #22 / #32 — sel2pw + pw-emit merge
  22, 32,
  # Issue #23 / #33 — quarantine-stats --baseline
  23, 33,
  # Issue #28 — three domain packs (fintech / real-estate / hospitality)
  28,
  # Issue #27 — v4.8 API v2 (WebSocket / GraphQL / multipart)
  27,
  # Issue #26 — v4.7 apply-proposals interactive CLI
  26
)

Write-Host "`n== Tagging 'good first issue' =="
foreach ($n in $goodFirst) {
  Write-Host "  #$n"
  gh issue edit $n --repo $repo --add-label "good first issue" 2>&1 | Out-Null
}

Write-Host "`n== Tagging 'help wanted' =="
foreach ($n in $helpWanted) {
  Write-Host "  #$n"
  gh issue edit $n --repo $repo --add-label "help wanted" 2>&1 | Out-Null
}

Write-Host "`n== Done. Verify at: =="
Write-Host "   https://github.com/$repo/labels/good%20first%20issue"
Write-Host "   https://github.com/$repo/labels/help%20wanted"
