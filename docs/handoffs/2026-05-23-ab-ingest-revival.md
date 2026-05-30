# Allen-Bradley manual ingest — revival plan (small-scale, monitored)

**Date:** 2026-05-23
**Owner:** Mike Harper
**Status:** plan + slice 1 ship in same PR

## Goal

Get fresh Allen-Bradley / Rockwell manuals into the KB without reviving the
Trigger.dev + Celery + Redis + docling stack that took the VPS down twice in
May 2026 (see [[vps-oom-docling-incidents]] memory; PRs #1318/#1319/#1336).

## Why a "smaller scale" path

Three of the four ingest-tier failures all chain through the same path:

```
Trigger.dev cron → mira-task-bridge → mira-celery-worker → mira-docling → VPS host OOM
```

We can ingest manuals **without invoking any of that** by reusing the path
that's been working since 2026-05-22:

```
launchd cron → manual_hunter (CHARLIE) → ~/MiraDrop/inbox/
            → mira-drop-watcher → Hub /api/uploads/folder
            → KB chunks in NeonDB
```

This runs on CHARLIE (M4, 16 GB+), uses the Hub's chunker (not docling), and
inherits MiraDrop's per-file ledger + dedup. The blast radius of a runaway
is one Mac mini, not the 8 GB prod VPS.

## What we reuse (no reinvention)

| Component | Source | Why |
|---|---|---|
| Rockwell pub list + URL prober | `plc/ccw/scripts/fetch_rockwell_docs.py` | Already has 17 Micro820/Micro800/CCW pubs and the revision-letter prober — Mike's exact PLC family |
| Singleton lock + hard timeout + alert | `tools/lead-hunter/hardening.py` | Proven for 5+ weeks on lead-hunter; same shape |
| Telegram notifier | `mira-crawler/reporting/telegram_notify.py` | `notify("ab_hunter", "...")` |
| Drop-folder ingest | `tools/mira-drop-watcher/` | Already running on CHARLIE; SHA-256 dedup ledger |
| System health checks | `mira-crawler/agents/heartbeat_monitor.py` | Disk + memory floor |

## What we add (small)

1. **`scripts/ab_manual_hunter/run.py`** — hardened runner. Wraps a trimmed
   version of `fetch_rockwell_docs.py`'s probe logic. Drops new PDFs into
   `~/MiraDrop/inbox/`, where the watcher takes over. Per-run cap (default
   3 PDFs), 20-min hard timeout, singleton lock, preflight, alert sink,
   STOP_INGEST flag honored, dry-run default for first invocation.

2. **`scripts/ab_manual_hunter/targets.yaml`** — explicit allowlist of
   publications to chase. Starts with 5 (the highest-signal Micro820 + CCW
   docs the bench question set already cares about — Q06/Q10).
   Append-only.

3. **`scripts/ingest_guardrails.py`** — CHARLIE-local monitor. Runs every
   15 min via launchd. Checks: disk usage, available memory, MiraDrop
   inbox queue depth, MiraDrop failed count, recent ab_manual_hunter
   run-report failure rate. Telegram alert on threshold. Honors
   `STOP_INGEST` flag (touch a file → next ingest run exits clean).

4. **`scripts/check_compose_mem_limits.py`** — pre-commit/pre-deploy lint.
   Walks every `docker-compose*.yml`, fails-fast if any service lacks
   `mem_limit`. Closes the PR #1336 footgun for good.

5. **Launchd plists** (template; Mike installs locally — they're CHARLIE
   files, not git-tracked once installed). Two plists:
   - `com.factorylm.ab-manual-hunter` — every 6h, at minute 17
   - `com.factorylm.ingest-guardrails` — every 15min

## Guardrails — what flags trip and what they do

| Signal | Threshold | What happens |
|---|---|---|
| Disk usage | > 80 % | Telegram warn, refuse next hunter run |
| Available memory | < 1.5 GiB | Telegram warn, refuse next hunter run |
| MiraDrop `inbox/` queue depth | > 20 PDFs pending | Telegram warn, hunter pauses |
| MiraDrop `failed/` count | > 5 in last hour | Telegram warn, hunter pauses |
| ab-manual-hunter consecutive failures | > 3 in a row | Telegram alert, hunter self-disables until human resets |
| `STOP_INGEST` flag exists | always | Hunter exits clean with "ingest paused by operator" |
| Per-run cap exceeded | > 3 PDFs/run | Hunter stops after cap; deferred items wait for next run |
| Hard timeout | 20 min | SIGALRM, run report = timeout, Telegram alert |
| URL not 200 or not PDF magic | per-URL | Skip, log, continue |

## Success criteria

After ship + first non-dry-run:

- [ ] At least 1 new Rockwell PDF lands in `~/MiraDrop/inbox/`
- [ ] MiraDrop watcher moves it to `~/MiraDrop/done/` within 60s
- [ ] `select count(*) from knowledge_entries where source_url like '%rockwell%' and inserted_at > now() - interval '1 day';` returns > 0
- [ ] Re-running `bash tests/run_mira_bench.sh --only Q06,Q10` (after PR #1513) shows MIRA grounded score on Q06 / Q10 improves (those are the Micro820/CCW gaps from the bench)
- [ ] `STOP_INGEST` flag stops the next scheduled run

## What we explicitly are NOT doing in this slice

- **Not reviving Trigger.dev Cloud** — see audit § 1, PR #1514
- **Not bringing back `mira-celery-worker` / `mira-task-bridge` / `mira-redis`** — they're the OOM vector
- **Not touching `docker-compose.saas.yml` containers** — the mem_limit lint is read-only
- **Not auto-pruning the KB** — manual review pipeline owns that
- **Not building Phase 2 KB-gap surfacing** — see `docs/evaluations/SELF_IMPROVEMENT.md`

## Future slices (deferred — only build if Slice 1 holds)

| Slice | Trigger to build |
|---|---|
| Slice 2 — Add VFD/PowerFlex pubs to allowlist | Slice 1 shipped 3 successful runs |
| Slice 3 — Add AutomationDirect (GS10/GS11) hunter | After Slice 2; uses a different URL family — separate hunter file |
| Slice 4 — Move hunter to VPS crontab | If CHARLIE uptime becomes the bottleneck — needs the docling mem-cap pre-flight (#1336) verified |
| Slice 5 — Auto-propose-then-verify KG relationships from new manuals | Hub `proposed_relationships` flow already exists; just needs the hunter's drop to be tagged |
