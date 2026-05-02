<#
.SYNOPSIS
  Apply PLC-laptop hardening from plans/2026-04-24-remote-plc-programming.md

.DESCRIPTION
  Idempotent. Applies Tasks 3, 4 (sc-failure part), 5 (automatable parts),
  6, and 7 of the remote-PLC-programming plan. Must be run as Administrator.

  Safe to re-run. Each section prints what it did + a verify result.

  MANUAL steps NOT covered by this script (run them yourself):
    - Tailscale Unattended Mode (tray icon -> Preferences -> Run unattended)
    - Tailscale admin console: disable key expiry for laptop-0ka3c70h
    - Tailscale admin console: generate reusable pre-auth key; save to password manager
    - Sysinternals Autologon (Task 5 Step 4) to set Windows auto-login
#>

#Requires -RunAsAdministrator

$ErrorActionPreference = 'Stop'
$InformationPreference = 'Continue'

$transcriptPath = Join-Path $PSScriptRoot 'apply.last-run.log'
Start-Transcript -Path $transcriptPath -Force | Out-Null

function Section($title) {
    Write-Host ''
    Write-Host ('=' * 72)
    Write-Host "  $title"
    Write-Host ('=' * 72)
}

Section 'Pre-flight'
Write-Host "Hostname:             $env:COMPUTERNAME"
Write-Host "Tailscale IPv4:       $((& 'C:\Program Files\Tailscale\tailscale.exe' ip -4).Trim())"
Write-Host "PLC ping reachable:   $((Test-Connection -ComputerName 192.168.1.100 -Count 1 -Quiet))"

# -----------------------------------------------------------------------------
Section 'Task 3: Enable RDP with NLA'

Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' `
    -Name fDenyTSConnections -Value 0
Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' `
    -Name UserAuthentication -Value 1
Enable-NetFirewallRule -DisplayGroup 'Remote Desktop'

# Verify
$fDeny = (Get-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name fDenyTSConnections).fDenyTSConnections
$nla   = (Get-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' -Name UserAuthentication).UserAuthentication
Write-Host "fDenyTSConnections    = $fDeny (expected 0)"
Write-Host "UserAuthentication    = $nla (expected 1)"

# -----------------------------------------------------------------------------
Section 'Task 4 (sc-failure part): Tailscale service auto-restart'

& sc.exe failure Tailscale reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null
& sc.exe qfailure Tailscale

# -----------------------------------------------------------------------------
Section 'Task 5: Windows availability (power / fast-startup / services)'

# 5a: Power plan
& powercfg /change standby-timeout-ac 0
& powercfg /change hibernate-timeout-ac 0
& powercfg /change monitor-timeout-ac 10
& powercfg /hibernate off
& powercfg /setacvalueindex SCHEME_CURRENT SUB_NONE CONSOLELOCK 0
& powercfg /setactive SCHEME_CURRENT
Write-Host '(power tuned: no sleep / no hibernate / no console-lock on wake on AC)'

# 5b: Disable Fast Startup
Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' `
    -Name HiberbootEnabled -Value 0
$fs = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled).HiberbootEnabled
Write-Host "HiberbootEnabled      = $fs (expected 0)"

# 5c: Service startup types
Set-Service -Name Tailscale -StartupType Automatic
try {
    Set-Service -Name TermService -StartupType Automatic -ErrorAction Stop
} catch {
    Write-Host "Set-Service TermService failed ($_). Falling back to registry..."
    Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\TermService' -Name Start -Value 2
}
Get-Service Tailscale, TermService | Select-Object Name, StartType, Status | Format-Table -AutoSize

# -----------------------------------------------------------------------------
Section 'Task 6: RDP lockdown to Tailscale 100.64.0.0/10'

