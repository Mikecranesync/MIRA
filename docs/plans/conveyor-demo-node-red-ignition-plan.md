# Conveyor demo — Node-RED / Ignition / MQTT data-path plan

**Purpose:** a practical plan for getting **real** conveyor data into MIRA's reasoning workflow, read-only, building on what already exists. Grounded in `mira-bots/ask_api/`, `docker-compose.fault-detective.yml`, `plc/live-plc-bridge/bridge.py`, `docs/conveyor-fault-detective-demo/README.md`, `docs/runbooks/2026-05-15_physical-conveyor-readiness.md`, `docs/superpowers/plans/2026-05-13-mira-conveyor-demo-mvp.md`, `docs/adr/0021-ignition-module-first-edge.md`.

**Hard constraints:** read-only toward the plant; no PLC/VFD writes; no cloud→plant inbound; don't present simulator data as live; preserve the UNS confirmation gate and citations.

---

## 1. Hardware (the real iron, per `machine_context.py`)

- **PLC:** Allen-Bradley **Micro820** `2080-LC20-20QBB` @ `192.168.1.100` (EtherNet/IP :44818; **Modbus TCP slave :502 unit 1**).
- **VFD:** AutomationDirect **GS10** (DURApulse) driving the belt motor. PLC↔VFD = RS-485 Modbus RTU, PLC=master, GS10=slave 1, 9600 8N1.
- **I/O of interest:** e-stop (dual-channel DI_02/DI_03), photo-eye DI_05 (latching soft-stop), main contactor DO_02, start DI_04, direction DI_00/DI_01.
- **Key VFD tags + scaling:** `vfd_comm_ok` (master trust gate), `vfd_frequency` (Hz×100), `vfd_current` (A×100), `vfd_dc_bus` (V×10), `vfd_cmd_word` (1/18/20), `vfd_status_word` (low 2 bits = stopped/decel/standby/running), `vfd_fault_code` (0=none; 21=oL overload; 58=CE10 modbus timeout; …).

> If the lab VFD is a **GS11** rather than a GS10, the command/status/fault model is the same DURApulse family; verify register addresses and the `vfd_fault_code` table on the bench before trusting decoded values. The decode tables live in `mira-bots/ask_api/app.py` and `machine_context.py` — update both together.

## 2. Current state (what works today)

- **Bench fault-detective demo** (`docker-compose.fault-detective.yml`, headed **BENCH HARNESS — NOT a customer architecture**): Mosquitto + `mira-fault-sim` (publishes **fake** PE/PX/fuse/vision) + `mira-fault-detective/engine.py` (rule engine) + `mira-bridge` HMI. Diagnoses are computed from **simulated** signals.
- **Live read path (bench-only):** `plc/live-plc-bridge/bridge.py` polls the Micro820 over Modbus TCP and republishes to MQTT. Read-only; bench-only header; never ships (ADR-0021).
- **Live-tag chat (single machine):** `mira-bots/ask_api/app.py` accepts `{question, tags, session_id}` from the Ignition HMI, decodes the GS10 tags into a `[LIVE CONVEYOR STATUS]` block, prepends `machine_context.py`, and calls the same `Supervisor.process()` the bots use.

## 3. Live-data gaps (per the readiness runbook)

- The **PLC → MIRA path is "half-built."** Tag-name casing mismatches between the PLC manifest and the relay; no broker running on the production node; no `equipment_telemetry`/`live_signal_cache` table; demo CMMS asset name mismatch (`Conv-001` ≠ garage hardware).
- Live tags reach MIRA **only** through the `ask_api` kiosk, as a text block injected *before* the UNS gate — not as a UNS-keyed snapshot attached *after* confirmation, and **not logged** as a discrete snapshot for traceability.
- `mira-bots/shared/workers/plc_worker.py` is a **stub** ("Live PLC data is not connected yet").

## 4. Recommended first live path (boring + read-only)

Adopt the readiness runbook's **Option A / C** spirit — the smallest path that puts *real* values in front of MIRA — and standardize how the snapshot enters the conversation.

```
Micro820 (Modbus TCP :502, read-only)
  → [easiest available source]
        • Bench:    plc/live-plc-bridge/bridge.py  → Mosquitto (UNS topics)   [Pattern 3]
        • Customer: Ignition gateway tag-stream.py → mira-relay over HTTPS     [Pattern 5, ADR-0021]
  → normalize to a UNS-keyed snapshot {uns_path, datapoint, value, quality, ts, source}
  → attach to the MIRA conversation AFTER the UNS confirmation gate
  → engine retrieves manuals/KG, answers with citations
  → snapshot logged (DB row) for traceability
```

