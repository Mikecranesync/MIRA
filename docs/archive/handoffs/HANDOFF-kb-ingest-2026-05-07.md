# HANDOFF — KB Ingest Pipeline Triage (2026-05-07)

**For:** Claude Cowork (next session)
**From:** Claude Code session on Bravo, 2026-05-07 evening
**Repo:** `/Users/bravonode/Mira` (commits on detached HEAD — see §6)

---

## 1. TL;DR

Diagnosed why the KB ingest pipeline felt unreliable, fixed the two highest-leverage bugs, kicked off a backfill drain, and committed the changes. Three things still need follow-up: branching the detached commits, observability/alerting work, and writing the broken pipelines off (or fixing them) so the daily logs stop being noise.

## 2. The diagnosis (so you don't redo it)

The cron IS firing. The pipelines have been silently dead for weeks. NeonDB freshness as queried tonight:

| source_type | rows | last ingest | days stale |
|---|---:|---|---:|
| equipment_manual | 6,752 | 2026-05-03 | 4 |
| youtube_transcript | 2,521 | 2026-04-24 | 13 |
| manual | 30,999 | 2026-04-22 | 15 |
| atlas_asset / work_order_history | 41 | 2026-04-11 | 26 |
| reference / standard / curriculum / gdrive | 35,072 | 2026-04-06 | 31 |
| equipment_photo | 1,411 | 2026-03-30 | 38 |

**Total `knowledge_entries`: 76,778. Most high-volume sources stopped between Apr 6 and Apr 24.** Zero alerts fired because nothing is wired to alert.

The "Celery on Bravo" from 30-day-old memory is no longer accurate — Docker isn't running on Bravo, no `mira-celery-worker` container exists. The actual scheduler stack on Bravo is **launchd → run.sh → APScheduler in-process** (one Python process). Trigger.dev cloud task definitions exist in `mira-crawler/trigger/src/tasks/` but post to `mira-task-bridge:8003` which isn't running on Bravo.

The `manual_cache` NeonDB table holds **263 discovered-but-unembedded URLs** — the "200+ backlog" the operator was asking about.

## 3. What I shipped (two commits)

### Commit `f930805` — Claude Code v2.1+ infra adoption
- `wiki/references/claude-code-v2.1.md` (new) — full feature catalog + MIRA defaults
- `wiki/references/routines.md` (new) — 7 concrete Routines to set up at code.claude.com
- `.github/workflows/code-review.yml` — `auto-fix`-label-triggered job that invokes `scripts/pr_self_fix.sh` automatically
- `.claude/settings.json` — expanded allowlist (`gh`, `pytest`, `ruff`, `pyright`, `uv`, `bun`, `rg`, `sg`, `gitleaks`, `shellcheck`); deny-list for force-push to main/develop; SessionStart hook surfaces `CLAUDE_CODE_EFFORT_LEVEL`
- `.githooks/pre-commit` — logs `CLAUDE_CODE_SESSION_ID` to `.git/claude-sessions/log`
- `.claude/skills/autonomous-run/SKILL.md` — Outcomes + Auto Mode discipline notes
- `scripts/pr_self_fix.sh` — header points to `/autofix-pr` + `auto-fix` label as alternatives
- `CLAUDE.md` — pointer lines to the new wiki refs

### Commit `9e40303` — P0 KB ingest fixes
- **`mira-crawler/watcher/folder_watcher.py`** — added `_scan_existing()` that processes files already present in `watch_dir` before `Observer.start()` attaches. Per-watcher `_seen` set prevents macOS FSEvents replay from double-firing. Root cause: 16 PDFs sat in `data/incoming/` since 2026-03-26 because the watcher only handled `on_created`.
- **`mira-crawler/run.sh`** — `PATH=/opt/homebrew/bin:/usr/local/bin:$PATH` plus `command -v doppler` validation with clear error if missing. Original `exec: doppler: not found` errors are visible at the top of `crawler.log` (only 2 occurrences — historical, not current). Fix is defense for next reboot.
- **`mira-crawler/tests/test_watcher.py`** — two regression tests; backdate mtime by 7d so they actually exercise the bug (a naive test passes via FSEvents quirk).
- All 6 watcher tests pass; ruff clean.

## 4. What I started (running asynchronously)

