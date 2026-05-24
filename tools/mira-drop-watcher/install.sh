#!/usr/bin/env bash
# MiraDrop LaunchAgent installer.
#
# - Creates a venv at tools/mira-drop-watcher/.venv if missing
# - Renders com.factorylm.mira-drop-watcher.plist with absolute paths
# - Installs to ~/Library/LaunchAgents/ and bootstraps via launchctl
#
# Idempotent: re-running upgrades deps and reloads the agent.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.factorylm.mira-drop-watcher"
PLIST_SRC="${HERE}/${LABEL}.plist"
PLIST_DST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
VENV="${HERE}/.venv"
PY_BIN="${VENV}/bin/python"

PYTHON3="$(command -v python3 || true)"
if [[ -z "${PYTHON3}" ]]; then
    echo "[fatal] python3 not found on PATH" >&2
    exit 1
fi

DOPPLER_BIN="$(command -v doppler || true)"
if [[ -z "${DOPPLER_BIN}" ]]; then
    echo "[fatal] doppler CLI not on PATH (need it to inject secrets at agent load)" >&2
    exit 1
fi
# Resolve symlinks so launchd doesn't depend on shell PATH
DOPPLER_BIN="$(/usr/bin/python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "${DOPPLER_BIN}")"

if [[ ! -x "${PY_BIN}" ]]; then
    echo "[setup] creating venv at ${VENV}"
    "${PYTHON3}" -m venv "${VENV}"
fi
echo "[setup] installing/upgrading deps"
"${PY_BIN}" -m pip install --quiet --upgrade pip
"${PY_BIN}" -m pip install --quiet -r "${HERE}/requirements.txt"

mkdir -p "${HOME}/Library/LaunchAgents" "${HOME}/Library/Logs"

# Render plist
sed \
    -e "s|__HOME__|${HOME}|g" \
    -e "s|__DOPPLER__|${DOPPLER_BIN}|g" \
    -e "s|__PYTHON__|${PY_BIN}|g" \
    -e "s|__WATCHER_DIR__|${HERE}|g" \
    "${PLIST_SRC}" > "${PLIST_DST}"
echo "[setup] wrote ${PLIST_DST}"

# Unload any previous version (ignore failure on first install)
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true

launchctl bootstrap "gui/$(id -u)" "${PLIST_DST}"
launchctl kickstart -k "gui/$(id -u)/${LABEL}"
sleep 1

if launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
    echo "[ok] ${LABEL} loaded"
    echo "     logs: ${HOME}/Library/Logs/mira-drop-watcher.{out,err}.log"
    echo "     drop a file into: ${HOME}/MiraDrop/inbox/"
else
    echo "[warn] could not verify ${LABEL} loaded — check launchctl print gui/$(id -u)/${LABEL}" >&2
    exit 1
fi
