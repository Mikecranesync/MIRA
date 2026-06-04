# MIRA × Ignition 8.3 — Integration & Module Architecture

**Status:** ACTIVE · **Authored:** 2026-06-04 · Pairs with
[`../ignition-8.3-alignment-plan.md`](../ignition-8.3-alignment-plan.md) and
[ADR-0021 (Ignition module-first edge)](../adr/0021-ignition-module-first-edge.md).

This document defines the *target* architecture for how MIRA integrates with Ignition 8.3. It is a
plan; where it describes something not yet built, it says so. Verified-present components are cited
with real paths.

---

## 1. Three-layer module strategy (Jython now → script library → JAR later)

Per ADR-0021, MIRA adopts Ignition capability in **risk-ascending layers**. We are at Layer 1 today.

| Layer | What | Status | Build cost |
|------:|------|--------|-----------|
| **L1 — WebDev (Jython)** | HTTP endpoints + gateway scripts as Python files in Git | **PRESENT**: `ignition/webdev/FactoryLM/api/{tags,chat,alerts,status,connect,ingest}/{doGet,doPost}.py`, `ignition/gateway-scripts/*.py` | none (no compile) |
| **L2 — Project script library** | `system.mira.*` ergonomics that wrap the L1 endpoints | **PLANNED (Phase 6)**: `ignition/project/script-python/mira/{ask,confirmContext,proposeRelationship}.py` | low (Jython, no JAR) |
| **L3 — Java/Gradle module** | `GatewayHook`, Config page, `ManagedTagProvider`, signed `.modl` | **NOT STARTED** (deliberate — post first paying customer) | high (Gradle + SDK + signing) |

**Why this order:** Layers 1–2 ship value with zero Java toolchain and are fully agent-editable as
files. Layer 3 is only justified once a customer needs a Gateway-config UI, managed context tags, or
`system.mira.*` without a project dependency. Do not start L3 before there is a concrete customer pull.

### Target `system.mira.*` surface (L2, then promoted to L3)
- `system.mira.ask(question, asset=None)` → POST the existing `/ask` backend
- `system.mira.confirmContext(session_id, confirm: bool, asset=None)` → drive the UNS gate
- `system.mira.proposeRelationship(source, type, target)` → enqueue a KG proposal (human-verified)
- `system.mira.ingestTagProvider(provider)` → register provider tags as ingest candidates
- `system.mira.publishEvent(event_type, payload)` → write an `agent_events` row + MQTT publish

---

## 2. UNS confirmation gate — surfacing the EXISTING backend in Perspective

**The gate already exists and is hardened in the backend.** `mira-bots/shared/engine.py`:
`_should_fire_uns_gate`, `_handle_uns_confirmation_request` / `_handle_uns_confirmation_response`,
FSM state `AWAITING_UNS_CONFIRMATION`, flag `MIRA_UNS_GATE_ENABLED` (default on), and a
`source == "direct_connection"` carve-out. The AskMira view today (`MIRA_PLC/.../views/AskMira/view.json`)
POSTs `{question, tags, session_id}` to `:8011/ask` and dumps the reply as raw markdown — so the gate
prompt is indistinguishable from a normal answer. **The only work is the Perspective surface.**

```
AskMira view.custom:
  uns_state       : 'idle' | 'awaiting_confirm' | 'confirmed'
  confirmed_asset : ''          # set after the gate passes

Ask button onActionPerformed:
  POST /ask  →  response now carries  uns_gate_state ∈ {awaiting_confirmation, answered}
  if uns_gate_state == 'awaiting_confirmation':
       uns_state = 'awaiting_confirm'; render ConfirmationPanel(prompt, candidate_asset)
  else:
       uns_state = 'confirmed'; confirmed_asset = response.confirmed_asset
       route response.answer → markdown pane

ConfirmationPanel (visible when uns_state=='awaiting_confirm'):
  label(prompt)  ·  button "Yes, correct" → POST /ask {uns_confirm:true}
                 ·  button "No, specify"  → asset picker

LocationBreadcrumb (visible when uns_state=='confirmed'):
  label showing confirmed_asset   # the technician always sees what MIRA thinks they're on
```

