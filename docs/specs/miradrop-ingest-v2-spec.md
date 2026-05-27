# MiraDrop Ingest v2 — Specification

**Status:** Draft → Active 2026-05-26
**Owners:** Mike (product), MIRA engine team (implementation)
**Companion docs:** `docs/adr/0019-miradrop-ingest-v2.md` · `docs/plans/2026-05-26-miradrop-auto-splitter.md`
**Doctrine references:** `.claude/CLAUDE.md`, `docs/specs/maintenance-namespace-builder-spec.md`, `docs/environments.md`, `.claude/rules/uns-compliance.md`

## 1. Purpose

Define the contract for **mira-ingest-v2**, the replacement ingest path for drops landing in `~/MiraDrop/inbox/`. v2 turns a dropped file (any size, PDF this build) into:

1. Page-anchored, section-tagged chunks in `knowledge_entries` (KB).
2. A tech-confirmed UNS-pathed Equipment entity + Manual relationship in `kg_entities`/`kg_relationships` (KG).
3. Extracted fault codes / components as **proposed** relationships pending corroboration.
4. A model-level QR PNG sidecar the technician can stick on the physical asset.
5. A readiness-score delta surfaced to the technician via Slack ("L1 → L2; next step: …").

A successful drop is one where any future reader of the KB or KG can see exactly **what the document is, what equipment it describes, who confirmed that binding, and what's still proposed pending review**.

## 2. Non-goals

- **No physical PDF splitting.** Splitting is done at the text-chunk layer by `mira-crawler/ingest/chunker.py`. The PDF stays one logical document.
- **No new queue infrastructure.** `hub_uploads` is the queue.
- **No photo path.** Out of scope this build (see ADR-0019 § Alternatives).
- **No replacement of the OW path for non-MiraDrop ingest.** OW continues to serve Google Drive / Dropbox uploads + existing collections.
- **No promotion of extracted facts to `verified` without a human signal in the dependency chain.** Auto-promotion is forbidden by `.claude/CLAUDE.md`.
- **No cloud-side v2 instance this round.** v2 runs on CHARLIE only.

## 3. Pipeline

```
MiraDrop watcher
        │  (HTTPS multipart, streamed body)
        ▼
mira-hub  /api/uploads/folder
        │  (auth + tenant resolution; INSERTs hub_uploads row;
        │   pipes req.body straight to v2 — no in-memory buffer)
        ▼
mira-ingest-v2  HTTP endpoint    ── returns 202 once file lands on disk ──┐
        │                                                                  │
        ▼                                                                  │
File on local disk + hub_uploads row claimed by worker                     │
        │                                                                  │
        ▼                                                                  │
v2 worker — single concurrency, SELECT FOR UPDATE SKIP LOCKED              │
                                                                           │
  ┌─────────────────────────────────────────────────────────────────┐      │
  │  Phase 1: parsing                                                │      │
  │    - docling subprocess (do_ocr=False if PDF has text layer)     │      │
  │    - converter.py + chunker.py over result.document              │      │
  │    - HEARTBEAT every 30 s                                        │      │
  │  COMMIT: file_parsed, page_count, chunk_count_estimate           │      │
  ├─────────────────────────────────────────────────────────────────┤      │
  │  Phase 2: embedding                                              │      │
  │    - batch embed via existing embedder backend                   │      │
  │    - INSERT into knowledge_entries with                          │      │
  │      doc_id = hub_uploads.id, ingest_route='v2',                 │      │
  │      page_start, page_end, section_path                          │      │
  │    - 50-chunk batches; commit after each batch                   │      │
  │  COMMIT: status='embedding' → status='awaiting_confirmation'     │      │
  ├─────────────────────────────────────────────────────────────────┤      │
  │  Phase 3: extraction                                             │      │
  │    - filename heuristic → vendor catalog prefixes                │      │
  │    - rule extractor over first 10 pages (uns_resolver alias)     │      │
  │    - LLM cascade fallback if rules miss                          │      │
  │    - writes extracted_manufacturer, extracted_model,             │      │
  │      extraction_method to hub_uploads                            │      │
  ├─────────────────────────────────────────────────────────────────┤      │
  │  Phase 4: Slack dialogue (UNS Location-Confirmation Gate)        │      │
  │    - sends DM to dropping user via slack-bolt bot                │      │
  │    - buttons seeded from D-hybrid:                               │      │
  │        a) current open thread context                            │      │
  │        b) recent confirmed contexts (last 24-48h)                │      │
  │        c) model template only (cold)                             │      │
  │        d) type UNS path manually                                 │      │
  │    - on revision detection: second prompt (Q12)                  │      │
  │  WAIT: tech confirmation, or TTL=24h → default to model template │      │
  ├─────────────────────────────────────────────────────────────────┤      │
  │  Phase 5: kg_proposing                                           │      │
  │    - register_equipment_and_manual() with tech-confirmed UNS     │      │
  │    - Manual binding: verified_by='tech'                          │      │
  │    - fault-code sweep across all chunks                          │      │
  │    - HAS_FAULT relationships: proposed (or system_consensus      │      │
  │      if corroborated by ≥1 other manual)                         │      │
  │    - link_chunk_to_equipment for each chunk                      │      │
  │  COMMIT: hub_uploads.kg_entity_id, kg_relationship_count         │      │
  ├─────────────────────────────────────────────────────────────────┤      │
  │  Phase 6: artifact                                               │      │
  │    - render QR PNG to ~/MiraDrop/done/{file}.qr.png              │      │
  │    - update ingest.json sidecar with uns_path, hub_url, qr_image │      │
  │    - call recalculate_health_score(tenant_id, uns_path)          │      │
  │    - update or send follow-up Slack DM with score delta + CTA    │      │
  │  COMMIT: status='parsed'                                         │      │
  └─────────────────────────────────────────────────────────────────┘
```

