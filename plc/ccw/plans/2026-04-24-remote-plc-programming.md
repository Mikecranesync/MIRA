# Remote PLC Programming Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure the PLC laptop so the travel laptop can RDP in over Tailscale and program the Micro 820 without a human at the PLC laptop.

**Architecture:** The PLC laptop (LAPTOP-0KA3C70H) becomes a hardened Tailscale jump host. Travel laptop RDPs to its Tailscale IP (100.72.2.99) and drives CCW locally. The PLC stays on an isolated 192.168.1.0/24 point-to-point cable to the PLC laptop's Ethernet NIC, unreachable from anywhere else.

**Tech Stack:** Tailscale for Windows, Windows RDP (Remote Desktop Services), Windows Firewall, Sysinternals Autologon, CCW 22, PowerShell.

**Spec:** [specs/2026-04-24-remote-plc-programming-design.md](../specs/2026-04-24-remote-plc-programming-design.md)

**Artifacts produced:**
- `runbooks/remote-plc-programming.md` — operational runbook (edited as steps are executed, captures actual command output)
- Optional: `scripts/travel_laptop/ping_plc_laptop.ps1` — reachability probe if the 7-day test is automated

**Test philosophy for this plan:** there is no application code under test. "Test" = a verification command that confirms the intended system state, run before and after each change. Every step pair is (apply change) → (verify state). Roll back if verify fails; do not commit broken state.

**Execution environment:** Most steps run on the PLC laptop (LAPTOP-0KA3C70H) in an elevated PowerShell. For Chunk 1, reach it physically, via existing RDP on the home LAN, or via the remoteme endpoint at http://100.72.2.99:8765/shell. From Chunk 2 Task 4 onward, RDP over Tailscale should also work — prefer that.

**Rollback posture:** every config change in this plan is reversible with one command. Before moving on from any step, confirm the verify output matches expectations. If it doesn't, the spec's Break-glass procedure (Task 9) assumes physical access remains available.

---

## Chunk 1: Baseline verification + runbook scaffold

Before changing anything, confirm the current path works and record the starting state so later steps can be compared against it.

### Task 1: Create the runbook scaffold

**Files:**
- Create: `runbooks/remote-plc-programming.md`

- [ ] **Step 1: Write the scaffold**

```markdown
# Remote PLC Programming Runbook

**Spec:** [specs/2026-04-24-remote-plc-programming-design.md](../specs/2026-04-24-remote-plc-programming-design.md)
**Plan:** [plans/2026-04-24-remote-plc-programming.md](../plans/2026-04-24-remote-plc-programming.md)
**Status:** In progress

## Baseline (starting state)
_to be filled by Task 2_

## Tailscale persistence
_to be filled by Task 4_

## Windows availability
_to be filled by Task 5_

## RDP lockdown
_to be filled by Task 3 + Task 6_

## PLC subnet isolation
_to be filled by Task 7_

## Cold-boot verification
_to be filled by Task 8_

## 7-day unattended test
_to be filled by Task 10_

## Break-glass recovery
_to be filled by Task 9_
```

- [ ] **Step 2: Commit scaffold**

```bash
git add runbooks/remote-plc-programming.md
git commit -m "docs(runbook): scaffold remote PLC programming runbook"
```

### Task 2: Capture baseline state

**Files:**
- Modify: `runbooks/remote-plc-programming.md` — fill the Baseline section

- [ ] **Step 1: From travel laptop, confirm Tailscale reach**

Run: `tailscale ping 100.72.2.99`
Expected: pong within ~5 attempts, preferably `direct` not `derp`.

- [ ] **Step 2: Capture tailnet view**

Run: `tailscale status`
Expected: a row for `laptop-0ka3c70h` / `100.72.2.99`, no `expired` or `offline` flag.

- [ ] **Step 3: Attempt RDP**

Run: `mstsc /v:100.72.2.99`
Expected: credentials prompt → PLC laptop desktop. If it fails, record the failure mode in the runbook — Task 3 will enable RDP.

- [ ] **Step 4: On the PLC laptop, capture current config (elevated PowerShell)**

```powershell
Get-Service Tailscale, TermService | Select-Object Name, StartType, Status
Get-NetIPAddress -InterfaceAlias 'Ethernet' -AddressFamily IPv4 | Select-Object IPAddress, PrefixLength
Get-NetIPInterface | Where-Object Forwarding -eq 'Enabled' | Select-Object InterfaceAlias, AddressFamily
Get-NetFirewallRule -DisplayGroup 'Remote Desktop' | Select-Object DisplayName, Enabled, Direction, Profile, Action
powercfg /getactivescheme
Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled
```

