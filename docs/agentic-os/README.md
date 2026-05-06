# MIRA Agentic OS — Architecture & Runbook

**Owner:** Mike Harper · **Last updated:** 2026-05-06

The Agentic OS is the layer underneath every MIRA feature: it watches the
system, fixes what it can, captures what it learns, and reports the numbers
that matter. Most of it already existed (brand context, memory, skills,
orchestrator, scheduled tasks, quality gate, Telegram bot). This document
describes the new **self-maintenance** layer that closes the loop.

---

## Layer diagram

```
┌────────────────────────────────────────────────────────────────────┐
│  L5  Self-Maintenance        heartbeat → self-healer →             │
│                              learning_capture → funnel_tracker     │
├────────────────────────────────────────────────────────────────────┤
│  L4  Orchestration           cron (install_crons.sh) · Celery      │
│                              13-agent roster · scheduled tasks     │
├────────────────────────────────────────────────────────────────────┤
│  L3  Skills (50+)            promo-director · brand-voice ·        │
│                              kb-benchmark · diagnostic-workflow … │
├────────────────────────────────────────────────────────────────────┤
│  L2  Memory                  ~/.claude/projects/.../memory/        │
│                              MEMORY.md index + atomic notes        │
├────────────────────────────────────────────────────────────────────┤
│  L1  Brand & guardrails      CLAUDE.md · STRATEGY.md · NORTH_STAR  │
│                              security-boundaries · python-stds     │
└────────────────────────────────────────────────────────────────────┘
```

L1–L4 already shipped. L5 is what this PR adds.

---

## L5: the self-maintenance loop

```
                ┌──────────────────────┐
   every 15min  │  heartbeat_monitor   │  → 16 probes, score 0-100
                └──────────┬───────────┘
                           │  exit 2 (DOWN)
                           ▼
                ┌──────────────────────┐
                │     self_healer      │  → run scoped playbook
                └──────────┬───────────┘     re-probe → escalate if still red
                           │
                           ▼ NeonDB system_health_log (trend data)
                ┌──────────────────────┐
   weekly       │   learning_capture   │  → diff benchmarks → docs/learnings/
                └──────────┬───────────┘     filed regressions on GitHub
                           │
                           ▼
                ┌──────────────────────┐
   daily +      │    funnel_tracker    │  → HubSpot · scan queue · bot · health
   weekly Pulse └──────────────────────┘     → docs/reports/pulse/
```

Every component:

- runs **on the VPS**, scheduled by `scripts/install_crons.sh`
- fails open — a missing API token logs an error but never breaks the loop
- writes evidence to NeonDB or `docs/`, never silent state
- alerts via `mira_crawler.reporting.telegram_notify.notify(...)` — the same
  bus as every other digital employee, so Mike has one inbox to watch

---

## Agent roster

The full roster lives in `mira-crawler/reporting/telegram_notify.py::AGENTS`.
Below: every agent that runs on a schedule today, plus what was added in L5.

### Existing (L4 orchestration)

| Agent | When | Where | What |
|---|---|---|---|
| `kb_growth` | every 6h | `mira-crawler/cron/kb_growth_cron.py` | ingest one PDF from `manual_queue.json` |
| `corpus_refresh` | Sun 03:00 UTC | `mira-bots/benchmarks/corpus/scraper.py` | pull fresh Reddit Q&A |
| `youtube_harvest` | Mon 04:00 UTC | `mira-bots/benchmarks/corpus/youtube_harvester.py` | transcripts → corpus |
| `social_publisher` | Tue/Thu 11:30 UTC | `mira-crawler/social/publisher.py` | LinkedIn queue → live |
| `morning_brief` | daily 09:00 UTC | container exec → `agents/morning_brief_runner.py` | overnight WO summary |
| `pm_escalation` | daily 12:00 UTC | container exec → `agents/pm_escalation_runner.py` | overdue PM flags |
| `safety_alert` | daily 10:00 UTC | container exec → `agents/safety_alert_runner.py` | safety keyword sweep |
| `benchmark` | Sat 02:00 UTC | `pytest tests/eval/` | golden-case eval |
| `billing_health` | Mon 12:00 UTC | `mira-crawler/tasks/billing_health.py` | Stripe failed payments / MRR |
| `inbox_manager` | Cowork-driven | `mira-crawler/agents/inbox_triage.py` | Gmail morning summary |

