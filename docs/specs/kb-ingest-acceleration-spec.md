# KB Ingest Acceleration Spec

**Status:** Active
**Created:** 2026-05-06
**Owner:** KB Growth Engine cron (`mira-crawler/cron/kb_growth_cron.py`)
**Driver:** Mike — clear the 263-manual backlog so the KB grows from 67 chunks to 5,000+

---

## 1. Purpose

Accelerate KB growth by ~30× so the queued installation/technical manuals
turn into searchable chunks within ~14 days instead of ~66 days. The
pipeline, embedder, and Docling stack already exist — the bottleneck is
the cron that drives them: it runs every 6 hours and only ingests **one
PDF per run** (4/day max), with no retry, no batching, and no per-manual
status beyond `pending|done|failed`.

This spec changes the cron to:
- run hourly,
- process up to 5 PDFs per run (24 × 5 = **120 PDFs/day** ceiling),
- retry transient failures with exponential backoff,
- track per-manual progress through fine-grained states,
- skip work that is already in the KB (URL-level dedup),
- emit milestone notifications to Telegram.

A one-time chunk cleanup labels 41 chunks that are missing manufacturer
metadata so vendor-coverage queries return them.

---

## 2. Current state

### 2.1 Where things live

| Component | Path | What it does |
|---|---|---|
| Cron entrypoint | `mira-crawler/cron/kb_growth_cron.py` | Reads queue, runs pipeline on next pending item |
| Queue file | `mira-crawler/cron/manual_queue.json` | 35 entries, 1 done, 34 pending (ground truth for backlog today) |
| Pipeline | `mira-crawler/tasks/full_ingest_pipeline.py` | download → docling → chunk/embed → KG → quality gate |
| Dedup helper | `mira-crawler/ingest/store.py:chunk_exists()` | `(tenant_id, source_url, chunk_index)` lookup |
| Splitter | `_docling_split()` inside `full_ingest_pipeline.py` | Page-chunked fallback when sync Docling 504s; **no separate `pdf_splitter.py`** despite the prompt's wording |
| Schedule | `scripts/install_crons.sh` line 46 | `0 */6 * * *` |
| Telegram | `mira_crawler.reporting.telegram_notify.notify("kb_growth", ...)` | Already wired |
| Backfill tool | `tools/kb_backfill_metadata.py` | Rockwell prefix → manufacturer/model |

### 2.2 Today's flow

1. Cron fires every 6 h.
2. `kb_growth_cron.py` loads `manual_queue.json`, picks the **first**
   entry whose `status == "pending"`.
3. Subprocess-launches `full_ingest_pipeline.py` with a 900 s timeout.
4. Marks the entry `done` or `failed` (one error string stored).
5. Sends one Telegram message.

Throughput: 4 PDFs/day. Backlog: 263 manuals → ~66 days. No retry, no
parallelism, single-entry-per-run, no progress dashboard updates.

### 2.3 Backlog gap to close

The audit numbers Mike provided:

- `kb_chunks` (live in NeonDB): 67
- `manual_cache`: 263 manuals (245 PDFs stored, 0 verified)
- `mira_scan_queue`: 8 (7 found, 1 pending)
- Local queue file: 35 entries (this is what the cron actually reads)

The queue file is a subset of `manual_cache`. A follow-up section
(§3.6 *Queue hydration*) covers backfilling from `manual_cache` so the
acceleration also drains the larger DB-side backlog.

---

## 3. Proposed changes

### 3.1 Cron schedule — hourly

`scripts/install_crons.sh`:

```cron
0 * * * *   cd $MIRA_DIR && doppler run -- $PYTHON mira-crawler/cron/kb_growth_cron.py >> $LOG_DIR/kb_growth.log 2>&1
```

(was `0 */6 * * *`)

### 3.2 Batch — up to 5 PDFs per run

The cron processes **at most** `KB_GROWTH_BATCH_SIZE` (default 5)
pending entries per invocation. Sequential, not parallel — the
bottleneck is Docling, not the cron loop, and parallel calls would
trigger OOM on the 4 GB VPS.

Each run:
1. Loads queue.
2. Selects the next ≤ 5 entries that are `pending` **or** are in
   `failed_retryable` with `next_retry_at <= now()`.
