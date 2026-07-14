# Registers the bench trend historian as a BOOT-SCOPED Windows Scheduled Task on the
# PLC laptop, so the TRENDS tab (:8766) survives reboots and logoffs.
#
# Why boot-scoped (per DEPLOY.md): a Startup-folder or "At log on" launcher is
# logon-scoped — it dies the moment the user logs out. The correct always-on
# mechanism is Trigger "At startup" + "Run whether user is logged on or not"
# + restart-on-failure. Registering that requires administrator rights.
#
# Run from an elevated PowerShell (gsudo works):
#   gsudo powershell -ExecutionPolicy Bypass -File .\install_trend_historian_task.ps1
#
# Idempotent: re-running replaces the existing task.

$ErrorActionPreference = "Stop"

$taskName = "MIRA Trend Historian"
$batPath  = "C:\Users\hharp\Documents\MIRA-monorepo\plc\conv_simple_anomaly\run_trend_historian.bat"

if (-not (Test-Path $batPath)) {
    throw "Launcher not found at $batPath — pull the monorepo first (git -C C:\Users\hharp\Documents\MIRA-monorepo pull)."
}

$action   = New-ScheduledTaskAction -Execute $batPath
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# SYSTEM = runs whether or not anyone is logged on, no password prompt.
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal | Out-Null

Start-ScheduledTask -TaskName $taskName

Start-Sleep -Seconds 5
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8766/health" -TimeoutSec 10
    Write-Host "OK: task '$taskName' registered and historian is answering /health:" -ForegroundColor Green
    $health | ConvertTo-Json -Depth 3 | Write-Host
    Write-Host "Remote check (from any tailnet machine): curl http://100.72.2.99:8766/health"
} catch {
    Write-Warning "Task registered but /health not answering yet. Check the log:"
    Write-Warning "  Get-Content $env:LOCALAPPDATA\mira-trend-historian.log -Tail 20"
    Write-Warning "Common cause: live_logger.py / live_check.py holding the PLC Modbus slot."
}