## 4. Schema changes

### 4.1 `hub_uploads` (extend in place)

```sql
-- mira-hub/db/migrations/030_hub_uploads_v2.sql
ALTER TABLE hub_uploads
  ADD COLUMN IF NOT EXISTS claimed_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_by             TEXT,
  ADD COLUMN IF NOT EXISTS worker_heartbeat_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kg_entity_id           UUID,
  ADD COLUMN IF NOT EXISTS kg_relationship_count  INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extracted_manufacturer TEXT,
  ADD COLUMN IF NOT EXISTS extracted_model        TEXT,
  ADD COLUMN IF NOT EXISTS extraction_method      TEXT,   -- 'rule' | 'llm' | 'filename' | 'manual'
  ADD COLUMN IF NOT EXISTS extraction_confidence  TEXT,   -- 'high' | 'medium' | 'low'
  ADD COLUMN IF NOT EXISTS revision_handling      TEXT,   -- 'append' | 'supersede' | 'separate' | 'cancelled'
  ADD COLUMN IF NOT EXISTS error_class            TEXT,
  ADD COLUMN IF NOT EXISTS ingest_route           TEXT;   -- 'ow' | 'v2'

CREATE INDEX IF NOT EXISTS idx_hub_uploads_v2_queue
  ON hub_uploads (status, created_at)
  WHERE ingest_route = 'v2' AND status = 'queued';

CREATE INDEX IF NOT EXISTS idx_hub_uploads_stale_claim
  ON hub_uploads (status, worker_heartbeat_at)
  WHERE status IN ('parsing','embedding','awaiting_confirmation','kg_proposing');
```

**Status enum (widened):**

| Status | Set by | Terminal? | Meaning |
|---|---|---|---|
| `queued` | v2 HTTP | no | File on disk, awaiting worker claim |
| `parsing` | worker | no | docling subprocess running |
| `embedding` | worker | no | chunks being written to `knowledge_entries` |
| `awaiting_confirmation` | worker | no | Slack DM sent, awaiting tech tap |
| `kg_proposing` | worker | no | tech confirmed; KG writes in progress |
| `parsed` | worker | yes | success |
| `failed` | worker | yes | terminal failure; `error_class` populated |
| `cancelled` | tech via Slack | yes | tech tapped "cancel — wrong file" |
| `fetching` | legacy OW path | no | preserved for backwards compat |

### 4.2 `knowledge_entries` (extend in place)

