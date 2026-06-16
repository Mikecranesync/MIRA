<#
.SYNOPSIS
    Drive the agent-controllable portion of the Phase 1 tester-install
    walkthrough. Runs SQL row-diffs, log filters, curl probes — captures
    everything into tools/web-review-runs/2026-MM-DD-tester-install/.

.DESCRIPTION
    Pairs with docs/wip/phase1-tester-install/WALKTHROUGH.md. The MD has
    the human-readable explanation; this script makes the agent-side
    steps push-button.

    Steps Mike still does by hand:
      - Step 1 click Install in Monday Dev Center sandbox
      - Step 1 HAR export from browser DevTools
      - Step 6 Monday admin audit-log screenshot
      - Step 8 click Uninstall in Monday admin

    Steps this script automates (when env is set):
      - Step 2 keystone probe (OAuth install endpoint)
      - Step 2 monday_installations row read
      - Step 3 backend session-token log filter
      - Step 4 mira_scan_queue row read
      - Step 5 account_usage_daily row read
      - Step 7 rate-limit burst test
      - Step 8 monday_installations revoked_at read

.PARAMETER TesterAccountId
    Numeric Monday account_id issued to the tester workspace.

.PARAMETER ReceiptsDir
    Directory under tools/web-review-runs/ for captured artifacts.
    Defaults to today's dated path.

.PARAMETER SkipBurst
    Skip Step 7 rate-limit burst (it consumes monthly chat quota).

.EXAMPLE
    doppler run --project factorylm --config prd -- `
      pwsh ./tools/scan-monday-walkthrough.ps1 -TesterAccountId 12345678
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$TesterAccountId,

    [string]$ReceiptsDir = "tools/web-review-runs/$(Get-Date -Format yyyy-MM-dd)-tester-install",

    [switch]$SkipBurst
)

$ErrorActionPreference = 'Stop'
$ApiBase = $env:MIRA_SCAN_API_BASE
if (-not $ApiBase) { $ApiBase = 'https://app.factorylm.com/api/scanbe' }
$NeonUrl = $env:NEON_DATABASE_URL
if (-not $NeonUrl) {
    Write-Error 'NEON_DATABASE_URL not set. Run via: doppler run -- pwsh ./tools/scan-monday-walkthrough.ps1 ...'
}

New-Item -ItemType Directory -Force -Path $ReceiptsDir | Out-Null
Write-Host "→ Receipts dir: $ReceiptsDir" -ForegroundColor Cyan
Write-Host "→ API base: $ApiBase" -ForegroundColor Cyan

function Save-Receipt {
    param([string]$Name, [string]$Body)
    $path = Join-Path $ReceiptsDir $Name
    Set-Content -Path $path -Value $Body -Encoding UTF8
    Write-Host "  saved $path" -ForegroundColor Green
}

function Invoke-Psql {
    param([string]$Sql)
    docker run --rm -e PGPASSWORD postgres:15 `
        psql $NeonUrl --no-psqlrc -A -t -c $Sql 2>&1
}

Write-Host "`n[2-keystone] Probing /oauth/monday/install" -ForegroundColor Yellow
$resp = curl.exe -sI "$ApiBase/oauth/monday/install"
Save-Receipt "02a-install-probe.txt" $resp
if ($resp -match 'HTTP/[12](\.[01])? 302') {
    Write-Host "  ✓ 302 — keystone PR landed" -ForegroundColor Green
    if ($resp -match 'location:\s*([^\r\n]+)') {
        $loc = [uri]::UnescapeDataString($Matches[1])
        Save-Receipt "02a-install-redirect-location.txt" $loc
        Write-Host "  Location: $loc" -ForegroundColor Cyan
    }
} else {
    Write-Warning "  Expected 302; got something else. Check PR #1557 deploy state."
    Write-Host $resp
}

Write-Host "`n[2] monday_installations row for tester $TesterAccountId" -ForegroundColor Yellow
$sql = @"
SELECT account_id, scope, user_id, installed_at, last_seen_at, revoked_at,
       subscription_status, LEFT(access_token, 10) AS token_prefix,
       LENGTH(access_token) AS token_len
  FROM monday_installations
 WHERE account_id = '$TesterAccountId';
"@
Save-Receipt "02-db-row-after-install.txt" (Invoke-Psql $sql)

Write-Host "`n[3] backend session logs (last 30m, filtered by account_id)" -ForegroundColor Yellow
$logs = ssh root@165.245.138.91 "docker logs mira-scan-backend --since 30m 2>&1 | grep -E 'account_id|session token|/kb/lookup|/chat/message' | head -100"
Save-Receipt "03-backend-session-logs.txt" $logs

Write-Host "`n[4] mira_scan_queue rows scoped to tester" -ForegroundColor Yellow
$sql = @"
SELECT id, make, model, status, tenant_id, source, first_seen
  FROM mira_scan_queue
 WHERE tenant_id = '$TesterAccountId'
 ORDER BY first_seen DESC
 LIMIT 10;
"@
Save-Receipt "04-scan-queue-rows.txt" (Invoke-Psql $sql)

Write-Host "`n[5] account_usage_daily row" -ForegroundColor Yellow
$sql = @"
SELECT account_id, usage_date, scan_count, chat_count, last_seen_at
  FROM account_usage_daily
 WHERE account_id = '$TesterAccountId'
   AND usage_date = CURRENT_DATE;
"@
Save-Receipt "05-usage-row.txt" (Invoke-Psql $sql)

if (-not $SkipBurst) {
    Write-Host "`n[7] rate-limit burst test (35 requests)" -ForegroundColor Yellow
    if (-not $env:MONDAY_TESTER_SESSION_TOKEN) {
        Write-Warning "  MONDAY_TESTER_SESSION_TOKEN not set — skipping burst. Capture from iframe DevTools."
    } else {
        $statuses = @()
        $token = $env:MONDAY_TESTER_SESSION_TOKEN
        for ($i = 1; $i -le 35; $i++) {
            $code = curl.exe -s -o NUL -w "%{http_code}" `
                -X POST "$ApiBase/chat/message" `
                -H "Content-Type: application/json" `
                -H "X-Monday-Session-Token: $token" `
                -d '{"message":"burst","history":[]}'
            $statuses += $code
            if ($code -eq '429') { break }
        }
        Save-Receipt "07-rate-limit-burst.txt" ($statuses -join "`n")
        if ($statuses -contains '429') {
            Write-Host "  ✓ 429 returned after $($statuses.Count) requests" -ForegroundColor Green
        } else {
            Write-Warning "  No 429 in 35 requests — rate-limit may not be firing"
        }
    }
}

Write-Host "`n[8] monday_installations after uninstall (revoked_at check)" -ForegroundColor Yellow
$sql = @"
SELECT account_id, revoked_at, last_seen_at, subscription_status
  FROM monday_installations
 WHERE account_id = '$TesterAccountId';
"@
Save-Receipt "08-db-row-after-uninstall.txt" (Invoke-Psql $sql)

Write-Host "`n→ Receipts under $ReceiptsDir" -ForegroundColor Cyan
Write-Host "→ Mike-side remaining: 01-oauth-callback.har, 04-assetcard-populated.png," -ForegroundColor Cyan
Write-Host "  06-monday-audit-log.png, 08-reinstall-redirect.png, plus REPORT.md" -ForegroundColor Cyan
