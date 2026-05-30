---
name: fieldbus-discovery
description: >
  Use when discovering, identifying, or commissioning industrial field devices on a
  network or RS-485 bus — PLCs, VFDs, sensors, gateways. Trigger on: "what's on this
  network / bus", "find the PLC/VFD", "scan for Modbus/EtherNet-IP devices", "is the
  GS10 talking", "what baud/parity is this serial device", RS-485 commissioning, or any
  Modbus/EtherNet-IP/CIP register-meaning question. Carries the codified fieldbus
  knowledge (so we stop re-teaching ourselves Modbus) and drives plc/discover.py.
---

# Fieldbus Discovery

The read-only way to answer "what field devices are on this network/bus, and what are
they?" — plus the codified Modbus/EtherNet-IP/RS-485 knowledge we kept relearning while
bringing up the Micro820 + GS10 cell.

**Tool:** `plc/discover.py` (read-only) · **Data:** `device-profiles/*.yaml`
**Command:** `/discover-fieldbus` · **Rule:** `.claude/rules/fieldbus-readonly.md`
**Spec:** `docs/specs/fieldbus-discovery-spec.md`

## First: it is READ-ONLY

Discovery only ever *sees* — TCP connect, CIP List Identity, Modbus **read** FCs. It
never writes a register, sets an IP/baud, or sends a command. A motor must never move
because of a scan. Config-writes are separate, deliberate tools (`deploy_modbus_map.py`).
See `.claude/rules/fieldbus-readonly.md`.

## Run it

```bash
# auto-detect subnet, deep + shallow probes, write inventory.json
python plc/discover.py

# explicit subnet + RS-485 sweep for the GS10
# NOTE: --serial REQUIRES --serial-bus-idle (RS-485 is single-master; see below).
python plc/discover.py --subnet 192.168.1.0/24 \
    --serial /dev/tty.usbserial-XXXX --serial-bus-idle

# one host, Modbus/TCP + EtherNet/IP only
python plc/discover.py --host 192.168.1.100 --deep-only

# see the plan without probing
python plc/discover.py --subnet 192.168.1.0/24 --dry-run
```

Output: a `rich` table + a resume-shaped `inventory.json` (see spec §8).

## How identification works (3 tiers)

1. **port_open** — TCP/UDP answered.
2. **protocol_confirmed** — it actually speaks the protocol (valid Modbus read / CIP reply).
3. **device_identified** — a `device-profiles/*.yaml` `fingerprint` matched → name +
   register map + commissioning gotchas attached.

The profile library is the shared brain: `discover.py` reads it to identify; MIRA's
engine reads the same files to ground answers. **To teach the system a new device, add
a profile — don't hard-code it in the tool.** Contract: `device-profiles/_schema.yaml`.

## Codified fieldbus knowledge (stop relearning this)

### Protocols & ports
| Port | Protocol | Discovery | Notes |
|---|---|---|---|
| 502/tcp | Modbus/TCP | scan + read unit IDs | no native discovery; probe FC3 on unit 1..247 |
| 44818/tcp+udp | EtherNet/IP | CIP **List Identity** (UDP) | reliable "who are you" even with no program loaded |
| serial | Modbus RTU/RS-485 | **sweep** addr × baud × parity | no discovery at all — this is the painful one |
| 102/tcp | S7/Profinet | shallow (port-open) | deepen later |
| 4840/tcp | OPC-UA | shallow | deepen later |
| 47808/udp | BACnet/IP | shallow | deepen later |

### Modbus essentials
- **Read** FCs (all discovery uses): FC1 coils, FC2 discrete inputs, FC3 holding regs,
  FC4 input regs. **Write** FCs (never in discovery): FC5/6/15/16.
- Addresses: `4xxxxx` = holding register (1-based display), Modbus offset = display − 400001.
  Coils `0xxxxx`. The deployed Micro820 map is `plc/MbSrvConf_v4.xml` (22 coils + 17 HRs).
- RTU framing string `8N2` = 8 data bits / No parity / 2 stop bits.

### EtherNet/IP / CIP List Identity
A 24-byte encapsulation header with command `0x0063`, no payload, sent to UDP 44818.
The reply carries vendor id (Rockwell = 1), product code, serial, and a product-name
string (e.g. `2080-LC20-20QBB`). Works with **no program or Modbus map loaded** — prefer
it for "is the PLC alive and who is it".

### RS-485 sweep strategy
There is no discovery for serial Modbus. Sweep **slave-addr × baud × parity**, trying
known-good profile `serial_defaults` first. The GS10's truth: **9600 baud, 8N2**
(`P09.01=96`, `P09.04=13`). `discover.py --serial <port> --serial-bus-idle` does this.

**⚠ Single-master safety.** RS-485 is single-master. Do NOT sweep a bus a PLC is actively
mastering — two masters contend, the PLC's polls CRC-fail, and after the drive's comm
timeout (GS10 `P09.03`=5 s) the VFD trips → ladder latches `fault_alarm` → **motor stop**.
A "read-only" sweep can fault-stop the cell without writing anything. The tool **refuses
`--serial` unless `--serial-bus-idle`** is passed (acknowledging the bus master is offline
or this adapter is the sole master). The Ethernet scan has no such hazard. Sweep runtime
is ~`combos × addrs × timeout`: default ≈ a few minutes, `--thorough` (addr 1-247) ≈ 30+ min.

## Hard-won gotchas (the graveyard of lost sessions)

- **Micro820 Modbus returns exception 1 (ILLEGAL_FUNCTION) on every read until the
  MbSrvConf map is deployed** in CCW. TCP 502 opens, reads fail. Fix:
  `python plc/deploy_modbus_map.py --auto` (drops the 22/17 v4 map).
- **GS10 P09.04=13 is 8N2, NOT 8N1.** (`RESUME_VFD_COMMISSIONING.md` had `12`/8N1 — wrong;
  `GS10_Integration_Guide.md` is authoritative.) Wrong framing = silent no-reply.
- **MSG-block ErrorID=255 = the message never completed** → the CCW serial port config
  was never actually downloaded (a CCW download/sync problem), **not** a wiring fault.
- **ErrorID 55 / fault CE10 (58) = comm timeout** → swap D+/D−, recheck baud/parity, P09.03.
- **Built-in RS-485 is Channel 0, not Channel 2.**

These live authoritatively in `device-profiles/{gs10,micro820}.yaml` `gotchas:` — update
the profile when you learn a new one, not this file.

## When NOT to use discovery to write

If the task is to *set* an IP, baud, slave address, or push a config/program, that is a
different, deliberate tool — `deploy_modbus_map.py` for the Modbus map, CCW for the
program. Discovery never writes. See the read-only rule.

## Relationship to MIRA

`inventory.json` carries a `uns_hint` per device. The product payoff (v1.5): wire that
through `mira-crawler/ingest/uns.py` → `ai_suggestions(type=kg_entity, status=proposed)`
→ admin approves in `/proposals` → the UNS gate gains real plant context. Discovery is
the auto-onboarding front-door that solves MIRA's cold-start. v1 only populates the hint.

The commissioning loop (PASS/FAIL/NEEDS-PHYSICAL-CHECK + resumable checkpoints) is **v2**
and will reuse `mira-bots/shared/engine.py`'s DST, reading `inventory.json` to resume.
