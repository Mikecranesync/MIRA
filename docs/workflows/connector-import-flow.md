# Connector Import Flow

**One-line:** External system (CMMS/EAM/SCADA/Historian/MQTT) → connector → normalize → canonical model → proposals → human review via Hub `/proposals`.

**Cross-links:**
- `mira-connectors/README.md` — package overview
- `mira-connectors/CLAUDE.md` — key file roles, isolated-image constraint
- `docs/mira/connector-framework.md` — connector contract and read-only doctrine
- `docs/mira/technician-confirmation-gate.md` — gate status mapping
- `docs/adr/0017*` — ADR-0017: status transition helpers
- `.claude/rules/fieldbus-readonly.md` — SCADA/Historian write prohibition
- `docs/workflows/knowledge-graph-flow.md` — where proposals land after confirmation

---

## Summary

Connectors pull raw records from an external system, normalize them to MIRA's canonical model, then route everything through the `ConnectorConfirmationGate` as **pending** `ai_suggestions` rows. Nothing touches `kg_entities` or `kg_relationships` until a technician explicitly confirms via the Hub `/proposals` page or the gate API. Every connector defaults to read-only mode; SCADA and Historian connectors refuse writes by construction regardless of mode.

**Mock status (2026-06-06):** ALL five adapters in `mira-connectors/mira_connectors/mocks/` are MOCKS (`is_mock=True`, fixture-backed, no network). Real adapters have not been built. The pattern is: mock lands first, real connector swaps in by registering the same key in `factory.py`'s `_REGISTRY`.

---

## The Flow

### Step 1 — Connector construction via factory

**File:** `mira-connectors/mira_connectors/factory.py`
**Function:** `create_connector(provider: str, config: ConnectorConfig) -> Connector`

The caller provides a `provider` string (e.g. `"maintainx"`, `"maximo"`, `"sap"`, `"pi"`, `"ignition"`) and a `ConnectorConfig`. The factory looks up the lowercase provider key in `_REGISTRY` and instantiates the connector.

`ConnectorConfig` fields (defined at `mira-connectors/mira_connectors/base.py:63`):
- `tenant_id: str`
- `mode: ConnectorMode` — defaults to `READ_ONLY`
- `dry_run: bool` — defaults to `False`
- `settings: dict` — endpoint, provider-specific options

### Step 2 — Capability discovery (optional pre-flight)

**File:** `mira-connectors/mira_connectors/base.py`
**Method:** `Connector.discover() -> ConnectorCapabilities` (abstract; each adapter implements)

Returns what the source exposes: `ConnectorKind`, `record_types`, `supports_export`, `supports_incremental`, `schema`. Used as a pre-flight check; not required for every import.

### Step 3 — import_records (pull raw vendor records)

**File:** `mira-connectors/mira_connectors/base.py`
**Method:** `BaseConnector.sync(record_type, *, since, limit) -> (list[CanonicalRecord], SyncResult)`  

`sync()` calls in order:
1. `import_records(record_type, since, limit)` — pulls raw `RawRecord` dicts from the external system
2. `normalize(raw)` — maps raw dicts to `CanonicalRecord` subclasses (pure, no IO)
3. `validate_mappings(canonical)` — checks required fields, warns on missing `proposed_uns_path`
4. (Optional) `export_records(canonical)` — guarded by read-only/dry-run checks

`SyncResult` carries: `imported`, `normalized`, `validation_errors`, `validation_warnings`, `exported`, `dry_run`, `mock`, `duration_ms`, `errors`.

**RecordType enum** (`mira-connectors/mira_connectors/canonical.py`):
`ASSET`, `LOCATION`, `TAG`, `WORK_ORDER`, `PM_TASK`, `PART`, `DOCUMENT`, `FAILURE_CODE`, `METER`

### Step 4 — normalize (vendor → canonical)

**File:** `mira-connectors/mira_connectors/canonical.py`
**Function:** `normalize(raw: list[RawRecord]) -> list[CanonicalRecord]` (implemented per connector)

