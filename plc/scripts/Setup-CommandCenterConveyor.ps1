# Setup-CommandCenterConveyor.ps1 — PLC-laptop runbook for the Command Center
# conveyor green-tile goal. Run ELEVATED on the PLC laptop after pulling main.
#
# What it does (idempotent — re-runnable):
#   1. Ensures the Ignition gateway service is running.
#   2. Writes / merges C:\Program Files\Inductive Automation\Ignition\data\factorylm\factorylm.properties
#      with the prod ingest URL, tenant UUID, and the HMAC key you pass in.
#      Existing properties for unrelated keys are preserved; the four MIRA
#      keys are overwritten. A timestamped backup is created beside the file.
#   3. Probes http://localhost:8088 to confirm the gateway is reachable.
#   4. Starts (or refreshes) `tailscale funnel 8088` in background mode so the
#      Perspective conveyor view is reachable over public HTTPS at
#      https://<machine>.<tailnet>.ts.net.
#   5. Prints the resolved Funnel URL so it can be pasted back into the
#      Command Center runbook (display_endpoints seed step).
#
# Pre-reqs on the PLC laptop:
#   * Ignition installed at the default path (or pass -PropertiesPath).
#   * tag-stream.py timer script already deployed in the Ignition Designer
#     project script library (factorylm.collector). This script does NOT
#     deploy the timer — see docs/integrations/ignition-tag-collector.md
#     for the one-time install.
#   * approved_tags.json already in <ignition-data>/projects/factorylm/
#     (`ignition/project/approved_tags.json` in the repo).
#   * Tailscale installed + signed in. Funnel feature enabled in the tailnet
#     ACL (Tailscale Admin Console → Access Controls → "Funnel" allow rule).
#
# Usage (elevated PowerShell):
#   git pull
#   $hmac = Read-Host "Paste MIRA_IGNITION_HMAC_KEY" -AsSecureString
#   .\plc\scripts\Setup-CommandCenterConveyor.ps1 -HmacKey $hmac
#
# Or paste the key directly (less safe — appears in process args + history):
#   .\plc\scripts\Setup-CommandCenterConveyor.ps1 -HmacKey 'PLAIN_HEX_KEY'
#
# Verify-only (no writes, prints current state):
#   .\plc\scripts\Setup-CommandCenterConveyor.ps1 -VerifyOnly
#
# Logs to plc\scripts\setup-command-center-conveyor.log next to this file.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [object] $HmacKey,

    [string] $TenantId = '78917b56-f85f-43bb-9a08-1bb98a6cd6c3',

    [string] $IngestUrl = 'https://api.factorylm.com/api/v1/tags/ingest',

    [string] $StreamTagFolder = '[default]Mira_Monitored',

    [string] $PropertiesPath = 'C:\Program Files\Inductive Automation\Ignition\data\factorylm\factorylm.properties',

    [int] $TailscalePort = 8088,

    [switch] $VerifyOnly,

    [switch] $SkipFunnel
)

$ErrorActionPreference = 'Stop'
$logPath = Join-Path $PSScriptRoot 'setup-command-center-conveyor.log'
$script:logLines = @()

function Write-Log {
    param([string] $Message, [ValidateSet('INFO','WARN','ERROR','OK')][string] $Level = 'INFO')
    $stamp = Get-Date -Format o
    $line = "$stamp  [$Level]  $Message"
    $script:logLines += $line
    switch ($Level) {
        'OK'    { Write-Host $line -ForegroundColor Green }
        'WARN'  { Write-Host $line -ForegroundColor Yellow }
        'ERROR' { Write-Host $line -ForegroundColor Red }
        default { Write-Host $line }
    }
}

function Assert-Admin {
    $current = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $current.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'This script must be run from an elevated PowerShell. Right-click → Run as Administrator.'
    }
}

function ConvertTo-PlainHmac {
    # NOTE: param must NOT be named $Input — that collides with PowerShell's
    # automatic pipeline-enumerator variable and silently yields an empty string.
    param([Parameter(Mandatory)] [object] $Secret)
    if ($Secret -is [SecureString]) {
        $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secret)
        try   { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
        finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    }
    return [string] $Secret
}

function Mask-Secret {
    param([string] $Secret)
    if ([string]::IsNullOrEmpty($Secret)) { return '<empty>' }
    if ($Secret.Length -le 8) { return ('*' * $Secret.Length) }
    return $Secret.Substring(0,4) + ('*' * ($Secret.Length - 8)) + $Secret.Substring($Secret.Length - 4)
}

