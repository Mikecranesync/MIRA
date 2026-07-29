# MIRA crawler — runtime reference (how the daemon actually runs)

**Audience:** an operator or engineer who has never touched this service and
needs to answer "what runs, when, where, and how do I tell if it's healthy?"
**Companion:** `docs/ops/2026-07-27-crawler-runtime-hardening-phase0.md` (the
one-time Phase-0 inspection: live SHA, PIDs, symlinks). This doc is the durable
"how it works"; that one is the dated "what the box looked like on 2026-07-27".

---

## One-paragraph mental model

The crawler is a single long-running Python process (`main.py`) that does two
independent things: (1) a **scheduler** fires timed crawl jobs that discover and
ingest OEM/curriculum documents into the knowledge base, and (2) a **folder
watcher** ingests any PDF dropped into the incoming directory. Everything it
learns lands as embedded, deduplicated chunks in NeonDB. It runs on **exactly
one node — Bravo** — under a launchd LaunchAgent, wrapped by Doppler for secrets.

```
                         ┌──────────────────────── main.py (one process) ────────────────────────┐
                         │                                                                        │
  cron/interval  ──────► │  APScheduler ──► _run_registered_job(spec) ──► crawl/report/healthcheck│
  (9 jobs)               │        │                     │                                          │
                         │        │                     └──► metrics/heartbeat.py (per-job JSONL)   │
                         │        │                                                                 │
  ~/…/incoming/*.pdf ──► │  FolderWatcher ──► _ingest_file ──► read→dedup→parse→chunk→embed→store   │
                         │                                            │                  │          │
                         └────────────────────────────────────────── │ ──────────────── │ ─────────┘
                                                                      ▼                  ▼
                                                        DedupStore (SQLite)      NeonDB knowledge_entries
                                                                                        ▲
                            health.py  ◄── reads heartbeat + job_registry ── judges ────┘ (schedule liveness)
```

---

## Where it runs (Bravo is the sole host)

- **Node:** Bravo only. There is **no second crawler** anywhere — running a
  second one against the same dedup DB / NeonDB tenant would double-ingest and
  corrupt the "already indexed" accounting. Do not start one on Charlie/Alpha/VPS.
- **Process:** one launchd job `com.mira.crawler` → `run.sh` →
  `doppler run --project factorylm --config prd -- .venv/bin/python main.py`.
- **Secrets:** the app's env (NeonDB URL, tenant id, Ollama URL) comes from
  Doppler `factorylm/prd`. Nothing secret is committed.
- **State on disk:** `data/` holds the dedup SQLite DB, the crawl cache/report,
  and the append-only evidence logs (`ingest_latency.jsonl`, `job_heartbeat.jsonl`).

---

## The 9 scheduled jobs

The schedule is **data**, defined once in `mira-crawler/job_registry.py` and
consumed by both `main._setup_scheduler` (which registers them) and `health.py`
(which judges them). Change the schedule there, not in two places.

| # | job id | trigger | what it does |
|---|---|---|---|
| 1 | `crawl_abb` | daily 01:00 | manufacturer crawl (ABB) |
| 2 | `crawl_fanuc` | daily 02:00 | manufacturer crawl (FANUC) |
| 3 | `crawl_kuka` | daily 03:00 | manufacturer crawl (KUKA) |
| 4 | `crawl_siemens` | daily 04:00 | manufacturer crawl (Siemens) |
| 5 | `crawl_rockwell` | daily 05:00 | manufacturer crawl (Rockwell) |
| 6 | `crawl_automationdirect` | daily 05:30 | manufacturer crawl (AutomationDirect) |
| 7 | `crawl_curriculum` | weekly Sun 06:00 | curriculum-source crawl |
| 8 | `generate_report` | weekly Mon 07:00 | write `cache/crawl_report.md` from the dedup DB |
| 9 | `healthcheck` | every 30 min | liveness sentinel (proves the scheduler thread is alive) |

**"0 URLs discovered" is healthy, not broken.** Manufacturer/curriculum sources
are often exhausted or gated on a given night, so a crawl legitimately stores
nothing new. That is recorded as `no_new`, distinct from a real `failed`.

---

