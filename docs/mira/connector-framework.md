# MIRA Connector Framework

**Status:** Phase 3 — framework + mock connectors shipped (this PR)
**Code:** `mira-connectors/`
**Companion:** `docs/mira/technician-confirmation-gate.md` (Phase 6 — how imported data becomes graph truth)

---

## 1. Why this exists

MIRA already integrates with external systems through purpose-built adapters:

- **CMMS** — `mira-mcp/cmms/` (`CMMSAdapter` ABC + Atlas / MaintainX / Limble / Fiix).
- **SCADA (Ignition)** — `mira-pipeline/ignition_chat.py`, `mira-relay/relay_server.py` tag streaming.
- **Documents** — `mira-crawler/ingest/` (PDF → chunk → embed → dedup → store → kg_writer).
- **MQTT / UNS** — `mira-bridge`, `mira-relay`.

Each is excellent at its job, and each has a *different shape*. The connector framework
is the **common contract** that lets MIRA onboard a new external system — a new CMMS, a
historian (AVEVA PI), a customer's MQTT broker — without re-inventing import/normalize/
validate/log/dry-run/read-only every time. It **extends** the existing adapters; it does
not replace them. A real `MaintainXConnector` is a thin wrapper over the already-working
`mira-mcp/cmms/maintainx.py`.

