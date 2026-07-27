# MIRA crawler watchdog — detection only (install / uninstall / rollback)

A LaunchAgent that, every 10 minutes, checks the crawler daemon is alive and its
schedule is firing — and **alerts** if not. It **never restarts, rebuilds, or
touches** the crawler: recovery is a human decision (a wedged daemon usually
signals a state a person should inspect). Companion runtime doc:
`docs/ops/crawler-runtime.md`.

## What it checks

1. **launchd liveness** — `com.mira.crawler` is loaded with a live PID.
2. **schedule health** — `health.py --json` overall is not `degraded` (a job
   `failed`, or the 30-min healthcheck went `stale` = scheduler thread dead even
   if the process is nominally up). Cold start (`no_evidence_yet`) is **not** an
   alert — a fresh box is never flagged.

On a detected problem it writes an `[ALERT]` line to its log and, if
`MIRA_WATCHDOG_ALERT_CMD` is set, pipes the alert text to that command (wire it
to the ops Telegram sender — staging bot, per `project_telegram_alert_routing`).

## Files

| File | Role |
|---|---|
| `mira-crawler/ops/crawler_watchdog.sh` | the detection script (shellcheck-clean, exit 1 on problem) |
| `mira-crawler/ops/com.mira.crawler-watchdog.plist.template` | LaunchAgent template — **paths only, no secrets** |
| `mira-crawler/ops/install_watchdog.sh` | render + load / uninstall / status, with backup+rollback |

The watchdog needs **no Doppler token**: it reads local heartbeat JSONL +
`launchctl`, it never runs a crawl. Do not add `DOPPLER_TOKEN` to the plist.

## Install (on Bravo, once the heartbeat-emitting daemon is deployed)

```bash
cd /Users/bravonode/mira-crawler-prod/mira-crawler   # the prod worktree
ops/install_watchdog.sh install \
  --crawler-dir  /Users/bravonode/mira-crawler-prod/mira-crawler \
  --venv-python  /Users/bravonode/mira-crawler-prod/mira-crawler/.venv/bin/python \
  --heartbeat-log /Users/bravonode/mira-crawler-prod/mira-crawler/data/job_heartbeat.jsonl
```

Defaults resolve to the crawler dir the script lives in, so on the prod worktree
`ops/install_watchdog.sh install` with no flags is usually correct. Point
`--heartbeat-log` at the **same** file the daemon writes (`MIRA_JOB_HEARTBEAT_LOG`
in `run.sh`, or the `data/job_heartbeat.jsonl` default) or health will read an
empty log and always say `no_evidence_yet`.

> **Sequencing:** the watchdog is only meaningful once the daemon actually emits
> heartbeats — i.e. after the `main.py` in this PR is deployed (a reviewed,
> SHA-changing follow-up). Installing it before then just reports
> `no_evidence_yet` forever. Deploy first, then install the watchdog.

## Status / uninstall / rollback

```bash
ops/install_watchdog.sh status      # launchctl state + plist presence + recent log
ops/install_watchdog.sh uninstall   # unload + remove the watchdog plist (full rollback)
```

`install` backs up any pre-existing watchdog plist to `<plist>.bak-<UTCts>`
before overwriting. To restore a backup:

```bash
launchctl unload ~/Library/LaunchAgents/com.mira.crawler-watchdog.plist
cp ~/Library/LaunchAgents/com.mira.crawler-watchdog.plist.bak-<UTCts> \
   ~/Library/LaunchAgents/com.mira.crawler-watchdog.plist
launchctl load ~/Library/LaunchAgents/com.mira.crawler-watchdog.plist
```

Uninstalling the watchdog touches **only** `com.mira.crawler-watchdog` — the
crawler daemon `com.mira.crawler` is never affected.

## Verifying it works (no daemon impact)

```bash
# healthy / cold-start → exit 0, no alert
WATCHDOG_LOG=/tmp/wd.log CRAWLER_DIR=<dir> VENV_PYTHON=<py> \
  MIRA_JOB_HEARTBEAT_LOG=/tmp/absent.jsonl bash ops/crawler_watchdog.sh; echo $?

# degraded → [ALERT] line + exit 1  (synthesize a failed heartbeat first)
```

Both paths were validated during PR authoring; see the PR body for the exact
commands and output.
