# Manual Discovery Fleet Inventory

Every automated routine that goes out and finds OEM manuals / technical bulletins / product updates, where it lives, how it's scheduled, and what it feeds. Companion tools: `mira-crawler/fleet_status.py` (runtime status) + `docs/runbooks/proving-crawler-last-run-evidence.md` (prove it ran).

**Key fact:** the whole fleet feeds the **KB (`knowledge_entries`)**, not the trust-graded drive-pack path. See `docs/drive-commander/bridge-manual-discovery-to-drive-pack-grading.md` for the missing bridge.

## Scheduler

**Trigger.dev Cloud** (project `proj_mira-ingest`, `mira-crawler/trigger/trigger.config.ts`) is the primary scheduler. Trigger tasks HTTP-POST to a **FastAPI bridge** (`mira-crawler/bridge.py`, port `:8003`, bearer `TASK_BRIDGE_API_KEY`) on Bravo/Charlie, which enqueues the Celery task. **Celery beat** (`mira-crawler/celeryconfig.py`) runs *only* the two intent scanners + historian. **System cron** (`scripts/install_crons.sh`) runs `kb_growth_cron` hourly on the VPS. **launchd** (Charlie) runs the AB manual hunter.

## The fleet (routines that discover manuals / bulletins)

| Routine | File | Schedule | Targets | Feeds |
|---|---|---|---|---|
| **Sitemap crawler** | `mira-crawler/tasks/sitemaps.py:134` | Trigger.dev hourly (`hourly.ts`) | Rockwell, ABB, Schneider, Emerson, Siemens, Danfoss, Yaskawa sitemaps; `lastmod`-change → queue | `ingest_url` → `knowledge_entries` |
| **RSS poller** | `tasks/rss.py:129` | Trigger.dev 15 min (`continuous.ts`) | 10 vendor/industry feeds (ABB News, Emerson, SKF, Fluke…) | `ingest_url` |
| **Apify OEM discovery** | `tasks/discover.py:87` | Trigger.dev weekly (`weekly.ts` `weekly-discovery`) | 9 OEM literature sites → PDF URLs | `ingest_url` |
| **AB manual hunter** | `scripts/ab_manual_hunter/run.py` | launchd every 6 h (Charlie) — **DRY-RUN** default | Rockwell/Allen-Bradley literature CDN | `~/MiraDrop/inbox/` → drop-watcher → Hub node-ingest |
| **Playwright JS crawler** | `tasks/playwright_crawler.py:176` | Trigger.dev callable | 8 allowlisted OEM doc domains | `ingest_url` / inline |
| **ManualsLib scraper** | `tasks/manualslib_scraper.py` | Celery/CLI | ManualsLib + CDN PDFs | `ingest_text_inline` |
| **GDrive sync** | `tasks/gdrive.py:101` | Trigger.dev 15 min + nightly | watch folder PDFs | `ingest_url` |
| **Foundational** | `tasks/foundational.py` | Trigger.dev monthly | OSHA/NEC standards, textbooks (direct URLs) | `ingest_url` |
| **Freshness audit** | `tasks/freshness.py:228` | Trigger.dev weekly | re-queues KB rows past TTL (manual=365 d) | recrawl |
| **kb_growth_cron** | `cron/kb_growth_cron.py` | system cron hourly (VPS) | drains `manual_queue.json` | `full_ingest_pipeline` → `knowledge_entries` + KG |
| **Manual-cache seed** | `mira-core/scripts/seed_manual_cache.py` | manual CLI | CDN PDFs bypassing blocked crawlers | `manual_cache` → queue |

Adjacent (not manuals): patents `tasks/patents.py` (monthly), reddit/youtube (weekly/nightly). **Lead-gen, not documents:** `tasks/reddit_intent.py`, `tasks/youtube_intent.py` (Celery beat).

## Guardrails

- **STOP_INGEST** kill switch: `~/.mira/STOP_INGEST` — the AB hunter + guardrails check it. Sentinel first-line `AUTO_PAUSED_BY_GUARDRAILS` = auto-set; bare = operator.
- **ingest_guardrails** (`scripts/ingest_guardrails.py`, launchd every 15 min): watches disk/mem/MiraDrop-depth/hunter-fail-rate → writes `~/.mira/guardrails-state.json` + STOP_INGEST on threshold.

## Status vocabulary (what "built" vs "running" means here)

`built_and_firing` · `built_but_needs_runtime_proof` · `built_but_dry_run_only` (AB hunter today) · `validate_only` (`seed-oem-manuals.yml`) · `proposed_not_deployed` (the daily KB-health Cloud Routine in `wiki/references/routines.md`) · `dead_or_superseded` (ManualsLib viewer, removed `nightly-manuals`) · `unknown_needs_operator_verification`. **Never claim "firing" without a runtime artifact** — use `fleet_status.py`.