1. **`launchctl unload && load com.mira.crawler.plist`** — done. New process is PID 9875 (`launchctl list | grep mira.crawler`). The startup-scan should have iterated `mira-crawler/data/incoming/` and ingested the 16 stranded PDFs. Verify by:
   ```bash
   tail -100 /Users/bravonode/Mira/mira-crawler/data/crawler.log
   ```
   Look for `Existing file at startup: <name>` lines, then `Crawl complete` summaries.

2. **Drain `manual_cache` (263 rows)** — running in background. Output file:
   ```
   /tmp/mira-manual-drain-<timestamp>.log
   ```
   Started via:
   ```bash
   doppler run --project factorylm --config prd -- \
     uv run --with pdfplumber --with psycopg2-binary --with sqlalchemy \
            --with httpx --with beautifulsoup4 \
     python mira-core/scripts/ingest_manuals.py
   ```
   Idempotent (dedup by file hash). Estimated runtime: minutes-to-hours depending on Ollama embed throughput. Check progress with:
   ```bash
   ls -la /tmp/mira-manual-drain-*.log | tail -1
   tail -50 $(ls -t /tmp/mira-manual-drain-*.log | head -1)
   ```

## 5. What still needs doing — prioritized

### P0 — Move the detached commits to a branch (DO THIS FIRST)
Both commits landed on **detached HEAD**. They will be lost on next `git checkout`. Run:
```bash
cd /Users/bravonode/Mira
git checkout -b chore/claude-code-v21-and-kb-fixes-2026-05-07
git push -u origin chore/claude-code-v21-and-kb-fixes-2026-05-07
gh pr create --title "Claude Code v2.1+ defaults + folder_watcher / run.sh KB ingest fixes" \
  --body "See HANDOFF-kb-ingest-2026-05-07.md for full context. Two logical commits, no merge conflicts touched."
```

### P0 — Verify the drain finished and freshness improved
After the background drain completes:
```bash
doppler run --project factorylm --config prd -- python3 -c "
import os, psycopg2
conn = psycopg2.connect(os.environ['NEON_DATABASE_URL'])
cur = conn.cursor()
cur.execute(\"SELECT source_type, COUNT(*), MAX(created_at) FROM knowledge_entries GROUP BY source_type ORDER BY MAX(created_at) DESC LIMIT 20\")
for r in cur.fetchall(): print(r)
"
```
Expect to see `equipment_manual` / `manual` row counts increase and timestamps updated.

### P1 — Observability + freshness alerting
Today, this pipeline can be dead for 31 days and nobody notices. Spec to implement (see `wiki/references/routines.md` for context):
1. New NeonDB table `pipeline_runs` (source_type, started_at, finished_at, rows_added, rows_skipped, errors, status). One row per ingest invocation.
2. Decorator `@pipeline_run("manuals")` wrapped around each ingest entry point — `ingest_manuals.py`, `ingest_gdrive_docs.py`, `youtube_tasks.py`, `discover_manuals.py`. Inserts on entry, updates on exit.
3. `tools/kb_freshness.py` script — queries `pipeline_runs`, prints/exits-1 if any source is past its budget (manuals 1d, gdrive 2d, youtube 3d).
4. Run #3 from a daily cron at 09:00; pipe failure to Discord using the existing webhook pattern in `tools/lead-hunter/hardening.py:241` (`alert()` function — re-use it).
5. Daily wiki update: append the freshness summary to `wiki/hot.md` so session-start hooks surface state.

