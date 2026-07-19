# Discharge Conveyor CV-200 — troubleshoot-from-desk (plan)

**Date:** 2026-06-28 · **Branch:** `feat/discharge-conveyor-cv200` · **Tenant:** Northwind
Beverage `00000000-0000-0000-0000-0000000000b1` (prod-seeded) · **Asset:** Discharge Conveyor
CV-200 = the **real physical rig** (Allen-Bradley Micro820 v4.1.9 + AutomationDirect GS10 VFD).

## Goal (the one sentence)

A user sitting at their desk opens the FactoryLM Command Center, clicks the **Discharge Conveyor**,
sees the **live Ignition HMI** framed with real tag states, asks **"what's going on with the
discharge conveyor?"**, and MIRA answers with a **grounded, cited diagnosis** off the live signal,
the in-gateway anomaly engine, the ingested manuals, and the work-order history — **no chat-gate,
read-only**.

## The end-to-end flow (what we are wiring toward)

```
 Desk browser  app.factorylm.com → Command Center (Northwind tenant)
        │  click "Discharge Conveyor CV-200"  (uns: …line1.equipment.discharge_conveyor_cv200)
        ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ Hub Command Center                                                     │
 │  • frames the LIVE Ignition Perspective ConvSimpleLive HMI (green dot) │  display_endpoints row
 │  • "Ask MIRA" panel on the node  ───────────────────────────────────┐ │
 └──────────────────────────────────────────────────────────────────────┘ │
        ▲ live tag states                                                   │ direct-connection turn
        │                                                                   │ (UNS-certified, skips gate)
 PHYSICAL RIG (Micro820 + GS10)                                            ▼
   │ Ignition gateway reads tags (OPC) ──► MQTT / HTTP relay ──► ingest_batch ──► live_signal_cache
   │                                       (one-pipeline law)                     + tag_events
   │ in-gateway A0–A12 anomaly rules ─────────────────────────────────────► current_fault
        ▼
 MIRA engine grounds the answer on:  live_signal_cache (latest tags)
                                   + A0–A12 anomaly verdict
                                   + ingested manuals (Micro820 map + GS10) — is_private=true
                                   + WO history (WO-L1-007) + PM (p7)
        ▼  cited diagnosis · evidence · recommended first check · safety note
```

## What ALREADY EXISTS (do not rebuild — reuse) — but bound to the *garage* tenant

These were built for the lab rig under the garage tenant (`e88bd0e8…` /
`enterprise.home_garage.conveyor_lab.conveyor_1`). The work below is **re-tenanting them to
Northwind's discharge-conveyor subtree**, not building new.

