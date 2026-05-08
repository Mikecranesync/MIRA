# KB Ingest Hardening — Production Spec

**Status:** Draft → review by 2026-05-10 → lock by 2026-05-12 → ship by 2026-05-18 (demo prep)
**Owner:** Mike Harper · **Branch:** `claude/xenodochial-murdock-d6e4f9`
**Supersedes:** ad-hoc behavior in `mira-crawler/cron/kb_growth_cron.py` and `mira-crawler/tasks/full_ingest_pipeline.py`

---

## 0. TL;DR

The MIRA KB ingest pipeline currently exists in two parallel and partially-overlapping systems:

| System | Lives | Writes to | Status |
| --- | --- | --- | --- |
| Celery worker | `/opt/master_of_puppets/` (VPS) | `knowledge_entries` (80,789 rows, +3–4 k/day) | Real workload |
| `kb_growth_cron.py` | this repo, run by VPS crontab | `knowledge_entries` (via `full_ingest_pipeline.py`) | Supplemental |
| mira-hub UI | this repo (`mira-hub/src/app/api/*`) | reads `kb_chunks` (67 rows, demo stub) | **Wrong table** |

Doppler `OLLAMA_BASE_URL` is set to `100.72.2.99` — there is no node at that address. Bravo (Ollama host) is `100.86.236.11`. Embeddings have been silently failing for an unknown duration; the pipeline's fault-tolerant design hid the failure.

This spec defines the gold-standard the team will hold the pipeline to before MIRA goes in front of customers — across reliability, observability, data quality, security, fault tolerance, performance, monitoring, configuration, testing, and unification.

It is **not aspirational**. Every requirement maps to a concrete gap with an issue, an owner, and a ship date.

---

## 1. Goals + Non-Goals

### 1.1 Goals

1. Single, well-instrumented ingest pipeline that the team can reason about end-to-end.
2. Every PDF the pipeline touches is auditable: when, where from, how it processed, why it failed.
3. The KB grows reliably (target: ≥ 100 PDFs/day) without hidden silent failures.
4. UI surfaces (mira-hub, Telegram heartbeat) read from the same authoritative table.
5. CI gate prevents regressions in the pipeline contract.

### 1.2 Non-Goals (deferred)

- Replacing Docling with a different extraction stack.
- Migrating `mira-sidecar` ChromaDB; tracked separately in issue #195.
- Real-time ingestion (current cadence: hourly cron is sufficient through demo window).
- Multi-tenant ingest isolation beyond `tenant_id` scoping that already exists.
- Cost tracking per ingest (nice-to-have, not in MVP critical path).

---

## 2. Architecture (target state)

```
                 ┌───────────────────────────────┐
   PDF queue ──▶ │ kb_growth_cron.py             │
  (manual_       │  · validates URL allowlist    │
   queue.json)   │  · structured JSON logs       │
                 │  · writes to pipeline_runs    │
                 └───────────────┬───────────────┘
                                 │
                 ┌───────────────▼───────────────┐
                 │ full_ingest_pipeline.py       │
                 │  ┌─────────┬───────────────┐  │
                 │  │ DOWNLOAD │ retry x3 EB  │  │
                 │  ├─────────┼───────────────┤  │
                 │  │ EXTRACT  │ Docling       │  │
                 │  │          │  → fallback:  │  │
                 │  │          │    pypdf/     │  │
                 │  │          │    pdfplumber │  │
                 │  ├─────────┼───────────────┤  │
                 │  │ CHUNK    │ validate len  │  │
                 │  ├─────────┼───────────────┤  │
                 │  │ EMBED    │ batch x10     │  │
                 │  │          │ Ollama Bravo  │  │
                 │  ├─────────┼───────────────┤  │
                 │  │ STORE    │ knowledge_    │  │
                 │  │          │  entries      │  │
                 │  ├─────────┼───────────────┤  │
                 │  │ KG       │ entities +    │  │
                 │  │          │  relationships│  │
                 │  └─────────┴───────────────┘  │
                 └───────────────┬───────────────┘
                                 │
                 ┌───────────────▼───────────────┐
                 │ pipeline_runs (NeonDB)        │ ◀── /api/kb/stats
                 │  + knowledge_entries          │ ◀── mira-hub UI
                 │  + kg_entities                │ ◀── heartbeat
                 │  + kg_relationships           │
                 └───────────────────────────────┘
```

Authoritative table: **`knowledge_entries`**. `kb_chunks` is deprecated (see §11).

