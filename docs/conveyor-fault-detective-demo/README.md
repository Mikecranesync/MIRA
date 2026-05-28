# MIRA Conveyor Fault Detective — Garage Demo

> **Booth phrase:** *Ask the conveyor what happened.*

A booth-ready demo that pairs a 2D conveyor HMI with a grounded MIRA chat
assistant. Inject any of 13 industrial-realistic faults (jam, fuse loss,
sensor wire break, debounce chatter, vision/sensor mismatch, VFD slip…)
and watch MIRA name the suspected fault, highlight the affected
components on the diagram, and walk a technician through evidence-based
troubleshooting.

The simulator is the default data source so the demo works on any
laptop. When the rig is on the same LAN, swap in live Micro820 + GS10
VFD tags by setting `PLC_HOST=192.168.1.100` on the bridge.

---

## Architecture

```
            ┌──────────────────────────────────────────────────────┐
            │  Node-RED mira-bridge  :1880                         │
            │  (Dashboard 2.0 + Modbus contrib + SQLite)           │
            │                                                      │
   inject ──┼─→ ui-button → POST /inject/<mode> → fault-sim        │
            │                                                      │
            │  mqtt-in ─── demo/cell1/conveyor/cv101/#             │
            │     └──→ SVG highlight + Waiting-on + Event Table    │
            │                                                      │
   chat ────┼─→ ui-text-input → fn(compose) → mira-pipeline :9099  │
            └──────────────────────────────────────────────────────┘
                          │
              ┌───────────┴────────────┬─────────────────┐
              │                        │                 │
              ▼                        ▼                 ▼
   ┌─────────────────┐      ┌─────────────────┐   ┌──────────────────┐
   │ Mosquitto :1883 │◄────►│ fault-sim :8089 │   │ fault-detective  │
   │                 │      │  (Python)       │   │  (Python, 7-rule │
   │                 │      │                 │   │   diagnostic     │
   │                 │      │                 │   │   engine)        │
   └─────────────────┘      └─────────────────┘   └──────┬───────────┘
                                                         │
                                                         ▼
                                         conveyor_events  (SQLite WAL
                                         in mira-bridge/data/mira.db)
```

UNS topic prefix:  `demo/cell1/conveyor/cv101/`

| Topic suffix                          | Source           | Shape                       |
| ------------------------------------- | ---------------- | --------------------------- |
| `sensors/{pe101,pe102,px101}/raw`     | fault-sim        | `{value: bool, ts, source}` |
| `sensors/{pe101,pe102,px101}/debounced` | fault-sim     | `{value: bool, ts, source}` |
| `sensors/{...}/dropout_count`         | fault-sim        | `{value: int, ts, source}`  |
| `power/{fuse_f2,fuse_f3}/status`      | fault-sim        | `{value: "ok"|"blown", ...}`|
| `vision/zone2/object_present`         | fault-sim        | `{value: bool, ...}`        |
| `vision/zone2/object_motion`          | fault-sim        | `{value: bool, ...}`        |
| `state/waiting_on`                    | fault-sim        | `{value: str, ...}`         |
| `sim/active_mode`                     | fault-sim        | `{value: str, ...}`         |
| `vfd/vfd101/*`                        | NR Modbus ingest | from Micro820 HR map        |
| `motor/m101/running`                  | NR Modbus ingest | bool                        |
| `safety/{estop,wiring,contactor_q1}`  | NR Modbus ingest | bool                        |
| `diagnostics/current_fault`           | fault-detective  | `{fault, confidence, evidence[], affected_components[], ...}` |

---

## Run it

```bash
# from the MIRA repo root
docker compose -f docker-compose.fault-detective.yml up -d --build
# bring up the rebuilt Node-RED bridge (or recreate the existing one)
docker compose -f mira-bridge/docker-compose.yml up -d --build
# push the demo flow into the running NR
python3 mira-bridge/scripts/push_flow.py mira-bridge/flows/fault-detective.json
```

Open <http://localhost:1880/dashboard/fault-detective>.

### Fault injection from the command line

```bash
# all 13 modes
for m in normal jam dirty_sensor misaligned f2_blown \
         pe101_brown_break pe101_blue_break pe101_black_break \
         loose_terminal debounce_chatter vfd_no_motion \
         vision_no_sensor sensor_no_vision; do
  curl -s -X POST localhost:8089/inject/$m; echo " ← $m"
done
```

### Watch the UNS

```bash
docker exec mira-mosquitto mosquitto_sub -h localhost -v -t 'demo/#'
docker exec mira-mosquitto mosquitto_sub -h localhost -t \
  'demo/cell1/conveyor/cv101/diagnostics/current_fault'
```

### Event memory

The diagnostic engine writes every fault transition to the
`conveyor_events` table inside `mira-bridge/data/mira.db` (shared SQLite
WAL). Inspect via:

```bash
docker exec mira-fault-detective python3 -c "
import sqlite3, json
c = sqlite3.connect('/mira-db/mira.db')
for ts, fault, conf, aff in c.execute(\
    'SELECT ts, fault, confidence, affected_json FROM conveyor_events ORDER BY id DESC LIMIT 20'):
    print(f'{ts}  {fault:<35}  {conf:.2f}  {json.loads(aff)}')
"
```

---

## The 7 diagnostic rules

Evaluated in priority order in
[`mira-fault-detective/rules.py`](../../mira-fault-detective/rules.py).

