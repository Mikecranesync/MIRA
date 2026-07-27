#!/usr/bin/env bash
# crawler_watchdog.sh — DETECTION ONLY. Never restarts the crawler.
#
# Answers one question on a timer: "is the crawler daemon alive AND is its
# schedule firing?" — and, if not, emits a loud alert line (and optionally runs
# $MIRA_WATCHDOG_ALERT_CMD). It deliberately does NOT restart, rebuild, or touch
# the daemon: recovery is a human decision (a wedged daemon usually means a
# state a person should look at, per the repo's git/deploy safety posture).
#
# Two independent checks:
#   1. launchd liveness — the com.mira.crawler job is loaded with a live PID.
#   2. schedule health  — `health.py --json` overall is not "degraded"
#      (degraded = a job failed, or the 30-min healthcheck went stale = the
#      scheduler thread is dead even if the process is technically up).
#
# Exit 0 = all good. Exit 1 = a problem was detected + alerted.
#
# Config via env (the installer bakes these into the LaunchAgent plist — all
# are PATHS, never secrets):
#   CRAWLER_DIR             dir containing health.py (the prod worktree's mira-crawler/)
#   VENV_PYTHON             python that can import health.py (stdlib-only deps)
#   MIRA_JOB_HEARTBEAT_LOG  the daemon's heartbeat log (so health reads the same file)
#   WATCHDOG_LOG            append-only status log (default: /tmp/mira-crawler-watchdog.log)
#   LAUNCHD_LABEL           default: com.mira.crawler
#   MIRA_WATCHDOG_ALERT_CMD optional: shell command run once per detected problem,
#                           receives the alert text on stdin
set -euo pipefail

CRAWLER_DIR="${CRAWLER_DIR:?set CRAWLER_DIR to the crawler dir containing health.py}"
VENV_PYTHON="${VENV_PYTHON:?set VENV_PYTHON to a python that can import health.py}"
WATCHDOG_LOG="${WATCHDOG_LOG:-/tmp/mira-crawler-watchdog.log}"
LAUNCHD_LABEL="${LAUNCHD_LABEL:-com.mira.crawler}"

now() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

log() { printf '%s %s\n' "$(now)" "$1" >>"$WATCHDOG_LOG"; }

alert() {
  # $1 = short reason. Loud line to the log + optional external notifier.
  local msg="[ALERT] mira-crawler watchdog: $1"
  log "$msg"
  printf '%s\n' "$msg" >&2
  if [[ -n "${MIRA_WATCHDOG_ALERT_CMD:-}" ]]; then
    printf '%s\n' "$msg" | eval "$MIRA_WATCHDOG_ALERT_CMD" || log "[WARN] alert command failed"
  fi
}

problems=0

# Check 1: launchd liveness — the job is loaded with a numeric (live) PID.
# `launchctl list <label>` prints "PID" = a number when running, "-" when not.
if pid_line="$(launchctl list "$LAUNCHD_LABEL" 2>/dev/null)"; then
  pid="$(printf '%s\n' "$pid_line" | awk -F'= ' '/"PID"/ {gsub(/;/,"",$2); print $2}')"
  if [[ -z "$pid" || "$pid" == "0" ]]; then
    alert "launchd job '$LAUNCHD_LABEL' loaded but has no live PID"
    problems=1
  fi
else
  alert "launchd job '$LAUNCHD_LABEL' is not loaded"
  problems=1
fi

# Check 2: schedule health — dependency-free health CLI, exit 1 => degraded.
health_json=""
if health_json="$(cd "$CRAWLER_DIR" && "$VENV_PYTHON" health.py --json 2>>"$WATCHDOG_LOG")"; then
  log "[ok] health: $(printf '%s' "$health_json" | tr -d '\n' | cut -c1-200)"
else
  overall="$(printf '%s' "$health_json" | awk -F'"' '/"overall"/ {print $4; exit}')"
  alert "schedule health is degraded (overall=${overall:-unknown}) — see 'health.py --json'"
  problems=1
fi

if [[ "$problems" -eq 0 ]]; then
  log "[ok] daemon alive and schedule healthy"
fi
exit "$problems"
