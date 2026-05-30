# Deploys the ConvSimpleLive Perspective project + VFD tags into the local
# Ignition gateway and restarts it so the changes load.
# Must run ELEVATED (writes to Program Files, controls the Ignition service).
# Logs result next to this script.
#
# Ordering: Stop service -> copy resources -> Start service. The gateway persists
# config to its resource files on shutdown, so we must write the files while it is
# stopped or they get clobbered.

$ErrorActionPreference = 'Stop'
$log = Join-Path $PSScriptRoot 'install.log'
$lines = @()
function Log($m) { $script:lines += "$(Get-Date -Format o)  $m"; Write-Host $m }

try {
    $igData   = 'C:\Program Files\Inductive Automation\Ignition\data'
    $projSrc  = Join-Path $PSScriptRoot 'ConvSimpleLive'
    $projDst  = Join-Path $igData 'projects\ConvSimpleLive'
    $tagsSrc  = Join-Path $PSScriptRoot 'tags\MIRA_IOCheck\VFD'
    $tagsDst  = Join-Path $igData 'config\resources\core\ignition\tag-definition\default\MIRA_IOCheck\VFD'

    Log "Stopping Ignition service..."
    Stop-Service -Name 'Ignition' -Force
    (Get-Service 'Ignition').WaitForStatus('Stopped', '00:01:00')
    Log "Stopped."

    Log "Syncing project -> $projDst"
    if (-not (Test-Path $projDst)) { New-Item -ItemType Directory -Path $projDst -Force | Out-Null }
    Copy-Item -Path (Join-Path $projSrc '*') -Destination $projDst -Recurse -Force

    Log "Syncing VFD tags -> $tagsDst"
    if (-not (Test-Path $tagsDst)) { New-Item -ItemType Directory -Path $tagsDst -Force | Out-Null }
    Copy-Item -Path (Join-Path $tagsSrc '*') -Destination $tagsDst -Recurse -Force

    Log "Starting Ignition service..."
    Start-Service -Name 'Ignition'
    (Get-Service 'Ignition').WaitForStatus('Running', '00:02:00')
    Log "Started. Gateway is booting (Perspective takes ~30-60s to come up)."

    $pn = (Get-ChildItem $projDst -Recurse -File).Count
    $tn = (Get-ChildItem $tagsDst -Recurse -File).Count
    Log "OK: $pn project files, $tn VFD tag files deployed."
} catch {
    Log "ERROR: $($_.Exception.Message)"
} finally {
    $lines | Out-File -Encoding utf8 $log
}
