# Remote PLC Programming Runbook

**Spec:** [specs/2026-04-24-remote-plc-programming-design.md](../specs/2026-04-24-remote-plc-programming-design.md)
**Plan:** [plans/2026-04-24-remote-plc-programming.md](../plans/2026-04-24-remote-plc-programming.md)
**Status:** Automated hardening applied 2026-04-24. Remaining verification + Task 4/5 manual steps tracked as GitHub issues Mikecranesync/MIRA #551–#559.

## Baseline (starting state)

**Captured:** 2026-04-24
**Host:** LAPTOP-0KA3C70H

### Tailscale
- Self: `100.72.2.99` (v4), `fd7a:115c:a1e0::7237:263` (v6), hostname `laptop-0ka3c70h`
- Service `Tailscale`: Running, StartType Automatic.
- Peer `miguelomaniac` (100.83.251.23, travel laptop): reachable, `tailscale ping` 22ms via direct path (192.168.4.35:41641).

### Incident discovered and fixed during baseline

The peer `pi-factory` (100.109.92.62, offline 50+ days) is persistently advertising `192.168.1.0/24` as a subnet route. When `--accept-routes` was enabled on this laptop (implicitly from a recent Tailscale reconnect), the tailnet subnet route won routing priority (metric 0) over the local Ethernet NIC's route (metric 10), and all traffic to the PLC was being tunneled into Tailscale instead of going out the direct cable. Result: PLC unreachable via ICMP and TCP, even though EIP List Identity broadcast still found it.

Fix applied:
```
"C:\Program Files\Tailscale\tailscale.exe" set --accept-routes=false
```

After fix: route for `192.168.1.0/24` goes via `Ethernet` (metric 10), ping returns in <1ms, TCP/502 and TCP/44818 both open.

This preference is persistent. Keep `--accept-routes=false` on the PLC laptop indefinitely — it is a jump host, not a consumer of subnet routes advertised by other peers.

### Services
| Name | StartType | Status | Note |
|------|-----------|--------|------|
| Tailscale | Automatic | Running | — |
| TermService | **Manual** | Running | Task 5 will set Automatic |

### Ethernet NIC
| IP | Prefix | PrefixOrigin | Note |
|----|--------|--------------|------|
| 192.168.1.50 | 24 | Manual | legit static for PLC subnet |
| 169.254.100.1 | 16 | Manual | parasitic APIPA; Task 7 cleanup |

Link: Up, 100 Mbps, Connected. MAC of PLC in ARP: `5c-88-16-d8-e4-d7` (matches memory).

### IP forwarding
No NIC has forwarding enabled. Good.

### RDP status (current)
- `fDenyTSConnections` = **1** → RDP connections currently **disabled**. Task 3 will enable.
- `UserAuthentication` = 1 → NLA already required (config present even though RDP is off).
- Firewall rules query returned Access Denied from non-elevated session — will verify in Task 3/6.

### Power
- Active power scheme: `b1bb486f-db87-4e9c-96aa-b85e8e2a5da4` ("My Custom Plan 1")
- `HiberbootEnabled` = **1** → Fast Startup ON. Task 5 will disable.

### PLC reachability from PLC laptop (after route fix)
- `ping 192.168.1.100`: 3/3 replies, <1ms.
- `Test-NetConnection ... -Port 502`: `TcpTestSucceeded : True`.
- `Test-NetConnection ... -Port 44818`: `TcpTestSucceeded : True`.
- `Find-NetRoute` shows source address `169.254.100.1` (the parasitic APIPA winning source-selection). Path still works, but Task 7's APIPA cleanup will also clean up source selection.

## Tailscale persistence

### accept-routes = false (applied during baseline)
`tailscale set --accept-routes=false` applied 2026-04-24 to work around the `pi-factory` subnet-route hijack (see Baseline > Incident). Persistent preference; keep this off.

### Service auto-restart on failure (Task 4 Step 4, applied via apply.ps1)
```
sc.exe failure Tailscale reset= 86400 actions= restart/5000/restart/5000/restart/5000
```
Verify output of `sc qfailure Tailscale`:
```
SERVICE_NAME: Tailscale
    RESET_PERIOD (in seconds)    : 86400
    FAILURE_ACTIONS              : RESTART -- Delay = 5000 milliseconds.
                                   RESTART -- Delay = 5000 milliseconds.
                                   RESTART -- Delay = 5000 milliseconds.
```

### Unattended Mode (Task 4 Step 1) — **manual, tracked in Mikecranesync/MIRA#551**
Tailscale tray icon → Preferences → check "Run unattended". UAC prompt; accept.

Verify after: sign out of Windows, wait ~30 seconds, from travel laptop run `tailscale status` — the `laptop-0ka3c70h` row should still be online (not offline). Sign back in.

### Disable key expiry (Task 4 Step 2) — **manual, tracked in Mikecranesync/MIRA#552**
Browser → https://login.tailscale.com/admin/machines → find `laptop-0ka3c70h` → `...` menu → Disable key expiry.

Verify after: the machine row in the admin console no longer shows an expiry date.

### Break-glass pre-auth key (Task 4 Step 3) — **manual, tracked in Mikecranesync/MIRA#553**
Admin console → Settings → Keys → Generate auth key. Options: **Reusable ON, Ephemeral OFF, expiry 90 days**. Copy the key. Save in password manager under entry "PLC laptop Tailscale break-glass". Record the expiry date below when done.

