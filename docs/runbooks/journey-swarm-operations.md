# Journey Swarm — operations runbook

Operational contract for the technician-journey validation swarm.
PRD: `docs/prd/2026-08-02-technician-journey-validation-swarm.md`.

**Doctrine: staging discovers; production verifies.** The scheduled lane runs
against **staging only**. Production execution is blocked by two independent
fail-closed checks (see [Safety rails](#safety-rails)).

---

## Architecture

| Piece | Where |
|---|---|
| Scenario ledger | `tools/journey_swarm/ledger/*.yaml`, loader `tools/journey_swarm/ledger.py` |
| Executor (all behavior) | `tools/journey_swarm/executor.py` |
| Celery entry point | `mira-crawler/tasks/journey_swarm.py` |
| Queue routing + schedule | `mira-crawler/celeryconfig.py` |
| Task discovery | `mira-crawler/celery_app.py` (`_TASK_MODULES`) |
| Worker image | `mira-crawler/Dockerfile.synthetic-dogfood` |
| Worker service | `docker-compose.saas.yml` → `mira-synthetic-dogfood-worker` |
| Scheduler service | `docker-compose.saas.yml` → `mira-synthetic-dogfood-beat` |

The CLI and the worker execute **the same** `executor.main()`, so a scheduled
run and a manual run cannot diverge.

### Worker image

The executor imports only stdlib + `httpx` + `PyYAML` + a lazily-imported
`psycopg2` — all already in `requirements-celery.txt`. The image therefore
needs exactly one addition:

```dockerfile
COPY tools/journey_swarm/ /app/tools/journey_swarm/
```

`tasks/journey_swarm.py` resolves `<repo-root>/tools/journey_swarm` from its own
location, which is `/app/tools/journey_swarm` in the container. It does **not**
import `mira-bots`.

---

## Cadence

| Environment | Cadence | Source |
|---|---|---|
| Staging | every 6 h at :30 UTC | `_JOURNEY_SWARM_SCHEDULE` in `celeryconfig.py` |
| Production | **not scheduled** | PRD §8.5 — certificate-backed replay only, and P3 is unbuilt |

**Why 6 h:** the PRD does not name a numeric staging interval. §8.5 fixes the
*production* cadence ("once per eligible release after deployment verification,
plus an owner-approved scheduled integrity replay") and §11-P4 says "bind
certificate replay to eligible releases and scheduled integrity checks". Rather
than invent a number, the staging lane adopts the cadence of the sibling task on
the same dedicated queue (`synthetic-dogfood-cycle`, every 6 h), offset by 30
minutes so the two never collide.

Change it **without a rebuild** via `JOURNEY_SWARM_CRON_HOURS` (e.g. `*/2`).
Times are UTC (`timezone = "UTC"`, `enable_utc = True`), so the cadence does not
shift under DST.

---

## Configuration

All values come from Doppler (`factorylm/stg`, `factorylm/prd`). **Nothing is
baked into the image** — no credentials, no tenant ids.

| Variable | Default | Meaning |
|---|---|---|
| `JOURNEY_SWARM_ENABLED` | `0` | Master switch. Anything but `1` = inert. |
| `JOURNEY_SWARM_TENANTS` | *(empty)* | **Explicit** comma-separated allowlist. Empty = **no tenant is eligible**, never "all". |
| `SWARM_PIPELINE_URL` | *(empty)* | Target engine surface. Host must be allowlisted for the environment. |
| `PIPELINE_API_KEY` | *(empty)* | Bearer auth for the target. |
| `MIRA_TENANT_ID` | *(empty)* | Tenant the run executes as; must appear in the allowlist. |
| `MIRA_CONTEXT_CONTRACT` / `MIRA_FACTORYLM_LIVE` | *(unset)* | Spine flags. Both must be `1` or the task skips. |
| `JOURNEY_SWARM_CRON_HOURS` | `*/6` | Cadence knob (beat container). |
| `JOURNEY_SWARM_SOFT_LIMIT_S` | `1500` | Graceful cancellation (25 min). |
| `JOURNEY_SWARM_HARD_LIMIT_S` | `1800` | Kill (30 min). |
| `JOURNEY_SWARM_MAX_RETRIES` | `3` | Bounded retries for transient failures. |

### Tenant eligibility

Scheduled runs execute **only** for a tenant that is *both* `MIRA_TENANT_ID`
*and* present in `JOURNEY_SWARM_TENANTS`. Staging uses the synthetic probe
tenant `78917b56-…`. A production tenant can never be reached, because the
target host allowlist refuses production surfaces regardless of tenant.

---

## Safety rails

1. **Ledger gate** — `production_canary` requires `certificate.status=certified`.
   No scenario is certified, so production is unreachable at the ledger.
2. **Target binding** — `assert_target_matches_environment()` refuses any host
   not allowlisted for the requested environment, and refuses
   `*.factorylm.com` outright. Re-checked in the Celery task **before**
   dispatching, independently of the CLI.
3. **Read-only** — the executor performs authenticated reads and the approved
   Q&A path only. No writes, no work orders, no control.
4. **Fail-closed config** — disabled by default; empty allowlist means nobody.

---

## Operating it

### Status

```bash
# Are the services up?
docker compose -f docker-compose.saas.yml ps mira-synthetic-dogfood-worker mira-synthetic-dogfood-beat

# Full dependency health (broker, registration, executor, DB, flags, tenant)
docker exec mira-synthetic-dogfood-worker \
  celery -A mira_crawler.celery_app call tasks.journey_swarm.health_check

# Is the task registered in the RUNNING image?
docker exec mira-synthetic-dogfood-worker \
  celery -A mira_crawler.celery_app inspect registered | grep journey_swarm

# Queue depth / oldest task age
docker exec mira-redis redis-cli llen synthetic

# Scheduler + worker heartbeat
docker exec mira-synthetic-dogfood-worker celery -A mira_crawler.celery_app inspect ping
docker logs --since 6h mira-synthetic-dogfood-beat | grep -i "journey-swarm"

# Last run outcome (structured log line)
docker logs --since 24h mira-synthetic-dogfood-worker | grep JOURNEY_SWARM_RESULT
```

### Manual one-shot trigger

```bash
docker exec mira-synthetic-dogfood-worker \
  celery -A mira_crawler.celery_app call tasks.journey_swarm.run_journey_swarm \
  --kwargs '{"scenario":"tech-journey-core","environment":"staging"}'
```

Or entirely outside Celery (identical code path):

```bash
ssh -f -N -L 14099:localhost:4099 factorylm-prod     # staging pipeline is not public
doppler run -p factorylm -c stg -- \
  python tools/journey_swarm/executor.py --scenario tech-journey-core
```

### Pause / kill switch

No code change and no rebuild required:

```bash
doppler secrets set JOURNEY_SWARM_ENABLED=0 --project factorylm --config stg
# then recycle the worker through the normal pipeline
gh workflow run deploy-vps.yml -f services="mira-synthetic-dogfood-worker"
```

Emptying `JOURNEY_SWARM_TENANTS` has the same effect (fail-closed).

### Replay a run

Runs are deterministic given the same ledger version and fixtures. Re-run the
same scenario with the manual trigger; receipts land in
`tools/journey_swarm/runs/<run_id>.jsonl` (redacted) with a
`<run_id>-summary.md` scoreboard. To replay a historical run, check out that
ledger version — the ledger is immutable once certified, so a version pins its
own fixtures and assertions.

### Failure investigation

| Verdict | Meaning | Retried? |
|---|---|---|
| `GREEN` | all invariants passed | — |
| `NOT_GREEN` | a scenario failed (RED/YELLOW inside) | no — inspect the summary |
| `REFUSED` | environment/target binding rejected the run | **no** (permanent) |
| `INFRA` | image, DB, or precondition missing | **no** (permanent) |
| `TransientSwarmError` | transport/executor blew up | yes — 3 tries, exponential backoff + jitter |

A permanently-failing run is visible as a `JOURNEY_SWARM` `ERROR` log line and
a non-`GREEN` `JOURNEY_SWARM_RESULT`. There is no dead-letter queue on this
broker; failed runs are found in worker logs and the run receipts.

---

## Monitoring and alerting — honest status

**Implemented:** structured logs carrying scenario, environment, tenant,
verdict, exit code, duration, and host (`JOURNEY_SWARM_RESULT`); per-dependency
health check; per-run redacted JSONL receipts and a Markdown scoreboard;
lock-based overlap accounting.

**NOT implemented — do not claim otherwise:**

- No Prometheus/Grafana metric series for scheduled/started/succeeded/failed/
  retried/skipped/timed-out/overlap-blocked counts.
- No alert route for missed cadence, repeated failure, dead worker, stale
  queue, or scheduler silence.
- No dead-letter queue.
- No automated retention policy for `tools/journey_swarm/runs/` (gitignored;
  prune by hand).

The nearest existing pattern to copy when this is built is the dogfood
heartbeat: `.github/workflows/dogfood-judge-heartbeat.yml` posts to issue #2417
and fails on staleness. Wiring the swarm into that mechanism is the tracked
follow-up.

---

## Rollback

```bash
# Checkpoints are auto-created on every merge, plus a manual pre-merge one.
git tag --list 'rollback/*' --sort=-creatordate | head
git checkout -b revert/to-<point> rollback/<date>-v<VERSION>   # then PR the revert
```

Pre-merge checkpoint for the swarm chain: `rollback/before-swarm-chain`.

Fastest mitigation that needs no revert: set `JOURNEY_SWARM_ENABLED=0` (above).
The swarm is read-only, so disabling it cannot leave partial state behind.
