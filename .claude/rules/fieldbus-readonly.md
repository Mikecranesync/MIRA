# Fieldbus Discovery is Read-Only

`plc/discover.py` and any fieldbus *discovery* code MUST be strictly read-only.
Discovery's job is to **see** what's on the network/bus — never to change it.

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
