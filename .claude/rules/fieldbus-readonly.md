# Fieldbus Discovery is Read-Only — and customer-shipped surfaces never touch the bus

`plc/discover.py` and any fieldbus *discovery* code MUST be strictly read-only.
Discovery's job is to **see** what's on the network/bus — never to change it.

**Wider scope (added 2026-06-01, audit task D5):** the read-only rule below
governs discovery. The *customer-shipped surface* has a stricter rule:
**no customer-shipped MIRA module ever opens a Modbus / EtherNet/IP / OPC-UA
socket to the plant.** Customer-side PLC reads go through Ignition (or the
future Sparkplug subscriber in `mira-connect`); customer-side PLC writes do
not exist. The two scripts that *do* write — `plc/live_monitor.py` (GS10 F/R/S/X
commands) and `plc/live-plc-bridge/bridge.py` (direct Modbus TCP poll from a
MIRA-named container) — are **bench/developer tools only**. They carry
prominent BENCH-ONLY headers, never appear in a customer-facing
docker-compose, and never get referenced from any path that ships in the
Ignition Module. See `docs/mira-ignition-secure-architecture.md` §8
anti-patterns #1, #4, and #6.

## Carve-out: the customer-run Drive Commander desktop (ADR-0025)

**A customer-run *local desktop* diagnostic app (Drive Commander) MAY open
supported *read-only* connections to supported drives on authorized plant
networks. This carve-out does NOT apply to MIRA cloud services or
MIRA-named containers** — the prohibition above (no MIRA cloud/container
component opens a Modbus / EtherNet/IP / OPC-UA socket to the plant) is
**unchanged**. The trust model is what differs: a local tool the customer
runs on their own maintenance laptop is the model that makes DriveExplorer /
DriveExecutive trusted; a cloud component reaching into the plant LAN is not.

The read-only discipline is **protocol-specific** — "read function codes only"
is a Modbus concept and does NOT map onto EtherNet/IP:

- **Modbus (TCP/RTU):** read-only **function codes only — FC1–FC4** (read coils,
  discrete inputs, holding registers, input registers). **Never FC5/6/15/16**
  (any write). RS-485/RTU still carries the two-master hazard above — needs the
  bus master offline or the app as sole master (`--serial-bus-idle` discipline).
- **EtherNet/IP:** use **read / status / identity-safe services only**. **Forbid**
  parameter writes, configuration writes, output-assembly writes, control-word
  writes, and **any service that can change drive state** (no `Set_Attribute*`,
  no forward-open for control, no assembly-instance writes). "Read FCs only" is
  not the EtherNet/IP model — enumerate safe services explicitly.

**Status (2026-07-05):** the Drive Commander desktop **connector is not built
yet** — ADR-0025 / PR #2481 ship the *pack architecture foundation* (pure data
reshaping), not a connector. When the connector lands it MUST honor the above
AND be added to the read-only gate (see `mira-bots/tests/test_drive_packs_readonly.py`)
or carry its own equivalent gate. Until then, no code exercises this carve-out.

> **TL;DR:** Discovery never writes. The Ethernet scan is fully side-effect-free. The
> RS-485 sweep is read-only but **not** safe on a live PLC-mastered bus (two-master
> contention can fault-stop a motor) — it requires `--serial-bus-idle`.

## Hard invariant

**Discovery never *writes*.** No register write, no IP/baud/param change, no command —
never. (Function-code level guarantee; see allowed/forbidden lists below.)

**…but read-only ≠ side-effect-free on a serial bus.** RS-485 Modbus is *single-master*.
Attaching `discover.py --serial` to a bus a PLC is actively mastering puts **two masters**
on the wire → electrical/frame contention → the PLC's polls CRC-fail. If they fail longer
than the drive's comm timeout (GS10 `P09.03` = 5 s), the VFD trips a comm fault (CE10) and
the ladder watchdog latches `fault_alarm`/`error_code=9` → `conv_state=FAULT` →
**motor stop**. Verified in `plc/Micro820_v4.1.9_Program.st` (the 5 s `vfd_err_timer`).
So a purely "read" sweep *can* fault-stop a conveyor by disrupting the real master —
without ever issuing a write.

**Therefore:**
- **Ethernet scan (Modbus/TCP, EtherNet/IP) is side-effect-free** — safe on any live
  network. TCP/UDP probes don't disrupt a master.