| Piece | Where | State |
|---|---|---|
| Live Ignition Perspective HMI `ConvSimpleLive` | PLC-laptop gateway `100.72.2.99:8088` | Live, bound to MIRA_IOCheck tags; framed in dev via origin-root XFO-stripping proxy (`docs/command-center-ignition-display.md`) |
| Command Center display registration | `display_endpoints` table + `POST /api/command-center/display` + UI onboarding | Working; dev row points the garage conveyor at the proxy |
| In-gateway anomaly engine (A0–A12) | `plc/conv_simple_anomaly/rules_core.py` (dual Py2.7/3.12) | Phase 1 done (`83ea8e81`); emits `current_fault` |
| Fault-Detective demo (Mosquitto :1883 + sim + 7-rule engine + Node-RED HMI + MIRA chat) | `docs/conveyor-fault-detective-demo/`, `docker-compose.fault-detective.yml` | Bench harness — **bench-only**, not the customer path |
| HTTP relay ingest (L1/L2) → `ingest_batch` → `live_signal_cache` | `mira-relay/tag_ingest.py`, `mira-relay/ingest_contract.py` | Turnkey (PR #2280); `normalize_tag_path` + `build_ingest_batch` consolidated (Lane-3 §7.1/§7.2 done) |
| Direct-connection UNS certification (skip chat-gate) | `.claude/rules/direct-connection-uns-certified.md`, `mira-pipeline/ignition_chat.py` | Rule + first surface exist |
| Train-before-deploy gate (validated asset agent before HMI answers) | `.claude/rules/train-before-deploy.md`, `docs/specs/asset-agent-validation-spec.md` | Doctrine; gate behind `ENFORCE_ASSET_AGENT_GATE` |
| The seeded asset | `tools/seeds/northwind-bottling-hub.sql` → CV-200 (this branch) | Validated on staging (21/7/7-5open/7) |

## What is NET-NEW (the actual work, sequenced)

### Step 0 — land the seed (this branch) — DONE on staging, prod is a handoff
CV-200 + motor + GS10 VFD entities, the `cmms_equipment` row (with `uns_topic_path`
`enterprise/riverside/packaging/line1/discharge_conveyor_cv200` — the live-binding key), WO-L1-007
(open), PM p7, the GS10→motor DRIVES edge. Counts 21/7/7(5 open)/7. **Prod: re-run the same seed
command** in `HANDOFF-prod-seed.md` (idempotent `ON CONFLICT` — additive, safe). *No prod write
from this session (env doctrine + prod-guard).*

### Step 1 — extend the live nervous system to the CV-200 subtree (the crux)

> **ADD, don't repoint.** One physical rig currently feeds the *garage* tenant's ConvSimpleLive
> demo. `display_endpoints` is per-tenant, so a Northwind row coexists fine. But **ingest is
> per-config (one subscriber/relay-config ↔ one tenant)** — feeding Northwind's `live_signal_cache`
> means **adding a second Northwind-tenant ingest config**, NOT repointing the garage one.
> Repointing would silently break the existing garage demo. Both can publish from the same rig.
1. **Display:** register a `display_endpoints` row for **(Northwind tenant, CV-200 uns_path) →
   ConvSimpleLive**. In prod do this via `POST /api/command-center/display` or the UI onboarding
   flow — **NOT** the `command_center_conveyor.sql` seed (it is DEV/STAGING-ONLY by header). Point
   `host:port` at the **origin-root XFO-stripping proxy**, never the raw gateway (Perspective is an
   absolute-path SPA — see `docs/command-center-ignition-display.md`).
2. **Allowlist:** seed `approved_tags` for the Northwind tenant mapping the rig's tag set
   (`vfd_freq`, `vfd_current`, `conv_state`, `motor_running`, `estop`, photo-eyes…) onto the CV-200
   UNS subtree. The allowlist is **fail-closed** — any tag whose `normalize_tag_path` is not
   allowlisted is silently dropped (empty `live_signal_cache`, no error). Generate it with the
   single canonical normalizer (`mira-relay/ingest_contract.py`), same pin-test shape as
   `tests/simlab/test_approved_tags_seed.py`. Staging-first, verify rows land, then prod via
   `apply-seeds.yml`.

### Step 2 — the ingest leg (sequence; don't over-build)
- **Now (prove the loop):** use the **existing HTTP relay**. An Ignition gateway timer reads the
  CV-200 OPC tags and `POST`s `/api/v1/tags/ingest` (HMAC) **as the Northwind tenant** →
  `ingest_batch` → `live_signal_cache`. Zero new transport code; reuses the turnkey L1/L2 path.
- **When the MQTT broker actually lands:** add the Lane-3 **`plain_json`** subscriber
  (`mira-relay/mqtt_ingest/`) per `docs/design/2026-06-23-lane3-mqtt-subscriber-design.md`. It is
  **UNSTARTED** (only §7.1/§7.2 pre-work shipped) — **do not build it speculatively.** Its whole
  job is transport+decode → `build_ingest_batch` → `ingest_batch`. No forked normalizer / allowlist
  / persist (one-pipeline law, CI-enforced by `tests/test_architecture.py` Contract 5).
- **Read-only / fieldbus boundary:** customer path is **rig → Ignition → relay/MQTT →
  `ingest_batch`**. The direct-Modbus bridge (`plc/live-plc-bridge/bridge.py`,
  `plc/live_monitor.py`) is **bench-only** (`.claude/rules/fieldbus-readonly.md`). No PLC writes —
  troubleshooting is read-only in beta.

### Step 3 — grounding + the deploy gate (train before deploy)
- **Ingest the manuals** into Northwind `knowledge_entries` with **`is_private=true`** (tenant-scoped
  upload write law, `.claude/rules/knowledge-entries-tenant-scoping.md`): the Micro820 modbus map
  (already in `docs/conveyor-fault-detective-demo/Micro820_v4.1.9_Modbus_Map.pdf`) + the GS10 VFD
  manual. Tag chunks to the CV-200 UNS subtree. Verify BM25 retrieval on **staging** before prod.
- **Validate + approve** the CV-200 asset agent (verified `kg_entities` row → citable chunks →
  validation Q&A with cited ≥4/5 answers a human marks good → `asset_agent_status='approved'`)
  before "Ask MIRA" answers on the HMI (`docs/specs/asset-agent-validation-spec.md`). Until the gate
  ships this is doctrine; when it ships, `ignition_chat.py` enforces it behind
  `ENFORCE_ASSET_AGENT_GATE`.

### Step 4 — the desk turn is direct-connection-certified
The "Ask MIRA" panel on the CV-200 Command Center display sends the turn with
`uns_context.source="direct_connection"` and the CV-200 UNS path. The engine **skips the chat-gate**
(no "are you sure you're looking at CV-200?") and goes straight to grounded diagnosis
(`.claude/rules/direct-connection-uns-certified.md`). A turn that arrives without a resolvable UNS
identifier is **rejected**, not downgraded.

## Dependencies / open decisions (flag — not closed)

- **PROD framing of Perspective is NOT solved.** Dev uses an origin-root proxy on
  `127.0.0.1:8890`. Prod (`app.factorylm.com`) still needs the **dedicated-origin-per-gateway**
  decision (a `cc-gw.*` subdomain / VPS nginx server block, XFO+CSP stripped, WS forwarded) — the
  Mike-pending item in `docs/command-center-ignition-display.md`. The per-id `/cc-display/{id}`
  proxy cannot host an absolute-path SPA. **This gates Step 1.1 reaching prod.**
- **Gateway reachability from cloud.** The PLC-laptop gateway is on Tailscale (`100.72.2.99`); the
  prod proxy/relay must reach it. Off-LAN smoke (QC-C in the ignition-display doc) is the GO/NO-GO.
- **Gateway is Ignition Standard *trial*** — periodic 2h 503 restarts; treat 503 as skip/retry.
- **MQTT broker** is "coming next" — Step 2's MQTT half waits on it; the HTTP-relay half does not.

## Acceptance (evidence, per Cluster Law 1)

1. Staging: CV-200 seeded, counts 21/7/7(5 open)/7 — **DONE 2026-06-28.**
2. Command Center (staging) shows the CV-200 node framing ConvSimpleLive with a green dot.
3. `live_signal_cache` has fresh CV-200 rows from the rig (via relay) under the Northwind tenant.
4. "Ask MIRA" on the CV-200 display returns a cited diagnosis grounded on a live tag + a manual
   citation + WO-L1-007, with **no** chat-gate confirmation turn.
5. Prod: same, after the prod-framing decision and the staging→prod seed/display/allowlist promotion.

## Cross-references
- `tools/seeds/northwind-bottling-hub.sql` — CV-200 seed (this branch)
- `marketing/videos/mission-control-hub-walkthrough/plant-spec-bottling.md` — counts source of truth (updated)
- `docs/command-center-ignition-display.md` — ConvSimpleLive framing + the prod-origin decision
- `docs/design/2026-06-23-lane3-mqtt-subscriber-design.md` — MQTT subscriber design (unstarted)
- `docs/conveyor-fault-detective-demo/README.md` — the bench rig + tag map + A0–A12 lineage
- `.claude/rules/{direct-connection-uns-certified,one-pipeline-ingest,fieldbus-readonly,train-before-deploy,knowledge-entries-tenant-scoping}.md`