---

## 3. Reliability — Retry Logic

### 3.1 Step boundaries

The pipeline is decomposed into 5 idempotent steps, each with its own retry envelope:

| Step | What | Idempotent? | Retry policy |
| --- | --- | --- | --- |
| 1. DOWNLOAD | HTTP GET PDF → local path | yes (re-download) | 3 retries, exponential backoff `1s, 4s, 16s` |
| 2. EXTRACT | Docling sync OR fallback | yes | 2 retries on Docling, then drop to fallback |
| 3. CHUNK | text → chunks (500–2000 chars) | yes (deterministic) | 0 retries (failure = code bug, not transient) |
| 4. EMBED | Ollama batch embed | yes (per-chunk hash) | 3 retries per batch, exponential backoff |
| 5. STORE | upsert into `knowledge_entries` | yes (UNIQUE index) | 3 retries on transient PG errors only |

### 3.2 Error classification

```python
class IngestError(Exception):
    transient: bool   # 5xx, timeout, connection-reset, PG deadlock
    permanent: bool   # 404, 403, 4xx, schema mismatch, parse failure
```

- **Transient** → retry per policy above.
- **Permanent** → mark step `failed`, write reason to `pipeline_runs`, do not retry.
- The crawler's URL queue must move 403/404 entries to status `dead` after 1 attempt — they will not become 200 by waiting.

### 3.3 Concrete defaults (no configuration knobs in v1)

```python
RETRY_MAX = 3
BACKOFF_BASE_SECONDS = 1
BACKOFF_FACTOR = 4
DOWNLOAD_TIMEOUT = 60
EMBED_BATCH_TIMEOUT = 120
```

---

## 4. Observability — Metrics + Logging

### 4.1 Structured logging (JSON)

Every pipeline step emits one JSON line to stdout (so `journalctl` / `docker logs` / Promtail can pick it up):

```json
{
  "ts": "2026-05-07T18:42:11Z",
  "run_id": "9f6c0a…",
  "step": "embed",
  "pdf_url": "https://cdn.automationdirect.com/…",
  "manufacturer": "Allen-Bradley",
  "model": "1606-XLS",
  "status": "ok",
  "chunks": 47,
  "duration_ms": 8412,
  "error": null
}
```

Required fields: `ts`, `run_id`, `step`, `status` (`ok|retry|failed`), `duration_ms`.
Optional but expected: `pdf_url`, `manufacturer`, `model`, `chunks`, `error`, `bytes`.

### 4.2 `pipeline_runs` table

```sql
CREATE TABLE pipeline_runs (
    id              UUID PRIMARY KEY,
    tenant_id       TEXT NOT NULL DEFAULT 'mike',
    pdf_url         TEXT NOT NULL,
    manufacturer    TEXT,
    model           TEXT,
    doc_type        TEXT,
    status          TEXT NOT NULL,          -- pending|running|ok|failed|partial
    step_failed     TEXT,                   -- which step failed (NULL if ok)
    chunks_created  INTEGER NOT NULL DEFAULT 0,
    bytes_downloaded BIGINT,
    error           TEXT,                   -- last error message, truncated to 500 chars
    started_at      TIMESTAMP NOT NULL DEFAULT now(),
    completed_at    TIMESTAMP,
    duration_ms     INTEGER,
    pipeline_version TEXT NOT NULL          -- git sha of the pipeline at run time
);

CREATE INDEX pipeline_runs_status_idx ON pipeline_runs (status, started_at DESC);
CREATE INDEX pipeline_runs_tenant_idx ON pipeline_runs (tenant_id, started_at DESC);
```

Every `kb_growth_cron.py` invocation **must** open a row before doing work and update it before exiting (success or failure). No hidden runs.

### 4.3 Stats endpoint

`GET /api/kb/stats` (mira-hub) returns:

```json
{
  "total_entries": 80789,
  "entries_today": 2847,
  "entries_7d": 19204,
  "success_rate_7d": 0.94,
  "queue_depth": 17,
  "top_failures": [
    { "url_host": "manualslib.com", "count": 12, "last_error": "403" }
  ],
  "last_run_at": "2026-05-07T17:00:01Z",
  "stale": false
}
```

`stale: true` when `last_run_at` is older than 24h. The UI banner pulls from this.

### 4.4 Alerting

Telegram (`kb_growth` agent in `telegram_notify.py`) sends:

| Trigger | Severity | Throttle |
| --- | --- | --- |
| Batch failure rate > 50% in last 10 runs | 🔴 critical | 1/hour |
| No new `pipeline_runs` row in 24h | 🔴 critical | 1/day |
| Docling health check fails | 🟡 warning | 1/hour |
| Embedding failures > 30% in a batch | 🟡 warning | 1/hour |

---

## 5. Data Quality — Validation

### 5.1 Chunk constraints

| Rule | Limit | Action on violation |
| --- | --- | --- |
| Min length | 50 chars | drop chunk, log `dropped_short` |
| Max length | 2000 chars | split on paragraph boundary, then sentence |
| Content hash dedup | sha256(content + manufacturer + model) | skip insert, count `deduped` |
| Manufacturer present | `metadata.manufacturer` non-null | drop chunk |
| Embedding dim | 768 (matches `vector(768)` column) | reject, log `embed_dim_mismatch` |

### 5.2 Required metadata

Every row in `knowledge_entries` produced by this pipeline must have:

- `manufacturer` (TEXT, non-null)
- `model_number` (TEXT, may be `unknown`)
- `equipment_type` or `chunk_type` (one of: `installation_manual`, `service_manual`, `parts_list`, `troubleshooting_guide`, `general`)
- `metadata.source_url` (TEXT)
- `metadata.chunk_index` (INTEGER)
- `metadata.pipeline_version` (TEXT — git sha, supports cache invalidation)
- `tenant_id` (`mike` for v1; the multi-tenant story is post-MVP)

### 5.3 Backfill expectations

Existing 80 k rows lack some of the above. **Do not** retroactively rewrite — backfill via tools/`kb_backfill_metadata.py` in a tracked migration job, not in the hot path.

---

## 6. Security — Input Validation

### 6.1 URL allowlist

PDFs may only be fetched from hosts in `mira-crawler/config/url_allowlist.yml`:

```yaml
oem_domains:
  - cdn.automationdirect.com
  - literature.rockwellautomation.com
  - assets.omron.com
distributors:
  - automationdirect.com
  - galco.com
public_libraries:
  - manualslib.com
  - manualslib.us
```

Any host not on the list → reject at queue time with `dead`. No surprises.

### 6.2 Content limits

| Rule | Limit | Notes |
| --- | --- | --- |
| Max PDF size | 50 MB | larger → split job (v1: defer + alert; v2: auto-split) |
| Content-Type | `application/pdf` | reject HTML pages dressed as PDFs |
| Path traversal | strip `..`, `/`, `~` from manufacturer/model when forming local paths | already partially done in `full_ingest_pipeline.py`, formalize |
| Docling rate limit | max 4 concurrent calls per worker | prevents resource exhaustion |

### 6.3 Secret handling

All config (Doppler `factorylm/prd`):

- `NEON_DATABASE_URL`
- `OLLAMA_BASE_URL` (the bug — see §10)
- `DOCLING_URL`
- `MIRA_TENANT_ID`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Never read from `.env`. Never hardcoded. Never echoed to logs.

---

## 7. Fault Tolerance — Graceful Degradation

| Dependency | Outage behavior |
| --- | --- |
| Docling down | Fall through to `pdfplumber` → `pypdf` chain. Quality drops; pipeline does not. Log `extract.method=fallback`. |
| Ollama down | Persist extracted text to `pipeline_runs.staging_path` (or local file cache), mark run `partial`, retry embed step on next cron. **Do not** drop the work. |
| NeonDB down | Buffer to `/var/lib/mira/kb_buffer/*.jsonl`, flush on next cron when DB returns. |
| One PDF in batch fails | Continue; one bad PDF must never abort a batch run. |
| Pipeline crash mid-run | `pipeline_runs.status='running'` rows older than 30 min get reaped to `failed` by next cron startup sweep. |

The cron's design philosophy: **make forward progress every cycle, even if degraded.**

---

## 8. Performance — Throughput

### 8.1 Targets

| Metric | Target (v1) | Target (post-MVP) |
| --- | --- | --- |
| PDFs/day | ≥ 100 | ≥ 500 |
| Median ingest end-to-end | < 90 s | < 30 s |
| p95 ingest end-to-end | < 8 min | < 2 min |
| Concurrent downloads | 3 | 8 |
| Embed batch size | 10 chunks | 50 chunks |

### 8.2 Concurrency model

