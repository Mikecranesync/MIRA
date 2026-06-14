# ROLLBACK.ps1 — revert the live ConvSimpleLive gateway to the PREVIOUS version
# (markdown-feed Maintenance panel + :8766 trend; NO nav bar, NO native chart).
# Undoes the 2026-06-14 native-trend + nav-bar deploy (commit 59a5d240).
#
# RUN AS ADMINISTRATOR. Stop-service -> restore files -> start-service.
# Idempotent-ish; safe to re-run.

$ErrorActionPreference = "Stop"

$GW   = "C:\Program Files\Inductive Automation\Ignition\data\projects\ConvSimpleLive"
$BK   = "C:\Users\hharp\Documents\MIRA-gateway-backups\ConvSimpleLive_pre-maintenance_20260614-082836"
$REPO = "C:\Users\hharp\Documents\GitHub\MIRA\plc\ignition-project\ConvSimpleLive"
$VWS  = Join-Path $GW "com.inductiveautomation.perspective\views"
$BVW  = Join-Path $BK "com.inductiveautomation.perspective\views"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $admin) { throw "NOT elevated. Re-run as Administrator." }
foreach ($p in @($GW,$BK,$REPO)) { if (-not (Test-Path $p)) { throw "missing path: $p" } }
Write-Host "[ok] elevated; gateway + backup + repo found" -ForegroundColor Green

Write-Host "[..] stopping Ignition service"
Stop-Service Ignition
(Get-Service Ignition).WaitForStatus("Stopped", "00:01:00")
Write-Host "[ok] Ignition stopped" -ForegroundColor Green

try {
    # 1. restore the original pre-session views from backup (removes nav links, restores :8766 Trends iframe)
    foreach ($v in "Trends","Conveyor","ConvSimpleLive") {
        Copy-Item (Join-Path $BVW "$v\*") (Join-Path $VWS $v) -Recurse -Force
        Write-Host "[ok] restored view $v from backup"
    }
    # 2. restore the PREVIOUS MaintenancePanel (markdown feed + :8766 iframe) from the staged git copy
    Copy-Item (Join-Path $REPO "rollback\MaintenancePanel_view.json") (Join-Path $VWS "MaintenancePanel\view.json") -Force
    Write-Host "[ok] restored MaintenancePanel to previous version"
    # 3. delete the new views that didn't exist before
    foreach ($v in "NavBar","TrendChart") {
        $d = Join-Path $VWS $v
        if (Test-Path $d) { Remove-Item $d -Recurse -Force; Write-Host "[ok] removed view $v" }
        else { Write-Host "[ok] view $v already absent" }
    }
    # 4. disable the tag history this session enabled
    Write-Host "[..] clearing tag history (disable_history.py)"
    & python (Join-Path $REPO "rollback\disable_history.py")
}
finally {
    Write-Host "[..] starting Ignition service"
    Start-Service Ignition
    (Get-Service Ignition).WaitForStatus("Running", "00:02:00")
    Write-Host "[ok] Ignition running" -ForegroundColor Green
}

Write-Host ""
Write-Host "ROLLBACK DONE. Open:  http://localhost:8088/data/perspective/client/ConvSimpleLive/maintenance" -ForegroundColor Cyan
Write-Host "(hard-refresh the browser; gateway needs ~30-60s)"
