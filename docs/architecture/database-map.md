# MIRA Database Map

**Sources:** `mira-hub/db/migrations/001–037` (Hub-authoritative, run by `apply-migrations.yml`); `docs/migrations/001–008` (engine-side, NOT run by CI); migration header comments (cited by file name); memory entries for production schema divergence.
**Adjacent docs:** `docs/environments.md` (NeonDB branch names); `docs/adr/0013-uns-namespace-builder-schema-canonicalization.md` (Hub-is-authoritative ruling).

---

## Storage systems

MIRA uses two separate persistence systems. They are NOT connected to each other.

### 1. NeonDB (PostgreSQL-as-a-service)

Project: `divine-heart-77277150`

| Environment | Branch | Branch ID | Pooler endpoint |
|---|---|---|---|
| Production | `br-lively-bread-ahoa86se` | — | ep-lively-bread (pooler) |
| Staging | `br-small-term-ahtkz61d` | — | `ep-polished-hall-ahcqtcxe-pooler` |
| Development | ep-lingering-salad (re-wired 2026-05-30; was mis-wired to prod) | — | — |

Source: `docs/environments.md` + memory `project_neon_env_state`.

Connection: `src/lib/db.ts` in mira-hub uses `NEON_DATABASE_URL` with a 5-connection `pg.Pool` + SSL. Every API query must go through `withTenantContext()` in `src/lib/tenant-context.ts` — bypassing it skips RLS and leaks cross-tenant data (mira-hub/CLAUDE.md "What not to break" §1).

Role: `factorylm_app` (drops to this role for RLS). Pipeline services (`mira-bots`, `mira-pipeline`) connect as `neondb_owner`, bypassing RLS.

### 2. SQLite WAL (`mira.db`)

Location: `/opt/mira/data/mira.db` on VPS, `mira-bridge/data/` locally.
Managed by: `mira-bots/shared/` (conversation state, session state).
**This is completely separate from NeonDB** — it is NOT mirrored, NOT backed up by apply-migrations.yml, and not covered by any RLS.

Stores: `conversation_state`, active session data for the diagnostic engine.
Schema location: ⚠️ UNVERIFIED — schema file not located during this audit. See `mira-bots/shared/` for DDL.

---

## Two migration lineages

| Lineage | Path | Run by CI? | Authoritative for |
|---|---|---|---|
| Hub migrations | `mira-hub/db/migrations/001–037` | YES — `apply-migrations.yml` | All user-facing tables: proposals, wizard, readiness, command center, sessions, signals, tags |
| Engine migrations | `docs/migrations/001–008` | **NO** — must be run manually | `knowledge_entries`, `fault_codes`, `kg_dedup_state`, `kg_entities`*, `kg_relationships`* |

*`kg_entities` and `kg_relationships` exist in BOTH lineages. The live prod schema was created by Hub migration `001_knowledge_graph.sql` and subsequent Hub alterations — NOT by `docs/migrations/004_kg_entities.sql` or `005_kg_relationships.sql`. The engine-side migrations 004+005 are **aspirational** (planned columns not yet in prod). The live `kg_relationships` schema uses columns `source_id`, `target_id`, `relationship_type` from Hub-001 — NOT the column names in `docs/migrations/005_kg_relationships.sql`. This mismatch caused a production bug fixed in PR #1443 (kg_writer.py was writing wrong column names). See memory `project_kg_relationships_schema`.

**Collision numbers exist:** migrations 006, 021, 025, 026, 027, 032, 033 each have two files with the same prefix. The ordering check `bun run db:check-order` (`db/check-migration-order.mjs`) is the gate. Always run it before adding a migration. New migration slots start at **038** (slots 032–037 consumed by DT/tag branch per mira-hub/CLAUDE.md).

---

## Hub migration table inventory (`mira-hub/db/migrations/`)

### Core KG tables (Hub 001 `001_knowledge_graph.sql`)

