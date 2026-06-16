# mira-crawler Specification
**Version:** 1.0
**Last Updated:** 2026-05-05
**Owner:** Mike Harper / FactoryLM

## Purpose
Celery-based ingestion fleet that **discovers, downloads, parses, and chunks OEM manuals + supporting docs** into NeonDB so the diagnostic engine has knowledge to retrieve. It also ingests YouTube transcripts, RSS feeds, Reddit threads, and LinkedIn signals; reports weekly digests; and runs the inbox-triage agent. This is the engine that feeds the **flywheel** described in `NORTH_STAR.md` — without crawler ingest, MIRA's answers degrade.

## Scope
**IN scope**
- 13 Celery agents under `mira-crawler/agents/` and `mira-crawler/tasks/` (discover, freshness, ingest, RSS, social, YouTube, foundational, playwright_crawler, inbox_triage, etc.)
- Bridge process (`bridge.py`), Celery beat schedule (`celeryconfig.py`)
- LinkedIn pipeline (`linkedin/`), social ingest (`social/`)
- Reporting: `reporting/agent_report.py`, `reporting/weekly_digest.py`, `reporting/telegram_notify.py`
- Sources manifest (`sources.yaml`), manual scrape targets (`manual_scrape_targets.csv`)

**OUT of scope**
- Photo ingestion (`mira-ingest`)
- Retrieval at query time (`mira-bots/shared` RAGWorker)
- Knowledge graph triple extraction at runtime (planned, see `kg-graph-spec.md`)

## Architecture
- **Layer:** Infrastructure
- **Containers:** `mira-celery-worker`, `mira-celery-beat` (no exposed ports)
- **Broker:** Redis
- **Result store:** NeonDB
- **External deps:** Ollama (embeddings), NeonDB, Playwright, optional Docling
- **Schedule:** Cron-driven beat. E.g., `discover_manuals.py` runs Sundays 03:00.

```
Beat schedule ──▶ Tasks (discover, download, extract, chunk, embed, insert)
                     │
                     ├── pdfplumber / Docling → blocks
                     ├── chunker.py → chunks (≥ MIN_CHUNK_CHARS)
                     ├── Ollama (nomic-embed-text-v1.5) → 768-d vectors
                     └── NeonDB.insert_knowledge_entry()
```

## API Contract

### Internal (Celery tasks)
| Task | File | Purpose |
|---|---|---|
| `tasks.discover.discover_manuals` | `tasks/discover.py` | Insert URLs into `manual_cache` |
| `tasks.ingest.process_url` | `tasks/ingest.py` | Download → extract → chunk → embed → insert |
| `tasks.full_ingest_pipeline.*` | — | Orchestrates the whole flywheel run |
| `tasks.rss.poll_feeds` | `tasks/rss.py` | RSS for OEM news |
| `tasks.youtube.process_video` | `tasks/youtube.py` | Transcript ingest |
| `tasks.social.harvest_*` | `tasks/social.py` | Reddit/LinkedIn signals |
| `tasks.foundational.refresh_corpus` | `tasks/foundational.py` | Refresh case corpus |
| `tasks.freshness.recheck_sources` | `tasks/freshness.py` | Re-validate source URLs |
| `tasks.playwright_crawler.fetch` | `tasks/playwright_crawler.py` | JS-rendered pages |
| `agents.inbox_triage.run` | `agents/inbox_triage.py` | Triage incoming docs |

### External (reporting)
- Weekly digest posted to `#alpha-status` and the operator's Telegram via `reporting/telegram_notify.py`.

## Configuration
| Var | Default | Purpose |
|---|---|---|
| `NEON_DATABASE_URL` | required | Sink |
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | Embedding model host |
| `EMBED_MODEL` | `nomic-embed-text-v1.5` | 768-d text embedder |
| `USE_DOCLING` | `false` | Use Docling adapter for OCR + semantic parsing |
| `DOWNLOAD_TIMEOUT` | `60` (s) | HTTP fetch timeout |
| `REQUEST_DELAY` | `0.5` (s) | Politeness delay |
| `MAX_PDF_PAGES` | `300` | Skip enormous manuals |
| `MIN_CHUNK_CHARS` | `80` | Drop micro-chunks |
| `LEAD_HUNTER_TIMEOUT_SECS` | `1500` | Hard cap on hourly run |
| `HARDENING_LOCK_DIR` | `/tmp` | Singleton lock dir |
| `DISCORD_ALERT_WEBHOOK` | optional | Degraded-run alerts |

## Quality Standards
| Metric | Current | Target |
|---|---|---|
| Test files | 22 | maintain + ratchet coverage |
| Type checking | not included | pyright basic |
| Coverage | unmeasured | 50 % |
| Successful manual ingest rate | unmeasured | ≥ 85 % per run |
| Time-to-first-chunk (1 PDF) | unmeasured | ≤ 30 s |

Domain grade: **D+**.

## Acceptance Criteria
1. **Discovery → ingest:** A new make/model pair surfaced by `discover_manuals` results in chunks landing in `knowledge_entries` within 24 h, deduplicated against existing entries.
2. **Embedding dimension:** All inserted vectors are 768-d; mismatch raises and aborts the task instead of silently inserting corrupt rows.
3. **Politeness:** No source domain is hit more than once per `REQUEST_DELAY`.
4. **Bot blocking:** A 403 returns `chunks=0`, logs the URL, and does not retry indefinitely.
5. **Docling fallback:** With `USE_DOCLING=true`, scanned-image PDFs produce non-empty chunks.
6. **Inbox triage:** A new file in the queue is classified as relevant/irrelevant; irrelevant files are not embedded.
7. **Weekly digest:** Sunday 02:00 produces a Telegram digest covering the week's discovered, ingested, dropped, and failed sources.
8. **Lock contention:** Two simultaneous `lead-hunter` runs result in exactly one acquiring the lock; the other exits cleanly within 5 s.

## Known Issues
- Coverage and type checking are unmeasured — domain grade D+.
- pdfplumber flattens tables to prose (loses column structure); Docling required for table-heavy manuals.
- Sites with strict bot blocking are silently underrepresented.
- 13 agents — single-author cognitive load is high; favor reuse via `tasks/full_ingest_pipeline.py`.

## Change Log
- 2026-04 — Inbox triage agent added (`agents/inbox_triage.py`).
- 2026-04 — Lead-hunter hardening (timeout, lock, Discord webhook).
- 2026-03 — Docling optional adapter introduced.
