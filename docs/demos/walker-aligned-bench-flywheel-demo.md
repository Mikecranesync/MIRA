# Walker-Aligned Bench Flywheel Demo — Garage Conveyor

**Status:** Demo script (planning + runbook). Marks REAL vs SIMULATED vs PENDING at every step.
**Authored:** 2026-06-02
**Owner:** Mike Harper
**Proves:** the Walker DT journey end-to-end on the Lake Wales garage conveyor — connect → current state → pattern → root-cause-across-unrelated-data → human-verified KG growth → component-template reuse.
**Source plan:** `docs/plans/2026-06-01-mira-master-architecture-plan.md` §D7 (the 9-step flywheel) + Phase 12. **Honesty source:** `docs/research/2026-06-01-dt-alignment-analysis.md` §5 (garage conveyor as DT proof — what's real, what's simulated).

> **Read this first.** This demo is **partly runnable on the real bench today and partly gated on unbuilt master-plan phases.** Every step below carries a status tag:
> - 🟢 **REAL** — runs on the physical Micro820 + GS10 right now.
> - 🟥 **SIMULATED** — works today but on injected/mock data (e.g. the flaky prox is `fault-sim`, not a wiggled wire).
> - 🔵 **PENDING-Pn** — the customer-shippable / Walker-grade version depends on master-plan Phase *n* which is not built.
>
> The alignment analysis (§5) is explicit: the **VFD/motor/comm-fault path is genuinely real**; the **sensor-fault path is REST-injected by `mira-fault-sim/sim.py`**. This script does not pretend otherwise. The "gap to a true Walker demo" is §5 of the analysis and §9 below.

---

## 0. What each of the 11 proof points actually rests on today

