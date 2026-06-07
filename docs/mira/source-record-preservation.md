# MIRA — Source-Record Preservation Layer

**Status:** Phase 2 deliverable of the canonical-asset-graph initiative — **design + additive
schema proposals (docs-only)**
**Authored:** 2026-06-02
**Owner:** Lead architect (MIRA)
**Builds on:** `docs/mira/current-repo-inventory.md` · `docs/mira/canonical-asset-graph.md`
**Defines:** the FK target (`source_objects`) that `kg_entities.source_object_id` points at

---

## 0. The problem in one sentence

Today, raw imported records survive in exactly one place — **`cmms_sync_conflicts.atlas_payload`**
(Hub 007) — and only **on conflict**, only for **Atlas**. Every successful import normalizes
straight into `cmms_equipment` and **discards the original record.** That violates the rule
"never destroy original customer fields" and makes "remap if the schema changes" impossible:
once normalized, the source row is gone.

This layer fixes that for **every connector** (Maximo, SAP, MaintainX, Fiix, Ignition, MQTT/
Sparkplug, OPC UA, historian, manuals, CSV exports) by storing the **raw record before
normalization**, immutably enough to remap, with full connector provenance.

---

## 1. Design principles

1. **Store raw, then map — never map-and-discard.** The connector's job is to *land* the record;
   normalization is a separate, re-runnable step that reads from the stored raw record.
2. **One mechanism, all connectors.** `cmms_sync_conflicts.atlas_payload` is the right idea at the
   wrong scope. Generalize it: any source, any object type, happy path *and* conflict.
3. **The graph references the source, not vice-versa.** `kg_entities.source_object_id` →
   `source_objects.id` (the FK proposed in `canonical-asset-graph.md` mig 039). The source layer
   is upstream; the graph is downstream and re-derivable.
4. **Remapping is re-reading, not re-fetching.** A schema/mapping change re-runs the mapper over
   stored `raw_payload` — no second call to the customer's Maximo. `content_hash` dedups re-imports.
