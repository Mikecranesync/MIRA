# Real vs. Simulated — What's Production Data, What's Mock, What's Bench-Only

**Snapshot as of 2026-06-07.** This is the single most important doc for **demo credibility**. Before you put any MIRA surface in front of a prospect or in a recorded demo, check here whether the data behind it is real, synthetic, or a developer bench rig. Mislabeling a mock as real is the fastest way to lose a technical buyer.

> Verification rule for this doc: every "real/mock/bench" call cites the file or directory that proves it. If a row is not cited, treat it as `⚠️ UNVERIFIED` and re-check before relying on it.

---

## TL;DR table

| Surface / dataset | Status | Proof |
|---|---|---|
| OEM manual knowledge base (`knowledge_entries`) | 🟢 **REAL** | `mira-crawler/ingest/`; ~25K chunks ([THEORY_OF_OPERATIONS.md:213](../THEORY_OF_OPERATIONS.md)) |
| Diagnostic engine reasoning (cascade LLM) | 🟢 **REAL** | Groq→Cerebras→Gemini, live API calls — `mira-bots/shared/inference/router.py` |
| Lead-hunter prospect pipeline | 🟢 **REAL** | `tools/lead-hunter/` — real Serper/Hunter.io/MSCA scrapes, real HubSpot writes |
| Ignition tag stream (when HMAC + gateway live) | 🟢 **REAL** (path-dependent) | `mira-relay/` HMAC ingest → `tag_events`; requires PLC-laptop gateway up |
| Garage conveyor PLC reads | 🟢 **REAL** but 🧪 **BENCH** | `plc/live_monitor.py`, `plc/live-plc-bridge/bridge.py` — both carry `BENCH-ONLY` banners |
| CMMS connectors (Maximo / SAP / MaintainX / PI / Ignition) | 🔴 **MOCK** | `mira-connectors/mira_connectors/mocks/*_mock.py` + `mocks/fixtures/*.json` |
| Fault simulator | 🔴 **SIMULATED** | `mira-fault-sim/sim.py` — synthetic fault generator |
| Demo tenant Hub data | 🟡 **SEEDED** (fabricated but labeled) | `chore/demo-hub-seed` (PR [#1750](https://github.com/Mikecranesync/MIRA/pull/1750)); see [seed-demo-data.md](../runbooks/seed-demo-data.md) |
| Several Hub pages ("Coming Soon" / placeholder) | 🟡 **PLACEHOLDER** | Demo-readiness audit — `docs/demos/demo-readiness-punch-list.md` |
| Atlas CMMS work orders / PM (when sync on) | 🟢 **REAL** | `mira-cmms-sync` ↔ Atlas Spring backend; `CMMS_SYNC_ENABLED` default **false** |

Legend: 🟢 real production data · 🔴 mock/synthetic · 🟡 fabricated-but-labeled demo data · 🧪 bench/developer rig.

---

## 🟢 Real production data

### OEM manual knowledge base — `knowledge_entries`
- **Real.** ~25K embedded chunks from real OEM manuals, ingested through `mira-crawler/ingest/` (PDF → chunk → embed `nomic-embed-text` → dedup → NeonDB `knowledge_entries`). Source: [THEORY_OF_OPERATIONS.md:213](../THEORY_OF_OPERATIONS.md).
- **Caveat for demos:** retrieval reads `knowledge_entries`. A manual a customer *uploads through the Hub* may **not** land here (see the upload-retrieval gap below) — so "I just uploaded this and now I can ask about it" is only true via the path documented in [upload-manual-verify-citable.md](../runbooks/upload-manual-verify-citable.md).

### Diagnostic engine reasoning
- **Real.** Every answer is a live LLM call through the Groq→Cerebras→Gemini cascade in `mira-bots/shared/inference/router.py` (no Anthropic, removed PR #610). Nothing is canned. PII is sanitized by default in `InferenceRouter.complete()`.

### Lead-hunter prospect pipeline — `tools/lead-hunter/`
- **Real.** This writes **real prospects to real systems**. `discover.py` scrapes the MSCA member directory (`https://mscafl.com/...`) and runs real DuckDuckGo/Serper queries; `enrich.py` calls Hunter.io `/v2/domain-search` for real contacts; the pipeline dedups and creates real HubSpot companies. Treat its output as live CRM data, not a demo set. See [lead-discovery-flow.md](../workflows/lead-discovery-flow.md).

### Ignition tag stream (path-dependent)
- **Real when the path is live.** When the Ignition gateway (on the PLC laptop) is running and `MIRA_IGNITION_HMAC_KEY` is provisioned, the gateway posts **real** HMAC-signed tag batches to `mira-relay` → `tag_events` (append-only) → `live_signal_cache` (the latest-value store; migration 036 adds its freshness columns — there is no separate `current_tag_state` table). See [tag-ingestion-flow.md](../workflows/tag-ingestion-flow.md).
- **Demo risk:** if the key is missing the endpoint **503s**, and if the gateway/WebDev isn't deployed it **404s** (demo-readiness audit). A "live tag" demo silently degrades to nothing — verify the path end-to-end first via [provision-ignition-hmac.md](../runbooks/provision-ignition-hmac.md).

### Atlas CMMS (when sync enabled)
- **Real** work orders / PM schedules from the Atlas Spring backend, synced by `mira-cmms-sync`. But `CMMS_SYNC_ENABLED` defaults to **false** ([docker-compose.saas.yml](../../docker-compose.saas.yml)), and the Atlas free tier caps at ~30 work orders with shared-admin creds — so a CMMS demo may show stale or empty data unless sync was deliberately turned on. See [cmms-sync-flow.md](../workflows/cmms-sync-flow.md).

---

## 🔴 Mock / synthetic — never present as live customer data

### CMMS / platform connectors — all five are MOCKS
- **Mock.** Every connector adapter ships under `mira-connectors/mira_connectors/mocks/`: `maximo_mock.py`, `sap_mock.py`, `maintainx_mock.py`, `pi_mock.py`, `ignition_mock.py`, each backed by `mocks/fixtures/*.json`. The framework (`base.py`, `canonical.py`, `factory.py`, `confirmation_gate.py`, `store.py`) is real and tested (PR [#1702](https://github.com/Mikecranesync/MIRA/pull/1702), 67 tests), but **there is no live Maximo/SAP/PI integration** — the data is fixtures. See [connector-import-flow.md](../workflows/connector-import-flow.md).
- **How to talk about it honestly:** "the import framework is built and works against connector fixtures; live credentials for <system> are a connect-time step." Never imply MIRA is currently pulling from a customer's real Maximo.

### Fault simulator — `mira-fault-sim/sim.py`
- **Synthetic.** Generates fabricated fault scenarios for testing the engine. Useful for eval, not a representation of a real plant feed.

---

## 🧪 Bench-only — real reads, developer rig, never customer-shipped

The garage conveyor demo reads a **real** Micro820 PLC + GS10 VFD — but through developer bench tools that, by rule, never ship to a customer:

- `plc/live_monitor.py` — real Modbus reads **and writes** (F/R/S/X drive commands). Header: `⚠️ BENCH / DEVELOPER TOOL — NEVER SHIPPED TO CUSTOMERS` ([plc/live_monitor.py:3](../../plc/live_monitor.py)).
- `plc/live-plc-bridge/bridge.py` — direct Modbus TCP poll from a MIRA-named container. Same BENCH-ONLY banner ([plc/live-plc-bridge/bridge.py:3](../../plc/live-plc-bridge/bridge.py)).

These prove the concept on the bench. The **customer-shipped** PLC read path is through Ignition (read-only), never a direct fieldbus socket — see `.claude/rules/fieldbus-readonly.md`. So: the garage tag values in a demo are *real*, but the mechanism is a bench rig, not the product architecture. Don't conflate the two when a buyer asks "how does MIRA talk to my PLC?"

---

## 🟡 Demo-tenant & placeholder Hub data

- **Seeded demo data** (fabricated, but intentionally labeled as a demo plant): the `chore/demo-hub-seed` branch / PR [#1750](https://github.com/Mikecranesync/MIRA/pull/1750) seeds a garage-conveyor cell. This is for recording videos — see [seed-demo-data.md](../runbooks/seed-demo-data.md). It is **not** a real customer's plant.
- **Placeholder pages:** several Hub pages render "Coming Soon" or fixed/fake numbers. The current inventory of which pages are real vs. fake-data vs. placeholder lives in `docs/demos/demo-readiness-punch-list.md`. **Read that before recording any Hub walkthrough** — it is the authoritative, dated list. Labs features should stay OFF in demos.

---

## What can go wrong (demo failure modes)

1. **Showing a connector as "live"** — it's a fixture. Say "framework + fixtures," not "connected to your Maximo."
2. **"Upload and ask" that doesn't cite** — the upload-retrieval gap means a Hub-uploaded PDF may never reach `knowledge_entries`. Verify via [upload-manual-verify-citable.md](../runbooks/upload-manual-verify-citable.md) before promising it on camera.
3. **Live-tag demo silently empty** — missing HMAC key (503) or undeployed WebDev (404). Pre-flight the Ignition path.
4. **CMMS page stale/empty** — `CMMS_SYNC_ENABLED=false` by default; the free Atlas tier caps work orders.
5. **Calling the garage rig "the product architecture"** — it's a BENCH tool. The shipped path is Ignition read-only.
6. **Recording a "Coming Soon" page as a feature** — cross-check `docs/demos/demo-readiness-punch-list.md` first.

## How to re-verify this doc
- Connectors mock status: `ls mira-connectors/mira_connectors/mocks/`
- Bench banners: `grep -rn "BENCH" plc/live_monitor.py plc/live-plc-bridge/bridge.py`
- Demo seed: `gh pr view 1750` and `tools/seeds/`
- Placeholder pages: open `docs/demos/demo-readiness-punch-list.md`

## Cross-references
- [container-map.md](container-map.md) · [database-map.md](database-map.md) · [environment-quick-ref.md](environment-quick-ref.md)
- Workflows: [connector-import-flow.md](../workflows/connector-import-flow.md), [tag-ingestion-flow.md](../workflows/tag-ingestion-flow.md), [cmms-sync-flow.md](../workflows/cmms-sync-flow.md)
- `.claude/rules/fieldbus-readonly.md` — why customer PLC reads go through Ignition, not direct sockets