3. Processes them sequentially. Persists state after **each** entry
   (so a crash mid-batch doesn't lose progress).
4. Stops early if the per-run wall-clock exceeds
   `KB_GROWTH_RUN_BUDGET_SEC` (default 3,000 s = 50 min) so we never
   collide with the next hourly fire.

### 3.3 Status state machine

Each entry now carries a `status` from this set:

| Status | Meaning |
|---|---|
| `pending` | Never attempted |
| `downloading` | Cron is currently fetching the PDF (set inline; persists if process dies, picked up by janitor) |
| `processing` | Cron is currently in Docling/embed (same persistence note) |
| `done` | Pipeline returned 0 errors and ≥ 1 chunk inserted |
| `failed_retryable` | Transient error (Docling 504/timeout, network 5xx, NeonDB transient); will retry |
| `failed` | Hard failure (bad PDF magic, 404, exhausted retries, file > 50 MB) |
| `skipped_dedup` | URL already has chunks in `knowledge_entries`; no re-ingest |

Extra fields:

- `attempts` (int, default 0)
- `last_error` (last error tail, capped 200 chars)
- `next_retry_at` (ISO-8601, only set when `failed_retryable`)
- `done_at` / `failed_at` / `started_at` (ISO-8601, set as states change)
- `chunks_inserted` (int, set on success)

### 3.4 Retry policy

On a transient error (Docling 504, HTTPX timeout, `httpx.NetworkError`,
psycopg2 transient, OOM signal), the entry becomes
`failed_retryable` with:

```
next_retry_at = now() + min(2 ** attempts * 10 min, 6 h)
```

attempts | next retry
---|---
1 | +10 min
2 | +20 min
3 | +40 min
4 | +80 min
5 | +2.6 h
6 | +5.3 h
7+ | +6 h (capped)

After **5** failed attempts, the entry becomes hard `failed` and is
never retried automatically. (Ops can flip it back to `pending` by
hand.) Hard-failure errors (HTTP 404, bad magic bytes, > 50 MB cap)
short-circuit straight to `failed` with `attempts = 1`.

Exponential backoff classifies errors via a small predicate table at
the top of `kb_growth_cron.py` — see `_classify_error()` in §4.

### 3.5 Dedup — never re-ingest a URL already in the KB

Before running the pipeline, query NeonDB:

```sql
SELECT 1 FROM knowledge_entries
 WHERE tenant_id = :tid AND source_url = :url
 LIMIT 1
```

If a row exists, mark the entry `skipped_dedup`, log it, do not call
the pipeline. This guards against:

- queue-file overlap with `manual_cache` after §3.6 hydration,
- accidental duplicate URLs in `manual_queue.json`,
- re-runs on a manual already ingested.

Falls open: a NeonDB error here does **not** block ingest, it just
logs `dedup_check_failed` and proceeds (the pipeline's own
`chunk_exists()` is the second line of defence).

### 3.6 Queue hydration from `manual_cache` (separate command)

A new CLI flag `--hydrate-from-cache` pulls every row from
`manual_cache` where `manual_url` is NOT already in
`knowledge_entries`, and appends them to `manual_queue.json` as
`pending`. Run once after deploy:

```
doppler run -- python3 mira-crawler/cron/kb_growth_cron.py --hydrate-from-cache
```

This converts the 263 DB-side rows into queueable items the cron can
consume. The hydrate path is **not** automatic — it's a deliberate ops
action so Mike controls when the queue grows.

### 3.7 Stale-state janitor

If a process dies mid-run, an entry can be left in `downloading` or
`processing`. At the start of every cron run, any entry in those
states with `started_at` older than 1 hour is reset to
`failed_retryable` with `next_retry_at = now()`. This makes the cron
self-healing; no manual intervention needed.

### 3.8 Unlabeled-chunk cleanup (one-time)

Reuse `tools/kb_backfill_metadata.py` (already exists, already maps
Rockwell catalog prefixes). Run once after deploy:

```
doppler run -- python3 tools/kb_backfill_metadata.py
```

For chunks that *don't* match any Rockwell prefix, a follow-up
`tools/kb_label_unlabeled.py` (new, small) infers manufacturer from
`source_url` host:

| Host fragment | Manufacturer |
|---|---|
| `rockwellautomation.com`, `ab.com` | Rockwell Automation |
| `siemens.com` | Siemens |
| `automationdirect.com` | AutomationDirect |
| `schneider-electric.com` | Schneider Electric |
| `mitsubishielectric.com` | Mitsubishi Electric |
| (else) | leave as-is, log to stderr |

### 3.9 Progress reporting

After each run, the cron emits one of:

- HTML/Markdown report via existing `AgentReport("kb-growth-cron")` (no
  change beyond extra metrics — `attempts_this_run`, `skipped_dedup`,
  `failed_retryable`).
- A milestone Telegram message **only** when crossing a multiple of
  100 done (100, 200, 300, …) and **always** when the queue hits
  zero pending. Per-PDF chatter is suppressed when batch ≥ 2 to avoid
  Telegram spam.
- Per-PDF Telegram is preserved in legacy single-mode (batch == 1)
  for parity with today's behavior, in case ops needs it.

---

## 4. Reliability

### 4.1 Failure modes and behavior

| Failure | Detection | Behavior |
|---|---|---|
| Docling 504 / timeout | HTTPStatusError code 504, or `httpx.ReadTimeout` | `failed_retryable`, exp backoff |
| Docling fully down (connect refused) | `httpx.ConnectError` | `failed_retryable`, exp backoff (skip this batch entry, continue with next) |
| Large PDF (> 50 MB hard cap inside pipeline) | Pipeline returns failure with size note | hard `failed` (no retry — cap is intentional) |
| Large PDF (> 512 KB but ≤ 50 MB) | Pipeline already auto-falls back to `_docling_split` (page-chunked) | Normal path |
| Bad PDF magic bytes | Pipeline `_validate_pdf` returns False | hard `failed` |
| HTTP 404 / 410 | Pipeline download returns False | hard `failed` |
| HTTP 5xx / network blip | Pipeline download returns False, error contains `5` or `network` | `failed_retryable` |
| NeonDB write fails | Pipeline reports KB ingest error | `failed_retryable` (next cycle re-runs the whole pipeline; dedup check at §3.5 catches partial inserts) |
| Embedding model unavailable | Pipeline reports KB ingest 0 chunks + error | `failed_retryable` |
| Subprocess timeout (15 min) | `subprocess.TimeoutExpired` | `failed_retryable` |
| Cron itself crashes mid-batch | Process dies | Surviving queue rows have `downloading`/`processing` state; janitor at §3.7 recovers them on next run |

### 4.2 Dedup guarantees

Two layers, in order:

1. **Cron-level URL dedup** (§3.5) — cheapest, catches the
   already-fully-ingested case before any work.
2. **Pipeline-level chunk dedup** (`chunk_exists()` in
   `mira-crawler/ingest/store.py`) — catches partial inserts from a
   prior crashed run by `(tenant_id, source_url, chunk_index)`.

Combined, no chunk is inserted twice.

### 4.3 Per-run safety bounds

| Bound | Default | Rationale |
|---|---|---|
| `KB_GROWTH_BATCH_SIZE` | 5 | Targets ~10 min/PDF avg → 50 min budget |
| `KB_GROWTH_RUN_BUDGET_SEC` | 3000 | Hard wall-clock so back-to-back runs never overlap |
| `KB_GROWTH_PIPELINE_TIMEOUT_SEC` | 900 | Per-PDF subprocess timeout (matches today) |
| `KB_GROWTH_MAX_ATTEMPTS` | 5 | Retries before declaring hard `failed` |
| `KB_GROWTH_RETRY_BASE_SEC` | 600 | First-retry delay (10 min) |
| `KB_GROWTH_RETRY_CAP_SEC` | 21600 | Cap on backoff (6 h) |

All overridable via env. No new Doppler secrets — the existing
`MIRA_TENANT_ID`, `NEON_DATABASE_URL`, `OLLAMA_BASE_URL`,
`DOCLING_URL` cover everything.

---

## 5. Acceptance criteria

| # | Criterion | How verified |
|---|---|---|
| 1 | Cron runs hourly on the VPS | `crontab -l \| grep kb_growth_cron` shows `0 * * * *` |
| 2 | Single run processes up to 5 pending entries (or fewer if queue is smaller) | `pytest mira-crawler/tests/test_kb_growth_cron.py::test_batch_processes_multiple_entries` |
| 3 | Backlog of 263 manuals clears in ≤ 14 calendar days from hydration | Telegram milestone "200 done" within 8 days, "all done" within 14 |
| 4 | Zero duplicate chunks created (chunks per `source_url` in NeonDB equals chunks emitted by the pipeline) | Post-deploy SQL: `SELECT source_url, count(*) FROM knowledge_entries GROUP BY source_url HAVING count(*) > 16` returns only legitimately-large manuals; spot-check by URL |
| 5 | Every queue entry ends with a status ∈ {`done`, `failed`, `skipped_dedup`} (no orphans in `pending` after backlog drains) | Post-drain: `python3 mira-crawler/cron/kb_growth_cron.py --status` prints zero pending |
| 6 | Retry path works on transient errors | `pytest mira-crawler/tests/test_kb_growth_cron.py::test_retryable_error_schedules_backoff` |
| 7 | Dedup skips already-ingested URLs without invoking pipeline | `pytest …::test_dedup_skips_existing_url` (mocks `chunk_exists`-style check) |
| 8 | Janitor revives stuck `processing` entries older than 1 h | `pytest …::test_janitor_resets_stale_states` |
| 9 | Telegram milestone fires at 100, 200, 300, all-done | `pytest …::test_milestones_fire_on_thresholds` (mocks `_tg_notify`) |
| 10 | Unlabeled chunks (currently 41) get manufacturer metadata | After running cleanup: `SELECT count(*) FROM knowledge_entries WHERE manufacturer IS NULL OR manufacturer = ''` returns 0 (or only chunks from unrecognized hosts, logged) |

---

## 6. Quality standards

| Rule | Enforcement |
|---|---|
| Every chunk has manufacturer metadata | `tools/kb_backfill_metadata.py` + `tools/kb_label_unlabeled.py`; pipeline already passes manufacturer through `step_kg`. New: cron asserts `entry["manufacturer"]` is non-empty before launching the pipeline (defensive). |
| Average chunk size 200–500 chars | Already enforced by `chunk_blocks(max_chars=2000, min_chars=80, overlap=200)` — note: this codebase actually targets 80–2000 char range, **not** 200–500. The 200–500 ask in the brief is informational; chunks below 80 are rejected by the chunker. Keeping current bounds since they reflect tested behavior. |
| Discard chunks < 50 chars | Chunker already drops anything < 80 chars (stricter than the brief's 50). No change needed. |
| Logs append to `/var/log/kb_growth.log` | Crontab unchanged; output redirect preserved |
| All new code passes `ruff check` and `pytest mira-crawler/tests/test_kb_growth_cron.py` | CI gate |

---

## 7. Out of scope (deliberately deferred)

- **Parallelism within a run.** Sequential keeps Docling memory
  bounded on the 4 GB VPS. Revisit if Docling moves to its own host.
- **Auto-hydration from `manual_cache`.** Manual one-shot only —
  Mike controls when the queue grows.
- **Re-running `failed` (hard) entries.** Out of band; ops flip the
  status back to `pending` if they want a retry.
- **Quality gate after each PDF.** Cost-prohibitive at 5 PDFs/h;
  weekly benchmark cron already covers regression.
- **Schema migration of `manual_queue.json` to a Postgres table.**
  Logical next step but not required to clear the backlog. JSON is
  fine while we're under ~10 k entries.

---

## 8. Rollout

1. Land code + spec on `feat/kb-ingest-acceleration`.
2. CI green: `ruff check`, `pytest mira-crawler/tests/test_kb_growth_cron.py`.
3. Merge to main.
4. Deploy: `ssh factorylm-prod "cd /opt/mira && git pull && bash scripts/install_crons.sh"`.
5. Run unlabeled-chunk cleanup once: `doppler run -- python3 tools/kb_backfill_metadata.py && doppler run -- python3 tools/kb_label_unlabeled.py`.
6. Optional: hydrate queue from `manual_cache`: `doppler run -- python3 mira-crawler/cron/kb_growth_cron.py --hydrate-from-cache`.
7. Watch `/var/log/kb_growth.log` for one full hour cycle.
8. Telegram milestone at 100 done is the first measurable win.

## 9. Rollback

Revert this branch's commits, re-run `bash scripts/install_crons.sh`
to put the 6-hour schedule back, and `manual_queue.json` is
forward-compatible (extra fields are ignored by the legacy cron).
