#!/usr/bin/env bash
# install_watchdog.sh — install / uninstall the DETECTION-ONLY crawler watchdog.
#
# Renders com.mira.crawler-watchdog.plist.template (substituting local paths, no
# secrets) into ~/Library/LaunchAgents/ and loads it via launchctl. It does NOT
# touch the crawler daemon (com.mira.crawler) at all — only its own watchdog job.
#
# Usage:
#   ./install_watchdog.sh install   [--crawler-dir DIR] [--venv-python PY] [--heartbeat-log PATH]
#   ./install_watchdog.sh uninstall
#   ./install_watchdog.sh status
#
# Rollback: `./install_watchdog.sh uninstall` fully removes the watchdog. If a
# prior watchdog plist existed, install backs it up to <plist>.bak-<UTCts> first;
# restore with: launchctl unload <plist> && cp <bak> <plist> && launchctl load <plist>.
set -euo pipefail

LABEL="com.mira.crawler-watchdog"
OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRAWLER_DEFAULT="$(cd "$OPS_DIR/.." && pwd)"                 # mira-crawler/
TEMPLATE="$OPS_DIR/com.mira.crawler-watchdog.plist.template"
WATCHDOG_SH="$OPS_DIR/crawler_watchdog.sh"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST="$PLIST_DIR/$LABEL.plist"

# Defaults — override with flags. All PATHS, never secrets.
CRAWLER_DIR="$CRAWLER_DEFAULT"
VENV_PYTHON="$CRAWLER_DEFAULT/.venv/bin/python"
HEARTBEAT_LOG="$CRAWLER_DEFAULT/data/job_heartbeat.jsonl"
WATCHDOG_LOG="$HOME/Library/Logs/mira-crawler-watchdog.log"

now() { date -u +"%Y%m%dT%H%M%SZ"; }

cmd_install() {
  [[ -f "$TEMPLATE" ]] || { echo "template missing: $TEMPLATE" >&2; exit 1; }
  [[ -f "$WATCHDOG_SH" ]] || { echo "watchdog script missing: $WATCHDOG_SH" >&2; exit 1; }
  chmod +x "$WATCHDOG_SH"
  mkdir -p "$PLIST_DIR" "$(dirname "$WATCHDOG_LOG")"

  # Back up any existing plist before overwriting (rollback point).
  if [[ -f "$PLIST" ]]; then
    local bak
    bak="$PLIST.bak-$(now)"
    cp "$PLIST" "$bak"
    echo "backed up existing plist -> $bak"
    launchctl unload "$PLIST" 2>/dev/null || true
  fi

  sed \
    -e "s|__WATCHDOG_SH__|$WATCHDOG_SH|g" \
    -e "s|__CRAWLER_DIR__|$CRAWLER_DIR|g" \
    -e "s|__VENV_PYTHON__|$VENV_PYTHON|g" \
    -e "s|__HEARTBEAT_LOG__|$HEARTBEAT_LOG|g" \
    -e "s|__WATCHDOG_LOG__|$WATCHDOG_LOG|g" \
    "$TEMPLATE" >"$PLIST"

  launchctl load "$PLIST"
  echo "installed + loaded $LABEL"
  echo "  crawler_dir : $CRAWLER_DIR"
  echo "  venv_python : $VENV_PYTHON"
  echo "  heartbeat   : $HEARTBEAT_LOG"
  echo "  watchdog log: $WATCHDOG_LOG"
  echo "NOTE: detection only — this never restarts com.mira.crawler."
}

cmd_uninstall() {
  if [[ -f "$PLIST" ]]; then
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "uninstalled $LABEL (removed $PLIST)"
  else
    echo "nothing to uninstall ($PLIST absent)"
  fi
}

cmd_status() {
  echo "== launchctl =="; launchctl list "$LABEL" 2>/dev/null || echo "$LABEL not loaded"
  echo "== plist =="; [[ -f "$PLIST" ]] && echo "$PLIST present" || echo "$PLIST absent"
  echo "== recent watchdog log =="; tail -n 10 "$WATCHDOG_LOG" 2>/dev/null || echo "(no log yet)"
}

action="${1:-}"; shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --crawler-dir) CRAWLER_DIR="$2"; shift 2 ;;
    --venv-python) VENV_PYTHON="$2"; shift 2 ;;
    --heartbeat-log) HEARTBEAT_LOG="$2"; shift 2 ;;
    --watchdog-log) WATCHDOG_LOG="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

case "$action" in
  install) cmd_install ;;
  uninstall) cmd_uninstall ;;
  status) cmd_status ;;
  *) echo "usage: $0 {install|uninstall|status} [--crawler-dir DIR] [--venv-python PY] [--heartbeat-log PATH] [--watchdog-log PATH]" >&2; exit 2 ;;
esac
