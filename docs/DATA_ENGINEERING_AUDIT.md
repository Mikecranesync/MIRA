# Data Engineering Audit — MIRA KB/KG Layer
**Date:** 2026-04-29 | **Branch:** feat/data-hardening | **Scope:** NeonDB KB + KG tables, ingest pipeline, application layer

---

## Part 1: Dedup Test Results

**Test:** Re-ran AB 1606-XLS installation PDF through `full_ingest_pipeline.py` a second time against the same `(tenant_id, source_url)`.

| Layer | Result | Mechanism |
|-------|--------|-----------|
| KB chunks (knowledge_entries) | ✅ 0 new chunks — dedup worked | `chunk_exists()` SELECT guard in `_shared.py:124` |
| KG entities (kg_entities) | ✅ No duplicates | `ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE` |
| KG relationships (kg_relationships) | ❌ **1 DUPLICATE FOUND** | `ON CONFLICT DO NOTHING` without backing UNIQUE index — no-op |

**Root cause of KG relationship duplicate:** PostgreSQL's `ON CONFLICT DO NOTHING` requires either (a) a specific conflict column list matching a unique constraint/index, or (b) a backing constraint on the table. Without `idx_kg_rel_dedup`, the clause was silently ignored. **Fixed in this PR.**

**Production cleanup performed by this migration:**
- `kg_relationships`: 1 duplicate deleted, `idx_kg_rel_dedup` created — `27 → 26` rows
- `knowledge_entries`: **1,690 duplicate chunks deleted** (1,670 duplicate groups, mostly YouTube transcripts ingested 3× by concurrent workers), `idx_ke_chunk_dedup` created — `76,404 → 74,714` rows

---

## Part 2: Data Engineering Audit

### 2.1 Schema Integrity

**Production table count:** 200+ tables in the NeonDB public schema (shared across MIRA, Atlas CMMS, Open WebUI, n8n, and other services).

**KB/KG table inventory:**

| Table | Rows | UNIQUE Constraint | RLS | Notes |
|-------|------|-------------------|-----|-------|
| `knowledge_entries` | 76,404 | ❌ None | ❌ OFF → **Fixed** | App-level only via `chunk_exists()` |
| `kg_entities` | 41 | ✅ `(tenant_id, entity_type, entity_id)` | ✅ ON | Correct |
| `kg_relationships` | 27 | ❌ None → **Fixed** | ✅ ON | `ON CONFLICT DO NOTHING` was no-op |
| `kg_triples_log` | 68 | ❌ None (by design — audit log) | ✅ ON | Append-only, dedup not required |
| `source_fingerprints` | 34 | ✅ `(fingerprint)` | ❌ OFF | URL-level hash; unused by full_ingest_pipeline |
| `kb_chunks` | 0 | ✅ `(content_hash)` | ✅ ON | Separate table, empty |
| `manual_chunks` | 0 | ✅ `(manual_id, chunk_index)` | ❌ OFF | Separate table, empty |

**Indexes added by this migration:**
- `idx_kg_rel_dedup` — UNIQUE on `(tenant_id, source_id, target_id, relationship_type)`
- `idx_ke_chunk_dedup` — UNIQUE on `(tenant_id, source_url, ((metadata->>'chunk_index')::int))`
- `idx_ke_source_type` — on `knowledge_entries(source_type)`
- `idx_ke_created_at` — on `knowledge_entries(created_at DESC)`
- `idx_kg_triples_subject` — on `kg_triples_log(tenant_id, subject)`
- `idx_kg_triples_source` — on `kg_triples_log(source)`
- `idx_kg_rel_tenant` — on `kg_relationships(tenant_id)`

### 2.2 Data Quality

**NULL analysis (knowledge_entries):**
- null tenant_id: 0 ✅
- null source_url: 0 ✅
- null content: 0 ✅
- null embedding: 0 ✅

**Data sources in knowledge_entries by type:**

| source_type | Count |
|-------------|-------|
| gdrive | 33,410 |
| manual | 32,584 |
| equipment_manual | 4,718 |
| youtube_transcript | 2,522 |
| equipment_photo | 1,411 |
| curriculum | 670 |
| reference | 614 |
| other | ~500 |

**Data freshness:** oldest=2026-03-28, newest=2026-04-29 (healthy)

**Orphaned KG relationships:** 0 ✅ (FK cascade prevents orphans)

**Tenant ID type consistency:** All `UUID` across knowledge_entries, kg_entities, kg_relationships, kg_triples_log ✅

### 2.3 Dedup Protection (Pre/Post Audit)

