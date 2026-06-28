# DEPLOY_TESTING.ps1 — (re)build the SANDBOX "testing" Perspective project on the gateway from the
# repo. Experimental views land here FIRST, isolated from the live ConvSimpleLive project.
# Live-test at:  http://localhost:8088/data/perspective/client/testing
#
# RUN AS ADMINISTRATOR. Stop-service -> rebuild testing project -> start-service.
# The sandbox is DISPOSABLE: it is rebuilt fresh from the repo each run (source of truth = repo
# plc/ignition-project/testing/). It pulls the live diagnose script library from ConvSimpleLive so
# runScript("mira_diagnose.*") works identically to live. Does NOT touch ConvSimpleLive.

$ErrorActionPreference = "Stop"

$REPO_TEST = "C:\Users\hharp\Documents\GitHub\MIRA\plc\ignition-project\testing"
$REPO_LIVE = "C:\Users\hharp\Documents\GitHub\MIRA\plc\ignition-project\ConvSimpleLive"
$GW        = "C:\Program Files\Inductive Automation\Ignition\data\projects"
$TEST      = Join-Path $GW "testing"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $admin) { throw "NOT elevated. Re-run as Administrator." }
foreach ($p in @($REPO_TEST,$REPO_LIVE,$GW)) { if (-not (Test-Path $p)) { throw "missing path: $p" } }
Write-Host "[ok] elevated; repo + gateway found" -ForegroundColor Green

Write-Host "[..] stopping Ignition service"
Stop-Service Ignition
(Get-Service Ignition).WaitForStatus("Stopped", "00:01:00")
Write-Host "[ok] Ignition stopped" -ForegroundColor Green

try {
    # rebuild the testing project fresh (disposable sandbox)
    if (Test-Path $TEST) { Remove-Item $TEST -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $TEST | Out-Null
    Copy-Item (Join-Path $REPO_TEST "project.json") (Join-Path $TEST "project.json") -Force
    Copy-Item (Join-Path $REPO_TEST "com.inductiveautomation.perspective") $TEST -Recurse -Force
    Write-Host "[ok] testing project + perspective views rebuilt from repo"

    # pull the diagnose script library from ConvSimpleLive so runScript('mira_diagnose.*') works
    $sp = Join-Path $TEST "ignition\script-python"
    New-Item -ItemType Directory -Force -Path $sp | Out-Null
    Copy-Item (Join-Path $REPO_LIVE "ignition\script-python\*") $sp -Recurse -Force
    Write-Host "[ok] synced script-python (mira_diagnose) into testing"
}
finally {
    Write-Host "[..] starting Ignition service"
    Start-Service Ignition
    (Get-Service Ignition).WaitForStatus("Running", "00:02:00")
    Write-Host "[ok] Ignition running" -ForegroundColor Green
}

Write-Host ""
Write-Host "SANDBOX READY.  Open:  http://localhost:8088/data/perspective/client/testing" -ForegroundColor Cyan
Write-Host "Add experimental views under plc/ignition-project/testing/...perspective/views/ + a /route in its page-config, re-run this."
