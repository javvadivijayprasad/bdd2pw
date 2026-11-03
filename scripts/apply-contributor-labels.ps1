# apply-contributor-labels.ps1
#
# Brings bdd2pw's issue tracker to parity with sel2pw's labelling
# convention — the main reason contributors found sel2pw and haven't
# found bdd2pw. Enumerated per-issue from the 2026-10-28 audit of the
# then-20-open issues (14 unique + 4 duplicate pairs + 2 milestones
# listed-as-issues).
#
# Prereq: `gh auth status` logged in.
# Idempotent: `gh label create --force` and `gh issue edit --add-label`
# both tolerate repeat invocations.

$ErrorActionPreference = "Stop"
$repo = "javvadivijayprasad/bdd2pw"

Write-Host "== Step 1 — ensure labels exist =="
gh label create "good first issue" --color "7057ff" --description "Scoped work a newcomer can land in a single session" --repo $repo --force
gh label create "help wanted"       --color "008672" --description "Maintainer welcomes outside contributions on this" --repo $repo --force
gh label create "duplicate"         --color "cfd3d7" --description "Already exists as another issue"                   --repo $repo --force
gh label create "docs"              --color "0075ca" --description "Documentation only"                                --repo $repo --force
gh label create "chore"             --color "cfd3d7" --description "Repo plumbing — no behaviour change"               --repo $repo --force

# ------------------------------------------------------------------
# Step 2 — tag `good first issue` on the one truly small/scoped issue
# ------------------------------------------------------------------
# Only one of the current 14 is small enough to be a true first-timer
# landing: the Dependabot setup-node bump. Everything else is mid-size.
# The three *additional* small issues the newcomer funnel needs are
# opened by `scripts/open-newcomer-issues.ps1`.
Write-Host "`n== Step 2 — add 'good first issue' =="
gh issue edit 29 --repo $repo --add-label "good first issue"
# #29 — chore(deps): resolve Dependabot PR #15 (setup-node v4 → v7)

# ------------------------------------------------------------------
# Step 3 — tag `help wanted` on mid-size features where the maintainer
#          would welcome a PR but isn't blocking on one
# ------------------------------------------------------------------
Write-Host "`n== Step 3 — add 'help wanted' =="
$helpWanted = @(
  22,  # feat(v4.6): sel2pw + pw-emit merge
  23,  # feat: quarantine-stats --baseline
  24,  # feat: coverage — promotion regression detector
  25,  # feat: DOM-hash fallback
  26,  # feat: v4.7 apply-proposals interactive CLI
  27,  # feat: v4.8 API v2 (WebSocket/GraphQL/multipart)
  28,  # feat: v4.6 three domain packs (fintech/real-estate/hospitality)
  30,  # feat(v4.5): mobile dialect domain pack
  31   # feat(vscode-extension): v0.4.0 UI catch-up
)
foreach ($n in $helpWanted) {
  Write-Host "  #$n"
  gh issue edit $n --repo $repo --add-label "help wanted"
}

# ------------------------------------------------------------------
# Step 4 — mark duplicates. Each pair was opened twice (likely two
#          windows of the roadmap script). Keep the LOWER number
#          (filed first), close the duplicate, link them.
# ------------------------------------------------------------------
Write-Host "`n== Step 4 — mark & close duplicates =="

$duplicates = @(
  @{ dup = 32; original = 22; title = "sel2pw + pw-emit merge" },
  @{ dup = 33; original = 23; title = "quarantine-stats --baseline" },
  @{ dup = 34; original = 24; title = "coverage promotion regression detector" },
  @{ dup = 35; original = 25; title = "DOM-hash fallback on empty a11y tree" }
)
foreach ($d in $duplicates) {
  Write-Host "  #$($d.dup) → duplicate of #$($d.original) ($($d.title))"
  gh issue edit $d.dup --repo $repo --add-label "duplicate"
  gh issue close $d.dup --repo $repo --reason "not planned" --comment "Duplicate of #$($d.original). Closing in favour of the earlier filing; please track work on #$($d.original)."
}

# ------------------------------------------------------------------
# Step 5 — summary + verification URLs
# ------------------------------------------------------------------
Write-Host "`n== Done. Verify: =="
Write-Host "   good first issue → https://github.com/$repo/labels/good%20first%20issue"
Write-Host "   help wanted      → https://github.com/$repo/labels/help%20wanted"
Write-Host "   open issues      → https://github.com/$repo/issues (should drop by 4 after duplicates close)"
Write-Host ""
Write-Host "Next: run scripts/open-newcomer-issues.ps1 to add 3 scoped first-timer landing issues."