`kb_growth_cron.py` is single-process, single-PDF per invocation today. v1 of this spec stays there — the throughput bottleneck is Docling, not the cron. Parallelism is added by **invoking the cron more often**, not by threading inside it. Crontab cadence: every 30 min during business hours, hourly off-hours.

If the queue exceeds 200 pending after 7 days, escalate to multi-worker design (post-MVP).

---

## 9. Monitoring — Alerting (operational)

Heartbeat monitor (existing `mira-crawler/reporting/agent_report.py`) gains a KB section:

```
KB Growth Engine 📚
  Total entries:   80,789
  Today:           +247
  Last 7d:         +18,940 (94% success)
  Queue depth:     17 pending
  Last run:        12 min ago ✅
```

If the daily `morning_brief` has the KB delta at zero for 2 days running → escalate to 🔴 in heartbeat.

Weekly Telegram Pulse (Sunday 2 AM): KB growth + top contributing OEMs + top failure hosts.

---

## 10. Configuration — Environment

### 10.1 Startup health check

`kb_growth_cron.py` runs preflight checks before any work:

```python
def preflight() -> bool:
    checks = [
        ("ollama", f"{OLLAMA_URL}/api/tags"),
        ("docling", f"{DOCLING_URL}/health"),
        ("neon", neon_ping_query),
    ]
    # Fail-fast if any returns non-2xx for 5s.
```

Fail-fast policy: if Ollama is unreachable, exit non-zero, write `pipeline_runs` row with `status=failed, step_failed=preflight`. Do not silently queue.

### 10.2 The Doppler bug

**Current value (broken):** `OLLAMA_BASE_URL=http://100.72.2.99:11434`
**Correct value:** `OLLAMA_BASE_URL=http://100.86.236.11:11434` (Bravo, Tailscale)

Mike has authorized the fix. Rotation procedure:

```bash
doppler secrets set OLLAMA_BASE_URL=http://100.86.236.11:11434 \
  --project factorylm --config prd
# verify
doppler secrets get OLLAMA_BASE_URL --project factorylm --config prd --plain
# restart Celery + cron on VPS
ssh vps 'systemctl restart mira-celery; systemctl restart mira-kb-cron.timer'
```

A regression test (§12) protects against re-breakage: cron preflight runs `ollama /api/tags` and fails the run if it returns 404 or connection-refused.

### 10.3 Feature flags

In env (Doppler) — defaults shown:

| Flag | Default | Effect |
| --- | --- | --- |
| `KB_INGEST_ENABLED` | `true` | master switch |
| `KB_INGEST_BATCH_SIZE` | `1` (one PDF per cron run) | tune up only after multi-worker |
| `KB_INGEST_INTERVAL_MINUTES` | `30` | crontab cadence |
| `KB_FALLBACK_EXTRACT_ENABLED` | `true` | turn off if pdfplumber output starts polluting KB |

---

## 11. Unification — Single Source of Truth

### 11.1 Decision

`knowledge_entries` is the authoritative table. Everything else reads from it.

`kb_chunks` is **deprecated** as of this spec. It currently has 67 rows (all demo). It will be:

1. Renamed to `kb_chunks_legacy_v1`.
2. Backed up to NeonDB branch `backup-kb-chunks-2026-05-07` for forensic recovery.
3. Removed from `mira-hub/src/lib/data-schema.ts` Phase-2 migration list.

### 11.2 mira-hub UI changes

Two endpoints currently reference `kb_chunks`. Both must be updated:

- `mira-hub/src/app/api/usage/route.ts:60` → `SELECT COUNT(*) FROM knowledge_entries WHERE tenant_id = $1`
- `mira-hub/src/app/api/knowledge/route.ts:22-26` → query `knowledge_entries` and project the same shape

Field mapping:

| `kb_chunks` field | `knowledge_entries` source |
| --- | --- |
| `system_category` | `metadata->>'system_category'` (NULL-tolerant) |
| `subcategory` | `metadata->>'subcategory'` |
| `manufacturer` | `manufacturer` (column) |
| `product_family` | `metadata->>'product_family'` |
| `doc_type` | `chunk_type` |
| `source` | `metadata->>'source'` |
| `quality_score` | `metadata->>'quality_score'` (NULL-tolerant; AVG over NULLs returns NULL — handle in code) |
| `title` | `metadata->>'title'` |
| `tenant_id` | `tenant_id` (column) |

### 11.3 Authoritative-table contract