Paste all output verbatim into the runbook Baseline section.

- [ ] **Step 5: Verify PLC reach from PLC laptop**

```powershell
Test-Connection -ComputerName 192.168.1.100 -Count 2
Test-NetConnection -ComputerName 192.168.1.100 -Port 502
Test-NetConnection -ComputerName 192.168.1.100 -Port 44818
```

Expected: ping answers, both ports `TcpTestSucceeded : True`. If this fails, STOP — the plan assumes the PLC is already reachable from the laptop (confirmed 2026-04-17 per `scripts/eip_list_identity.ps1`). Diagnose before continuing.

- [ ] **Step 6: Commit baseline**

```bash
git add runbooks/remote-plc-programming.md
git commit -m "docs(runbook): record baseline PLC laptop state"
```

**Chunk 1 exit criteria:**
- Runbook scaffold committed.
- Baseline section filled with actual command output.
- PLC confirmed reachable from PLC laptop (ports 502 + 44818 open).
- RDP status known (enabled or not).

---

## Chunk 2: Hardening

Five passes in order. Each pass is one task, one commit. Each task records its commands and before/after output in the runbook.

### Task 3: Enable RDP with NLA (skip if baseline Step 3 already connected)

**Files:**
- Modify: `runbooks/remote-plc-programming.md` — RDP lockdown section

- [ ] **Step 1: Apply change (elevated PowerShell on PLC laptop)**

```powershell
Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name fDenyTSConnections -Value 0
Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' -Name UserAuthentication -Value 1
Enable-NetFirewallRule -DisplayGroup 'Remote Desktop'
```

- [ ] **Step 2: Verify from travel laptop**

Run: `mstsc /v:100.72.2.99`
Expected: credential prompt → desktop.

If this fails: check `Get-Service TermService` is Running, inspect `Get-NetFirewallRule -DisplayGroup 'Remote Desktop' | Format-List`, do NOT proceed to Task 6 (firewall lockdown) until plain RDP works.

- [ ] **Step 3: Record in runbook** — commands run, the `fDenyTSConnections` and `UserAuthentication` values after, and the RDP connect outcome.

- [ ] **Step 4: Commit**

```bash
git add runbooks/remote-plc-programming.md
git commit -m "ops(plc-laptop): enable RDP with NLA"
```

### Task 4: Tailscale persistence

**Files:**
- Modify: `runbooks/remote-plc-programming.md` — Tailscale persistence section

- [ ] **Step 1: Enable Unattended Mode**

Tailscale tray icon → Preferences → check "Run unattended". Accept the UAC prompt.

Verify:
```powershell
& 'C:\Program Files\Tailscale\tailscale.exe' status --json | ConvertFrom-Json | Select-Object -ExpandProperty Self | Select-Object HostName, Online
```
Expected: `Online : True`.

Confirmation test: sign out of Windows on the PLC laptop, wait ~30 seconds, then from the travel laptop run `tailscale status`. The `100.72.2.99` row should still be `active` or `idle` (not offline). Sign back in when done.

- [ ] **Step 2: Disable key expiry**

Browser → https://login.tailscale.com/admin/machines. Find `laptop-0ka3c70h`. `...` menu → **Disable key expiry**. Confirm.

Verify: the machine row no longer shows an expiry date.

- [ ] **Step 3: Generate and store break-glass pre-auth key**

Admin console → Settings → Keys → **Generate auth key**. Options: Reusable ON, Ephemeral OFF, expiry as long as allowed (default 90d). Copy the key.

Save in your password manager under a clearly-named entry (e.g. "PLC laptop Tailscale break-glass"). **Do NOT commit the key anywhere in the repo.** Record the expiry date in the runbook so you rotate it before it lapses.

- [ ] **Step 4: Configure service auto-restart**

On PLC laptop (elevated):
```powershell
sc.exe failure Tailscale reset= 86400 actions= restart/5000/restart/5000/restart/5000
sc.exe qfailure Tailscale
```

Expected qfailure output: reset period 86400, 3 restart actions at 5000ms each.

- [ ] **Step 5: Record in runbook** — Unattended mode confirmed (with sign-out test result), key expiry disabled confirmation, break-glass key location (password manager entry name only, not the key itself), the full `sc qfailure Tailscale` output, and the pre-auth key expiry date.

- [ ] **Step 6: Commit**

```bash
git add runbooks/remote-plc-programming.md
git commit -m "ops(plc-laptop): harden Tailscale for unattended operation"
```

### Task 5: Windows availability

**Files:**
- Modify: `runbooks/remote-plc-programming.md` — Windows availability section

