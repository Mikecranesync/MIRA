# Fieldbus Discovery — Spec

**Status:** v1 (draft → building) · **Owner:** Mike + Claude · **Created:** 2026-05-28
**Branch:** `feat/fieldbus-discovery`

> Companion artifacts (Claude Code primitives, built alongside this spec):
> - Tool: `plc/discover.py`
> - Data: `device-profiles/*.yaml`
> - Skill: `.claude/skills/fieldbus-discovery/SKILL.md`
> - Command: `.claude/commands/discover-fieldbus.md`
> - Rule: `.claude/rules/fieldbus-readonly.md`

---

## 1. Why this exists

Bringing up the Micro820 + GS10 cell taught two pains that this program removes:

1. **No map of what's on the wire.** We hand-guessed the PLC's IP, swept the VFD's
   RS-485 slave address / baud / parity by trial and error, and re-derived the same
   Modbus knowledge every session. Nothing on the market does "scan my plant network
   **and** my serial bus, tell me every field device, and identify it" in one
   scriptable, license-clean tool. (The OT-visibility platforms — Claroty, Nozomi,
   Tenable.ot — do, but are enterprise-priced and overkill.)
2. **The knowledge kept dying.** 12 ladder revisions and a graveyard of
   `RESUME_*` / `BRINGUP_*` prompts exist because device facts (GS10 register map,
   "P09.04=13 is 8N2", "ErrorID=255 = MSG never completed") lived in our heads and
   scattered docs, not in a place a tool or MIRA could read.

**The insight:** these are one system. Discovery produces facts; a shared
**device-profile library** says what they mean; both `discover.py` and MIRA's engine
read that library. The profile library is simultaneously the tool's brain and the
codified docs — so we stop re-teaching ourselves Modbus.

## 2. What it is (one sentence)

A **read-only** field-device discovery tool whose output is shaped for MIRA's UNS,
backed by a shared device-profile library that doubles as codified fieldbus knowledge.

## 3. Scope

### In scope (v1)
- Async, read-only subnet scan (stdlib sockets) for known industrial ports.
- **Deep** identify for the protocols we own:
  - **Modbus/TCP** (`:502`) — probe unit IDs, read identifying registers.
  - **EtherNet/IP** (`:44818`) — hand-rolled CIP *List Identity* (finds the Micro820,
    returns vendor / product / serial / IP).
  - **Modbus RTU / RS-485** (serial) — sweep `slave-addr × baud × parity` to find the GS10.
- **Shallow** identify (port-open + best-effort banner) for protocols we don't own yet:
  S7/Profinet (`:102`), OPC-UA (`:4840`), BACnet/IP (`:47808`).
- Tiered identification backed by `device-profiles/*.yaml` (fingerprint → name +
  register map + gotchas).
- Output: a human table (`rich`) **and** `inventory.json` in a resume-shaped format.

### Out of scope (v1)
- **Any write.** No setting IPs, baud, registers, or commands. See §6.
- The commissioning FSM (PASS/FAIL/physical-gate loop, checkpoints) — **v2**, will
  reuse `mira-bots/shared/engine.py`'s DST, not reinvent it. v1 just emits an
  `inventory.json` that v2 can resume from.
- Writing discovered devices into NeonDB / the KG — **v1.5**, see §8 (the hook exists;
  the wiring lands when MIRA consumes it).
- The CCW "embedded serial out of sync" download problem (`RESUME_VFD_COMMISSIONING.md`)
  — a separate GUI-bypass concern, **not** solved here.

## 4. Audience & deployment

**Standalone-first, MIRA-shaped output.** A CLI we run on the cluster this week, sibling
to `plc/deploy_modbus_map.py` and `plc/live_monitor.py`. Because its output writes UNS
paths (later), the *same code* becomes MIRA's auto-onboarding front-door — solving the
cold-start of needing a customer's plant context before the UNS gate can ground anything.

## 5. Architecture

```
plc/discover.py
  ├── scan(targets, ports)          async stdlib-socket TCP connect sweep
  ├── probes/  (in-module)
  │     ├── modbus_tcp   deep    pymodbus: read unit-id + fingerprint regs
  │     ├── enip         deep    hand-rolled CIP List Identity (UDP 44818)
  │     ├── modbus_rtu   deep    pymodbus serial: addr×baud×parity sweep
  │     ├── s7           shallow port-open + COTP banner attempt
  │     ├── opcua        shallow port-open + GetEndpoints hello (best-effort)
  │     └── bacnet       shallow port-open (UDP 47808) + Who-Is (best-effort)
  ├── identify(raw)                 match raw probe result → device-profiles/*.yaml
  └── emit(inventory)               rich table + inventory.json

device-profiles/                    SHARED DATA (node-agnostic, top-level)
  ├── _schema.yaml                  the profile contract
  ├── gs10.yaml                     AutomationDirect GS10 DURApulse VFD
  └── micro820.yaml                 Allen-Bradley Micro820 2080-LC20-20QBB
        ▲ imported by plc/discover.py AND (later) mira-crawler/ingest/uns.py
```