| Table | Before | After |
|-------|--------|-------|
| `knowledge_entries` | App-level SELECT check only (TOCTOU risk under concurrent workers) | + DB-level UNIQUE index `idx_ke_chunk_dedup` |
| `kg_entities` | ✅ DB UNIQUE constraint | No change needed |
| `kg_relationships` | `ON CONFLICT DO NOTHING` no-op (no backing index) | + UNIQUE index `idx_kg_rel_dedup` + explicit conflict target in INSERT |
| `kg_triples_log` | Append-only (dedup intentionally absent) | No change |

**Remaining TOCTOU risk:** `chunk_exists()` + `insert_chunk()` are not wrapped in a serializable transaction. Under concurrent Celery workers ingesting the same URL simultaneously, two workers could both pass `chunk_exists()` before either inserts, then both attempt INSERT. The new DB UNIQUE index converts this from a silent duplicate to a caught conflict (DO NOTHING), so data integrity is preserved even under concurrency. The cost is that one worker's chunks are silently skipped — acceptable for an idempotent ingest pipeline.

### 2.4 RLS Verification

**Before this PR:**
- `knowledge_entries`: RLS=OFF — any query without a WHERE tenant_id clause can scan all tenants' data
- `kg_entities`, `kg_relationships`, `kg_triples_log`: RLS=ON with `app.current_tenant_id` policy ✅

**After this PR:**
- `knowledge_entries`: RLS=ON — policy `knowledge_entries_tenant` added (matches kg_* pattern)

**Important note:** The `neondb_owner` role is a PostgreSQL superuser and bypasses RLS by design. All current application connections use `neondb_owner` (via `NEON_DATABASE_URL`). The RLS policy protects connections using restricted roles (future application-level service accounts). This is the correct architecture for a SaaS platform moving toward per-tenant service accounts.

**Open item:** Create a restricted `mira_app` role with `SET ROLE` in application connections to enforce RLS in production. Track as GitHub issue.

### 2.5 Backup & Recovery

NeonDB Serverless provides continuous WAL-based PITR by default. Free tier: 7-day retention. Pro tier: 30-day retention. No action required — PITR is platform-managed.

---

## Part 3: Software Engineering Hardening

### 3.1 Input Validation

| Check | Before | After |
|-------|--------|-------|
| PDF magic bytes | ❌ Not validated — any file accepted | ✅ Added `_validate_pdf()` in `full_ingest_pipeline.py:_download()` — rejects non-PDF |
| File size cap (download) | 50 MB via `LARGE_SKIP_BYTES` in extract step, but full download always completed | ✅ Hard cap at 50 MB mid-stream in `_download()` — aborts before fully writing |
| File size cap (mira-ingest API) | ✅ 20 MB via HTTP 413 | No change |
| PDF content type (mira-ingest API) | ✅ MIME + extension check | No change |
| Docling size gate | ✅ Skip >50 MB, split >512 KB | No change |
| SQL injection via entity_id | ✅ Parameterized queries throughout — not vulnerable | No change |
| tenant_id validation | ✅ UUID type enforced at DB level | No change |

### 3.2 Error Handling

**What happens if Docling fails mid-ingest?**
- `step_extract()` catches all exceptions, logs the error, appends to `report.errors`, and returns empty string.
- Downstream steps (`step_kb_ingest`, `step_kg`) receive empty text and early-return without writing.
- No partial data is written to the KB or KG. ✅

**What happens if NeonDB is unreachable during KG write?**
- `_upsert_entity()` wraps all DB calls in try/except, returning `None` on error.
- `step_kg()` catches the connection error at the outer try/except level.
- Partial entity writes: if entity upsert succeeds but relationship INSERT fails (NeonDB drops mid-transaction), the entity exists orphaned. The relationship can be re-inserted on the next run because `_upsert_entity` uses DO UPDATE.
- **Gap:** `step_kg()` uses `conn.autocommit = False` but does not roll back on partial failure — if entity inserts succeed and relationship insert fails, the entity is committed. Fix: wrap the whole KG step in a single transaction with explicit rollback. Tracked as follow-up.

**Transactions:**
- `insert_chunk()` in `store.py`: single statement, commits per chunk. Not wrapped in a document-level transaction. Acceptable for append-only KB ingest.
- `step_kg()` in `full_ingest_pipeline.py`: `conn.autocommit = False`, but no explicit `try/except/rollback` wrapping the full entity+relationship+triple block. Partial writes possible.

### 3.3 Idempotency