- [ ] **Step 1: Power plan (elevated)**

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 10
powercfg /hibernate off
powercfg /setacvalueindex SCHEME_CURRENT SUB_NONE CONSOLELOCK 0
powercfg /setactive SCHEME_CURRENT
```

Verify:
- `powercfg /query SCHEME_CURRENT SUB_SLEEP` — AC standby-timeout should be 0.
- `powercfg /query SCHEME_CURRENT SUB_NONE CONSOLELOCK` — AC value should be 0 (no password prompt on wake).

- [ ] **Step 2: Disable Fast Startup**

```powershell
Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled -Value 0
```

Verify: `Get-ItemProperty ... HiberbootEnabled` returns 0.

- [ ] **Step 3: Confirm service startup types**

```powershell
Set-Service -Name Tailscale -StartupType Automatic
Set-Service -Name TermService -StartupType Automatic
Get-Service Tailscale, TermService | Select-Object Name, StartType, Status
```

Expected: both Running, both Automatic.

Note: on some Windows SKUs `Set-Service` on `TermService` fails with "Access is denied" because it's a protected service. If that happens, use the registry equivalent instead:
```powershell
Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\TermService' -Name Start -Value 2
```
Then re-run the `Get-Service` verify — `TermService` should still show `StartType Automatic`.

- [ ] **Step 4: Configure Windows auto-login**

Download Sysinternals Autologon from https://learn.microsoft.com/en-us/sysinternals/downloads/autologon to `C:\Tools\Autologon64.exe`. Launch, enter the local Windows account username + password (leave Domain blank for a local account), click **Enable**.

The credential is stored encrypted in LSA Secrets. Do NOT paste it anywhere else.

No immediate verify — actual reboot-to-desktop behavior is verified in Task 8 cold-boot test.

- [ ] **Step 5: Record in runbook** — each applied change + verify output, and note auto-login is configured (without recording the credential).

- [ ] **Step 6: Commit**

```bash
git add runbooks/remote-plc-programming.md
git commit -m "ops(plc-laptop): Windows power and startup tuned for unattended operation"
```

### Task 6: RDP lockdown to Tailscale only

Locks RDP so only Tailscale peers can reach 3389. Home-LAN RDP attempts will start to fail after this step — that is the point.

**Files:**
- Modify: `runbooks/remote-plc-programming.md` — RDP lockdown section (append to Task 3 content)

- [ ] **Step 1: Confirm the Tailscale IP falls inside 100.64.0.0/10**

```powershell
& 'C:\Program Files\Tailscale\tailscale.exe' ip -4
```

Expected: `100.72.2.99` (or similar 100.64.x.x address). If the address is outside 100.64.0.0/10, STOP and flag — the Tailscale ACL / custom IP pool has been reconfigured and the firewall scope below must be adjusted.

- [ ] **Step 2: Apply scope change**

```powershell
Get-NetFirewallRule -DisplayGroup 'Remote Desktop' | Where-Object Direction -eq 'Inbound' | ForEach-Object {
    Set-NetFirewallRule -Name $_.Name -RemoteAddress '100.64.0.0/10'
}
```

- [ ] **Step 3: Verify the scope is set**

```powershell
Get-NetFirewallRule -DisplayGroup 'Remote Desktop' | Where-Object Direction -eq 'Inbound' |
    ForEach-Object { $_ | Select-Object DisplayName, @{N='RemoteAddress';E={($_ | Get-NetFirewallAddressFilter).RemoteAddress}} }
```

Expected: every inbound Remote Desktop rule shows `RemoteAddress = 100.64.0.0/10`.

- [ ] **Step 4: Prove the lockdown behaves correctly**

  - From travel laptop over Tailscale: `mstsc /v:100.72.2.99` — should still connect.
  - From any home-LAN machine (e.g. a phone on the same Wi-Fi, or the travel laptop after disconnecting Tailscale and joining the home Wi-Fi): try `mstsc /v:192.168.4.103` — should FAIL (time out or refused).

Record both outcomes in the runbook. If the home-LAN test succeeds, the firewall scope didn't stick — re-run Step 2 and re-verify.

- [ ] **Step 5: Commit**

```bash
git add runbooks/remote-plc-programming.md
git commit -m "ops(plc-laptop): restrict RDP to Tailscale CGNAT range"
```

### Task 7: PLC subnet isolation

**Files:**
- Modify: `runbooks/remote-plc-programming.md` — PLC subnet isolation section

- [ ] **Step 1: Check for parasitic APIPA and remove any address found**

```powershell
Get-NetIPAddress -InterfaceAlias 'Ethernet' -AddressFamily IPv4 | Format-Table IPAddress, PrefixLength
```

If any `169.254.x.x` appears alongside `192.168.1.50`, capture the actual address (it's randomized per-adapter, not necessarily `.100.1`) and remove it:
```powershell
$apipa = (Get-NetIPAddress -InterfaceAlias 'Ethernet' -AddressFamily IPv4 |
          Where-Object { $_.IPAddress -like '169.254.*' }).IPAddress