**Deps:** `pymodbus` (already `>=3.7,<4`) + `rich` (already present). **Zero new deps,
zero GPL.** `nmap` / `python-nmap` are GPL and require an external binary not present on
the Windows PLC laptop — explicitly rejected (PRD §4: Apache/MIT only).

### Tiered identification
1. **port-open** — TCP connect / UDP response succeeded.
2. **protocol-confirmed** — it actually speaks the protocol (Modbus read returned a
   valid PDU; CIP replied to List Identity).
3. **device-identified** — a profile's `fingerprint` matched → name + register map +
   commissioning gotchas attached.

## 6. Safety (hard invariant)

Encoded in `.claude/rules/fieldbus-readonly.md`:
- **Discovery never writes.** Only read operations: TCP connect, CIP List Identity,
  Modbus read function codes (FC1/2/3/4), serial read requests. **Never** FC5/6/15/16,
  never a CIP write, never an IP/baud change, never a control command.
- **Ethernet scan is fully side-effect-free** — safe on any live network.
- **RS-485 sweep is read-only but NOT side-effect-free on a live bus.** RS-485 Modbus is
  single-master; a sweep contending with a PLC that is actively mastering the bus
  CRC-fails the PLC's polls, and past the drive's comm timeout (GS10 `P09.03`=5 s) the VFD
  trips → the ladder watchdog (`vfd_err_timer`, 5 s) latches `fault_alarm`/`error_code=9`
  → `conv_state=FAULT` → **motor stop**. So a "read" sweep can fault-stop the cell without
  writing. The tool therefore **refuses `--serial` unless `--serial-bus-idle`** is passed
  (master offline, or adapter is sole master). Verified against
  `plc/Micro820_v4.1.9_Program.st`.
- A motor must never move because someone ran a scan.
- Scan etiquette: per-host connect timeout (default 1 s), capped concurrency (default
  64), no aggressive retries (old devices choke even on reads), polite serial inter-frame
  gaps. `--gentle` halves concurrency and doubles timeouts for fragile networks.
- Config-writes stay in separate, deliberate tools (`deploy_modbus_map.py` pattern).

## 7. CLI contract

```
python plc/discover.py [options]

Network:
  --subnet 192.168.1.0/24     CIDR to scan (repeatable). Default: auto from local ifaces.
  --host 192.168.1.100        single host (repeatable)
  --ports 502,44818,102,...   override default port set
  --deep-only                 skip shallow probes (Modbus/TCP + EtherNet/IP only)

Serial (RS-485):
  --serial COM3 | /dev/tty…   enable the RTU sweep on this port
  --addr 1-32                 slave-address range (default 1-32; 1-247 with --thorough)
  --baud 9600,19200,38400     baud set to try (default these three)
  --frame 8N2,8N1,8E1         framing set to try (default these three)

Behavior:
  --thorough                  widen addr range to 1-247
  --gentle                    fragile-network mode (lower concurrency, longer timeouts)
  --json PATH                 inventory.json output path (default ./inventory.json)
  --profiles DIR              device-profiles dir (default ./device-profiles)
  --dry-run                   print scan plan, probe nothing
```

Exit 0 always on a completed scan (finding nothing is a valid result, not an error).

## 8. Output schema (`inventory.json`) — resume-shaped

```json
{
  "schema": "fieldbus-inventory/1",
  "scanned_at": "<ISO8601, stamped by caller>",
  "scan": { "subnets": [...], "serial": {...}, "ports": [...], "gentle": false },
  "devices": [
    {
      "transport": "ethernet|serial",
      "address": "192.168.1.100" | "COM3@9600,8N2,addr1",
      "tier": "port_open|protocol_confirmed|device_identified",
      "protocol": "modbus_tcp|ethernet_ip|modbus_rtu|s7|opcua|bacnet",
      "profile": "gs10|micro820|null",
      "identity": { "vendor": "...", "product": "...", "serial": "...", "raw": {...} },
      "evidence": ["enip list-identity reply", "modbus unit 1 FC3 ok", ...],
      "uns_hint": "enterprise.…  (filled when profile maps it; null otherwise)",
      "next_actions": ["…human/commissioning hints from the profile…"]
    }
  ],
  "unknowns": [ { "address": "...", "open_ports": [502], "note": "speaks Modbus, no profile match" } ]
}
```

