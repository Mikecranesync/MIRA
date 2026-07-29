# Crawler `data/` relocation — assessment (execution DEFERRED)

**Verdict: relocation is worth doing, but DEFER execution** and fold it into the
same reviewed maintenance window as the Phase-2 venv cutover (both sever the
prod daemon's dependence on the dev checkout). This doc is the assessment + a
ready procedure; it is intentionally **not** executed in this PR.

## The problem

The production crawler runs from `/Users/bravonode/mira-crawler-prod/mira-crawler`,
but its `data/` is a **symlink into a dev checkout**:

```
/Users/bravonode/mira-crawler-prod/mira-crawler/data
    -> /Users/bravonode/Mira/mira-crawler/data        (234M, the dev checkout)
```

`run.sh` derives every state path from `$SCRIPT_DIR/data/...`, so the daemon's
**live state physically lives inside a dev working tree** that other sessions
actively mutate. A `git clean -fdx`, a branch reset, or moving/deleting the dev
checkout would destroy the crawler's dedup ledger and incoming queue. That is
the coupling to remove.

## What lives in `data/` (writers)

| Path | Env | Writer | Notes |
|---|---|---|---|
| `crawler_dedup.db` | `DEDUP_DB_PATH` | `ingest/dedup.py::DedupStore` (daemon) | **SQLite** — the "already indexed" ledger. Single daemon = single writer, but a mid-write move risks corruption. |
| `dedup.db` | — | (legacy, stale — Mar 26) | Not referenced by current `run.sh`; likely dead. Confirm before carrying it over. |
| `incoming/` | `INCOMING_WATCH_DIR` | FolderWatcher watches; `_ingest_file` reads | Moving it changes the watch root — the watcher must be pointed at the new path. |
| `cache/` | `CRAWLER_CACHE_DIR` | `generate_report` → `crawl_report.md` | Report output; cheap to move. |
| `crawler.log` | (run.sh redirect) | daemon stdout/stderr | 4.4M and growing — most of the 234M is here + `incoming/`. |
| `ingest_latency.jsonl` | `MIRA_INGEST_LATENCY_LOG` (unset → cwd-relative default) | `metrics/latency.py` | **Path not pinned** — defaults to `mira-crawler/data/…` relative to cwd. Pin it explicitly during relocation. |
| `job_heartbeat.jsonl` | `MIRA_JOB_HEARTBEAT_LOG` (this PR) | `metrics/heartbeat.py` | Same: pin the env at relocation so health + watchdog read the moved file. |

## Why DEFER (not do it now)

1. **It requires a daemon stop.** Moving a live SQLite DB + repointing the watch
   dir safely means stopping `com.mira.crawler`, moving, updating `run.sh`/env,
   restarting. That is a deliberate, SHA/runtime-affecting change — Tier C
   territory, out of scope for this zero-host-effect PR.
2. **Two loose paths still to pin** (`ingest_latency.jsonl`, and confirming
   `dedup.db` is truly dead). The plan prefers **defer over guessing**; relocating
   while a writer's path is unconfirmed risks silently splitting state.
3. **It belongs with the venv cutover.** Phase 2 also cuts the prod worktree
   loose from the dev checkout (`.venv` is symlinked the same way). Doing `.venv`
   and `data/` in one reviewed window means one stop, one verification, one
   rollback — not two.

## Ready procedure (execute later, in a reviewed window)

Target: a checkout-independent dir, e.g. `/Users/bravonode/mira-crawler-prod/data`
(a **real** dir, no symlink). Preserve the old dir until verified.

```bash
# 0. Announce + backup rollback point already exists (plist .bak from Phase 0).
# 1. Stop the daemon (single writer must be down before moving SQLite).
launchctl unload ~/Library/LaunchAgents/com.mira.crawler.plist

# 2. Copy (do NOT move yet — keep the source as rollback) state to the new home.
mkdir -p /Users/bravonode/mira-crawler-prod/data
rsync -a /Users/bravonode/Mira/mira-crawler/data/ /Users/bravonode/mira-crawler-prod/data/

# 3. Replace the symlink with the real dir + pin every writer's path in run.sh:
#    remove the `data` symlink; point CRAWLER_CACHE_DIR / DEDUP_DB_PATH /
#    INCOMING_WATCH_DIR / MIRA_INGEST_LATENCY_LOG / MIRA_JOB_HEARTBEAT_LOG at
#    the new dir explicitly (no cwd-relative defaults).

# 4. Restart + verify: dedup count preserved, watcher on new incoming/, a
#    heartbeat lands under the new path, health.py reads it.
launchctl load ~/Library/LaunchAgents/com.mira.crawler.plist

# 5. Only after a full healthy cycle: retire the old data/ dir.
```

Rollback: re-point the symlink and reload the plist — the source dir is
untouched until step 5.

## Cross-references

- `docs/ops/crawler-runtime.md` — the runtime + evidence model.
- `docs/ops/2026-07-27-crawler-runtime-hardening-phase0.md` — Phase-2 venv cutover
  (the sibling "sever from the dev checkout" work to co-schedule with this).
