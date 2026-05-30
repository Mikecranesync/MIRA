# Allen-Bradley Manual Hunter

Small-scale, monitored replacement for the Trigger.dev + Celery + docling
ingest pipeline that twice took down the 8 GB VPS in May 2026
(PRs [#1318](https://github.com/Mikecranesync/MIRA/pull/1318) /
[#1336](https://github.com/Mikecranesync/MIRA/pull/1336)).

## What it does

Probes the Rockwell Automation literature CDN for an allowlist of
Micro820 / Micro800 / CCW publications. New PDFs land in
`~/MiraDrop/inbox/` where the existing `mira-drop-watcher` ships them to
Hub → KB chunks. **Caps at 3 new PDFs per run** by default.

```
launchd (every 6 h)
    │
    ▼
scripts/ab_manual_hunter/run.py
    │  honors STOP_INGEST flag, singleton lock, 20-min hard timeout
    │  hardened with tools/lead-hunter/hardening.py
    │
    ▼
~/MiraDrop/inbox/<PUB>_-en-<rev>.pdf
    │
    ▼ mira-drop-watcher (already running)
    │
    ▼
Hub /api/uploads/folder
    │
    ▼
KB chunks in NeonDB knowledge_entries
```

## Files

| File | Role |
|---|---|
| `run.py` | Hardened runner |
| `targets.yaml` | Publication allowlist — start small, grow it |
| `launchd/com.factorylm.ab-manual-hunter.plist` | 6-hourly launchd schedule |
| `launchd/com.factorylm.ingest-guardrails.plist` | 15-min guardrails monitor |

The guardrails monitor itself lives at `scripts/ingest_guardrails.py`.

## Quick reference

### First run — dry run

```bash
python3 scripts/ab_manual_hunter/run.py --dry-run --max-new 2
cat ~/.mira/ab-hunter/run-*.json | tail -1 | python3 -m json.tool
```

### Go live

```bash
MIRA_AB_HUNTER_LIVE=1 python3 scripts/ab_manual_hunter/run.py --max-new 2
ls -la ~/MiraDrop/inbox/         # should have the new PDF
ls -la ~/MiraDrop/done/          # within ~60s, watcher moves it here
```

### Pause / resume

```bash
# Pause (next scheduled run exits clean with exit code 5)
echo "investigating disk pressure" > ~/.mira/STOP_INGEST

# Resume
rm ~/.mira/STOP_INGEST
```

### Install the launchd jobs (CHARLIE only)

```bash
cp scripts/ab_manual_hunter/launchd/com.factorylm.ab-manual-hunter.plist \
   ~/Library/LaunchAgents/
cp scripts/ab_manual_hunter/launchd/com.factorylm.ingest-guardrails.plist \
   ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.factorylm.ab-manual-hunter.plist
launchctl load ~/Library/LaunchAgents/com.factorylm.ingest-guardrails.plist
launchctl list | grep -E "ab-manual-hunter|ingest-guardrails"
```

### Add a publication

Edit `targets.yaml`. Existing entries with priorities 1+2 fire by default
(`--priority` flag controls the ceiling). Anything in cohort 3+ is
deferred — uncomment as needed.

## Guardrail thresholds

See `scripts/ingest_guardrails.py` header for the live table. Defaults:

| Signal | Warn | Stop |
|---|---|---|
| Disk usage | 80 % | 92 % |
| Free memory | < 2 GiB | < 1 GiB |
| MiraDrop inbox queue | 20 | 50 |
| MiraDrop failed/ (24 h) | 5 | 20 |
| ab-hunter failures (last 5) | 2 | 4 |
| Docker container OOM (1 h) | n/a | any |

When a "stop" trips, the guardrails write `~/.mira/STOP_INGEST` with the
sentinel `AUTO_PAUSED_BY_GUARDRAILS`. They will not overwrite an
operator-set STOP flag.

## What this deliberately does NOT do

- Run on the prod VPS (the OOM victim)
- Use Trigger.dev, Celery, or Redis (the OOM blast radius)
- Touch `docker-compose.saas.yml` containers
- Auto-prune or auto-rotate the KB (manual review owns that)
- Identify KB gaps from bench failures (see `docs/evaluations/SELF_IMPROVEMENT.md` Phase 2)