Each concrete connector maps vendor-specific field names to `CanonicalRecord` subclasses:
- `CanonicalAsset` — `name`, `manufacturer`, `model`, `serial`, `proposed_uns_path`, `criticality`
- `CanonicalWorkOrder` — `wo_number`, `description`, `status`, `asset_ref`, `scheduled_date`
- `CanonicalTag` — `tag_id`, `tag_path`, `data_type`, `proposed_uns_path`
- (etc. — one dataclass per RecordType)

Every `CanonicalRecord` carries: `source_system`, `source_record_id`, `confidence` (band), `proposed_uns_path` (CANDIDATE — `uns.py` builders canonicalize on confirm).

**Important:** `proposed_uns_path` set here is a CANDIDATE. The gate re-slugs via `mira-crawler/ingest/uns.py` builders before any DB write.

### Step 5 — derive_relationships (optional cross-record edges)

**File:** `mira-connectors/mira_connectors/base.py`
**Method:** `BaseConnector.derive_relationships(records: list[CanonicalRecord]) -> list[CanonicalRelationship]`

Default returns `[]`. Connectors that understand parent-child relationships (asset→parent, tag→asset, asset→document) override this. Relationships carry `source_ref`, `target_ref`, `relationship_type`, `evidence: list[EvidenceItem]`, `confidence`, `reasoning`.

### Step 6 — import_and_propose (service wiring)

**File:** `mira-connectors/mira_connectors/service.py`
**Function:** `import_and_propose(connector, gate, *, record_types, tenant_id, limit) -> ImportProposeResult` (async)

Thin orchestration:
1. Calls `connector.sync(rt)` for each requested `RecordType`, collecting `CanonicalRecord` list
2. Calls `connector.derive_relationships(all_records)` for edges
3. Filters entities: only `RecordType` values in `_ENTITY_RECORD_TYPES` become KG entity proposals (`ASSET`, `LOCATION`, `TAG`, `DOCUMENT`, `FAILURE_CODE`, `PART`). Work orders, PM tasks, meters are evidence-only.
4. Calls `gate.propose(tenant_id, provider, entities, relationships)`

Returns `ImportProposeResult` with `sync_results`, `propose` (a `ProposeResult` with suggestion IDs), `record_count`, `relationship_count`.

### Step 7 — gate.propose (write pending proposals)

**File:** `mira-connectors/mira_connectors/confirmation_gate.py`
**Class:** `ConnectorConfirmationGate`
**Method:** `propose(*, tenant_id, provider, entities, relationships) -> ProposeResult`

For each entity record → inserts one `ai_suggestions` row (type `kg_entity`, status `pending`, `proposed_by = "import:<provider>"`).

For each relationship → inserts one `relationship_proposals` row (status `proposed`, `created_by = "import"`) + 1..N `relationship_evidence` rows, then wraps with one `ai_suggestions` row (type `kg_edge`, status `pending`).

**Store backend** (`mira-connectors/mira_connectors/store.py`):
- `InMemoryProposalStore` — offline/test only
- `PostgresProposalStore` — NeonDB with `NullPool`; staging-only until validated

The gate also runs `_mark_conflicts()` — groups pending `kg_entity` suggestions by `conflict_key` (serial number or `source_system:record_id`); if two proposals for the same physical device disagree on `uns_path`, they are flagged in `extracted_data.conflict_group` for human resolution.

### Step 8 — Hub /proposals page (human review)

**File:** `mira-hub/src/app/api/proposals/route.ts` (listing) + `mira-hub/src/app/api/proposals/[id]/decide/route.ts` (decision)
**Table read:** `ai_suggestions` (mig `027_ai_suggestions.sql`) with status `pending`

