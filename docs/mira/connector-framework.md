# MIRA — Connector Framework

**Status:** Phase 2-aligned deliverable of the canonical-asset-graph initiative —
**framework + mock connectors (no live source I/O, no DB writes)**
**Authored:** 2026-06-04
**Builds on:** `docs/mira/canonical-asset-graph.md` · `docs/mira/source-record-preservation.md` · `docs/mira/current-repo-inventory.md`
**Code:** `mira-connectors/`

---

## 0. What this is

A **connector** is the translation layer between an external system and MIRA's
canonical industrial asset graph. The canonical graph is built first; connectors
map *into* it and never own a shape (canonical-asset-graph.md §0, "the one rule").

Two families:

- **Enterprise (CMMS / EAM):** IBM Maximo, SAP PM, MaintainX, Fiix, Limble, Atlas.
- **Plant-floor (OT):** Ignition / SCADA, MQTT/Sparkplug, OPC UA, AVEVA PI historian.

This module ships **mock** connectors for five of them (Maximo, Ignition, SAP,
MaintainX, AVEVA PI) that read realistic fixtures instead of calling live APIs,
so the full normalize → validate → propose → export pipeline runs with zero
credentials. The live path swaps the fixture read for the real API client; the
mapping code is unchanged.

```
mira-connectors/
├── base.py            # Connector ABC + Capability/RawRecord/ExportResult
├── canonical.py       # in-memory mirror of kg_entities/kg_relationships/
│                      #   ai_suggestions/source_objects (live column names)
├── uns_bridge.py      # re-exports mira-crawler/ingest/uns.py builders (reuse, never reimplement)
├── demo.py            # runnable end-to-end OT↔enterprise join
├── cmms/              # maximo_mock.py · sap_mock.py · maintainx_mock.py (+ fixtures/)
├── scada/             # ignition_mock.py (+ fixtures/)
├── historian/         # pi_mock.py (+ fixtures/)
└── tests/             # per-connector + canonical + base + e2e (67 tests)
```

---

## 1. The pipeline

```
  EXTERNAL SYSTEM                          MIRA
  ┌────────────┐   discover()   ┌──────────────────────────────────────┐
  │ Maximo /   │ ─────────────▶ │ Capability (schema, object types,     │
  │ SAP /      │                │            supports_export, read_only) │
  │ MaintainX /│   import_records(config)                                │
  │ Ignition / │ ─────────────▶ │ list[RawRecord]  (raw, untouched)      │
  │ PI         │                │        │                               │
  └────────────┘                │        ▼ normalize()  (pure, no I/O)   │
                                │ NormalizedGraph:                       │
                                │   • CanonicalEntity   (kg_entities)    │
                                │   • CanonicalRelationship (kg_rels)    │
                                │   • Proposal          (ai_suggestions) │
                                │   • SourceObject      (source_objects) │
                                │        │                               │
                                │        ▼ validate()                    │
                                │ ValidationReport (errors block, warns) │
                                │        │                               │
                                │        ▼ [a writer persists — Phase 2/3]│
                                │   kg_entities + kg_relationships        │
                                │        │                               │
                  export_enriched(ctx)   ▼                               │
  ┌────────────┐ ◀───────────── │ enriched payload in SOURCE format      │
  │ source     │   (only when    │ (e.g. Maximo WO + MIRA_UNS_PATH)       │
  │ (writable) │   read_only=    └──────────────────────────────────────┘
  └────────────┘    False & not dry_run)
```

Each stage is a method on `Connector` (`base.py`):

| Method | Sync/async | Returns | Notes |
|---|---|---|---|
| `discover()` | async | `Capability` | schema + capabilities, no records |
| `import_records(config)` | async | `list[RawRecord]` | read-only pull; `config` filters |
| `normalize(raw)` | sync | `NormalizedGraph` | pure transform; preserves payloads |
| `validate(graph)` | sync | `ValidationReport` | errors block, warnings inform |
| `export_enriched(ctx)` | async | `ExportResult` | source-format write-back |
| `get_config_schema()` | sync | `dict` | expected config (secrets flagged) |

`run(config)` is a convenience that chains import → normalize → validate.

---

## 2. The canonical model (what connectors emit)

