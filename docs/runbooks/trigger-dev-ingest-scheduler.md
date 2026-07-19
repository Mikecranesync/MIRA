# Trigger.dev Ingest Scheduler Runbook

The manual/bulletin discovery fleet is scheduled by **Trigger.dev Cloud**, which HTTP-POSTs to a FastAPI bridge that enqueues Celery tasks. This runbook covers the wiring, the cron map, secrets, tests, and failure modes.

## Architecture

```
Trigger.dev Cloud (proj_mira-ingest)          [external — cron lives here]
   schedules.task(cron) ──HTTP POST──► FastAPI bridge  mira-crawler/bridge.py  :8003
                                            │  Bearer TASK_BRIDGE_API_KEY
                                            ▼
                                     Celery enqueue (Redis broker)
                                            ▼
                                     mira-crawler/tasks/*.py workers → knowledge_entries
```

- Config: `mira-crawler/trigger/trigger.config.ts` (project ref `proj_mira-ingest`).
- Task defs: `mira-crawler/trigger/src/tasks/{continuous,hourly,nightly,weekly,monthly}.ts` — each `schedules.task({cron})` calls `triggerBridgeTask(name)`.
- Bridge: `mira-crawler/bridge.py` — `GET /health` (public, pings Redis), `POST /tasks/{name}` (auth), `GET /tasks/status/{id}` (auth). Task allowlist: `discover, ingest, foundational, rss, sitemaps, youtube, reddit, patents, gdrive, freshness, photos, report`.

## Cron map (America/New_York)

| Cadence | Cron | Tasks |
|---|---|---|
| continuous | `*/15 * * * *` | `poll-rss-feeds`, `scan-watch-folder` (GDrive) |
| hourly | `0 * * * *` | `check-sitemaps`, `ingest-pending` |
| nightly | `0 3` / `30 3` / `0 4` | `nightly-youtube`, `nightly-gdrive`, `nightly-report` |
| weekly (Sun) | `0 3/4/5 * * 0` | `weekly-discovery` (Apify), `weekly-reddit`, `weekly-freshness` |
| monthly | `0 4 1` / `0 5 1` / `0 4 15` | `monthly-foundational`, `monthly-photos`, `monthly-patents` |

## Secrets / env

- `TASK_BRIDGE_API_KEY` — bearer token the Trigger tasks send; the bridge rejects otherwise.
- `CELERY_BROKER_URL` (default `redis://localhost:6379/0`), result backend `/1`.
- Trigger.dev project secret + the bridge's public URL are set in the Trigger.dev dashboard, not the repo.

## Tests

- `mira-crawler/tests/test_bridge.py` — bridge auth, task allowlist, enqueue, status poll (Redis/Celery mocked, offline). Run: `pytest mira-crawler/tests/test_bridge.py -q`.
- Note: these crawler tests are **not** in the main CI `Unit Tests` job today; run them locally or on the node.

## Failure modes

- **Bravo/Charlie offline / bridge down:** Trigger.dev POSTs fail; tasks don't enqueue. The fleet silently stops. Detect via `curl :8003/health` and Trigger.dev Cloud run history (external). No local artifact records a missed schedule — this is the biggest "looks live but isn't" risk.
- **Redis down:** `GET /health` returns `redis` error; enqueue 5xx.
- **Wrong/missing `TASK_BRIDGE_API_KEY`:** every task POST 401s; fleet stops.

## Proving it fired

There is **no repo artifact** for Trigger.dev Cloud runs. Prove via: (1) Trigger.dev dashboard run history, (2) `redis-cli LLEN celery` + crawler `mira:*:seen_*` set growth, (3) `knowledge_entries` freshness. See `docs/runbooks/proving-crawler-last-run-evidence.md`.
