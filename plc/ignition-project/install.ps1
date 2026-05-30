# Installs the ConvSimpleLive Perspective project into the local Ignition gateway.
# Must run elevated (writes to Program Files). Logs result next to this script.
$ErrorActionPreference = 'Stop'
$log = Join-Path $PSScriptRoot 'install.log'
try {
    $src = Join-Path $PSScriptRoot 'ConvSimpleLive'
    $dst = 'C:\Program Files\Inductive Automation\Ignition\data\projects\ConvSimpleLive'
    if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Path $dst -Force | Out-Null }
    Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force
    $n = (Get-ChildItem $dst -Recurse -File).Count
    "OK synced $n files to $dst at $(Get-Date -Format o)" | Out-File -Encoding utf8 $log
} catch {
    "ERROR: $($_.Exception.Message)" | Out-File -Encoding utf8 $log
}
