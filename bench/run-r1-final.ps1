# bdd2pw R1 final benchmark. Locks in Table 2 numbers and produces
# the 3-provider sensitivity table promised in Section 5 of the manuscript.
#
# Run this ONCE before manuscript resubmit. Output:
#   results/results-deterministic-v401.{md,json}   - baseline lock-in
#   results/results-llm-anthropic-v401.{md,json}   - Table 2 lock-in
#   results/results-llm-openai-v401.{md,json}      - sensitivity row 2
#   results/results-llm-gemini-v401.{md,json}      - sensitivity row 3
#
# Prerequisites:
#   1. cd to bench/ folder
#   2. ai-governance sidecar running on localhost:4900
#   3. Juice Shop running: docker compose up -d juice-shop
#   4. API keys set as env vars (Anthropic, OpenAI, Gemini)
#   5. v4.0.1 dist built: cd ..; npm run build; cd bench
#
# Total runtime: ~20 minutes. Total LLM cost: ~$0.27.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "`n=== bdd2pw R1 final benchmark ===" -ForegroundColor Cyan
Write-Host "Run started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n"

# 1. Sanity check version
Write-Host "[0/4] Checking installed bdd2pw version..." -ForegroundColor Yellow
$cliPath = Resolve-Path "..\dist\cli.js"
$version = & node $cliPath --version
if ($version -notmatch "4\.0\.1") {
    Write-Error "Expected bdd2pw v4.0.1 in ..\dist\cli.js but got: $version. Run 'cd ..; npm run build' first."
    exit 1
}
Write-Host "  v4.0.1 confirmed.`n" -ForegroundColor Green

# 2. Verify all 3 API keys are set
$missing = @()
if (-not $env:ANTHROPIC_API_KEY -or $env:ANTHROPIC_API_KEY.Length -lt 20) { $missing += "ANTHROPIC_API_KEY" }
if (-not $env:OPENAI_API_KEY    -or $env:OPENAI_API_KEY.Length    -lt 20) { $missing += "OPENAI_API_KEY" }
if (-not $env:GEMINI_API_KEY    -or $env:GEMINI_API_KEY.Length    -lt 20) { $missing += "GEMINI_API_KEY" }
if ($missing.Count -gt 0) {
    Write-Error "Missing API keys: $($missing -join ', '). Set them via the env var commands and re-run."
    exit 1
}
Write-Host "[0.5/4] All 3 API keys present.`n" -ForegroundColor Green

# 3. Verify governance sidecar is up
Write-Host "[0.7/4] Pinging governance sidecar..." -ForegroundColor Yellow
try {
    $resp = Invoke-WebRequest -Uri "http://localhost:4900/health" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    if ($resp.StatusCode -ne 200) { throw "Sidecar returned $($resp.StatusCode)" }
    Write-Host "  Sidecar responsive.`n" -ForegroundColor Green
} catch {
    Write-Error "Governance sidecar not reachable at http://localhost:4900. Start it via uvicorn before re-running."
    exit 1
}

# 4. Run #1: deterministic-only lock-in
Write-Host "[1/4] Run #1: deterministic-only baseline (no LLM)" -ForegroundColor Cyan
$t1 = Get-Date
npx ts-node runner.ts
if ($LASTEXITCODE -ne 0) { Write-Error "Run #1 failed."; exit 1 }
Copy-Item results\results.md  results\results-deterministic-v401.md  -Force
Copy-Item results\results.json results\results-deterministic-v401.json -Force
$d1 = (Get-Date) - $t1
Write-Host ("  Done in {0:N1} seconds.`n" -f $d1.TotalSeconds) -ForegroundColor Green

# 5. Run #2: Anthropic Claude Sonnet 4.6
Write-Host "[2/4] Run #2: --llm anthropic (Sonnet 4.6). Locks in Table 2." -ForegroundColor Cyan
$t2 = Get-Date
npx ts-node runner.ts --llm anthropic --llm-stats
if ($LASTEXITCODE -ne 0) { Write-Error "Run #2 failed."; exit 1 }
Copy-Item results\results.md  results\results-llm-anthropic-v401.md  -Force
Copy-Item results\results.json results\results-llm-anthropic-v401.json -Force
$d2 = (Get-Date) - $t2
Write-Host ("  Done in {0:N1} seconds.`n" -f $d2.TotalSeconds) -ForegroundColor Green

# 6. Run #3: OpenAI GPT-4o-mini
Write-Host "[3/4] Run #3: --llm openai (gpt-4o-mini)." -ForegroundColor Cyan
$t3 = Get-Date
npx ts-node runner.ts --llm openai --llm-stats
if ($LASTEXITCODE -ne 0) { Write-Error "Run #3 failed."; exit 1 }
Copy-Item results\results.md  results\results-llm-openai-v401.md  -Force
Copy-Item results\results.json results\results-llm-openai-v401.json -Force
$d3 = (Get-Date) - $t3
Write-Host ("  Done in {0:N1} seconds.`n" -f $d3.TotalSeconds) -ForegroundColor Green

# 7. Run #4: Google Gemini 2.5 Flash
Write-Host "[4/4] Run #4: --llm gemini (gemini-2.5-flash)." -ForegroundColor Cyan
$t4 = Get-Date
npx ts-node runner.ts --llm gemini --llm-stats
if ($LASTEXITCODE -ne 0) { Write-Error "Run #4 failed."; exit 1 }
Copy-Item results\results.md  results\results-llm-gemini-v401.md  -Force
Copy-Item results\results.json results\results-llm-gemini-v401.json -Force
$d4 = (Get-Date) - $t4
Write-Host ("  Done in {0:N1} seconds.`n" -f $d4.TotalSeconds) -ForegroundColor Green

# 8. Summary
Write-Host "`n=== R1 final benchmark complete ===" -ForegroundColor Cyan
Write-Host "Files written:" -ForegroundColor Yellow
Get-ChildItem results\*-v401.* | ForEach-Object {
    Write-Host "  $($_.FullName)"
}
Write-Host "`nNext step: paste the contents of:"
Write-Host "  results\results-llm-anthropic-v401.md"
Write-Host "  results\results-llm-openai-v401.md"
Write-Host "  results\results-llm-gemini-v401.md"
Write-Host "and the manuscript Table 2 + Table 4 will be updated.`n"