### P1 — Decide what to do with the dead manufacturer crawls
`mira-crawler/main.py:184-191` schedules 6 daily manufacturer crawls. Per `crawler.log`, every single one returns 0 chunks. Either:
- Fix `sources.yaml` for siemens/rockwell/fanuc (they're empty there)
- Or delete the dead jobs from the APScheduler config

Running them daily produces ~30 useless log lines/day and wastes the scheduler slot. Recommend: delete unless you can confirm the source list is real and just dedup-saturated.

### P2 — Replace launchd plist secret
`~/Library/LaunchAgents/com.mira.crawler.plist:20` embeds a Doppler service-account token in plaintext. Move it to macOS Keychain via `security add-generic-password -a $USER -s mira-crawler -w <token>` and read it from `run.sh` startup. Plist becomes secret-free.

### P2 — Address the 4 unresolved merge conflict files
At session start there were unresolved `UU` files I deliberately did not touch:
- `marketing/prospects/hardening-alerts.jsonl`
- `mira-bots/shared/engine.py`
- `mira-bots/tests/test_engine.py`
- `wiki/hot.md`

These predate this session and have conflict markers. Resolve before any further work in those areas.

## 6. Memory updates needed (auto-memory)

The file `~/.claude/projects/-Users-bravonode-Mira/memory/MEMORY.md` has stale entries that misled the diagnosis. Update these:

| Memory file | Current state | What it should say |
|---|---|---|
| `project_celery_workers.md` | "Celery deployed on Bravo 2026-04-06, 3 containers running" | Mark as **superseded 2026-05-07**: Docker not running on Bravo. The actual stack is launchd → run.sh → APScheduler in-process. Celery containers may exist on VPS (`mira-prod` 100.68.120.99) but Bravo doesn't host them. |
| `project_youtube_kb.md` | "Beat container rebuild in progress 2026-04-10. youtube-discovery every 15min" | Mark stale. NeonDB shows last `youtube_transcript` = 2026-04-24, last `youtube_pattern` = 2026-04-24. The 4 youtube Celery tasks are NOT firing on Bravo. Either dead or running elsewhere. |
| `project_manuals_ingest.md` | "47-PDF Docling ingest COMPLETE 2026-04-05" | Still accurate for that one-shot run. ADD: `manual_cache` table currently holds 263 unembedded URLs (Siemens 22, Harrington 18, Yale 14, DESHAZO 12, etc.) — drained 2026-05-07 evening, verify next session. |
| `project_celery_lead_hunter_gap.md` | "Dockerfile.celery doesn't COPY tools/lead-hunter/" | Still accurate but irrelevant since no Celery containers run on Bravo. The lead-hunter is launched by separate launchd jobs, not by the gap-affected Dockerfile. |

Add a NEW memory: `project_kb_ingest_topology.md`:
```yaml
---
name: KB Ingest Topology (Bravo, 2026-05-07)
description: What actually runs ingest on Bravo — launchd + APScheduler, not Celery
type: project
---

The KB ingest pipeline on Bravo is NOT containerized. Production reality:

1. com.mira.crawler.plist (launchd, KeepAlive=true) →
   /Users/bravonode/Mira/mira-crawler/run.sh →
   APScheduler in-process inside main.py:
     - 6 manufacturer crawls daily (1am-5:30am, all currently 0 chunks)
     - Curriculum crawl Sunday 6am
     - Weekly report Monday 7am
     - Healthcheck every 30 min
     - Folder watcher on data/incoming/ (fixed 2026-05-07 to scan existing)

2. crontab entries (operator: bravonode):
     - 02:00 anonymize_interactions.py
     - 02:05 ingest_interactions.py
     - 02:15 ingest_manuals.py (drains manual_cache)
     - 03:00 nightly pytest
     - Sun 03:00 discover_manuals.py (Apify → manual_cache)

3. com.mira.wiki-raw-ingest.plist (launchd, WatchPaths=~/MiraDrop)

NO Celery, NO Redis, NO mira-task-bridge running locally on Bravo as of
2026-05-07 18:00. Trigger.dev tasks in mira-crawler/trigger/src/ exist in
the cloud but post to a bridge that isn't here — likely orphaned config.
```

## 7. GitHub issues to open

Use `gh issue create` for each:

1. **"KB ingest: silent zero-row days for 31+ days on most source_types"** (P0)
   - Body: NeonDB freshness table from §2; root cause = no observability, no alerts
   - Fix: §5 P1 observability spec
   - Labels: `kb-ingest`, `observability`, `P0`

2. **"manual_cache backlog: 263 rows, oldest from <date>"** (P1, link to drain log when done)
   - Body: result of the drain; manufacturer breakdown from the query above
   - Labels: `kb-ingest`, `backfill`

3. **"Manufacturer crawls return 0 chunks daily — fix sources or delete"** (P2)
   - Body: cite `crawler.log` patterns for siemens/rockwell/fanuc/abb/kuka/automationdirect
   - Labels: `kb-ingest`, `tech-debt`

4. **"Memory drift: project_celery_workers.md says Celery on Bravo, reality is APScheduler"** (P2)
   - Body: §6 table
   - Labels: `docs`, `auto-memory`

5. **"launchd plist embeds plaintext Doppler service-account token"** (P2-security)
   - Body: §5 P2 plan to move to macOS Keychain
   - Labels: `security`, `tech-debt`

## 8. Specific commands you'll want first turn

```bash
cd /Users/bravonode/Mira

# 1. Save the detached commits
git log --oneline -3   # confirm 9e40303 and f930805 are HEAD~0 and HEAD~1
git checkout -b chore/claude-code-v21-and-kb-fixes-2026-05-07

# 2. Check the drain finished
ls -la /tmp/mira-manual-drain-*.log
tail -50 $(ls -t /tmp/mira-manual-drain-*.log | head -1)

# 3. Confirm folder_watcher processed the 16 stranded PDFs
grep "Existing file at startup" /Users/bravonode/Mira/mira-crawler/data/crawler.log | tail -20

# 4. Verify NeonDB freshness improved
doppler run --project factorylm --config prd -- python3 -c "
import os, psycopg2
conn = psycopg2.connect(os.environ['NEON_DATABASE_URL'])
cur = conn.cursor()
cur.execute(\"SELECT source_type, COUNT(*), MAX(created_at) FROM knowledge_entries WHERE created_at > NOW() - INTERVAL '24 hours' GROUP BY source_type ORDER BY 3 DESC\")
print('Last 24h ingest:')
for r in cur.fetchall(): print(' ', r)
"
```

## 9. What I did NOT do (and why)

- **Did not resolve the 4 UU merge-conflict files.** They predate my session and contain conflict markers I shouldn't guess at.
- **Did not SSH to Alpha or Charlie.** Permission was denied; production reads on shared infra need explicit operator authorization.
- **Did not push commits.** Detached HEAD and not my place to choose the branch name without operator input.
- **Did not file the GitHub issues.** Wanted operator review of the §5 priorities first; the prompts in §7 are ready to paste.
- **Did not delete the dead manufacturer crawls** (§5 P1.2). Needs operator confirmation about whether siemens/rockwell sources are recoverable.

---

## 10. Drain results (drain finished 2026-05-07 20:41 ET)

**KB growth this session: 76,778 → 79,329 entries (+2,551, +3.3%)**

| Path | Inputs | OK | Fail | Rows added |
|---|---:|---:|---:|---:|
| Folder watcher fix (16 stranded PDFs in `data/incoming/`) | 16 | 16 | 0 | +1,129 `equipment_manual` |
| `ingest_manuals.py` drain on `manual_cache` | 37 | 5 | 32 | +1,422 `manual` |

`manual_cache` end-state: 250 `pdf_stored=true`, 13 still pending. The drain processed only 37 of 263 because most rows had already been ingested in prior runs (the dedup is by file hash). The 13 pending are the residue of 32 failures that the script queued for retry.

### NEW finding — `manual_cache` is polluted with hallucinated URLs

32 of 37 attempted URLs failed with 404 / DNS / timeout. Examples:

- `https://schneider.com/docs/altivar320-manual.pdf` → 404 (real Schneider docs live at `download.schneider-electric.com`)
- `https://eaton.com/docs/xv300-hmi-manual.pdf` → timeout
- `https://omron.com/manuals/cp1e-operation.pdf` → DNS not found
- `https://abb.com/manuals/ach580-user-manual.pdf` → server disconnect
- `https://danfoss.com/manuals/fc301-operating-instructions.pdf` → 404

These look LLM-generated, not real OEM URLs. The discovery side (`discover_manuals.py` Apify crawl OR `seed_manual_cache.py` LLM validation) is poisoning the cache. Add this as **GitHub issue #6**:

> **Title:** `manual_cache contains hallucinated URLs — 86% drain failure rate from synthetic URLs`
> **Body:** 32/37 of attempted manual_cache URLs return 404/DNS/timeout. Pattern suggests LLM-generated URLs that follow a plausible structure but aren't real OEM paths. Investigate `seed_manual_cache.py` validation logic + Apify discovery filters. Until fixed, the daily 02:15 drain will keep silently failing on these rows.
> **Labels:** kb-ingest, data-quality, P1

### Updated memory note

When you write `project_kb_ingest_topology.md` (§6), add:

> **manual_cache state as of 2026-05-07:** 263 rows total, 250 stored, 13 pending. Recent drain showed 86% URL failure rate — most pending rows likely have hallucinated URLs that need cleanup before the cache is useful. Top manufacturers: Siemens 22, Harrington 18, Yale 14, DESHAZO 12, Allen-Bradley 6.

End of handoff.