| Table | Writer | Reader | Display |
|---|---|---|---|
| `kg_entities` | `mira-crawler/ingest/kg_writer.py` (`upsert_entity()`); Hub API routes | `mira-bots/shared/neon_recall.py`; KG read layer `mira-hub/src/lib/knowledge-graph/queries.ts` | Hub `/knowledge` map (react-force-graph-2d, PR #1688) |
| `kg_relationships` | `mira-crawler/ingest/kg_writer.py` (`upsert_relationship()`); `mira-hub/src/lib/knowledge-graph/proposals-writer.ts` | `mira-hub/src/lib/knowledge-graph/queries.ts` | Hub `/knowledge` map; `/proposals` |
| `kg_triples_log` | Internal audit trigger | — | — |
| `equipment_entities` | Hub API; enrichment worker | KG queries, UNS resolver | Hub `/namespace` asset list |

**Live prod schema note:** `kg_relationships` columns in prod are `source_id`, `target_id`, `relationship_type` (Hub-001 shape). The `docs/migrations/005_kg_relationships.sql` columns are planned, not applied. If you query `kg_relationships` directly, use Hub-001 column names.

### Agent events (Hub 002 `002_agent_events.sql`)

| Table | Writer | Reader | Display |
|---|---|---|---|
| `agent_events` | Safety alert system | Immutable compliance record | — |

Append-only. `factorylm_app` gets SELECT, INSERT only (per migration comment).

### Asset enrichment (Hub 004 `004_asset_enrichment.sql`)

| Table | Writer | Reader | Display |
|---|---|---|---|
| `asset_enrichment_reports` | Enrichment worker | — | ⚠️ UNVERIFIED — surface not identified in migration header |

One row per asset per enrichment run.

### CMMS config (Hub 008 `008_tenant_cmms_config.sql`)

| Table | Writer | Reader | Display |
|---|---|---|---|
| `tenant_cmms_config` | Signup provisioning | CMMS deep-link routing | — |

### Knowledge entries (engine migration `docs/migrations/001_knowledge_entries.sql`)

| Table | Writer | Reader | Display |
|---|---|---|---|
| `knowledge_entries` | `mira-core/mira-ingest/db/neon.py` | `mira-bots/shared/neon_recall.py` | — (BM25 search, not a UI table) |

Source: migration header comment in `docs/migrations/001_knowledge_entries.sql`. **This is the engine lineage, NOT run by apply-migrations.yml.**

### Fault codes (engine migration `docs/migrations/002_fault_codes.sql`)

| Table | Writer | Reader | Display |
|---|---|---|---|
| `fault_codes` | Engine reads/writes | Engine | ⚠️ UNVERIFIED |

### Relationship proposals (Hub 018 `018_relationship_proposals.sql`)

| Table | Writer | Reader | Display |
|---|---|---|---|
| `relationship_proposals` | `mira-hub/src/lib/knowledge-graph/proposals-writer.ts` | Hub API `/proposals` | Hub `/proposals` page |
| `relationship_evidence` | Same as above | Hub API | Hub `/proposals` page |

### Troubleshooting sessions + live signal events (Hub 019 `019_sessions_and_signals.sql`)

| Table | Writer | Reader | Display |
|---|---|---|---|
| `troubleshooting_sessions` | Engine/bot layer creates on namespace confirmation | Hub `/api/mira/ask` reads `status='confirmed'` before allowing LLM call | ⚠️ UNVERIFIED UI surface |
| `live_signal_events` | Demo simulator (`POST /api/demo/signals/toggle`) | Tablet polling latest | Demo tablet view |

`simulated` defaults `TRUE` in `live_signal_events`. Never mix with real telemetry.

### Live signal cache (Hub 020 `020_signal_cache_and_trends.sql`)

| Table | Writer | Reader | Display |
|---|---|---|---|
| `live_signal_cache` | Demo simulator writes (simulated=true default) | Command Center freshness | Command Center HMI |

### Namespace builder tables (Hub 021 `021_namespace_builder.sql`)

| Table | Writer | Reader | Display |
|---|---|---|---|
| `health_scores` | `mira-hub/src/lib/health-score.ts` | `/feed` display | Hub `/feed` |
| `wizard_progress` | Phase-3 wizard UI | `health-score.ts` checks `wizard_completed` | Hub `/namespace` wizard |
| `namespace_versions` | Drag-drop endpoint | Audit trail | — |

### AI suggestions (Hub 027 `027_ai_suggestions.sql`)

| Table | Writer | Reader | Display |
|---|---|---|---|
| `ai_suggestions` | `mira-hub/src/lib/knowledge-graph/proposals-writer.ts` | Hub `/proposals` page | Hub `/proposals` |

**Glossary:** An `AISuggestion` is one row in `ai_suggestions` — the unit `/proposals` renders and what "N proposals pending" counts. Six `suggestion_type` values. Never call this "the proposal table" — always name it `ai_suggestions` explicitly (`.claude/CLAUDE.md` Glossary discipline).

### Wiring connections (Hub 026 `026_wiring_connections.sql`)

| Table | Writer | Reader | Display |
|---|---|---|---|
| `wiring_connections` | Structured imports OR `ai_suggestions` for LLM-derived rows | KG / diagnosis | ⚠️ UNVERIFIED |

### Tag entities (Hub 025 `025_tag_entities.sql`)

| Table | Writer | Reader | Display |
|---|---|---|---|
| `tag_entities` | Hub API / UNS builder | UNS resolver | Hub `/namespace` |

Semantic tag catalog: UNS path → PLC address, data type, units, envelope. **Distinct from `approved_tags`** (allowlist keyed by raw source path before UNS resolution).

### Display endpoints (Hub 030 `030_display_endpoints_registry.sql`)

| Table | Writer | Reader | Display |
|---|---|---|---|
| `display_endpoints` | Hub API (CRUD) | Command Center tree | Hub `/command-center` |

### Ignition audit log (Hub 031 `031_ignition_audit_log.sql`)

| Table | Writer | Reader | Display |
|---|---|---|---|
| `ignition_audit_log` | Ignition HMAC collector | ⚠️ UNVERIFIED | ⚠️ UNVERIFIED |

Append-only. PII-sanitized (IP/MAC/SN scrubbed at write time).

### Decision traces (Hub 032 `032_decision_traces.sql`)

| Table | Writer | Reader | Display |
|---|---|---|---|
| `decision_traces` | Engine troubleshooting path (PII-sanitized at write time) | ⚠️ UNVERIFIED (future Hub `/decision-traces` admin page planned) | Not yet shipped |

Append-only. `factorylm_app` gets SELECT, INSERT only. `REVOKE UPDATE, DELETE ON decision_traces FROM PUBLIC` in migration.

### Tag events (Hub 033 `033_tag_events.sql`)

| Table | Writer | Reader | Display |
|---|---|---|---|
| `tag_events` | `mira-relay` `POST /api/v1/tags/ingest` | Command Center freshness (Phase 4); future tag-history MCP tools | Command Center |

Production ingestion stream. One row per accepted tag reading. Append-only. `simulated` defaults `FALSE` (production-first — opposite of `live_signal_events`).

### Flaky input signals (Hub 034 `034_flaky_input_signals.sql`)

| Table | Writer | Reader | Display |
|---|---|---|---|
| `flaky_input_signals` | Future Phase-9 detector job (not yet implemented) | Hub proposals reviewer queue | Hub `/proposals` |

Table exists now as a stable target for the future detector. Status lifecycle: `open → acknowledged → resolved → false_positive`.

### Approved tags (Hub 035 `035_approved_tags.sql`)

| Table | Writer | Reader | Display |
|---|---|---|---|
| `approved_tags` | Seeding step / admin writes (46-row JSON file not yet migrated) | `mira-relay` `POST /api/v1/tags/ingest` enforces allowlist | — |

Security allowlist. Distinct from `tag_entities` (semantic catalog). See migration header for dual-write window notes. `factorylm_app` gets SELECT, INSERT, UPDATE (soft disable via `enabled=false`).

### Current tag state / freshness (Hub 036 `036_current_tag_state_freshness.sql`)

| Table | Writer | Reader | Display |
|---|---|---|---|
| `live_signal_cache` *(the "current_tag_state" concept)* | Upsert on every ingest (`tag_ingest.py`) + demo simulator | Command Center freshness badge | Command Center |

⚠️ **There is no standalone `current_tag_state` table.** The gap-closure plan named a `current_tag_state` store; migration 036 satisfies it by **extending the existing `live_signal_cache`** (created Hub 020) with four freshness columns (`uns_path`, `source_system`, `latest_quality`, `freshness_status`) — `ADD COLUMN IF NOT EXISTS`, no new table, no PK change. Always read/write `live_signal_cache`. Latest-value cache (one row per tag per tenant); distinct from append-only `tag_events`.

### Tag event diffs (Hub 037 `037_tag_event_diffs.sql`)

| Table | Writer | Reader | Display |
|---|---|---|---|
| `tag_event_diffs` | Phase-5 diff logger (rising_edge / falling_edge / value_changed) | ⚠️ UNVERIFIED | ⚠️ UNVERIFIED |

Derived from raw `tag_events` stream. Meaningful-diff layer.

---

## RLS coverage

Every Hub table listed above has `ENABLE ROW LEVEL SECURITY` with a `USING (tenant_id = current_setting('app.tenant_id', true)::UUID OR tenant_id = current_setting('app.current_tenant_id', true)::UUID)` policy. The dual-setting form (two names, one value) is a legacy-parity pattern — both must be set.

**Notable exception: `hub_uploads`** has NO RLS under `factorylm_app`. Joins to `hub_uploads` silently return nothing when queried via the app role. Subtree retrieval reads `knowledge_entries.metadata->>'node_id'` instead. Source: PR #1592 Slice 3 + memory `project_hub_uploads_no_rls`.

---

## What can go wrong

| Failure mode | Details |
|---|---|
| **Column-name mismatch in `kg_relationships`** | Live prod uses `source_id`/`target_id`/`relationship_type` (Hub-001). Engine migration 005 aspirational columns differ. Bug fixed in PR #1443 — re-verify if anything directly queries this table. |
| **Applying engine migrations via apply-migrations.yml** | The workflow only reads `mira-hub/db/migrations/`. Engine migrations in `docs/migrations/` must be applied manually. |
| **Migration number collision** | Duplicate prefixes exist (006, 021, 025, 026, 027, 032, 033). Always run `bun run db:check-order` before adding a migration. New slots start at 038. |
| **hub_uploads RLS gap** | Queries joining `hub_uploads` via `factorylm_app` return empty results silently. Use `knowledge_entries.metadata->>'node_id'` for subtree lookups. |
| **SQLite not backed up** | `mira.db` holds live conversation state. It is on the VPS filesystem only — no NeonDB failover. Loss = all in-progress session context. |
| **Staging Neon branch** | Dev was mis-wired to prod endpoint until 2026-05-30 (fixed — re-wired to ep-lingering-salad). Always verify `NEON_DATABASE_URL` points to the correct branch before running migrations or seeds. |
| **Seeding to prod before staging** | `knowledge_entries` BM25 retrieval was broken May 2026 when an embedding gate silently returned `[]`. Seeds must be verified on staging first (see PR #1385 history). |
