#!/bin/bash
# Sync equipment photos from Google Photos albums via rclone.
# Prerequisites: rclone configured with 'gphotos' remote (read-only).
#
# Usage:
#   ~/Mira/mira-core/scripts/sync_gphotos.sh
#   ~/Mira/mira-core/scripts/sync_gphotos.sh --dry-run

set -euo pipefail

MIRA_ROOT="${MIRA_ROOT:-$HOME/Mira}"
INCOMING="$MIRA_ROOT/mira-core/data/equipment_photos/incoming"
LOG="$MIRA_ROOT/mira-core/data/equipment_photos/sync.log"
DRY_RUN=""

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="--dry-run"
  echo "$(date): DRY RUN — no files will be copied" | tee -a "$LOG"
fi

# Target albums — update these after running: rclone lsd gphotos:album
ALBUMS=(
  "Equipment Photos"
  "Maintenance"
  "Nameplates"
)

mkdir -p "$INCOMING"

echo "$(date): Starting gphotos sync" >> "$LOG"

for ALBUM in "${ALBUMS[@]}"; do
  DEST="$INCOMING/${ALBUM// /_}"
  echo "$(date): Syncing album: $ALBUM → $DEST" | tee -a "$LOG"
  rclone copy \
    "gphotos:album/${ALBUM}" \
    "$DEST" \
    --include "*.jpg" \
    --include "*.jpeg" \
    --include "*.png" \
    --include "*.heic" \
    --include "*.HEIC" \
    --log-file "$LOG" \
    --log-level INFO \
    $DRY_RUN \
    2>&1 || echo "$(date): WARNING — album '$ALBUM' may not exist or failed" | tee -a "$LOG"
  echo "$(date): Done syncing: $ALBUM" >> "$LOG"
done

TOTAL=$(find "$INCOMING" -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.heic" \) 2>/dev/null | wc -l)
echo "$(date): Sync complete. Total photos in incoming: $TOTAL" | tee -a "$LOG"