| Operation | Idempotent? | Mechanism |
|-----------|-------------|-----------|
| Download | ✅ | Skips if file cached |
| Docling extract | ✅ | Saves `.txt` alongside PDF; re-reads on next run (future optimization) |
| KB chunk ingest | ✅ (after this PR) | `chunk_exists()` + DB UNIQUE constraint backstop |
| KG entity upsert | ✅ | `ON CONFLICT ... DO UPDATE` |
| KG relationship insert | ✅ (after this PR) | Explicit `ON CONFLICT (tenant_id, source_id, target_id, relationship_type) DO NOTHING` |
| KG triples log | ❌ (by design) | Append-only audit log — duplicate triples on re-run are accepted |

**Resumability:** If the pipeline crashes mid-document, re-running is safe:
- Already-downloaded PDFs are skipped (cached).
- Already-inserted chunks are skipped (dedup).
- KG entities are upserted (idempotent).
- KG relationships are skipped on conflict.
- Triples will be re-logged (duplicate log entries, not data integrity issues).

### 3.4 Monitoring

**Current state:**
- Ingest operations logged to stderr via Python `logging` module ✅
- No alerting on KB chunk count drop ❌
- No alerting on anomalous KG entity counts ❌
- No structured ingest metrics (success/fail counts written to DB) — `ingestion_metrics_daily` and `ingestion_metrics_realtime` tables exist but are unused by `full_ingest_pipeline.py` ❌

**Recommendations (not implemented in this PR — complexity/scope):**
1. Write ingest run results to `ingestion_logs` table (already exists in schema).
2. Add Grafana alert: alert if `knowledge_entries` count drops by >5% in 24h.
3. Add Grafana alert: alert if `kg_entities` count drops to 0.
4. Expose `/metrics` Prometheus endpoint from mira-pipeline reporting KB chunk count per tenant.

### 3.5 Access Control

| Endpoint | Auth | Verdict |
|----------|------|---------|
| mira-pipeline `/v1/*` (chat) | ✅ Bearer token (`PIPELINE_API_KEY`) | Secure |
| mira-pipeline `/health`, `/v1/models` | ❌ No auth (whitelist) | Intentional — health checks |
| mira-pipeline `127.0.0.1` bypass | ⚠️ Localhost bypasses auth | Acceptable for docker-exec; no public exposure |
| mira-ingest API | ❌ No external auth (core-net only) | Safe — not exposed outside Docker network |
| Docling container `:5001` | ❌ No auth | **Investigate: is port 5001 exposed to internet?** |
| `full_ingest_pipeline.py` CLI | ❌ CLI tool — no HTTP auth | Acceptable — runs locally on VPS |

**Docling exposure check needed:** Verify `mira-docling-saas` port 5001 is bound to `127.0.0.1` only (not `0.0.0.0`). An unauthenticated Docling endpoint exposed to the internet would allow arbitrary PDF processing. **Action: verify in `docker-compose.yml`.**

---

## Fixes Implemented in This PR

| Fix | File | Severity |
|-----|------|----------|
| UNIQUE index on `kg_relationships(tenant_id, source_id, target_id, relationship_type)` | `mira-hub/db/migrations/003_kb_hardening.sql` | CRITICAL |
| Delete existing duplicate `kg_relationships` row | `003_kb_hardening.sql` | CRITICAL |
| UNIQUE functional index on `knowledge_entries` chunk dedup key | `003_kb_hardening.sql` | HIGH |
| RLS enable + policy on `knowledge_entries` | `003_kb_hardening.sql` | HIGH |
| Missing performance indexes (6 new indexes) | `003_kb_hardening.sql` | MEDIUM |
| ON CONFLICT with explicit target in `step_kg()` both INSERT statements | `mira-crawler/tasks/full_ingest_pipeline.py` | CRITICAL |
| PDF magic bytes validation in `_download()` | `mira-crawler/tasks/full_ingest_pipeline.py` | HIGH |
| Mid-stream 50 MB download cap (abort before completing) | `mira-crawler/tasks/full_ingest_pipeline.py` | HIGH |
| DB-level ON CONFLICT backstop in `insert_chunk()` | `mira-crawler/ingest/store.py` | HIGH |

## Follow-up Issues (Not Implemented)

| Issue | Priority | Effort |
|-------|----------|--------|
| Wrap `step_kg()` in single transaction with rollback | HIGH | Small |
| Verify Docling container port is `127.0.0.1:5001`, not `0.0.0.0:5001` | HIGH | Tiny |
| Create restricted `mira_app` DB role + enforce RLS | HIGH | Medium |
| Write ingest results to `ingestion_logs` table | MEDIUM | Small |
| Add Grafana alert: KB chunk count drop >5%/24h | MEDIUM | Medium |
| Cache `.txt` extraction result — skip docling if `.txt` exists | MEDIUM | Small |
| Use `source_fingerprints` for URL-level dedup before download | LOW | Small |
| Wrap `chunk_exists()` + `insert_chunk()` in serializable transaction | LOW | Medium |