**Pre-auth key expiry recorded:** _(fill in after generating)_

## Windows availability
Applied 2026-04-24 via `scripts/plc_laptop_harden/apply.ps1`.

### Power plan
```
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 10
powercfg /hibernate off
powercfg /setacvalueindex SCHEME_CURRENT SUB_NONE CONSOLELOCK 0
powercfg /setactive SCHEME_CURRENT
```
Result: never sleep / never hibernate on AC; monitor blanks after 10 min; no password prompt on wake.

### Fast Startup
`HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power\HiberbootEnabled` = **0** (off).

### Service startup types
| Service | StartType | Status |
|---------|-----------|--------|
| Tailscale | Automatic | Running |
| TermService | Automatic | Running |

(Baseline showed TermService Manual; script switched it to Automatic without needing the registry fallback.)

### Windows auto-login (Task 5 Step 4 — optional, tracked in Mikecranesync/MIRA#554)
Not applied. To set up: download Sysinternals Autologon from https://learn.microsoft.com/en-us/sysinternals/downloads/autologon, launch, enter local account credentials, click Enable. Until then, a reboot will land at the Windows sign-in screen — Tailscale unattended mode (when enabled via Task 4) still keeps the tunnel up, but no one can open a desktop session until someone signs in once.

## RDP lockdown

### Task 3: Enable RDP with NLA
Applied 2026-04-24 via `scripts/plc_laptop_harden/apply.ps1` (elevated).

Commands:
```
Set-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name fDenyTSConnections -Value 0
Set-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' -Name UserAuthentication -Value 1
Enable-NetFirewallRule -DisplayGroup 'Remote Desktop'
```

Verify (post-apply):
- `fDenyTSConnections` = **0** (RDP allowed).
- `UserAuthentication` = **1** (NLA required).
- Port 3389 listening on `0.0.0.0` and `::` (both IPv4/IPv6), State = Listen.
- End-to-end connect test from travel laptop (`mstsc /v:100.72.2.99`): tracked in Mikecranesync/MIRA#555.

### Task 6: Scope RDP to Tailscale only
Applied 2026-04-24 via `scripts/plc_laptop_harden/apply.ps1`.

Pre-check: Tailscale self-IPv4 = `100.72.2.99`, inside `100.64.0.0/10` ✓.

Three inbound rules scoped:
| Rule | RemoteAddress |
|------|---------------|
| Remote Desktop - User Mode (TCP-In) | `100.64.0.0/255.192.0.0` |
| Remote Desktop - User Mode (UDP-In) | `100.64.0.0/255.192.0.0` |
| Remote Desktop - Shadow (TCP-In)    | `100.64.0.0/255.192.0.0` |

Negative test (RDP from home LAN must fail): tracked in Mikecranesync/MIRA#556.

## PLC subnet isolation
Applied 2026-04-24 via `scripts/plc_laptop_harden/apply.ps1`.

### APIPA cleanup
- Parasitic `169.254.100.1/16` removed from Ethernet NIC via
  `netsh interface ipv4 delete address Ethernet addr=169.254.100.1`.
- Persistence disabled via registry:
  `HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{GUID}\IPAutoconfigurationEnabled = 0`
  so Windows will not auto-assign 169.254.x.x on Ethernet after driver reloads or cable unplug events.

Post-apply NIC state: only `192.168.1.50/24` on the Ethernet adapter.

### IP forwarding
`Get-NetIPInterface | Where-Object Forwarding -eq 'Enabled'` returned empty. No bridging between Tailscale, Wi-Fi, and the PLC subnet.

### Regression guard — PLC still reachable
- `Test-NetConnection -ComputerName 192.168.1.100 -Port 502`: `TcpTestSucceeded : True`.
- `Test-NetConnection -ComputerName 192.168.1.100 -Port 44818`: `TcpTestSucceeded : True`.

## Cold-boot verification
Tracked in Mikecranesync/MIRA#557. Run after the three Task 4 manual steps are done.

## 7-day unattended test
Tracked in Mikecranesync/MIRA#558. Start after cold-boot verification passes.

## Break-glass recovery

**When to use:** Tailscale login state is lost on the PLC laptop (manually logged out, node removed from admin console, device reset). Remote access is gone; only physical access (or home-LAN RDP if it's still enabled — it is not, after Task 6) will work.

**Requires:** Physical access to the PLC laptop + the pre-auth key from the password manager entry *"PLC laptop Tailscale break-glass"*.

**Steps:**
1. Sign in to Windows on the PLC laptop.
2. Retrieve the pre-auth key from the password manager.
3. Open elevated PowerShell and run:
   ```
   & 'C:\Program Files\Tailscale\tailscale.exe' up --authkey=<KEY> --unattended
   ```
4. From the travel laptop, verify `tailscale status` shows `laptop-0ka3c70h` online at `100.72.2.99`.
5. Clear clipboard history / any temp file that held the key.
6. If the key is near expiry (check password-manager entry notes) or was single-use, generate a new key in the Tailscale admin console and update the password-manager entry.

**Collateral to check after recovery:**
- `tailscale set --accept-routes=false` is still in effect (re-running `tailscale up --authkey=...` does not reset this pref, but verify with `Get-NetRoute -DestinationPrefix '192.168.1.0/24'` that no Tailscale route exists for the PLC subnet).
- RDP from travel laptop works end-to-end.
