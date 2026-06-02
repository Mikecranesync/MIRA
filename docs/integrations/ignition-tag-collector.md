# Ignition Tag Collector — Installation & Configuration

**Status:** Integration guide. Marks SHIPPED vs TARGET where the secure model is ahead of the current code.
**Authored:** 2026-06-02
**Owner:** Mike Harper
**Security model:** `docs/mira-ignition-secure-architecture.md` (read §4 before deploying to any customer).

> **One-liner.** The tag collector is an Ignition **Gateway Timer Script** that reads allowlisted tags and POSTs them outbound over HTTPS to `mira-relay`, where they land in MIRA's current-tag-state. The PLC is never reachable from the cloud; the gateway only ever pushes out.

> **Honesty banner.** Two pieces of the secure model are **TARGET, not shipped**: (1) a true `approved_tags` *allowlist filter* — today tag selection is by **folder scope**, not an allowlist (`approved_tags.json` filtering is checklist item **D1 — "Not built. Critical."**); (2) **HMAC signing** of the payload — today the relay uses a shared bearer key (`RELAY_API_KEY`); HMAC is **D4**. This guide documents the **shipped** install path and clearly fences the **TARGET** hardening so nobody assumes a security control that isn't wired yet. Source: `docs/mira-ignition-secure-architecture.md` §7 (items 3, 4, 6) and §10.2.

---

## 1. What gets installed

The collector is part of the MIRA Ignition bundle (the embryonic "MIRA Module"):

| Piece | File | Role |
|---|---|---|
| **Tag streamer** (the collector) | `ignition/gateway-scripts/tag-stream.py` | Gateway Timer Script (Jython 2.7). Reads leaf tags under a folder, POSTs JSON to the relay. |
| **WebDev endpoints** | `ignition/webdev/FactoryLM/api/{tags,chat,status,alerts,connect,ingest}/` | `doGet`/`doPost` handlers. `tags/doGet.py` is where the allowlist filter belongs (D1). |
| **Config file** | `factorylm.properties` (from `ignition/config/factorylm.properties.template`) | All collector settings — relay URL, tenant, tag folder, interval. Read fresh on every script call (no restart). |
| **Installer** | `ignition/deploy_ignition.ps1` | 3-command idempotent install of project + scripts + WebDev. |
| **Cloud sink** | `mira-relay/relay_server.py` | Receives the POST, upserts current-tag-state. |

The collector runs **inside the customer's Ignition Gateway JVM**. It does I/O; MIRA Cloud does reasoning (`docs/mira-ignition-secure-architecture.md` §1).

---

## 2. How to install in Ignition

### 2.1 Prerequisites

- An Ignition Gateway (8.1+) reachable on the plant LAN, already polling the PLC via its native driver. (Bench reference: the gateway on the PLC laptop at `100.72.2.99:8088`.)
- The WebDev module installed (free; required for the `/api/*` endpoints).
- Outbound HTTPS (443) to `*.factorylm.com` allowed by the customer firewall. **No inbound ports.**
- A tenant UUID + relay endpoint from MIRA activation (the `ConnectSetup` Perspective page / `/api/connect` handler writes these into `factorylm.properties`).

### 2.2 Install steps

1. **Deploy the bundle.** From the gateway host (Windows):
   ```powershell
   cd ignition
   .\deploy_ignition.ps1        # idempotent: imports project, gateway scripts, WebDev resources
   ```
   This installs the Perspective project (`ConveyorStatus`, `FaultLog`, etc.), the WebDev endpoints, and the gateway scripts including `tag-stream.py`.

2. **Create the config file.** Copy the template to the gateway data dir:
   - Windows: `C:\Program Files\Inductive Automation\Ignition\data\factorylm\factorylm.properties`
   - Linux: `/usr/local/bin/ignition/data/factorylm/factorylm.properties` (or `/var/lib/ignition/...`)
   ```powershell
   copy ignition\config\factorylm.properties.template `
        "C:\Program Files\Inductive Automation\Ignition\data\factorylm\factorylm.properties"
   ```
   Changes are picked up on the next script tick — **no Gateway restart** (template header, lines 8–11).

3. **Register the timer script.** In **Gateway → Config → Gateway Events → Timer Scripts**, add a Fixed-Rate timer that runs `tag-stream.py` at the batch interval (§5). The script's own header documents the schedule (default 2000 ms).

4. **Choose what streams** (§4) — point the collector at the right tag folder.

5. **Activate** (§3) — set `RELAY_URL` + `TENANT_ID`, confirm data flows (§7).

---

## 3. Configure endpoint URL and secret

All collector config lives in `factorylm.properties` **Section 9 — MIRA Connect**:

```properties
# MIRA relay HTTP ingest endpoint (set by /api/connect activation handler)
RELAY_URL=https://relay.factorylm.com/ingest

