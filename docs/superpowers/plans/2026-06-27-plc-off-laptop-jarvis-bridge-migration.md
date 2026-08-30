# PLC Off Laptop Jarvis Bridge Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the garage conveyor/Micro820 demo away from laptop-direct Modbus/Ethernet dependency and toward a customer-realistic edge architecture.

**Architecture:** Treat the current Jarvis/PLC-laptop setup as a bench jump host and remote-control crutch, not a customer product component. Put the PLC on an OT Ethernet segment with an edge gateway/Ignition collector, publish telemetry outbound to MIRA relay, and keep any write/control path opt-in, bench-only, and PLC-human-accepted.

**Tech Stack:** Allen-Bradley Micro820, GS10 VFD, CCW, Modbus TCP/RTU, Ignition 8.3, `mira-relay`, SimLab, Tailscale for admin-only access, Windows PowerShell.

## Global Constraints

- Do not expose the PLC directly to the internet.
- Do not require Jarvis or the PLC laptop in a stranger/customer plant.
- Do not use laptop-local Modbus polling as the product path.
- Keep customer telemetry read-only by default.
- Preserve PLC authority for motor/VFD/safety logic.
- Any live discharge request write must be opt-in and write only `simlab_discharge_request`.
- Human acceptance at the bench remains required before conveyor motion.
- Do not reuse unverified PLC outputs for amber LED.
- Do not route plant OT traffic through the cloud.

---

## What Jarvis Is Today

Jarvis is a developer/demo bridge, not plant infrastructure. In the current demo shape it has acted as:

- A remote shell/file-control API on the PLC laptop, expected at `http://100.72.2.99:8765`.
- A way for Codex or the travel laptop to inspect/control the PLC laptop without full RDP.
- A convenient place to run local scripts that can reach the PLC at `192.168.1.100`.
- A demo crutch around the fact that the Micro820 is hardwired point-to-point to the laptop Ethernet NIC.

Current observation on the PLC laptop:

- The laptop hostname is `LAPTOP-0KA3C70H`.
- Tailscale ping to `100.72.2.99` works.
- TCP port `8765` is not listening.
- Ignition is listening locally on `8088`.
- The bench bridge file `plc/live-plc-bridge/bridge.py` explicitly says it is bench-only, direct Modbus, read-only, and never customer-shipped.

## Would A Stranger Plant Have Or Need Jarvis?

No. A stranger plant would normally have one or more of:

- Existing SCADA/HMI such as Ignition, FactoryTalk, WinCC, VTScada, Kepware, etc.
- An industrial edge gateway or IPC on the OT network.
- OPC UA, MQTT/Sparkplug B, database historian, or vendor driver access.
- A VPN/bastion controlled by their IT/OT policies.

They would not install a personal Jarvis shell bridge that lets an external AI session run laptop commands. That is useful for our bench, but it is not the sellable or trustable architecture.

## Why We Needed It

We needed Jarvis because the bench was physically shaped like this:

```text
Codex / travel laptop -> Tailscale -> PLC laptop -> Ethernet cable -> Micro820
                                         |
                                         +-> local scripts / Ignition / CCW
```

That let us build quickly with one laptop as jump host, engineering station, data collector, and remote-control target. It was practical for a garage demo. It is the wrong long-term boundary because it makes uptime, telemetry, and access depend on a Windows laptop and a direct cable.

## Target Architecture

```text
          Admin only                           OT network
   laptop/RDP/Tailscale  ---------------->  edge gateway / Ignition
                                                |
                                   industrial Ethernet switch
                                      |                     |
                                  Micro820              optional HMI
                                      |
                                  GS10 VFD over local RS-485

   edge gateway / Ignition -> outbound HTTPS/HMAC -> mira-relay -> MIRA apps
```

The PLC stays on an OT Ethernet network, but not laptop-point-to-point. The laptop becomes optional engineering access, not the runtime bridge.

---

### Task 1: Document Current Runtime And Kill The Jarvis Ambiguity

