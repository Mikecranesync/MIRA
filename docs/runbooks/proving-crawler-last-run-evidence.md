# Proving Crawler / Scheduler Last-Run Evidence

Code existing ≠ code running. This runbook proves whether each manual-discovery routine actually fired recently. Start with the aggregator, then the per-node commands.

## 1. The aggregator (read-only, run anywhere)

```bash
python mira-crawler/fleet_status.py            # human report + verdicts + operator commands
python mira-crawler/fleet_status.py --json     # machine-readable
python mira-crawler/fleet_status.py --commands # just the off-box command block
```

It reads the local artifacts the fleet writes (`manual_queue.json`, `~/.mira/ab-hunter/run-*.json`, `~/.mira/guardrails-state.json`, `~/.mira/STOP_INGEST`) and judges each component **only** from evidence present on the box. In a repo checkout it honestly returns `unknown_needs_operator_verification` / `built_but_needs_runtime_proof` and prints the commands below. Run it **on the node** for a real verdict.

> It judges the KB queue on the queue's own `done_at`/`started_at` timestamps, **not** file mtime (mtime is the checkout time in a clone and would falsely read "firing").

## 2. CHARLIE (100.70.49.126) — AB hunter + guardrails

```bash
ls -t ~/.mira/ab-hunter/run-*.json | head -3
cat "$(ls -t ~/.mira/ab-hunter/run-*.json | head -1)" | jq '.overall,.at,.duration_s'
cat ~/.mira/guardrails-state.json | jq '{level,at,summary}'
ls -l ~/.mira/STOP_INGEST 2>/dev/null && head -1 ~/.mira/STOP_INGEST || echo "STOP_INGEST not set"
tail -50 /tmp/ab-manual-hunter.log
launchctl list | grep -E "ab-manual-hunter|ingest-guardrails"
ls ~/MiraDrop/inbox | wc -l   # depth guardrails watch
```

## 3. VPS — kb_growth_cron

```bash
python3 /opt/mira/mira-crawler/cron/kb_growth_cron.py --status
stat /opt/mira/mira-crawler/cron/manual_queue.json | grep Modify
tail -50 /var/log/mira-agents/kb_growth.log
cat /tmp/mira_heartbeat.json | jq '.checks | map(select(.status!="healthy"))'
```

## 4. Redis (broker) — which crawlers ran (dedup set sizes)

```bash
redis-cli SCARD mira:rss:seen_guids
redis-cli HLEN  mira:sitemaps:lastmod
redis-cli SCARD mira:gdrive:processed_files
redis-cli SCARD mira:manualslib:seen_manuals
redis-cli SCARD mira:patents:seen_ids
redis-cli LLEN  celery                     # tasks the Trigger bridge enqueued
```
Keys expire after 90 days (`mira-crawler/tasks/_shared.py`), so a nonzero size = ran within 90 d; growth between two checks = actively running.

## 5. Trigger bridge + Trigger.dev Cloud

```bash
curl -s http://localhost:8003/health | jq '.status,.redis'   # bridge up + Redis reachable
```
**Trigger.dev Cloud task-run history is NOT in the repo** — inspect at https://cloud.trigger.dev (project `proj_mira-ingest`). This is the *only* place to prove the schedules actually fired; there is no local artifact for it.

## 6. NeonDB — did the KB actually grow? (staging / read-only only — never prod psql)

```bash
psql "$NEON_STAGING_URL" -c "SELECT MAX(created_at), COUNT(*) FROM knowledge_entries;"
psql "$NEON_STAGING_URL" -c "SELECT DATE(created_at), COUNT(*) FROM knowledge_entries WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY 1 ORDER BY 1 DESC;"
```

## What has NO inspectable runtime evidence

- Trigger.dev Cloud per-task execution logs (external dashboard only).
- Celery worker stdout (depends on how the worker is launched — Docker/pm2/supervisor).