# Tenant UUID — which MIRA customer this gateway belongs to
TENANT_ID=00000000-0000-0000-0000-000000000000

# Root tag folder to stream (see §4)
STREAM_TAG_FOLDER=[default]Mira_Monitored

# Equipment identifier written into the relay payload (matches equipment_status rows)
STREAM_EQUIPMENT_ID=ignition-gateway
```

- **`RELAY_URL`** — the outbound HTTPS ingest endpoint. Leave blank to disable streaming (the script no-ops if `RELAY_URL` or `TENANT_ID` is empty — `tag-stream.py` main guard). Env-var the URL so dev/staging gateways point at the staging relay, prod at prod (`docs/mira-ignition-secure-architecture.md` D2).
- **`TENANT_ID`** — scopes every payload to one customer. The relay rejects/segregates by tenant.

### Secret / signing

- **Shipped today:** authentication to the relay is a **shared bearer key** (`RELAY_API_KEY`) held on both sides. The Jython POST currently sends only `Content-Type: application/json` (`tag-stream.py:_post_to_relay`) — bearer enforcement lives on the relay (`mira-relay/relay_server.py`). Store the key in Ignition's encrypted gateway vault / the properties file, never in git.
- **🎯 TARGET (D4):** replace the shared bearer with **per-tenant HMAC-SHA256** over `body + nonce`, tenant id in a header, with a 10-minute replay window (`docs/mira-ignition-secure-architecture.md` §4.3). The signing key is minted in Hub admin, stored in the gateway vault, rotated quarterly (§11 open-question 3). When this lands, add a `MIRA_CLOUD_SIGNING_KEY` property and sign in `_post_to_relay`.

> Document both states to the customer's IT: today the link is TLS + shared bearer; the HMAC upgrade is on the roadmap and changes nothing about the network posture (still outbound-only).

---

## 4. Choose which tags to collect (the allowlist)

**Principle (secure model):** read-by-default, **allowlist-only** — a tag not on the approved list is invisible to MIRA (`docs/mira-ignition-secure-architecture.md` §4.2).

### 4.1 Shipped today: folder-scoping

The collector streams **every leaf tag under `STREAM_TAG_FOLDER`** (`tag-stream.py:_browse_leaf_tags` recurses folders/UDTs; `_read_all_tags` reads them all). So today the "allowlist" is enforced by **what you put in the folder**:

1. Create a tag folder (default `[default]Mira_Monitored`).
2. **Add only the tags MIRA should see** — drag/reference the ~20–40 you want (run/stop, faults, speed, current, key sensors). Anything outside the folder is never read.
3. Point `STREAM_TAG_FOLDER` at it.

This is a real boundary (MIRA can't read what isn't in the folder), but it is **manual and not a declared allowlist** — the gap the security doc flags as D1 🔴.

### 4.2 🎯 TARGET: `approved_tags` allowlist filter

The secure model adds a declared allowlist enforced at **two** points (defense in depth):

- **At the gateway:** `ignition/webdev/FactoryLM/api/tags/doGet.py` filters tag-browse to an `approved_tags.json` list; non-allowlisted paths return 404 (`docs/mira-ignition-secure-architecture.md` §10.6 task 1).
- **At the relay:** `mira-relay/auth.py` drops POSTs containing non-allowlisted tags with 403 (master-plan Phase 4 / D1).

The list graduates from `approved_tags.json` → an `approved_tags` table (master-plan Phase 1 migration `035_approved_tags.sql`), keyed `(tenant_id, tag_id)` with `uns_path`, `data_type`, and a per-tag `threshold`. Until that ships, **§4.1 folder-scoping is the enforcement** — be explicit with the customer that adding a tag to the folder = exposing it.

---

## 5. Set the batch interval

The collector batches by **timer cadence** — every tick reads the folder and POSTs one batch.

```properties
# Poll/stream interval. Default 2000 ms. Set in the Timer Script schedule.
STREAM_INTERVAL_MS=2000
```

- Set the actual cadence in the **Gateway Timer Script** schedule (Fixed Rate). `STREAM_INTERVAL_MS` documents it.
- **Guidance:** 1000–2000 ms is the sweet spot for maintenance current-state. Faster than ~500 ms adds gateway + relay load for little diagnostic value (this is current-state, not control). The historian in Ignition covers any gap — the collector does **no local buffering** (`tag-stream.py` header: "On relay failure: logs a warning and continues next cycle. No local buffering — Ignition's tag history covers any gaps.").
- **🎯 TARGET (Phase 5):** per-tag change thresholds (`approved_tags.threshold`) so the *event* stream (`tag_events`) records only meaningful diffs, while the latest-value stream keeps a steady cadence. Today the collector sends every tick's full snapshot.

---

## 6. Test with a small allowlist

Prove the path with a tiny scope before opening it up:

1. Create `[default]Mira_Test` with **two** tags (e.g. `motor_run`, `motor_speed`).
2. Set `STREAM_TAG_FOLDER=[default]Mira_Test`, `RELAY_URL` → **staging** relay, `TENANT_ID` → a staging tenant.
3. Add the timer at 2000 ms.
4. Watch the gateway log under `FactoryLM.Mira.TagStream` (set to TRACE in **Gateway → Config → Logging**):
   ```
   Streamed 2 tags to relay        # TRACE on success (tag-stream.py)
   Relay returned 4xx: ...         # WARN if the relay rejects
   ```
5. Confirm rows land (§7). Once green, widen `STREAM_TAG_FOLDER` to the real monitored folder.

> Never point a test gateway at the **prod** relay/tenant — staging only (`docs/mira-ignition-secure-architecture.md` §8 anti-pattern 13; root `CLAUDE.md` Environments).

---

## 7. Verify data appears in current-tag-state

"Current tag state" is MIRA's latest-value surface that the engine reads during diagnosis. **Concretely today**, the collector's data lands in:

| Surface | Where | What |
|---|---|---|
| `equipment_status` | `mira-relay` SQLite (`relay_server.py:55`) | Latest snapshot per equipment, upserted on each batch. The engine reads this via the `get_equipment_status` MCP tool. **This is the shipped current-tag-state.** |
| `live_signal_cache` | Hub NeonDB (migration 020) | Hub-side latest-value cache for the Command Center / signals views. |
| `tag_entities` | Hub NeonDB (migration 025) | First-class per-tag entity (Sparkplug/OPC-UA/UNS) — **schema exists, writer is TARGET** (master-plan §1.3). |

> The logical name **`current_tag_state`** maps to `equipment_status` (relay) + `live_signal_cache` (Hub) today; a unified `current_tag_state`/`tag_entities` writer is master-plan Phase 4/5 work. Verify against the real tables below.

**Verify (relay SQLite — shipped path):**
```bash
# On the relay host:
sqlite3 /path/to/relay.db \
  "SELECT equipment_id, speed_rpm, current_amps, updated_at, tenant_id
     FROM equipment_status ORDER BY updated_at DESC LIMIT 5;"