**Files:**
- Create: `docs/runbooks/plc-laptop-jarvis-inventory.md`

**Interfaces:**
- Consumes: local PowerShell checks and existing docs.
- Produces: one inventory doc that says exactly what is running, what is bench-only, and what is customer-like.

- [ ] **Step 1: Write the inventory doc**

Create `docs/runbooks/plc-laptop-jarvis-inventory.md`:

```markdown
# PLC Laptop Jarvis Inventory

Date: 2026-06-27

## Host

- Hostname: `LAPTOP-0KA3C70H`
- Tailscale IP: `100.72.2.99`
- PLC bench IP: `192.168.1.100`

## Current Observations

- `Test-NetConnection 100.72.2.99 -Port 8765`: ping succeeds, TCP fails.
- `Get-NetTCPConnection -State Listen`: Ignition listens on `8088`; Jarvis `8765` is not listening.
- `plc/live-plc-bridge/bridge.py`: bench-only direct Modbus polling; never customer-shipped.
- `docs/architecture/real-vs-simulated.md`: garage rig is real reads through developer bench tools; shipped path is Ignition read-only.

## Conclusion

Jarvis is a remote-control convenience for the demo laptop. It is not required in a customer plant and should not be part of the product architecture.
```

- [ ] **Step 2: Run the proof commands**

Run:

```powershell
hostname
Test-NetConnection 100.72.2.99 -Port 8765
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 8765,8088,502 }
```

Expected:

```text
LAPTOP-0KA3C70H
TcpTestSucceeded : False for 8765
8088 listening by java/Ignition
```

- [ ] **Step 3: Commit**

```powershell
git add docs/runbooks/plc-laptop-jarvis-inventory.md
git commit -m "docs: inventory plc laptop jarvis bridge"
```

---

### Task 2: Move The Bench Network From Point-To-Point Cable To OT Switch

**Files:**
- Create: `docs/runbooks/garage-conveyor-ot-network-cutover.md`

**Interfaces:**
- Consumes: Micro820 static IP `192.168.1.100`, current laptop Ethernet `192.168.1.50`, Ignition local gateway.
- Produces: physical cutover checklist and rollback.

- [ ] **Step 1: Write the cutover runbook**

Create `docs/runbooks/garage-conveyor-ot-network-cutover.md`:

```markdown
# Garage Conveyor OT Network Cutover

## Goal

Move the Micro820 off the laptop direct Ethernet cable and onto a small isolated OT Ethernet switch.

## Hardware

- 1 unmanaged industrial Ethernet switch, 5-port is enough.
- Micro820 Ethernet cable to switch.
- Edge gateway/Ignition machine Ethernet cable to switch.
- Optional engineering laptop cable to switch only during maintenance.

## Static IPs

| Device | IP |
|---|---|
| Micro820 | `192.168.1.100/24` |
| Edge gateway / Ignition | `192.168.1.10/24` |
| Engineering laptop, temporary | `192.168.1.50/24` |

No default gateway is required on the PLC OT segment.

## Cutover

1. Stop any running Modbus pollers.
2. Confirm conveyor stopped and safe.
3. Move the Micro820 Ethernet cable from laptop direct to the OT switch.
4. Connect edge gateway/Ignition NIC to the OT switch.
5. Set edge gateway OT NIC to `192.168.1.10/24`.
6. Ping `192.168.1.100` from the edge gateway.
7. Test Modbus TCP port from the edge gateway only.
8. Confirm CCW can still connect when engineering laptop is plugged into the switch.

## Rollback

1. Unplug Micro820 from switch.
2. Plug Micro820 back directly into PLC laptop Ethernet.
3. Set laptop Ethernet back to `192.168.1.50/24`.
4. Confirm `ping 192.168.1.100`.
```

- [ ] **Step 2: Verify before moving cables**