The Hub `/proposals` page renders "N proposals pending" by counting `ai_suggestions` rows with `status='pending'` for the tenant. Humans see:
- `suggestion_type` (`kg_entity`, `kg_edge`, etc.)
- `title`, `body`, `confidence`, `risk_level`
- For `kg_edge`: the linked `relationship_proposals` row's `source_entity_id`/`target_entity_id`/`relationship_type`

### Step 9 — Human decision: confirm / correct / reject

**File:** `mira-connectors/mira_connectors/confirmation_gate.py`

| Action | ai_suggestions | relationship_proposals | kg_* |
|--------|----------------|------------------------|------|
| `gate.confirm()` | `pending → accepted` | `proposed → verified` | upsert kg_entities / kg_relationships |
| `gate.correct()` | original `pending → superseded`; new suggestion created and immediately confirmed | old proposal `proposed → deprecated` | write with corrections |
| `gate.reject()` | `pending → rejected` | `proposed → rejected` | no write |
| Hub "defer" | `pending → deferred` | unchanged | no write — suggestion resurfaces in "ask me later" tab |

`ai_suggestions.status` CHECK (from mig 027): `pending`, `accepted`, `rejected`, `deferred`, `superseded`. The `relationship_proposals.status` vocabulary is DIFFERENT — see §"What Can Go Wrong" §7.

On **confirm of a `kg_entity`**: `_materialize_entity()` upserts into `kg_entities`.
On **confirm of a `kg_edge`**: `_confirm_edge()` sets `relationship_proposals.status = 'verified'`, inserts a `relationship_evidence` row of type `human_observation`, then calls `store.upsert_relationship()` to write into `kg_relationships`.

**Note:** ADR-0017 transition helpers (`mira-hub/lib/proposal-transition.ts` and `mira_bots/shared/proposal_transition.py`) are listed in `confirmation_gate.py:36` as NOT YET EXISTING. The gate's transition logic is connector-local for now.

---

## ASCII Flow Diagram

```
External system (Maximo / MaintainX / SAP / PI / Ignition)
          |
          v
  factory.create_connector(provider, config)     [factory.py]
          |
          v
  connector.sync(record_type)                    [base.py: BaseConnector.sync]
    |
    |-- import_records() ---> raw RawRecord list
    |-- normalize() ---------> CanonicalRecord list (pure, no IO)
    |-- validate_mappings() -> ValidationResult (errors/warnings)
    |
          v
  connector.derive_relationships(records)        [base.py]
    --> list[CanonicalRelationship]
          |
          v
  import_and_propose(connector, gate, record_types)  [service.py]
    |
    |-- filter entities (_ENTITY_RECORD_TYPES)
    |
          v
  gate.propose(tenant_id, provider, entities, relationships)  [confirmation_gate.py]
    |
    |-- per entity:
    |     INSERT ai_suggestions (type=kg_entity, status=pending)
    |
    |-- per relationship:
    |     INSERT relationship_proposals (status=proposed)
    |     INSERT relationship_evidence (1..N rows)
    |     INSERT ai_suggestions (type=kg_edge, status=pending)
    |
    |-- _mark_conflicts() — flag conflicting proposals
    |
          v
  NeonDB tables:
    ai_suggestions          [mig 027_ai_suggestions.sql]
    relationship_proposals  [mig 018_relationship_proposals.sql]
    relationship_evidence   [mig 018_relationship_proposals.sql]
          |
          v
  Hub /proposals page — technician sees pending decisions
          |
    confirm / correct / reject
          |
          v
  gate.confirm() / correct() / reject()
    |
    |-- confirmed entity:  upsert kg_entities
    |-- confirmed edge:    relationship_proposals → verified
    |                      INSERT relationship_evidence (human_observation)
    |                      upsert kg_relationships
    |
          v
  KG now has verified entity / relationship
```

---

## Tables Touched