```sql
-- docs/migrations/002_knowledge_entries_chunk_anchors.sql
ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS doc_id       UUID,
  ADD COLUMN IF NOT EXISTS page_start   INTEGER,
  ADD COLUMN IF NOT EXISTS page_end     INTEGER,
  ADD COLUMN IF NOT EXISTS section_path TEXT,
  ADD COLUMN IF NOT EXISTS ingest_route TEXT;

CREATE INDEX IF NOT EXISTS idx_knowledge_entries_doc
  ON knowledge_entries (tenant_id, doc_id)
  WHERE doc_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_entries_route
  ON knowledge_entries (tenant_id, ingest_route, created_at DESC)
  WHERE ingest_route = 'v2';
```

`doc_id` = the source `hub_uploads.id`. All chunks of one drop share one `doc_id`.

The legacy `source_page` column (currently stores `chunk_index`, not PDF page number) stays unchanged; v2 fills the new `page_start`/`page_end` columns. Renaming `source_page` is out of scope (see ADR-0019 § Open questions).

### 4.3 `kg_relationships` (extend in place)

```sql
-- mira-hub/db/migrations/031_kg_relationship_provenance.sql
ALTER TABLE kg_relationships
  ADD COLUMN IF NOT EXISTS verified_by         TEXT,    -- 'tech' | 'admin' | 'system_consensus' | NULL when proposed
  ADD COLUMN IF NOT EXISTS verified_by_user_id TEXT,    -- Slack user_id or admin email
  ADD COLUMN IF NOT EXISTS verified_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS corroboration_count INTEGER DEFAULT 1;
```

Promotion rules:
- `proposed → verified` requires `verified_by` populated.
- `verified_by='tech'` requires a Slack tap event on a confirmation block.
- `verified_by='admin'` requires an explicit click in the Hub admin queue.
- `verified_by='system_consensus'` requires `corroboration_count ≥ 2` AND a prior human signal in the source dependency chain (i.e., at least one of the corroborating sources was tech- or admin-verified).

Pure transitive auto-promotion without a human signal anywhere in the chain is **forbidden**.

### 4.4 No changes to

- `kg_entities` — existing unique on `(tenant_id, entity_type, name)` already supports idempotent upserts via `kg_writer.upsert_entity`.
- `knowledge_entries`-side dedup index — preserved.
- OW path code in `mira-core/mira-ingest` — untouched.

## 5. HTTP API (v2)

### 5.1 `POST /v2/uploads` — accept a streamed file

| Field | Type | Notes |
|---|---|---|
| Headers | `X-Tenant-Id`, `X-Request-Id` | Hub-set; never trusted from the watcher |
| Body | `application/octet-stream` (streamed) | The raw file bytes |
| Query | `?filename=…&mime=…&uns_path_hint=…&kind=document` | metadata |

**Response 202:**
```json
{
  "upload_id": "uuid",
  "status": "queued",
  "doc_id": "uuid (=upload_id)"
}
```

v2 never returns the chunk count or KG result from this endpoint. Status is polled via Hub's existing `GET /api/uploads/:id`.

**Errors:**
- 400 `unsupported_mime` (only `application/pdf` accepted this build)
- 409 `duplicate_sha256` (file is byte-identical to an existing successful drop; caller should treat as no-op)
- 500 `disk_write_failed` (worker host out of space, file system error)

There is **no size cap** in v2. Disk is the limit.

### 5.2 `GET /v2/jobs/:upload_id/state` — internal observability

Returns the phase, heartbeat age, last error if any. Used by Hub UI's job-detail view. Not exposed publicly.

## 6. Slack dialogue protocol (UNS Location-Confirmation Gate for ingest)

### 6.1 Binding prompt (Phase 4)

Sent when `extraction_method != 'manual'` AND `extracted_manufacturer` is non-NULL.

**Seed options** (presented as Slack buttons, max 4):

1. **Current thread context.** If the dropping user has an active troubleshooting thread with MIRA, button text = the thread's confirmed asset / line / equipment. Example: *"the noisy VFD on Line 2"*.
2. **Recent confirmed contexts** (up to 2 from the last 48 h FSM session log). Example: *"Line 4 conveyor drive"*.
3. **Model template only.** *"File as model reference — not bound to a physical asset"*. UNS path = `enterprise.knowledge_base.{mfr_slug}.{model_slug}`.
4. **Type UNS path.** Opens a modal. Validates against the `uns.is_valid_path` grammar.

The DM also surfaces: extracted manufacturer + model, source chunk excerpt (cover page), extraction method + confidence.

### 6.2 Revision prompt (Phase 4b, conditional)