function Ensure-IgnitionRunning {
    $svc = Get-Service -Name 'Ignition' -ErrorAction SilentlyContinue
    if (-not $svc) {
        throw 'Ignition Windows service not found. Install the gateway or check the service name.'
    }
    if ($svc.Status -ne 'Running') {
        Write-Log "Ignition service is $($svc.Status). Starting..." 'WARN'
        if ($VerifyOnly) { Write-Log 'VerifyOnly set — skipping start.' 'WARN'; return }
        Start-Service -Name 'Ignition'
        (Get-Service 'Ignition').WaitForStatus('Running', '00:01:30')
    }
    Write-Log 'Ignition service: Running.' 'OK'
}

function Write-FactoryLMProperties {
    param(
        [string] $Path,
        [hashtable] $Properties
    )

    $dir = Split-Path -Parent $Path
    if (-not (Test-Path $dir)) {
        Write-Log "Creating $dir"
        if (-not $VerifyOnly) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    }

    $existing = @{}
    if (Test-Path $Path) {
        $backup = "$Path.bak.$(Get-Date -Format 'yyyyMMddHHmmss')"
        Write-Log "Backing up existing properties to $backup"
        if (-not $VerifyOnly) { Copy-Item -Path $Path -Destination $backup -Force }
        foreach ($line in Get-Content -Path $Path) {
            $trim = $line.Trim()
            if ($trim -eq '' -or $trim.StartsWith('#') -or $trim.StartsWith('!')) { continue }
            $eq = $trim.IndexOf('=')
            if ($eq -lt 1) { continue }
            $key = $trim.Substring(0,$eq).Trim()
            $val = $trim.Substring($eq + 1)
            $existing[$key] = $val
        }
    }

    foreach ($key in $Properties.Keys) {
        $existing[$key] = $Properties[$key]
    }

    $orderedKeys = @('INGEST_URL','TENANT_ID','MIRA_HMAC_KEY','STREAM_TAG_FOLDER','STREAM_MAX_RETRIES','STREAM_SOURCE_CONNECTION_ID') |
        Where-Object { $existing.ContainsKey($_) }
    foreach ($key in ($existing.Keys | Sort-Object | Where-Object { $orderedKeys -notcontains $_ })) {
        $orderedKeys += $key
    }

    $lines = @(
        '# factorylm.properties — written by plc/scripts/Setup-CommandCenterConveyor.ps1'
        "# Last written: $(Get-Date -Format o)"
        '# See docs/integrations/ignition-tag-collector.md for the full key reference.'
        ''
    )
    foreach ($key in $orderedKeys) {
        $lines += ('{0}={1}' -f $key, $existing[$key])
    }

    if ($VerifyOnly) {
        Write-Log "VerifyOnly — would write $($orderedKeys.Count) keys to $Path." 'WARN'
        foreach ($line in $lines) { Write-Host "    $line" }
        return
    }
    Set-Content -Path $Path -Value $lines -Encoding utf8
    Write-Log "Wrote $($orderedKeys.Count) keys to $Path." 'OK'
}

function Test-IgnitionLocal {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:$TailscalePort/StatusPing" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) {
            Write-Log "Gateway responded 200 at http://localhost:$TailscalePort/StatusPing." 'OK'
            return $true
        }
        Write-Log "Gateway returned HTTP $($resp.StatusCode) — investigate." 'WARN'
        return $false
    } catch {
        Write-Log "Gateway probe failed: $($_.Exception.Message)" 'WARN'
        return $false
    }
}

function Resolve-TailscaleExe {
    $candidates = @(
        'tailscale',
        'C:\Program Files\Tailscale\tailscale.exe',
        'C:\Program Files (x86)\Tailscale\tailscale.exe'
    )
    foreach ($c in $candidates) {
        try {
            $cmd = Get-Command $c -ErrorAction Stop
            return $cmd.Source
        } catch { continue }
    }
    return $null
}

