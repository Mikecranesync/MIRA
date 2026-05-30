# Installs the ConvSimpleLive Perspective project into the local Ignition gateway.
# Must run elevated (writes to Program Files). Logs result next to this script.
$ErrorActionPreference = 'Stop'
$log = Join-Path $PSScriptRoot 'install.log'
try {
    $src = Join-Path $PSScriptRoot 'ConvSimpleLive'
    $dst = 'C:\Program Files\Inductive Automation\Ignition\data\projects\ConvSimpleLive'
    Copy-Item -Recurse -Force $src $dst
    $n = (Get-ChildItem $dst -Recurse -File).Count
    "OK installed $n files to $dst at $(Get-Date -Format o)" | Out-File -Encoding utf8 $log
} catch {
    "ERROR: $($_.Exception.Message)" | Out-File -Encoding utf8 $log
}