- **The RS-485 sweep must run with the bus master OFFLINE, or this adapter as the sole
  master.** `discover.py` REFUSES `--serial` unless `--serial-bus-idle` is passed to
  acknowledge this. Never sweep a live, PLC-mastered bus.

## Allowed (read) operations only

- TCP connect-then-close (port scan).
- EtherNet/IP **CIP List Identity** (UDP 44818) — identity query, no session, no write.
- Modbus **read** function codes only: FC1 (read coils), FC2 (read discrete inputs),
  FC3 (read holding registers), FC4 (read input registers).
- Serial read requests during the RS-485 sweep (FC3 only).

## Forbidden in discovery code

- Modbus **write** FCs: FC5, FC6, FC15, FC16 — never.
- Any CIP write / Set_Attribute / forward-open for control.
- Setting a device IP, baud, parity, slave address, or any parameter.
- Sending a control/command word, fault reset, or run/stop.
- BACnet WriteProperty, OPC-UA Write, S7 write — never.

Config-writes are a **separate, deliberate** concern. The pattern already exists:
`plc/deploy_modbus_map.py` writes config on purpose; `plc/live_monitor.py` only reads.
Keep `discover.py` in the read-only camp. If a future tool needs to *set* an IP or
baud, it is a new, explicitly-gated tool — not a flag on the scanner.

## Scan etiquette (also part of "read-only" in spirit)

Old field devices can choke even on reads if hammered. Discovery must:
- use a per-host connect timeout (default 1 s; `--gentle` doubles it),
- cap concurrency (default 64; `--gentle` halves it),
- not aggressively retry,
- leave polite inter-frame gaps on serial.

## When this applies

- `plc/discover.py` and any module that scans/identifies field devices.
- Any future "discovery"/"inventory"/"asset-detection" feature, including when its
  output feeds MIRA's UNS — discovery stays read-only even as a product capability,
  because it may run on a customer's live plant.

Aligns with `.claude/skills/mira-industrial-safety` and the MIRA SaaS scope guard
(no arbitrary PLC writes). Spec: `docs/specs/fieldbus-discovery-spec.md`.

## Bench-only PLC tools (extended scope, 2026-06-01)

These scripts write to the PLC or open Modbus sockets from a MIRA-named
container. They are bench/developer tools only and must stay out of every
customer-shipped surface:

| File | Why bench-only |
|---|---|
| `plc/live_monitor.py` | F/R/S/X commands write GS10 control words. Used to drive the bench during ladder development. |
| `plc/live-plc-bridge/bridge.py` | Direct Modbus TCP poll from a MIRA container. Right shape for the bench Fault-Detective demo; wrong shape for any customer install (would mean MIRA reaches into the plant LAN). |
| `plc/deploy_modbus_map.py` | Writes the Modbus address-map config to the PLC. Already understood as a deliberate config-write tool, not a runtime path. |

Rules for *anything new* under `plc/` or that touches a fieldbus:

1. **Customer-shipped paths read through Ignition (or `mira-connect` for Sparkplug).** Never `pymodbus`, `pycomm3`, `python-snap7`, `opcua`, or any other fieldbus client in a customer container or in the Ignition Module's WebDev / gateway-script code.
2. **Writes don't exist in the customer-shipped story.** If a future feature needs a write, it is a NEW, explicitly-gated, two-step-approved tool — not a flag on an existing module. See `docs/mira-ignition-secure-architecture.md` §4.2 "Writes require explicit two-step approval."
3. **Bench tools carry a BENCH-ONLY banner at the top of the file** (4-line ASCII box; both `live_monitor.py` and `live-plc-bridge/bridge.py` ship the standard header). The banner names the architecture doc and this rule.
4. **`docker-compose.fault-detective.yml` is a bench harness, not a customer architecture.** Its comments must say so; do not promote it to a customer install pattern.
5. **The Drive Commander desktop carve-out (above, ADR-0025) is the *only* customer-shipped read-only-fieldbus exception, and it is a *local desktop app* — not a container and not the Ignition Module.** Rule 1's ban on `pymodbus`/`pycomm3`/`python-snap7`/`opcua` still holds for any MIRA *container* or Ignition WebDev/gateway code. A read-only fieldbus client is permitted **only** inside the customer-run Drive Commander desktop, under the protocol-specific read-only discipline above, and its connector must be covered by the read-only gate.

Cross-reference: `docs/adr/0025-drive-intelligence-packs-and-drive-commander.md` (Drive Commander, the desktop carve-out, and the pack-architecture-foundation scope of PR #2481).