1. **E-stop active** — safety short-circuit; outranks everything else.
2. **F2 branch loss** — all three F2-fed sensors silent.
3. **Mechanical jam** — PE-102 blocked >5s + vision present + no motion + VFD running.
4. **VFD / motion mismatch** — VFD running but vision sees no motion (belt slip / coupling).
5. **Sensor dirty / misaligned** — PE blocked >2s, vision sees an empty belt.
6. **PE-101 chatter** — windowed dropouts >5 on PE-101, peers stable.
7. **Vision sees product, PE-101 silent** — output-wire / TB2 / PLC input.
8. **PE-101 local wiring** — PE-101 silent, peers alive on F2.

Each diagnosis carries:

```json
{
  "fault": "branch_fuse_loss",
  "confidence": 0.95,
  "evidence": [
    {"topic": "power/fuse_f2/status", "value": "blown"},
    {"topic": "sensors/pe101/debounced", "value": false},
    ...
  ],
  "affected_components": ["Fuse F2", "PE-101", "PE-102", "PX-101"],
  "recommended_first_check": "Measure 24V at Fuse F2 input vs output. ...",
  "safety_note": "De-energize 24V branch before pulling F2. Verify with meter."
}
```

The SVG `<rect>` / `<circle>` ids in the HMI match the
`affected_components` values verbatim, so the highlight rule is one
line of JavaScript: `affected.has(name) ? red : green`.

---

## Talk to MIRA — the UNS confirmation gate

The chat panel posts to `mira-pipeline:9099/v1/chat/completions`
(OpenAI-compatible Supervisor) with a system prompt that:

1. Injects the latest `current_fault` JSON.
2. Enforces the **MIRA confirmation protocol** from
   [`.claude/rules/uns-confirmation-gate.md`](../../.claude/rules/uns-confirmation-gate.md):
   first turn says *"I believe you are working on Demo Cell / Conveyor
   CV-101 / {affected}. Confirm?"* and stops.
3. Only after `yes / confirm / correct` produces:
   diagnosis · confidence · evidence (bullet) · recommended first check
   · next measurement · safety note · WO draft (one line).

If `mira-pipeline` isn't running (e.g., demo laptop with no LLM stack),
the chat panel surfaces the HTTP status. The HMI still works
standalone — the chat is the "explain" layer on top.

---

## Live PLC overlay

The Node-RED flow ships with a Modbus-TCP-ingest stub that polls
`${PLC_HOST:-192.168.1.100}:502` and publishes the Micro820 v4.1.9 tag
map (see [`plc/live_monitor.py`](../../plc/live_monitor.py) for the
authoritative coil + HR layout):

| PLC tag (HR/coil)         | UNS topic                              |
| ------------------------- | -------------------------------------- |
| HR 106 `vfd_freq` (x10)   | `vfd/vfd101/freq` (Hz)                 |
| HR 107 `vfd_current` (x10)| `vfd/vfd101/current` (A)               |
| HR 113 `conv_state`       | `vfd/vfd101/status` (idle/running/...) |
| coil 0 `motor_running`    | `motor/m101/running`                   |
| coil 5 `estop_active`     | `safety/estop`                         |
| coil 18 `ContactorQ1`     | `safety/contactor_q1`                  |
| coil 9 `estop_wiring`     | `safety/wiring`                        |

When the PLC IP is unreachable, the ingest flow falls silent and the
sim baseline drives the entire HMI — no demo break.

---

## Testing

```bash
# Sim — 13 inject modes
cd mira-fault-sim && pytest tests/

# Engine — 7 rules + priority
cd mira-fault-detective && pytest tests/
```

Golden cases live in
`mira-fault-detective/tests/test_rules.py`. Each new fault scenario
should add a case here before the rule lands.

---

## What's intentionally NOT in this demo

These are the cutlines from the original 5-hour budget — keep them
parked here so we don't keep re-discovering them:

- **Real camera.** Vision is `vision_object_present` / `vision_object_motion`
  booleans driven by the sim. Plug in Roboflow / YOLOv8 by replacing
  the `vision/zone2/*` publishers — the rules don't care where the
  booleans come from.
- **CMMS work-order POST.** WO draft is a templated string in the chat
  reply. Wire it to `mira-mcp/server.py`'s CMMS tools when the demo
  graduates to a real customer.
- **Shift handoff endpoint.** Today it's a SELECT against
  `conveyor_events`. A future `/api/conveyor/today` route would
  pre-aggregate the spec's example
  *("42 stops: 31 normal, 6 PE-101 chatter, ...")*.
- **Multi-PLC.** Modbus ingest is hard-coded to one host. The UNS path
  prefix already supports `enterprise/site/area/line/cell` extension —
  use that when adding asset #2.

---

## File map

```
mira-fault-sim/                    Python simulator + REST inject API
  ├── sim.py                       (publishes virtual sensors @ 200ms)
  ├── pyproject.toml
  ├── Dockerfile
  └── tests/test_inject_modes.py   (13 modes covered)

mira-fault-detective/              Python rule engine
  ├── engine.py                    (MQTT in/out, SQLite, ticker)
  ├── rules.py                     (7 rules + priority list)
  ├── pyproject.toml
  ├── Dockerfile
  └── tests/test_rules.py          (golden case per rule)

mira-bridge/
  ├── flows/fault-detective.json   (Node-RED HMI flow)
  ├── scripts/push_flow.py         (deploy via Admin API)
  ├── mosquitto/mosquitto.conf
  ├── migrations/005_conveyor_events.sql
  └── (existing) docker-compose.yml + Dockerfile

docker-compose.fault-detective.yml (mosquitto + sim + engine)
docs/conveyor-fault-detective-demo/README.md   (this file)
docs/promo-screenshots/             (HMI proof shots)
```