| # | Proof point | Today's reality | Status |
|---|---|---|---|
| 1 | Command Center shows UNS path for bench conveyor | Hub `/command-center` tree shows real `enterprise.*` `kg_entities` | 🟢 REAL (tree) / 🔵 PENDING-P5 (live-data reconciliation to ISA-95) |
| 2 | HMI reachable ≠ tag freshness | Command Center green dot = HTTP display probe, honest in code | 🟢 REAL |
| 3 | Real live tag data from Micro820/GS10 | `live-plc-bridge` polls 192.168.1.100:502 @ 500 ms; Ignition `ConveyorStatus` CIP tags | 🟢 REAL |
| 4 | Trigger a real bench input fault (flaky prox) | `fault-sim` `/inject/debounce_chatter` injects PE-101 chatter; **wire is not physically wiggled** | 🟥 SIMULATED |
| 5 | FlakyInputDetector detects it from `tag_events` | `mira-fault-detective` `rule_pe101_chatter` detects from **MQTT**, writes SQLite; the `tag_events`-fed `FlakyInputDetector` is Phase 9 | 🟥 SIMULATED (rule fires) / 🔵 PENDING-P5/P9 (`tag_events` path) |
| 6 | MIRA creates a relationship proposal with live evidence | Proposal → evidence → review loop is Phase 3; today fault-detective writes a SQLite diagnosis, not `relationship_proposals` | 🔵 PENDING-P3 |
| 7 | Ask MIRA "why is the conveyor confused?" | `mira-pipeline` chat works; Perspective "Ask MIRA" / Ignition chat endpoint | 🟢 REAL (chat) / 🔵 PENDING-P6 (direct-connection `source` flag) |
| 8 | MIRA answers from real tag history + manual + KG | RAG over `knowledge_entries` (GS10 seeded) + `kg_maintenance_context` works; live `tag_events` history is Phase 5 | 🟢 REAL (manual+KG) / 🔵 PENDING-P5 (tag history) |
| 9 | Technician approves/rejects the proposed relationship | Hub `/proposals` decide endpoint exists (PR #1332) | 🟢 REAL (UI) / 🔵 PENDING-P3 (write-through helper) |
| 10 | KG updated only after human approval | `proposed → verified` is a human action by rule | 🟢 REAL (doctrine) / 🔵 PENDING-P3 (enforced helper) |
| 11 | Component-template inheritance for a 2nd deployment | `component_templates` (Hub 016) + `installed_component_instances` (Hub 017) exist; GS10 template seeded | 🟢 REAL (schema+seed) / 🔵 PENDING-P2 (nameplate→instance API) |

**Bottom line:** steps 1–3, 7–11 have a real spine today; steps 4–6 are the simulated/pending core. This script runs the **real spine now** and gives the **target wiring** for the pending parts, clearly fenced. When Phases 3/5/9 land, the same script runs end-to-end with zero simulation in steps 4–6.

---

## 1. Prerequisites

### 1.1 Hardware (the bench)

| Component | Detail | Reference |
|---|---|---|
| **Micro820 PLC** | `192.168.1.100:502` (Modbus TCP). Ladder = `plc/Micro820_v4.1.9_Program.st` (5-state FSM, 5 s `vfd_err_timer`). | `plc/Micro820_v4.1.9_Program.st` |
| **GS10 (Durapulse) VFD** | Modbus RTU RS-485 → Micro820. `P09.03=5` s comm timeout → CE10. | analysis §5 |
| **Photo-eyes / prox (PE-101, PE-102, PX-101)** | Real sensors on the conveyor. **Note:** their *fault* injection in this demo is simulated; their nominal state is real. | `plc/MbSrvConf_v4.xml` |
| **Modbus map** | `plc/MbSrvConf_v4.xml` — v4 deployed to the bench PLC 2026-05-29. Coils 0–6, HR 400101–400117. | memory `project_garage_demo_live_pipeline` |
| **Ignition Gateway** | On the PLC laptop, reachable at **`100.72.2.99:8088`** (Tailscale). Project `ConvSimpleLive`, Perspective views `ConveyorStatus` / `FaultLog` / `SpeedControl` / `NavBar`. | `ignition/project/com.inductiveautomation.perspective/views/` |

**Pre-flight checks (run before the demo):**

```bash
# PLC reachable + map deployed (no ILLEGAL_FUNCTION = map is live)
python -m tools.demo_plc_poller --plc-ip 192.168.1.100 --dry-run --poll-interval 1.0
# → expect rising/falling/value_changed events, NOT pymodbus ILLEGAL_FUNCTION.
#   If ILLEGAL_FUNCTION: map not deployed → plc/deploy_modbus_map.py --auto, then CCW Download + RUN.

# Ignition gateway up
curl -sS -o /dev/null -w "%{http_code}\n" http://100.72.2.99:8088/StatusPing   # → 200
```

> ⚠️ `plc/live_monitor.py` and `plc/live-plc-bridge/bridge.py` are **BENCH-ONLY** (`.claude/rules/fieldbus-readonly.md`). They write/poll the PLC directly and must never appear in a customer compose. This demo uses them only because we are physically at the bench.

### 1.2 Software services

| Service | Port | Start | Role in demo |
|---|---|---|---|
| `mira-relay` | 8765 | part of `docker-compose.saas.yml` (or run locally) | Cloud-side HMAC tag ingest → SQLite `equipment_status` |
| `mira-pipeline` | 9099 | `docker compose up -d mira-pipeline` | Chat path (Supervisor engine) — steps 7–8 |
| `mira-mcp` | 8000/8001 | `docker compose up -d mira-mcp` | `kg_maintenance_context`, CMMS, equipment status |
| `mira-hub` | (app.factorylm.com / local) | `cd mira-hub && bun run dev` | `/command-center`, `/proposals` — steps 1, 9 |
| **Bench harness** (BENCH-ONLY) | 1883 / 8089 | `docker compose -f docker-compose.fault-detective.yml up -d` | `mosquitto`, `fault-sim`, `fault-detective`, `live-plc-bridge` — steps 3–6 |

```bash
# One-time: bring up the real-data + simulation harness (BENCH-ONLY — see compose header)
cd ~/MIRA
docker compose -f docker-compose.fault-detective.yml up -d
docker compose -f docker-compose.fault-detective.yml ps   # all healthy?
# fault-sim health + available fault modes:
curl -s localhost:8089/health
curl -s localhost:8089/modes   # → includes "debounce_chatter", "pe101_chatter"
```

### 1.3 Seed data present

- GS10 + Micro820 component knowledge in `knowledge_entries` / KG: `tools/seeds/gs10-vfd-knowledge.sql` (cite-able manual chunks).
- `component_templates` row for `Durapulse GS10` (Hub 016) — needed for step 11 inheritance.
- Bench entities in `kg_entities` under `enterprise.garage.demo_cell.*` (or `enterprise.lake_wales.bench.conveyor.*` — use whichever the tenant tree actually holds; confirm in `/command-center`).

---

## 2. Demo flow — step by step

UNS path used throughout (confirm against the live tree first):
`enterprise.garage.demo_cell.conveyor.gs10`

### Step 1 — Open Command Center, show the UNS path 🟢 REAL (tree)

1. Open `https://app.factorylm.com/command-center` (or local Hub `/command-center`).
2. Expand the tree to `enterprise.garage.demo_cell.conveyor.gs10`.

**Expected UI:** the ISA-95 tree renders the bench conveyor and its GS10 as a node. The path string is visible.

**Expected DB:** a `kg_entities` row with `uns_path = enterprise.garage.demo_cell.conveyor.gs10`.
```sql
SELECT id, name, uns_path FROM kg_entities
 WHERE uns_path <@ 'enterprise.garage.demo_cell'::ltree;   -- ltree descendant query
```

> 🔵 PENDING-P5: today the live MQTT stream uses the flat `demo/cell1/conveyor/cv101` namespace (see the compose `UNS_PREFIX`), which does **not** reconcile to this ISA-95 path. The green dot in step 2 is display reachability, not tag freshness bound to this path. Reconciliation is master-plan Phase 5 (analysis §5 gap-2).

### Step 2 — HMI reachable, separately from tag freshness 🟢 REAL

1. In the Command Center, note the display's **reachability dot** (green = the HMI URL responded).
2. Point out in `mira-hub/src/app/api/command-center/tree/route.ts`: the dot is a server-side `probe()` of the display URL (2 s timeout) — **HTTP reachability, not PLC signal freshness**.

**Expected UI:** green dot when the Ignition Perspective page (`100.72.2.99:8088`) answers; it would stay green even if the PLC tags were stale. This is the honesty point: "the HMI page responded" ≠ "the asset is running."

### Step 3 — Real live tag data from Micro820/GS10 🟢 REAL

1. The `live-plc-bridge` container is polling `192.168.1.100:502` @ 500 ms and publishing to MQTT `demo/cell1/conveyor/cv101/*`.
2. Watch the real stream:
```bash
mosquitto_sub -h localhost -t 'demo/cell1/conveyor/cv101/#' -v | head -40
# → real motor_speed / motor_current / DC-bus / run-stop / fault state from the GS10.
```
3. In Ignition Perspective `ConveyorStatus` (`100.72.2.99:8088`), the GS10 freq/current update live via CIP.

**Expected:** non-zero, moving values that track the physical conveyor. Stop the belt → `motor_speed` falls. This is real current state (Walker step 1) — on the bench, via bench tooling.

### Step 4 — Trigger a bench input fault (flaky prox/photoeye) 🟥 SIMULATED

> **Honesty:** today the flaky input is **injected**, not a physically wiggled wire. The GS10/motor/comm-fault path is real; the sensor-fault path is `fault-sim`. To make this 🟢 REAL, wire PE-101 to a real Modbus DI and physically intermittent the connection (analysis §5 gap-1, the single highest-credibility upgrade).

Inject the flaky photo-eye:
```bash
# Aggressive prox chatter: 6+ drops/sec on PE-101 raw, peers stay clean
curl -s -X POST localhost:8089/inject/debounce_chatter
curl -s localhost:8089/state | python -m json.tool   # waiting_on: "PE-101 raw chatter (>5 drops/sec)"
```

**Expected MQTT:** `demo/cell1/conveyor/cv101/sensors/pe101` toggles rapidly while `pe102` / `px101` stay stable (the "stable peers" signature the rule keys on).

To reset to clean: `curl -s -X POST localhost:8089/inject/normal`.

### Step 5 — Detector flags it 🟥 SIMULATED (rule fires) / 🔵 PENDING-P5/P9

**Today (real, but MQTT-fed):** `mira-fault-detective` is subscribed to all topics; `rule_pe101_chatter` (`mira-fault-detective/rules.py:303`) fires when PE-101 shows ≥5 dropouts/window with stable peers (confidence 0.85).

```bash
docker compose -f docker-compose.fault-detective.yml logs -f fault-detective | grep -i chatter
# → a Diagnosis for rule_pe101_chatter, written to the bench SQLite mira.db.
sqlite3 mira-bridge/data/mira.db \
  "SELECT rule_id, confidence, detail FROM events ORDER BY rowid DESC LIMIT 3;"
```

**Target (PENDING-P5 + P9):** the Walker-grade path is the `FlakyInputDetector` worker (master-plan Phase 9, `mira-bots/agents/flaky_input_detector.py`) reading the `tag_events` stream (Phase 5) and emitting a `flaky_input_signals` row. That table + worker are **not built** — they are the deliverable D6/Phase 9 in the master plan.

**Expected DB (target, Phase 9):**
```sql
SELECT alert_id, rule_id, transitions_count, expected_max, status
  FROM flaky_input_signals
 WHERE uns_path <@ 'enterprise.garage.demo_cell.conveyor.gs10'::ltree;   -- PENDING-P9
```

### Step 6 — MIRA creates a relationship proposal with live evidence 🔵 PENDING-P3

**Today:** fault-detective records a diagnosis in SQLite; it does **not** write `relationship_proposals` / `ai_suggestions`. There is no runtime auto-proposal from a live fault (analysis §1 Walker #9: "nothing in the *running* stack auto-proposes a KG edge from a live fault event").

**Target (Phase 3 + Phase 9):** the flaky alert bridges an `ai_suggestions` row of type `flaky_signal_alert`, and the wiring inference proposes a `relationship_proposals` edge ("PE-101 → TB2-15 loose") with `relationship_evidence` rows pointing at the live `tag_events` window + the manual page.

**Expected DB (target):**
```sql
-- PENDING-P3: written via mira_bots/shared/proposal_transition.py, NOT direct INSERT
SELECT rp.id, rp.source_id, rp.target_id, rp.relationship_type, re.evidence_kind, re.evidence_ref
  FROM relationship_proposals rp
  JOIN relationship_evidence re ON re.proposal_id = rp.id
 WHERE rp.status = 'proposed';
SELECT id, suggestion_type, status FROM ai_suggestions WHERE suggestion_type IN ('kg_edge','flaky_signal_alert');
```

### Step 7 — Ask MIRA: "Why is the conveyor confused?" 🟢 REAL (chat) / 🔵 PENDING-P6

Ask from the Ignition Perspective "Ask MIRA" panel (direct connection) **or** Slack (chat-gate).

```bash
# Direct-connection path (Ignition-shaped) — mira-pipeline
curl -s -X POST localhost:9099/api/v1/ignition/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "Why is the conveyor confused?",
    "asset_context": {"site":"garage","area":"demo_cell","line":"conveyor","equipment":"gs10"},
    "tenant_id": "<tenant>"
  }'
```

**Expected (direct connection):** MIRA goes **straight to grounded diagnosis — no "are you sure you're looking at CV-101?" question** (`.claude/rules/direct-connection-uns-certified.md`).

> 🔵 PENDING-P6: today `ignition_chat.py` sets a per-asset `chat_id` but does **not** yet set `state["uns_context"]["source"]="direct_connection"` (master-plan §1.1 gap; Phase 6 closes it). Until then the bypass may not be fully wired — if the gate fires anyway, that's the known Phase-6 gap, not a hardware problem. On Slack the chat-gate is *expected* to fire (confirm asset first).

### Step 8 — MIRA answers from real tag history + manual + KG 🟢 REAL (manual+KG) / 🔵 PENDING-P5 (tag history)

**Expected answer content:**
- **Manual citation (🟢 REAL):** GS10 comm-timeout page (from `tools/seeds/gs10-vfd-knowledge.sql` chunks) + the 5 s `vfd_err_timer` behavior.
- **KG context (🟢 REAL):** `kg_maintenance_context` bundle for the GS10 (components, fault history, related manuals).
- **Live tag evidence (🔵 PENDING-P5):** "PE-101 flickered 14× in the last hour" requires the `tag_events` history surface. Today the live count is in the bench SQLite, not the cloud `tag_events` table the engine would cite. The Walker-grade answer that cites the live flicker count + the comm-timeout is gated on Phase 5.

**Verify grounding (real part):**
```bash
# The reply must carry ≥1 citation; uncited replies are a bug (citation enforcement = Phase 7)
# Check decision/eval log for cited chunk_ids.
```

### Step 9 — Technician approves/rejects the proposed relationship 🟢 REAL (UI) / 🔵 PENDING-P3

1. Open Hub `/proposals`.
2. Find the proposed "PE-101 → TB2-15" edge (target state; today seed a fixture if Phase 3 isn't built — see §7 mock).
3. Tech edits ("it's TB2-15 not TB2-14") and clicks **Approve** (or **Reject**).

**Expected UI:** the `/proposals` reviewer queue shows the edge with its evidence; Approve/Edit/Reject act on it (decide endpoint shipped PR #1332).

### Step 10 — KG updated only after human approval 🟢 REAL (doctrine) / 🔵 PENDING-P3

**Expected DB after Approve:**
```sql
-- a verified edge appears ONLY after the human action, written through the helper
SELECT source_id, target_id, relationship_type, approval_state
  FROM kg_relationships
 WHERE approval_state = 'verified'
 ORDER BY id DESC LIMIT 5;
```
**Expected after Reject:** proposal marked `rejected`; **no** `kg_relationships` insert.

> 🔵 PENDING-P3: the rule "every `proposed → verified` is a human action" is doctrine and the UI exists; the *enforced* write-through (`mira_bots/shared/proposal_transition.py` / `mira-hub/lib/proposal-transition.ts`, ADR-0017) is master-plan Phase 3. Until it lands, a direct `INSERT INTO kg_relationships` from the ingest path is still possible — Phase 3's audit grep closes that.

### Step 11 — Component-template inheritance for a 2nd deployment 🟢 REAL (schema+seed) / 🔵 PENDING-P2

1. Onboard a second (mock) plant with a Durapulse GS10.
2. Attach its asset to the same `component_templates` row.

**Expected:** the new `installed_component_instances` row inherits the GS10 template's structure (fault codes, manual links, component sub-tree) at ~80% — the "Knowledge Cooperative" head start (analysis §5; master-plan D7 T+4:30).

**Expected DB:**
```sql
SELECT ici.id, ici.uns_path, ct.model, ct.manufacturer
  FROM installed_component_instances ici
  JOIN component_templates ct ON ct.id = ici.template_id
 WHERE ct.model = 'GS10';
```

> 🔵 PENDING-P2: the nameplate-photo → draft `installed_component_instance` API (`POST /api/v1/ingest/nameplate`) is master-plan Phase 2. Today you can demonstrate inheritance by inserting the instance manually / via existing nameplate worker invoked from chat; the self-serve photo path is Phase 2.

---

## 3. Expected database rows — consolidated

| Step | Table | Key expectation | Status |
|---|---|---|---|
| 1 | `kg_entities` | row at `uns_path = enterprise.garage.demo_cell.conveyor.gs10` | 🟢 |
| 3 | `equipment_status` (relay SQLite) | latest GS10 snapshot, real values | 🟢 |
| 5 | bench `mira.db` `events` | `rule_pe101_chatter` diagnosis | 🟥 |
| 5 | `flaky_input_signals` | flaky row at the GS10 path | 🔵 P9 |
| 6 | `relationship_proposals` + `relationship_evidence` | `proposed` edge w/ live evidence | 🔵 P3 |
| 6 | `ai_suggestions` | `flaky_signal_alert` + `kg_edge` rows | 🔵 P3/P9 |
| 8 | engine eval/decision log | reply carries ≥1 cited chunk_id | 🟢 (manual) |
| 10 | `kg_relationships` | `verified` edge only after Approve | 🟢 doctrine / 🔵 P3 |
| 11 | `installed_component_instances` | inherits GS10 `component_templates` | 🟢 schema / 🔵 P2 |

---

## 4. Expected UI behavior — consolidated

- **Command Center** (`/command-center`): ISA-95 tree with the GS10 node; reachability dot reflects the Ignition page at `100.72.2.99:8088`.
- **Ignition Perspective** (`ConveyorStatus`, `100.72.2.99:8088`): live GS10 freq/current; `FaultLog` shows the CE10/comm-timeout when the real fault path fires.
- **Slack / Perspective chat:** direct-connection → no asset re-confirmation; grounded reply with manual citation.
- **Hub `/proposals`:** the proposed edge with Approve/Edit/Reject; approving moves it to the KG.

---

## 5. The real fault path (use this for the highest-credibility moment) 🟢 REAL

The most honest, most impressive real moment on this bench does **not** need any simulation:

1. Bench operator hits **e-stop** (or induces RS-485 two-master contention).
2. GS10 polls CRC-fail → Micro820's 5 s `vfd_err_timer` expires (`plc/Micro820_v4.1.9_Program.st`) → `fault_alarm` / `error_code=9` / `conv_state=FAULT` → **motor stop**. GS10 mirrors with CE10 (`P09.03=5`).
3. This is a **real** fault, on **real** hardware, surfaced through **real** tags. Ask MIRA about it → grounded answer citing the GS10 comm-timeout manual page + the 5 s watchdog.

The promo scripts already lean on this truthfully (`marketing/comic-pipeline/scripts/phase5-video-13-ask-conveyor.yaml`: "This isn't a sandbox. It's a real Micro 820, a real GS10 drive, real photo-eyes."). Lead the live demo with this path; use the simulated prox-chatter (steps 4–6) to *illustrate* the flaky-input flywheel that Phase 9 will run on real wired inputs.

---

## 6. Rollback / reset

```bash
# 1. Clear injected fault, return sim to clean cycle
curl -s -X POST localhost:8089/inject/normal

# 2. Tear down the BENCH-ONLY harness (does NOT touch the customer stack)
docker compose -f docker-compose.fault-detective.yml down

# 3. Reset bench diagnosis history (SQLite — bench only)
sqlite3 mira-bridge/data/mira.db "DELETE FROM events WHERE rule_id LIKE 'rule_pe101%';"

# 4. Revert any demo proposals (staging/dev only — NEVER prod NeonDB)
#    Use the Hub /proposals Reject action, or on dev DB:
#    UPDATE relationship_proposals SET status='rejected' WHERE status='proposed' AND <demo filter>;
#    (Go through proposal_transition helper once Phase 3 ships; never hand-edit prod — prod-guard.)

# 5. PLC: leave the ladder + v4 map deployed. Do NOT re-flash for a demo reset.
```

> ⚠️ Never run rollback SQL against prod NeonDB from a code session (`prod-guard.sh`, root CLAUDE.md Environments). Demo data lives on dev/staging; the bench SQLite is local.

---

## 7. Mock-first fallback (no hardware / off-bench rehearsal) 🔵 PENDING-P4

To rehearse the script without the physical PLC (e.g. for recording), the master plan provides a mock collector (Phase 4, **not yet built**):

- `tools/mock_tag_stream.py` driven by `tools/scenarios/conveyor_flicker.yaml` → emits events to `mira-relay /ingest` (replaces steps 3–5 with deterministic mock data).
- `tools/scenarios/conveyor_gs10_f0004.yaml` → drives the fault-window path for step 8.

Until Phase 4 lands, the off-bench fallback is `tools/demo_plc_simulator.py` (Modbus TCP server on port 5020) + `tools/demo_plc_poller.py --plc-ip 127.0.0.1 --port 5020`, which exercises the poll→diff→relay path without the real PLC. This proves the pipeline shape, not the real signal.

---

## 8. Service / file reference

| Thing | Path |
|---|---|
| Ladder logic (real fault path) | `plc/Micro820_v4.1.9_Program.st` |
| Ground-truth Modbus map | `plc/MbSrvConf_v4.xml` |
| Bench monitor (BENCH-ONLY, writes GS10) | `plc/live_monitor.py` |
| Bench Modbus→MQTT bridge (BENCH-ONLY) | `plc/live-plc-bridge/bridge.py` |
| Demo poller (read-only, real or sim) | `tools/demo_plc_poller.py` |
| Demo Modbus simulator | `tools/demo_plc_simulator.py` |
| Fault simulator (`/inject/<mode>`) | `mira-fault-sim/sim.py` |
| Rule engine (`rule_pe101_chatter`) | `mira-fault-detective/rules.py`, `engine.py` |
| Bench harness compose (BENCH-ONLY) | `docker-compose.fault-detective.yml` |
| Ignition project (Perspective views) | `ignition/project/com.inductiveautomation.perspective/views/` |
| Ignition gateway scripts (tag-stream) | `ignition/gateway-scripts/tag-stream.py` |
| Command Center tree (reachability probe) | `mira-hub/src/app/api/command-center/tree/route.ts` |
| GS10 KB seed | `tools/seeds/gs10-vfd-knowledge.sql` |

---

## 9. The gap to a true "that's digital transformation" demo

Carried verbatim-in-spirit from `dt-alignment-analysis.md` §5 — the four upgrades that turn this from "real spine + simulated core" into the demo that earns Walker's nod:

1. **Wire the sensors** (🟥→🟢). Move PE-101/102 faults from `fault-sim` REST injection to real Modbus-mapped DI so flaky-wire detection runs on *physical* intermittency. Single highest-credibility upgrade.
2. **Reconcile live data to ISA-95 UNS** (🔵-P5). Map `demo/cell1/...` MQTT topics to `enterprise.garage.demo_cell.*` so the green dot means "this real asset, at this path, is running."
3. **Close the self-growing-graph loop** (🔵-P3/P9). A confirmed bench fault auto-proposes a `kg_relationship` into `relationship_proposals` → `/proposals` → verify.
4. **Build Phase 12.** Once Phases 3/4/5/6/9 land, this script runs end-to-end with no simulation in steps 4–6 — a *recording* task, not a design task.

When all four are done, every status tag in §0 reads 🟢, and the eleven proof points are real.

## 10. Cross-references

- `docs/plans/2026-06-01-mira-master-architecture-plan.md` — §D7 demo, Phases 3/4/5/6/9/12.
- `docs/research/2026-06-01-dt-alignment-analysis.md` — §5 (what's real vs simulated on this bench).
- `docs/mira-ignition-secure-architecture.md` — the customer-shipped path the bench harness is NOT.
- `docs/integrations/ignition-tag-collector.md` — the real collector that replaces `live-plc-bridge` for customers.
- `.claude/rules/fieldbus-readonly.md` — bench-only fencing for `live_monitor.py` / `live-plc-bridge`.
- `.claude/rules/direct-connection-uns-certified.md` — why step 7 skips the gate.
