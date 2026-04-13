#!/bin/bash
# Sync industrial documents from Google Drive folders via rclone.
# Prerequisites: rclone configured with 'gdrive2tb' remote.
#   Run: rclone config  (add remote named gdrive2tb, type: drive)
#   Test: rclone ls gdrive2tb:"VFD manual pdfs" --max-depth 1
#
# Usage:
#   ~/Mira/mira-core/scripts/sync_gdrive_docs.sh
#   ~/Mira/mira-core/scripts/sync_gdrive_docs.sh --dry-run

set -euo pipefail

MIRA_ROOT="${MIRA_ROOT:-$HOME/Mira}"
DEST="$MIRA_ROOT/mira-core/data/manuals/pdf"
LOG="$MIRA_ROOT/mira-core/data/manuals/sync.log"
DRY_RUN=""

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="--dry-run"
  echo "$(date): DRY RUN — no files will be copied" | tee -a "$LOG"
fi

# Google Drive folders to sync — update after running: rclone lsd gdrive2tb:
FOLDERS=(
  "VFD manual pdfs"
  "factorylm-archives"
)

mkdir -p "$DEST"
mkdir -p "$(dirname "$LOG")"

echo "$(date): Starting gdrive2tb sync → $DEST" | tee -a "$LOG"

for FOLDER in "${FOLDERS[@]}"; do
  echo "$(date): Syncing folder: $FOLDER" | tee -a "$LOG"
  rclone copy \
    "gdrive2tb:${FOLDER}" \
    "$DEST" \
    --include "*.pdf" \
    --include "*.txt" \
    --include "*.md" \
    --include "*.html" \
    --include "*.htm" \
    --log-file "$LOG" \
    --log-level INFO \
    $DRY_RUN \
    2>&1 || echo "$(date): WARNING — folder '$FOLDER' may not exist or failed" | tee -a "$LOG"
  echo "$(date): Done syncing: $FOLDER" >> "$LOG"
done

TOTAL=$(find "$DEST" -type f \( -iname "*.pdf" -o -iname "*.txt" -o -iname "*.md" -o -iname "*.html" -o -iname "*.htm" \) 2>/dev/null | wc -l | tr -d ' ')
echo "$(date): Sync complete. Total docs in $DEST: $TOTAL" | tee -a "$LOG"