Fires only if the tech's chosen binding lands on an Equipment that already has a Manual at the same `manual_type` UNS path.

Buttons:
1. *"Append — keep both revisions"* (default on TTL = 24 h)
2. *"Replace — newer supersedes"*
3. *"Separate manual — different document type"*
4. *"Cancel — wrong file"*

Result writes `hub_uploads.revision_handling`.

### 6.3 Confirmation reply (Phase 6)

Sent when `status` transitions to `parsed`. Edits the original binding DM in place (Slack `chat.update`).

```
✅ Filed *PowerFlex 525 user manual* under Line 2
   472 chunks · 23 fault codes extracted · page-anchored

📈 Line 2 readiness: *L1 → L2*
   1 of 4 components now has a linked manual.

🎯 Next: Upload manuals for conveyor motor, photoeye, air valve.

[View namespace] [Show fault codes] [Print model QR]
```

Score delta + next-action come from `recalculate_health_score()` returning the new level and the top item from `health_scores.missing`.

### 6.4 Failure DM

If the job lands in `failed`, the DM includes the `error_class` and a "[Retry]" button. Retry posts `POST /v2/jobs/:id/retry`, which resets the row to `queued` (sweeping any partial writes via idempotent upserts).

## 7. Filesystem artifacts

For each successful drop, the watcher's `~/MiraDrop/done/` gets:

```
20260526_120000_abc_powerflex-525-manual.pdf           # original
20260526_120000_abc_powerflex-525-manual.pdf.ingest.json
20260526_120000_abc_powerflex-525-manual.pdf.qr.png     # NEW
```

**`ingest.json` schema:**
```json
{
  "upload_id": "uuid",
  "status": "parsed",
  "doc_id": "uuid",
  "uns_path": "enterprise.factory.line_2.vfd_001.manuals.user_manual",
  "model_uns_path": "enterprise.knowledge_base.rockwell_automation.powerflex_525",
  "hub_url": "https://app.factorylm.com/hub/kg/...",
  "qr_image": "20260526_120000_abc_powerflex-525-manual.pdf.qr.png",
  "extraction_method": "rule",
  "extraction_confidence": "high",
  "binding_state": "instance_bound",            // or 'model_only'
  "revision_handling": "append",                 // present only on revision events
  "kg_entity_id": "uuid",
  "kg_relationship_count": 24,
  "kb_chunk_count": 472,
  "readiness_delta": { "from": "L1", "to": "L2", "next": "..." },
  "completed_at": "2026-05-26T12:14:33Z"
}
```

**QR contents:** the Hub URL string. The Hub route (`/hub/kg/[unsPath]`) renders the entity page with model/instance state and any subsequent binding actions.

## 8. Worker lifecycle

### 8.1 Process model

- One launchd-managed Python process: `mira-ingest-v2-worker`.
- Concurrency: 1 (enforced by `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1`).
- Heartbeat: every 30 s, updates `hub_uploads.worker_heartbeat_at`.
- Stale-claim sweep: at startup and every 5 min, resets rows where `status IN (parsing, embedding, kg_proposing) AND worker_heartbeat_at < now() - interval '5 min'` back to `queued`.

### 8.2 Docling RAM levers

- `do_ocr=False` when `pypdf.PdfReader(...).pages[0].extract_text()` returns non-empty text (i.e., the PDF has a text layer). OEM manuals always do.
- One-shot subprocess per job: `subprocess.Popen([sys.executable, "-m", "docling_runner", str(path)], …)`. The subprocess prints JSON-line chunks to stdout, the worker reads and embeds. Subprocess is `wait()`-ed and goes away at end of job. PyTorch allocator pools cannot accumulate.
- `torch.set_num_threads(1)` inside the subprocess.

### 8.3 Idempotency keys

| Phase | Key | Behavior on duplicate |
|---|---|---|
| chunks insert | `(doc_id, chunk_index)` | `ON CONFLICT DO NOTHING` |
| kg_entities | `(tenant_id, entity_type, name)` | existing `kg_writer.upsert_entity` |
| kg_relationships | `(tenant_id, source_id, target_id, relationship_type)` | existing `kg_writer.upsert_relationship`; `corroboration_count` increments on conflict |

## 9. Retrieval contract

Bot side (`mira-bots/shared/neon_recall.py`):