## The ingest pipeline (both the crawl jobs and the folder watcher feed it)

`_ingest_file` (folder watcher) and each crawler's `process()` run the same
shape, instrumented per-stage by `metrics/latency.py`:

1. **read** — load the document bytes.
2. **dedup** — `ingest/dedup.py::DedupStore.is_already_indexed`: an **md5** hash
   of the file bytes is looked up in the `ingested_docs` SQLite table. Already
   seen → skip. This is what makes re-crawls cheap and idempotent.
3. **parse** — docling (if `USE_DOCLING`) with a pdfplumber fallback, else
   pdfplumber, into text blocks.
4. **chunk** — `ingest/chunker.py` splits blocks into `chunk_min_chars`..
   `chunk_max_chars` chunks, each tagged with source metadata.
5. **embed** — `ingest/embedder.py` calls Ollama (`nomic-embed-text`, 768-dim).
   Chunks whose embedding fails are dropped; all-fail is recorded `embed_failed`.
6. **store** — `ingest/store.py::store_chunks` writes to NeonDB
   `knowledge_entries` under the crawler's tenant; `mark_indexed` records the
   md5 so the next pass dedups it.

### Manufacturer name normalization (ingest side)

`ingest/manufacturer_normalize.py::normalize_manufacturer` collapses **OCR /
extraction misspellings** of a vendor toward the cleanest spelling and agrees
with the query-side `VENDOR_ALIASES` in `mira-bots/shared/uns_resolver.py`
(locked by `tests/test_manufacturer_alias_consistency.py`). It deliberately does
**not** do brand→parent canonicalization (e.g. "Allen-Bradley"→"Rockwell") —
that is a separate catalog/resolver concern (#1596). Unknown vendors flow
straight through `uns.slug()` on both sides.

---

## Is it healthy? (the evidence, not a guess)

Two append-only JSONL evidence logs under `data/`, plus two read-only tools.
Neither tool writes, calls the network, or touches the fieldbus.

- **`job_heartbeat.jsonl`** — one row per scheduled-job run: `ok` (did work),
  `no_new` (ran, nothing new — healthy), or `failed` (raised / all URLs errored).
  This replaces the old trap where the 30-min healthcheck only proved
  `CrawlerConfig()` constructs — "registered" is not "ran successfully".
- **`ingest_latency.jsonl`** — per-document stage timings (read/dedup/parse/…).

Run the health CLI (dependency-free — safe to shell out to from a watchdog):

```bash
cd mira-crawler && python health.py          # human-readable
cd mira-crawler && python health.py --json    # machine-readable, exit 1 if degraded
```

How it judges each job (`health.py` vs `job_registry` cadence):

| verdict | meaning |
|---|---|
| `healthy` | ran within its stale window and did work |
| `healthy_no_new` | ran within its window, nothing new to store |
| `never_ran` | no heartbeat yet (fresh deploy, or a weekly job not yet due) — **not** a failure |
| `stale` | silent past its window (daily > 2d, weekly > 9d, healthcheck > 40m) |
| `failed` | last run raised or every discovered URL errored |

**Overall:** `degraded` (exit 1) if any job is `failed` or `stale`;
`no_evidence_yet` (exit 0) on a cold start with no heartbeats — a fresh box is
never reported "unhealthy"; otherwise `healthy`. The **30-minute healthcheck
going `stale` is the daemon-dead signal** — its 40-minute window is far tighter
than any crawl job, so a wedged scheduler is caught within the hour.

For off-box evidence (Redis dedup set sizes, NeonDB freshness) see
`fleet_status.py --commands` and `docs/runbooks/proving-crawler-last-run-evidence.md`.

---

## Cross-references

- `mira-crawler/job_registry.py` — the 9 jobs as data (single source of truth).
- `mira-crawler/health.py` / `mira-crawler/metrics/heartbeat.py` — the health CLI + evidence.
- `mira-crawler/fleet_status.py` — the manual-discovery fleet view (off-box evidence).
- `docs/ops/2026-07-27-crawler-runtime-hardening-phase0.md` — the dated Phase-0 inspection.
- `docs/ops/crawler-watchdog.md` — the detection-only watchdog (template + install/rollback).