| Table | DB | Migration | When |
|-------|----|-----------|------|
| `ai_suggestions` | NeonDB (Hub schema) | `mira-hub/db/migrations/027_ai_suggestions.sql` | Step 7: gate writes pending suggestions |
| `relationship_proposals` | NeonDB (Hub schema) | `mira-hub/db/migrations/018_relationship_proposals.sql` | Step 7: edge proposals |
| `relationship_evidence` | NeonDB (Hub schema) | `mira-hub/db/migrations/018_relationship_proposals.sql` | Step 7: evidence rows; Step 9: human_observation on confirm |
| `kg_entities` | NeonDB (Hub schema) | `mira-hub/db/migrations/001_knowledge_graph.sql` | Step 9: entity materialized on confirm |
| `kg_relationships` | NeonDB (Hub schema) | `mira-hub/db/migrations/001_knowledge_graph.sql` | Step 9: edge materialized on confirm |

**Live column names** (prod, not `docs/migrations/` aspirational names):
- `kg_relationships`: `source_id`, `target_id`, `relationship_type` (NOT `source_entity`, `target_entity`, `relation_type`)
- `kg_entities` unique constraint: `(tenant_id, entity_type, name)` (mig 026 altered this)

---

## What Can Go Wrong

### 1. Mock vs. real connector confusion
All five connectors in `mira-connectors/mira_connectors/mocks/` are MOCKS with `is_mock=True`. They read fixtures in `mira_connectors/mocks/fixtures/` — no network calls. `SyncResult.mock=True` in the log is the signal. Shipping a mock connector against prod data means zero real records are pulled.

### 2. Nango credential vault dependency
Real connectors will need Nango (`mira-hub/src/lib/nango.ts`) as the credential vault for CMMS tokens (MaintainX, SAP, PI). Without a Nango-backed connector config, `connector.configured` returns `False` and `sync()` returns immediately with `SyncResult.errors = ["connector not configured"]`. See memory entry `project_nango.md`.

### 3. Isolated connector image can't import `mira-bots/shared`
`mira-connectors/pyproject.toml` has `dependencies = []` — the package is intentionally self-contained. It re-implements NeonDB connect, PII handling, and proposal transitions LOCALLY. Do not add a runtime dependency on `mira-bots/shared`. If you see an `ImportError` for `shared.*` inside a connector, you're violating this boundary. See `mira-connectors/CLAUDE.md` § "Isolated image". This applies especially to the `workflow_durability` integration (memory `project_workflow_durability.md`): relay/connector isolated images can't import `mira-bots/shared`.

### 4. Auto-verify is a bug
`gate.confirm()` is the ONLY path from `proposed → verified`. Any code that sets `kg_relationships.approval_state = 'verified'` or `relationship_proposals.status = 'verified'` via a direct `UPDATE` (bypassing the gate) is a bug per ADR-0017 and `.claude/CLAUDE.md` § "Knowledge graph proposals".

### 5. Candidate UNS path != canonical UNS path
`CanonicalRecord.proposed_uns_path` is a CANDIDATE set by the connector's `normalize()`. The gate's `_materialize_entity()` currently passes it through to `kg_entities.uns_path` as-is. A future wire-up (noted in `confirmation_gate.py:326`) should run it through `mira-crawler/ingest/uns.py` builders before writing. Until that lands, a mis-spelled path from the connector can reach the KG.

### 6. Wrong column names on `kg_relationships`
Historical confusion: `docs/migrations/006_kg_bridge.sql` used `source_entity`/`target_entity`/`relation_type`. PROD uses `source_id`/`target_id`/`relationship_type` (established in `mira-hub/db/migrations/001_knowledge_graph.sql`). This has burned PRs before (see memory `project_kg_relationships_schema`, PR #1443). `kg_writer.py` uses the correct prod names.

### 7. `relationship_proposals` status vocabulary mismatch
`mira-hub/db/migrations/018_relationship_proposals.sql` CHECK constraint allows: `proposed`, `reviewed`, `verified`, `rejected`, `deprecated`, `contradicted`. The gate code writes `proposed`, `verified`, `deprecated`, `rejected`. Do not write `"pending"` to `relationship_proposals.status` — that is an `ai_suggestions` status only.