### New (L5 self-maintenance)

| Agent | When | Where | What |
|---|---|---|---|
| `heartbeat` | every 15 min + 08:00 UTC daily | `mira-crawler/agents/heartbeat_monitor.py` | 16 probes → NeonDB → optional Telegram |
| `self_healer` | on heartbeat exit-2 | `mira-crawler/agents/self_healer.py` | scoped remediation playbooks |
| `learning_capture` | Sat 03:00 UTC (after benchmark) | `mira-crawler/agents/learning_capture.py` | benchmark diff → `docs/learnings/` + GitHub issues |
| `funnel_tracker` | daily 13:00 UTC + Mon 13:30 UTC weekly | `mira-crawler/agents/funnel_tracker.py` | HubSpot · scans · bot · uptime → Pulse |

---

## heartbeat_monitor

### What it checks

```
service                       category    notes
─────────────────────────────  ──────────  ──────────────────────────────────
mira-hub                       service     docker ps + status string
mira-pipeline                  service     "
mira-bot-telegram              service     "
mira-scan-backend              service     "
atlas-api                      service     "
mira-docling                   service     "
mira-web                       service     "
mira-mcp                       service     "
app.factorylm.com/api/health   endpoint    GET 200 · <2s = healthy
.../api/scanbe/healthz         endpoint    "
factorylm.com                  endpoint    "
telegram_polling               service     `getUpdates` in last 5 min of logs
neondb                         data        SELECT 1 · <3s = healthy
kb_cron                        data        manual_queue.json mtime <24h
disk                           resource    df / · warn 80%, down 90%
memory                         resource    free -m · warn 85%, down 95%
```

### Status taxonomy

| Status | Meaning | Action |
|---|---|---|
| `healthy` | all signals green | silent (rolled into daily summary) |
| `degraded` | working but slow / unhealthy | alert only after 30 min consecutive |
| `down` | not working | immediate alert + trigger `self_healer` |
| `unknown` | probe couldn't run (e.g. no docker) | logged, no alert |

### Health score

`score = 100 × Σ weight(status) / count(scored)`
where weights are: healthy 1.0, degraded 0.5, down 0.0. `unknown` is excluded.

### NeonDB persistence

Every probe writes a row into `system_health_log` (auto-created on first run):

```sql
CREATE TABLE system_health_log (
    id           BIGSERIAL PRIMARY KEY,
    ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    service      TEXT NOT NULL,
    status       TEXT NOT NULL,        -- healthy | degraded | down | unknown | healed | heal_failed
    latency_ms   INTEGER NOT NULL,
    details      TEXT,
    category     TEXT,                 -- service | endpoint | resource | data | heal
    score        INTEGER,              -- overall run score, NULL for heal rows
    action_taken TEXT,                 -- what self_healer did, NULL otherwise
    extra        JSONB                 -- remediation_hint, pct, etc.
);
```

Two indices: `ts DESC` and `(service, ts DESC)` — every dashboard query hits one.

### Run modes

```bash
# normal probe (cron)
python3 mira-crawler/agents/heartbeat_monitor.py

# pipe to self_healer
python3 mira-crawler/agents/heartbeat_monitor.py --json | \
  python3 mira-crawler/agents/self_healer.py --stdin

# daily 08:00 UTC summary (always sends)
python3 mira-crawler/agents/heartbeat_monitor.py --daily-summary

# debugging
python3 mira-crawler/agents/heartbeat_monitor.py --dry-run --json
```

---

## self_healer

### Playbook map

