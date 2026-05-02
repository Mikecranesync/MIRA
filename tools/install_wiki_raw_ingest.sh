#!/usr/bin/env bash
# Install the launchd WatchPaths agent that ingests ~/MiraDrop/*.md
# into wiki/raw/<date>/. Idempotent — re-running replaces the plist
# only if its content changed and reloads the agent cleanly.
#
# Run on each node where you want auto-ingest.
# Uninstall: launchctl bootout gui/$UID com.mira.wiki-raw-ingest

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.mira.wiki-raw-ingest"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DROP="$HOME/MiraDrop"
PYTHON_BIN="$(command -v python3)"
GIT_BIN="$(command -v git)"

if [[ -z "$PYTHON_BIN" || -z "$GIT_BIN" ]]; then
  echo "ERROR: python3 and git must be on PATH" >&2
  exit 2
fi

mkdir -p "$DROP"
mkdir -p "$HOME/Library/Logs"
mkdir -p "$(dirname "$PLIST")"

# Inherit PATH so the script can find git when launchd invokes it
PATH_VALUE="$(dirname "$GIT_BIN"):$(dirname "$PYTHON_BIN"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"

NEW_PLIST="$(mktemp)"
trap 'rm -f "$NEW_PLIST"' EXIT

cat > "$NEW_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PYTHON_BIN</string>
    <string>$REPO_ROOT/tools/wiki_raw_ingest.py</string>
  </array>
  <key>WatchPaths</key>
  <array><string>$DROP</string></array>
  <key>RunAtLoad</key><false/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$PATH_VALUE</string>
    <key>HOME</key><string>$HOME</string>
    <key>REPO_ROOT</key><string>$REPO_ROOT</string>
  </dict>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/wiki-raw-ingest.stdout.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/wiki-raw-ingest.stderr.log</string>
</dict>
</plist>
EOF

plutil -lint "$NEW_PLIST" >/dev/null

if [[ -f "$PLIST" ]] && cmp -s "$NEW_PLIST" "$PLIST"; then
  echo "plist unchanged at $PLIST"
else
  install -m 0644 "$NEW_PLIST" "$PLIST"
  echo "wrote $PLIST"
fi

# Reload — bootout is no-op if not loaded; ignore the error
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl enable "gui/$UID/$LABEL"

echo
echo "Installed. Drop a .md file into $DROP and check:"
echo "  tail -f ~/Library/Logs/wiki-raw-ingest.log"
echo "Uninstall: launchctl bootout gui/\$UID/$LABEL && rm $PLIST"
