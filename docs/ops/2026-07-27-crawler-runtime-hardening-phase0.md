# Bravo Crawler Runtime Hardening — Phase 0 report + execution plan

**Date:** 2026-07-27 · **Node:** Bravo · **Branch:** `ops/crawler-runtime-hardening` (off `origin/main` `fa12ff6e5`)
**Status:** Phase 0 (inspect + record truth) COMPLETE. Tiers A/B/C not yet started (paused on context budget).
No host changes made in this task. Production daemon untouched — still on pinned SHA below.

## Phase 0 — recorded truth (runtime, read-only, no secrets)

| Fact | Value |
|---|---|
| Prod worktree | `/Users/bravonode/mira-crawler-prod/mira-crawler` |
| Prod worktree SHA (pinned, detached) | `c90abb4a784eabde618b0d1bb78fcd092d41cdcb` |
| Dev checkout | `/Users/bravonode/Mira` — branch `chore/drive-pack-faultcode-runA-baseline`, **50 changed tracked files (foreign WIP — DO NOT TOUCH)** |
| LaunchAgent | `~/Library/LaunchAgents/com.mira.crawler.plist` |
| Plist backup (rollback) | `~/Library/LaunchAgents/com.mira.crawler.plist.bak-20260727T055916Z` |
| Daemon PID (launchd top = doppler wrapper) | 59498 (python child under it), exit 0, stable |
| Live python cwd | `/Users/bravonode/mira-crawler-prod/mira-crawler` ✅ |
| Python | 3.12.13 (uv-managed cpython, `~/.local/share/uv/python/...`) |
| `.venv` symlink → | `/Users/bravonode/Mira/mira-crawler/.venv` (OLD checkout) |
| `data/` symlink → | `/Users/bravonode/Mira/mira-crawler/data` (OLD checkout, 234M) |
| Plist ProgramArguments | `/bin/bash -l -c <prod-worktree>/mira-crawler/run.sh` |
| Env vars (names only) | `DOPPLER_TOKEN` (secret — never print/commit), `PATH`. run.sh also exports `CRAWLER_CACHE_DIR`, `DEDUP_DB_PATH`, `INCOMING_WATCH_DIR`, `OLLAMA_BASE_URL` (all `$SCRIPT_DIR/data/...`). App env via `doppler run --project factorylm --config prd`. |
| Single daemon? | YES — one `com.mira.crawler` job, one python process. |

`run.sh` execs `doppler run --project factorylm --config prd -- .venv/bin/python main.py`.

## The 9 scheduled jobs (from `main.py::_setup_scheduler`, verified in code + live log)

| # | job id | name | trigger | entry point | source |
|---|---|---|---|---|---|
| 1 | `crawl_abb` | Crawl abb | cron 01:00 daily | `_run_manufacturer_crawl(cfg,['abb'])` → `ManufacturerCrawler` | manufacturer |
| 2 | `crawl_fanuc` | Crawl fanuc | cron 02:00 | ″ | manufacturer |
| 3 | `crawl_kuka` | Crawl kuka | cron 03:00 | ″ | manufacturer |
| 4 | `crawl_siemens` | Crawl siemens | cron 04:00 | ″ | manufacturer |
| 5 | `crawl_rockwell` | Crawl rockwell | cron 05:00 | ″ | manufacturer |
| 6 | `crawl_automationdirect` | Crawl automationdirect | cron 05:30 | ″ | manufacturer |
| 7 | `crawl_curriculum` | Crawl all curriculum sources | cron Sun 06:00 | `_run_curriculum_crawl` → `CurriculumCrawler` | curriculum |
| 8 | `generate_report` | Generate weekly crawl report | cron Mon 07:00 | `_run_report` → `crawler.report.generate_report` | dedup DB → `cache/crawl_report.md` |
| 9 | `healthcheck` | Health check | interval 30 min | `main.healthcheck()` → **only** `CrawlerConfig()` construct | (the "registration ≠ success" trap; Phase 3 fixes per-job success) |