| `remediation_hint` (set by heartbeat) | Playbook | Side-effects |
|---|---|---|
| `container_missing`, `container_exited`, `container_unhealthy`, `container_restarting` | `restart_container` | `docker restart <name>` |
| `api_5xx` | `restart_container` (resolves endpoint label → container via `ENDPOINT_TO_CONTAINER`) | "" |
| `bot_not_polling` | `restart_container` mira-bot-telegram | "" |
| `endpoint_unreachable` | `noop_escalate` | nothing — likely DNS/TLS/nginx, never touch |
| `neondb_connection` | `neondb_retry` | 3 SELECT 1 retries, then escalate |
| `disk_full` | `disk_cleanup` | `docker system prune -f` + truncate >100M `*.log` files in `LOG_DIR` |
| `kb_cron_stale` | `trigger_kb_cron` | run `kb_growth_cron.py` once |
| _anything else_ | `noop_escalate` | escalation only |

### Hard safety rules

The healer **never**:

1. removes images or containers (`docker rm`, `docker rmi`)
2. touches nginx, the host's systemd, or NeonDB schema
3. runs `rm -rf` on anything — disk_cleanup truncates logs in place
4. runs as root unless `MIRA_HEALER_ALLOW_ROOT=1` is set

After every action, the healer **re-probes** the same service. If still down,
it sets `escalated=true` in the log and the Telegram summary shows
"⚠️ escalating — manual fix needed". The cron will not re-trigger the same
playbook on the next heartbeat tick because the next probe also returns
`down`, which means the next self_healer run will be the next escalation, not
a loop. (We intentionally do **not** rate-limit retries — if a container is
in a crash loop the heartbeat will keep firing and we want to know.)

### Run modes

```bash
# probe → heal → re-probe (fresh)
python3 mira-crawler/agents/self_healer.py

# consume heartbeat from stdin (cron-driven path)
python3 mira-crawler/agents/self_healer.py --stdin < heartbeat.json

# one-shot: pretend a single service is down
python3 mira-crawler/agents/self_healer.py --service mira-pipeline

# preview (no actions, no Telegram)
python3 mira-crawler/agents/self_healer.py --dry-run
```

---

## learning_capture

Runs after every benchmark. Diffs the latest `benchmark_v*.json` against the
previous run and produces:

1. **Learning note** in `docs/learnings/YYYY-MM-DD_<version>.md`:
   - overall delta + grade
   - dimension table
   - per-case regressions with `{previous, current, likely_cause, suggested_fix}`
   - improvements
   - "rubric drift candidates" — cases that have regressed 3+ runs in a row
2. **GitHub issues** — one per *new* regression, deduped by `case_id` so
   re-runs don't spam the tracker. Issues are labelled `benchmark-regression`.
3. **Telegram summary** under the `benchmark` (📊 QA Engineer) persona.

### Heuristics for `likely_cause`

```
runtime error                    → "fix the runtime error first"
"not found" / "no relevant"      → retrieval miss
"incorrect" / "wrong"            → bad reasoning despite retrieval
"incomplete" / "missing"         → answer too sparse
otherwise                        → "unknown — review reasoning"
```

These are intentionally simple — the goal is to give Mike a starting hypothesis,
not a verdict.

---

## funnel_tracker

Daily snapshot + weekly Pulse. Everything is best-effort: a missing data
source becomes a line in the "Collection errors" section, not a crash.

### Inputs

| Source | Auth | What we read |
|---|---|---|
| HubSpot REST | `HUBSPOT_API_KEY` (or `..._ACCESS_TOKEN`) | companies by stage · new leads 7d · open deals + value |
| NeonDB `scan_queue` | `NEON_DATABASE_URL` | scans 7d · KB hit rate · |
| `manual_queue.json` | filesystem | manuals queued |
| NeonDB `bot_messages` | `NEON_DATABASE_URL` | messages 7d · unique users (preferred source) |
| `docker logs mira-bot-telegram` | docker | fallback message count if `bot_messages` missing |
| NeonDB `system_health_log` | `NEON_DATABASE_URL` | 7-day uptime score |