`canonical.py` mirrors the **live** NeonDB schema (column names verified in
`current-repo-inventory.md` §2.1 — `source_id`/`target_id`/`relationship_type`,
**not** the engine-005 `source_entity`/`relation_type` names — the PR #1443 trap).

| Canonical class | Live table | Key fields |
|---|---|---|
| `CanonicalEntity` | `kg_entities` | `entity_type`, `name` (natural key), `uns_path`, `properties`, `approval_state`, `confidence`, `source_payload` |
| `CanonicalRelationship` | `kg_relationships` | `source_key`, `target_key`, `relationship_type`, `confidence`, `approval_state` |
| `Proposal` | `ai_suggestions` | one of 6 `suggestion_type`, `extracted_data`, `confidence`, `risk_level`, `proposed_by` |
| `SourceObject` | `source_objects` (proposed mig 042) | `raw_payload`, `content_hash`, `mapping_status`, `mapped_entity_key` |

**Vocabulary is governed, not free-for-all.** `ENTITY_TYPES`, `REL_TYPES` (the
Hub-028 28 + the 4 new edges `HAS_ALARM`/`HAS_WORK_ORDER`/`HAS_PM_TASK`/`USES_PART`
from canonical-asset-graph.md §3), and the 6 `SUGGESTION_TYPES` are constants; a
typo raises at construction time, not at Hub render time.

**UNS paths come only from `uns.py`** (`uns_bridge.py` re-exports it). Connectors
call `uns.site_path`, `uns.assigned_equipment_path`, `uns.equipment_subnode_path`,
`uns.fault_code_path`, `uns.work_order_path`, etc. — never hand-formatted strings
(`.claude/rules/uns-compliance.md` rule #1).

### Natural keys

Entities are keyed by `(entity_type, name)` where `name` is the source system's
**unique ID** (Maximo `ASSETNUM`, SAP `EQUNR`, PI tag, Ignition tag path) — never
the free-text description (two motors both named "MOTOR" would silently merge).
Relationships reference entities by the in-memory `key` (`entity_type:name`),
which a writer resolves to real `kg_entities.id` UUIDs.

---

## 3. The confirmation gate (proposed → verified)

**Nothing a connector produces is `verified`.** Every `CanonicalEntity` and
`CanonicalRelationship` defaults to `approval_state="proposed"`; every `Proposal`
starts `status="pending"`. Promotion to `verified` is a **human/admin action**
(canonical-asset-graph.md req 4/5; `.claude/CLAUDE.md` "Knowledge graph
proposals"). A connector that auto-verifies is a bug — `validate()` flags any
non-`proposed` entity/edge as an `error`.

Two kinds of uncertainty surface as `ai_suggestions` (`Proposal`):

- **Mapping ambiguity** → `uns_confirmation`. Example: Maximo's location depth is
  `PLANT → AREA → LINE → CELL` (4 levels) but ISA-95 below a site is
  `area → line → work_cell` (3). The connector folds `PLANT-*` into the site and
  emits a `uns_confirmation` proposal rather than silently forcing a mapping.
- **Cross-system links** → `kg_edge`. The Ignition connector matches SCADA tags
  to CMMS assets (`propose_asset_links`) and proposes `HAS_SIGNAL` edges with
  calibrated confidence (exact tag↔ASSETNUM = 0.9; fuzzy folder keyword =
  0.55–0.8). The technician confirms before these become trusted.

**Safety proposals are `risk_level="safety_critical"`.** Anything touching
E-stop / interlock / LOTO (a Maximo failure path, an Ignition `EStop` tag, a PI
"Safety Event" frame) is flagged so the Hub gates it for review (migration 027
writer responsibility). The authoritative keyword list is
`mira-bots/shared/guardrails.py SAFETY_KEYWORDS`; connectors carry a small local
hint set only for risk-tagging proposals, not for user-facing STOP behavior.

---

## 4. Source-record preservation

Every connector preserves the **complete original record** twice:

1. on the entity, in `CanonicalEntity.source_payload` (convenience), and
2. as a `SourceObject` (`raw_payload` + `content_hash` + `mapping_status`), which
   is the canonical raw store from `source-record-preservation.md`.

Custom fields are **not junk** — Maximo's `MIRA_UNS_PATH` / `MIRA_CONFIDENCE`
survive verbatim and round-trip back out through `export_enriched`. `content_hash`
(sha256 of the canonicalized payload) is the re-import dedup key. Because the raw
record is kept, a mapping change is a **re-run of `normalize` over stored
payloads** — no second call to the customer's system.

---

## 5. Read-only and dry-run (two distinct axes)

| Flag | Guards | Default |
|---|---|---|
| `read_only` | the **source system** — never write back to Maximo/PI/Ignition | `True` |
| `dry_run` | **MIRA's** stores — don't persist into kg_entities/source_objects | `True` |

`export_enriched` pushes to the source only when `read_only=False` **and**
`dry_run=False` (`_may_write_source()`). A mock/read-only/dry-run connector still
*builds* the enriched payload and returns it with `written=False`, so a caller
can inspect exactly what would be sent. SCADA and historian connectors return
`ExportResult(supported=False)` — you don't write enriched payloads back to a tag
provider or a read-only historian.

---

## 6. Mock vs live connectors

The mocks are **shape-faithful**: real field names (`ASSETNUM`, `EQUNR`,
`TPLNR`, `WONUM`, PI point names, Ignition `[provider]Folder/Tag` paths) and real
API response envelopes (MaintainX `workOrders`/`assets`). Only the *transport*
differs.

To go live, keep `normalize`/`validate`/`export_enriched` exactly as-is and
replace `_load()`/`import_records` with the real client:

- **Maximo** → Manage REST (`oslc/os/mxapiasset`, `mxapiwodetail`, `mxapipm`).
- **SAP PM** → S/4HANA OData (`API_FUNCTIONALLOCATION`, `API_EQUIPMENT`, …).
- **MaintainX** → `https://api.getmaintainx.com/v1/...` (reuse the existing
  `mira-mcp/cmms/maintainx.py` `MaintainXCMMS._get`).
- **Ignition** → tag browse (`system.tag.browse`) + WebDev/Web API.
- **AVEVA PI** → PI Web API (`/piwebapi/...`) or AF SDK.

Secrets stay **Doppler-managed** (`factorylm/dev|stg|prd`) and are referenced by
`get_config_schema()` fields marked `"secret": True` — never placed in
`source_systems.config` (security-boundaries.md).

---

## 7. How to add a new connector

1. Pick the family dir (`cmms/`, `scada/`, `historian/`, or a new one).
2. Add a fixture under `fixtures/<system>_demo.json` using **real source field
   names** and the real response shape.
3. Subclass `Connector`; set `name`, `system_kind` (must be one of the
   source-record-preservation `system_kind` values), `connector_version`.
4. Implement the six methods. In `normalize`:
   - build UNS paths **only** via `uns.*` builders;
   - key entities by the source's unique ID;
   - set `source_payload` to the full record and emit a `SourceObject`;
   - leave everything `approval_state="proposed"`;
   - raise ambiguities as `Proposal`s (`uns_confirmation` / `kg_edge` / …), and
     tag safety-relevant ones `risk_level="safety_critical"`.
5. `validate` should check valid UNS paths, no orphan edges, preserved payloads,
   and that nothing is auto-verified.
6. Add a test file `tests/test_<system>_mock.py` covering the seven behaviors
   (import, normalize, payload preservation, UNS paths, proposals-not-facts,
   dry_run, export). Run from inside the module: `cd mira-connectors && pytest`.

> **Import note:** `mira-connectors/` is a `sys.path` root (like `mira-mcp/`),
> not an installable package — its `cmms/` subpackage shares a name with
> `mira-mcp/cmms`, so the two are never put on `sys.path` together. Tests run
> per-module (`conftest.py` injects `mira-connectors/` + `mira-crawler/`). All
> modules use `from __future__ import annotations` so they import cleanly under
> the CHARLIE system Python (3.9) as well as the 3.12 target.

---

## 8. Run the demo

```bash
python mira-connectors/demo.py
# imports Maximo + Ignition mocks, normalizes both, cross-references SCADA→CMMS,
# prints the proposed unified graph + the technician confirmation queue, and
# builds (dry-run) an enriched Maximo work-order payload.
```

```bash
cd mira-connectors && pytest tests/ -q     # 67 tests
```

---

## 9. Cross-references

- `docs/mira/canonical-asset-graph.md` — the node/edge model + entity/edge vocabulary
- `docs/mira/source-record-preservation.md` — `source_objects` raw-record store
- `docs/mira/current-repo-inventory.md` — verified live schema (column names)
- `.claude/rules/uns-compliance.md` — path builders, slugs, reserved labels
- `.claude/rules/direct-connection-uns-certified.md` — SCADA/OT surfaces carry UNS by construction
- `mira-mcp/cmms/` — the existing live CMMS adapter pattern this framework generalizes
- `mira-crawler/ingest/uns.py` — the one source of UNS path builders
- ADR-0013 (Hub-canonical schema), ADR-0014 (`ai_suggestions`), ADR-0017 (status transitions)