The framework's north star: **turn any external system into MIRA's canonical model, then
route every proposed mapping through the technician confirmation gate** so a human
confirms before the knowledge graph changes (TOO Invariant #4; `.claude/rules/
uns-confirmation-gate.md`).

---

## 2. The ten capabilities

Every connector satisfies this contract (`mira_connectors/base.py`):

| # | Capability | Where |
|---|---|---|
| 1 | **Discover** schema / capabilities | `discover() -> ConnectorCapabilities` |
| 2 | **Import** raw records | `import_records(record_type, since=, limit=) -> list[RawRecord]` |
| 3 | **Normalize** into MIRA canonical model | `normalize(raw) -> list[CanonicalRecord]` |
| 4 | **Validate** mappings | `validate_mappings(records) -> ValidationResult` |
| 5 | **Export** enriched records back | `export_records(enriched) -> ExportResult` |
| 6 | **Auth / config** | `ConnectorConfig` + `configured` property |
| 7 | **Log** sync results | `sync(...) -> (records, SyncResult)` |
| 8 | **Dry-run** mode | `ConnectorConfig.dry_run` → writes become planned no-ops |
| 9 | **Mock** mode | `is_mock` flag; fixture-backed mock connectors |
| 10 | **Read-only default** | `ConnectorConfig.mode` defaults to `READ_ONLY` |

`derive_relationships(records)` is an **optional 11th** capability: relationships are
cross-record (asset→parent, tag→asset, asset→document) so they cannot come from per-type
`normalize()`. The confirmation gate calls it to seed `relationship_proposals`.

### Never-raise contract

Mirroring the existing `CMMSAdapter`: remote/IO failures **never raise**. They degrade
gracefully and surface in `SyncResult.errors` / `ExportResult.errors`. Only programming/
config mistakes raise (`ConnectorError`). `sync()` catches everything and always returns a
`SyncResult` you can log.

---

## 3. Class hierarchy

```
Connector (ABC)                         # the 10-capability contract
└── BaseConnector                       # read-only/dry-run guards, validate, sync, derive
    ├── CMMSConnector                   # CMMS/EAM — write-back allowed (to CMMS API, not plant)
    │   └── MaximoMockConnector         # ← fixture-backed reference (mocks/maximo_mock.py)
    ├── SCADAConnector                  # read-only BY CONSTRUCTION (plant-facing)
    │   └── IgnitionMockConnector       # ← fixture-backed reference (mocks/ignition_mock.py)
    ├── HistorianConnector              # read-only BY CONSTRUCTION (PI/OSIsoft/Canary) — NEW type
    ├── DocumentConnector               # hands CanonicalDocument to mira-crawler ingest
    └── MQTTConnector                   # read-only BY CONSTRUCTION (subscribe, never publish)
```

A connector is selected by provider name via `create_connector(provider, config)`
(`mira_connectors/factory.py`) — the same registry pattern as
`mira-mcp/cmms/factory.py:create_cmms_adapter`.

---

## 4. Canonical model

`mira_connectors/canonical.py`. Each canonical record is provider-agnostic and maps onto
MIRA's **existing** Postgres tables — the framework adds **no new tables**.

| Canonical record | Target MIRA table(s) |
|---|---|
| `CanonicalAsset` | `kg_entities` / `installed_component_instances` / `cmms_equipment` |
| `CanonicalLocation` | `kg_entities` (LOCATED_IN hierarchy) |
| `CanonicalTag` | `tag_entities` (Hub 025) |
| `CanonicalWorkOrder` | CMMS work-order store (Atlas `cmms_*`) |
| `CanonicalPMTask` | `pm_schedules` |
| `CanonicalFailureCode` | `fault_codes` |
| `CanonicalMeter` | `live_signal_cache` / meter store |
| `CanonicalPart` | parts / inventory store |
| `CanonicalDocument` | `knowledge_entries` / documents |
| `CanonicalRelationship` | `relationship_proposals` + `relationship_evidence` (Hub 018) |

### UNS discipline

`proposed_uns_path` is a **candidate only**. Connectors never mint a final UNS path — the
authoritative builders live in `mira-crawler/ingest/uns.py` (`uns.slug()`,
`manufacturer_path`, …) per `.claude/rules/uns-compliance.md`. The connector emits a
candidate path (via `_uns.candidate_uns_path`, clearly marked candidate-only) plus the
structured location components, and the confirmation gate canonicalizes before any write.

### Controlled vocabularies stay in sync with the schema

`RELATIONSHIP_TYPES` and `EVIDENCE_TYPES` in `canonical.py` are copied from the CHECK
constraints in `mira-hub/db/migrations/018_relationship_proposals.sql`. If that migration's
vocab changes, update `canonical.py` to match (there is a comment marker on both sides).

---

## 5. Export & the read-only doctrine

Capability #10 (read-only default) is a *floor* for CMMS/Document connectors and a *hard
wall* for plant-facing ones:

- **CMMS / Document** — `export_records` is gated by `ConnectorConfig.mode`. In `READ_ONLY`
  (default) it refuses; in `READ_WRITE` it writes back **to the CMMS API / document
  metadata**, never to the plant. (Maximo mock write-back: only work orders are writable.)
- **SCADA / Historian / MQTT** — read-only **by construction**. `export_records` refuses
  regardless of `mode`, because **no customer-shipped MIRA surface writes to the plant**
  (`.claude/rules/fieldbus-readonly.md`, ADR-0021, the Ignition-is-the-read-path rule).
  Enrichment flows the *other* way: from the connector into MIRA's graph via the gate.
  Trying to set `READ_WRITE` on a SCADA connector does not enable plant writes — the
  override is intentional and tested (`tests/test_ignition_mock.py::test_export_refused_read_only`).

Dry-run (`#8`) sits above all of this: when `dry_run=True`, even a writable connector
returns `ExportResult(planned=N)` and performs no side effects.

---

## 6. Mock connectors (capability #9)

Fixture-backed, no network, `is_mock = True`. They unblock every downstream phase without a
live Maximo/Ignition and serve as the reference implementation of each type.

### `MaximoMockConnector` — `mocks/maximo_mock.py` + `fixtures/maximo.json`

Realistic IBM Maximo (MAS 8) data with **native field names**: `ASSETNUM`, `LOCATION`,
`PARENT`, `MANUFACTURER`, `SERIALNUM`, `CUSTOM.MODELNUM` (Maximo has no native model field —
modeled as a custom attribute, as real sites do); `WORKORDER` with `WONUM` / `WORKTYPE` /
`STATUS` (WAPPR/APPR/INPRG/COMP/CLOSE) / `FAILUREREPORT` (FAILURECODE→PROBLEM→CAUSE→REMEDY);
`PM` (PMNUM/FREQUENCY/FREQUNIT/JPNUM/NEXTDATE); `METER` (METERNAME/MEASUREUNITID/METERTYPE);
`INVENTORY`/`SPAREPART`; `FAILURELIST` hierarchy; `DOCLINKS`. Models the **Bedford** plant
(Line 16 conveyor, DuraPulse GS10 VFD, 1HP motor, PE photo-eye) so the demo flywheel lines
up with MIRA's Lake Wales bench.

Derived relationships: `HAS_COMPONENT` (PARENT), `LOCATED_IN` (LOCATION), `HAS_DOCUMENT`
(DOCLINKS), `OCCURS_ON` (failure code ↔ asset, evidence = the work order).

### `IgnitionMockConnector` — `mocks/ignition_mock.py` + `fixtures/ignition.json`

Realistic Ignition 8.1 tag export: provider `[default]`, `Lake_Wales/Bench/Conveyor/...`
folder hierarchy, OPC tags bound to a Modbus device (`Mira_PLC`, register map mirroring
`plc/MbSrvConf_v4.xml` — DC bus `HR400110`), with `dataType` (Float8/Int4/Boolean),
`opcItemPath`, `engUnit`, `deadband`, `historyEnabled`, and alarms. Flattens the tree into
`CanonicalTag` rows; derives `HAS_SIGNAL` (asset folder → tags) and `LOCATED_IN` (folder
hierarchy). Read-only — `export_records` refuses.

### `SAPMockConnector` — `mocks/sap_mock.py` + `fixtures/sap.json`

A second CMMS provider (`provider="sap"`). Native SAP PM field names: functional locations
`TPLNR` (with `TPLMA` = superior FL, `FLTYP`), equipment masters `EQUNR` (`EQKTX`, `HERST`,
`TYPBZ`, `SERGE`, `HEQUI` parent, `ABCKZ` criticality), maintenance orders `AUFNR`
(`AUART`→work_type, `ANLZU`→status), task lists `PLNNR`/`PLNAL`→PM, and BOM lines `MATNR`.
Hierarchy walks the `TPLNR` functional-location tree. Derived edges: `HAS_COMPONENT`
(`HEQUI`), `LOCATED_IN` (`TPLNR`), `HAS_PART` (BOM/STPO). Write-back (maintenance orders)
targets the SAP API, gated read-only by default.

### `MaintainXMockConnector` — `mocks/maintainx_mock.py` + `fixtures/maintainx.json`

`provider="maintainx"`, in MaintainX's REST response shape — the same `assets` /
`workOrders` / `locations` / `parts` envelopes the live `mira-mcp/cmms/maintainx.py` adapter
already parses. Numeric ids, `parentId`/`locationId`, `categories[]` (REACTIVE→corrective,
PREVENTIVE→preventive), `status` (DONE→COMPLETE). The factory registry comments anticipate a
real `MaintainXConnector` that simply wraps `MaintainXCMMS`. Derived edges: `HAS_COMPONENT`,
`LOCATED_IN`, `HAS_PART` (`part.assetIds`).

### `PIMockConnector` — `mocks/pi_mock.py` + `fixtures/pi.json`

Reference **historian** connector (`provider="pi"`, `ConnectorKind.HISTORIAN`). AVEVA PI / AF
data: AF element hierarchy (`Path`/`Parent`/`Template`) → `CanonicalAsset`; PI points
(`\\server\tag`, `PointType`, `EngUnits`) → `CanonicalTag` (`history_enabled=True`,
archived-value summary in `attributes`); archived values roll up into `CanonicalMeter`. Event
frames are preserved on the owning element's `attributes` and surfaced in `discover()`; a
safety-template event frame (E-stop) flags the element `criticality="safety_critical"`.
Derived edges: `HAS_COMPONENT` (AF hierarchy), `HAS_SIGNAL` (element → point). **Read-only by
construction** — historian `export_records` refuses regardless of mode (the high-frequency
sample firehose belongs to the relay/event-stream layer, Phase 5 — not this connector).

---

## 7. Adding a real connector

1. Subclass the right type base (`CMMSConnector`, `SCADAConnector`, …).
2. Implement `configured`, `health_check`, `discover`, `import_records`, `normalize`.
   Keep `normalize`/`derive_relationships` identical to the mock where possible — only the
   IO layer (`import_records`) changes.
3. For CMMS/Document write-back, override `_do_export` (NOT `export_records` — the base
   guards mode/dry-run for you). Plant-facing types must not override the refusal.
4. Pull secrets from Doppler-managed env vars in `__init__` (never store plaintext in
   `ConnectorConfig`). Set `configured` from their presence — same as `CMMSAdapter`.
5. Register it in `factory._REGISTRY`.
6. Add a fixture-backed test mirroring `tests/test_maximo_mock.py`.

---

## 8. Testing

`mira-connectors/tests/` — 79 tests, offline (in-memory, no DB, no network):

- `test_canonical.py` — relationship/evidence validation (self-loop with kind-awareness,
  unknown type, missing evidence, confidence bounds).
- `test_base_connector.py` — read-only refusal, dry-run planning, READ_WRITE export,
  SCADA refusal even in READ_WRITE, `sync()` structured result, validation errors/warnings.
- `test_maximo_mock.py` / `test_ignition_mock.py` / `test_sap_mock.py` /
  `test_maintainx_mock.py` / `test_pi_mock.py` — full import→normalize→derive→export
  lifecycle per connector (CMMS write-back gating; historian/SCADA read-only by construction).
- `test_factory.py` — provider registry (all five mock providers).

Run: `cd mira-connectors && pytest` (asyncio auto-mode from `pyproject.toml`).

---

## 9. Relationship to the master plan

This framework is a **parallel workstream** to the 14-phase master plan
(`docs/plans/2026-06-01-mira-master-architecture-plan.md`). It does not touch `engine.py`,
the shared modules, or any governed migration — it is a new top-level package. Where it
overlaps:

- The confirmation gate (Phase 6 of *this* brief) reuses `ai_suggestions` /
  `relationship_proposals` and is designed to **delegate to ADR-0017's
  `proposal_transition.py` once that helper lands** (master-plan Phase 3 / Agent 4). Until
  then the gate keeps its transition logic connector-local. See the gate doc.
- A future `IgnitionConnector` complements (does not replace) `mira-relay`'s live tag
  stream: the connector imports the *tag catalog / definitions*; the relay carries *live
  values + events* (master-plan Phases 4–5).