### Output

`docs/reports/pulse/YYYY-Www.md` — daily snapshot overwrites the same week
file. The Monday `--weekly` run is the canonical close + Telegram push.

---

## Cron schedule (full L5 picture)

```
*/15 * * * *   heartbeat_monitor.py --quiet --json > /tmp/mira_heartbeat.json
                 → on exit 2: self_healer.py --stdin < /tmp/mira_heartbeat.json
0 8 * * *      heartbeat_monitor.py --daily-summary
0 3 * * 6      learning_capture.py                  (Sat 03:00 UTC, after weekly bench)
0 13 * * *     funnel_tracker.py                    (daily snapshot)
30 13 * * 1    funnel_tracker.py --weekly           (Mon 13:30 UTC Pulse)
```

Source of truth: `scripts/install_crons.sh`. To install/refresh on the VPS:

```bash
ssh factorylm-prod "cd /opt/mira && bash scripts/install_crons.sh"
```

---

## Runbooks

### "Heartbeat is alerting on `mira-pipeline` every 15 min"

1. SSH to VPS, check container: `docker ps -a | grep mira-pipeline`
2. Look at logs: `docker logs --tail 200 mira-pipeline`
3. Check the heal log: `tail -50 /var/log/mira-agents/self_healer.log` —
   how many restart attempts have already failed?
4. Inspect NeonDB:
   ```sql
   SELECT ts, status, details, action_taken
   FROM system_health_log
   WHERE service = 'mira-pipeline'
   ORDER BY ts DESC LIMIT 30;
   ```
5. If the container is in a crash loop, restarts won't help — fix the
   underlying error, then restart manually. The heartbeat will go green on
   the next 15-min tick.

### "I want to add a new health check"

1. Add the probe function in `heartbeat_monitor.py`. It must return a
   `HealthCheck(service, status, latency_ms, details, category, extra={...})`.
2. If the failure has a fixable signature, set
   `extra={"remediation_hint": "<key>"}`.
3. Wire into `run_all_checks()`.
4. If you added a new hint, add a playbook in `self_healer.py` `PLAYBOOKS`
   dict. Otherwise it falls through to `noop_escalate`.
5. Run `python3 mira-crawler/agents/heartbeat_monitor.py --dry-run --json` to
   verify the new probe shows up.

### "I want to add a new remediation playbook"

1. Write a function `def my_playbook(service: str, hint: str) -> HealAction`.
   It must be idempotent and bounded — no unbounded retries, no destructive
   ops.
2. Register it in `PLAYBOOKS` keyed by the hint.
3. Test:
   ```
   python3 mira-crawler/agents/self_healer.py --dry-run --service <name>
   ```

### "Pulse report is missing pipeline numbers"

`HUBSPOT_API_KEY` not set in Doppler `factorylm/prd`. Pull from settings →
private app token → put in Doppler. Re-run:

```
doppler run -- python3 mira-crawler/agents/funnel_tracker.py --dry-run
```

### "Benchmark fired, but no learning note"

Either:
- `benchmark_v*.json` not in repo root after the run (check the test command
  emits it)
- `--results-dir` mismatch — funnel writes to `docs/reports/`, learning reads
  from `.` by default. Pass `--results-dir <dir>` if needed.

---

## Adding a new agent to the L4 roster

If you're not extending self-maintenance and just want a new digital employee:

1. Pick a slug + emoji and add it to `AGENTS` in
   `mira-crawler/reporting/telegram_notify.py`.
2. Drop a script in `mira-crawler/agents/<your_agent>.py`. Use the existing
   ones as a template — argparse with `--dry-run`, structured logging, log
   to `/var/log/mira-agents/<slug>.log`.
3. Add the cron line to `scripts/install_crons.sh`. Schedule rule of thumb:
   - resource probes: every 5–15 min
   - data refreshes: hourly to 6h
   - reports: daily or weekly
4. Document the agent in this file's "Agent roster" table.

That's the full surface area. The self-maintenance layer keeps it honest.