# Sanity-check Tailscale IP is actually inside the CGNAT range before tightening
$tsIp = (& 'C:\Program Files\Tailscale\tailscale.exe' ip -4).Trim()
if (-not ($tsIp -match '^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.')) {
    Write-Warning "Tailscale IP $tsIp is NOT inside 100.64.0.0/10. Skipping RDP lockdown to avoid locking you out."
} else {
    Get-NetFirewallRule -DisplayGroup 'Remote Desktop' |
        Where-Object Direction -eq 'Inbound' |
        ForEach-Object {
            Set-NetFirewallRule -Name $_.Name -RemoteAddress '100.64.0.0/10'
            Write-Host "Scoped rule: $($_.DisplayName)"
        }

    # Verify
    Get-NetFirewallRule -DisplayGroup 'Remote Desktop' |
        Where-Object Direction -eq 'Inbound' |
        ForEach-Object {
            $remote = ($_ | Get-NetFirewallAddressFilter).RemoteAddress
            [PSCustomObject]@{ Rule = $_.DisplayName; RemoteAddress = $remote }
        } | Format-Table -AutoSize
}

# -----------------------------------------------------------------------------
Section 'Task 7: PLC subnet isolation'

# 7a: Remove parasitic APIPA if present
$apipa = (Get-NetIPAddress -InterfaceAlias 'Ethernet' -AddressFamily IPv4 -ErrorAction SilentlyContinue |
          Where-Object { $_.IPAddress -like '169.254.*' }).IPAddress
if ($apipa) {
    Write-Host "Removing parasitic APIPA $apipa from Ethernet"
    & netsh interface ipv4 delete address 'Ethernet' addr=$apipa | Out-Null
} else {
    Write-Host 'No parasitic APIPA present.'
}

# 7b: Disable APIPA persistence on the Ethernet NIC
$guid = (Get-NetAdapter -Name 'Ethernet').InterfaceGuid
$nicPath = "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\$guid"
Set-ItemProperty -Path $nicPath -Name IPAutoconfigurationEnabled -Type DWord -Value 0
$apipaOff = (Get-ItemProperty -Path $nicPath -Name IPAutoconfigurationEnabled).IPAutoconfigurationEnabled
Write-Host "IPAutoconfigurationEnabled (Ethernet) = $apipaOff (expected 0)"

# 7c: IP forwarding check (no changes unless enabled somewhere)
$fwd = Get-NetIPInterface | Where-Object Forwarding -eq 'Enabled'
if ($fwd) {
    Write-Warning "IP forwarding enabled on the following interfaces. Disabling:"
    $fwd | Format-Table InterfaceAlias, AddressFamily -AutoSize
    $fwd | ForEach-Object { Set-NetIPInterface -InterfaceAlias $_.InterfaceAlias -AddressFamily $_.AddressFamily -Forwarding Disabled }
} else {
    Write-Host 'No IP forwarding enabled anywhere. Good.'
}

# -----------------------------------------------------------------------------
Section 'Final: regression check'

Write-Host 'Post-hardening state:'
Get-NetIPAddress -InterfaceAlias 'Ethernet' -AddressFamily IPv4 | Format-Table IPAddress, PrefixLength -AutoSize
(Test-NetConnection -ComputerName 192.168.1.100 -Port 502  -WarningAction SilentlyContinue) | Select-Object ComputerName, RemotePort, TcpTestSucceeded | Format-Table -AutoSize
(Test-NetConnection -ComputerName 192.168.1.100 -Port 44818 -WarningAction SilentlyContinue) | Select-Object ComputerName, RemotePort, TcpTestSucceeded | Format-Table -AutoSize
Get-Service Tailscale, TermService | Select-Object Name, StartType, Status | Format-Table -AutoSize

Write-Host ''
Write-Host 'Done. Now do the MANUAL steps:'
Write-Host '  1. Tailscale tray icon -> Preferences -> check "Run unattended"'
Write-Host '  2. https://login.tailscale.com/admin/machines -> laptop-0ka3c70h -> Disable key expiry'
Write-Host '  3. Settings -> Keys -> generate reusable auth key; save to password manager'
Write-Host '  4. (Optional) Sysinternals Autologon to configure Windows auto-login'

Stop-Transcript | Out-Null
