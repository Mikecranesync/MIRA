# Canonical Ownership — Gate 2 Proposal (verified against observed reality)

**Date:** 2026-08-15 · **Status:** Proposed — needs Mike's ratification as ADRs before it binds anything.
The convergence doc §4 stated ownership *assumptions* and required they be verified during discovery. Here is what discovery actually found.

## The central observed fact

> **The §4 split ("FactoryLM owns industrial truth, MIRA owns intelligence") describes layers, not repos. Today the MIRA monorepo owns BOTH.**

- All 13 core NeonDB tables — including the industrial-truth ones (`cmms_equipment`, `tag_events`, `approved_tags`, UNS ltree columns) — are created by `mira-hub/db/migrations/` and written only by MIRA modules. Zero factorylm writers.
- Production (VPS, 18 services) deploys exclusively from MIRA. The factorylm repo's runtime is a local SCADA bench + cluster scheduled tasks; **no cross-repo runtime calls exist in either direction.**
- factorylm's product-shaped code (diagnosis engine, telegram bot, llm-router, sim stack) froze 2026-03-08 — all are superseded predecessors of MIRA modules.
- The factorylm repo's *live* value is cluster operations: `CLUSTER.md`, ansible fleet sync, node bootstrap, scheduled-task definitions, and recent mission-control/media tooling.

## Proposed ownership (ADR-ready)

| Domain | Canonical owner (observed + proposed) | Notes |
|---|---|---|
| Canonical assets, ISA-95/UNS, tenants, CMMS/WO/PM, telemetry identity | **MIRA repo — "FactoryLM domain" layer** (`mira-hub` db + api, `mira-relay`, `mira-crawler/ingest/uns.py`, `mira-cmms` bridge) | The *name* FactoryLM survives as the domain layer inside MIRA, matching the product story; no physical repo move required |
| Retrieval, evidence, diagnosis, routing, orchestration, grounded answers, evals | **MIRA repo — "MIRA intelligence" layer** (`mira-bots`, `mira-pipeline`, `mira-mcp`, `printsense`, `materialized_evidence`, `factorylm_ai`, evals in `tests/`) | Already true |
| Technician client | **`mira-mobile`** — confirmed pure consumer of canonical Hub contracts (12 endpoints, fail-closed auth, no business truth) with exactly one contract drift (tag grammar → pilot CU-P1) | ADR-0034 governs |
| Cluster operations (nodes, fleet sync, scheduled tasks) | **factorylm repo — scoped down to cluster-infra only** | Its product-shaped legacy becomes DELETE_CANDIDATE via Gate 11 |

**Decision requested from Mike (ADR):** ratify "factorylm repo = cluster infra only; all product truth lives in MIRA" — the alternative (physically moving industrial-domain modules out of MIRA into factorylm to match §4 literally) would be a large, low-value migration against the observed grain, and nothing in discovery supports it.

## Asset identity — the flagship convergence problem

Discovery (see `ASSET_IDENTITY.md`) found **five** production identity schemes with soft links and dual-truth creation:

1. `cmms_equipment.id` (UUID) — CMMS/mobile system of record
2. `cmms_equipment.equipment_number` (TEXT) — QR handle
3. `kg_entities.id`/`entity_id` — KG node, **created by backfill from `knowledge_entries` (mfr,model) pairs, NOT from cmms_equipment**
4. `kg_entities.uns_path` (ltree) — ISA-95 address, deployment-gate key, nullable
5. `UNSContext.uns_path` — per-turn resolver output

No hard FK bridges `cmms_equipment ↔ kg_entities` (deliberate schema-separation, migration 017:22-23). The product-spine invariant ("same canonical asset identity throughout", doc §3) is therefore **not yet true**.

**Proposed target (for its own ADR, staged, xhigh-reviewed):**
- *Asset instance* identity = `cmms_equipment.id` (UUID), everywhere an instance is meant.
- *Asset address* = `uns_path` (ltree), resolved-and-stored, never re-derived ad hoc.
- *Asset model* (manufacturer/model class) = `kg_entities` keyed identity.
- Every bridge becomes an explicit, validated contract (app-layer FK validation where cross-schema), and backfills that mint identity (`backfill_equipment_entities.py`) are replaced by derivation from the instance/model contracts.

This is CU-05 in the backlog — explicitly **not** the pilot and **not** early: it touches tenancy, the deployment gate, and retrieval joins (§Gate 7 auto-xhigh, human GO).