A `docs/architecture/kb-tables.md` ADR will state the rule going forward: **any new feature that needs knowledge chunks reads from `knowledge_entries`. PRs that introduce a new chunks table fail review unless the PR description includes a migration plan to consolidate.**

---

## 12. Testing — CI Integration

### 12.1 Unit tests (must exist)

In `mira-crawler/tests/test_ingest_pipeline.py`:

- `test_chunk_validation_min_length` — drops 49-char chunks, keeps 50-char.
- `test_chunk_validation_max_length` — splits a 5000-char chunk into ≤ 2000-char pieces on paragraph boundaries.
- `test_dedup_by_content_hash` — second insert of same content does not increment row count.
- `test_retry_transient_then_succeed` — embed step retries 3× on 503 then commits.
- `test_retry_permanent_then_dead` — download step on 404 marks `dead` after 1 attempt.
- `test_fallback_pdfplumber_used_when_docling_down` — mock Docling 503 → pdfplumber path runs.
- `test_url_allowlist_rejects_unknown_host` — `evil.com` is rejected before download.

### 12.2 Integration test

In `mira-crawler/tests/test_pipeline_e2e.py`, behind `pytest -m integration`:

1. Stages a known small fixture PDF served by `pytest-httpserver`.
2. Runs `full_ingest_pipeline.py` end to end against a NeonDB test branch.
3. Asserts: ≥ 1 row in `knowledge_entries`, exactly 1 row in `pipeline_runs.status='ok'`, embedding column non-null.

### 12.3 CI gate

`.github/workflows/ci.yml` adds a `kb-ingest` job that runs §12.1 on every PR touching `mira-crawler/`, `mira-hub/src/app/api/*`, or this spec. Failing tests block merge.

Mocked dependencies — no live Ollama / Docling / Neon hits in unit tests. Integration test runs nightly only (cost discipline).

---

## 13. Migration plan (ship order)

| Step | Owner | Day | Issue |
| --- | --- | --- | --- |
| 1. Create `pipeline_runs` table migration | claude | day 1 | KB-INGEST-1 |
| 2. Fix mira-hub `/api/usage` + `/api/knowledge` to read `knowledge_entries` | claude | day 1 | KB-INGEST-2 |
| 3. Add `/api/kb/stats` endpoint | claude | day 1 | KB-INGEST-3 |
| 4. Add structured JSON logging to `kb_growth_cron.py` | claude | day 2 | KB-INGEST-4 |
| 5. Add Docling fallback path (pdfplumber) | claude | day 2 | KB-INGEST-5 |
| 6. KB metrics in heartbeat monitor | claude | day 2 | KB-INGEST-6 |
| 7. Unit tests + CI gate | claude | day 3 | KB-INGEST-7 |
| 8. **Mike: rotate Doppler `OLLAMA_BASE_URL`** | Mike | day 3 | KB-INGEST-8 |
| 9. Deploy to VPS, watch heartbeat for 48h | Mike | day 4–5 | KB-INGEST-9 |
| 10. Demo prep — verify dashboard pulls real numbers | Mike | day 6 | — |

Demo deadline: **2026-05-18**. All P0 issues closed by 2026-05-15 to leave 3 days of soak.

---

## 14. Acceptance criteria (Done = Done)

A future engineer should be able to:

1. Look at `mira-hub/dashboard` and see the same KB total as `SELECT COUNT(*) FROM knowledge_entries`.
2. Watch a Telegram heartbeat and tell within 1 hour that ingest has stalled.
3. Run `pytest mira-crawler/tests/` locally and have the suite pass without network.
4. `git grep kb_chunks` and find only the deprecation notice + backup script.
5. Submit a PR that breaks the `OLLAMA_BASE_URL` and have CI tell them within 5 min.
6. Read `docs/specs/kb-ingest-hardening-spec.md` and understand the contract — without spelunking through Celery worker code on a different machine.

If any of those six fail, the spec hasn't shipped.

---

## 15. Open questions / parking lot

- Should the Celery worker on `/opt/master_of_puppets/` be merged into this repo? (Likely yes, post-demo. Keeps two-system split out of MVP scope.)
- Do we want per-OEM ingest budgets (e.g. cap Allen-Bradley at 30% of KB)? Not now.
- pgvector HNSW migration (`mira-core/scripts/migrate_to_hnsw.sql`) — separate track.
- Quality scoring of chunks via LLM — separate track.

---

*Spec version: 1.0 · 2026-05-07 · Mike Harper*
