# Physical Conveyor Readiness — Wiring Weekend (May 15–17) → Expo May 21

**Status:** drafted 2026-05-14 on CHARLIE. Read this before you touch wire.

## TL;DR — the brutal version

1. **The May 21 expo demo does NOT depend on live PLC data.** `docs/specs/demo-readiness-may21-spec.md` is web-only — Hub + CMMS + MIRA Scan + Telegram. None of the four surfaces poll the conveyor. Live signal is a *nice-to-have backdrop*, not a demo-blocker.
2. **`tools/seeds/demo-conveyor-001.sql` does not exist.** Neither does `tools/electrical_print_gist.py`. Nothing in the repo seeds a "demo-conveyor-001" asset into NeonDB. The Atlas CMMS demo assets are seeded from `mira-web/src/seed/demo-data.ts` (TypeScript, not SQL). **Worse — that seed describes a different machine than the garage conveyor.** The closest match is `"Conveyor Drive — Conv-001"` which is a **SEW-Eurodrive R47 DRE80M4** helical gearmotor on "Line 3 Infeed" with a 24" wide × 40' Habasit PVC belt — not the AutomationDirect GS10 + Micro820 garage rig. If Mike wants the live PLC data to land on the right Atlas asset detail page, either (a) seed a *new* Atlas asset that matches the garage hardware (preferred), or (b) accept the cosmetic lie and stream garage data into the `Conv-001` SEW asset.
3. **The "PLC → MIRA" data path is half-built.** `mira-relay` is the only ingest endpoint and it is HTTP-only — no MQTT subscriber, no Sparkplug decoder, no Modbus poller. There is no Ignition Gateway running, no MQTT broker installed on Charlie, and the Node-RED flow at `mira-bridge/flows/mira-dashboard-conveyor.json` contains zero Modbus or MQTT nodes (it's UI-only).
4. **Tag names will not match.** The PLC manifest exposes `motor_speed`/`motor_current`/`vfd_frequency`. `mira-relay` expects `speedRPM`/`motorCurrent`/`outputFrequency` (camelCase). Whatever publisher we wire up needs a translator.

If you want a live data flicker on the booth screen by May 21, that is a *new* software project this weekend on top of the wiring. Scope it explicitly. Do not let it sneak in.

---

## What gist material exists

All consolidated into v3 panel-door reference. Authoritative gists (others are superseded):

| Gist | What | Use |
|---|---|---|
| `2a2d46e8` Garage Factory Electrical Print v3 | 10-file consolidated panel-door reference | Tape inside panel door. Power wiring, I/O table, Modbus map, ladder summary, LOTO, fault codes |
| `52c8d4525` UNS Conveyor Project | 9-file Ignition + Sparkplug + MIRA bring-up | Read sections 4 (built vs needed) and 5 (programming checklist) before wiring |
| `4d8d8c9f` Modbus TCP version | 7-file Modbus TCP reference | Older snapshot of same content; v3 supersedes |

Recovery / debug references (skip unless something breaks):
- `7dee70a9c` — Micro820 PLC Recovery v2.0 program + drop-in script
- `6f4ef384` — Master Wiring Guide (older, consolidated into v3)
- `4eaffdac3` — GS10 + Micro820 integration guide (Modbus RTU, parameters, fault codes)
- `4224dd654` — RS-485 wiring diagram

---

## What's actually in the repo right now

### PLC side

| File | What | Status |
|---|---|---|
| `plc/Micro820_v4.1.8_Program.st` | Latest ST program | Has 5-state machine, dual-channel E-stop, VFD Modbus polling, item counter. **v4.1.7 → v4.1.8 diff is ONLY the version comment** — code is byte-identical. Safe to flash either |
| `plc/MbSrvConf_v3.xml` | Modbus TCP server map | Authoritative — coils + holding registers exposed to the network |
| `plc/CCW_VARIABLES_v4.0.txt` | Variable list for CCW | Use for Global Variables import |
| `plc/CCW_DEPLOY_v3.txt` | CCW deploy guide | **Stale — references v3 program** (v4.1.8 is current). Use it for sequence, replace filenames |
| `plc/PLC_BRINGUP_PROMPT.md` | Travel-laptop checkpoint | Phases 5–8 are still the right order. PLC laptop has prior context |
| `plc/RESUME_VFD_COMMISSIONING.md` | VFD bring-up state | Read before powering VFD |
| `research/variable-manifest.json` | Single source of truth for PLC tags | Generated 2026-05-10 — `"Ignition MCP at 100.72.2.99:8765 was OFFLINE … tag paths unconfirmed"`. PLC variables are confirmed, Ignition path is not |

**PLC ↔ VFD address map (from variable manifest + gist):**

| Modbus addr | Tag | Direction | Used by |
|---|---|---|---|
| HR:100 | motor_speed | R | external clients |
| HR:101 | motor_current | R | external clients |
| HR:102 | temperature (was; now `pressure` per gist v3) | R | external clients |
| HR:106 | vfd_frequency / error_code | R | external clients |
| HR:107–110 | vfd_current, vfd_voltage, vfd_dc_bus, item_count | R | external clients |
| HR:111 | uptime_seconds | R | external clients |
| HR:112 | conveyor_speed_cmd | R/W | Ignition writes |
| HR:113 | conv_state | R | external clients |
| HR:115 | vfd_cmd_word | R/W | Ignition writes |
| HR:116 | vfd_freq_setpoint | R/W | Ignition writes |
| Coil 7 | dir_fwd | R | — |
| Coil 8 | dir_rev | R | — |
| Coil 10 | estop_wiring_fault | R | — |
| Coil 11 | dir_fault | R | — |
| Coil 17–20 | LightGreen, LightRed, ContactorQ1, PBRunLED | R | — |

### MIRA side

| Component | Path | Status |
|---|---|---|
| `mira-relay` | `mira-relay/relay_server.py` | **Running surface = SaaS only** (`docker-compose.saas.yml`). HTTP POST `/ingest`. Writes SQLite, not NeonDB. Tag map expects camelCase names that **do not match** the PLC manifest |
| MQTT broker | — | **Not installed.** Gist says `tcp://192.168.1.12:1883` (Charlie) but no Mosquitto container, no broker config |
| Ignition Gateway | — | **Not running.** No `ignition/` running compose service |
| `mira-bridge` Node-RED flows | `mira-bridge/flows/mira-dashboard-conveyor.json` | UI-only — `rg modbus` returns 0 hits. `mira-setup-wizard.json` has 3 mqtt mentions (config UI, not active poller) |
| Modbus poller | — | **Not built.** Programming checklist 5.1 ("Node-RED Modbus poller (mira-bridge)") is unchecked work |
| NeonDB `live_signal_cache` / `equipment_telemetry` table | — | **Schema not found.** `rg "CREATE TABLE.*equipment_telemetry"` returns 0 hits. There are `mira-hub/db/migrations/004_asset_enrichment.sql` + `mira-core/.../003_asset_qr_tags.sql` but no live signal cache table |
| Demo CMMS asset `demo-conveyor-001` | — | **Does not exist by that name.** Atlas seed data is in `mira-web/src/seed/demo-data.ts` (TypeScript) — check there for what asset IDs the CMMS demo expects |

---

## Tag name alignment — the mismatch

The PLC will emit (over Modbus TCP):
```
motor_speed, motor_current, vfd_frequency, vfd_current, vfd_voltage, vfd_dc_bus,
item_count, conv_state, uptime_seconds, error_code
```

The relay (`mira-relay/relay_server.py`) accepts these tag keys:
```python
TAG_COLUMN_MAP = {
    "speed_rpm": "speed_rpm",        "speedRPM": "speed_rpm",     "outputFrequency": "speed_rpm",
    "temperature_c": "temperature_c", "temperatureC": "temperature_c", "heatsinkTemp": "temperature_c",
    "current_amps": "current_amps",   "currentAmps": "current_amps",
    "motorCurrent": "current_amps",   "outputCurrent": "current_amps",
    "pressure_psi": "pressure_psi",   "pressurePSI": "pressure_psi",
}
FAULT_TAG_NAMES = {"faultCode", "fault_code", "errorCode", "alarmCode"}
```

Closest matches if you publish PLC → relay directly:
- PLC `motor_current` → relay `motorCurrent` ✗ (must rename in publisher)
- PLC `vfd_frequency` → relay `outputFrequency` ✗ (must rename)
- PLC `motor_speed` → ambiguous — relay treats `speedRPM`/`outputFrequency` both as `speed_rpm`
- PLC `vfd_current` → relay `outputCurrent` ✓
- PLC `error_code` → relay `errorCode` ✓ (FAULT_TAG_NAMES)

No PLC tag maps to `temperature_c` or `pressure_psi` (PLC HR:102 is `temperature` in older docs but VFD heatsink temp isn't currently exposed in the variable manifest at HR:102 — verify v4.1.8 ST).

**Fix:** put a name-translation step in whatever bridge polls Modbus → POSTs to relay.

---

## What "PLC → MIRA" actually requires (build order)

You have several options, ordered by how much new code each costs:

### Option A — Simplest, no MQTT, no Ignition (recommended for May 21)
PLC laptop runs a small Python poller that:
1. Reads Modbus TCP from `192.168.1.100:502` every 1s
2. Renames PLC tags → relay's camelCase keys
3. POSTs JSON to the relay endpoint with `Bearer $RELAY_API_KEY` (in Doppler `factorylm/prd`)
4. Payload shape (from `relay_server.py`):
   ```json
   {"type": "tags", "agent_id": "garage-plc-1",
    "equipment": {"Conv-001": {"speedRPM": {"v": 1750},
                                "motorCurrent": {"v": 3.2}}}}
   ```
   Use `Conv-001` as the equipment key (matches the existing Atlas seed), OR seed a new Atlas asset with a garage-specific name first and use that key.
5. Relay writes to its SQLite `equipment_status` table. CMMS reads from there (or from NeonDB if you wire that path — currently it doesn't).

**Where does the POST go?** The relay is defined in `docker-compose.saas.yml` bound to `127.0.0.1:8765` on the SaaS VPS — **loopback only, behind the reverse proxy.** Before bench-testing:
- `ssh` to the SaaS VPS and `docker compose -f docker-compose.saas.yml ps mira-relay` to confirm it's actually running (the compose file existing does not mean it's deployed)
- Check the VPS Caddy/nginx config (`docs/runbooks/factorylm-vps.md` for layout) — there is **no `/ingest` route in any nginx conf in the repo**. Likely you'll need to add one to expose `app.factorylm.com/relay/ingest` → `mira-relay:8765/ingest`
- If you don't want to open a public route, run a second `mira-relay` container on Charlie via the `docker-compose.yml` (not the saas one) and have the PLC laptop POST to `http://192.168.1.12:8765/ingest` over LAN. **Recommended for the expo demo** — keeps the data path local, no public attack surface

**Cost:** ~80 lines of Python. No broker, no Ignition, no Node-RED. Lives on PLC laptop with the gigabit cable to the PLC. **This is the fastest path to "live data on a screen" for the expo.**

**Gap:** the relay writes SQLite on the SaaS VPS, not Charlie. If you want the data to drive the Atlas CMMS asset detail page, you need to either (a) point CMMS at the relay's read API or (b) duplicate the writer to also POST to a Neon-backed endpoint. **None of that exists yet.**

### Option B — The "proper" UNS path (gist-described, NOT shippable for May 21)
PLC → Ignition Gateway → Cirrus Link MQTT Transmission → Mosquitto broker on Charlie → Python Sparkplug B subscriber → NeonDB `equipment_telemetry` table.

**Cost (none of this exists today):**
- Install + license Ignition Gateway on PLC laptop or Charlie
- Install Mosquitto on Charlie, expose 1883
- Install Cirrus Link MQTT Engine + Transmission modules in Ignition
- Build Ignition tag tree to match `tags_micro800.json` (file referenced in gist; not in repo at MIRA root — may live in a sibling dir)
- Write Sparkplug subscriber in Python (`tahu-python` or `sparkplug-b-payload`)
- Create NeonDB `equipment_telemetry` table + migration
- Wire MIRA chat queries to read from it

Realistic build time: 2–3 weeks. **Do not start this before May 21.**

### Option C — Node-RED Modbus poller in `mira-bridge`
Add `node-red-contrib-modbus` to mira-bridge, build a flow that polls 192.168.1.100:502 and POSTs to relay. Same destination as Option A, different host (bridge container on Charlie). Charlie 192.168.1.12 is on the same LAN as the PLC at 192.168.1.100 so connectivity works.

**Cost:** ~1 hour of Node-RED work, plus deciding where the bridge runs (currently `mira-bridge` is in `docker-compose.yml` not the SaaS compose). Need to check whether bridge can reach internet to POST to the SaaS relay, or whether you want a Charlie-local copy of the relay container.

---

## Network reality

```
PLC (192.168.1.100:502)
    └─ LAN — reachable from Charlie (192.168.1.12) directly
    └─ LAN — reachable from PLC laptop (192.168.1.20) directly
    └─ Bravo (192.168.1.11) also on same subnet — could poll if needed
    └─ Alpha (192.168.4.x) is a DIFFERENT subnet — NOT reachable without Tailscale subnet router
```

Charlie and the PLC are on the same /24, so a Modbus poller on Charlie works without any routing change. Alpha cannot reach the PLC at all unless you advertise the 192.168.1.0/24 subnet on Tailscale.

---

## Pre-wiring software checklist (do before plugging anything in)

- [ ] **Pull the latest PLC code on the PLC laptop:** `git -C ~/MIRA pull` — make sure `plc/Micro820_v4.1.8_Program.st` and `plc/MbSrvConf_v3.xml` are there
- [ ] **Verify PLC laptop can reach Charlie:** `ping 192.168.1.12` from PLC laptop
- [ ] **Verify Charlie can reach the network where the PLC will live:** with PLC unplugged, `arp -a | grep 192.168.1` to see what's on the LAN
- [ ] **Decide the data-path scope for May 21:** Option A (PLC laptop poller → SaaS relay) or "no live data, faked CMMS screenshot." If Option A: write the 80-line poller this weekend, before wiring is final, and bench-test against the mock Modbus sim
- [ ] **Confirm the relay is actually deployed.** SSH to the SaaS VPS, run `docker compose -f docker-compose.saas.yml ps mira-relay`. The compose file existing in the repo does not mean the container is running.
- [ ] **Pick the relay target before writing the poller:**
  - Local LAN: bring up `mira-relay` in `docker-compose.yml` on Charlie, POST to `http://192.168.1.12:8765/ingest` over LAN
  - Public VPS: add an `/relay/ingest` proxy route to the SaaS VPS reverse proxy first (does not exist today), POST to `https://app.factorylm.com/relay/ingest`
- [ ] **Bench-test against whichever target you pick.** Example (LAN form):
  ```bash
  curl http://192.168.1.12:8765/health
  curl -X POST http://192.168.1.12:8765/ingest \
    -H "Authorization: Bearer $RELAY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"type":"tags","agent_id":"bench-test",
         "equipment":{"Conv-001":{"speedRPM":{"v":1500}}}}'
  ```

## Pre-wiring electrical / mechanical checklist

These come straight from the gist commissioning section — not invented here, just relocated for visibility:

- [ ] LOTO 3-phase before any work in the panel
- [ ] Confirm RS-485 cable: 2-pair shielded, drain to one ground only, 120Ω term at both ends
- [ ] GS10 parameters set at keypad **before** RS-485 is connected: P00.20=5 (Modbus), P00.21=2 (Modbus), P09.00=1 (slave 1), P09.01=2 (9600), P09.04=3 (8N2)
- [ ] Motor nameplate matches P05.xx (V, A, Hz, RPM)
- [ ] PLC O-02 → contactor Q1 coil A1 wired correctly; coil de-energizes when E-stop pressed (test with a meter before applying 3-phase)
- [ ] Dual-channel E-stop: I-02 (NC) and I-03 (NO) → both must transition together; XOR mismatch = `estop_wiring_fault` latched

## Post-wiring verification (in order — don't skip)

1. **PLC online check** (no 3-phase yet):
   `Test-NetConnection 192.168.1.100 -Port 502` from PLC laptop → must show `TcpTestSucceeded: True`
2. **Modbus read from Charlie** (no VFD power yet):
   ```bash
   python3 -c "
   from pymodbus.client import ModbusTcpClient
   c = ModbusTcpClient('192.168.1.100', port=502)
   c.connect()
   print(c.read_holding_registers(100, 14, slave=1).registers)
   "
   ```
   (pymodbus 3.x uses `slave=`, not `unit=`.) Expect 14 numbers (most zero). If this fails, stop — the PLC isn't exposing the Modbus TCP server correctly.
3. **Force outputs from CCW Online Monitor** (still no 3-phase): force O-00 (green pilot), O-01 (red pilot), O-03 (RUN LED) — verify each lamp.
4. **Dual-channel E-stop test:** press E-stop with PLC powered. Watch coil 10 (`estop_wiring_fault`) — should NOT latch. Release. Pull one channel only (simulate broken wire) by disconnecting I-02 → coil 10 should latch within one scan.
5. **VFD comms (no 3-phase yet)** — read HR:107 (vfd_current). Should return 0 amps when VFD has control power but motor is off. If you get `vfd_comm_ok=FALSE` (check `error_code` HR:106 — value 9 means VFD comm), troubleshoot RS-485 wiring before applying 3-phase.
6. **First 3-phase run — JOG only:** with FWD selector + RUN button, confirm motor turns the right direction. If reversed, swap any two phases at the VFD output side, not the input side.
7. **Item counter test:** wave hand or block through sensor 2 (DI_06). HR:110 (`item_count`) should tick on each rising edge.
8. **Round-trip to relay** (if Option A is built): start the Modbus → relay poller, then `curl https://<saas>/ingest` queries should return non-zero `speed_rpm`/`current_amps` for `demo-conveyor-001`.

## Hard-stop conditions — do NOT proceed if any are true

- E-stop coil 10 (`estop_wiring_fault`) latches under normal operation
- O-02 (contactor coil) energizes while E-stop is pressed
- Motor turns the wrong direction and you haven't physically tagged the new phasing
- VFD heatsink temp climbs above 60°C at idle (P05.xx mis-set, restricted airflow, or wrong motor data)
- Any 3-phase voltage measured between U/V/W and ground (suggests bad cable shield, ground bond, or motor insulation issue)

---

## Things that will bite you (lessons from the gists)

- **Modbus server config has TWO versions in the repo.** `plc/MbSrvConf_v3.xml` is authoritative. `plc/ccw/controller/.../MbSrvConf.xml` may be a stale snapshot — don't deploy from that one.
- **PLC laptop has stale CCW project.** `CCW_DEPLOY_v3.txt` references v3 program. Latest is v4.1.8. When CCW asks for the .st file, point at `Micro820_v4.1.8_Program.st`, not v3.
- **VFD `0x2000` command word is bit-encoded, not value-encoded.** `1 = STOP`, `18 (0x12) = FWD+RUN`, `20 (0x14) = REV+RUN`. Anything else = invalid → likely VFD warning + motor will not run. PLC program already does this translation in section 7.
- **Sensor 2 (DI_06) is the item counter trigger.** If you wire the wrong sensor here, item count will be wrong but the demo will look fine — verify rising-edge count manually.

---

## Summary verdict

For the **May 21 expo**, the demo spec is web-only. You do not need a live data path to nail the demo.

For the **physical wiring weekend itself**, the software side is fine — the PLC program is current (v4.1.8), the Modbus server config is current, the gist v3 panel-door reference is consolidated and accurate. What's *not* fine is anyone's assumption that "the rest is plumbed already." It isn't. There is no MQTT broker, no Sparkplug subscriber, no Modbus poller, no NeonDB `equipment_telemetry` table, no demo asset SQL seed by that name, and `mira-relay` expects different tag names than the PLC emits.

If a live data flicker on the booth is worth one weekend day of code, build the Option A poller. If not, demo from the screen the way the spec is written — and use the physical conveyor as a *prop*, not a *signal source*.