Run on the PLC laptop:

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.1.*" }
Test-NetConnection 192.168.1.100 -Port 502
```

Expected:

```text
Laptop has 192.168.1.50/24 or equivalent.
Micro820 port 502 is reachable before cutover.
```

- [ ] **Step 3: Commit**

```powershell
git add docs/runbooks/garage-conveyor-ot-network-cutover.md
git commit -m "docs: plan garage conveyor ot network cutover"
```

---

### Task 3: Make Ignition The Normal Bench Collector

**Files:**
- Modify: `docs/simlab/garage-conveyor-discharge-conveyor.md`
- Create: `docs/runbooks/ignition-garage-conveyor-collector.md`

**Interfaces:**
- Consumes: Ignition on `localhost:8088`, Micro820 at `192.168.1.100`, existing tag stream/relay design.
- Produces: an Ignition-first collector path that replaces Jarvis/laptop scripts for telemetry.

- [ ] **Step 1: Write the Ignition collector runbook**

Create `docs/runbooks/ignition-garage-conveyor-collector.md`:

```markdown
# Ignition Garage Conveyor Collector

## Goal

Use Ignition as the normal collector for the garage conveyor/Micro820, not Jarvis and not direct MIRA Modbus polling.

## Device

Create or verify an Ignition device:

- Driver: Micro800 if stable; otherwise Modbus TCP.
- Host: `192.168.1.100`
- Port: `502` for Modbus TCP.
- Poll rate: start at `1000 ms`; reduce only after stable.

## Tags

Expose only approved telemetry tags first:

- `green_start_pb`
- `photoeye_blocked`
- `photoeye_clear_30s`
- `bench_permissive_ok`
- `discharge_pending_acceptance`
- `discharge_accepted`
- `discharge_running`
- `discharge_complete`
- `discharge_rejected_or_faulted`
- `discharge_accept_timeout`
- `amber_led_flash`
- VFD health/readback tags
- E-stop and contactor state

## Relay

Use outbound Ignition tag stream to `mira-relay` with HMAC auth. Do not expose inbound PLC or Ignition ports to MIRA cloud.

## Writes

Default: no writes.

Bench-only optional write after PLC v4.2.0 is downloaded and tested:

- `simlab_discharge_request`
- optional `simlab_discharge_heartbeat`

No other write tags are allowed.
```

- [ ] **Step 2: Update SimLab doc with the new normal path**

Add this section to `docs/simlab/garage-conveyor-discharge-conveyor.md`:

```markdown
## Preferred Live Path

For customer-like operation, live garage conveyor telemetry should come through Ignition or an edge gateway, not Jarvis and not direct MIRA Modbus polling.

Preferred path:

`Micro820 -> OT switch -> Ignition/edge gateway -> outbound HMAC tag stream -> mira-relay -> MIRA`

The laptop direct-Modbus path remains bench-only.
```

- [ ] **Step 3: Commit**

```powershell
git add docs/runbooks/ignition-garage-conveyor-collector.md docs/simlab/garage-conveyor-discharge-conveyor.md
git commit -m "docs: make ignition preferred garage conveyor collector"
```

---

### Task 4: Add A No-Jarvis Preflight Script

**Files:**
- Create: `scripts/live/check_plc_edge_readiness.ps1`

**Interfaces:**
- Consumes: `PLC_HOST`, `IGNITION_URL`, and optional relay URL.
- Produces: PASS/FAIL checks proving the PLC can be reached without Jarvis.

- [ ] **Step 1: Write a failing smoke expectation**

Create `scripts/live/check_plc_edge_readiness.ps1`:

```powershell
param(
  [string]$PlcHost = "192.168.1.100",
  [int]$PlcPort = 502,
  [string]$IgnitionUrl = "http://127.0.0.1:8088"
)

$ErrorActionPreference = "Stop"

function Test-Port {
  param([string]$HostName, [int]$Port)
  $result = Test-NetConnection $HostName -Port $Port -WarningAction SilentlyContinue
  return [bool]$result.TcpTestSucceeded
}