5. **Tenant-isolated, RLS-enabled** — same posture as `kg_entities` (Hub 001 RLS), *unlike*
   `hub_uploads` (which has no RLS — a known footgun; don't repeat it here).

---

## 2. The three tables

```
source_systems       1 ──< source_import_runs       1 ──< source_objects >── 1  kg_entities
(connected external      (one connector execution)       (one raw record)       (mapped node)
 system per tenant)                                        mapped_entity_id ─────────┘
```

### 2.1 `source_systems` — registry of connected external systems

The FK target for `entity_type='external_system'` (canonical-graph §2). One row per
tenant×connected-system (a specific Maximo instance, a MaintainX account, an Ignition gateway, an
OPC UA endpoint). Supersedes the implicit single-CMMS assumption in `tenant_cmms_config`.

### 2.2 `source_import_runs` — one row per connector execution

Generalizes `cmms_sync_state` (which is just a cursor) into a full run record: connector name +
**version**, window, counts, status, errors. This is where requirement 2 (import timestamp,
connector version, errors/warnings) lives at batch granularity; `source_objects` carries it at
record granularity.

### 2.3 `source_objects` — the raw imported record (the core)

Generalizes `cmms_sync_conflicts` to all sources and the happy path. **This is the table that
"never destroys original customer fields."**

---

## 3. Additive schema proposals (docs-only — do NOT write migration files)

Slots 032–037 consumed by the DT branch; `canonical-asset-graph.md` proposes 038/039. This doc
proposes **040–042**. Proposals for review — author real files only after sign-off and after
re-checking the live migration tail (`ls mira-hub/db/migrations/ | tail`).

```sql
-- 040_source_systems.sql  (PROPOSAL)
CREATE TABLE IF NOT EXISTS source_systems (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  system_kind     TEXT NOT NULL,          -- 'maximo'|'sap'|'maintainx'|'fiix'|'limble'|'atlas'
                                          -- |'ignition'|'mqtt_sparkplug'|'opcua'|'historian'
                                          -- |'manual_upload'|'csv_export'|'plc_bridge'
  display_name    TEXT NOT NULL,          -- "Plant 2 Maximo", "MaintainX (East)"
  external_base   TEXT,                   -- base URL / broker / gateway id (no secrets here)
  config          JSONB DEFAULT '{}',     -- non-secret connector config; secrets stay in Doppler
  uns_root        ltree,                  -- optional: where this system's objects attach by default
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','paused','disconnected','error')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, system_kind, display_name)
);
CREATE INDEX IF NOT EXISTS idx_source_systems_tenant ON source_systems (tenant_id);
ALTER TABLE source_systems ENABLE ROW LEVEL SECURITY;
CREATE POLICY source_systems_tenant ON source_systems
  USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- 041_source_import_runs.sql  (PROPOSAL)
CREATE TABLE IF NOT EXISTS source_import_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  source_system_id  UUID NOT NULL REFERENCES source_systems(id) ON DELETE CASCADE,
  connector_name    TEXT NOT NULL,        -- 'mira-mcp/cmms/maintainx.py' etc.
  connector_version TEXT NOT NULL,        -- semver/git-sha of the adapter that produced this run
  object_type       TEXT,                 -- NULL = mixed/full sync; else the resource swept
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running','succeeded','partial','failed')),
  cursor_before     JSONB,                -- replaces cmms_sync_state.last_poll_at, generalized
  cursor_after      JSONB,
  objects_seen      INT NOT NULL DEFAULT 0,
  objects_new       INT NOT NULL DEFAULT 0,
  objects_updated   INT NOT NULL DEFAULT 0,
  errors            JSONB DEFAULT '[]',   -- [{external_object_id, stage, message}]
  warnings          JSONB DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_import_runs_system ON source_import_runs (source_system_id, started_at DESC);
ALTER TABLE source_import_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY source_import_runs_tenant ON source_import_runs
  USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- 042_source_objects.sql  (PROPOSAL) — the raw record store
CREATE TABLE IF NOT EXISTS source_objects (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  source_system_id  UUID NOT NULL REFERENCES source_systems(id) ON DELETE CASCADE,
  object_type       TEXT NOT NULL,        -- 'asset'|'work_order'|'pm'|'location'|'part'
                                          -- |'tag'|'opcua_node'|'manual'|'fault'...
  external_object_id TEXT NOT NULL,       -- the source system's own ID for this record
  raw_payload       JSONB NOT NULL,       -- ORIGINAL record, unmodified. requirement 4.
  content_hash      TEXT NOT NULL,        -- sha256 of canonicalized raw_payload (re-import dedup)
  first_import_run_id UUID REFERENCES source_import_runs(id) ON DELETE SET NULL,
  last_import_run_id  UUID REFERENCES source_import_runs(id) ON DELETE SET NULL,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  connector_version TEXT NOT NULL,        -- version that last wrote raw_payload
  mapping_status    TEXT NOT NULL DEFAULT 'unmapped'
                      CHECK (mapping_status IN
                        ('unmapped','mapped','conflict','stale','superseded','error')),
  mapped_entity_id  UUID,                 -- -> kg_entities(id) when normalized; reverse of
                                          --    kg_entities.source_object_id (canonical-graph mig 039)
  mapping_errors    JSONB DEFAULT '[]',   -- requirement 2: per-record warnings/errors
  mapped_at         TIMESTAMPTZ,
  mapped_by         TEXT,                 -- 'llm'|'rule'|'human'|connector name
  UNIQUE (tenant_id, source_system_id, object_type, external_object_id)
);
CREATE INDEX IF NOT EXISTS idx_source_objects_lookup
  ON source_objects (tenant_id, source_system_id, object_type, external_object_id);
CREATE INDEX IF NOT EXISTS idx_source_objects_mapped
  ON source_objects (tenant_id, mapped_entity_id) WHERE mapped_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_source_objects_status
  ON source_objects (tenant_id, mapping_status) WHERE mapping_status IN ('unmapped','conflict','error');
ALTER TABLE source_objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY source_objects_tenant ON source_objects
  USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- 042b_ai_suggestions_source_object.sql  (PROPOSAL — ships with 042)
-- ai_suggestions.source_kind has a CHECK (Hub 027). To let a suggestion cite a raw source
-- record (§5), extend it — same DROP/ADD pattern as the relationship_type CHECK in
-- canonical-asset-graph.md proposal 038. Without this, source_kind='source_object' fails the CHECK.
ALTER TABLE ai_suggestions DROP CONSTRAINT IF EXISTS ai_suggestions_source_kind_check;
ALTER TABLE ai_suggestions
  ADD CONSTRAINT ai_suggestions_source_kind_check
  CHECK (source_kind IS NULL OR source_kind IN (
    -- existing 9 (Hub 027) ...
    'knowledge_entry','work_order','tag_entity','photo','session',
    'manifest_row','technician_note','live_event','manual_entry',
    -- NEW: a suggestion can cite the preserved raw record it was derived from
    'source_object'
  ));

-- OPTIONAL 043_source_object_versions.sql  (PROPOSAL, defer until drift auditing is needed)
-- Append-only history when raw_payload changes between imports, for true immutability /
-- schema-drift forensics. Until requested, the upsert in §4 just refreshes raw_payload +
-- last_seen_at; content_hash tells you whether it changed.
```

---

## 4. Lifecycle (how the four requirements are satisfied)

```
CONNECTOR RUN
  source_import_runs row opened (connector_name + version, cursor_before)         [req 2: batch]
        │
        ▼  for each external record:
  compute content_hash(raw_payload)
  UPSERT source_objects ON (tenant_id, source_system_id, object_type, external_object_id):
     - new            → INSERT raw_payload, mapping_status='unmapped'              [req 1,4]
     - unchanged hash → bump last_seen_at, last_import_run_id (raw kept)           [req 4]
     - changed hash   → refresh raw_payload + connector_version, mapping_status='stale'
                        (+ optional source_object_versions append)                 [req 3,4]
        │
        ▼  NORMALIZE (separate, re-runnable step — reads raw_payload only)         [req 3]
  mapper(raw_payload, connector_version) → upsert kg_entities (+ typed projection)
     - set kg_entities.source_object_id = this row        (canonical-graph mig 039)
     - set source_objects.mapped_entity_id = node id, mapping_status='mapped'
     - parse failure → mapping_status='error', mapping_errors=[...]               [req 2]
     - newer-than-graph → mapping_status='conflict' (replaces cmms_sync_conflicts) [req 2]
        │
        ▼  REMAP (schema/mapping change, NO re-fetch)                             [req 3]
  re-run mapper over stored raw_payload for all rows where
     connector_version < current OR mapping_status IN ('stale','error')
  → new/updated kg_entities, mapping_status back to 'mapped'
        │
        ▼
  source_import_runs row closed (status, counts, cursor_after)                    [req 2]
```

- **Requirement 1 (source system, object type, object ID, payload):** `source_objects`
  (`source_system_id` → `source_systems.system_kind`, `object_type`, `external_object_id`,
  `raw_payload`).
- **Requirement 2 (timestamp, connector version, mapping status, errors/warnings):**
  `source_import_runs` (batch) + `source_objects.{connector_version, mapping_status,
  mapping_errors, first/last_seen_at}` (record).
- **Requirement 3 (remap on schema change):** the REMAP step re-reads `raw_payload`; no re-fetch.
  Triggered by `connector_version` drift or `mapping_status IN ('stale','error')`.
- **Requirement 4 (never destroy originals):** `raw_payload` is the unmodified record; normalize
  reads from it and never overwrites it with normalized data. Optional
  `source_object_versions` adds full immutability when drift forensics are needed.

---

## 5. Relationship to what already exists (subsume, don't duplicate)

| Existing | New role |
|---|---|
| `cmms_sync_conflicts.atlas_payload` (Hub 007) | special case → `source_objects` rows with `mapping_status='conflict'`. Migrate Atlas conflicts into the general table; keep the view name for back-compat if callers read it. |
| `cmms_sync_state` (Hub 007) | cursor bookkeeping → `source_import_runs.cursor_before/after`. |
| `cmms_equipment` external-ID columns (Hub 013) | **derived** from `source_objects` (a node's external IDs = the `external_object_id`s of its mapped source rows). Keep columns as a denormalized read cache; source layer is authoritative. |
| `ai_suggestions.source_kind/source_id` (Hub 027) | add `source_kind='source_object'` so a suggestion can cite the raw record it came from — **requires extending the Hub-027 `source_kind` CHECK** (proposal 042b in §3). |
| `tenant_cmms_config` (Hub 008) | folds into `source_systems` (one CMMS = one `source_systems` row of the matching `system_kind`). |
| `component_template_sources` (Hub 016) | unchanged — it cites *documents*; orthogonal to connector records. |

---

## 6. What this explicitly does NOT do

- ❌ Does not change any connector adapter's external API calls (Phase 2 of the master plan owns
  the ingest API; this is the storage shape it writes into).
- ❌ Does not write migration files — proposals only, slots 040–042 (043 deferred).
- ❌ Does not make `source_objects` a graph node — it is upstream raw data; the graph references
  it by FK.
- ❌ Does not store secrets in `source_systems.config` — secrets remain Doppler-managed.
- ❌ Does not add a parallel provenance scheme — this *is* the single mechanism
  `canonical-asset-graph.md` §4.1 points `kg_entities.source_object_id` at.

---

## 7. Acceptance (when this layer is "real")

1. Import a MaintainX asset → a `source_objects` row holds the unmodified MaintainX JSON; a
   `kg_entities` row has `source_object_id` pointing at it; `cmms_equipment` external IDs match.
2. Re-run the same import → no duplicate row (content_hash dedup); `last_seen_at` bumped.
3. Change the mapper, run REMAP → graph node updates from stored `raw_payload` with **zero**
   calls to the customer's MaintainX.
4. A parse failure lands `mapping_status='error'` + `mapping_errors`, and the raw record is still
   present and retryable.
5. RLS: a query without `app.current_tenant_id` set returns zero rows from all three tables.

---

## 8. Open questions (decide before authoring migrations)

1. **`source_object_versions` now or deferred?** Proposal: defer until a connector's schema
   actually drifts in production (YAGNI; content_hash already detects change).
2. **`raw_payload` size ceiling.** Maximo/SAP records can be large; cap + offload oversized
   payloads (e.g. full manuals) to blob storage with a pointer? Manuals already go to
   `knowledge_entries`, so `source_objects` should hold *structured* records, not document bodies.
3. **Conflict resolution UX.** `mapping_status='conflict'` should surface in Hub `/proposals` as
   an `ai_suggestions` row — confirm the reviewer flow before wiring.
4. **Backfill of existing `cmms_sync_conflicts`.** One-time migration into `source_objects`, or
   leave historical conflicts in place and start fresh? (Lean: start fresh, document the cutover.)

---

## 9. Cross-references

- `docs/mira/canonical-asset-graph.md` §4.1 — the `source_object_id` FK this table backs
- `docs/mira/current-repo-inventory.md` §5 — the connector + sync-state inventory this generalizes
- `docs/plans/2026-06-01-mira-master-architecture-plan.md` — Phase 2 (ingest API), Phase 3 (proposal path)
- ADR-0013 (Hub-canonical schema), ADR-0014 (`ai_suggestions`), ADR-0017 (status transitions)
- `.claude/rules/security-boundaries.md` — RLS / Doppler / no-secrets-in-config posture
- Memory: `project_hub_uploads_no_rls` — why these tables MUST enable RLS
