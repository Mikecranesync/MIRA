# Self-Healer Flow

**One-line:** 15-min cron → heartbeat_monitor probe → detect DOWN services → dispatch playbook → restart/cleanup/retry → re-verify → Telegram alert.

**Cross-links:**
- `mira-crawler/agents/self_healer.py` — self-healer implementation
- `mira-crawler/agents/heartbeat_monitor.py` — health probe layer
- `scripts/install_crons.sh` — VPS crontab (source of truth for scheduling)
- `mira-crawler/reporting/telegram_notify.py` — Telegram alert sink (import tried at healer startup; falls back to print stub if absent)
- `docs/runbooks/fix-hub-container-removed.md` — runbook for the recreate gap bug (confirmed exists)
- Memory entry `project_self_healer_recreate_gap.md` — incident report, root cause, sanctioned recovery
- Memory entry `project_vps_provider_digitalocean.md` — VPS is DigitalOcean

**KNOWN CRITICAL BUG — recreate gap:** `self_healer.restart_container()` calls `docker restart <service>`, which ONLY works if the container is stopped or unhealthy. If a container has been REMOVED (not just stopped), `docker restart` fails silently. The container is not recreated. See "What Can Go Wrong" §1 for the only sanctioned recovery.

---

## Summary

The heartbeat monitor runs every 15 minutes on the VPS via cron. When it finds a DOWN service (exit code 2), the cron line pipes its JSON output directly to `self_healer.py --stdin`. The healer dispatches one of five playbooks per DOWN service, logs actions to NeonDB `system_health_log`, re-verifies, and sends a Telegram alert summarizing what happened. Services that remain DOWN after the healer's attempt are flagged for manual escalation.

**Scope is deliberately tiny.** The healer will:
- `docker restart <container>` — if container is stopped/unhealthy
- `docker system prune -f` + truncate logs >100MB — if disk full
- Run `kb_growth_cron.py` once — if KB cron is stale
- Retry `SELECT 1` 3× — if NeonDB connection is failing

The healer will NOT: `docker rm`, rebuild images, edit nginx configs, touch volumes, or run as root (unless `MIRA_HEALER_ALLOW_ROOT=1`).

---

## The Flow

### Step 1 — Cron trigger (every 15 minutes on VPS)

**File:** `scripts/install_crons.sh`
**Cron line:**
```bash
*/15 * * * *  cd $MIRA_DIR && doppler run -- python3 mira-crawler/agents/heartbeat_monitor.py \
  --quiet --json > /tmp/mira_heartbeat.json 2>> $LOG_DIR/heartbeat.log; \
  if [ $? -eq 2 ]; then \
    doppler run -- python3 mira-crawler/agents/self_healer.py --stdin \
      < /tmp/mira_heartbeat.json >> $LOG_DIR/self_healer.log 2>&1; \
  fi
```

**Exit code contract:**
- `heartbeat_monitor.py` exits 0 → everything healthy → self-healer NOT called
- `heartbeat_monitor.py` exits 2 → one or more services DOWN → self-healer called with `--stdin`

The JSON written to `/tmp/mira_heartbeat.json` is also persisted to NeonDB `system_health_log` by `heartbeat_monitor.py` itself before exiting.

**Companion cron** (daily summary, no self-healer):
```bash
0 8 * * *  python3 mira-crawler/agents/heartbeat_monitor.py --daily-summary
```

### Step 2 — Heartbeat probe (`heartbeat_monitor.py`)

**File:** `mira-crawler/agents/heartbeat_monitor.py`
**Architecture:** Runs ON THE VPS itself (cron), all checks are local.

Probes (`run_all_checks()` at `heartbeat_monitor.py:450`):
| Service | How checked | Remediation hint emitted |
|---------|-------------|--------------------------|
| Critical containers | `docker ps` check | `container_missing`, `container_exited`, `container_unhealthy`, `container_restarting` |
| API endpoints | `curl https://app.factorylm.com/...` | `api_5xx` |
| Telegram bot | `docker logs mira-bot-telegram --since 5m` for poll evidence | `bot_not_polling` |
| NeonDB | `psycopg2` `SELECT 1` | `neondb_connection` |
| KB cron freshness | `stat(manual_queue.json)` | `kb_cron_stale` |
| Disk / memory | `df -h /`, `free -m` | `disk_full` |

Each probe returns a `HealthCheck` dataclass with `service`, `status` (healthy/degraded/down/unknown), `latency_ms`, `details`, `category`, and `extra` dict containing `remediation_hint`.

`STATUS_DOWN = "down"` (defined at `heartbeat_monitor.py:97`).