$checks = [ordered]@{}
$checks["plc_modbus_tcp"] = Test-Port -HostName $PlcHost -Port $PlcPort

try {
  $response = Invoke-WebRequest -Uri $IgnitionUrl -UseBasicParsing -TimeoutSec 5
  $checks["ignition_http"] = ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
} catch {
  $checks["ignition_http"] = $false
}

$checks["jarvis_not_required"] = $true

$checks.GetEnumerator() | ForEach-Object {
  $status = if ($_.Value) { "PASS" } else { "FAIL" }
  Write-Output "$status $($_.Key)"
}

if ($checks.Values -contains $false) {
  exit 1
}
```

- [ ] **Step 2: Run the script**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/live/check_plc_edge_readiness.ps1
```

Expected before network cutover may be:

```text
PASS or FAIL plc_modbus_tcp
PASS ignition_http
PASS jarvis_not_required
```

The script exits `1` if the PLC is not reachable. That is useful before moving cables.

- [ ] **Step 3: Commit**

```powershell
git add scripts/live/check_plc_edge_readiness.ps1
git commit -m "test: add plc edge readiness preflight"
```

---

### Task 5: Decide The Customer Deployment Pattern

**Files:**
- Create: `docs/architecture/customer-plc-connectivity-patterns.md`

**Interfaces:**
- Consumes: current bench evidence and product constraints.
- Produces: decision document for demos and sales engineering.

- [ ] **Step 1: Write the decision doc**

Create `docs/architecture/customer-plc-connectivity-patterns.md`:

```markdown
# Customer PLC Connectivity Patterns

## Decision

MIRA does not require Jarvis in a customer plant.

## Supported Patterns

### Pattern A - Existing Ignition

Use the customer's existing Ignition gateway. Add read-only tags or WebDev/tag-export. Push outbound HMAC telemetry to MIRA relay.

### Pattern B - Edge Gateway

Install a small industrial PC on the OT network. It reads PLC/SCADA data locally and pushes outbound telemetry. This gateway can run Ignition Edge, Kepware, Node-RED, or a hardened MIRA collector depending on the site.

### Pattern C - MQTT/Sparkplug

If the plant already publishes Sparkplug B, subscribe to the broker or bridge a filtered namespace into MIRA relay.

## Not Supported As Product

- Jarvis remote shell bridge.
- Direct cloud-to-PLC Modbus.
- Customer PLC behind a random Windows laptop.
- MIRA container reaching into plant LAN without the customer's edge architecture.

## Writes

Default is read-only. Any write/control feature requires:

1. Explicit site approval.
2. Explicit tag allowlist.
3. PLC-side permissives.
4. Human confirmation where motion is possible.
5. Audit log.
```

- [ ] **Step 2: Commit**

```powershell
git add docs/architecture/customer-plc-connectivity-patterns.md
git commit -m "docs: define customer plc connectivity patterns"
```

---

## Execution Order

1. Task 1: confirm what Jarvis is and is not.
2. Task 2: physically decouple the PLC from laptop point-to-point Ethernet.
3. Task 3: make Ignition/edge gateway the normal telemetry collector.
4. Task 4: add a no-Jarvis readiness preflight.
5. Task 5: document customer deployment patterns.

## Acceptance Criteria

- PLC telemetry can be read from an edge gateway or Ignition without Jarvis running.
- PLC no longer depends on direct laptop Ethernet for normal runtime.
- Laptop is only for CCW engineering/RDP, not normal telemetry collection.
- MIRA receives live values through outbound relay or approved edge channel.
- Product docs clearly say Jarvis is not customer architecture.
- No live control write exists except the narrow bench-only `simlab_discharge_request` path, and only after PLC v4.2.0/human acceptance is verified.

## Self-Review

- Spec coverage: explains Jarvis, why it existed, whether customers need it, and how to move off laptop Modbus/Ethernet.
- Placeholder scan: no placeholder implementation steps.
- Type consistency: paths and commands are Windows/PowerShell and match current repo/laptop layout.
