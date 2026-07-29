# RESUME PROMPT — PLC-side data feed for PR #1668 (self-serve Ignition Module + Walker current-state spine)

**Paste this whole file into a fresh session to wire the real bench PLC into #1668's
current-state pipeline (relay → `tag_events` → flaky detector → Exchange demo).**

> #1668's software is code-complete but **inert without a live tag feed**. Its own
> "Still open" list says so: *"Wire physical PE-101 → flips the demo flaky step 🟥→🟢"*
> and *"Enable `RELAY_TAG_EVENTS=1` on a real stream (needs UUID tenant + seeded
> `approved_tags`)."* This file is the PLC half of that wiring.
>
> ⚠️ Before doing #1668 work, read `plc/RESUME_1668_PLC_FEED.md`'s sibling reality check:
> **#1668 is ~2,167 commits stale and mostly superseded on `main` — do NOT merge it as-is.**
> See `memory/project_conv_simple_anomaly.md`. The PLC-feed work below is reusable
> regardless of how #1668 itself is resolved (salvage vs rebase vs close).

---

## 1. The real bench (ground truth)

| Item | Value |
|---|---|
| PLC | Allen-Bradley Micro820 `2080-LC20-20QBB` |
| PLC address | **`192.168.1.100:502`** (Modbus TCP, unit 1) |
| Drive | AutomationDirect **GS10** VFD, RS-485 Modbus RTU slave addr 1, **9600 / 8N2** |
| PLC laptop | `192.168.1.50` (Ethernet to PLC) · Tailscale `100.72.2.99` · only host routed to `192.168.1.0/24` |
| Broker | Mosquitto (bench: `MQTT_HOST=100.68.120.99` or `mosquitto` in compose) |
| Bridge (on `main`) | `plc/live-plc-bridge/bridge.py` — polls PLC, publishes UNS JSON to `{UNS_PREFIX}/_streams/bridge/#` |
| Bridge UNS prefix | `UNS_PREFIX=demo/cell1/conveyor/cv101` (env-overridable) |
| Slave map | `plc/MbSrvConf_v4.xml` (v4.1.9, 22 coils + 17 HRs) — authoritative register list |

