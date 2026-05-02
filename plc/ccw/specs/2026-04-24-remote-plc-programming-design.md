# Remote PLC Programming — Design

**Date:** 2026-04-24
**Status:** Approved (brainstorm)
**Scope:** Enable remote programming of the Micro 820 PLC from the travel laptop over Tailscale, keeping the PLC on an isolated subnet.

## Goal

Program the Allen-Bradley Micro 820 (2080-LC20-20QBB, static IP 192.168.1.100) from the travel laptop wherever it has internet, without exposing the PLC to the home LAN or the public internet.

## Non-goals

- Access from arbitrary third-party machines.
- Access for additional humans on the tailnet.
- Wake-on-LAN, LTE backup, or any secondary network path.
- Putting the PLC on the home LAN (option B in brainstorm). Rejected — PLC stays isolated.
- Installing CCW on the travel laptop. RDP-based remote use only.
- Mobile / phone-based CCW use.

## Architecture

```
[Travel laptop]  ──Tailscale──▶  [PLC laptop]  ──Eth cable──▶  [Micro 820]
 100.83.251.23                    100.72.2.99                    192.168.1.100
 mstsc (RDP client)               RDP host + CCW                 isolated /24,
                                  (jump host)                     no other devices
```

- **PLC laptop** (LAPTOP-0KA3C70H) is the single bridge. CCW runs there.
- **Travel laptop** needs only an RDP client and Tailscale — no CCW, no Rockwell software.
- **Point-to-point 192.168.1.0/24** between PLC laptop Ethernet NIC (192.168.1.50) and the PLC. No switch, no router, no other endpoints.
- **Home LAN** (192.168.4.0/24) and Tailscale tailnet (100.64.0.0/10) remain strictly separate from the PLC subnet. No IP forwarding between NICs.

## Components

### 1. Tailscale persistence on PLC laptop

The laptop must stay reachable without any human at the keyboard.

- **Unattended Mode** enabled (Tailscale tray → Preferences → Run unattended). Required so Tailscale runs without an interactive Windows session.
- **Key expiry disabled** for the PLC-laptop node in the Tailscale admin console. Prevents forced re-auth every 180 days.
- **Service auto-restart** on failure:
  `sc failure Tailscale reset=86400 actions=restart/5000/restart/5000/restart/5000`
- **Break-glass pre-auth key:** generate a reusable, non-expiring auth key; store encrypted in password manager. Used via `tailscale up --authkey=<key>` if auth state is ever lost and someone physically accesses the laptop.

### 2. Windows availability config

- Power plan: **never sleep / never hibernate on AC**, disable USB selective suspend.
- **Fast Startup OFF** (it defers NIC/service initialization in ways that break post-reboot network bring-up).
- Services `Tailscale` and `TermService` set to **Automatic**.
- **Auto-login** via Sysinternals `Autologon` (stores credential encrypted in LSA). Eliminates the "stuck at Windows sign-in screen" failure mode after an unattended reboot.

### 3. RDP enabled and locked down

- Remote Desktop enabled, **NLA required**.
- Windows Firewall inbound rule for TCP 3389: **allow only from 100.64.0.0/10** (Tailscale CGNAT range). Block from LAN and public scopes explicitly.
- Before trusting the firewall rule, verify the assigned Tailscale IPv4 actually falls inside 100.64.0.0/10: `tailscale ip -4` on the PLC laptop. If Tailscale is ever reconfigured with a custom IP pool, update the firewall rule accordingly.
- Strong password on the RDP user account.
- Optional hardening: Tailscale ACL restricting which tailnet nodes can reach port 3389 (currently a single-user tailnet, so low marginal value).

### 4. PLC subnet isolation preserved

- Ethernet NIC stays at 192.168.1.50/24, cabled direct to PLC at 192.168.1.100.
- Remove the parasitic APIPA: `netsh interface ipv4 delete address "Ethernet" addr=169.254.100.1`.
- Disable APIPA persistence on the Ethernet NIC via registry (`IPAutoconfigurationEnabled=0` under the NIC's `Tcpip\Parameters\Interfaces\{GUID}` key). Windows otherwise re-adds 169.254.x.x after driver reloads or cable-unplug events.
- Verify IP forwarding disabled across NICs: `Get-NetIPInterface | Where-Object Forwarding -eq Enabled` should return nothing relevant. Windows default is off; just confirm.

### 5. Verification / recovery runbook

Short operational doc covering:

- **Cold-boot test:** hard-power the PLC laptop → wait → from travel laptop, `tailscale ping 100.72.2.99` answers → RDP connects → CCW opens → PLC 192.168.1.100 reachable from the RDP session.
- **End-to-end programming test:** open CCW over RDP, change a rung comment, download to PLC, read back, verify.
- **7-day unattended test:** leave untouched for ≥7 days, confirm still reachable without intervention.
- **Break-glass procedure:** physical access + `tailscale up --authkey=<stored-key>`.

## Data flow

1. User on travel laptop launches `mstsc`, targets `100.72.2.99`.
2. Tailscale on both ends establishes WireGuard tunnel (direct if NAT allows, DERP-relayed otherwise).
3. Windows NLA authenticates user credentials; RDP session starts.
4. User opens CCW on the PLC laptop desktop, selects the existing project pointing at `LAPTOP-0KA3C70H!AB_ETHIP-2\192.168.1.100`.
5. CCW issues EtherNet/IP operations over the Ethernet NIC to 192.168.1.100. Traffic never touches Tailscale or Wi-Fi.
6. Downloads, online edits, and monitoring render back to the travel laptop as RDP pixels.

## Failure modes and mitigations

| Failure | Mitigation in design | Residual risk |
|---------|---------------------|---------------|
| User Windows session logs out | Unattended mode keeps Tailscale up | None |
| Tailscale key expires | Key expiry disabled on node | None (until node is manually removed) |
| Laptop reboots (Windows update) | Service auto-start + auto-login | Small window during reboot |
| Laptop sleeps / hibernates | Power plan disables both | None |
| Tailscale service crash | SC failure actions restart it | None for transient crashes |
| Home power outage | — | Accepted; kills any remote option |
| Home ISP outage | — | Accepted; kills any remote option |
| Laptop hardware failure | Break-glass via physical access | Accepted |
| Auth state lost (manual logout, admin console removal) | Pre-auth key for non-interactive recovery | Requires physical access |

## Success criteria

- **Cold-boot-to-reachable:** laptop hard-rebooted and idle, RDP session usable from travel laptop within 2 minutes, with no human at the PLC laptop.
- **Unattended duration:** laptop runs ≥7 consecutive days with no intervention, remaining RDP-reachable over Tailscale throughout.
- **Programming round-trip:** via the RDP session, push a CCW change to the PLC, read it back, confirm value — all from the travel laptop's physical location.

## Out of scope (future)

- Add a Raspberry Pi or Tailscale-capable router on the home LAN as a second always-on bridge. Decouples remote access from the PLC laptop's uptime.
- LTE or secondary-ISP failover for the home network.
- Wake-on-LAN triggered from VPS (Jarvis, 100.68.120.99) so a powered-down laptop can be woken remotely.
- Multi-user tailnet with ACLs restricting PLC-laptop access by identity.