- Continues to query `knowledge_entries` as today; no recall code changes required for v2 chunks to be retrieved.
- Citation formatter in `mira-bots/shared/citation_compliance.py` gains a v2 path: when a retrieved chunk has `page_start IS NOT NULL`, cite as *"…per the {extracted_model} manual, p. {page_start}, §{section_path} ([source]({hub_url}))…"*. Legacy chunks fall through to the existing citation shape.

## 10. Environment & deployment

| Env | Where v2 runs | Doppler config | Notes |
|---|---|---|---|
| Dev | CHARLIE | `factorylm/dev` | Today's prove-it target |
| Staging | CHARLIE (same process, different Doppler config) OR VPS staging stack | `factorylm/stg` | Decided at Phase 5 (see plan) |
| Prod (this build) | CHARLIE | `factorylm/dev` | "Prove it on CHARLIE first" |
| Cloud (Day-2) | VPS via `docker-compose.saas.yml` | `factorylm/prd` | Not built this round. When built: must include `mem_limit: 3g`, the two docling levers, and concurrency=1. |

Migrations ship dev → staging → prod via `apply-migrations.yml` (`dry-run` then `apply`). Never hand-edited.

## 11. Telemetry

Each phase emits a log line with `upload_id`, `tenant_id`, `phase`, `duration_ms`. Per `hub_uploads.error_class`, a daily Hub-UI panel surfaces failure counts grouped by class for triage.

Metrics worth tracking from day 1:
- p50 / p95 end-to-end duration (drop → `parsed`)
- `extraction_method` distribution (rule / llm / filename / manual)
- TTL-expiry rate for Q10 (how often does the tech ghost?)
- `revision_handling` distribution (append / supersede / separate / cancelled)
- `verified_by` distribution on `kg_relationships`
- Per-drop readiness delta (L_old → L_new)

## 12. Glossary (terms specific to this spec)

| Term | Meaning |
|---|---|
| Drop | One file placed in `~/MiraDrop/inbox/`. SHA-256-identified, idempotent. |
| Logical document | One Drop. One `hub_uploads.id`. Many chunks. |
| Binding | The Equipment-HAS_MANUAL relationship that ties a logical document to a tenant-confirmed Equipment entity. |
| Binding state | `model_only` (UNS path is the per-model template) or `instance_bound` (UNS path is a specific physical asset). |
| Extraction method | How manufacturer/model were resolved: `rule | llm | filename | manual`. |
| Tech confirmation | A Slack button tap by the dropping user on a Phase-4 prompt. Promotes the binding relationship to `verified_by='tech'`. |
| System consensus | Two or more corroborating sources for the same fact, with at least one source ultimately traceable to a tech or admin signal. Promotes to `verified_by='system_consensus'`. |
| Readiness level | L0–L6 from `docs/specs/maintenance-namespace-builder-spec.md` § Levels. Surfaced per drop. |

## 13. Acceptance criteria

A drop of the 33 MB Rockwell PowerFlex 525 manual (`2080-rm001_-en-e.pdf` or equivalent) succeeds end-to-end with:

- ✅ File copied into `~/MiraDrop/processing/`, never rejected for size.
- ✅ Hub never holds the full file in RAM (verified by streaming `req.body` to v2).
- ✅ `hub_uploads` row advances through phases without skips.
- ✅ Docling subprocess peaks ≤ 2 GiB RSS, returns to 0 GiB between jobs.
- ✅ At least 1 `knowledge_entries` row with `ingest_route='v2'`, `doc_id` set, `page_start IS NOT NULL`.
- ✅ Slack DM sent within 60 s of drop completion (or sooner — phase 4 fires after embedding, not after every chunk).
- ✅ Tech tap on a binding button → `kg_relationships` row with `verified_by='tech'` for the Manual binding.
- ✅ Fault-code sweep produces ≥ 5 `proposed` HAS_FAULT relationships.
- ✅ `~/MiraDrop/done/` contains the original PDF, an `ingest.json` with `status=parsed`, and a `.qr.png`.
- ✅ Confirmation DM shows a real readiness delta (not L? → L?).
- ✅ Re-dropping the same PDF byte-for-byte is a no-op (SHA-256 dedup).
- ✅ Re-dropping a modified PDF with the same manufacturer/model triggers the Phase-4b revision prompt.
