# Handoff → PLC-laptop agent: build the Northwind CV-200 Perspective view + wire it to MIRA

**Date:** 2026-06-28 · **From:** CHARLIE (MIRA/cloud side) · **To:** PLC-laptop Claude Code agent
**Branch this ships on:** `feat/discharge-conveyor-cv200` (PR #2362)
**Companion docs:** `docs/plans/2026-06-28-discharge-conveyor-desk-troubleshooting.md` (architecture + sequencing),
`HANDOFF-prod-seed.md` (the prod seed step, human-only), `docs/command-center-ignition-display.md` (framing).

---

## 0. What you're building, in one paragraph

The garage conveyor rig (Allen-Bradley **Micro820 v4.1.9** + AutomationDirect **GS10 VFD**) is now
modeled in MIRA as **Discharge Conveyor CV-200**, the 7th asset on the **Northwind Beverage**
bottling demo tenant. Build a **Perspective view** (reuse/clone the existing `ConvSimpleLive`) so a
user at their desk opens the FactoryLM Command Center, clicks the **Discharge Conveyor** node, sees
the **live** HMI framed with real tag states, and can **Ask MIRA** → grounded, cited diagnosis off
the live signal + manuals + work-order history, **read-only, no chat-gate**. Everything below is the
MIRA-side contract you bind to — exact IDs, paths, endpoints, payloads, all verified against the
codebase on 2026-06-28.

---

## 1. ⚠️ THE ONE HARD RULE: ADD a Northwind config, do NOT repoint the garage one

One physical rig today feeds the **garage** tenant's `ConvSimpleLive` demo
(`enterprise.home_garage.conveyor_lab.conveyor_1`). You are **re-tenanting to Northwind's CV-200
subtree by ADDING a parallel config**, never by repointing the garage one:

- `display_endpoints` is **per-tenant** → a Northwind row coexists fine with the garage row.
- `approved_tags` is **per-(tenant, source_system, source_tag_path)** → add Northwind-tenant rows
  with the **same source tag paths**, different `tenant_id` + `uns_path`. Both tenants' allowlists
  coexist.
- Ingest is **per-tenant** (the `X-MIRA-Tenant` HMAC header decides the owner) → the gateway timer
  POSTs the rig tags a **second time as the Northwind tenant**, in addition to whatever feeds garage.
  **Repointing would silently break the existing garage demo.** Both publish from the same rig.

Second hard rule: **read-only.** No PLC writes from any customer-shipped surface
(`.claude/rules/fieldbus-readonly.md`). The Perspective view *displays* and *asks*; it never *acts*.

---

## 2. Identity — the exact rows the seed creates (tenant `…b1`)

All seeded by `tools/seeds/northwind-bottling-hub.sql` (this branch). **Tenant UUID:**
`00000000-0000-0000-0000-0000000000b1` (Northwind Beverage Co. / Riverside Plant / Packaging / Line 1).

| Thing | Value |
|---|---|
| **CV-200 kg_entity id** | `10000000-0002-0000-0000-000000000019` |
| **CV-200 motor kg_entity id** | `10000000-0002-0000-0000-000000000020` |
| **GS10 VFD kg_entity id** | `10000000-0002-0000-0000-000000000021` |
| **CV-200 `cmms_equipment.id`** | `20000000-0002-0000-0000-000000000007` (equipment_number `CNV-200`) |
| **Open work order** | `WO-L1-007` (`30000000-0002-0000-0000-000000000007`) — intermittent discharge jam + one GS10 CE10 comm fault |
| **PM schedule** | `p7` (`40000000-0002-0000-0000-000000000007`) — inspect photo-eye/belt/GS10 comm wiring, due ~15 days |
| **KG edge** | GS10 VFD `DRIVES` discharge motor (conf 0.98) |
| **UNS path (ltree, dotted)** | `enterprise.riverside.area.packaging.line.line1.equipment.discharge_conveyor_cv200` |
| **`uns_topic_path` (slashed)** | `enterprise/riverside/packaging/line1/discharge_conveyor_cv200` |
| **`plc_tag` / `scada_path`** | `CONV_DISCHARGE` / `Riverside/Line1/DischargeConveyor` |

> **The dotted ltree path is the binding key** for `display_endpoints.uns_path`,
> `approved_tags.uns_path`, and the Ask-MIRA `asset_context`. The component leaves are
> `…discharge_conveyor_cv200.component.discharge_conveyor_motor` and the GS10 sits at
> `…line1.equipment.discharge_conveyor_vfd`.

---

## 3. The Perspective view (reuse `ConvSimpleLive`)

The existing live view is your starting point — don't build from scratch.

- **Gateway (PLC laptop):** Ignition Standard **trial** (expect periodic 2h `503` restarts — treat
  `503` as skip/retry).
  - Tailscale: `http://100.72.2.99:8088/data/perspective/client/ConvSimpleLive`
  - LAN: `http://192.168.1.20:8088/data/perspective/client/ConvSimpleLive`
- **Project / views:** `ConvSimpleLive` (views `Conveyor`, `ConvSimpleLive`), bound to the
  `MIRA_IOCheck` tag provider. Live and serving (HTTP 200) as of the doc's last check.
- **What it should show for CV-200:** the rig's live state — VFD frequency / current / DC bus,
  motor running, e-stop, photo-eye, command word, fault/warn codes (full tag list in §5). Same
  visual language; relabel for "Discharge Conveyor CV-200 — Northwind / Riverside / Line 1".
- **FactoryLM UI tokens:** if you add/skin any chrome, use `docs/design/factorylm-tokens.css`
  (`--fl-*`), muted-normal + color-for-state only (`.claude/rules/ui-style.md`).
- **Embed the "Ask MIRA" panel** on the CV-200 view — it calls the endpoint in §6.

---

## 4. Register the live display in the Command Center

So the Northwind Command Center frames your view on the CV-200 node.

**API:** `POST /api/command-center/display` (mira-hub —
`mira-hub/src/app/api/command-center/display/route.ts:74`). Authenticated Hub session as the
Northwind tenant. **Request body (camelCase):**

```json
{
  "unsPath": "enterprise.riverside.area.packaging.line.line1.equipment.discharge_conveyor_cv200",
  "scheme": "http",
  "host": "<origin-root XFO-stripping proxy host>",
  "port": 8890,
  "path": "/data/perspective/client/ConvSimpleLive",
  "displayType": "web_iframe",
  "label": "Discharge Conveyor CV-200 (live)"
}
```

- `unsPath` (required, validated `^[a-z0-9_]+(\.[a-z0-9_]+)*$`) **must already exist in
  `kg_entities` for the tenant** — it does, the seed creates it. Upserts by `(tenant_id, uns_path)`,
  so re-registering updates in place (never duplicates). Returns `201 { display: { id, uns_path, … } }`.
- `displayType` ∈ `web_iframe | nodered | signals | vnc`; `scheme` ∈ `http | https`.
- **Point `host:port` at the origin-root XFO-stripping proxy, NOT the raw gateway.** Perspective is
  an absolute-path SPA (`/res/perspective/...`, `/data/perspective/...`) and the gateway sends
  `X-Frame-Options: SAMEORIGIN` gateway-wide. The proven **dev** proxy is `127.0.0.1:8890` →
  `100.72.2.99:8088` (nginx, strips XFO + CSP, forwards WebSocket 1:1) — see
  `docs/command-center-ignition-display.md`.
- **Do NOT use the seed** `mira-hub/db/seeds/command_center_conveyor.sql` — its header says
  `DEV / STAGING ONLY. Do not run against prod NeonDB`. Register via the API / UI onboarding instead.
- `display_endpoints` table: migration `mira-hub/db/migrations/030_display_endpoints_registry.sql`
  (columns: `tenant_id, uns_path (ltree), equipment_id, display_type, scheme, host, port, path,
  label, enabled, …`; unique on `(tenant_id, uns_path)`; RLS tenant-scoped).

> 🚧 **PROD framing is unsolved (gates prod, NOT your dev/staging build).** The per-id
> `/cc-display/{id}` proxy can't host an absolute-path SPA. Prod needs a **dedicated-origin-per-gateway**
> decision (a `cc-gw.*` subdomain / VPS nginx server block, XFO+CSP stripped, WS forwarded) — Mike's
> pending call in `docs/command-center-ignition-display.md`. Build + verify on dev/staging against the
> `8890` proxy; prod framing lands after that decision.

---

## 5. The live tag set — two namespaces, know which is which

There are **two** tag namespaces. Don't conflate them.

### 5a. Ignition gateway source paths (what you publish + what the allowlist keys on)
From `ignition/project/approved_tags.json` — the `MIRA_IOCheck` provider set. These are the
`source_tag_path` values and what your ingest timer reads:

```
[default]MIRA_IOCheck/VFD/vfd_freq_sp        [default]MIRA_IOCheck/VFD/vfd_frequency
[default]MIRA_IOCheck/VFD/vfd_current        [default]MIRA_IOCheck/VFD/vfd_dc_bus
[default]MIRA_IOCheck/VFD/vfd_cmd_word        [default]MIRA_IOCheck/VFD/vfd_fault_code
[default]MIRA_IOCheck/VFD/vfd_warn_code       [default]MIRA_IOCheck/VFD/vfd_comm_ok
[default]MIRA_IOCheck/VFD/pe_latched          [default]MIRA_IOCheck/Inputs/DI_02   (estop NC)
[default]MIRA_IOCheck/Inputs/DI_05   (photoeye)
[default]Conveyor/Motor_Running   [default]Conveyor/EStop_Active   [default]Conveyor/EStop_Wiring_Fault
[default]Conveyor/Dir_FWD   [default]Conveyor/Dir_REV   [default]Conveyor/VFD_CmdWord
```
(`approved_tags.json` lists ~57 entries total — that's the canonical gateway-side set.)

### 5b. In-gateway anomaly-rule snapshot keys (internal to the A0–A12 engine)
`plc/conv_simple_anomaly/rules_core.py:99–112` reads its own UNS-relative keys — you don't publish
these, they're the rule engine's internal snapshot. For reference: `motor/m101/running`,
`vfd/vfd101/comm_ok`, `vfd/vfd101/freq`, `vfd/vfd101/current_a`, `vfd/vfd101/dc_bus_v`,
`vfd/vfd101/cmd_word`, `vfd/vfd101/fault_code`, `vfd/vfd101/warn_code`, `vfd/vfd101/freq_setpoint`,
`safety/estop`, `safety/wiring`, `safety/contactor_q1`, `safety/pe_latched`,
`plc/di/di00_fwd`, `plc/di/di01_rev`, `plc/di/di02_estop_nc`, `plc/di/di03_estop_no`,
`plc/di/di05_photoeye`.

**Modbus register map:** `docs/conveyor-fault-detective-demo/Micro820_v4.1.9_Modbus_Map.pdf` (+ the
README tag→register table). Use it to confirm what each tag means on the wire.

---

## 6. The ingest leg — POST the live tags into MIRA as the Northwind tenant

**Endpoint:** `POST /api/v1/tags/ingest` (mira-relay — `mira-relay/relay_server.py:726`, handler
`tags_ingest` at `:259`). Reuses the turnkey L1/L2 path — **no new transport code**, this is the
"prove the loop now" leg (the MQTT subscriber waits on the broker; don't pre-build it).

**Auth — HMAC-SHA256 (4 headers, `mira-relay/auth.py:70`):**
| Header | Value |
|---|---|
| `X-MIRA-Tenant` | `00000000-0000-0000-0000-0000000000b1` ← **this decides ownership** |
| `X-MIRA-Nonce` | opaque, monotonic per tenant (replay-guarded, 600s window) |
| `X-MIRA-Timestamp` | unix seconds, must be within ±300s of server clock |
| `X-MIRA-Signature` | `hmac_sha256(key, f"{tenant}\n{nonce}\n{timestamp}\n{sha256_hex(body)}")` hex |

Key = env `MIRA_IGNITION_HMAC_KEY` (Doppler `factorylm/prd`; the relay returns 401 if sig fails).
**Sign the exact body bytes** — `build_ingest_batch` fixes key insertion order so the serialization
is deterministic. The HMAC tenant is authoritative; never trust a body `tenant_id` over it.

**Body — the ONE canonical batch shape** (`mira-relay/ingest_contract.py`,
`build_ingest_batch:91` / `build_tag_entry:54`; consumed by `ingest_batch:161` in `tag_ingest.py`):

```json
{
  "source_system": "ignition",
  "source_connection_id": "northwind-cv200-gw",
  "tenant_id": "00000000-0000-0000-0000-0000000000b1",
  "tags": [
    { "tag_path": "[default]MIRA_IOCheck/VFD/vfd_frequency", "value": 47.6, "value_type": "float", "quality": "good", "ts": "2026-06-28T12:00:00+00:00" },
    { "tag_path": "[default]MIRA_IOCheck/VFD/vfd_current",   "value": 3.1,  "value_type": "float", "quality": "good", "ts": "2026-06-28T12:00:00+00:00" },
    { "tag_path": "[default]Conveyor/Motor_Running",         "value": true, "value_type": "bool",  "quality": "good", "ts": "2026-06-28T12:00:00+00:00" }
  ]
}
```
- `source_system` ∈ `{ignition, plc_bridge, relay, simulator}` → use **`ignition`**.
- `value_type` ∈ `{bool, int, float, string, enum}`; `quality` ∈ `{good, bad, stale, uncertain}`.
- **One pipeline only** (`.claude/rules/one-pipeline-ingest.md`): decode → `build_tag_entry` →
  `build_ingest_batch` → `ingest_batch`. Do **not** fork a normalizer/allowlist/persist path. The
  Ignition gateway timer just reads OPC tags and POSTs this shape.

**Response (200):** `{ "status":"ok", "source_system":"ignition", "simulated":false, "accepted":N,
"events_written":N, "state_upserts":N, "cache_skipped":0, "rejected":[ {"tag_path","reason"} ] }`.
Accepted tags land in `tag_events` (append-only) + `live_signal_cache` (latest value per tag).
**Fail-closed:** a tag not in the Northwind allowlist is returned under `rejected`
(`reason:"not_allowlisted"`) and **never persists** — empty `live_signal_cache`, no hard error. So
do §7 first. Error envelopes: `401 {"error":"auth_failed","detail":…}`,
`400 {"error":"tenant_required"|"invalid_source_system"|"tags_must_be_list"}`,
`500 {"error":"ingest_failed"}`.

---

## 7. Seed the Northwind `approved_tags` allowlist (do this BEFORE ingest)

The allowlist is **fail-closed** — un-allowlisted tags drop silently. Add Northwind rows mirroring
the garage rig's tags onto the CV-200 subtree.

**Table:** `approved_tags` (migration `mira-hub/db/migrations/035_approved_tags.sql`). PK
`(tenant_id, source_system, source_tag_path)`. **Match key the relay queries:**
`(tenant_id, source_system, normalized_tag_path)` where `normalized_tag_path` =
`normalize_tag_path(source_tag_path)` (lowercase, runs of non-alphanumerics → `_`, trim `_` —
`mira-relay/ingest_contract.py:38`). Example: `[default]MIRA_IOCheck/VFD/vfd_frequency` →
`default_mira_iocheck_vfd_vfd_frequency`.

**Row shape** (mirror `tools/seeds/approved_tags_conveyor.sql` / `gen_approved_tags_simulator.py`,
which are bound to the **garage** tenant — clone them onto Northwind):

```sql
INSERT INTO approved_tags
  (tenant_id, source_system, source_tag_path, normalized_tag_path, uns_path, enabled, notes)
VALUES
  ('00000000-0000-0000-0000-0000000000b1'::uuid, 'ignition',
   '[default]MIRA_IOCheck/VFD/vfd_frequency',
   'default_mira_iocheck_vfd_vfd_frequency',
   'enterprise.riverside.area.packaging.line.line1.equipment.discharge_conveyor_cv200.vfd_frequency'::ltree,
   true, 'Northwind CV-200 live rig — seeded 2026-06-28')
  -- … one row per tag in §5a …
ON CONFLICT (tenant_id, source_system, source_tag_path) DO UPDATE SET enabled = true;
```
- Generate the rows with the **canonical normalizer** so `normalized_tag_path` matches the relay's
  hot-path exactly (the SimLab pin-test `tests/simlab/test_approved_tags_seed.py` is the shape to
  copy). A mismatch = silent drop.
- `uns_path` resolves each tag onto the CV-200 subtree (pick a stable leaf per tag).
- **Promote staging→prod via `apply-seeds.yml`** (KB/seed env doctrine: staging first, verify rows
  land + `live_signal_cache` fills, then prod). Don't psql prod.

---

## 8. The "Ask MIRA" panel — direct-connection, UNS-certified, read-only

**Endpoint:** `POST /api/v1/ignition/chat` (mira-pipeline — `mira-pipeline/ignition_chat.py:460`).
Same HMAC scheme + headers as §6, key `MIRA_IGNITION_HMAC_KEY` (503 if unset). Tenant = `…b1`.

**Request body** (model `IgnitionChatRequest`, `ignition_chat.py:182`):
```json
{
  "question": "What's going on with the discharge conveyor?",
  "asset_context": { "equipment": "discharge_conveyor_cv200",
                     "line": "line1", "area": "packaging", "site": "riverside" },
  "asset_id": "20000000-0002-0000-0000-000000000007",
  "tag_snapshot": { "vfd_frequency": 0.0, "vfd_comm_ok": false }
}
```
- User text: `question` **or** `query` (either works). `asset_context` is a free-form dict;
  the resolver reads the first present of `component | equipment | machine | asset | line`.
- **Because `asset_context` (or `asset_id`) is present, the turn is stamped
  `uns_context.source="direct_connection"` → the engine SKIPS the chat-gate** (no "are you sure
  you're looking at CV-200?"). This is correct and required
  (`.claude/rules/direct-connection-uns-certified.md`).
- **Rejection contract:** if you send an **asset-specific** question with **no** asset identifier,
  you get `422 {"error":"uns_required"}` — it does NOT downgrade to a chat-gate. So **always send
  `asset_context`** for CV-200 turns. (General/educational questions with no asset pass through.)
- Sending `tag_snapshot` lets MIRA ground on the live values you're already displaying.

**Response (200):** `{ "answer", "sources":[], "citations":[], "evidence":[], "confidence":null,
"suggested_actions":[], "tenant_id", "asset_id", "latency_ms" }`. (`sources/citations/evidence` are
wired but currently emitted empty by this endpoint — grounding/citations land as the engine surface
matures; the `answer` is the diagnosis.) A train-before-deploy gate refusal adds a `gate` field.

---

## 9. The A0–A12 anomaly engine (already exists — context, not your build)

`plc/conv_simple_anomaly/rules_core.py` runs **in-gateway** on the live snapshot and emits a
`current_fault`. It's dual Py2.7/3.12, drift-guarded by `tests/regime7_ignition/test_diagnose_parity.py`,
Phase 1 done (commit `83ea8e81`). The 12 rules:

| Rule | Detects | `current_fault` |
|---|---|---|
| A0 | no fresh PLC data ≥30s | A0_OFFLINE |
| A1 | GS10 RS-485 comm down | A1_COMM_STALE |
| A2 | GS10 active fault code | A2_VFD_FAULT |
| A3 | e-stop dual-channel wiring fault | A3_ESTOP_WIRING |
| A4 | FWD+REV asserted together | A4_DIRECTION_FAULT |
| A5 | motor running while safety disabled | A5_ILLEGAL_RUN |
| A6 | RUN cmd ≥3s, motor never starts | A6_DRIVE_NOT_RESPONDING |
| A7 | output Hz not tracking setpoint | A7_FREQ_NOT_TRACKING |
| A8 | output current > motor FLA | A8_OVERCURRENT |
| A9 | DC bus out of [250,410]V | A9_DC_BUS |
| A10 | output Hz stuck ~0 while RUN | A10_FREQ_STUCK_ZERO |
| A12 | photo-eye soft-stop latch (jam) | A12_PHOTOEYE_JAM |

Your view can surface `current_fault`; MIRA grounds its answer on it + the live tags + manuals + WO-L1-007.
> Note: the Ignition **WebDev module is not installed** on the bench gateway (the HTTP diagnose
> endpoint 404s) — the Phase-2 panel uses a Perspective **project script**, no WebDev needed.

---

## 10. Sequence + what's blocked on what

1. **Seed prod tenant** (CV-200 rows) — *human step*, `HANDOFF-prod-seed.md` step 2. Staging already
   validated (21/7/7[5 open]/7).
2. **Northwind `approved_tags`** (§7) — staging first via `apply-seeds.yml`, verify rows land.
3. **Ingest timer** (§6) — Ignition gateway timer POSTs CV-200 tags as tenant `…b1`; verify
   `live_signal_cache` fills under Northwind. (MQTT subscriber is later, broker-gated — don't build.)
4. **Register display** (§4) — `POST /api/command-center/display` at the `8890` proxy on dev/staging.
5. **Ask-MIRA panel** (§8) on the CV-200 view.
6. **Ingest manuals** into Northwind `knowledge_entries` with `is_private=true` (Micro820 map + GS10),
   verify BM25 on staging — *cloud-side follow-up, not your build*
   (`.claude/rules/knowledge-entries-tenant-scoping.md`).
7. **Prod framing** — blocked on Mike's dedicated-origin-per-gateway decision (§4).

**Gateway reachability:** PLC-laptop gateway is on Tailscale `100.72.2.99`; the prod proxy/relay must
reach it (off-LAN smoke = GO/NO-GO).

---

## 11. Laws to honor (don't trip these)

- **One-pipeline ingest** (`.claude/rules/one-pipeline-ingest.md`) — decode → contract → `ingest_batch`; no forked normalizer/allowlist/persist. CI-enforced.
- **Fieldbus read-only** (`.claude/rules/fieldbus-readonly.md`) — no PLC writes from any customer-shipped surface; customer reads go through Ignition.
- **Direct-connection UNS-certified** (`.claude/rules/direct-connection-uns-certified.md`) — every Ask-MIRA turn carries the CV-200 identifier or is rejected (422); never downgrade to a chat-gate.
- **Train before deploy** (`.claude/rules/train-before-deploy.md`) — the HMI is a deployment surface; the asset agent is validated/approved in the Command Center. Read-only in beta.
- **UI tokens** (`.claude/rules/ui-style.md`) — `--fl-*` tokens, color = state only.
- **Env doctrine** — staging before prod; no prod psql; seeds via `apply-seeds.yml`.

---

## 12. Acceptance (evidence per Cluster Law 1)

1. Command Center (staging, Northwind) shows the **CV-200 node framing ConvSimpleLive with a green dot**.
2. `live_signal_cache` has **fresh CV-200 rows from the rig** under tenant `…b1` (via the relay).
3. **Ask MIRA** on the CV-200 display returns a diagnosis grounded on a live tag + manual + WO-L1-007,
   with **no chat-gate turn**.
4. No garage-demo regression (the garage tenant's ConvSimpleLive still works — you ADDED, didn't repoint).

---

## 13. Quick reference — endpoints & env

| Need | Endpoint / file | Auth |
|---|---|---|
| Ingest live tags | `POST /api/v1/tags/ingest` — `mira-relay/relay_server.py:726` | HMAC, `MIRA_IGNITION_HMAC_KEY` |
| Ask MIRA | `POST /api/v1/ignition/chat` — `mira-pipeline/ignition_chat.py:460` | HMAC, `MIRA_IGNITION_HMAC_KEY` |
| Register display | `POST /api/command-center/display` — `mira-hub/.../command-center/display/route.ts:74` | Hub session (tenant `…b1`) |
| Allowlist table | `approved_tags` — migration `035_approved_tags.sql` | — |
| Display table | `display_endpoints` — migration `030_display_endpoints_registry.sql` | — |
| Contract fns | `normalize_tag_path`/`build_tag_entry`/`build_ingest_batch` — `mira-relay/ingest_contract.py` | — |
| Rig tags (gateway) | `ignition/project/approved_tags.json` | — |
| Anomaly rules | `plc/conv_simple_anomaly/rules_core.py` | — |
| Modbus map | `docs/conveyor-fault-detective-demo/Micro820_v4.1.9_Modbus_Map.pdf` | — |

All IDs/paths/signatures above were verified against the codebase on 2026-06-28 before this handoff shipped.
</content>
</invoke>