**Backend change required:** one small addition in `mira-bots/ask_api/app.py` — tag gate-prompt
responses with `uns_gate_state: "awaiting_confirmation"` in the JSON envelope (the FSM already knows;
it just isn't exposed to the frontend). No gate logic changes.

---

## 3. API flow — read · propose · approve · sync (Phase 5)

MIRA is **read-only by default**; all writes are proposals routed through human approval.

```
READ     Gateway tags → system.tag.readBlocking (WebDev/gateway script)
              → allowlist.py (FAIL-CLOSED, ignition/project/approved_tags.json)
              → mira-relay ingest → tag_events / live_signal_cache

PROPOSE  agent generates a Perspective view diff
              → IgnitionGatewayClient.get_resource() reads current view.json   [Phase 5, NOT built]
              → diff → mira-hub proposals queue (entity_type='ignition_resource', status='pending')

APPROVE  operator reviews in mira-hub /proposals → 'pending' → 'verified'

SYNC     sync job → IgnitionGatewayClient.write_resource()                     [gated OFF by default]
              → stop-service · atomic file write · start-service · project rescan
              → ignition_audit_log row (migration 031)
```

`IgnitionGatewayClient` (~100 lines httpx, **to build in Phase 5**) is the single choke point for all
Gateway I/O; write methods sit behind `MIRA_IGNITION_WRITE_ENABLED=false` (default).

---

## 4. Event flow (Phase 4)

```
PLC tag change → Ignition OPC UA → gateway-scripts/tag-change-fsm-monitor.py → mira_anomalies + alert tag
              → gateway-scripts/tag-stream.py (HMAC POST) → mira-relay/tag_ingest.py → tag_events
                   → tag_diff_logger (APScheduler 30s, TO SCHEDULE) → tag_event_diffs + fault_window_id

Ignition alarm  → Alarm Pipeline → POST webdev/.../api/alerts/alarm_notify (NEW) → agent_events('alarm_triggered')

AskMira submit  → /ask → engine.process() [gate fires if unconfirmed]
                   confirm → FSM AWAITING_UNS_CONFIRMATION→IDLE → emit agent_events('uns_context_confirmed')
                   → diagnosis (live tags + KG + historian) → ignition_audit_log
```

Canonical MIRA event taxonomy (target): `tag_changed`, `alarm_triggered`, `form_submitted`,
`uns_context_confirmed`, `doc_ingested`, `relationship_proposed`, `resource_change_proposed`,
`resource_change_approved`, `troubleshooting_published`.

---

## 5. Secrets model

```
Source of truth   Doppler  factorylm/{dev,stg,prd}
Ignition-side     system.secret.get('MIRA_IGNITION_HMAC_KEY')  →  factorylm.properties fallback
Perspective       read from a write-protected tag; NEVER a literal/empty key in view.json
Nonce store       Redis SETNX+TTL  (replace the in-process dict in mira-mcp/ignition_auth.py)
Weak defaults     FLOWER_PASSWORD / GRAFANA_PASSWORD → Doppler only (remove from .env.template)
```

**Open item this informs:** `AskMira/view.json` currently commits `X-Mira-Key:""`. The end state is no
credential field in the view at all — the gateway script reads the key from `system.secret.get()`.

---

## 6. Deployment-mode matrix (Phase 3/8)

| Mode | Compose | Ignition | UNS gate | Tags |
|------|---------|----------|:-------:|------|
| Local dev | `docker-compose.yml` + `deployment-modes/docker-compose.ignition.yml` (trial) | container | on | sim conveyor |
| Staging | `docker-compose.staging-vps.yml` | n/a | on | NeonDB staging |
| Expo/kiosk | `deployment-modes/docker-compose.expo.yml` | PLC laptop | off* | live PLC |
| Training | `deployment-modes/docker-compose.training.yml` | container | on | seeded fixture |
| Production | `docker-compose.saas.yml` | customer gateway | on | customer tags |

\* Kiosk disables the gate only because it is a **single-asset** deployment; adding a second asset
requires re-enabling the gate (documented hard rule).

---

## 7. What is verified-present vs planned (honesty ledger)

**Present (cited):** WebDev Jython endpoints, 4 gateway scripts, `ignition/project/` Perspective views +
`page-config`, `approved_tags.json`, `tags/`, `config/factorylm.properties.template`, `db/schema.sql`,
`deploy_ignition.ps1`, `mira-mcp/ignition_auth.py`, `mira-pipeline/ignition_chat.py`, the backend UNS gate,
`tag_events`/`tag_event_diffs` migrations, `mira-ignition-exchange/` views.

**Planned / NOT yet built:** containerized Ignition gateway, reusable Perspective widget kit (SVG),
UNS gate Perspective panel, `uns_gate_state` field in `/ask`, `IgnitionGatewayClient`, resource-sync +
proposal pipeline, alarm→MIRA binding, scheduled `tag_diff_logger`, VFD historian, `system.mira.*`
script library, Java module, offline/mobile views, deployment-mode compose files.