`evidence` + `next_actions` + `tier` are the resume hooks the v2 commissioning loop reads.
`uns_hint` is the bridge to §4's product payoff: `mira-crawler/ingest/uns.py` builders
turn it into a real UNS path → `AISuggestion(type=kg_entity, status=proposed)` → admin
approves in `/proposals`. v1 only *populates the hint*; it does not write the DB.

## 9. device-profile contract (`_schema.yaml`)

Every profile is evidence-based and pins the truths we keep relearning:

```yaml
id: gs10
display_name: AutomationDirect GS10 DURApulse VFD
kind: vfd                       # vfd | plc | sensor | gateway | hmi | meter
protocols: [modbus_rtu]         # which transports it speaks
fingerprint:                    # how identify() recognizes it (all must hold)
  modbus_rtu:
    read: { reg: 0x2105, fc: 3 } # DC bus present when powered
    expect: { nonzero: true }
serial_defaults:                # what we KNOW works (the relearned truths)
  baud: 9600
  frame: 8N2                    # P09.04 = 13. NOT 8N1 — see gotchas.
registers:                      # the codified register map
  - { addr: 0x2103, name: output_freq_hz_x10, access: r, scale: 0.1, units: Hz }
  ...
gotchas:                        # what bit us, so it never bites again
  - "P09.04=13 means 8N2, not 8N1. RESUME_VFD_COMMISSIONING.md had this wrong."
  - "ErrorID=255 from the MSG block = it never completed → serial port config never
     downloaded in CCW (not a wiring problem)."
  - "ErrorID=55/58 (CE10) = comm timeout → swap D+/D-, check P09.03."
uns:                            # how a found instance maps into the namespace
  type_path_builder: model_path # which mira-crawler/ingest/uns.py builder
  manufacturer: AutomationDirect
  model: GS10
sources:                        # provenance — every fact traces to a doc
  - plc/GS10_Integration_Guide.md
```

## 10. Build sequence

1. `device-profiles/_schema.yaml` + `gs10.yaml` + `micro820.yaml` (data first — it's the
   knowledge).
2. `plc/discover.py` (scan → probes → identify → emit), read-only, stdlib + pymodbus + rich.
3. `.claude/rules/fieldbus-readonly.md` (the safety invariant).
4. `.claude/skills/fieldbus-discovery/SKILL.md` (teaches the fieldbus knowledge; points
   at the profiles + tool).
5. `.claude/commands/discover-fieldbus.md` (runs the tool).
6. Verify: `--dry-run`, then a real loopback/`--host` smoke; confirm `inventory.json`
   validates against the schema.

## 11. Verification

- `--dry-run` prints a scan plan and probes nothing.
- Unit-level: `identify()` matches a captured GS10/Micro820 probe fixture to the right
  profile; serial sweep logic picks `8N2` over `8N1` for the GS10 fixture.
- **Ethernet path — DONE, hardware-validated (2026-05-29):** a live scan of
  `192.168.1.100` identified the real Micro820 via EtherNet/IP List Identity
  (`product=2080-LC20-20QBB`, vendor 1, serial `D096D30C`), generated
  `uns_hint=enterprise.knowledge_base.rockwell_automation.micro820`, and correctly
  classified Modbus `:502` as `port_open` (exception 1 / ILLEGAL_FUNCTION — the
  documented "MbSrvConf map not deployed" condition). Schema-valid `inventory.json`.
- **RS-485 sweep — logic-tested, NOT yet hardware-validated.** `_ordered_combos` /
  fingerprint / frame-parsing are unit-tested, but `sweep_serial` has not been run
  against the GS10 (it remains unreachable over RS-485 per
  `RESUME_VFD_COMMISSIONING.md` — `ErrorID=255`, serial config never downloaded). Live
  serial smoke is pending that fix **and** a confirmed-idle bus (`--serial-bus-idle`).
- Evidence-only completion (Cluster Law 1): the Ethernet result above is real; the serial
  claim is explicitly scoped to unit tests until hardware confirms.

## 12. Open items

- **v2 commissioning FSM** — reuse `engine.py` DST; reads `inventory.json`.
- **v1.5 UNS write-path** — wire `uns_hint` → `mira-crawler/ingest/uns.py` →
  `ai_suggestions`.
- **CCW serial-config GUI-bypass** — still unsolved; tracked separately.
- **Profile growth** — PowerFlex 525, SEW, etc. added as we meet them; the schema is the
  contract.