Plus a **FolderWatcher** on `config.incoming_dir` → `_ingest_file` (read→dedup→docling/pdfplumber parse→chunk→ollama embed→`store_chunks`→Neon; dedup via `ingest.dedup.DedupStore` on `config.dedup_db_path`). Manufacturer/curriculum crawls in recent logs discover **0 URLs** (expected — sources exhausted / gated), which is **healthy "0 new", not failure**.

## Dependency landscape (Phase 2 crux — evidence)

- **No canonical host-daemon manifest.** Root `pyproject.toml` = only `[tool.ruff|pytest|coverage|hypothesis]` (NO `[project]`/deps). Root `uv.lock` = 52-byte stub. `mira-crawler/requirements-celery.txt` is for the **celery** entrypoint (Dockerfile.celery), NOT `main.py` (which also needs docling, apscheduler, watchdog, pdfplumber, sqlalchemy, httpx, ollama/embedder deps).
- The live `mira-crawler/.venv` (uv, py3.12.13) is the **only source of truth** for the host daemon's working set.
- **Phase 2 approach (advisor-blessed):** derive DIRECT deps from the crawler import graph, pin + lock; use `uv pip freeze` of the live venv as the **oracle** to confirm the locked resolution reproduces the exact live versions (esp. docling / pdfplumber / apscheduler — version drift changes parsing). Build the new venv at `/Users/bravonode/mira-crawler-prod/.venv`. **Cutover only if all gates pass; otherwise DEFER with a ready procedure** (user prefers defer over guessing).

## Existing evidence mechanism (extend, do NOT duplicate — Phase 3)

`docs/runbooks/proving-crawler-last-run-evidence.md` + `mira-crawler/fleet_status.py` already aggregate last-run evidence from local artifacts (`manual_queue.json`, `~/.mira/ab-hunter/run-*.json`, `~/.mira/guardrails-state.json`, `/tmp/mira_heartbeat.json`, Redis dedup set sizes). `mira-crawler/metrics/latency.py::IngestLatencyRecorder` records per-ingest stage metrics. **Phase 3 heartbeat must extend this fleet/latency evidence, not create a parallel store.** (Not yet read in full — do so first.)

## Execution plan (sequenced by deployability)

- **Tier A — repo PR, ZERO host effect (do first, all in THIS worktree `/Users/bravonode/mira-crawler-hardening`):**
  - Phase 1: crawler docs (9 jobs, flow, dedup, aliases, novice architecture, Bravo-sole-host note) + hermetic job/schedule-registry tests.
  - Phase 3: heartbeat + `health` CLI **code + hermetic tests**, extending fleet_status/latency evidence. Health CLI degrades gracefully (cold start = "no evidence yet", never crash/unhealthy); distinguishes ran-0-new / failed / never-started.
  - Phase 4: watchdog template + installer + ops docs (rollback/uninstall). No secrets in committed plist.
  - Phase 5: `data/` relocation assessment → written plan; **DEFER execution** (evidence on writer/locking incomplete; defer preferred).
  - Version/CHANGELOG per repo policy. Open PR. **Do NOT merge.**
- **Tier B — runtime-only, reversible (LAST): Phase 2 venv cutover** at `/Users/bravonode/mira-crawler-prod/.venv`, atomic symlink/interp swap, only if the full gate passes; else defer. Preserve old `.venv` + `data/`.
- **Tier C — SHA-changing deploy: FORBIDDEN this session** ("keep current SHA until reviewed + intentionally deployed"). Deploying the heartbeat-emitting `main.py` and installing the watchdog that calls the new CLI = a reviewed follow-up after the PR merges.

## Hard constraints (carry forward)
- Repo/PR edits ONLY in `/Users/bravonode/mira-crawler-hardening` — NEVER in the prod worktree (daemon runs from it) and NEVER in the dev checkout.
- No B2 / Slice C / migrations / backfills / recrawl / new manufacturers / paid calls / model training / VPS crawler deploy.
- Preserve `DOPPLER_TOKEN` + rollback backup; never print/commit secrets. Keep prod on `c90abb4a7`.
- Rollback (venv/plist): `launchctl unload ~/Library/LaunchAgents/com.mira.crawler.plist && cp <bak> ~/…plist && launchctl load ~/…plist`.