`CRITICAL_CONTAINERS` (defined at `heartbeat_monitor.py:112`):
```python
["mira-hub", "mira-pipeline-saas", "mira-bot-telegram", "mira-scan-backend",
 "cmms-backend", "mira-docling-saas", "mira-web", "mira-mcp-saas"]
```

### Step 3 — Load heartbeat input

**File:** `mira-crawler/agents/self_healer.py`
**Function:** `load_input(args) -> dict`

Three input modes (priority order):
1. `--stdin` — reads heartbeat JSON from stdin (used by cron; the JSON was written to `/tmp/mira_heartbeat.json`)
2. `--service <name>` — one-shot: pretends that service is DOWN with hint `container_exited`
3. (no args) — runs a fresh probe itself: calls `hb.run_all_checks()`, `hb.health_score(checks)`, `hb.persist(checks, score)`, then collects DOWN checks

Down checks are extracted: `down = [asdict(c) for c in checks if c.status == STATUS_DOWN]`.

If `down` is empty → logs "nothing down — exiting", returns 0.

### Step 4 — Hint → playbook routing

**File:** `mira-crawler/agents/self_healer.py`
**Dict:** `PLAYBOOKS` at `self_healer.py:187`

| `remediation_hint` | Playbook called |
|---------------------|-----------------|
| `container_missing` | `restart_container` |
| `container_exited` | `restart_container` |
| `container_unhealthy` | `restart_container` |
| `container_restarting` | `restart_container` |
| `api_5xx` | `restart_container` (after ENDPOINT_TO_CONTAINER lookup) |
| `endpoint_unreachable` | `noop_escalate` (DNS/TLS/nginx — don't touch) |
| `bot_not_polling` | `restart_container` |
| `neondb_connection` | `neondb_retry` |
| `disk_full` | `disk_cleanup` |
| `kb_cron_stale` | `trigger_kb_cron` |
| (unknown hint) | `noop_escalate` |

For `api_5xx`: `ENDPOINT_TO_CONTAINER` maps endpoint labels to container names:
```python
"app.factorylm.com/api/health": "mira-web",
"app.factorylm.com/api/scanbe/healthz": "mira-scan-backend",
"factorylm.com": "mira-web",
```

`heal_one(check, dry_run)` dispatches to the chosen playbook. In `--dry-run` mode, returns a `HealAction` with `action="DRY-RUN: would call {playbook.__name__}({target})"` — no actual commands run.

### Step 5 — Playbook execution

**File:** `mira-crawler/agents/self_healer.py`

#### `restart_container(service, hint) -> HealAction`
```python
rc, out, err = _run(["docker", "restart", service], timeout=60)
```
**KNOWN BUG:** `docker restart` fails if the container has been REMOVED (not just stopped). Exit code non-zero, `HealAction.succeeded=False`, `details` contains error text. The container is NOT recreated. See §"What Can Go Wrong" for the sanctioned recovery.

#### `disk_cleanup(service, hint) -> HealAction`
```python
_run(["docker", "system", "prune", "-f"], timeout=120)
```
Then truncates log files >100MB under `$LOG_DIR` (`/var/log/mira-agents` by default) by writing empty string (does NOT delete).

#### `neondb_retry(service, hint) -> HealAction`
Calls `hb.check_neondb()` up to 3 times with 5-second sleeps. Returns success if any attempt returns `STATUS_HEALTHY`. If all 3 fail, `details = "still failing after 3 retries — likely Neon-side"`.

#### `trigger_kb_cron(service, hint) -> HealAction`
```python
script = Path(os.environ.get("MIRA_DIR", "/opt/mira")) / "mira-crawler" / "cron" / "kb_growth_cron.py"
_run(["python3", str(script)], timeout=300)
```
Returns failure if script not found at expected path.

#### `noop_escalate(service, hint) -> HealAction`
Returns `HealAction(succeeded=False, escalated=True, details="no automatic remediation defined")`. Causes Telegram alert with "escalating — manual fix needed".

### Step 6 — Log actions to NeonDB

**File:** `mira-crawler/agents/self_healer.py`
**Function:** `log_actions(actions, dry_run)`
**Table:** `system_health_log` (NeonDB)

```sql
INSERT INTO system_health_log
    (service, status, latency_ms, details, category, action_taken, extra)
VALUES
    (:service, :status, 0, :details, 'heal', :action, :extra)
```

`status` is `"healed"` if `action.succeeded` else `"heal_failed"`.
`extra` = JSON `{"hint": str, "escalated": bool}`.

Uses `sqlalchemy` + `NullPool` + `sslmode=require`. On DB error, logs a warning and continues (non-fatal).

`system_health_log` schema is defined inline in `heartbeat_monitor.py:482` via `CREATE TABLE IF NOT EXISTS` — it is NOT a Hub migration file. The table is created automatically on the first heartbeat probe run. Columns: `id BIGSERIAL PK`, `ts TIMESTAMPTZ`, `service TEXT`, `status TEXT`, `latency_ms INT`, `details TEXT`, `category TEXT`, `score INT`, `action_taken TEXT`, `extra JSONB`. Two indexes: `ix_health_log_ts (ts DESC)` and `ix_health_log_service_ts (service, ts DESC)`.

### Step 7 — Re-verify (reverify)

**File:** `mira-crawler/agents/self_healer.py`
**Function:** `reverify(checks: list[dict]) -> dict[str, str]`

Runs the specific probe for each service that was healed:
- Container services: `hb.check_container(svc).status`
- Telegram: `hb.check_telegram_polling().status`
- NeonDB: `hb.check_neondb().status`
- KB cron: `hb.check_kb_cron_freshness().status`
- Disk: `hb.check_disk().status`

Returns `{service_name: status_string}`. A service not in `hb.CRITICAL_CONTAINERS` returns `"unverified"`.

`reverify()` is NOT called in `--dry-run` mode — `post_status = {}` instead.

### Step 8 — Telegram alert

**File:** `mira-crawler/agents/self_healer.py`
**Function:** `format_telegram_summary(actions, post_status) -> str`
**Alert function:** `notify("system", summary)` via `mira-crawler/reporting/telegram_notify.py`

`notify` is loaded at import time via `_load_notify()` — tries package import first, then file-path import, falls back to a print stub if the file doesn't exist.

Message format:
```
*Self-Healer — HH:MM UTC*
✅/❌ `<service>` (<hint>)
   action: <action string>
   details: <first 140 chars of details>
   recheck: <post-status>
   ⚠️ *escalating — manual fix needed*  (if escalated or still down)
```

Telegram alert is sent for EVERY healer run that had any DOWN services — whether the heal succeeded or not. There is no dedup / flood protection in the healer itself (though `heartbeat_monitor.py` implements "DEGRADED > 30 min → escalating warning" logic separately via NeonDB state).

### Step 9 — Exit code

**File:** `mira-crawler/agents/self_healer.py:main()`

```python
failed = [a for a in actions if not a.succeeded
          or (post_status.get(a.service) and post_status[a.service] != hb.STATUS_HEALTHY)]
return 0 if not failed else 2
```

Exit 0 = all healed and re-verified healthy.
Exit 2 = at least one service still not healthy after the heal attempt → logged to `$LOG_DIR/self_healer.log`, Telegram already alerted.

---

## ASCII Flow Diagram

```
cron: */15 * * * *                         [scripts/install_crons.sh]
          |
          v
heartbeat_monitor.py --quiet --json        [heartbeat_monitor.py]
  ├── check_container(svc) × N             docker ps
  ├── check API endpoints                  curl http://localhost:{port}/health
  ├── check_telegram_polling()             docker logs --since 5m
  ├── check_neondb()                       psycopg2 SELECT 1
  ├── check_kb_cron_freshness()            stat(manual_queue.json)
  ├── check_disk()                         df -h /
  └── persist(checks, score)              → NeonDB system_health_log
          |
          |-- exit 0 (all healthy) → done
          |
          v (exit 2 = DOWN services found)
  /tmp/mira_heartbeat.json (JSON of checks)
          |
          v
self_healer.py --stdin                     [self_healer.py]
          |
          v
load_input(args) → report["down"] list    [self_healer.py:307]
          |
          v
for each DOWN check:
  heal_one(check, dry_run)                [self_healer.py:213]
    |-- hint → PLAYBOOKS lookup
    |-- restart_container()    → docker restart <svc>   (timeout=60s)
    |-- disk_cleanup()         → docker system prune -f + log trim
    |-- neondb_retry()         → hb.check_neondb() × 3
    |-- trigger_kb_cron()      → python3 kb_growth_cron.py (timeout=300s)
    |-- noop_escalate()        → escalated=True, no command
          |
          v
log_actions(actions)                      → NeonDB system_health_log
          |
          v
reverify(down)                            → re-probe each healed service
          |
          v
format_telegram_summary(actions, post_status)
notify("system", summary)                → Telegram bot
          |
          v
exit 0 (all healed) or exit 2 (still failing)
```

---

## Tables Touched

| Table | DB | Migration | When |
|-------|----|-----------|------|
| `system_health_log` | NeonDB | Inline `CREATE TABLE IF NOT EXISTS` in `mira-crawler/agents/heartbeat_monitor.py:482` (not a Hub migration) | Step 2: heartbeat probe persists checks; Step 6: healer logs actions |

---

## What Can Go Wrong

### 1. CRITICAL: recreate gap — container REMOVED, not just stopped

**Root cause documented in:** memory entry `project_self_healer_recreate_gap.md`

`restart_container()` calls `docker restart <service>`. This command fails with a non-zero exit if the container has been REMOVED from Docker's container list (as opposed to merely stopped or exited). The healer's `HealAction.succeeded = False`, Telegram alerts, and the container REMAINS absent.

**Symptom:** `app.factorylm.com` returns 502 for an extended period; `docker ps -a` does NOT show the removed container; healer keeps firing every 15 minutes with the same failure.

**Sanctioned recovery:**
```bash
gh workflow run deploy-vps.yml \
  -f services="mira-hub" \
  -f skip_staging_gate=true \
  -f skip_reason="container removed, not crashed — healer cannot recreate"
```
`docker compose up -d` (called by the deploy workflow) CREATES containers that `docker restart` cannot. Verify success: `curl https://app.factorylm.com/api/health` should return 200. The deploy workflow reports `conclusion=failure` due to a mira-pipeline health-probe false alarm — ignore it and verify the URL directly.

**Bug status:** fix branch `fix/self-healer-recreate-and-alerts` exists on `origin` but is NOT merged to `main` (verified 2026-06-07). Until merged, the healer CANNOT recover from a removed container.

### 2. Alert spam / flood

The healer sends a Telegram alert for EVERY 15-minute cycle where a service is DOWN. If a service is removed and the healer can't fix it, Mike receives one alert every 15 minutes until the runbook recovery is run. There is no dedup or exponential back-off in the healer's alert path. `heartbeat_monitor.py` has a "DEGRADED > 30 min → escalating" mechanic via NeonDB, but that's separate from the healer's own Telegram calls.

Mitigation (until the bug is fixed): check `system_health_log` for `escalated=true` entries and use that as the signal rather than counting Telegram messages.

### 3. `docker restart` false success on flapping container

`hint=container_restarting` (container is in a restart loop) maps to `restart_container`. Issuing `docker restart` to a flapping container may appear to succeed (exit 0) because it restarts the already-restarting container. The reverify probe may catch it as healthy if the container happens to be up at probe time. Telegram shows ✅ but the container crashes again seconds later. Watch `docker logs --since 15m <svc>` for crash loops.

### 4. Disk cleanup truncates logs but doesn't free image layers

`disk_cleanup()` runs `docker system prune -f` (removes dangling images, stopped containers, unused networks) and truncates log files >100MB. It does NOT `docker image prune -a` (all unused images), which is where most disk is consumed. A disk-full caused by unused image accumulation will show `HealAction.succeeded=True` (prune exits 0) but may not actually free enough space. Verify with `df -h /` after the run.

### 5. `trigger_kb_cron` path dependency

`trigger_kb_cron()` constructs:
```python
script = Path(os.environ.get("MIRA_DIR", "/opt/mira")) / "mira-crawler" / "cron" / "kb_growth_cron.py"
```
If `MIRA_DIR` is wrong, or `kb_growth_cron.py` was moved/renamed, this fails immediately with "script not found". The default `MIRA_DIR=/opt/mira` is the VPS deploy path — correct for prod, wrong for local dev.

### 6. `MIRA_HEALER_ALLOW_ROOT` guard

`self_healer.py:348` checks `os.geteuid() == 0` and exits 3 unless `MIRA_HEALER_ALLOW_ROOT=1`. The cron line in `install_crons.sh` sets `MIRA_HEALER_ALLOW_ROOT=1` in the crontab environment. If the crontab is re-installed without that env var, the healer will refuse to run on every trigger.

### 7. `system_health_log` must exist before healer runs

`system_health_log` is created by `heartbeat_monitor.py:482` using `CREATE TABLE IF NOT EXISTS` — it is NOT a Hub migration. The table auto-creates on the first successful heartbeat probe run (i.e., when `NEON_DATABASE_URL` is set and the probe reaches the `persist()` call). If the heartbeat probe has never successfully run on a fresh environment, the table won't exist and `log_actions()` in the healer will produce DB errors (non-fatal; heal proceeds but audit trail is lost). To pre-create: run `heartbeat_monitor.py` once with `NEON_DATABASE_URL` set before the healer is needed.

### 8. `notify` stub fallback

If `mira-crawler/reporting/telegram_notify.py` is absent or fails to import, `_load_notify()` silently falls back to a print stub. Telegram alerts will appear in the log file but NOT reach Mike's phone. If you see healer log entries but no Telegram messages, check if the notify file exists and the bot token/chat ID are set in Doppler.
