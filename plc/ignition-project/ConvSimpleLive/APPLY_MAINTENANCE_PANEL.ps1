# APPLY_MAINTENANCE_PANEL.ps1 — deploy the Phase-2 Maintenance Intelligence Panel to the live
# ConvSimpleLive gateway. Stop-service -> write files -> merge route -> start-service.
# NEVER use the gateway web-UI "Project Import" (corrupts 8.3 projects).
#
# RUN AS ADMINISTRATOR:  right-click -> Run with PowerShell (as admin), or from an elevated shell:
#   powershell -ExecutionPolicy Bypass -File "<repo>\plc\ignition-project\ConvSimpleLive\APPLY_MAINTENANCE_PANEL.ps1"
#
# Idempotent + backs up before touching anything. Ref: DEPLOY_MAINTENANCE_PANEL.md

$ErrorActionPreference = "Stop"

$REPO = "C:\Users\hharp\Documents\GitHub\MIRA\plc\ignition-project\ConvSimpleLive"
$GW   = "C:\Program Files\Inductive Automation\Ignition\data\projects\ConvSimpleLive"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

# --- 0. preflight ---
if (-not (Test-Path $REPO)) { throw "repo path not found: $REPO" }
if (-not (Test-Path $GW))   { throw "gateway project not found: $GW" }
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $admin) { throw "NOT elevated. Re-run this script as Administrator." }
Write-Host "[ok] elevated; repo + gateway found" -ForegroundColor Green

# --- 1. backup config.json (the file we merge) ---
$cfgPath = Join-Path $GW "com.inductiveautomation.perspective\page-config\config.json"
Copy-Item $cfgPath "$cfgPath.bak-$stamp" -Force
Write-Host "[ok] backed up config.json -> config.json.bak-$stamp"

# --- 2. stop service ---
Write-Host "[..] stopping Ignition service"
Stop-Service Ignition
(Get-Service Ignition).WaitForStatus("Stopped", "00:01:00")
Write-Host "[ok] Ignition stopped" -ForegroundColor Green

try {
    # --- 3. script library (3 modules) ---
    $dst = Join-Path $GW "ignition\script-python"
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    Copy-Item (Join-Path $REPO "ignition\script-python\*") $dst -Recurse -Force
    Write-Host "[ok] copied script-python (mira_diagnose_core, mira_tag_map, mira_diagnose)"

    # --- 4. the three views ---
    $vdst = Join-Path $GW "com.inductiveautomation.perspective\views"
    foreach ($v in "MaintenancePanel","AnomalyCard","MiraAsk") {
        Copy-Item (Join-Path $REPO "com.inductiveautomation.perspective\views\$v") $vdst -Recurse -Force
        Write-Host "[ok] copied view $v"
    }

    # --- 5. MERGE the /maintenance route (preserve /AskMira, /trends, etc.) ---
    $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
    if (-not ($cfg.pages.PSObject.Properties.Name -contains "/maintenance")) {
        $page = [pscustomobject]@{ title = "Maintenance Intelligence"; viewPath = "MaintenancePanel"; docks = [pscustomobject]@{} }
        $cfg.pages | Add-Member -NotePropertyName "/maintenance" -NotePropertyValue $page
        ($cfg | ConvertTo-Json -Depth 20) | Set-Content $cfgPath -Encoding UTF8
        Write-Host "[ok] added /maintenance route"
    } else {
        Write-Host "[ok] /maintenance route already present (skipped)"
    }
}
finally {
    # --- 6. always restart, even if a copy step threw ---
    Write-Host "[..] starting Ignition service"
    Start-Service Ignition
    (Get-Service Ignition).WaitForStatus("Running", "00:02:00")
    Write-Host "[ok] Ignition running" -ForegroundColor Green
}

Write-Host ""
Write-Host "DONE. Open:  http://localhost:8088/data/perspective/client/ConvSimpleLive/maintenance" -ForegroundColor Cyan
Write-Host "(give the gateway ~30-60s to finish loading the project)"
