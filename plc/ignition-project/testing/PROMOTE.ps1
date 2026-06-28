# PROMOTE.ps1 — promote an APPROVED sandbox view from the testing project into the LIVE
# ConvSimpleLive project AND back into the repo (version control). Run after you live-test in
# the sandbox and approve it.
#
#   powershell -ExecutionPolicy Bypass -File PROMOTE.ps1 -View MaintenancePanel
#
# RUN AS ADMINISTRATOR. Stop-service -> copy view (gateway testing -> gateway live + repo) -> start.
# After this, COMMIT the repo change and (if it needs a URL) add the page route to ConvSimpleLive.

param([Parameter(Mandatory = $true)][string]$View)

$ErrorActionPreference = "Stop"

$GW        = "C:\Program Files\Inductive Automation\Ignition\data\projects"
$REPO_LIVE = "C:\Users\hharp\Documents\GitHub\MIRA\plc\ignition-project\ConvSimpleLive"
$srcView   = Join-Path $GW "testing\com.inductiveautomation.perspective\views\$View"
$gwLive    = Join-Path $GW "ConvSimpleLive\com.inductiveautomation.perspective\views\$View"
$repoLive  = Join-Path $REPO_LIVE "com.inductiveautomation.perspective\views\$View"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $admin) { throw "NOT elevated. Re-run as Administrator." }
if (-not (Test-Path $srcView)) { throw "view '$View' not found in the testing project ($srcView). Deploy + approve it in the sandbox first." }
Write-Host "[ok] promoting '$View' from sandbox -> live + repo" -ForegroundColor Green

Write-Host "[..] stopping Ignition service"
Stop-Service Ignition
(Get-Service Ignition).WaitForStatus("Stopped", "00:01:00")

try {
    # back up the live view if it already exists
    if (Test-Path $gwLive) {
        $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
        Copy-Item $gwLive "$gwLive.bak-$stamp" -Recurse -Force
        Write-Host "[ok] backed up existing live $View"
    }
    Copy-Item $srcView $gwLive -Recurse -Force
    Write-Host "[ok] copied $View -> live ConvSimpleLive (gateway)"
    Copy-Item $srcView $repoLive -Recurse -Force
    Write-Host "[ok] copied $View -> repo ConvSimpleLive (commit this)"
}
finally {
    Write-Host "[..] starting Ignition service"
    Start-Service Ignition
    (Get-Service Ignition).WaitForStatus("Running", "00:02:00")
    Write-Host "[ok] Ignition running" -ForegroundColor Green
}

Write-Host ""
Write-Host "PROMOTED '$View'. Next: (1) git add/commit the repo view; (2) if it needs a URL, add a page route" -ForegroundColor Cyan
Write-Host "to ConvSimpleLive/com.inductiveautomation.perspective/page-config/config.json; (3) verify on the live URL."