- **Bench vs. customer:** the bench uses MQTT (Pattern 3); the customer uses the outbound-HTTPS relay (Pattern 5). The **adapter normalizes both into the same UNS-keyed snapshot** so the engine never cares which source produced it.
- **Plain MQTT, not Sparkplug**, for now (Sparkplug is spec-only, #1627). Carry `value, ts, quality, source` explicitly so quality/timestamp survive even without birth/death certs.
- **No writes.** The adapter only reads/receives. `vfd_comm_ok=false` ⇒ mark all VFD values **stale**, never silently trust them (this rule already lives in `machine_context.py`).

## 5. UNS path + MQTT topic shape (demo)

Use the existing UNS builders (`mira-crawler/ingest/uns.py`); do not hand-format paths. Illustrative demo addressing:

```
UNS path (persisted):  enterprise.garage.line1.conveyor1.gs10_vfd.vfd_frequency
MQTT topic (bench):    factorylm/garage/line1/conveyor1/gs10_vfd/vfd_frequency
Payload:               {"value": 6000, "scaled": 60.0, "unit": "Hz", "quality": "good", "ts": "<iso8601>", "source": "live-plc-bridge"}
```

(`.` for the persisted UNS, `/` for MQTT — the documented 10-line transform in `uns-kg-standards-compliance.md §6`.)

## 6. FactoryLM Hub / MIRA consumption

- The snapshot lands in a small **read-only landing/trace table** (reuse the `equipment_status` pattern in `mira-relay`), keyed by `uns_path` + `ts`.
- After the technician confirms the asset (UNS gate), the engine pulls the *latest snapshot for that confirmed `uns_path`* and attaches it to context — so live data is scoped to the confirmed machine, not a global blob.
- Retrieval (`rag_worker.py`/`neon_recall.py`) adds the GS10 manual fault-code section, the wiring rung for the photo-eye, and prior work orders; `citation_compliance.py` ensures the answer cites them.

## 7. What the technician can ask (and how MIRA answers)

| Question | Live tags used | Grounding |
|---|---|---|
| "Why won't Conveyor 1 start?" | `vfd_run_permit`, e-stop, `pe_latched`, `vfd_status_word` | run-permit logic in machine card + cited manual |
| "What fault is active on the GS10/GS11?" | `vfd_fault_code`, `vfd_comm_ok` | decoded fault table + manual section |
| "Is the photo-eye made / latched?" | `DI_05`/`pe_beam`, `pe_latched` | machine card soft-stop logic |
| "Is the motor commanded on?" | `vfd_cmd_word`, `vfd_status_word` | command-word decode |
| "Is the VFD ready?" | `vfd_comm_ok`, `vfd_status_word`, `vfd_fault_code` | trust gate + status |
| "What changed before the fault?" | snapshot history (trace log) | snapshot DB rows |
| "What manual section / wiring diagram applies?" | (asset context) | KG + retrieval citation |
| "What did the last technician do?" | (asset context) | work-order history |

## 8. How citations + live snapshots should appear

- **Live data is labelled and timestamped:** e.g. `Live (2026-06-04 14:03:11, source=ignition): VFD fault CE10 modbus timeout (code 58); comms LOST → other VFD values stale.`
- **Stated separately from cited knowledge:** the manual/wiring/work-order facts carry `[Source: …]` tags (existing `citation_compliance.py` behavior).
- **Never blended:** simulated values (if the bench sim is running) must be labelled `simulated`, never presented as live.

## 9. What proves the demo works

1. Ask "what fault is active?" with the VFD **healthy** → MIRA says no active fault, cites the status decode.
2. Inject/trigger a real fault (or, on the bench, clearly-labelled sim) → MIRA names the decoded fault, cites the manual section, recommends the first check, and the snapshot appears in the trace log.
3. Ask before confirming the asset → MIRA runs the **UNS confirmation gate first** (proves the gate survived).
4. Pull the trace log → each answer has an associated, timestamped, UNS-keyed snapshot (proves traceability).
5. Screenshots saved to `docs/promo-screenshots/` per the repo's Screenshot Rule.

## 10. Demo tiers

- **Mike's lab now:** bench MQTT (Pattern 3) + the snapshot adapter, with sim clearly labelled and the live bridge used when the Micro820 is on.
- **First customer demo:** Ignition Module + relay (Pattern 5), allowlisted read-only tags, outbound-HTTPS (ADR-0021).
- **Defer:** Sparkplug B framing, `equipment_telemetry` historian table, multi-machine fleet — until a customer needs them.