function Start-TailscaleFunnel {
    param([int] $Port)

    if ($SkipFunnel) {
        Write-Log 'SkipFunnel set — leaving Funnel state unchanged.' 'WARN'
        return $null
    }

    $exe = Resolve-TailscaleExe
    if (-not $exe) {
        Write-Log 'Tailscale CLI not found. Install from https://tailscale.com/download/windows.' 'ERROR'
        return $null
    }

    if ($VerifyOnly) {
        Write-Log "VerifyOnly — would run: $exe funnel --bg $Port" 'WARN'
        return $null
    }

    # Tailscale 1.50+ changed the funnel CLI: clear prior config with
    # `funnel reset` (the legacy `funnel <port> off` now errors out).
    # Do NOT redirect native stderr here — under PS 5.1 + ErrorActionPreference=Stop
    # that wraps stderr in a terminating NativeCommandError. Relax EAP locally instead.
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $exe funnel reset | Out-Null
    Write-Log "Enabling Tailscale Funnel on port $Port..."
    & $exe funnel --bg $Port | Out-Null

    # Get the tailnet hostname so we can build the public URL.
    $statusJson = & $exe status --json
    $ErrorActionPreference = $prevEAP
    if (-not $statusJson) {
        Write-Log 'tailscale status --json returned nothing. Is Tailscale signed in?' 'WARN'
        return $null
    }
    $status = $statusJson | ConvertFrom-Json
    $dns = $status.Self.DNSName
    if (-not $dns) {
        Write-Log 'Could not resolve Self.DNSName from tailscale status.' 'WARN'
        return $null
    }
    $dns = $dns.TrimEnd('.')

    # Funnel terminates HTTPS at 443 by default for port 8088 → publish path /.
    $publicUrl = "https://$dns"
    Write-Log "Funnel active: $publicUrl  →  http://localhost:$Port" 'OK'

    # Verify upstream is reachable through Funnel (Tailscale itself may take a few seconds).
    Start-Sleep -Seconds 5
    try {
        $resp = Invoke-WebRequest -Uri "$publicUrl/StatusPing" -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) {
            Write-Log "Public Funnel probe returned 200 — green ring should light up." 'OK'
        } else {
            Write-Log "Public Funnel probe returned $($resp.StatusCode). Re-check ACL." 'WARN'
        }
    } catch {
        Write-Log "Public Funnel probe failed: $($_.Exception.Message). Funnel may still be propagating; retry in 30s." 'WARN'
    }

    return $publicUrl
}

try {
    Assert-Admin
    Write-Log "Setup-CommandCenterConveyor starting. VerifyOnly=$VerifyOnly  SkipFunnel=$SkipFunnel"

    if (-not $VerifyOnly -and -not $HmacKey) {
        $HmacKey = Read-Host -Prompt 'Paste MIRA_IGNITION_HMAC_KEY (hex from Doppler factorylm/prd)' -AsSecureString
    }

    $hmacPlain = if ($HmacKey) { ConvertTo-PlainHmac -Secret $HmacKey } else { '' }
    if (-not $VerifyOnly -and ($hmacPlain.Length -lt 32 -or $hmacPlain -notmatch '^[0-9a-fA-F]+$')) {
        throw 'HmacKey must be a hex string of at least 32 characters. Re-run with the value from Doppler.'
    }
    Write-Log "Tenant: $TenantId"
    Write-Log "IngestURL: $IngestUrl"
    Write-Log "Tag folder: $StreamTagFolder"
    Write-Log "HMAC: $(Mask-Secret $hmacPlain)"

    Ensure-IgnitionRunning

    $props = @{
        INGEST_URL         = $IngestUrl
        TENANT_ID          = $TenantId
        STREAM_TAG_FOLDER  = $StreamTagFolder
    }
    if ($hmacPlain) { $props['MIRA_HMAC_KEY'] = $hmacPlain }
    Write-FactoryLMProperties -Path $PropertiesPath -Properties $props

    $null = Test-IgnitionLocal

    $publicUrl = Start-TailscaleFunnel -Port $TailscalePort

    Write-Log '---' 'OK'
    if ($publicUrl) {
        Write-Log "NEXT — paste this URL back into the Command Center runbook chat:" 'OK'
        Write-Log "         $publicUrl" 'OK'
        Write-Log "         (display_endpoints row will be seeded with scheme=https, host=$(([uri]$publicUrl).Host), path=/data/perspective/client/ConvSimpleLive)" 'OK'
    } else {
        Write-Log 'NEXT — re-run after enabling Tailscale Funnel + signing in, or pass -SkipFunnel and configure routing yourself.' 'WARN'
    }

    if ($script:logLines) { Set-Content -Path $logPath -Value $script:logLines -Encoding utf8 }
    Write-Log "Log: $logPath" 'OK'
    exit 0
} catch {
    Write-Log $_.Exception.Message 'ERROR'
    if ($script:logLines) { Set-Content -Path $logPath -Value $script:logLines -Encoding utf8 }
    exit 1
}