# → a fresh row per streamed equipment, values matching the live tags.
```

**Verify (via the agent surface):**
```bash
# get_equipment_status MCP tool returns the latest snapshot the engine sees.
# (Through mira-mcp REST :8001 or the SSE tool surface.)
```

**Verify (Hub):** open `/command-center` → the asset's signals; or `/assets/[id]/signals`. (Reachability dot = HTTP probe, **not** tag freshness — `docs/research/2026-06-01-dt-alignment-analysis.md` §5.)

If no rows appear: check `RELAY_URL`/`TENANT_ID` are set, the timer is running, the folder has leaf tags, and the relay log shows accepted POSTs.

---

## 8. Security notes

The collector's whole value proposition is that it's a **boring, safe install** for the customer's IT (`docs/mira-ignition-secure-architecture.md` §4). The controls, with honest shipped/target status:

| Control | Status | Detail |
|---|---|---|
| **Outbound HTTPS only** | 🟢 SHIPPED | The gateway opens TLS to the relay; **no inbound port, no VPN, no reverse tunnel** (§4.1). Cloud cannot initiate into the plant. |
| **Read-only** | 🟢 SHIPPED | The collector calls `system.tag.readBlocking` only. **No `system.tag.writeBlocking` anywhere in the MIRA bundle** (§4.2). (The writing scripts `plc/live_monitor.py` / `live-plc-bridge` are BENCH-ONLY and never ship — `.claude/rules/fieldbus-readonly.md`.) |
| **Tag allowlist** | 🟡 PARTIAL | Today: folder-scoping (§4.1). Target: declared `approved_tags` enforced at gateway **and** relay (D1, Phase 4). Be explicit with the customer about which they have. |
| **HMAC signing + replay protection** | 🟡 TARGET | Today: shared bearer (`RELAY_API_KEY`). Target: per-tenant HMAC + nonce window (D4, §4.3). |
| **Fail-closed** | 🟡 PARTIAL | Target posture: a tag not on the allowlist is dropped at both points; an unsigned/mistimed payload is rejected (§4.1–4.3). Today the relay rejects on bad bearer (closed on auth) but tag selection is folder-trust, and the gateway fails *open on relay error* (logs + continues, no buffering) — acceptable for availability, but note it's not "closed" on the relay-down case. |
| **Per-tag audit** | 🟡 TARGET | Every tag read → `audit_log`/`ignition_audit_log` with `{tag_path, asset_id, requester, ts}` (§4.5, D7). Schema exists (Hub 031); full wiring is master-plan Phase 8. |
| **PII sanitization** | 🟢 SHIPPED | Engine-side: `InferenceRouter.sanitize_context()` strips IP/MAC/serial by default before any LLM call (§4.6). |
| **No PLC writes, ever (MVP)** | 🟢 SHIPPED | The write code path does not ship. A writable-tag flow is a future, two-step-approved, separate tool — not a flag on this collector (§4.2, §8 anti-pattern 6). |

**The one-paragraph version for the customer's IT:** *"MIRA installs as an Ignition gateway script + WebDev endpoints. It only reads the tags you place under the MIRA folder, and it only ever makes outbound HTTPS calls to `*.factorylm.com:443`. It never opens a listening port, never talks to your PLC directly, and never writes a tag. You allow one outbound rule and nothing else changes on your network."*

---

## 9. Reference: the full security model

This guide is the install/config layer. The architecture, trust boundary, data-flow tables, on-prem vs cloud, MQTT/Sparkplug alternative, the 12-item development checklist (D1–D12), and the alignment audit all live in:

**`docs/mira-ignition-secure-architecture.md`** — read §2 (system diagram), §3 (data flow), §4 (security model), §7 (MVP scope), §8 (what we explicitly should NOT do), and §10.4 (what to fix first: D1 allowlist, D2 chat repoint, D4 relay HMAC).

## 10. Cross-references

- `docs/mira-ignition-secure-architecture.md` — the security model this guide implements (D1/D4 are the open hardening items).
- `docs/adr/0021-ignition-module-first-edge.md` — cloud→plant reach forbidden (the durable ADR).
- `ignition/gateway-scripts/tag-stream.py` — the collector itself.
- `ignition/webdev/FactoryLM/api/tags/doGet.py` — where the allowlist filter (D1) goes.
- `ignition/config/factorylm.properties.template` — all collector config keys.
- `ignition/deploy_ignition.ps1` — the installer.
- `mira-relay/relay_server.py` — the cloud sink (`equipment_status`); HMAC upgrade target (D4).
- `docs/plans/2026-06-01-mira-master-architecture-plan.md` — Phase 4 (collector + allowlist), Phase 5 (`tag_events`).
- `docs/demos/walker-aligned-bench-flywheel-demo.md` — the demo that exercises this collector on the bench.
- `.claude/rules/fieldbus-readonly.md` — why the writing scripts are bench-only.
- `.claude/rules/security-boundaries.md` — secrets, PII, auth boundaries.