if ($apipa) {
    Write-Host "Removing parasitic APIPA: $apipa"
    netsh interface ipv4 delete address 'Ethernet' addr=$apipa
} else {
    Write-Host 'No parasitic APIPA present.'
}
```

Verify: re-run the initial `Get-NetIPAddress` command — only `192.168.1.50/24` should remain.

- [ ] **Step 2: Disable APIPA persistence on the Ethernet NIC**

```powershell
$guid = (Get-NetAdapter -Name 'Ethernet').InterfaceGuid
$path = "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\$guid"
Set-ItemProperty -Path $path -Name IPAutoconfigurationEnabled -Type DWord -Value 0
Get-ItemProperty -Path $path -Name IPAutoconfigurationEnabled
```

Expected: `IPAutoconfigurationEnabled : 0`.

- [ ] **Step 3: Confirm no IP forwarding between NICs**

```powershell
Get-NetIPInterface | Where-Object Forwarding -eq 'Enabled'
```

Expected: no output. If any interface shows Enabled forwarding, disable it:
```powershell
Set-NetIPInterface -InterfaceAlias '<alias>' -Forwarding Disabled
```
and re-run the query to confirm.

- [ ] **Step 4: Confirm PLC still reachable from PLC laptop (regression guard)**

```powershell
Test-NetConnection -ComputerName 192.168.1.100 -Port 44818
Test-NetConnection -ComputerName 192.168.1.100 -Port 502
```

Expected: both `TcpTestSucceeded : True`. If either fails, revert Steps 1-3 — the APIPA removal or forwarding change broke the cable path.

- [ ] **Step 5: Record in runbook** — commands + verify output for each substep.

- [ ] **Step 6: Commit**

```bash
git add runbooks/remote-plc-programming.md
git commit -m "ops(plc-laptop): isolate PLC subnet and disable APIPA persistence"
```

**Chunk 2 exit criteria:**
- RDP over Tailscale works; RDP from home LAN does not.
- Tailscale stays up across a Windows sign-out.
- Laptop does not sleep on AC; auto-login configured.
- PLC (192.168.1.100) still reachable from PLC laptop on ports 502 and 44818.
- All five tasks committed with runbook entries.

---

## Chunk 3: End-to-end verification

### Task 8: Cold-boot test

**Files:**
- Modify: `runbooks/remote-plc-programming.md` — Cold-boot verification section

- [ ] **Step 1: Cold power-cycle the PLC laptop**

Physical: hold the power button until the laptop is off, wait ~10 seconds, power on. Do NOT sign in; step away. Alternative if remote-only: `Restart-Computer -Force` from the existing RDP session (expect ~5 min before Step 2 will succeed).

- [ ] **Step 2: Wait 2 minutes, then from travel laptop**

```
tailscale ping 100.72.2.99
```

Expected: responds within a few pings. If it doesn't after 3 minutes total:
- Unattended mode may not be saved (check `Get-Service Tailscale` status and `tailscale status --json` once you're back in)
- Auto-login may have failed (laptop stuck at sign-in screen — Tailscale service should still be up though, so this usually isn't the cause of ping failure unless the service itself didn't start)
- Power is actually off (flip it back on physically)

- [ ] **Step 3: From travel laptop, RDP in**

`mstsc /v:100.72.2.99` → credential prompt → desktop.

- [ ] **Step 4: From the RDP session, open CCW and connect to the Micro 820**

Open the existing CCW solution (`MIRA_PLC.ccwsln`). Connection path `LAPTOP-0KA3C70H!AB_ETHIP-2\192.168.1.100` should still be valid. Go online, confirm no connection errors.

- [ ] **Step 5: Push a harmless round-trip change**

In CCW, modify a single rung comment in the existing program. Download to PLC. Go online, verify the changed comment is present. Revert the comment, download again. Trivial, reversible, but proves the full write path works from the travel laptop.

- [ ] **Step 6: Record in runbook**

- Time from power-on to RDP-ready (target: ≤2 minutes).
- Any issues encountered and their workarounds.
- CCW round-trip outcome (PASS/FAIL).

- [ ] **Step 7: Commit**

```bash
git add runbooks/remote-plc-programming.md
git commit -m "docs(runbook): cold-boot verification results"
```

### Task 9: Write the break-glass procedure

**Files:**
- Modify: `runbooks/remote-plc-programming.md` — Break-glass recovery section

- [ ] **Step 1: Write the procedure**

Content to paste:
```
When to use: Tailscale login state is lost on the PLC laptop (manually logged out,
node removed from admin console, device reset). Remote access is gone; only physical
access (or home-LAN RDP if it's still enabled) will work.

Requires: Physical or home-LAN access to the PLC laptop + the pre-auth key from
the password manager entry "PLC laptop Tailscale break-glass".

Steps:
  1. Sign in to Windows on the PLC laptop.
  2. Retrieve the pre-auth key from the password manager.
  3. Open elevated PowerShell and run:
       & 'C:\Program Files\Tailscale\tailscale.exe' up --authkey=<KEY> --unattended
  4. From the travel laptop, verify `tailscale status` shows laptop-0ka3c70h online.
  5. Clear clipboard history / any temp file that held the key.
  6. If the key is near expiry (check entry notes) or was single-use, generate a
     new key in the Tailscale admin console and update the password manager entry.
```

- [ ] **Step 2: Commit**

```bash
git add runbooks/remote-plc-programming.md
git commit -m "docs(runbook): break-glass Tailscale recovery procedure"
```

### Task 10: Start the 7-day unattended test

**Files:**
- Modify: `runbooks/remote-plc-programming.md` — 7-day unattended test section
- Optional Create: `scripts/travel_laptop/ping_plc_laptop.ps1`

- [ ] **Step 1: Record start time in runbook**

Note the exact timestamp you stop touching the PLC laptop — the 7-day window starts now.

- [ ] **Step 2: Pick a probe strategy**

  - **Option A (minimal):** once per day, manually run `tailscale ping 100.72.2.99` from the travel laptop and note the result in the runbook.
  - **Option B (automated):** Windows scheduled task on the travel laptop runs the probe hourly and appends to a log.

For Option A, skip to Step 4.

- [ ] **Step 3: If Option B, create the probe script**

**File:** `scripts/travel_laptop/ping_plc_laptop.ps1`
```powershell
$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$result = & 'C:\Program Files\Tailscale\tailscale.exe' ping --c 1 100.72.2.99 2>&1
Add-Content -Path "$PSScriptRoot\plc_laptop_reachability.log" -Value "$ts $result"
```

Register it via `Register-ScheduledTask`. Substitute `$scriptPath` below with the absolute path where you cloned this repo's `scripts/travel_laptop/ping_plc_laptop.ps1` — it must be an absolute path, not a relative one, since Scheduled Tasks run with no working directory context:
```powershell
$scriptPath = 'C:\Users\hharp\Documents\CCW\MIRA_PLC\scripts\travel_laptop\ping_plc_laptop.ps1'  # adjust to your actual path
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName 'PingPlcLaptop' -Action $action -Trigger $trigger
```

Commit the script:
```bash
git add scripts/travel_laptop/ping_plc_laptop.ps1
git commit -m "ops(travel-laptop): hourly Tailscale reachability probe"
```

- [ ] **Step 4: After 7 days, record the outcome in the runbook**

- Start timestamp, end timestamp.
- Total probe count, success count (Option B) or daily result list (Option A).
- Any visible gaps: duration and suspected cause.
- Final status: PASS if ≥99% of probes succeeded with no gap longer than 10 minutes; otherwise INVESTIGATE and document.

- [ ] **Step 5: Final commit**

```bash
git add runbooks/remote-plc-programming.md
git commit -m "docs(runbook): 7-day unattended test outcome"
```

**Chunk 3 exit criteria:**
- Cold-boot test passed and documented.
- Break-glass procedure written.
- 7-day unattended test complete, outcome recorded.
- All spec success criteria met:
  - Cold-boot-to-reachable ≤2 minutes, no human at the PLC laptop.
  - ≥7 consecutive days reachable with no intervention.
  - End-to-end CCW program push + read-back succeeded from the travel laptop.

---

## Post-completion notes

- Every command in Chunk 2 is idempotent and safe to re-run. The runbook is the install guide if the laptop is ever rebuilt.
- If the same hardening needs to be applied to a second machine later, factor the Chunk 2 commands into a single `scripts/plc_laptop_harden/apply.ps1` at that point — not now (YAGNI; you have one laptop).
- Break-glass key rotation is the only ongoing maintenance task. Calendar reminder for the key expiry date noted in Task 4 Step 3.
