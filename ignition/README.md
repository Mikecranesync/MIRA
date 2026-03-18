# MIRA — Ignition ConveyorMIRA Dashboard

**Target:** PLC Laptop (Windows, Ignition 8.1 Standard trial, `http://localhost:8088`)
**PLC:** Micro820 at `192.168.1.100:502` (Modbus TCP)

---

## Deploy on PLC Laptop — 3 Commands

Open PowerShell as Administrator:

```powershell
cd C:\Users\hharp\Documents\GitHub\MIRA
git pull origin main
PowerShell -ExecutionPolicy Bypass -File ignition\deploy_ignition.ps1
```

That script:
1. Confirms Ignition gateway is running
2. Finds the Ignition `data/projects/` directory automatically
3. Copies `ignition/project/` → `ConveyorMIRA` project folder
4. Triggers project rescan via REST
5. Imports all 36 tags via REST
6. Prints the Perspective URL

---

## First Time Only — Create Device Connection

Before deploying (or after if tags show Bad_NotFound):

`http://localhost:8088` → Config → OPC-UA → Device Connections → **Create New**

| Field | Value |
|-------|-------|
| Driver | Modbus TCP |
| Name | `Micro820_Conveyor` ← exact, case-sensitive |
| Hostname | `192.168.1.100` (try first) or `169.254.32.93` |
| Port | `502` |
| Unit ID | `1` |

Wait for **Connected** status before importing tags.

---

## Views

| View | URL | Purpose |
|------|-----|---------|
| ConveyorStatus | `/ConveyorMIRA` | State banner, VFD metrics, status pills |
| SpeedControl | — via NavBar | FWD/STOP/REV buttons, Hz slider |
| FaultLog | — via NavBar | Active fault + GS10 code reference |
| NavBar | embedded | Navigation + PLC live indicator |

---

## Tags (36 total)

| Type | Count | Example |
|------|-------|---------|
| Bool OPC (coils) | 20 | `Conveyor/Motor_Running` → C1 |
| Int OPC (registers) | 11 | `Conveyor/Conv_State` → HR400114 |
| Expression (scaled) | 5 | `Conveyor/VFD_Hz` = raw÷10 |

Writable: `VFD_CmdWord` (HR400115), `VFD_FreqSetpoint_Raw` (HR400116)

---

## VFD Command Reference

| Button | Value written to VFD_CmdWord | Meaning |
|--------|------------------------------|---------|
| FWD RUN | `18` (0x0012) | Run + Forward |
| STOP | `1` (0x0001) | Stop |
| REV RUN | `20` (0x0014) | Run + Reverse |
| CLEAR FAULTS | `2` (0x0002) | Fault reset |

---

## If Something's Wrong

| Symptom | Fix |
|---------|-----|
| Tags show `Bad_NotFound` | Device connection not created, or name ≠ `Micro820_Conveyor` |
| Tags show `Bad_NotConnected` | PLC not reachable — ping `192.168.1.100` and `169.254.32.93` |
| Views missing in Designer | Config → Projects → Scan File System |
| Script says "Gateway not responding" | Ignition not running — check tray icon |
| `fault_alarm = TRUE` | GS10 VFD keypad not programmed — see `plc/GS10_Integration_Guide.md` |
