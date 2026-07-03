# Discovery — Remote Commissioning of Connectors (Hub as command center)

> Date 2026-06-28 · Branch `feat/discharge-conveyor-cv200` (PR #2362) · **Discovery only — no new
> infra built.** Method: 5 parallel read-only agents over current branch + `origin/main` + merged
> PRs, then direct file-level verification of every load-bearing claim (`git ls-tree origin/main`,
> `grep`, `ls`). Reuse-Before-Build discipline applied.

## Mission
FactoryLM Hub (`app.factorylm.com/hub`) must be the command center for **remotely** commissioning a
customer/site/equipment connection; the PLC laptop / edge box is a **dumb local bridge**. Mike
operates from Orlando; nobody touches the laptop after the initial local pairing.

## Headline finding
**The remote-commissioning loop already exists end-to-end (~80%), just scattered and without a single
status surface.** It is NOT in `mira-connectors/` (that is a *CMMS/historian record-import* framework
with mock adapters only — unrelated). The real path is `ignition/` (edge) → `mira-web` (claim) →
`mira-relay` (ingest) → `mira-hub` (command center). **Do not build a parallel MIRA Connect / relay /
connector system.** The next PR is thin aggregation + one genuine gap, not new architecture.

---

## 1. What already exists and where (verified)

| Workflow capability | Status | Where (verified) |
|---|---|---|
| **Claim-code issuance** (Hub/web) | ✅ | `mira-web/src/server.ts:1698` `POST /api/connect/generate-code`; `mira-web/src/lib/connect.ts` `plg_activation_codes` (`MIRA-XXXX-XXXX-XXXX`, 1h expiry) |
| **Edge activation / pairing** | ✅ | `ignition/webdev/FactoryLM/api/connect/doPost.py` `POST /api/connect/activate` → writes `TENANT_ID` + `RELAY_URL` to `factorylm.properties`; `mira-web/src/server.ts:1709` |
| **Connector self-status** | ✅ | `mira-web/src/server.ts:1735` `GET /api/connect/status` |
| **Edge tag streaming (phone-home)** | ✅ | `ignition/gateway-scripts/tag-stream.py` — gateway timer reads allowlisted tags, HMAC-signs, POSTs `/api/v1/tags/ingest` |
| **Cloud ingest (HMAC + fail-closed allowlist)** | ✅ | `mira-relay/relay_server.py:726`, `mira-relay/auth.py:70` (4 `X-MIRA-*` headers, replay guard), `mira-relay/tag_ingest.py` (allowlist match) |
| **Per-tenant allowlist** | ✅ | `approved_tags` (`mira-hub/db/migrations/035_approved_tags.sql`); match key `normalized_tag_path` |
| **Gateways list + online probe** (Hub) | ✅ | `mira-hub/src/app/api/command-center/gateways/route.ts:48` `isGatewayOnline()` probes `host:8088`; lists from `plg_activation_codes` |
| **Live-data freshness + display reachability** | ✅ | `mira-hub/src/app/api/command-center/tree/route.ts` joins `display_endpoints` (HTTP probe) + `live_signal_cache` freshness (`lib/command-center-freshness.ts`, 60s window; live/stale/simulated) |
| **`live_signal_cache` with `last_seen_at`** | ✅ | `mira-hub/db/migrations/020_…sql` + `036_current_tag_state_freshness.sql` (adds `uns_path`, `source_system`, `freshness_status`) |
| **`tag_events` append-only history** | ✅ | `mira-hub/db/migrations/033_tag_events.sql` (timestamps, quality, source_system) |
| **Command Center UI page** | ✅ | `mira-hub/src/app/(hub)/command-center/` (renders the tree + live dots) |
| **Ask-MIRA direct-connection** | ✅ | `mira-pipeline/ignition_chat.py:460` (`asset_context → direct_connection`, 422 `uns_required`) |
| **Offline tag/program import → proposals** | ✅ | `mira-hub/src/app/api/connectors/{ignition,plc}/import/route.ts` (L5X/CSV upload → `ai_suggestions`; uses `IgnitionMockConnector`) |
| **Readiness / health rollup** | ✅ | `mira-hub/src/app/api/readiness/route.ts` + `health_scores` (L0–L6) |

## 2. What is partially built but unused

- **`/api/connectors/{ignition,plc}/import`** — exists but is **offline** (upload an export file). There
  is no *live* "browse tags from the connected gateway" path; `IgnitionMockConnector` is fixture-backed
  (`mira-connectors/` real adapters are TODO — registry has `ignition_mock` only).
- **Gateway online state** — `/command-center/gateways` computes it as an **ephemeral 2s HTTP probe**;
  it is not persisted, so there is no "last checked in at" history or offline-since timestamp.
- **`source_connection_id`** — carried on `tag_events` and stamped by `tag-stream.py`
  (`STREAM_SOURCE_CONNECTION_ID`), but **nothing reads it** — no per-connector grouping downstream.
- **`mira-connect/` (singular)** — dormant Modbus-driver scaffold (~15%), deferred post-MVP. Not the
  edge path. Don't revive for this.
- **HMAC key** — single shared `MIRA_IGNITION_HMAC_KEY` env, not per-connector (design doc claims a
  JWT; not implemented). Fine for the demo; a hardening follow-up, not a blocker.

## 3. What is missing for the real workflow

1. **No single "Connector Commissioning" status view.** Every signal exists, but nothing assembles the
   per-connector checklist (online · claimed-to machine/UNS · source type · gateway reachable · display
   reachable · approved-tag count · live data arriving · Ask-MIRA bound · next manual action).
2. **No discovered/rejected-tag store + no approve UI.** `approved_tags` is **SQL-seed-only**; rejected
   tags are returned in the ingest HTTP response but **never persisted** (verified: no
   `discovered_tags`/`rejected_tags`/`ingest_audit` table). So "browse/import tags → approve → map to
   UNS" and "see rejected tags **blocked**" cannot be done remotely today.
3. **No persistent connector heartbeat.** "Online" is probe-only; freshness via
   `live_signal_cache.last_seen_at` is the closest proxy. No explicit per-connector last-seen timeline.

## 4. What can be wired together WITHOUT new architecture

A read-only **Connector Commissioning view** can be assembled today purely from existing data — zero
schema change, zero new ingest:
- **Claimed + online** ← `plg_activation_codes` + the existing `isGatewayOnline()` probe.
- **Claimed-to machine / UNS** ← `kg_entities` / `cmms_equipment` (the seeded CV-200 row).
- **Source system** ← `approved_tags.source_system` / `tag_events.source_system` (`ignition`).
- **Display reachable** ← existing `display_endpoints` probe in `command-center/tree`.
- **Live data arriving** ← `live_signal_cache` freshness (live/stale/simulated).
- **Approved-tag count** ← `SELECT count(*) FROM approved_tags WHERE tenant_id=? AND enabled`.
- **Ask-MIRA bound** ← the asset has a resolvable `uns_path` (CV-200 does).
- **Next manual action** ← derived (no live tags yet → "start the gateway timer / approve tags";
  display unreachable → "check proxy"; etc.).

What CANNOT be done without a small new piece: **rejected/discovered-tag visibility and a tag-approve
UI** (needs persistence — see §5 PR-2).

## 5. The next smallest PR (recommended)

**PR-1 — "Connector Commissioning status view" (pure reuse, no new architecture).** Smallest thing
that delivers remote command-center value and most of the demo:
- One read endpoint, e.g. `GET /api/command-center/commissioning` (or extend
  `/command-center/gateways`), that aggregates the §4 signals into a per-connector checklist object.
- One Hub UI panel under the existing `app/(hub)/command-center/` page rendering the checklist with
  green/amber/red + the "next manual action" line.
- Reuses `plg_activation_codes`, `isGatewayOnline`, `command-center/tree` freshness+probe helpers,
  `approved_tags`, `kg_entities`. **No migration, no relay change, no new connector system.**
- Tests: aggregation logic (online/offline, live/stale, claimed/unclaimed, count) as pure-function
  unit tests; garage path untouched; CV-200 separate.
- Demo it delivers: *from Orlando, see the CV-200 connector online, claimed to Riverside/Line1/CV-200,
  display reachable, live tags arriving, Ask-MIRA bound, and the next action.*

**PR-2 (follow-up) — "Discovered/rejected tags + approve-to-UNS" (the one genuine gap).** Closes
"approve tags / rejected tags blocked":
- New `discovered_tags` table (migration, following `mira-hub/db/migrations/` rules: RLS, grant to
  `factorylm_app`, next free integer).
- Persist seen-but-not-allowlisted tags at ingest via the **same** `tag_ingest`/store path (one-pipeline
  law — no forked persistence), recording `source_tag_path` + reason.
- Hub endpoint + UI to **approve** a discovered tag → writes `approved_tags` (+ `uns_path` mapping),
  staging→prod via `apply-seeds.yml` discipline; rejected ones shown as blocked.
- Keeps fail-closed, tenant isolation, read-only.

**PR-3 (optional, hardening) — persistent connector heartbeat** (`connector_status` last-seen table)
and per-connector identity / HMAC. Production-shaping; not demo-critical.

Recommended order: **PR-1 now** (smallest, no architecture, demo-ready) → PR-2 (the approval gap) →
PR-3 (hardening).

---

## Reuse-Before-Build verdict
- ✅ **Reuse:** `mira-web` connect/claim (`plg_activation_codes`), `ignition/` edge collector
  (`tag-stream.py`, `api/connect`), `mira-relay` ingest + HMAC + allowlist, `mira-hub`
  command-center (`gateways`, `tree`, freshness), `live_signal_cache`/`tag_events`,
  `ignition_chat.py`.
- ❌ **Do NOT build:** a new MIRA Connect, a new relay, a new connector framework, or a parallel
  edge agent. `mira-connectors/` (record-import) and `mira-connect/` (dormant Modbus) are NOT the
  edge-commissioning path.

## Corrections logged (anti-fabrication)
- An agent claimed `origin/main` already has `docs/adr/0024-…`. **False** — verified `origin/main`'s
  highest ADR is `0023`; the `0024` is this branch's new file (correct next number, no collision).
- `mira-connectors/` was initially assumed to be the connector commissioning framework. **It is not** —
  it's CMMS/SCADA/historian record-import with mock adapters; the live edge path is `ignition/` +
  `mira-relay`.

## Constraints honored
Tenant isolation / HMAC / allowlist / read-only all preserved by the reuse plan. Garage conveyor path
untouched; Northwind/CV-200 kept separate; production Perspective embedding stays tied to the
dedicated-origin decision (ADR-0024). Branch note: `feat/discharge-conveyor-cv200` is ~10 commits
behind `origin/main` (which now has the Sparkplug consumer #2358) — rebase before PR-1's code lands.