The bridge **already runs and was bench-verified 2026-06-01** (correctly fired the anomaly
engine's A1 when `vfd_comm_ok` went False). What it does NOT yet publish is the photo-eye.

---

## 2. What #1668's pipeline expects (the tag contract)

Source of truth: `tools/scenarios/conveyor_normal.yaml` (schema) + `conveyor_flicker.yaml`
+ `conveyor_gs10_f0004.yaml` on branch `feat/ignition-module-self-serve`.

- **equipment_id:** `CONV-001`  ·  **tenant_id:** `garage-demo` (string in mocks — real run needs a **tenant UUID**)
- **Relay key:** `tag_id = "<equipment_id>.<tag_name>"` (e.g. `CONV-001.pe101`), matched against `approved_tags`.
- **`uns_path`:** ltree (`.`-separated). Relay payload arrives `/`-separated and is normalised in `mira-relay/neon.py`.

**Canonical tag list the pipeline consumes:**

| pipeline tag | type | scenario UNS topic | real PLC source (MbSrvConf_v4) |
|---|---|---|---|
| `motor_running` | bool | `demo/training/conveyor001/motor/mtr001/running` | coil `000001` |
| `conveyor_running` | bool | `.../state/running` | coil `000002` |
| `fault_alarm` | bool | `.../faults/active` | coil `000003` |
| `vfd_comm_ok` | bool | `.../vfd/vfd001/comm_ok` | coil `000004` |
| `system_ready` | bool | `.../state/ready` | coil `000005` |
| **`pe101`** | bool | `.../sensors/pe101` | **DI_05 — NOT mapped yet** ❌ |
| **`pe102`** | bool | `.../sensors/pe102` | **2nd photo-eye — NOT wired/mapped** ❌ |
| `motor_speed` | int | `.../motor/mtr001/speed` | HR `400101` |
| `motor_current` | float | `.../motor/mtr001/current` | HR `400102` |
| `temperature` | float | `.../motor/mtr001/temperature` | HR `400103` |
| `error_code` | fault | (fault-window events) | HR `400106` |

**The flaky demo keys on `pe101`:** 7 rapid falling edges in a ~5.6 s window while peer
`pe102` stays static → `_check_rapid_toggle` rule fires in `mira-bots/agents/flaky_input_detector.py`.

---

## 3. The gaps — what the PLC side must ADD for #1668 to function live

These are the actual to-dos. Items 1–4 are the **same slave-map-v2 / PE-101 work** that
also wakes the conv_simple anomaly engine's dormant A12 rule — do it once, both benefit.

1. **Wire the photo-eyes.** Physical **PE-101** → Micro820 `DI_05`; add **PE-102** on a free DI
   as the stable peer (the flaky rule needs a healthy peer to isolate the fault).
2. **Extend the slave map** (`MbSrvConf.xml`, `modbus-slave` skill) so the PLC publishes:
   - coil `000020` ← `DI_05` photo-eye (`di05_photoeye`)
   - coil `000021` ← `pe_latched` (photo-eye latching soft-stop), optional
   - (for the conv_simple A2/A7 rules, also add a VFD fault/status HR — see `CCW_VARIABLES_v4.1.9_DELTA.md`)
3. **Reflash the Micro820** (`ccw-build`). Confirm Serial Port "in sync".
4. **Uncomment the bridge topics** in `plc/live-plc-bridge/bridge.py`:
   - lines ~91–92: `20: "plc/di/di05_photoeye"`, `21: "safety/pe_latched"`
   - and the matching `HR_SPECS` / read-plan widening noted at ~line 111.
   - Also un-comment the parallels in `plc/conv_simple_anomaly/live_check.py`.
5. **Reconcile the UNS namespace.** Bridge emits `demo/cell1/conveyor/cv101/...`; the #1668
   scenarios use `demo/training/conveyor001/...`. Pick ONE canonical UNS path and make the
   bridge topics, `approved_tags.uns_path`, and the Exchange listing all agree.
6. **Verify the coil/HR mapping.** The bridge's `COIL_TOPICS` offsets and `MbSrvConf_v4.xml`
   addresses must be cross-checked (e.g. bridge coil `3`→`vfd/vfd101/comm_ok` vs MbSrvConf
   `fault_alarm@000003` / `vfd_comm_ok@000004` — confirm which is the live truth before seeding).

---

## 4. The relay/DB side (so the feed actually lands)

The bridge today publishes to **MQTT/Mosquitto** (UNS). #1668's relay consumes a tag stream
and writes diffs to NeonDB `tag_events`. To connect them:

- **Feed path:** point `mira-relay/diff_logger.py` at the bridge stream (or run the Ignition
  gateway publisher `ignition/gateway-scripts/tag-stream.py` → relay). diff_logger loads
  per-tag thresholds from `approved_tags` once per batch via `neon.load_approved_tags`.
- **Seed `approved_tags`** (migration `035`, keyed `tag_id → {uns_path, data_type, threshold}`)
  for the tenant — one row per tag in §2. Empty table = pass-all (no dead-band).
- **Real tenant:** replace `garage-demo` with a tenant **UUID**; seed `approved_tags` under it.
- **Env toggles (opt-in, off by default):**
  - `NEON_DATABASE_URL` (or `DATABASE_URL`)
  - `RELAY_TAG_EVENTS=1` — enables Neon writes
  - `RELAY_LEGACY_BEARER=0` — require HMAC auth (set the shared secret)
  - `TAG_EVENTS_RETENTION_DAYS=90` (rollup default)
- **Migrations:** #1668's `032–035` already exist on `main` (different content — verify before
  applying); its `036/037/038` **collide** with main's — renumber to **`040–042`** (free) if salvaged.

---

## 5. Acceptance — "the PLC feed works"

1. Bench: `python plc/conv_simple_anomaly/live_check.py --secs 4` reads `192.168.1.100:502`
   and shows `di05_photoeye` toggling when you break the PE-101 beam.
2. Bridge publishes `.../sensors/pe101` on the broker (subscribe to confirm).
3. With `RELAY_TAG_EVENTS=1` + seeded `approved_tags`, breaking PE-101 ~7× rapidly produces
   `falling_edge`/`rising_edge` rows in `tag_events` and a `flaky_signal_alert` in
   `ai_suggestions` — the Exchange demo flaky step goes 🟥→🟢.
4. `conveyor_gs10_f0004` equivalent on real hardware: a GS10 comm trip yields a
   `fault_window_open`/`fault_window_close` pair in `tag_events`.

---

## 6. Pointers

- Tag contract / schema: `tools/scenarios/conveyor_normal.yaml` (branch `feat/ignition-module-self-serve`)
- Mock generator (mirror for real shape): `tools/mock_tag_stream.py`
- Flaky rule logic: `mira-bots/agents/flaky_input_detector.py`, `mira-bots/shared/flaky_rules.py`
- Relay: `mira-relay/{diff_logger,neon,rollup_worker}.py` (+ `tests/test_neon_sql.py` guards the ltree/jsonb casts)
- Real bridge: `plc/live-plc-bridge/bridge.py` · Slave map: `plc/MbSrvConf_v4.xml`
- Sibling dormant-rule work (same PE-101 gap): `plc/conv_simple_anomaly/` + `memory/project_conv_simple_anomaly.md`
- #1668 itself: `gh pr view 1668` · build plan `docs/plans/2026-06-02-ignition-module-self-serve-build.md`
